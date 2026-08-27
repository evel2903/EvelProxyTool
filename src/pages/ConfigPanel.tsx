import { FormEvent, useEffect, useRef, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import {
  AlertCircle,
  Check,
  Copy,
  Clock3,
  Eye,
  EyeOff,
  KeyRound,
  Link2,
  Network,
  Pencil,
  Plus,
  RefreshCw,
  Route,
  Settings2,
  ShieldCheck,
  Sparkles,
  Power,
  Trash2,
  X,
} from 'lucide-react';
import { useCoreRuntime, type CoreStatus } from '../coreRuntime';
import { useI18n } from '../i18n';
import { webUiManagementUrl } from '../services/clientAccess';
import { ThinkingAliasesPage } from './ThinkingAliasesPage';
import { cn } from '@/lib/utils';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';

type CoreConfigSettings = {
  apiKeys: CoreApiKey[];
  managementSecretConfigured: boolean;
  port: number;
  allowLan: boolean;
  routingStrategy: string;
  proxyUrl: string;
  routingSessionAffinity: boolean;
  routingSessionAffinityTtl: string;
  requestRetry: number;
  maxRetryCredentials: number;
  maxRetryInterval: number;
  streamingBootstrapRetries: number;
};

type CoreApiKey = {
  apiKey: string;
  remark: string;
};

type ConfigAction =
  | 'add-key'
  | 'update-key'
  | 'delete-key'
  | 'management-secret'
  | 'routing'
  | 'network'
  | 'software'
  | null;
type NoticeTone = 'success' | 'error';
type ConfigSubpage = 'general' | 'network' | 'software' | 'aliases';
type CloseBehavior = 'ask' | 'exit' | 'minimize-to-tray';
type NetworkDraftField =
  | 'port'
  | 'allowLan'
  | 'proxyUrl'
  | 'sessionAffinity'
  | 'sessionTtl'
  | 'requestRetry'
  | 'maxRetryCredentials'
  | 'maxRetryInterval'
  | 'streamingBootstrapRetries';
type DraftRefreshMode = 'replace' | 'preserve';

type NetworkDraftDirty = Record<NetworkDraftField, boolean>;

type SoftwareSettings = {
  closeBehavior: CloseBehavior;
  autostartEnabled: boolean;
  startCoreOnLaunch: boolean;
  silentStartEnabled: boolean;
};

const cleanNetworkDraft = (): NetworkDraftDirty => ({
  port: false,
  allowLan: false,
  proxyUrl: false,
  sessionAffinity: false,
  sessionTtl: false,
  requestRetry: false,
  maxRetryCredentials: false,
  maxRetryInterval: false,
  streamingBootstrapRetries: false,
});

const ROUTING_OPTIONS = [
  { value: 'round-robin', labelKey: 'config.routing.roundRobin' },
  { value: 'fill-first', labelKey: 'config.routing.fillFirst' },
] as const;

function ConfigSwitch({
  checked,
  disabled,
  label,
  onChange,
}: {
  checked: boolean;
  disabled?: boolean;
  label: string;
  onChange: (checked: boolean) => void;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      title={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={cn(
        'relative h-[21px] w-[38px] shrink-0 rounded-full border transition-colors disabled:opacity-50',
        checked ? 'border-primary bg-primary' : 'border-input bg-muted',
      )}
    >
      <span
        className={cn(
          'absolute top-[2px] size-[15px] rounded-full bg-card shadow transition-[left]',
          checked ? 'left-[19px]' : 'left-[2px]',
        )}
      />
    </button>
  );
}

export function ConfigPanelPage() {
  const { t } = useI18n();
  const { status: coreStatus, publishStatus, refreshStatus } = useCoreRuntime();
  const [settings, setSettings] = useState<CoreConfigSettings | null>(null);
  const [softwareSettings, setSoftwareSettings] = useState<SoftwareSettings | null>(null);
  const [softwareSettingsLoading, setSoftwareSettingsLoading] = useState(true);
  const [softwareCloseBehaviorDraft, setSoftwareCloseBehaviorDraft] = useState<CloseBehavior>('ask');
  const [softwareAutostartDraft, setSoftwareAutostartDraft] = useState(false);
  const [softwareStartCoreDraft, setSoftwareStartCoreDraft] = useState(true);
  const [softwareSilentStartDraft, setSoftwareSilentStartDraft] = useState(false);
  const [softwareSavedStatusVisible, setSoftwareSavedStatusVisible] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [busyAction, setBusyAction] = useState<ConfigAction>(null);
  const [addDialogOpen, setAddDialogOpen] = useState(false);
  const [editingApiKey, setEditingApiKey] = useState<string | null>(null);
  const [deleteIndex, setDeleteIndex] = useState<number | null>(null);
  const [newApiKey, setNewApiKey] = useState('');
  const [newApiKeyRemark, setNewApiKeyRemark] = useState('');
  const [showApiKey, setShowApiKey] = useState(false);
  const [formError, setFormError] = useState('');
  const [managementSecretDraft, setManagementSecretDraft] = useState('');
  const [managementSecretConfirm, setManagementSecretConfirm] = useState('');
  const [showManagementSecret, setShowManagementSecret] = useState(false);
  const [managementSecretError, setManagementSecretError] = useState('');
  const [copiedIndex, setCopiedIndex] = useState<number | null>(null);
  const [notice, setNotice] = useState<{ message: string; tone: NoticeTone } | null>(null);
  const [activeSubpage, setActiveSubpage] = useState<ConfigSubpage>('general');
  const [portDraft, setPortDraft] = useState('8317');
  const [allowLanDraft, setAllowLanDraft] = useState(false);
  const [proxyUrlDraft, setProxyUrlDraft] = useState('');
  const [sessionAffinityDraft, setSessionAffinityDraft] = useState(false);
  const [sessionTtlDraft, setSessionTtlDraft] = useState('');
  const [requestRetryDraft, setRequestRetryDraft] = useState('3');
  const [maxRetryCredentialsDraft, setMaxRetryCredentialsDraft] = useState('0');
  const [maxRetryIntervalDraft, setMaxRetryIntervalDraft] = useState('30');
  const [streamingBootstrapRetriesDraft, setStreamingBootstrapRetriesDraft] = useState('0');
  const [portError, setPortError] = useState('');
  const [retryError, setRetryError] = useState('');
  const [savedStatusVisible, setSavedStatusVisible] = useState(false);
  const networkDraftDirtyRef = useRef<NetworkDraftDirty>(cleanNetworkDraft());
  const noticeTimerRef = useRef<number | null>(null);
  const copyTimerRef = useRef<number | null>(null);

  useEffect(() => {
    let disposed = false;
    let stop: (() => void) | null = null;
    void loadSettings();
    void loadSoftwareSettings();
    void listen('config-files-changed', () => {
      if (!disposed) {
        void loadSettings('preserve');
        void loadSoftwareSettings();
      }
    }).then((unlisten) => {
      if (disposed) unlisten();
      else stop = unlisten;
    });
    return () => {
      disposed = true;
      stop?.();
      if (noticeTimerRef.current !== null) {
        window.clearTimeout(noticeTimerRef.current);
      }
      if (copyTimerRef.current !== null) {
        window.clearTimeout(copyTimerRef.current);
      }
    };
  }, []);

  const showNotice = (message: string, tone: NoticeTone) => {
    if (noticeTimerRef.current !== null) {
      window.clearTimeout(noticeTimerRef.current);
    }
    setNotice({ message, tone });
    noticeTimerRef.current = window.setTimeout(() => {
      setNotice(null);
      noticeTimerRef.current = null;
    }, 3200);
  };

  const applySettings = (result: CoreConfigSettings, mode: DraftRefreshMode = 'replace') => {
    setSettings(result);
    if (mode === 'preserve') {
      const dirty = networkDraftDirtyRef.current;
      if (!dirty.port) setPortDraft(String(result.port));
      if (!dirty.allowLan) setAllowLanDraft(result.allowLan);
      if (!dirty.proxyUrl) setProxyUrlDraft(result.proxyUrl);
      if (!dirty.sessionAffinity) setSessionAffinityDraft(result.routingSessionAffinity);
      if (!dirty.sessionTtl) setSessionTtlDraft(result.routingSessionAffinityTtl);
      if (!dirty.requestRetry) setRequestRetryDraft(String(result.requestRetry));
      if (!dirty.maxRetryCredentials) setMaxRetryCredentialsDraft(String(result.maxRetryCredentials));
      if (!dirty.maxRetryInterval) setMaxRetryIntervalDraft(String(result.maxRetryInterval));
      if (!dirty.streamingBootstrapRetries) {
        setStreamingBootstrapRetriesDraft(String(result.streamingBootstrapRetries));
      }
      return;
    }
    networkDraftDirtyRef.current = cleanNetworkDraft();
    setPortDraft(String(result.port));
    setAllowLanDraft(result.allowLan);
    setProxyUrlDraft(result.proxyUrl);
    setSessionAffinityDraft(result.routingSessionAffinity);
    setSessionTtlDraft(result.routingSessionAffinityTtl);
    setRequestRetryDraft(String(result.requestRetry));
    setMaxRetryCredentialsDraft(String(result.maxRetryCredentials));
    setMaxRetryIntervalDraft(String(result.maxRetryInterval));
    setStreamingBootstrapRetriesDraft(String(result.streamingBootstrapRetries));
    setPortError('');
    setRetryError('');
  };

  const markDraftDirty = (field: NetworkDraftField) => {
    networkDraftDirtyRef.current[field] = true;
    setSavedStatusVisible(false);
  };

  const clearDraftDirty = (field: NetworkDraftField) => {
    networkDraftDirtyRef.current[field] = false;
  };

  async function loadSettings(mode: DraftRefreshMode = 'replace') {
    setLoading(true);
    setLoadError('');
    try {
      const result = await invoke<CoreConfigSettings>('get_core_config_settings');
      applySettings(result, mode);
    } catch (error) {
      setSettings(null);
      setLoadError(String(error));
    } finally {
      setLoading(false);
    }
  }

  async function loadSoftwareSettings() {
    setSoftwareSettingsLoading(true);
    setSoftwareSavedStatusVisible(false);
    try {
      const result = await invoke<SoftwareSettings>('get_software_settings');
      setSoftwareSettings(result);
      setSoftwareCloseBehaviorDraft(result.closeBehavior);
      setSoftwareAutostartDraft(result.autostartEnabled);
      setSoftwareStartCoreDraft(result.startCoreOnLaunch);
      setSoftwareSilentStartDraft(result.silentStartEnabled);
    } catch (error) {
      setSoftwareSettings(null);
      showNotice(t('config.error.saveFailed', { error: String(error) }), 'error');
    } finally {
      setSoftwareSettingsLoading(false);
    }
  }

  const runMutation = async (
    action: Exclude<ConfigAction, null>,
    command: string,
    args: Record<string, unknown>,
    successMessage: string,
  ) => {
    setBusyAction(action);
    try {
      const result = await invoke<CoreConfigSettings>(command, args);
      setSettings(result);
      setLoadError('');
      showNotice(successMessage, 'success');
      return true;
    } catch (error) {
      if (settings) setSettings(settings);
      showNotice(t('config.error.saveFailed', { error: String(error) }), 'error');
      void loadSettings('preserve');
      return false;
    } finally {
      setBusyAction(null);
    }
  };

  const openAddDialog = () => {
    setEditingApiKey(null);
    setNewApiKey('');
    setNewApiKeyRemark('');
    setShowApiKey(false);
    setFormError('');
    setAddDialogOpen(true);
  };

  const openEditDialog = (entry: CoreApiKey) => {
    setEditingApiKey(entry.apiKey);
    setNewApiKey(entry.apiKey);
    setNewApiKeyRemark(entry.remark);
    setShowApiKey(false);
    setFormError('');
    setAddDialogOpen(true);
  };

  const closeAddDialog = () => {
    if (busyAction === 'add-key' || busyAction === 'update-key') {
      return;
    }
    setAddDialogOpen(false);
    setEditingApiKey(null);
    setFormError('');
  };

  const generateApiKey = () => {
    const bytes = new Uint8Array(24);
    crypto.getRandomValues(bytes);
    const value = Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
    setNewApiKey(`sk-${value}`);
    setShowApiKey(true);
    setFormError('');
  };

  const generateManagementSecret = () => {
    const bytes = new Uint8Array(24);
    crypto.getRandomValues(bytes);
    const value = Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
    const secret = `webui-${value}`;
    setManagementSecretDraft(secret);
    setManagementSecretConfirm(secret);
    setShowManagementSecret(true);
    setManagementSecretError('');
  };

  const saveManagementSecret = async (event: FormEvent) => {
    event.preventDefault();
    const secretKey = managementSecretDraft.trim();
    if (!secretKey) {
      setManagementSecretError(t('config.webuiKey.error.empty'));
      return;
    }
    if (secretKey === '123456') {
      setManagementSecretError(t('config.webuiKey.error.legacyDefault'));
      return;
    }
    if (secretKey.length > 512) {
      setManagementSecretError(t('config.webuiKey.error.tooLong'));
      return;
    }
    if (/[\u0000-\u001f\u007f-\u009f]/.test(secretKey)) {
      setManagementSecretError(t('config.webuiKey.error.invalid'));
      return;
    }
    if (secretKey !== managementSecretConfirm.trim()) {
      setManagementSecretError(t('config.webuiKey.error.mismatch'));
      return;
    }

    const saved = await runMutation(
      'management-secret',
      'set_core_management_secret_key',
      { secretKey },
      t('config.webuiKey.notice.updated'),
    );
    if (saved) {
      setManagementSecretDraft('');
      setManagementSecretConfirm('');
      setShowManagementSecret(false);
      setManagementSecretError('');
    }
  };

  const submitApiKey = async (event: FormEvent) => {
    event.preventDefault();
    const apiKey = newApiKey.trim();
    if (!apiKey) {
      setFormError(t('config.error.emptyKey'));
      return;
    }
    if (!/^[\x21-\x7e]+$/.test(apiKey)) {
      setFormError(t('config.error.invalidKey'));
      return;
    }
    if (settings?.apiKeys.some((entry) => entry.apiKey === apiKey && entry.apiKey !== editingApiKey)) {
      setFormError(t('config.error.duplicateKey'));
      return;
    }
    const remark = newApiKeyRemark.trim();
    if (remark.length > 80) {
      setFormError(t('config.error.remarkTooLong'));
      return;
    }

    const editing = editingApiKey !== null;
    const saved = await runMutation(
      editing ? 'update-key' : 'add-key',
      editing ? 'update_core_api_key' : 'add_core_api_key',
      editing ? { originalApiKey: editingApiKey, apiKey, remark } : { apiKey, remark },
      editing ? t('config.notice.keyUpdated') : t('config.notice.keyAdded'),
    );
    if (saved) {
      setAddDialogOpen(false);
      setEditingApiKey(null);
      setNewApiKey('');
      setNewApiKeyRemark('');
    }
  };

  const confirmDelete = async () => {
    if (deleteIndex === null) {
      return;
    }
    const deleted = await runMutation(
      'delete-key',
      'delete_core_api_key',
      { apiKey: selectedDeleteKey },
      t('config.notice.keyDeleted'),
    );
    if (deleted) {
      setDeleteIndex(null);
    }
  };

  const copyApiKey = async (apiKey: string, index: number) => {
    try {
      await navigator.clipboard.writeText(apiKey);
      setCopiedIndex(index);
      showNotice(t('config.notice.keyCopied'), 'success');
      if (copyTimerRef.current !== null) {
        window.clearTimeout(copyTimerRef.current);
      }
      copyTimerRef.current = window.setTimeout(() => {
        setCopiedIndex(null);
        copyTimerRef.current = null;
      }, 1800);
    } catch {
      showNotice(t('config.notice.keyCopyFailed'), 'error');
    }
  };

  const openWebUi = async () => {
    try {
      const latestSettings = await invoke<CoreConfigSettings>('get_core_config_settings');
      applySettings(latestSettings, 'preserve');
      await invoke('open_external_url', {
        url: webUiManagementUrl(latestSettings.port),
      });
    } catch (error) {
      showNotice(t('config.webuiKey.error.openFailed', { error: String(error) }), 'error');
    }
  };

  const changeRoutingStrategy = async (strategy: string) => {
    if (strategy === settings?.routingStrategy) {
      return;
    }
    setSavedStatusVisible(false);
    const saved = await runMutation(
      'routing',
      'set_core_routing_strategy',
      { strategy },
      t('config.notice.routingUpdated'),
    );
    if (saved) setSavedStatusVisible(true);
  };

  const saveNetworkRoutingSettings = async () => {
    if (!settings || busyAction !== null) return;
    const port = Number(portDraft);
    if (!Number.isInteger(port) || port < 1 || port > 65535) {
      setPortError(t('config.error.portRange'));
      showNotice(t('config.error.portRange'), 'error');
      return;
    }

    const proxyUrl = proxyUrlDraft.trim();
    const routingSessionAffinityTtl = sessionTtlDraft.trim();
    const retryDrafts = [
      requestRetryDraft,
      maxRetryCredentialsDraft,
      maxRetryIntervalDraft,
      streamingBootstrapRetriesDraft,
    ];
    const retryValues = retryDrafts.map(Number);
    if (
      retryDrafts.some((value) => value.length === 0)
      || retryValues.some((value) => !Number.isInteger(value) || value < 0 || value > 4294967295)
    ) {
      setRetryError(t('config.error.retryRange'));
      showNotice(t('config.error.retryRange'), 'error');
      return;
    }
    const [requestRetry, maxRetryCredentials, maxRetryInterval, streamingBootstrapRetries] = retryValues;
    const networkChanged = port !== settings.port || allowLanDraft !== settings.allowLan;
    setPortError('');
    setRetryError('');
    setSavedStatusVisible(false);
    setBusyAction('network');
    try {
      const result = await invoke<CoreConfigSettings>('save_network_routing_settings', {
        settings: {
          port,
          allowLan: allowLanDraft,
          proxyUrl,
          routingSessionAffinity: sessionAffinityDraft,
          routingSessionAffinityTtl,
          requestRetry,
          maxRetryCredentials,
          maxRetryInterval,
          streamingBootstrapRetries,
        },
      });
      applySettings(result);
      setLoadError('');
      setSavedStatusVisible(true);

      if (networkChanged && coreStatus?.running) {
        try {
          const status = await invoke<CoreStatus>('restart_core_process');
          publishStatus(status);
          showNotice(t('config.notice.networkRestarted'), 'success');
        } catch (error) {
          await refreshStatus();
          showNotice(t('config.error.networkRestartFailed', { error: String(error) }), 'error');
        }
      } else if (networkChanged) {
        showNotice(t('config.notice.networkNextStart'), 'success');
      } else {
        showNotice(t('config.notice.networkUpdated'), 'success');
      }
    } catch (error) {
      applySettings(settings);
      showNotice(t('config.error.saveFailed', { error: String(error) }), 'error');
      void loadSettings();
    } finally {
      setBusyAction(null);
    }
  };

  const saveSoftwareSettings = async () => {
    if (!softwareSettings || busyAction !== null) return;
    if (
      softwareCloseBehaviorDraft === softwareSettings.closeBehavior
      && softwareAutostartDraft === softwareSettings.autostartEnabled
      && softwareStartCoreDraft === softwareSettings.startCoreOnLaunch
      && softwareSilentStartDraft === softwareSettings.silentStartEnabled
    ) return;

    setBusyAction('software');
    try {
      const result = await invoke<SoftwareSettings>('save_software_settings', {
        settings: {
          closeBehavior: softwareCloseBehaviorDraft,
          autostartEnabled: softwareAutostartDraft,
          startCoreOnLaunch: softwareStartCoreDraft,
          silentStartEnabled: softwareSilentStartDraft,
        },
      });
      setSoftwareSettings(result);
      setSoftwareCloseBehaviorDraft(result.closeBehavior);
      setSoftwareAutostartDraft(result.autostartEnabled);
      setSoftwareStartCoreDraft(result.startCoreOnLaunch);
      setSoftwareSilentStartDraft(result.silentStartEnabled);
      setSoftwareSavedStatusVisible(true);
      showNotice(t('config.notice.softwareUpdated'), 'success');
    } catch (error) {
      setSoftwareCloseBehaviorDraft(softwareSettings.closeBehavior);
      setSoftwareAutostartDraft(softwareSettings.autostartEnabled);
      setSoftwareStartCoreDraft(softwareSettings.startCoreOnLaunch);
      setSoftwareSilentStartDraft(softwareSettings.silentStartEnabled);
      setSoftwareSavedStatusVisible(false);
      showNotice(t('config.error.saveFailed', { error: String(error) }), 'error');
      void loadSoftwareSettings();
    } finally {
      setBusyAction(null);
    }
  };

  const controlsDisabled = loading || settings === null || busyAction !== null;
  const networkRoutingDirty = Boolean(settings) && (
    portDraft !== String(settings?.port)
    || allowLanDraft !== settings?.allowLan
    || proxyUrlDraft.trim() !== settings?.proxyUrl
    || sessionAffinityDraft !== settings?.routingSessionAffinity
    || sessionTtlDraft.trim() !== settings?.routingSessionAffinityTtl
    || requestRetryDraft !== String(settings?.requestRetry)
    || maxRetryCredentialsDraft !== String(settings?.maxRetryCredentials)
    || maxRetryIntervalDraft !== String(settings?.maxRetryInterval)
    || streamingBootstrapRetriesDraft !== String(settings?.streamingBootstrapRetries)
  );
  const networkStatusLabel = loading
    ? t('common.loading')
    : settings === null
      ? t('common.unavailable')
      : busyAction === 'network' || busyAction === 'routing'
        ? t('config.network.saving')
        : networkRoutingDirty
          ? t('config.network.unsaved')
          : savedStatusVisible
            ? t('config.network.saved')
            : '';
  const softwareCloseBehaviorDirty = softwareSettings !== null
    && softwareCloseBehaviorDraft !== softwareSettings.closeBehavior;
  const softwareAutostartDirty = softwareSettings !== null
    && softwareAutostartDraft !== softwareSettings.autostartEnabled;
  const softwareSilentStartDirty = softwareSettings !== null
    && softwareSilentStartDraft !== softwareSettings.silentStartEnabled;
  const softwareStartCoreDirty = softwareSettings !== null
    && softwareStartCoreDraft !== softwareSettings.startCoreOnLaunch;
  const softwareSettingsDirty = softwareCloseBehaviorDirty
    || softwareAutostartDirty
    || softwareStartCoreDirty
    || softwareSilentStartDirty;
  const softwareStatusLabel = softwareSettingsLoading
    ? t('common.loading')
    : softwareSettings === null
      ? t('common.unavailable')
      : softwareSettingsDirty
        ? t('config.network.unsaved')
        : softwareSavedStatusVisible
          ? t('config.network.saved')
          : '';
  const softwareStatusIsSaved = !softwareSettingsLoading
    && softwareSettings !== null
    && !softwareSettingsDirty
    && softwareSavedStatusVisible;
  const networkStatusIsSaved = !loading
    && settings !== null
    && busyAction === null
    && !networkRoutingDirty
    && savedStatusVisible;
  const selectedDeleteKey =
    deleteIndex === null ? '' : settings?.apiKeys[deleteIndex]?.apiKey || '';
  const deletingLastKey = deleteIndex !== null && settings?.apiKeys.length === 1;
  const keyMutationBusy = busyAction === 'add-key' || busyAction === 'update-key';
  const managementSecretBusy = busyAction === 'management-secret';

  return (
    <section className="grid gap-4">
      <div className="inline-flex w-fit gap-1 rounded-xl border bg-card/60 backdrop-blur-sm p-1 shadow-2xs" role="tablist" aria-label={t('config.tabs.label')}>
        {([
          ['general', t('config.tabs.general')],
          ['network', t('config.tabs.network')],
          ['aliases', t('app.nav.thinkingAliases')],
          ['software', t('config.tabs.software')],
        ] as const).map(([id, label]) => (
          <button
            key={id}
            type="button"
            id={`config-subpage-tab-${id}`}
            role="tab"
            className={cn(
              'rounded-lg px-3.5 py-1.5 text-xs font-semibold whitespace-nowrap transition-all duration-150 cursor-pointer',
              activeSubpage === id
                ? 'bg-primary text-primary-foreground shadow-sm shadow-primary/20'
                : 'text-muted-foreground hover:bg-accent/60 hover:text-foreground',
            )}
            aria-selected={activeSubpage === id}
            aria-controls={`config-subpage-panel-${id}`}
            tabIndex={activeSubpage === id ? 0 : -1}
            onClick={() => setActiveSubpage(id)}
          >
            {label}
          </button>
        ))}
      </div>

      {activeSubpage === 'general' ? (
        <div
          className="grid grid-cols-1 gap-4 lg:grid-cols-2 lg:items-start"
          id="config-subpage-panel-general"
          role="tabpanel"
          aria-labelledby="config-subpage-tab-general"
        >
        <Card className="gap-0 p-0">
          <div className="flex items-center justify-between gap-3 p-4 pb-3">
            <div className="flex items-center gap-2">
              <KeyRound size={17} aria-hidden="true" className="text-muted-foreground" />
              <h2 className="text-base font-semibold">{t('config.keys.title')}</h2>
              <span className="text-sm text-muted-foreground" aria-label={t('config.keys.count')}>
                · {settings?.apiKeys.length ?? 0}
              </span>
            </div>
            <Button type="button" size="icon-sm" onClick={openAddDialog} disabled={controlsDisabled} title={t('config.keys.add')} aria-label={t('config.keys.add')}>
              <Plus size={16} aria-hidden="true" />
            </Button>
          </div>

          <div aria-busy={loading || undefined}>
            {loading ? (
              Array.from({ length: 5 }, (_, index) => (
                <div className="flex items-center gap-3 border-t px-4 py-3" key={index} aria-hidden="true">
                  <span className="h-8 flex-1 animate-pulse rounded-md bg-muted" />
                </div>
              ))
            ) : loadError ? (
              <div className="grid justify-items-center gap-2 border-t px-4 py-8 text-center">
                <AlertCircle size={22} aria-hidden="true" className="text-destructive" />
                <strong className="text-sm font-semibold">{t('config.unavailable')}</strong>
                <span className="max-w-xs truncate text-xs text-muted-foreground" title={loadError}>{loadError}</span>
                <Button type="button" variant="outline" size="sm" onClick={() => void loadSettings()}>
                  <RefreshCw size={14} aria-hidden="true" />
                  {t('common.retry')}
                </Button>
              </div>
            ) : settings && settings.apiKeys.length > 0 ? (
              settings.apiKeys.map((entry, index) => (
                <div className="flex items-center gap-3 border-t px-4 py-2.5" key={`${index}-${entry.apiKey}`}>
                  <span className="w-6 shrink-0 font-mono text-xs text-muted-foreground">{String(index + 1).padStart(2, '0')}</span>
                  <div className="min-w-0 flex-1">
                    <strong className="block truncate text-sm font-medium" title={entry.remark || t('config.keys.noRemark')}>
                      {entry.remark || t('config.keys.noRemark')}
                    </strong>
                    <code className="block truncate font-mono text-xs text-muted-foreground" title={maskApiKey(entry.apiKey)}>{maskApiKey(entry.apiKey)}</code>
                  </div>
                  <div className="flex shrink-0 items-center gap-1">
                    <Button type="button" variant="ghost" size="icon-sm" onClick={() => void copyApiKey(entry.apiKey, index)} disabled={controlsDisabled} title={t('config.keys.copy')} aria-label={t('config.keys.copyNth', { number: index + 1 })}>
                      {copiedIndex === index ? <Check size={15} aria-hidden="true" /> : <Copy size={15} aria-hidden="true" />}
                    </Button>
                    <Button type="button" variant="ghost" size="icon-sm" onClick={() => openEditDialog(entry)} disabled={controlsDisabled} title={t('config.keys.edit')} aria-label={t('config.keys.editNth', { number: index + 1 })}>
                      <Pencil size={15} aria-hidden="true" />
                    </Button>
                    <Button type="button" variant="ghost" size="icon-sm" className="text-destructive hover:text-destructive" onClick={() => setDeleteIndex(index)} disabled={controlsDisabled} title={t('config.keys.delete')} aria-label={t('config.keys.deleteNth', { number: index + 1 })}>
                      <Trash2 size={15} aria-hidden="true" />
                    </Button>
                  </div>
                </div>
              ))
            ) : (
              <div className="grid justify-items-center gap-2 border-t px-4 py-8 text-center">
                <KeyRound size={24} aria-hidden="true" className="text-muted-foreground" />
                <strong className="text-sm font-semibold">{t('config.keys.empty')}</strong>
              </div>
            )}
          </div>
        </Card>
        <Card className="gap-0 p-0">
          <div className="flex items-center justify-between gap-3 p-4 pb-3">
            <div className="flex items-center gap-2">
              <ShieldCheck size={17} aria-hidden="true" className="text-muted-foreground" />
              <h2 className="text-base font-semibold">{t('config.webuiKey.title')}</h2>
            </div>
            {!loading && settings ? (
              <Badge variant={settings.managementSecretConfigured ? 'success' : 'secondary'}>
                {settings.managementSecretConfigured
                  ? t('config.webuiKey.configured')
                  : t('config.webuiKey.unconfigured')}
              </Badge>
            ) : null}
          </div>

          <div className="grid gap-4 px-4 pb-4">
            <div>
              <strong className="text-sm font-semibold">{t('config.webuiKey.heading')}</strong>
              <p className="mt-1 text-sm text-muted-foreground">{t('config.webuiKey.description')}</p>
              <small className="mt-1 block text-xs text-muted-foreground">{t('config.webuiKey.securityHint')}</small>
            </div>

            <form className="grid gap-3" onSubmit={(event) => void saveManagementSecret(event)}>
              <label className="grid gap-1.5">
                <span className="text-xs font-medium">{t('config.webuiKey.newKey')}</span>
                <div className="relative">
                  <Input
                    type={showManagementSecret ? 'text' : 'password'}
                    autoComplete="new-password"
                    maxLength={512}
                    value={managementSecretDraft}
                    disabled={controlsDisabled}
                    aria-invalid={Boolean(managementSecretError)}
                    placeholder={t('config.webuiKey.placeholder')}
                    className="pr-9"
                    onChange={(event) => {
                      setManagementSecretDraft(event.currentTarget.value);
                      setManagementSecretError('');
                    }}
                  />
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-sm"
                    className="absolute top-1/2 right-1 -translate-y-1/2"
                    disabled={controlsDisabled}
                    onClick={() => setShowManagementSecret((value) => !value)}
                    title={showManagementSecret ? t('config.keys.hide') : t('config.keys.show')}
                    aria-label={showManagementSecret ? t('config.keys.hide') : t('config.keys.show')}
                  >
                    {showManagementSecret ? <EyeOff size={15} aria-hidden="true" /> : <Eye size={15} aria-hidden="true" />}
                  </Button>
                </div>
              </label>

              <label className="grid gap-1.5">
                <span className="text-xs font-medium">{t('config.webuiKey.confirmKey')}</span>
                <Input
                  type={showManagementSecret ? 'text' : 'password'}
                  autoComplete="new-password"
                  maxLength={512}
                  value={managementSecretConfirm}
                  disabled={controlsDisabled}
                  aria-invalid={Boolean(managementSecretError)}
                  placeholder={t('config.webuiKey.confirmPlaceholder')}
                  onChange={(event) => {
                    setManagementSecretConfirm(event.currentTarget.value);
                    setManagementSecretError('');
                  }}
                />
              </label>

              <div className="flex items-center justify-between gap-3">
                <span className={cn('text-xs text-destructive', !managementSecretError && 'invisible')} role="alert">
                  {managementSecretError || ' '}
                </span>
                <div className="flex gap-2">
                  <Button type="button" variant="outline" size="sm" disabled={controlsDisabled} onClick={generateManagementSecret}>
                    {t('config.webuiKey.generate')}
                  </Button>
                  <Button type="submit" size="sm" disabled={controlsDisabled || !managementSecretDraft.trim()}>
                    <Check size={15} aria-hidden="true" />
                    {managementSecretBusy ? t('common.saving') : t('config.webuiKey.save')}
                  </Button>
                </div>
              </div>
            </form>
          </div>
        </Card>
        </div>
      ) : activeSubpage === 'network' ? (
        <div
          id="config-subpage-panel-network"
          role="tabpanel"
          aria-labelledby="config-subpage-tab-network"
        >
      <Card className="gap-0 p-0">
        <div className="flex items-center justify-between gap-3 p-4 pb-3">
          <div className="flex items-center gap-2">
            <Network size={17} aria-hidden="true" className="text-muted-foreground" />
            <h2 className="text-base font-semibold">{t('config.network.title')}</h2>
          </div>
          <div className="flex items-center gap-2.5">
            {networkStatusLabel ? (
              <Badge variant={networkStatusIsSaved ? 'success' : 'secondary'}>{networkStatusLabel}</Badge>
            ) : null}
            <Button type="button" size="sm" disabled={controlsDisabled || !networkRoutingDirty} onClick={() => void saveNetworkRoutingSettings()}>
              <Check size={15} aria-hidden="true" />
              {busyAction === 'network' ? t('config.network.saving') : t('config.network.confirmSave')}
            </Button>
          </div>
        </div>

        <div>
          <section className="border-t px-4 py-4" aria-labelledby="config-network-section-title">
            <div className="mb-3 flex items-center gap-1.5 text-[11px] font-semibold tracking-wide text-muted-foreground uppercase">
              <Network size={13} aria-hidden="true" />
              <h3 id="config-network-section-title">{t('config.network.networkSection')}</h3>
            </div>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
              <label className="grid gap-1.5">
                <span className="text-xs font-medium">{t('config.network.port')}</span>
                <Input
                  className="font-mono"
                  aria-invalid={Boolean(portError)}
                  type="text"
                  inputMode="numeric"
                  pattern="[0-9]*"
                  maxLength={5}
                  value={portDraft}
                  disabled={controlsDisabled}
                  title={portError || t('config.network.portHint')}
                  onChange={(event) => {
                    markDraftDirty('port');
                    setPortDraft(event.currentTarget.value.replace(/\D/g, '').slice(0, 5));
                    setPortError('');
                  }}
                  onKeyDown={(event) => {
                    if (event.key === 'Escape' && settings) {
                      clearDraftDirty('port');
                      setPortDraft(String(settings.port));
                      setPortError('');
                      event.currentTarget.blur();
                    }
                  }}
                />
                <small className="text-xs text-muted-foreground">{t('config.network.portHint')}</small>
              </label>

              <div className="grid gap-1.5">
                <span className="text-xs font-medium">{t('config.network.allowLan')}</span>
                <ConfigSwitch
                  checked={allowLanDraft}
                  disabled={controlsDisabled}
                  label={t('config.network.allowLan')}
                  onChange={(checked) => {
                    markDraftDirty('allowLan');
                    setAllowLanDraft(checked);
                  }}
                />
                <small className="text-xs text-muted-foreground">{t('config.network.allowLanHint')}</small>
              </div>

              <label className="grid gap-1.5">
                <span className="flex items-center gap-1.5 text-xs font-medium">
                  <Link2 size={13} aria-hidden="true" />
                  {t('config.network.proxyUrl')}
                </span>
                <Input
                  type="text"
                  value={proxyUrlDraft}
                  disabled={controlsDisabled}
                  placeholder={t('config.network.proxyPlaceholder')}
                  onChange={(event) => {
                    markDraftDirty('proxyUrl');
                    setProxyUrlDraft(event.currentTarget.value);
                  }}
                  onKeyDown={(event) => {
                    if (event.key === 'Escape' && settings) {
                      clearDraftDirty('proxyUrl');
                      setProxyUrlDraft(settings.proxyUrl);
                      event.currentTarget.blur();
                    }
                  }}
                />
                <small className="text-xs text-muted-foreground">{t('config.network.proxyHint')}</small>
              </label>
            </div>
          </section>

          <section className="border-t px-4 py-4" aria-labelledby="config-routing-section-title">
            <div className="mb-3 flex items-center gap-1.5 text-[11px] font-semibold tracking-wide text-muted-foreground uppercase">
              <Route size={13} aria-hidden="true" />
              <h3 id="config-routing-section-title">{t('config.network.routingSection')}</h3>
            </div>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
              <div className="grid gap-1.5">
                <span className="text-xs font-medium">{t('config.network.sessionAffinity')}</span>
                <ConfigSwitch
                  checked={sessionAffinityDraft}
                  disabled={controlsDisabled}
                  label={t('config.network.sessionAffinity')}
                  onChange={(checked) => {
                    markDraftDirty('sessionAffinity');
                    setSessionAffinityDraft(checked);
                  }}
                />
                <small className="text-xs text-muted-foreground">{t('config.network.sessionAffinityHint')}</small>
              </div>

              <label className="grid gap-1.5">
                <span className="flex items-center gap-1.5 text-xs font-medium">
                  <Clock3 size={13} aria-hidden="true" />
                  {t('config.network.sessionTtl')}
                </span>
                <Input
                  type="text"
                  value={sessionTtlDraft}
                  disabled={controlsDisabled}
                  placeholder="1h"
                  onChange={(event) => {
                    markDraftDirty('sessionTtl');
                    setSessionTtlDraft(event.currentTarget.value);
                  }}
                  onKeyDown={(event) => {
                    if (event.key === 'Escape' && settings) {
                      clearDraftDirty('sessionTtl');
                      setSessionTtlDraft(settings.routingSessionAffinityTtl);
                      event.currentTarget.blur();
                    }
                  }}
                />
                <small className="text-xs text-muted-foreground">{t('config.network.sessionTtlHint')}</small>
              </label>

              <div className="grid gap-1.5">
                <span className="flex items-center gap-1.5 text-xs font-medium">
                  <Route size={13} aria-hidden="true" />
                  {t('config.routing.title')}
                </span>
                <div className="flex gap-0.5 rounded-md bg-muted p-0.5" role="group" aria-label={t('config.routing.title')}>
                  {ROUTING_OPTIONS.map((option) => (
                    <button
                      type="button"
                      key={option.value}
                      className={cn(
                        'flex-1 rounded-sm py-1.5 text-xs font-medium transition-colors',
                        settings?.routingStrategy === option.value ? 'bg-card text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground',
                      )}
                      aria-pressed={settings?.routingStrategy === option.value}
                      disabled={controlsDisabled}
                      onClick={() => void changeRoutingStrategy(option.value)}
                      title={option.value}
                    >
                      {t(option.labelKey)}
                    </button>
                  ))}
                </div>
                <small className="text-xs text-muted-foreground" title={settings?.routingStrategy || undefined}>
                  {loading
                    ? t('common.loading')
                    : settings === null
                      ? t('common.unavailable')
                      : routingStrategyLabel(settings.routingStrategy, t)}
                </small>
              </div>
            </div>
          </section>

          <section className="border-t px-4 py-4" aria-labelledby="config-retry-section-title">
            <div className="mb-3 flex items-center gap-1.5 text-[11px] font-semibold tracking-wide text-muted-foreground uppercase">
              <RefreshCw size={13} aria-hidden="true" />
              <h3 id="config-retry-section-title">{t('config.network.retrySection')}</h3>
            </div>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
              <label className="grid gap-1.5">
                <span className="text-xs font-medium">{t('config.network.requestRetry')}</span>
                <Input
                  className="font-mono"
                  aria-invalid={Boolean(retryError)}
                  type="text"
                  inputMode="numeric"
                  pattern="[0-9]*"
                  maxLength={10}
                  value={requestRetryDraft}
                  disabled={controlsDisabled}
                  onChange={(event) => {
                    markDraftDirty('requestRetry');
                    setRequestRetryDraft(event.currentTarget.value.replace(/\D/g, '').slice(0, 10));
                    setRetryError('');
                  }}
                  onKeyDown={(event) => {
                    if (event.key === 'Escape' && settings) {
                      clearDraftDirty('requestRetry');
                      setRequestRetryDraft(String(settings.requestRetry));
                      setRetryError('');
                      event.currentTarget.blur();
                    }
                  }}
                />
                <small className="text-xs text-muted-foreground">{t('config.network.requestRetryHint')}</small>
              </label>

              <label className="grid gap-1.5">
                <span className="text-xs font-medium">{t('config.network.maxRetryCredentials')}</span>
                <Input
                  className="font-mono"
                  aria-invalid={Boolean(retryError)}
                  type="text"
                  inputMode="numeric"
                  pattern="[0-9]*"
                  maxLength={10}
                  value={maxRetryCredentialsDraft}
                  disabled={controlsDisabled}
                  onChange={(event) => {
                    markDraftDirty('maxRetryCredentials');
                    setMaxRetryCredentialsDraft(event.currentTarget.value.replace(/\D/g, '').slice(0, 10));
                    setRetryError('');
                  }}
                  onKeyDown={(event) => {
                    if (event.key === 'Escape' && settings) {
                      clearDraftDirty('maxRetryCredentials');
                      setMaxRetryCredentialsDraft(String(settings.maxRetryCredentials));
                      setRetryError('');
                      event.currentTarget.blur();
                    }
                  }}
                />
                <small className="text-xs text-muted-foreground">{t('config.network.maxRetryCredentialsHint')}</small>
              </label>

              <label className="grid gap-1.5">
                <span className="text-xs font-medium">{t('config.network.maxRetryInterval')}</span>
                <Input
                  className="font-mono"
                  aria-invalid={Boolean(retryError)}
                  type="text"
                  inputMode="numeric"
                  pattern="[0-9]*"
                  maxLength={10}
                  value={maxRetryIntervalDraft}
                  disabled={controlsDisabled}
                  onChange={(event) => {
                    markDraftDirty('maxRetryInterval');
                    setMaxRetryIntervalDraft(event.currentTarget.value.replace(/\D/g, '').slice(0, 10));
                    setRetryError('');
                  }}
                  onKeyDown={(event) => {
                    if (event.key === 'Escape' && settings) {
                      clearDraftDirty('maxRetryInterval');
                      setMaxRetryIntervalDraft(String(settings.maxRetryInterval));
                      setRetryError('');
                      event.currentTarget.blur();
                    }
                  }}
                />
                <small className="text-xs text-muted-foreground">{t('config.network.maxRetryIntervalHint')}</small>
              </label>

              <label className="grid gap-1.5">
                <span className="text-xs font-medium">{t('config.network.streamingBootstrapRetries')}</span>
                <Input
                  className="font-mono"
                  aria-invalid={Boolean(retryError)}
                  type="text"
                  inputMode="numeric"
                  pattern="[0-9]*"
                  maxLength={10}
                  value={streamingBootstrapRetriesDraft}
                  disabled={controlsDisabled}
                  onChange={(event) => {
                    markDraftDirty('streamingBootstrapRetries');
                    setStreamingBootstrapRetriesDraft(event.currentTarget.value.replace(/\D/g, '').slice(0, 10));
                    setRetryError('');
                  }}
                  onKeyDown={(event) => {
                    if (event.key === 'Escape' && settings) {
                      clearDraftDirty('streamingBootstrapRetries');
                      setStreamingBootstrapRetriesDraft(String(settings.streamingBootstrapRetries));
                      setRetryError('');
                      event.currentTarget.blur();
                    }
                  }}
                />
                <small className="text-xs text-muted-foreground">{t('config.network.streamingBootstrapRetriesHint')}</small>
              </label>
            </div>
          </section>
        </div>
      </Card>
        </div>
      ) : activeSubpage === 'software' ? (
        <div
          id="config-subpage-panel-software"
          role="tabpanel"
          aria-labelledby="config-subpage-tab-software"
        >
          <Card className="gap-0 p-0">
            <div className="flex items-center justify-between gap-3 p-4 pb-3">
              <div className="flex items-center gap-2">
                <Settings2 size={17} aria-hidden="true" className="text-muted-foreground" />
                <h2 className="text-base font-semibold">{t('config.software.title')}</h2>
              </div>
              <div className="flex items-center gap-2.5">
                {softwareStatusLabel ? (
                  <Badge variant={softwareStatusIsSaved ? 'success' : 'secondary'}>{softwareStatusLabel}</Badge>
                ) : null}
                <Button
                  type="button"
                  size="sm"
                  disabled={softwareSettingsLoading || softwareSettings === null || busyAction !== null || !softwareSettingsDirty}
                  onClick={() => void saveSoftwareSettings()}
                >
                  <Check size={15} aria-hidden="true" />
                  {busyAction === 'software' ? t('common.saving') : t('config.network.confirmSave')}
                </Button>
              </div>
            </div>
            <div>
              {[
                [Clock3, t('config.software.autostart'), t('config.software.autostartDescription'), softwareAutostartDraft, setSoftwareAutostartDraft] as const,
                [Power, t('config.software.startCoreOnLaunch'), t('config.software.startCoreOnLaunchDescription'), softwareStartCoreDraft, setSoftwareStartCoreDraft] as const,
                [EyeOff, t('config.software.silentStart'), t('config.software.silentStartDescription'), softwareSilentStartDraft, setSoftwareSilentStartDraft] as const,
              ].map(([Icon, label, description, checked, setChecked]) => (
                <div className="flex items-center gap-4 border-t px-4 py-3.5" key={label}>
                  <span className="grid size-8 shrink-0 place-items-center rounded-md bg-muted text-muted-foreground" aria-hidden="true">
                    <Icon size={16} />
                  </span>
                  <div className="min-w-0 flex-1">
                    <strong className="block text-sm font-medium">{label}</strong>
                    <small className="block text-xs text-muted-foreground">{description}</small>
                  </div>
                  <ConfigSwitch
                    checked={checked}
                    disabled={softwareSettingsLoading || softwareSettings === null || busyAction !== null}
                    label={label}
                    onChange={(value) => {
                      setSoftwareSavedStatusVisible(false);
                      setChecked(value);
                    }}
                  />
                </div>
              ))}
              <div className="flex items-center gap-4 border-t px-4 py-3.5">
                <span className="grid size-8 shrink-0 place-items-center rounded-md bg-muted text-muted-foreground" aria-hidden="true">
                  <X size={16} />
                </span>
                <div className="min-w-0 flex-1">
                  <strong className="block text-sm font-medium">{t('config.software.closeBehavior')}</strong>
                  <small className="block text-xs text-muted-foreground">{t('config.software.closeBehaviorDescription')}</small>
                </div>
                <div className="flex gap-0.5 rounded-md bg-muted p-0.5" role="group" aria-label={t('config.software.closeBehavior')}>
                  {([
                    ['ask', t('config.software.behavior.ask')],
                    ['minimize-to-tray', t('config.software.behavior.minimize')],
                    ['exit', t('config.software.behavior.exit')],
                  ] as const).map(([value, label]) => (
                    <button
                      key={value}
                      type="button"
                      className={cn(
                        'rounded-sm px-2.5 py-1.5 text-xs font-medium whitespace-nowrap transition-colors',
                        softwareCloseBehaviorDraft === value ? 'bg-card text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground',
                      )}
                      disabled={softwareSettingsLoading || softwareSettings === null || busyAction !== null}
                      onClick={() => {
                        setSoftwareSavedStatusVisible(false);
                        setSoftwareCloseBehaviorDraft(value as CloseBehavior);
                      }}
                    >
                      {label}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          </Card>
        </div>
      ) : (
        <div
          id="config-subpage-panel-aliases"
          role="tabpanel"
          aria-labelledby="config-subpage-tab-aliases"
        >
          <ThinkingAliasesPage />
        </div>
      )}

      <Dialog open={addDialogOpen} onOpenChange={(open) => !open && !keyMutationBusy && closeAddDialog()}>
        {addDialogOpen ? (
          <DialogContent showCloseButton={!keyMutationBusy} className="sm:max-w-sm">
            <form className="grid gap-4" onSubmit={(event) => void submitApiKey(event)}>
              <div className="flex items-center gap-2">
                <KeyRound size={17} aria-hidden="true" className="text-muted-foreground" />
                <DialogTitle className="text-base font-semibold">
                  {editingApiKey === null ? t('config.keys.addTitle') : t('config.keys.editTitle')}
                </DialogTitle>
              </div>

              <label className="grid gap-1.5">
                <span className="text-xs font-medium">{t('config.keys.label')}</span>
                <div className="relative">
                  <Input
                    autoFocus
                    type={showApiKey ? 'text' : 'password'}
                    value={newApiKey}
                    onChange={(event) => {
                      setNewApiKey(event.currentTarget.value);
                      setFormError('');
                    }}
                    disabled={keyMutationBusy}
                    aria-invalid={Boolean(formError)}
                    placeholder="sk-..."
                    className="pr-9"
                  />
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-sm"
                    className="absolute top-1/2 right-1 -translate-y-1/2"
                    onClick={() => setShowApiKey((visible) => !visible)}
                    disabled={keyMutationBusy}
                    title={showApiKey ? t('config.keys.hide') : t('config.keys.show')}
                    aria-label={showApiKey ? t('config.keys.hide') : t('config.keys.show')}
                  >
                    {showApiKey ? <EyeOff size={15} aria-hidden="true" /> : <Eye size={15} aria-hidden="true" />}
                  </Button>
                </div>
              </label>

              <label className="grid gap-1.5">
                <span className="text-xs font-medium">{t('config.keys.remark')}</span>
                <Input
                  type="text"
                  value={newApiKeyRemark}
                  maxLength={80}
                  onChange={(event) => {
                    setNewApiKeyRemark(event.currentTarget.value);
                    setFormError('');
                  }}
                  disabled={keyMutationBusy}
                  placeholder={t('config.keys.remarkPlaceholder')}
                />
              </label>

              <div className={cn('text-xs text-destructive', !formError && 'invisible')}>
                {formError || ' '}
              </div>

              <div className="flex gap-2">
                <Button type="button" variant="outline" className="flex-1" onClick={generateApiKey} disabled={keyMutationBusy}>
                  <Sparkles size={15} aria-hidden="true" />
                  {t('config.keys.generate')}
                </Button>
                <Button type="submit" className="flex-1" disabled={keyMutationBusy}>
                  {editingApiKey === null ? <Plus size={15} aria-hidden="true" /> : <Check size={15} aria-hidden="true" />}
                  {keyMutationBusy
                    ? editingApiKey === null ? t('config.keys.adding') : t('common.saving')
                    : editingApiKey === null ? t('common.add') : t('common.save')}
                </Button>
              </div>
            </form>
          </DialogContent>
        ) : null}
      </Dialog>

      <Dialog open={deleteIndex !== null} onOpenChange={(open) => !open && busyAction !== 'delete-key' && setDeleteIndex(null)}>
        {deleteIndex !== null ? (
          <DialogContent className="sm:max-w-sm">
            <div className="flex items-center gap-2">
              <Trash2 size={17} aria-hidden="true" className="text-destructive" />
              <DialogTitle className="text-base font-semibold">{t('config.keys.deleteTitle')}</DialogTitle>
            </div>
            <code className="block truncate rounded-md bg-muted px-2.5 py-2 font-mono text-sm">{maskApiKey(selectedDeleteKey)}</code>
            {deletingLastKey ? (
              <div className="flex items-center gap-2 rounded-lg border border-[var(--theme-dfbf91)] bg-[var(--theme-fff7e9)] px-3 py-2 text-sm text-[var(--theme-8b5b21)]">
                <AlertCircle size={15} aria-hidden="true" />
                <span>{t('config.keys.deleteAllWarning')}</span>
              </div>
            ) : null}
            <div className="flex gap-2">
              <Button type="button" variant="outline" className="flex-1" onClick={() => setDeleteIndex(null)} disabled={busyAction === 'delete-key'}>
                {t('common.cancel')}
              </Button>
              <Button type="button" variant="destructive" className="flex-1" onClick={() => void confirmDelete()} disabled={busyAction === 'delete-key'}>
                <Trash2 size={15} aria-hidden="true" />
                {busyAction === 'delete-key' ? t('common.deleting') : t('common.delete')}
              </Button>
            </div>
          </DialogContent>
        ) : null}
      </Dialog>

      {notice ? (
        <div
          className={cn(
            'fixed right-6 bottom-6 z-50 flex items-center gap-2.5 rounded-xl border bg-card px-4 py-3 text-sm shadow-lg',
            notice.tone === 'success' ? 'border-[var(--theme-b8d1bb)] text-[var(--theme-2f6b3f)]' : 'border-destructive/30 text-destructive',
          )}
          role="status"
          title={notice.message}
        >
          {notice.tone === 'success' ? (
            <Check size={17} aria-hidden="true" />
          ) : (
            <AlertCircle size={17} aria-hidden="true" />
          )}
          <span>{notice.message}</span>
        </div>
      ) : null}
    </section>
  );
}

function maskApiKey(apiKey: string) {
  const value = apiKey.trim();
  if (!value) {
    return '';
  }
  const visible = value.length < 4 ? 1 : 2;
  return `${value.slice(0, visible)}${'*'.repeat(Math.max(6, 10 - visible * 2))}${value.slice(-visible)}`;
}

function routingStrategyLabel(strategy: string | undefined, t: ReturnType<typeof useI18n>['t']) {
  if (!strategy) {
    return t('common.loading');
  }
  const option = ROUTING_OPTIONS.find((item) => item.value === strategy);
  return option ? t(option.labelKey) : strategy;
}
