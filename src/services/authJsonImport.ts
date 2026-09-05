export type AuthJsonImportMode = 'auth' | 'session' | 'sub2api';
export type AuthJsonImportProvider =
  | 'auto' | 'codex' | 'claude' | 'antigravity' | 'kimi' | 'xai' | 'gemini' | 'qwen' | 'vertex';
export type AuthJsonImportErrorCode =
  | 'empty' | 'too_large' | 'invalid_json' | 'invalid_shape' | 'missing_credentials'
  | 'multiple_sessions' | 'unsupported_accounts' | 'unsafe_content' | 'too_complex' | 'provider_mismatch';

export interface AuthJsonImportFile {
  name: string;
  content: Record<string, unknown>;
}

/** Errors deliberately contain no source JSON, token values, or account names. */
export class AuthJsonImportError extends Error {
  constructor(public readonly code: AuthJsonImportErrorCode, public readonly entryIndex?: number) {
    super(`Auth JSON import: ${code}`);
    this.name = 'AuthJsonImportError';
  }
}

export const MAX_AUTH_JSON_IMPORT_BYTES = 10 * 1024 * 1024;
type JsonObject = Record<string, unknown>;
const object = (value: unknown): value is JsonObject =>
  value !== null && typeof value === 'object' && !Array.isArray(value);
const string = (...values: unknown[]) =>
  values.find((value): value is string => typeof value === 'string' && value.trim() !== '')?.trim();
const compact = (value: JsonObject): JsonObject =>
  Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined));
const invisible = /[\u200b-\u200f\u202a-\u202e\u2060\u2066-\u2069\ufeff]/u;
const credentialKeys = new Set([
  'access_token', 'accesstoken', 'refresh_token', 'refreshtoken', 'id_token', 'idtoken',
  'session_token', 'sessiontoken', 'api_key', 'apikey', 'key', 'token', 'cookie', 'cookies',
  'authorization', 'bearer', 'client_secret', 'clientsecret', 'session_secret', 'sessionsecret',
]);

const inspect = (value: unknown): JsonObject[] => {
  const records: JsonObject[] = [];
  const pending = [{ value, depth: 0 }];
  let count = 0;
  while (pending.length) {
    const current = pending.pop()!;
    if (current.depth > 64) throw new AuthJsonImportError('too_complex');
    if (typeof current.value === 'string' && invisible.test(current.value)) {
      throw new AuthJsonImportError('unsafe_content');
    }
    if (!Array.isArray(current.value) && !object(current.value)) continue;
    if (++count > 5000) throw new AuthJsonImportError('too_complex');
    if (object(current.value)) records.push(current.value);
    for (const [key, child] of Object.entries(current.value)) {
      if (invisible.test(key)) throw new AuthJsonImportError('unsafe_content');
      pending.push({ value: child, depth: current.depth + 1 });
    }
  }
  return records;
};

const jwtPart = (token: unknown, index: number): JsonObject | undefined => {
  if (typeof token !== 'string') return;
  const segment = token.split('.')[index];
  if (!segment || segment.length > 16384) return;
  try {
    const base64 = segment.replace(/-/g, '+').replace(/_/g, '/');
    const bytes = Uint8Array.from(atob(base64.padEnd(Math.ceil(base64.length / 4) * 4, '=')),
      (character) => character.charCodeAt(0));
    const parsed: unknown = JSON.parse(new TextDecoder().decode(bytes));
    return object(parsed) ? parsed : undefined;
  } catch {
    return;
  }
};

const unsafeIdToken = (value: unknown) => {
  if (typeof value !== 'string') return false;
  const segments = value.split('.');
  return string(jwtPart(value, 0)?.alg)?.toLowerCase() === 'none'
    || (segments.length === 3 && !!segments[0].trim() && !!segments[1].trim() && !segments[2].trim());
};

const timestamp = (...values: unknown[]): string | undefined => {
  for (const value of values) {
    if (typeof value !== 'number' && typeof value !== 'string') continue;
    if (typeof value === 'string' && !value.trim()) continue;
    const numeric = typeof value === 'number' || /^-?\d+(?:\.\d+)?$/.test(value.trim());
    const milliseconds = numeric ? Number(value) * (Number(value) > 1e11 ? 1 : 1000) : NaN;
    const date = numeric ? new Date(milliseconds) : new Date(value);
    if (Number.isFinite(date.getTime())) return date.toISOString();
  }
  return;
};

const providerAliases: Record<string, string> = {
  anthropic: 'claude', openai: 'codex', 'anti-gravity': 'antigravity',
  grok: 'xai', 'x-ai': 'xai', 'x.ai': 'xai', service_account: 'vertex',
};

