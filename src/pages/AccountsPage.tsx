import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import {
  Check,
  Copy,
  ExternalLink,
  FolderOpen,
  Import,
  Layers,
  LoaderCircle,
  LogIn,
  Pencil,
  RefreshCw,
  Search,
  Sliders,
  Trash2,
} from 'lucide-react';
import antigravityIcon from '../assets/icons/antigravity.svg';
import claudeIcon from '../assets/icons/claude.svg';
import codexIcon from '../assets/icons/codex.svg';
import grokIcon from '../assets/icons/grok.svg';
import kimiIcon from '../assets/icons/kimi-light.svg';
import { useI18n } from '../i18n';
import {
  changedOAuthAuthFileNames,
  parseAuthFilePriority,
  snapshotAuthFiles,
  type AuthFileSnapshot,
} from '../services/authFiles';
import { formatDate, managementApi, readBoolean, readNumber, responseList } from '../services/managementApi';
import { createOAuthLoginSuccessCache } from '../services/oauthLoginState';
import {
  captureQuotaCacheGeneration,
  commitQuotaCacheIfCurrent,
  updateQuotaCache,
} from '../services/quotaCache';
import {
  consumeCodexResetCredit,
  formatQuotaTimestamp,
  idleQuota,
  providerForFile as quotaProviderForFile,
  quotaKey,
  type QuotaProvider,
  type QuotaState,
} from '../services/quotaService';
import {
  AuthFileQuotaSummary,
  OauthModelDialog,
  PriorityEditorDialog,
  fileName,
  isRuntimeOnly,
  providerIcons,
  providerKey,
  statusText,
  useAuthFileManager,
  type AuthFile,
} from './AuthFileManagementPage';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';

type OAuthProviderId = 'codex' | 'claude' | 'antigravity' | 'kimi' | 'xai';
type OAuthFlowStatus = 'idle' | 'waiting' | 'success' | 'error';

type OAuthProviderState = {
  url?: string;
  state?: string;
  status: OAuthFlowStatus;
  error?: string;
  polling?: boolean;
  callbackUrl?: string;
  callbackSubmitting?: boolean;
  callbackStatus?: 'success' | 'error';
  callbackError?: string;
  refreshing?: boolean;
};

type OAuthStartResult = {
  url: string;
  state?: string | null;
  opened: boolean;
  openError?: string | null;
};

type OAuthBrowserOption = {
  id: string;
  label: string;
};

type OAuthStatusResult = {
  status: string;
  error?: string | null;
};

const oauthProviders = [
  { id: 'codex' as const, name: 'Codex OAuth', icon: codexIcon },
  { id: 'claude' as const, name: 'Claude OAuth', icon: claudeIcon },
  { id: 'antigravity' as const, name: 'Antigravity OAuth', icon: antigravityIcon },
  { id: 'kimi' as const, name: 'Kimi OAuth', icon: kimiIcon },
  { id: 'xai' as const, name: 'xAI OAuth', icon: grokIcon },
];

const providerOrder: QuotaProvider[] = ['claude', 'antigravity', 'codex', 'xai', 'kimi'];

const PROVIDER_FILTER_NAME: Record<string, string> = {
  claude: 'Claude',
  antigravity: 'Antigravity',
  codex: 'Codex',
  xai: 'xAI',
  kimi: 'Kimi',
};

const OAUTH_CALLBACK_SUPPORTED = new Set<OAuthProviderId>([
  'codex',
  'claude',
  'antigravity',
  'xai',
]);
const XAI_CALLBACK_URL = 'http://127.0.0.1:56121/callback';
const OAUTH_POLL_INTERVAL_MS = 3000;
const OAUTH_BROWSER_STORAGE_KEY = 'evel-proxy-tool.oauth-browser.v3';
const NO_AUTO_OPEN_BROWSER_ID = 'none';
const QUOTA_AUTO_REFRESH_STORAGE_KEY = 'evel-proxy-tool.quota-auto-refresh';
const QUOTA_AUTO_REFRESH_OPTIONS = [0, 15, 30, 60, 300] as const;
const oauthLoginSuccessCache = createOAuthLoginSuccessCache<OAuthProviderId>();

function providerLabel(provider: OAuthProviderId) {
  return oauthProviders.find((item) => item.id === provider)?.name ?? provider;
}

function isAbsoluteUrl(value: string) {
  try {
    new URL(value);
    return true;
  } catch {
    return false;
  }
}

