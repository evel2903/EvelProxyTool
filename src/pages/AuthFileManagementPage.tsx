import { ChangeEvent, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Check,
  LoaderCircle,
  Pencil,
  Search,
} from 'lucide-react';
import antigravityIcon from '../assets/icons/antigravity.svg';
import claudeIcon from '../assets/icons/claude.svg';
import codexIcon from '../assets/icons/codex.svg';
import geminiIcon from '../assets/icons/gemini.svg';
import grokIcon from '../assets/icons/grok.svg';
import kimiIcon from '../assets/icons/kimi-light.svg';
import vertexIcon from '../assets/icons/vertex.svg';
import {
  formatQuotaTimestamp,
  idleQuota,
  loadQuota,
  providerForFile as quotaProviderForFile,
  quotaKey,
  type QuotaState,
} from '../services/quotaService';
import {
  captureQuotaCacheGeneration,
  commitQuotaCacheIfCurrent,
  pruneQuotaCache,
  updateQuotaCache,
  useQuotaCache,
} from '../services/quotaCache';
import {
  managementApi,
  readBoolean,
  readString,
  responseList,
} from '../services/managementApi';
import {
  authFileName,
  dedupeAuthFiles,
  isRuntimeOnlyAuthFile,
  normalizeAuthFilePriorityInput,
  parseAuthFilePriority,
} from '../services/authFiles';
import {
  exclusionsForOpenOAuthModels,
  oauthExcludedRulesFromPayload,
  oauthModelsFromPayload,
  openOAuthModelNames,
  type OAuthModelDefinition,
} from '../services/oauthModels';
import { getCurrentLocale, translate, useI18n } from '../i18n';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Progress } from '@/components/ui/progress';

export type AuthFile = Record<string, unknown>;

type PriorityEditor = {
  fileName: string;
  originalPriority: number;
  value: string;
  error: string;
};

export const providerIcons: Record<string, string> = {
  antigravity: antigravityIcon,
  claude: claudeIcon,
  codex: codexIcon,
  gemini: geminiIcon,
  kimi: kimiIcon,
  vertex: vertexIcon,
  xai: grokIcon,
};

export const providerName = (file: AuthFile) => {
  const value = readString(file, 'provider', 'type', 'account_type').toLowerCase();
  if (value === 'anthropic') return 'Claude';
  if (value === 'anti-gravity') return 'Antigravity';
  if (value === 'xai') return 'xAI';
  return value ? value.charAt(0).toUpperCase() + value.slice(1) : translate(getCurrentLocale(), 'authFiles.unknownProvider');
};

export const providerKey = (file: AuthFile) => {
  const value = readString(file, 'provider', 'type', 'account_type').toLowerCase();
  return value === 'anthropic' ? 'claude' : value === 'anti-gravity' ? 'antigravity' : value;
};

export const fileName = authFileName;

export const isRuntimeOnly = isRuntimeOnlyAuthFile;

export const statusText = (file: AuthFile) => {
  if (readBoolean(file, 'disabled')) return translate(getCurrentLocale(), 'authFiles.status.disabled');
  if (readBoolean(file, 'unavailable')) return translate(getCurrentLocale(), 'authFiles.status.unavailable');
  return readString(file, 'status') || translate(getCurrentLocale(), 'authFiles.status.ready');
};