const nativeAuth = (value: unknown, records: JsonObject[], selectedProvider: AuthJsonImportProvider): JsonObject => {
  if (!object(value)) throw new AuthJsonImportError('invalid_shape');
  if (selectedProvider !== 'auto') {
    for (const declaration of [value.type, value.provider]) {
      if (declaration === undefined || declaration === null || declaration === '') continue;
      const declaredProvider = string(declaration)?.toLowerCase();
      if (!declaredProvider || (providerAliases[declaredProvider] || declaredProvider) !== selectedProvider) {
        throw new AuthJsonImportError('provider_mismatch');
      }
    }
  }
  const auth = selectedProvider !== 'auto' && !string(value.type) ? { ...value, type: selectedProvider } : value;
  const provider = string(auth.type, auth.provider)?.toLowerCase();
  if (!provider) throw new AuthJsonImportError('invalid_shape');
  const keys = string(value.type, value.provider)?.toLowerCase() === 'service_account'
    ? new Set(['private_key', 'privatekey']) : credentialKeys;
  const containers = [auth];
  for (const key of ['credentials', 'auth', 'cookies', 'token']) {
    if (object(auth[key])) containers.push(...inspect(auth[key]));
  }
  if (!containers.some((record) => Object.entries(record)
    .some(([key, item]) => keys.has(key.toLowerCase()) && !!string(item)))) {
    throw new AuthJsonImportError('missing_credentials');
  }
  if (records.some((record) => Object.entries(record).some(([key, item]) =>
    ['id_token', 'idtoken'].includes(key.toLowerCase()) && unsafeIdToken(item)))) {
    throw new AuthJsonImportError('unsafe_content');
  }
  return auth;
};

const sessionAuth = (records: JsonObject[], now: string): JsonObject => {
  const tokenRecords = records.filter((record) => string(record.accessToken, record.access_token));
  const tokens = [...new Set(tokenRecords.map((record) => string(record.accessToken, record.access_token)))];
  if (!tokens.length) throw new AuthJsonImportError('missing_credentials');
  if (tokens.length > 1) throw new AuthJsonImportError('multiple_sessions');
  const payload = jwtPart(tokens[0], 1);
  const claims = object(payload?.['https://api.openai.com/auth']) ? payload['https://api.openai.com/auth'] : {};
  const profile = object(payload?.['https://api.openai.com/profile']) ? payload['https://api.openai.com/profile'] : {};
  const roots = records.filter((record) => object(record.user) || object(record.account)
    || string(record.email, record.name, record.account_id, record.chatgpt_account_id));
  if (!roots.length && !string(claims.chatgpt_account_id, profile.email, payload?.email)) {
    throw new AuthJsonImportError('invalid_shape');
  }
  const pick = (...keys: string[]) => string(...records.flatMap((record) => keys.map((key) => record[key])));
  const users = records.map((record) => record.user).filter(object);
  const accounts = records.map((record) => record.account).filter(object);
  const accountId = string(...accounts.flatMap((account) =>
    [account.id, account.account_id, account.chatgpt_account_id]), pick('account_id', 'chatgpt_account_id'),
    claims.chatgpt_account_id);
  const plan = string(...accounts.flatMap((account) =>
    [account.planType, account.plan_type, account.chatgpt_plan_type]), pick('plan_type', 'chatgpt_plan_type'),
    claims.chatgpt_plan_type);
  // JWT claims supply missing metadata only; importing is not token verification.
  const email = string(...users.map((user) => user.email), pick('email'), profile.email, payload?.email);
  const idToken = pick('idToken', 'id_token');
  return compact({
    type: 'codex', access_token: tokens[0],
    refresh_token: pick('refreshToken', 'refresh_token'),
    session_token: pick('sessionToken', 'session_token'),
    id_token: unsafeIdToken(idToken) ? undefined : idToken,
    account_id: accountId, chatgpt_account_id: accountId,
    email, name: email || string(...roots.map((record) => record.name)) || 'ChatGPT Account',
    plan_type: plan, chatgpt_plan_type: plan,
    expired: timestamp(...records.flatMap((record) => [record.expires, record.expired, record.expires_at]),
      payload?.exp),
    last_refresh: now,
    disabled: records.some((record) => record.disabled === true) || undefined,
  });
};