function readQueryLikeCallbackInput(value: string) {
  const trimmed = value.trim();
  if (!trimmed) return null;
  const queryStart = trimmed.indexOf('?');
  const hashStart = trimmed.indexOf('#');
  const rawParams = queryStart >= 0
    ? trimmed.slice(queryStart + 1)
    : hashStart >= 0
      ? trimmed.slice(hashStart + 1)
      : trimmed;
  if (!/(^|[&#?])(code|state|error)=/i.test(rawParams)) return null;
  return new URLSearchParams(rawParams.replace(/^[?#]/, ''));
}

function buildXaiCallbackUrl(input: string, state?: string) {
  const trimmed = input.trim();
  if (!trimmed) return null;
  if (isAbsoluteUrl(trimmed)) return trimmed;
  const params = readQueryLikeCallbackInput(trimmed);
  if (params) {
    const callbackState = params.get('state')?.trim() || state?.trim();
    if (!callbackState) return null;
    const callbackUrl = new URL(XAI_CALLBACK_URL);
    callbackUrl.searchParams.set('state', callbackState);
    for (const key of ['code', 'error', 'error_description']) {
      const value = params.get(key)?.trim();
      if (value) callbackUrl.searchParams.set(key, value);
    }
    return callbackUrl.toString();
  }
  const code = (trimmed.match(/\bcode\s*[:=]\s*([^\s&]+)/i)?.[1] ?? trimmed).trim();
  const callbackState = state?.trim();
  if (!code || !callbackState) return null;
  const callbackUrl = new URL(XAI_CALLBACK_URL);
  callbackUrl.searchParams.set('code', code);
  callbackUrl.searchParams.set('state', callbackState);
  return callbackUrl.toString();
}

function resolveCallbackUrl(provider: OAuthProviderId, input: string, state?: string) {
  return provider === 'xai' ? buildXaiCallbackUrl(input, state) : input.trim();
}

const resolveOAuthBrowserSelection = (
  available: OAuthBrowserOption[],
  preferred: string,
): string => {
  if (preferred === NO_AUTO_OPEN_BROWSER_ID) return preferred;
  if (available.some((browser) => browser.id === preferred)) return preferred;
  return available.find((browser) => browser.id !== 'default')?.id
    ?? available.find((browser) => browser.id === 'default')?.id
    ?? NO_AUTO_OPEN_BROWSER_ID;
};

const loadOAuthBrowserPreference = (): string => {
  try {
    return window.localStorage.getItem(OAUTH_BROWSER_STORAGE_KEY)?.trim() || '';
  } catch {
    return '';
  }
};

const cachedOAuthProviderStates = (): Partial<Record<OAuthProviderId, OAuthProviderState>> => (
  oauthLoginSuccessCache.snapshot().reduce<Partial<Record<OAuthProviderId, OAuthProviderState>>>(
    (states, provider) => ({ ...states, [provider]: { status: 'success' } }),
    {},
  )
);

function useOAuthLogin({ onLoginComplete }: { onLoginComplete?: () => void }) {
  const { t } = useI18n();
  const [states, setStates] = useState<Partial<Record<OAuthProviderId, OAuthProviderState>>>(
    cachedOAuthProviderStates,
  );
  const [notice, setNotice] = useState<{
    message: string;
    tone: 'success' | 'error' | 'info';
  } | null>(null);
  const [browsers, setBrowsers] = useState<OAuthBrowserOption[]>([]);
  const [browsersLoading, setBrowsersLoading] = useState(true);
  const [selectedBrowser, setSelectedBrowser] = useState(loadOAuthBrowserPreference);
  const pollingTimers = useRef<Partial<Record<OAuthProviderId, number>>>({});
  const pollingRequests = useRef<Partial<Record<OAuthProviderId, boolean>>>({});
  const credentialSnapshots = useRef<Partial<Record<OAuthProviderId, AuthFileSnapshot>>>({});
  const noticeTimerRef = useRef<number | null>(null);
  const onLoginCompleteRef = useRef(onLoginComplete);
  onLoginCompleteRef.current = onLoginComplete;

  useEffect(() => {
    let active = true;
    void invoke<OAuthBrowserOption[]>('list_oauth_browsers')
      .then((available) => {
        if (!active) return;
        setBrowsers(available);
        setSelectedBrowser((current) => resolveOAuthBrowserSelection(available, current));
      })
      .catch((error) => {
        if (!active) return;
        console.warn('Failed to detect installed browsers', error);
        const fallback = [{ id: 'default', label: t('oauth.browser.systemDefault') }];
        setBrowsers(fallback);
        setSelectedBrowser((current) => resolveOAuthBrowserSelection(fallback, current));
      })
      .finally(() => {
        if (active) setBrowsersLoading(false);
      });
    return () => { active = false; };
  }, []);

  useEffect(() => {
    try {
      window.localStorage.setItem(OAUTH_BROWSER_STORAGE_KEY, selectedBrowser);
    } catch {
      // Keep the in-memory selection when persistent storage is unavailable.
    }
  }, [selectedBrowser]);

  const showNotice = useCallback((message: string, tone: 'success' | 'error' | 'info') => {
    if (noticeTimerRef.current !== null) window.clearTimeout(noticeTimerRef.current);
    setNotice({ message, tone });
    noticeTimerRef.current = window.setTimeout(() => {
      setNotice(null);
      noticeTimerRef.current = null;
    }, 3600);
  }, []);

  const updateProviderState = useCallback(
    (provider: OAuthProviderId, next: Partial<OAuthProviderState>) => {
      setStates((current) => ({
        ...current,
        [provider]: {
          status: 'idle',
          ...(current[provider] ?? {}),
          ...next,
        },
      }));
    },
    [],
  );

  const clearPollingTimer = useCallback((provider: OAuthProviderId) => {
    const timer = pollingTimers.current[provider];
    if (timer !== undefined) window.clearInterval(timer);
    delete pollingTimers.current[provider];
    delete pollingRequests.current[provider];
  }, []);

  const completeProviderAuth = useCallback(
    (provider: OAuthProviderId) => {
      clearPollingTimer(provider);
      oauthLoginSuccessCache.mark(provider);
      updateProviderState(provider, {
        url: undefined,
        state: undefined,
        status: 'success',
        error: undefined,
        polling: false,
        callbackUrl: '',
        callbackSubmitting: false,
        callbackStatus: undefined,
        callbackError: undefined,
      });
      onLoginCompleteRef.current?.();
    },
    [clearPollingTimer, updateProviderState],
  );

  const captureCredentialSnapshot = useCallback(async (provider: OAuthProviderId) => {
    const payload = await managementApi.get('/auth-files');
    credentialSnapshots.current[provider] = snapshotAuthFiles(responseList(payload, 'files'));
  }, []);

  const applyDefaultCredentialPriority = useCallback(async (provider: OAuthProviderId) => {
    const before = credentialSnapshots.current[provider];
    delete credentialSnapshots.current[provider];
    if (!before) return;

    const payload = await managementApi.get('/auth-files');
    const names = changedOAuthAuthFileNames(before, responseList(payload, 'files'), provider);
    await Promise.all(names.map((name) => managementApi.patch('/auth-files/fields', {
      name,
      priority: 0,
    })));
  }, []);

  const startPolling = useCallback(
    (provider: OAuthProviderId, state: string) => {
      clearPollingTimer(provider);
      const checkStatus = async () => {
        if (pollingRequests.current[provider]) return;
        pollingRequests.current[provider] = true;
        try {
          const result = await invoke<OAuthStatusResult>('get_oauth_status', { state });
          const status = (result.status || '').toLowerCase();
          if (status === 'ok') {
            let priorityError = '';
            try {
              await applyDefaultCredentialPriority(provider);
            } catch (error) {
              priorityError = String(error);
            }
            completeProviderAuth(provider);
            showNotice(
              priorityError
                ? t('oauth.priorityApplyFailed', { error: priorityError })
                : t('oauth.loginSuccess', { provider: providerLabel(provider) }),
              priorityError ? 'error' : 'success',
            );
          } else if (status === 'error') {
            updateProviderState(provider, {
              status: 'error',
              error: result.error || t('oauth.authFailed'),
              polling: false,
            });
            clearPollingTimer(provider);
            showNotice(
              t('oauth.loginFailed', {
                provider: providerLabel(provider),
                detail: result.error ? `: ${result.error}` : '',
              }),
              'error',
            );
          }
        } catch (error) {
          updateProviderState(provider, {
            status: 'error',
            error: String(error),
            polling: false,
          });
          clearPollingTimer(provider);
          showNotice(String(error), 'error');
        } finally {
          delete pollingRequests.current[provider];
        }
      };
      pollingTimers.current[provider] = window.setInterval(
        () => void checkStatus(),
        OAUTH_POLL_INTERVAL_MS,
      );
    },
    [applyDefaultCredentialPriority, clearPollingTimer, completeProviderAuth, showNotice, t, updateProviderState],
  );

  useEffect(() => {
    return () => {
      Object.values(pollingTimers.current).forEach((timer) => {
        if (timer !== undefined) window.clearInterval(timer);
      });
      if (noticeTimerRef.current !== null) window.clearTimeout(noticeTimerRef.current);
    };
  }, []);

  const startLogin = useCallback(async (provider: OAuthProviderId) => {
    clearPollingTimer(provider);
    updateProviderState(provider, {
      url: undefined,
      state: undefined,
      status: 'waiting',
      polling: true,
      error: undefined,
      callbackUrl: '',
      callbackStatus: undefined,
      callbackError: undefined,
    });

    try {
      await captureCredentialSnapshot(provider);
      const result = await invoke<OAuthStartResult>('start_oauth_login', {
        provider,
        browser: selectedBrowser,
      });
      if (!result.state) {
        updateProviderState(provider, {
          url: result.url,
          state: undefined,
          status: 'error',
          error: t('oauth.missingState'),
          polling: false,
        });
        showNotice(t('oauth.missingStatePolling'), 'error');
        return;
      }

      updateProviderState(provider, {
        url: result.url,
        state: result.state,
        status: 'waiting',
        polling: true,
      });
      startPolling(provider, result.state);

      if (!result.opened) {
        showNotice(
          result.openError
            ? t('oauth.openFailedDetail', { error: result.openError })
            : t('oauth.openFailed'),
          'info',
        );
      }
    } catch (error) {
      delete credentialSnapshots.current[provider];
      updateProviderState(provider, {
        status: 'error',
        error: String(error),
        polling: false,
      });
      showNotice(String(error), 'error');
    }
  }, [captureCredentialSnapshot, clearPollingTimer, selectedBrowser, showNotice, startPolling, t, updateProviderState]);

  const refreshLoginLink = useCallback(async (provider: OAuthProviderId) => {
    const currentState = states[provider]?.state;
    clearPollingTimer(provider);
    updateProviderState(provider, { refreshing: true });
    try {
      if (currentState) {
        await managementApi.delete('/oauth-session', { query: { state: currentState } });
      }
    } catch (error) {
      console.warn('Failed to cancel the previous OAuth session before refreshing', error);
    }
    try {
      await startLogin(provider);
    } finally {
      updateProviderState(provider, { refreshing: false });
    }
  }, [clearPollingTimer, startLogin, states, updateProviderState]);

  const openAuthUrl = useCallback(async (url?: string) => {
    if (!url) return;
    try {
      await invoke('open_oauth_url', {
        url,
        browser: selectedBrowser === NO_AUTO_OPEN_BROWSER_ID ? 'default' : selectedBrowser,
      });
    } catch (error) {
      showNotice(String(error), 'error');
    }
  }, [selectedBrowser, showNotice]);

  const copyAuthUrl = useCallback(async (url?: string) => {
    if (!url) return;
    try {
      await navigator.clipboard.writeText(url);
      showNotice(t('oauth.linkCopied'), 'success');
    } catch {
      showNotice(t('oauth.linkCopyFailed'), 'error');
    }
  }, [showNotice, t]);

  const submitCallback = useCallback(async (provider: OAuthProviderId) => {
    const current = states[provider];
    const callbackInput = (current?.callbackUrl || '').trim();
    if (!callbackInput) {
      showNotice(
        provider === 'xai' ? t('oauth.pasteXaiCallback') : t('oauth.pasteCallback'),
        'error',
      );
      return;
    }

    const redirectUrl = resolveCallbackUrl(provider, callbackInput, current?.state);
    if (!redirectUrl) {
      showNotice(
        provider === 'xai'
          ? t('oauth.invalidXaiCallback')
          : t('oauth.invalidCallback'),
        'error',
      );
      return;
    }

    updateProviderState(provider, {
      callbackSubmitting: true,
      callbackStatus: undefined,
      callbackError: undefined,
    });
    try {
      await invoke('submit_oauth_callback', { provider, redirectUrl });
      updateProviderState(provider, {
        callbackSubmitting: false,
        callbackStatus: 'success',
      });
      showNotice(t('oauth.callbackSubmittedNotice'), 'success');
    } catch (error) {
      updateProviderState(provider, {
        callbackSubmitting: false,
        callbackStatus: 'error',
        callbackError: String(error),
      });
      showNotice(String(error), 'error');
    }
  }, [showNotice, states, t, updateProviderState]);

  return {
    states,
    updateProviderState,
    notice,
    browsers,
    browsersLoading,
    selectedBrowser,
    setSelectedBrowser,
    startLogin,
    refreshLoginLink,
    openAuthUrl,
    copyAuthUrl,
    submitCallback,
  };
}

type OAuthLogin = ReturnType<typeof useOAuthLogin>;

function PendingLoginCard({
  provider,
  oauthLogin,
}: {
  provider: { id: OAuthProviderId; name: string; icon: string };
  oauthLogin: OAuthLogin;
}) {
  const { t } = useI18n();
  const state = oauthLogin.states[provider.id] ?? { status: 'idle' as const };
  const canSubmitCallback = OAUTH_CALLBACK_SUPPORTED.has(provider.id) && Boolean(state.url);

  return (
    <Card className="border-dashed border-primary/50 p-4">
      <div className="flex items-center gap-2.5">
        <img src={provider.icon} alt="" className="h-8 w-8 shrink-0" />
        <div className="min-w-0">
          <strong className="block text-sm font-semibold">{provider.name}</strong>
          <span className="text-xs text-muted-foreground">
            {state.status === 'error' ? t('oauth.status.failed') : t('oauth.loggingIn')}
          </span>
        </div>
      </div>

      {state.url ? (
        <div className="mt-3 flex items-center gap-1.5">
          <span className="min-w-0 flex-1 truncate text-xs" title={state.url}>{state.url}</span>
          <Button type="button" variant="outline" size="icon-sm" title={t('oauth.copyLink')} aria-label={t('oauth.copyLink')} onClick={() => void oauthLogin.copyAuthUrl(state.url)}>
            <Copy size={14} aria-hidden="true" />
          </Button>
          <Button type="button" variant="outline" size="icon-sm" title={t('oauth.openLink')} aria-label={t('oauth.openLink')} onClick={() => void oauthLogin.openAuthUrl(state.url)}>
            <ExternalLink size={14} aria-hidden="true" />
          </Button>
          <Button type="button" variant="outline" size="icon-sm" title={t('oauth.refreshLink')} aria-label={t('oauth.refreshLink')} disabled={state.refreshing} onClick={() => void oauthLogin.refreshLoginLink(provider.id)}>
            <RefreshCw size={14} className={state.refreshing ? 'animate-spin' : undefined} aria-hidden="true" />
          </Button>
        </div>
      ) : null}

      {canSubmitCallback ? (
        <div className="mt-3 flex items-center gap-1.5">
          <Input
            value={state.callbackUrl ?? ''}
            onChange={(event) => {
              const value = event.currentTarget.value;
              oauthLogin.updateProviderState(provider.id, {
                callbackUrl: value,
                callbackStatus: undefined,
                callbackError: undefined,
              });
            }}
            placeholder={provider.id === 'xai' ? t('oauth.xaiCallbackPlaceholder') : t('oauth.callbackPlaceholder')}
          />
          <Button type="button" size="icon" disabled={state.callbackSubmitting} title={t('oauth.submitCallback')} aria-label={t('oauth.submitCallback')} onClick={() => void oauthLogin.submitCallback(provider.id)}>
            {state.callbackSubmitting ? <LoaderCircle size={14} className="animate-spin" aria-hidden="true" /> : <Check size={14} aria-hidden="true" />}
          </Button>
        </div>
      ) : null}

      {state.callbackStatus === 'success' && state.status === 'waiting' ? (
        <p className="mt-2 text-xs text-[var(--theme-2f6b3f)]">{t('oauth.callbackSubmitted')}</p>
      ) : null}
      {state.callbackStatus === 'error' ? (
        <p className="mt-2 text-xs text-destructive">{t('oauth.callbackFailed', { detail: state.callbackError ? `: ${state.callbackError}` : '' })}</p>
      ) : null}
      {state.status === 'error' && state.error ? (
        <p className="mt-2 text-xs text-destructive">{state.error}</p>
      ) : null}
    </Card>
  );
}

function QuotaBar({ quota }: { quota: QuotaState }) {
  const { t } = useI18n();
  if (quota.status === 'idle') return <span className="text-xs text-muted-foreground">—</span>;
  if (quota.status === 'loading') {
    return (
      <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
        <LoaderCircle size={13} className="animate-spin" aria-hidden="true" />
        <span>{t('authFiles.quota.loading')}</span>
      </div>
    );
  }
  if (quota.status === 'error') {
    return (
      <Tooltip>
        <TooltipTrigger asChild>
          <span className="text-xs text-destructive underline decoration-dotted underline-offset-2">{t('authFiles.quota.failed')}</span>
        </TooltipTrigger>
        <TooltipContent>{quota.error || t('authFiles.quota.failed')}</TooltipContent>
      </Tooltip>
    );
  }
  const primary = quota.rows
    .filter((row) => row.remainingPercent !== null)
    .sort((left, right) => (left.remainingPercent ?? 0) - (right.remainingPercent ?? 0))[0];
  if (!primary) return <span className="text-xs text-muted-foreground">{t('authFiles.quota.empty')}</span>;
  const percent = Math.max(0, Math.min(100, Math.round(primary.remainingPercent ?? 0)));
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <div className="flex w-40 items-center gap-2">
          <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-muted">
            <div className="h-full rounded-full bg-primary" style={{ width: `${percent}%` }} />
          </div>
          <span className="w-9 shrink-0 text-right text-xs tabular-nums text-muted-foreground">{percent}%</span>
        </div>
      </TooltipTrigger>
      <TooltipContent><AuthFileQuotaSummary quota={quota} /></TooltipContent>
    </Tooltip>
  );
}

function AccountRow({
  file,
  quota,
  manager,
  onResetCodex,
}: {
  file: AuthFile;
  quota: QuotaState;
  manager: ReturnType<typeof useAuthFileManager>;
  onResetCodex?: () => void;
}) {
  const { t } = useI18n();
  const name = fileName(file);
  const disabled = readBoolean(file, 'disabled');
  const unavailable = readBoolean(file, 'unavailable');
  const priority = parseAuthFilePriority(file.priority) ?? 0;
  const icon = providerIcons[providerKey(file)] ?? providerIcons.gemini;
  const canFetchQuota = Boolean(quotaProviderForFile(file));

  return (
    <TableRow className={disabled ? 'opacity-60' : undefined}>
      <TableCell className="whitespace-nowrap">
        <div className="flex items-center gap-2.5">
          <img src={icon} alt="" className="h-6 w-6 shrink-0" />
          <strong className="truncate font-medium" title={name}>{name}</strong>
        </div>
      </TableCell>
      <TableCell className="whitespace-nowrap">
        <div className="flex flex-wrap items-center gap-1.5">
          <Badge variant={disabled || unavailable ? 'destructive' : 'success'}>{statusText(file)}</Badge>
          {isRuntimeOnly(file) ? <Badge variant="outline">{t('authFiles.runtime')}</Badge> : null}
        </div>
      </TableCell>
      <TableCell className="whitespace-nowrap">
        <QuotaBar quota={quota} />
      </TableCell>
      <TableCell className="whitespace-nowrap text-xs text-muted-foreground">
        {quota.status === 'success' ? (quota.rows.find((row) => row.reset)?.reset ?? '—') : '—'}
      </TableCell>
      <TableCell className="whitespace-nowrap text-xs text-muted-foreground">
        <div className="grid gap-0.5">
          <span>{readNumber(file, 'size') === null ? t('authFiles.unknownSize') : `${Math.ceil((readNumber(file, 'size') ?? 0) / 1024)} KB`}</span>
          <span>{formatDate(file.modtime ?? file.updated_at ?? file.last_refresh)}</span>
        </div>
      </TableCell>
      <TableCell className="whitespace-nowrap">
        <div className="grid gap-2">
          <div className="flex flex-wrap items-center gap-1.5">
            {canFetchQuota ? (
              <Button type="button" variant="outline" size="icon-sm" disabled={manager.busy || disabled || quota.status === 'loading'} title={disabled ? t('quota.fileDisabled') : t('quota.refresh')} onClick={() => void manager.refreshQuota(file)}>
                <RefreshCw size={14} className={quota.status === 'loading' ? 'animate-spin' : undefined} aria-hidden="true" />
              </Button>
            ) : null}
            {providerKey(file) ? (
              <Button type="button" variant="outline" size="icon-sm" disabled={manager.busy} title={t('authFiles.models.settings')} aria-label={t('authFiles.models.settings')} onClick={() => void manager.openOauthModels(file)}>
                <Sliders size={14} aria-hidden="true" />
              </Button>
            ) : null}
            <Button type="button" variant="outline" size="icon-sm" disabled={manager.busy} title={t('authFiles.copyName')} aria-label={t('authFiles.copyName')} onClick={() => void manager.copyName(name)}>
              {manager.copied === name ? <Check size={14} aria-hidden="true" /> : <Copy size={14} aria-hidden="true" />}
            </Button>
            <Button type="button" variant="destructive" size="icon-sm" disabled={manager.busy || isRuntimeOnly(file)} title={t('common.delete')} aria-label={t('common.delete')} onClick={() => void manager.deleteFile(file)}>
              <Trash2 size={14} aria-hidden="true" />
            </Button>
          </div>
          <div className="flex flex-wrap items-center gap-1.5">
            <Button type="button" variant="outline" size="sm" disabled={manager.busy} onClick={() => void manager.toggleStatus(file)}>{disabled ? t('common.enable') : t('common.disable')}</Button>
            <Button type="button" variant="outline" size="sm" disabled={manager.busy} title={t('authFiles.priority.hint')} onClick={() => manager.openPriorityEditor(file)}>
              <Pencil size={14} aria-hidden="true" />{t('authFiles.priority.button', { priority: priority ?? 0 })}
            </Button>
            {onResetCodex ? <Button type="button" variant="outline" size="sm" disabled={disabled || quota.status === 'loading'} onClick={onResetCodex}>{t('quota.reset')}</Button> : null}
          </div>
        </div>
      </TableCell>
    </TableRow>
  );
}

function AccountsTable({
  files,
  manager,
  resetCodexQuota,
}: {
  files: AuthFile[];
  manager: ReturnType<typeof useAuthFileManager>;
  resetCodexQuota: (file: AuthFile, quota: QuotaState) => void;
}) {
  const { t } = useI18n();
  return (
    <div className="overflow-hidden rounded-lg border">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>{t('accounts.column.account')}</TableHead>
            <TableHead>{t('accounts.column.status')}</TableHead>
            <TableHead>{t('accounts.column.quota')}</TableHead>
            <TableHead>{t('accounts.column.expiry')}</TableHead>
            <TableHead>{t('accounts.column.updated')}</TableHead>
            <TableHead>{t('accounts.column.actions')}</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {files.map((file) => (
            <AccountRow
              key={quotaKey(file)}
              file={file}
              quota={manager.quotas[quotaKey(file)] ?? idleQuota()}
              manager={manager}
              onResetCodex={quotaProviderForFile(file) === 'codex' && (manager.quotas[quotaKey(file)]?.resetCredits ?? 0) > 0
                ? () => void resetCodexQuota(file, manager.quotas[quotaKey(file)] ?? idleQuota())
                : undefined}
            />
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

export function AccountsPage() {
  const { t, locale } = useI18n();
  const manager = useAuthFileManager();
  const oauthLogin = useOAuthLogin({ onLoginComplete: () => void manager.loadFiles() });

  const [autoRefreshSeconds, setAutoRefreshSeconds] = useState<number>(() => {
    try {
      const stored = Number(window.localStorage.getItem(QUOTA_AUTO_REFRESH_STORAGE_KEY));
      return (QUOTA_AUTO_REFRESH_OPTIONS as readonly number[]).includes(stored) ? stored : 0;
    } catch {
      return 0;
    }
  });

  useEffect(() => {
    try {
      window.localStorage.setItem(QUOTA_AUTO_REFRESH_STORAGE_KEY, String(autoRefreshSeconds));
    } catch {
      // The in-memory state still works when persistent storage is unavailable.
    }
  }, [autoRefreshSeconds]);

  useEffect(() => {
    manager.files.forEach((file) => {
      if (readBoolean(file, 'disabled')) return;
      const state = manager.quotas[quotaKey(file)];
      if (!state || state.status === 'idle') void manager.refreshQuota(file);
    });
  }, [manager.files, manager.quotas, manager.refreshQuota]);

  useEffect(() => {
    if (!autoRefreshSeconds) return;
    const id = window.setInterval(() => {
      manager.files.forEach((file) => {
        if (readBoolean(file, 'disabled')) return;
        void manager.refreshQuota(file);
      });
    }, autoRefreshSeconds * 1000);
    return () => window.clearInterval(id);
  }, [autoRefreshSeconds, manager.files, manager.refreshQuota]);

  const resetCodexQuota = useCallback(async (file: AuthFile, quota: QuotaState) => {
    const confirmed = window.confirm([
      t('quota.confirm.title', { name: fileName(file) }),
      '',
      t('quota.confirm.cost'),
      t('quota.confirm.available', { count: quota.resetCredits ?? '—' }),
      t('quota.confirm.expiry', { time: formatQuotaTimestamp(quota.resetCreditsEarliestExpiry, locale) }),
      '',
      t('quota.confirm.warning'),
    ].join('\n'));
    if (!confirmed) return;
    const key = quotaKey(file);
    const cacheGeneration = captureQuotaCacheGeneration();
    updateQuotaCache((current) => ({ ...current, [key]: { ...current[key], status: 'loading', rows: [] } }));
    try {
      const result = await consumeCodexResetCredit(file);
      commitQuotaCacheIfCurrent(cacheGeneration, () => {
        updateQuotaCache((current) => ({ ...current, [key]: result }));
      });
    } catch (requestError) {
      commitQuotaCacheIfCurrent(cacheGeneration, () => {
        updateQuotaCache((current) => ({
          ...current,
          [key]: {
            status: 'error',
            rows: [],
            error: requestError instanceof Error ? requestError.message : String(requestError),
          },
        }));
      });
    }
  }, [locale, t]);

  const totalCounts = useMemo(() => {
    const counts = new Map<string, number>();
    manager.files.forEach((file) => {
      const key = providerKey(file) || 'other';
      counts.set(key, (counts.get(key) ?? 0) + 1);
    });
    return counts;
  }, [manager.files]);

  const otherCount = manager.files.length - providerOrder.reduce((sum, id) => sum + (totalCounts.get(id) ?? 0), 0);

  const sortedVisibleFiles = useMemo(
    () => manager.visibleFiles.slice().sort((left, right) => fileName(left).localeCompare(fileName(right))),
    [manager.visibleFiles],
  );

  return (
    <section className="grid gap-4">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <span className="block text-xs font-bold uppercase tracking-wide text-muted-foreground">{t('accounts.eyebrow')}</span>
          <h1 className="text-2xl font-bold">{t('accounts.title')}</h1>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm text-muted-foreground">{t('authFiles.summary', { files: manager.files.length, disabled: manager.disabledCount })}</span>
          <Button type="button" variant="outline" size="sm" onClick={() => void manager.loadFiles()} disabled={manager.loading || manager.busy}>
            <RefreshCw size={16} aria-hidden="true" />{t('common.refresh')}
          </Button>
          <Button type="button" variant="outline" size="sm" onClick={() => void manager.openAuthFilesDirectory()} disabled={manager.busy}>
            <FolderOpen size={16} aria-hidden="true" />{t('authFiles.openDirectory')}
          </Button>
          <Button type="button" size="sm" onClick={() => manager.fileInputRef.current?.click()} disabled={manager.busy}>
            <Import size={16} aria-hidden="true" />{t('authFiles.import')}
          </Button>
          <input ref={manager.fileInputRef} type="file" accept=".json,application/json" multiple hidden onChange={(event) => void manager.handleUpload(event)} />
        </div>
      </header>

      {manager.error ? (
        <Alert variant="destructive"><AlertDescription>{manager.error}</AlertDescription></Alert>
      ) : null}
      {manager.notice ? (
        <Alert className="border-[var(--theme-b8d1bb)] bg-[var(--theme-f1f8f1)] text-[var(--theme-2f6b3f)]"><AlertDescription className="text-[var(--theme-2f6b3f)]">{manager.notice}</AlertDescription></Alert>
      ) : null}
      {oauthLogin.notice ? (
        <Alert
          variant={oauthLogin.notice.tone === 'error' ? 'destructive' : 'default'}
          className={oauthLogin.notice.tone === 'success' ? 'border-[var(--theme-b8d1bb)] bg-[var(--theme-f1f8f1)] text-[var(--theme-2f6b3f)]' : undefined}
        >
          <AlertDescription className={oauthLogin.notice.tone === 'success' ? 'text-[var(--theme-2f6b3f)]' : undefined}>{oauthLogin.notice.message}</AlertDescription>
        </Alert>
      ) : null}

      <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 lg:grid-cols-5">
        {providerOrder.map((id) => {
          const meta = oauthProviders.find((item) => item.id === id);
          if (!meta) return null;
          const state = oauthLogin.states[id];
          const count = totalCounts.get(id) ?? 0;
          const loginLabel = state?.status === 'success'
            ? t('oauth.loginAnother')
            : state?.polling
              ? t('oauth.loggingIn')
              : t('oauth.startLogin');
          return (
            <Card key={id} className="gap-2.5 p-3.5">
              <div className="flex items-center gap-2.5">
                <img src={meta.icon} alt="" className="h-8 w-8 shrink-0" />
                <div className="min-w-0 flex-1">
                  <strong className="block truncate text-sm font-semibold">{meta.name}</strong>
                  <span className="text-xs text-muted-foreground">{t(count === 1 ? 'quota.credentials.one' : 'quota.credentials.other', { count })}</span>
                </div>
              </div>
              <div className="flex items-center gap-1.5">
                <Button
                  type="button"
                  size="sm"
                  className="flex-1"
                  disabled={Boolean(state?.polling) || oauthLogin.browsersLoading}
                  onClick={() => void oauthLogin.startLogin(id)}
                >
                  <LogIn size={14} aria-hidden="true" />{loginLabel}
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  size="icon-sm"
                  disabled={count === 0}
                  onClick={() => manager.setProviderFilter(PROVIDER_FILTER_NAME[id] ?? 'all')}
                >
                  <Search size={14} aria-hidden="true" />
                </Button>
              </div>
            </Card>
          );
        })}
        {otherCount > 0 ? (
          <Card className="gap-2.5 p-3.5">
            <div className="flex items-center gap-2.5">
              <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-muted text-muted-foreground"><Layers size={18} aria-hidden="true" /></span>
              <div className="min-w-0 flex-1">
                <strong className="block truncate text-sm font-semibold">{t('accounts.stat.other')}</strong>
                <span className="text-xs text-muted-foreground">{t(otherCount === 1 ? 'quota.credentials.one' : 'quota.credentials.other', { count: otherCount })}</span>
              </div>
            </div>
          </Card>
        ) : null}
      </div>

      {providerOrder.map((id) => {
        const meta = oauthProviders.find((item) => item.id === id);
        const state = oauthLogin.states[id];
        const hasPendingFlow = Boolean(state?.url) || state?.status === 'error';
        if (!meta || !hasPendingFlow) return null;
        return <PendingLoginCard key={id} provider={meta} oauthLogin={oauthLogin} />;
      })}

      <Card className="gap-3 p-4">
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative min-w-56 flex-1">
            <Search size={16} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
            <Input className="pl-8" value={manager.filter} onChange={(event) => manager.setFilter(event.currentTarget.value)} placeholder={t('authFiles.searchPlaceholder')} />
          </div>
          <Select value={manager.providerFilter} onValueChange={manager.setProviderFilter}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">{t('authFiles.filter.allProviders')}</SelectItem>
              {manager.providers.map((provider) => <SelectItem key={provider} value={provider}>{provider}</SelectItem>)}
            </SelectContent>
          </Select>
          <Select value={manager.statusFilter} onValueChange={(value) => manager.setStatusFilter(value as typeof manager.statusFilter)}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">{t('authFiles.filter.allStatuses')}</SelectItem>
              <SelectItem value="enabled">{t('authFiles.filter.enabled')}</SelectItem>
              <SelectItem value="disabled">{t('authFiles.filter.disabled')}</SelectItem>
              <SelectItem value="runtime">{t('authFiles.filter.runtime')}</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="flex flex-wrap items-center gap-2 border-t pt-3">
          <span className="text-sm font-medium">{t('oauth.browser.label')}</span>
          <Select
            value={oauthLogin.selectedBrowser}
            onValueChange={oauthLogin.setSelectedBrowser}
            disabled={oauthLogin.browsersLoading}
          >
            <SelectTrigger className="min-w-52"><SelectValue placeholder={t('oauth.browser.detecting')} /></SelectTrigger>
            <SelectContent>
              {oauthLogin.browsers.map((browser) => (
                <SelectItem value={browser.id} key={browser.id}>
                  {browser.id === 'default' ? t('oauth.browser.systemDefault') : browser.label}
                </SelectItem>
              ))}
              <SelectItem value={NO_AUTO_OPEN_BROWSER_ID}>{t('oauth.browser.noAutoOpen')}</SelectItem>
            </SelectContent>
          </Select>
          <span className="text-xs text-muted-foreground">{t('oauth.browser.remembered')}</span>
        </div>
        <div className="flex flex-wrap items-center gap-2 border-t pt-3">
          <span className="text-sm font-medium">{t('accounts.autoRefresh.label')}</span>
          <Select value={String(autoRefreshSeconds)} onValueChange={(value) => setAutoRefreshSeconds(Number(value))}>
            <SelectTrigger className="min-w-40"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="0">{t('accounts.autoRefresh.off')}</SelectItem>
              <SelectItem value="15">{t('accounts.autoRefresh.15s')}</SelectItem>
              <SelectItem value="30">{t('accounts.autoRefresh.30s')}</SelectItem>
              <SelectItem value="60">{t('accounts.autoRefresh.60s')}</SelectItem>
              <SelectItem value="300">{t('accounts.autoRefresh.300s')}</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </Card>

      {manager.loading ? (
        <div className="flex items-center gap-2 text-sm text-muted-foreground"><LoaderCircle size={20} className="animate-spin" aria-hidden="true" />{t('authFiles.loading')}</div>
      ) : sortedVisibleFiles.length === 0 ? (
        <div className="rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">{t('accounts.panel.empty')}</div>
      ) : (
        <AccountsTable files={sortedVisibleFiles} manager={manager} resetCodexQuota={resetCodexQuota} />
      )}

      {manager.priorityEditor ? (
        <PriorityEditorDialog
          editor={manager.priorityEditor}
          busy={manager.busy}
          onChange={manager.updatePriorityDraft}
          onClose={manager.closePriorityEditor}
          onSave={() => void manager.savePriority()}
        />
      ) : null}

      {manager.oauthModelProvider ? <OauthModelDialog manager={manager} /> : null}
    </section>
  );
}