export function AuthFileQuotaSummary({ quota }: { quota: QuotaState }) {
  const { locale, t } = useI18n();
  if (quota.status === 'loading') {
    return (
      <div className="flex items-center gap-1.5 text-xs text-muted-foreground p-1">
        <LoaderCircle size={13} className="animate-spin text-primary" />
        <span>{t('authFiles.quota.loading')}</span>
      </div>
    );
  }
  if (quota.status === 'error') {
    return (
      <div className="flex flex-col gap-1 text-xs p-1" title={quota.error}>
        <span className="text-destructive font-semibold">{t('authFiles.quota.failed')}</span>
        {quota.error ? <span className="max-w-[240px] truncate text-muted-foreground text-[11px]">{quota.error}</span> : null}
      </div>
    );
  }
  if (quota.status !== 'success') return null;

  return (
    <div className="flex w-64 flex-col gap-2.5 p-1" aria-label={t('authFiles.quota.aria')}>
      {quota.plan ? (
        <div className="flex items-center justify-between border-b border-border/40 pb-2">
          <span className="inline-flex items-center rounded-full bg-primary/10 border border-primary/20 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-primary">
            {quota.plan}
          </span>
          {quota.resetCredits !== undefined && quota.resetCredits > 0 ? (
            <span className="text-[10px] text-emerald-500 font-bold">
              {t('authFiles.quota.resets', { count: quota.resetCredits })}
            </span>
          ) : null}
        </div>
      ) : null}
      {quota.rows.length > 0 ? (
        <div className="flex flex-col gap-2">
          {quota.rows.map((row, index) => {
            const percent = row.remainingPercent !== null ? Math.round(row.remainingPercent) : null;
            const variant = percent !== null ? (percent < 15 ? 'danger' : percent < 50 ? 'warning' : 'success') : 'default';
            return (
              <div key={`${row.label}-${index}`} className="space-y-1">
                <div className="flex items-baseline justify-between gap-2 text-xs">
                  <span className="text-[11px] font-medium text-foreground/80 truncate">
                    {[row.label, row.detail].filter(Boolean).join(' · ')}
                  </span>
                  <span className="flex shrink-0 items-baseline gap-1">
                    <strong className={cn('text-xs font-bold font-mono', percent !== null ? (percent < 15 ? 'text-rose-500' : percent < 50 ? 'text-amber-500' : 'text-emerald-500') : 'text-foreground')}>
                      {percent === null ? '—' : `${percent}%`}
                    </strong>
                    {row.reset ? <span className="text-[10px] text-muted-foreground font-mono">({row.reset})</span> : null}
                  </span>
                </div>
                {percent !== null && (
                  <Progress value={percent} variant={variant} className="h-1" />
                )}
              </div>
            );
          })}
        </div>
      ) : (
        <span className="text-xs text-muted-foreground">{t('authFiles.quota.empty')}</span>
      )}
      {quota.resetCredits !== undefined || quota.resetCreditsEarliestExpiry ? (
        <div className="flex flex-col gap-0.5 border-t border-border/40 pt-2 text-[10px] text-muted-foreground font-mono">
          {quota.resetCreditsEarliestExpiry ? (
            <span>{t('authFiles.quota.expiry', { time: formatQuotaTimestamp(quota.resetCreditsEarliestExpiry, locale) })}</span>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function quotaSeverityClass(percent: number | null) {
  if (percent === null) return 'text-background';
  if (percent < 15) return 'text-red-400 dark:text-red-600';
  if (percent < 50) return 'text-amber-400 dark:text-amber-600';
  return 'text-background';
}

export function useAuthFileManager() {
  const { t } = useI18n();
  const [files, setFiles] = useState<AuthFile[]>([]);
  const [filter, setFilter] = useState('');
  const [providerFilter, setProviderFilter] = useState('all');
  const [statusFilter, setStatusFilter] = useState<'all' | 'enabled' | 'disabled' | 'runtime'>('all');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [copied, setCopied] = useState('');
  const [priorityEditor, setPriorityEditor] = useState<PriorityEditor | null>(null);
  const [oauthModelProvider, setOauthModelProvider] = useState('');
  const [oauthModelProviderLabel, setOauthModelProviderLabel] = useState('');
  const [oauthModels, setOauthModels] = useState<OAuthModelDefinition[]>([]);
  const [oauthExcludedRules, setOauthExcludedRules] = useState<string[]>([]);
  const [openOauthModelNames, setOpenOauthModelNames] = useState<Set<string>>(new Set());
  const [oauthModelSearch, setOauthModelSearch] = useState('');
  const [oauthModelLoading, setOauthModelLoading] = useState(false);
  const [oauthModelSaving, setOauthModelSaving] = useState(false);
  const [oauthModelError, setOauthModelError] = useState('');
  const quotas = useQuotaCache();
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const oauthModelRequestRef = useRef(0);

  const loadFiles = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const payload = await managementApi.get('/auth-files');
      const nextFiles = dedupeAuthFiles(responseList(payload, 'files'));
      setFiles(nextFiles);
      const validQuotaKeys = new Set(nextFiles.map(quotaKey));
      pruneQuotaCache(validQuotaKeys);
      updateQuotaCache((current) => {
        const next = { ...current };
        nextFiles.forEach((file) => {
          const key = quotaKey(file);
          if (!next[key]) next[key] = idleQuota();
        });
        return next;
      });
    } catch (requestError) {
      setError(String(requestError));
    } finally {
      setLoading(false);
    }
  }, []);

  const refreshQuota = useCallback(async (file: AuthFile) => {
    if (readBoolean(file, 'disabled')) return;
    const key = quotaKey(file);
    const cacheGeneration = captureQuotaCacheGeneration();
    updateQuotaCache((current) => ({ ...current, [key]: { status: 'loading', rows: [] } }));
    const result = await loadQuota(file);
    commitQuotaCacheIfCurrent(cacheGeneration, () => {
      updateQuotaCache((current) => ({ ...current, [key]: result }));
    });
  }, []);

  const closeOauthModels = useCallback(() => {
    oauthModelRequestRef.current += 1;
    setOauthModelProvider('');
  }, []);

  const openOauthModels = useCallback(async (file: AuthFile) => {
    const provider = providerKey(file);
    if (!provider) return;
    const requestId = oauthModelRequestRef.current + 1;
    oauthModelRequestRef.current = requestId;
    setOauthModelProvider(provider);
    setOauthModelProviderLabel(providerName(file));
    setOauthModels([]);
    setOauthExcludedRules([]);
    setOpenOauthModelNames(new Set());
    setOauthModelSearch('');
    setOauthModelError('');
    setOauthModelLoading(true);
    try {
      const [definitionsPayload, excludedPayload] = await Promise.all([
        managementApi.get(`/model-definitions/${encodeURIComponent(provider)}`),
        managementApi.get('/oauth-excluded-models'),
      ]);
      if (oauthModelRequestRef.current !== requestId) return;
      const models = oauthModelsFromPayload(definitionsPayload);
      const excludedRules = oauthExcludedRulesFromPayload(excludedPayload, provider);
      setOauthModels(models);
      setOauthExcludedRules(excludedRules);
      setOpenOauthModelNames(openOAuthModelNames(models, excludedRules));
      if (models.length === 0) setOauthModelError(t('authFiles.models.noneForProvider'));
    } catch (requestError) {
      if (oauthModelRequestRef.current === requestId) setOauthModelError(String(requestError));
    } finally {
      if (oauthModelRequestRef.current === requestId) setOauthModelLoading(false);
    }
  }, [t]);

  const saveOauthModels = useCallback(async () => {
    if (!oauthModelProvider) return;
    const excludedModels = exclusionsForOpenOAuthModels(
      oauthExcludedRules,
      oauthModels,
      openOauthModelNames,
    );
    setOauthModelSaving(true);
    setOauthModelError('');
    try {
      if (excludedModels.length > 0 || oauthExcludedRules.length > 0) {
        await managementApi.patch('/oauth-excluded-models', {
          provider: oauthModelProvider,
          models: excludedModels,
        });
      }
      setNotice(t('authFiles.models.updated', { provider: oauthModelProviderLabel }));
      closeOauthModels();
    } catch (requestError) {
      setOauthModelError(String(requestError));
    } finally {
      setOauthModelSaving(false);
    }
  }, [closeOauthModels, oauthExcludedRules, oauthModelProvider, oauthModelProviderLabel, oauthModels, openOauthModelNames, t]);

  const visibleOauthModels = useMemo(() => {
    const query = oauthModelSearch.trim().toLowerCase();
    if (!query) return oauthModels;
    return oauthModels.filter((model) =>
      `${model.id} ${model.displayName ?? ''}`.toLowerCase().includes(query),
    );
  }, [oauthModelSearch, oauthModels]);

  const allVisibleOauthModelsOpen = visibleOauthModels.length > 0
    && visibleOauthModels.every((model) => openOauthModelNames.has(model.id.toLowerCase()));

  const toggleOauthModel = useCallback((model: OAuthModelDefinition) => {
    const key = model.id.toLowerCase();
    setOpenOauthModelNames((current) => {
      const next = new Set(current);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }, []);

  const toggleAllVisibleOauthModels = useCallback(() => {
    setOpenOauthModelNames((current) => {
      const next = new Set(current);
      visibleOauthModels.forEach((model) => {
        const key = model.id.toLowerCase();
        if (allVisibleOauthModelsOpen) next.delete(key);
        else next.add(key);
      });
      return next;
    });
  }, [allVisibleOauthModelsOpen, visibleOauthModels]);

  useEffect(() => {
    void loadFiles();
  }, [loadFiles]);

  const providers = useMemo(
    () => Array.from(new Set(files.map(providerName))).sort((left, right) => left.localeCompare(right)),
    [files],
  );

  const visibleFiles = useMemo(() => {
    const query = filter.trim().toLowerCase();
    return files.filter((file) => {
      const providerMatch = providerFilter === 'all' || providerName(file) === providerFilter;
      const disabled = readBoolean(file, 'disabled');
      const runtimeMatch =
        statusFilter === 'all' ||
        (statusFilter === 'disabled' && disabled) ||
        (statusFilter === 'enabled' && !disabled) ||
        (statusFilter === 'runtime' && isRuntimeOnly(file));
      const searchMatch =
        !query ||
        [fileName(file), providerName(file), readString(file, 'email', 'account', 'label')]
          .join(' ')
          .toLowerCase()
          .includes(query);
      return providerMatch && runtimeMatch && searchMatch;
    });
  }, [files, filter, providerFilter, statusFilter]);

  const handleUpload = useCallback(async (event: ChangeEvent<HTMLInputElement>) => {
    const selected = Array.from(event.currentTarget.files ?? []);
    event.currentTarget.value = '';
    if (selected.length === 0) return;
    setBusy(true);
    setError('');
    let uploaded = 0;
    const failures: string[] = [];
    for (const file of selected) {
      try {
        await managementApi.uploadAuthFile(file);
        uploaded += 1;
      } catch (requestError) {
        failures.push(`${file.name}：${String(requestError)}`);
      }
    }
    try {
      await loadFiles();
      if (uploaded > 0) setNotice(t('authFiles.uploaded', { count: uploaded }));
      if (failures.length > 0) setError(t('authFiles.uploadFailed', { count: failures.length, errors: failures.join('; ') }));
    } catch (requestError) {
      setError(String(requestError));
    } finally {
      setBusy(false);
    }
  }, [loadFiles, t]);

  const toggleStatus = useCallback(async (file: AuthFile) => {
    const name = fileName(file);
    setBusy(true);
    setError('');
    try {
      await managementApi.patch('/auth-files/status', {
        name,
        disabled: !readBoolean(file, 'disabled'),
      });
      setNotice(readBoolean(file, 'disabled') ? t('authFiles.notice.enabled') : t('authFiles.notice.disabled'));
      await loadFiles();
    } catch (requestError) {
      setError(String(requestError));
    } finally {
      setBusy(false);
    }
  }, [loadFiles, t]);

  const openPriorityEditor = useCallback((file: AuthFile) => {
    const priority = parseAuthFilePriority(file.priority);
    setPriorityEditor({
      fileName: fileName(file),
      originalPriority: priority ?? 0,
      value: priority === undefined || priority === 0 ? '' : String(priority),
      error: '',
    });
  }, []);

  const closePriorityEditor = useCallback(() => {
    setPriorityEditor((current) => (busy ? current : null));
  }, [busy]);

  const updatePriorityDraft = useCallback((value: string) => {
    setPriorityEditor((current) => (current ? { ...current, value, error: '' } : current));
  }, []);

  const savePriority = useCallback(async () => {
    if (!priorityEditor || busy) return;
    const priority = normalizeAuthFilePriorityInput(priorityEditor.value);
    if (priority === null) {
      setPriorityEditor((current) => current
        ? { ...current, error: t('authFiles.priority.invalid') }
        : current);
      return;
    }
    if (priority === priorityEditor.originalPriority) {
      setPriorityEditor(null);
      return;
    }

    const name = priorityEditor.fileName;
    setBusy(true);
    setError('');
    try {
      await managementApi.patch('/auth-files/fields', { name, priority });
      setPriorityEditor(null);
      setNotice(t('authFiles.priority.updated', { name }));
      await loadFiles();
    } catch (requestError) {
      setPriorityEditor((current) => current
        ? { ...current, error: String(requestError) }
        : current);
    } finally {
      setBusy(false);
    }
  }, [busy, loadFiles, priorityEditor, t]);

  const deleteFile = useCallback(async (file: AuthFile) => {
    const name = fileName(file);
    if (isRuntimeOnly(file)) {
      setError(t('authFiles.runtimeDeleteError'));
      return;
    }
    if (!window.confirm(t('authFiles.deleteConfirm', { name }))) return;
    setBusy(true);
    setError('');
    try {
      await managementApi.delete('/auth-files', { query: { name } });
      setNotice(t('authFiles.deleted'));
      await loadFiles();
    } catch (requestError) {
      setError(String(requestError));
    } finally {
      setBusy(false);
    }
  }, [loadFiles, t]);

  const openAuthFilesDirectory = useCallback(async () => {
    setBusy(true);
    setError('');
    try {
      await managementApi.openAuthFilesDirectory();
    } catch (requestError) {
      setError(String(requestError));
    } finally {
      setBusy(false);
    }
  }, []);

  const copyName = useCallback(async (name: string) => {
    try {
      await navigator.clipboard.writeText(name);
      setCopied(name);
      window.setTimeout(() => setCopied((current) => (current === name ? '' : current)), 1500);
    } catch {
      setError(t('common.copyFailed'));
    }
  }, [t]);

  const disabledCount = useMemo(() => files.filter((file) => readBoolean(file, 'disabled')).length, [files]);
  const runtimeCount = useMemo(() => files.filter(isRuntimeOnly).length, [files]);

  return {
    files,
    filter,
    setFilter,
    providerFilter,
    setProviderFilter,
    statusFilter,
    setStatusFilter,
    loading,
    busy,
    error,
    notice,
    copied,
    quotas,
    fileInputRef,
    loadFiles,
    refreshQuota,
    handleUpload,
    toggleStatus,
    deleteFile,
    openAuthFilesDirectory,
    copyName,
    providers,
    visibleFiles,
    disabledCount,
    runtimeCount,
    priorityEditor,
    openPriorityEditor,
    closePriorityEditor,
    updatePriorityDraft,
    savePriority,
    oauthModelProvider,
    oauthModelProviderLabel,
    oauthModels,
    visibleOauthModels,
    allVisibleOauthModelsOpen,
    openOauthModelNames,
    oauthModelSearch,
    setOauthModelSearch,
    oauthModelLoading,
    oauthModelSaving,
    oauthModelError,
    openOauthModels,
    closeOauthModels,
    saveOauthModels,
    toggleOauthModel,
    toggleAllVisibleOauthModels,
    setOpenOauthModelNames,
  };
}

export type AuthFileManager = ReturnType<typeof useAuthFileManager>;

export function PriorityEditorDialog({
  editor,
  busy,
  onChange,
  onClose,
  onSave,
}: {
  editor: PriorityEditor;
  busy: boolean;
  onChange: (value: string) => void;
  onClose: () => void;
  onSave: () => void;
}) {
  const { t } = useI18n();
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-sm">
        <form
          onSubmit={(event) => {
            event.preventDefault();
            onSave();
          }}
        >
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2"><Pencil size={16} aria-hidden="true" />{t('authFiles.priority.title')}</DialogTitle>
          </DialogHeader>
          <div className="mt-3 truncate text-sm text-muted-foreground" title={editor.fileName}>{editor.fileName}</div>
          <label className="mt-3 grid gap-1.5 text-sm" htmlFor="auth-file-priority-input">
            <span className="font-medium">{t('authFiles.priority.label')}</span>
            <Input
              id="auth-file-priority-input"
              autoFocus
              type="text"
              inputMode="numeric"
              value={editor.value}
              placeholder={t('authFiles.priority.placeholder')}
              disabled={busy}
              aria-invalid={Boolean(editor.error)}
              onChange={(event) => onChange(event.currentTarget.value)}
            />
            <span className="text-xs text-muted-foreground">{t('authFiles.priority.hint')}</span>
          </label>
          {editor.error ? <p className="mt-2 text-xs text-destructive" role="alert">{editor.error}</p> : null}
          <DialogFooter className="mt-4">
            <Button type="button" variant="outline" onClick={onClose} disabled={busy}>{t('common.cancel')}</Button>
            <Button type="submit" disabled={busy}>
              {busy ? <LoaderCircle size={16} className="animate-spin" aria-hidden="true" /> : <Check size={16} aria-hidden="true" />}
              {busy ? t('common.saving') : t('common.save')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function OauthModelDialog({ manager }: { manager: AuthFileManager }) {
  const { t } = useI18n();
  const {
    oauthModelProviderLabel,
    oauthModelSearch,
    setOauthModelSearch,
    oauthModels,
    visibleOauthModels,
    allVisibleOauthModelsOpen,
    openOauthModelNames,
    oauthModelLoading,
    oauthModelSaving,
    oauthModelError,
    closeOauthModels,
    saveOauthModels,
    toggleOauthModel,
    toggleAllVisibleOauthModels,
    setOpenOauthModelNames,
  } = manager;

  return (
    <Dialog open onOpenChange={(open) => !open && !oauthModelSaving && closeOauthModels()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{t('authFiles.models.title')}</DialogTitle>
          <DialogDescription>{t('authFiles.models.description', { provider: oauthModelProviderLabel })}</DialogDescription>
        </DialogHeader>

        <div className="relative">
          <Search size={16} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
          <Input className="pl-8" value={oauthModelSearch} onChange={(event) => setOauthModelSearch(event.currentTarget.value)} placeholder={t('authFiles.models.search')} />
        </div>

        <div className="flex items-center justify-between gap-2 text-sm">
          <span className="text-muted-foreground">{t('authFiles.models.summary', { total: oauthModels.length, open: openOauthModelNames.size })}</span>
          <div className="flex gap-2">
            <Button type="button" variant="outline" size="sm" onClick={toggleAllVisibleOauthModels} disabled={oauthModelLoading || visibleOauthModels.length === 0}>{allVisibleOauthModelsOpen ? t('authFiles.models.closeVisible') : t('authFiles.models.openVisible')}</Button>
            <Button type="button" variant="outline" size="sm" onClick={() => setOpenOauthModelNames(new Set(oauthModels.map((model) => model.id.toLowerCase())))} disabled={oauthModelLoading || oauthModels.length === 0 || openOauthModelNames.size === oauthModels.length}>{t('authFiles.models.openAll')}</Button>
            <Button type="button" variant="outline" size="sm" onClick={() => setOpenOauthModelNames(new Set())} disabled={oauthModelLoading || openOauthModelNames.size === 0}>{t('authFiles.models.closeAll')}</Button>
          </div>
        </div>

        <div className="max-h-80 overflow-y-auto rounded-lg border">
          {oauthModelLoading ? (
            <div className="flex items-center gap-2 p-4 text-sm text-muted-foreground"><LoaderCircle size={20} className="animate-spin" aria-hidden="true" />{t('authFiles.models.loading')}</div>
          ) : oauthModelError ? (
            <div className="p-4 text-sm"><strong className="block text-destructive">{t('authFiles.models.loadFailed')}</strong><span className="text-muted-foreground">{oauthModelError}</span></div>
          ) : visibleOauthModels.length === 0 ? (
            <div className="p-4 text-sm text-muted-foreground">{oauthModels.length ? t('authFiles.models.noMatch') : t('authFiles.models.empty')}</div>
          ) : (
            <div className="divide-y">
              {visibleOauthModels.map((model) => {
                const checked = openOauthModelNames.has(model.id.toLowerCase());
                return (
                  <label key={model.id} className={cn('flex cursor-pointer items-center gap-2.5 px-3 py-2 text-sm hover:bg-muted/50', checked && 'bg-accent/40')}>
                    <Checkbox checked={checked} onCheckedChange={() => toggleOauthModel(model)} />
                    <span className="flex min-w-0 flex-col">
                      <strong className="truncate font-medium" title={model.id}>{model.id}</strong>
                      {model.displayName ? <span className="truncate text-xs text-muted-foreground" title={model.displayName}>{model.displayName}</span> : null}
                    </span>
                  </label>
                );
              })}
            </div>
          )}
        </div>

        <DialogFooter>
          <Button type="button" variant="outline" onClick={closeOauthModels} disabled={oauthModelSaving}>{t('common.cancel')}</Button>
          <Button type="button" onClick={() => void saveOauthModels()} disabled={oauthModelLoading || oauthModelSaving || oauthModels.length === 0}>{oauthModelSaving ? t('common.saving') : t('authFiles.models.save', { count: openOauthModelNames.size })}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// Re-exported for callers that only need quota helpers alongside auth files.
export { quotaProviderForFile, quotaKey, idleQuota };