const sub2apiAuth = (value: unknown, now: string): JsonObject[] => {
  const envelope = object(value) && object(value.data) ? value.data : value;
  const entries = Array.isArray(envelope) ? envelope
    : object(envelope) && Array.isArray(envelope.accounts) ? envelope.accounts
      : object(envelope) && object(envelope.credentials) ? [envelope] : undefined;
  if (!entries) throw new AuthJsonImportError('invalid_shape');
  const results: JsonObject[] = [];
  entries.forEach((entry: unknown, entryIndex: number) => {
    if (!object(entry) || string(entry.platform)?.toLowerCase() !== 'openai'
      || string(entry.type)?.toLowerCase() !== 'oauth') return;
    const credentials = object(entry.credentials) ? entry.credentials : {};
    const extra = object(entry.extra) ? entry.extra : {};
    const pick = (...keys: string[]) => string(...keys.flatMap((key) => [credentials[key], extra[key]]));
    const accessToken = string(credentials.access_token, credentials.accessToken);
    if (!accessToken) throw new AuthJsonImportError('missing_credentials', entryIndex);
    const accountId = pick('chatgpt_account_id', 'chatgptAccountId', 'account_id', 'accountId');
    const plan = pick('plan_type', 'planType', 'chatgpt_plan_type', 'chatgptPlanType');
    const email = pick('email', 'email_address', 'emailAddress');
    const idToken = string(credentials.id_token, credentials.idToken);
    const status = string(entry.status)?.toLowerCase();
    results.push(compact({
      type: 'codex', access_token: accessToken,
      refresh_token: string(credentials.refresh_token, credentials.refreshToken),
      id_token: unsafeIdToken(idToken) ? undefined : idToken,
      client_id: string(credentials.client_id, credentials.clientId),
      account_id: accountId, chatgpt_account_id: accountId,
      chatgpt_user_id: pick('chatgpt_user_id', 'chatgptUserId', 'user_id', 'userId'),
      organization_id: pick('organization_id', 'organizationId', 'org_id', 'orgId', 'poid'),
      email, name: string(entry.name, email, accountId) || 'OpenAI OAuth Account',
      plan_type: plan, chatgpt_plan_type: plan,
      expired: timestamp(credentials.expires_at, credentials.expiresAt, entry.expires_at, entry.expiresAt),
      last_refresh: timestamp(object(envelope) ? envelope.exported_at : undefined, entry.exported_at) || now,
      disabled: typeof entry.disabled === 'boolean'
        ? entry.disabled || undefined : (status && status !== 'active' ? true : undefined),
    }));
  });
  if (!results.length) throw new AuthJsonImportError('unsupported_accounts');
  return results;
};

const fileNames = (contents: JsonObject[], sourceRecords: JsonObject[]): AuthJsonImportFile[] => {
  const secrets = sourceRecords.flatMap((record) => Object.entries(record)
    .filter(([key]) => credentialKeys.has(key.toLowerCase()) || key.toLowerCase() === 'private_key')
    .map(([, value]) => string(value)).filter((value): value is string => !!value));
  const safeIdentity = (value: unknown) => {
    const text = string(value);
    return text && !secrets.some((secret) => text.includes(secret)) ? text : undefined;
  };
  const safeSegment = (value: string, max: number) => value.toLowerCase()
    .replace(/[^a-z0-9@._+-]+/g, '-').replace(/\.{2,}/g, '.')
    .replace(/^[.-]+|[.-]+$/g, '').slice(0, max).replace(/[.-]+$/g, '');
  const used = new Set<string>();
  return contents.map((content) => {
    const provider = safeSegment(safeIdentity(content.type) || safeIdentity(content.provider) || 'auth', 24) || 'auth';
    const email = safeIdentity(content.email);
    const identity = email || safeIdentity(content.name) || safeIdentity(content.account_id) || 'account';
    const id = safeIdentity(content.account_id) || safeIdentity(content.chatgpt_account_id)
      || safeIdentity(content.organization_id) || '';
    // Identity-only hashing keeps filenames stable when credentials or expiry change.
    const fingerprint = JSON.stringify([provider, identity, id]);
    let hash = 2166136261;
    for (let index = 0; index < fingerprint.length; index++) {
      hash = Math.imul(hash ^ fingerprint.charCodeAt(index), 16777619);
    }
    // A display name is not a unique account identity. Keep anonymous imports distinct
    // across batches without placing credentials or credential-derived data in a name.
    const suffix = email || id ? (hash >>> 0).toString(16).padStart(8, '0') : crypto.randomUUID();
    const stem = `${provider}-${safeSegment(identity, 80) || 'account'}-${suffix}`;
    let name = `${stem}.json`;
    for (let suffix = 2; used.has(name); suffix++) name = `${stem}-${suffix}.json`;
    used.add(name);
    return { name, content };
  });
};

/** Convert local credential JSON without contacting a provider or persisting secrets. */
export const parseAuthJsonImport = (
  text: string, mode: AuthJsonImportMode, provider: AuthJsonImportProvider = 'auto',
): AuthJsonImportFile[] => {
  if (mode !== 'auth' && provider !== 'auto' && provider !== 'codex') {
    throw new AuthJsonImportError('provider_mismatch');
  }
  if (text.length > MAX_AUTH_JSON_IMPORT_BYTES
    || new TextEncoder().encode(text).length > MAX_AUTH_JSON_IMPORT_BYTES) {
    throw new AuthJsonImportError('too_large');
  }
  if (!text.trim()) throw new AuthJsonImportError('empty');
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    throw new AuthJsonImportError('invalid_json');
  }
  if (!object(value) && !Array.isArray(value)) throw new AuthJsonImportError('invalid_shape');
  const records = inspect(value);
  const now = new Date().toISOString();
  const contents = mode === 'auth' ? [nativeAuth(value, records, provider)]
    : mode === 'session' ? [sessionAuth(records, now)] : sub2apiAuth(value, now);
  return fileNames(contents, records);
};
