import { describe, expect, it } from 'bun:test';
import {
  AuthJsonImportError,
  MAX_AUTH_JSON_IMPORT_BYTES,
  parseAuthJsonImport,
  type AuthJsonImportErrorCode,
  type AuthJsonImportMode,
  type AuthJsonImportProvider,
} from '../src/services/authJsonImport';

const parse = (value: unknown, mode: AuthJsonImportMode = 'session', provider: AuthJsonImportProvider = 'auto') =>
  parseAuthJsonImport(JSON.stringify(value), mode, provider);
const jwt = (header: Record<string, unknown>, payload: Record<string, unknown>, signature = 'signed') =>
  `${btoa(JSON.stringify(header))}.${btoa(JSON.stringify(payload))}.${signature}`;
const assertError = (
  text: string, mode: AuthJsonImportMode, code: AuthJsonImportErrorCode, provider: AuthJsonImportProvider = 'auto',
) => {
  try {
    parseAuthJsonImport(text, mode, provider);
    throw new Error('Expected import to fail');
  } catch (error) {
    expect(error).toBeInstanceOf(AuthJsonImportError);
    expect((error as AuthJsonImportError).code).toBe(code);
    return error as AuthJsonImportError;
  }
};

describe('JSON credential import', () => {
  it('preserves native CPA provider credentials and routing settings', () => {
    const auth = {
      type: 'claude', email: 'user@example.com', access_token: 'secret-access',
      refresh_token: 'secret-refresh', priority: 12, prefix: 'work', disabled: true,
    };
    expect(parse(auth, 'auth')[0].content).toEqual(auth);
    expect(parse({ provider: 'gemini', token: { access_token: 'google-token' } }, 'auth')).toHaveLength(1);
    expect(parse({ type: 'service_account', private_key: '-----BEGIN KEY-----\nsecret\n' }, 'auth')).toHaveLength(1);
  });

  it('rejects native objects without provider credentials', () => {
    for (const value of [{ access_token: 'secret' }, { type: 'codex', email: 'user@example.com' },
      { type: 'codex', metadata: { access_token: 'secret' } }, { type: 'service_account', access_token: 'secret' }]) {
      expect(() => parse(value, 'auth')).toThrow(AuthJsonImportError);
    }
    assertError('[{"type":"codex","access_token":"secret"}]', 'auth', 'invalid_shape');
  });

  it('adds the selected provider to untyped auth JSON without rewriting credentials or routing fields', () => {
    const auth = { credentials: { access_token: 'secret-access', refresh_token: 'secret-refresh' },
      prefix: 'work', priority: 12, disabled: true };
    for (const provider of ['codex', 'claude', 'antigravity', 'kimi', 'xai', 'gemini', 'qwen', 'vertex'] as const) {
      expect(parse(auth, 'auth', provider)[0].content).toEqual({ ...auth, type: provider });
      assertError(JSON.stringify({ email: 'user@example.com' }), 'auth', 'missing_credentials', provider);
    }
    assertError(JSON.stringify(auth), 'auth', 'invalid_shape');
    const raw = { user: { email: 'user@example.com' }, accessToken: 'secret' };
    expect(parse(raw, 'auth', 'claude')[0].content).toEqual({ ...raw, type: 'claude' });
  });

  it('matches provider aliases and preserves existing type declarations', () => {
    const aliases: [string, AuthJsonImportProvider][] = [
      ['anthropic', 'claude'], ['openai', 'codex'], ['anti-gravity', 'antigravity'],
      ['grok', 'xai'], ['x-ai', 'xai'], ['x.ai', 'xai'],
    ];
    for (const [alias, provider] of aliases) {
      const auth = { type: alias.toUpperCase(), provider, access_token: 'secret' };
      expect(parse(auth, 'auth', provider)[0].content).toEqual(auth);
      expect(parse({ provider: alias, access_token: 'secret' }, 'auth', provider)[0].content)
        .toEqual({ type: provider, provider: alias, access_token: 'secret' });
    }
    const serviceAccount = { type: 'service_account', private_key: '-----BEGIN KEY-----\nsecret\n',
      client_email: 'account@example.iam.gserviceaccount.com', project_id: 'project' };
    expect(parse(serviceAccount, 'auth', 'vertex')[0].content).toEqual(serviceAccount);
    expect(parse({ provider: 'service_account', private_key: serviceAccount.private_key }, 'auth', 'vertex')[0].content)
      .toEqual({ type: 'vertex', provider: 'service_account', private_key: serviceAccount.private_key });
    assertError(JSON.stringify({ type: 'service_account', access_token: 'secret' }),
      'auth', 'missing_credentials', 'vertex');
  });

  it('rejects every conflicting root provider declaration instead of relabeling credentials', () => {
    for (const auth of [
      { type: 'codex', access_token: 'secret' },
      { provider: 'openai', access_token: 'secret' },
      { type: 'claude', provider: 'openai', access_token: 'secret' },
      { type: 'codex', provider: 'anthropic', access_token: 'secret' },
      { type: 'unknown-provider', access_token: 'secret' },
    ]) {
      assertError(JSON.stringify(auth), 'auth', 'provider_mismatch', 'claude');
    }
    const existing = { type: 'codex', provider: 'openai', access_token: 'secret' };
    expect(parse(existing, 'auth')[0].content).toEqual(existing);
  });

  it('limits session and Sub2API conversion to automatic detection or Codex selection', () => {
    const sources: [AuthJsonImportMode, unknown][] = [
      ['session', { accessToken: 'secret', user: { email: 'user@example.com' } }],
      ['sub2api', { platform: 'openai', type: 'oauth', credentials: { access_token: 'secret' } }],
    ];
    for (const [mode, source] of sources) {
      for (const provider of ['auto', 'codex'] as const) {
        expect(parse(source, mode, provider)[0].content.type).toBe('codex');
      }
      for (const provider of ['claude', 'antigravity', 'kimi', 'xai', 'gemini', 'qwen', 'vertex'] as const) {
        assertError(JSON.stringify(source), mode, 'provider_mismatch', provider);
      }
    }
  });

  it('converts ChatGPT web session fields to Codex credentials', () => {
    const [{ content }] = parse({
      user: { email: 'user@example.com' }, account: { id: 'account-1', planType: 'plus' },
      accessToken: 'access-secret', refreshToken: 'refresh-secret', sessionToken: 'session-secret',
      idToken: 'opaque-id-token', expires: '2030-01-01T01:00:00+01:00',
    });
    expect(content).toMatchObject({
      type: 'codex', email: 'user@example.com', name: 'user@example.com',
      account_id: 'account-1', chatgpt_account_id: 'account-1',
      plan_type: 'plus', chatgpt_plan_type: 'plus', access_token: 'access-secret',
      refresh_token: 'refresh-secret', session_token: 'session-secret', id_token: 'opaque-id-token',
      expired: '2030-01-01T00:00:00.000Z',
    });
    expect(Number.isFinite(Date.parse(String(content.last_refresh)))).toBe(true);
  });

  it('joins split token and profile wrappers without losing optional credentials', () => {
    const [{ content }] = parse({ data: {
      session: { tokens: { access_token: 'secret', refresh_token: 'refresh', session_token: 'session' } },
      profile: { user: { email: 'split@example.com' }, account: { chatgpt_account_id: 'split-id' } },
    } });
    expect(content).toMatchObject({ access_token: 'secret', refresh_token: 'refresh',
      session_token: 'session', email: 'split@example.com', account_id: 'split-id' });
  });

  it('accepts account ID identity and uses JWT metadata only as a fallback', () => {
    expect(parse({ accessToken: 'secret', account_id: 'account-1' })[0].content.account_id).toBe('account-1');
    const accessToken = jwt({ alg: 'RS256' }, {
      'https://api.openai.com/auth': { chatgpt_account_id: 'jwt-account', chatgpt_plan_type: 'plus' },
      'https://api.openai.com/profile': { email: 'jwt@example.com' },
    });
    expect(parse({ accessToken })[0].content).toMatchObject({ email: 'jwt@example.com', account_id: 'jwt-account' });
    expect(parse({ accessToken, email: 'explicit@example.com', account_id: 'explicit-account' })[0].content)
      .toMatchObject({ email: 'explicit@example.com', account_id: 'explicit-account' });
  });

  it('accepts repeated references to one token but rejects multiple accounts before returning files', () => {
    expect(parse({ user: { email: 'one@example.com' }, accessToken: 'one', token: { access_token: 'one' } })).toHaveLength(1);
    const input = [{ email: 'one@example.com', accessToken: 'one-secret' },
      { email: 'two@example.com', accessToken: 'two-secret' }];
    const error = assertError(JSON.stringify(input), 'session', 'multiple_sessions');
    expect(error.message).not.toContain('one-secret');
    expect(error.message).not.toContain('two@example.com');
  });

  it('uses explicit session expiry first and defensively falls back to JWT exp', () => {
    const accessToken = jwt({ alg: 'RS256' }, { exp: 1893456000 });
    expect(parse({ email: 'user@example.com', accessToken })[0].content.expired).toBe('2030-01-01T00:00:00.000Z');
    expect(parse({ email: 'user@example.com', accessToken, expires: '1893542400000' })[0].content.expired)
      .toBe('2030-01-02T00:00:00.000Z');
    expect(parse({ email: 'user@example.com', accessToken: 'malformed.token', expires: 1e99 })[0].content.expired)
      .toBeUndefined();
  });

  it('does not store unsigned ID tokens or accept them in native auth JSON', () => {
    for (const idToken of [jwt({ alg: 'none' }, { email: 'test' }), jwt({ alg: 'RS256' }, {}, '')]) {
      expect(parse({ email: 'user@example.com', accessToken: 'secret', idToken })[0].content.id_token).toBeUndefined();
      assertError(JSON.stringify({ type: 'codex', access_token: 'secret', id_token: idToken }), 'auth', 'unsafe_content');
      expect(parse({ platform: 'openai', type: 'oauth', credentials: { access_token: 'secret', id_token: idToken } },
        'sub2api')[0].content.id_token).toBeUndefined();
    }
  });

  it('splits official Sub2API exports and skips other provider or API-key entries', () => {
    const [{ content: first }, { content: second }] = parse({
      exported_at: '2026-09-05T00:00:00Z', proxies: [], accounts: [
        { platform: 'anthropic', type: 'oauth', credentials: { access_token: 'skip' } },
        { platform: 'openai', type: 'apikey', credentials: { api_key: 'skip' } },
        { platform: 'OpenAI', type: 'OAuth', name: 'Work', status: 'active', credentials: {
          access_token: 'first-access', refresh_token: 'first-refresh', client_id: 'client',
          email: 'first@example.com', chatgpt_account_id: 'account-1', expires_at: 1893456000,
        }, extra: { plan_type: 'team', chatgpt_user_id: 'user-1', organization_id: 'org-1' } },
        { platform: 'openai', type: 'oauth', status: 'disabled', expires_at: 1893456000000,
          credentials: { accessToken: 'second-access', refreshToken: 'second-refresh', accountId: 'account-2' } },
      ],
    }, 'sub2api');
    expect(first).toMatchObject({ type: 'codex', access_token: 'first-access', refresh_token: 'first-refresh',
      name: 'Work', account_id: 'account-1', chatgpt_account_id: 'account-1', email: 'first@example.com',
      client_id: 'client', plan_type: 'team', chatgpt_user_id: 'user-1', organization_id: 'org-1',
      expired: '2030-01-01T00:00:00.000Z', last_refresh: '2026-09-05T00:00:00.000Z' });
    expect(first.disabled).toBeUndefined();
    expect(second).toMatchObject({ access_token: 'second-access', refresh_token: 'second-refresh',
      account_id: 'account-2', disabled: true, expired: '2030-01-01T00:00:00.000Z' });
  });

  it('accepts Sub2API arrays, single accounts and data envelopes', () => {
    const account = { platform: 'openai', type: 'oauth', disabled: false,
      status: 'disabled', credentials: { access_token: 'secret' } };
    for (const input of [account, [account], { data: { accounts: [account] } }]) {
      expect(parse(input, 'sub2api')[0].content.disabled).toBeUndefined();
    }
    assertError('{"accounts":null}', 'sub2api', 'invalid_shape');
    assertError('{"accounts":[]}', 'sub2api', 'unsupported_accounts');
  });

  it('reports the source entry index without leaking account data when an OAuth entry lacks its token', () => {
    const error = assertError(JSON.stringify({ accounts: [
      { platform: 'anthropic', type: 'oauth' },
      { platform: 'openai', type: 'oauth', name: 'private-account-name', credentials: { refresh_token: 'secret-refresh' } },
    ] }), 'sub2api', 'missing_credentials');
    expect(error.entryIndex).toBe(1);
    expect(error.message).not.toContain('private-account-name');
    expect(error.message).not.toContain('secret-refresh');
  });

  it('generates portable filenames stable across token rotations with unique batch names', () => {
    const first = { platform: 'openai', type: 'oauth', name: '../CON:bad\\name?.json',
      credentials: { access_token: 'first-secret', account_id: 'account-1' } };
    const second = { ...first, credentials: { ...first.credentials, access_token: 'rotated-secret' } };
    const [{ name }] = parse(first, 'sub2api');
    expect(name).toBe(parse(second, 'sub2api')[0].name);
    expect(name).toMatch(/^[a-z0-9][a-z0-9@._+-]*\.json$/);
    expect(name.length).toBeLessThan(130);
    const files = parse([first, second], 'sub2api');
    expect(new Set(files.map((file) => file.name)).size).toBe(2);
    expect(files[1].name).toEndWith('-2.json');
    expect(name).not.toContain('secret');
  });

  it('excludes credentials repeated in identity fields from generated filenames', () => {
    const [{ name }] = parse({ type: 'codex', email: 'prefix-very-private-token',
      name: 'very-private-token', access_token: 'very-private-token' }, 'auth');
    expect(name).not.toContain('private');
  });

  it('keeps anonymous accounts distinct across separate import batches', () => {
    const first = parse({ type: 'codex', access_token: 'secret-one' }, 'auth')[0];
    const second = parse({ type: 'codex', access_token: 'secret-two' }, 'auth')[0];
    expect(first.name).not.toBe(second.name);
    expect(first.name).not.toContain('secret-one');
    const account = { platform: 'openai', type: 'oauth', name: 'Shared display name',
      credentials: { access_token: 'secret' } };
    expect(parse(account, 'sub2api')[0].name).not.toBe(parse(account, 'sub2api')[0].name);
  });

  it('returns secret-free parse errors and rejects unsupported JSON roots', () => {
    const error = assertError('{"accessToken":"SUPER-SECRET",invalid}', 'session', 'invalid_json');
    expect(error.message).not.toContain('SUPER-SECRET');
    assertError('   ', 'auth', 'empty');
    for (const value of ['null', '123', 'true', '"secret"']) assertError(value, 'session', 'invalid_shape');
    assertError('{"accessToken":"secret"}', 'session', 'invalid_shape');
    assertError('{"email":"user@example.com"}', 'session', 'missing_credentials');
  });

  it('limits byte size, depth and record count before recursive processing', () => {
    assertError(' '.repeat(MAX_AUTH_JSON_IMPORT_BYTES + 1), 'auth', 'too_large');
    assertError(JSON.stringify({ value: '界'.repeat(Math.ceil(MAX_AUTH_JSON_IMPORT_BYTES / 3)) }), 'auth', 'too_large');
    let deeplyNested: unknown = { accessToken: 'secret', email: 'user@example.com' };
    for (let index = 0; index < 66; index++) deeplyNested = { data: deeplyNested };
    assertError(JSON.stringify(deeplyNested), 'session', 'too_complex');
    assertError(JSON.stringify(Array.from({ length: 5001 }, () => ({}))), 'sub2api', 'too_complex');
  });

  it('rejects invisible characters in JSON values and keys', () => {
    assertError(JSON.stringify({ type: 'codex', access_token: 'secret\u200b' }), 'auth', 'unsafe_content');
    assertError(JSON.stringify({ 'access\u202etoken': 'secret' }), 'session', 'unsafe_content');
  });
});
