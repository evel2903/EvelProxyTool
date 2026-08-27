import { useEffect, useRef, useState } from 'react';
import { getVersion } from '@tauri-apps/api/app';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import {
  Activity,
  AlertCircle,
  Check,
  Cpu,
  Copy,
  ExternalLink,
  Eye,
  EyeOff,
  Globe,
  Network,
  Power,
  RefreshCw,
  RotateCcw,
  Server,
  Zap,
} from 'lucide-react';
import { type CoreStatus, useCoreRuntime } from '../coreRuntime';
import openaiIcon from '../assets/icons/openai-light.svg';
import claudeIcon from '../assets/icons/claude.svg';
import geminiIcon from '../assets/icons/gemini.svg';
import { clientApiProfiles } from '../services/clientAccess';
import { useI18n } from '../i18n';
import { useAppUpdate } from '../appUpdate';
import { cn } from '@/lib/utils';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog';
import { Progress } from '@/components/ui/progress';

type CorePlatform = {
  os: string;
  arch: string;
  assetOs: string;
  assetArch: string;
  archiveKind: 'tar.gz' | 'zip';
};

type CoreLatest = {
  version: string;
  assetName: string;
};

type BundledCoreInfo = {
  version: string;
  assetName: string;
  sizeBytes: number;
};

type CoreInstallResult = {
  version: string;
  assetName: string;
  installDir: string;
  binaryPath: string | null;
};

type CoreInstallTask = {
  running: boolean;
  cancellable: boolean;
  phase: string;
  downloaded: number;
  total: number | null;
  percent: number | null;
  message: string | null;
  result: CoreInstallResult | null;
};

type CodexModelCatalogUpdateResult = {
  outcome: 'updated' | 'unchanged';
};

type MessageType = 'info' | 'success' | 'error';
type CoreProcessCommand = 'start_core_process' | 'stop_core_process' | 'restart_core_process';

type GuiSettings = {
  port: number;
  allowLan: boolean;
  runOnStartup: boolean;
};

type CoreConfigSummary = {
  apiKeys: Array<{ apiKey: string }>;
};

const APP_RELEASE_URL = 'https://github.com/router-for-me/EvelProxyTool/releases/latest';

let latestAutoCheckStarted = false;
let cachedLatest: CoreLatest | null = null;
let cachedLatestError = '';
let latestCheckPromise: Promise<CoreLatest> | null = null;

function displayAppVersion(version: string) {
  const resolvedVersion = version.trim();
  return resolvedVersion.startsWith('v') ? resolvedVersion : `v${resolvedVersion}`;
}

function requestLatestCore() {
  if (latestCheckPromise) {
    return latestCheckPromise;
  }

  latestCheckPromise = invoke<CoreLatest>('check_latest_core')
    .then((result) => {
      cachedLatest = result;
      cachedLatestError = '';
      return result;
    })
    .catch((error) => {
      cachedLatest = null;
      cachedLatestError = String(error);
      throw error;
    })
    .finally(() => {
      latestCheckPromise = null;
    });

  return latestCheckPromise;
}

export type KernelView = 'home' | 'versions';

export function KernelPage({ view = 'home' }: { view?: KernelView }) {
  const { t } = useI18n();
  const {
    info: appUpdate,
    error: appUpdateError,
    checking: checkingAppUpdate,
    task: appUpdateTask,
    check: checkAppUpdate,
    requestInstall: requestAppUpdate,
  } = useAppUpdate();
  const {
    status: coreStatus,
    statusError,
    refreshStatus,
    publishStatus,
  } = useCoreRuntime();
  const [installedAppVersion, setInstalledAppVersion] = useState('');
  const [platform, setPlatform] = useState<CorePlatform | null>(null);
  const [platformError, setPlatformError] = useState('');
  const [latest, setLatest] = useState<CoreLatest | null>(cachedLatest);
  const [latestError, setLatestError] = useState(cachedLatestError);
  const [bundledCore, setBundledCore] = useState<BundledCoreInfo | null>(null);
  const [bundledCoreError, setBundledCoreError] = useState('');
  const [checkingLatest, setCheckingLatest] = useState(Boolean(latestCheckPromise));
  const [allowLanAccess, setAllowLanAccess] = useState(false);
  const [customPort, setCustomPort] = useState('8317');
  const [installing, setInstalling] = useState(false);
  const [processBusy, setProcessBusy] = useState(false);
  const [processNotice, setProcessNotice] = useState<{
    message: string;
    tone: MessageType;
  } | null>(null);
  const [message, setMessage] = useState('');
  const [messageType, setMessageType] = useState<MessageType>('info');
  const [catalogUpdating, setCatalogUpdating] = useState(false);
  const [catalogUpdateError, setCatalogUpdateError] = useState('');
  const [catalogUpdateNotice, setCatalogUpdateNotice] = useState('');
  const [progress, setProgress] = useState<CoreInstallTask | null>(null);
  const [installDialogOpen, setInstallDialogOpen] = useState(false);
  const [cancellingInstall, setCancellingInstall] = useState(false);
  const [copiedApiField, setCopiedApiField] = useState('');
  const [homeApiKey, setHomeApiKey] = useState<string | null | undefined>(undefined);
  const [homeApiKeyError, setHomeApiKeyError] = useState(false);
  const [showHomeApiKey, setShowHomeApiKey] = useState(false);
  const [lanIpv4, setLanIpv4] = useState<string | null>(null);
  const [lanIpChecked, setLanIpChecked] = useState(false);
  const installDialogRef = useRef<HTMLDivElement>(null);
  const savedPortRef = useRef(8317);
  const processNoticeTimerRef = useRef<number | null>(null);
  const copiedApiTimerRef = useRef<number | null>(null);

  const showProcessNotice = (msg: string, tone: MessageType) => {
    if (processNoticeTimerRef.current !== null) {
      window.clearTimeout(processNoticeTimerRef.current);
    }
    setProcessNotice({ message: msg, tone });
    processNoticeTimerRef.current = window.setTimeout(() => {
      setProcessNotice(null);
      processNoticeTimerRef.current = null;
    }, 3600);
  };

  const applyInstallTask = (task: CoreInstallTask, showFinishedDialog = true) => {
    if (!task.running && !task.message && !task.result) {
      setProgress(null);
      setInstalling(false);
      setCancellingInstall(false);
      return;
    }
    setInstalling(task.running);
    if (!task.running) setCancellingInstall(false);

    if (task.running || showFinishedDialog) {
      setProgress(task);
      setInstallDialogOpen(true);
    } else {
      setProgress(null);
    }

    if (task.result) {
      setMessage(task.message || t('kernel.install.completed', { version: task.result.version }));
      setMessageType('success');
      void refreshStatus();
      return;
    }

    if (task.message) {
      setMessage(task.message);
      setMessageType(task.phase === '安装失败' ? 'error' : 'info');
    }
  };

  useEffect(() => {
    let disposed = false;
    let unlisten: (() => void) | null = null;
    let unlistenConfig: (() => void) | null = null;

    listen<CoreInstallTask>('core-install-progress', (event) => {
      applyInstallTask(event.payload);
    })
      .then((unlistenProgress) => {
        if (disposed) unlistenProgress();
        else unlisten = unlistenProgress;
      })
      .catch((error) => {
        if (!disposed) {
          setMessage(t('kernel.error.progressListener', { error: String(error) }));
          setMessageType('error');
        }
      });

    void listen('config-files-changed', () => {
      if (disposed) return;
      void loadGuiSettings();
      void refreshStatus();
      if (view === 'home') void loadHomeApiKey();
    }).then((stop) => {
      if (disposed) stop();
      else unlistenConfig = stop;
    });

    loadPlatform();
    loadBundledCore();
    loadInstallTask();
    loadGuiSettings();
    void getVersion()
      .then((version) => {
        if (!disposed) setInstalledAppVersion(version);
      })
      .catch(() => undefined);
    if (view === 'home') void loadHomeApiKey();

    if (!latestAutoCheckStarted) {
      latestAutoCheckStarted = true;
      void checkLatest();
    } else if (latestCheckPromise) {
      void checkLatest();
    }

    return () => {
      disposed = true;
      unlisten?.();
      unlistenConfig?.();
      if (processNoticeTimerRef.current !== null) window.clearTimeout(processNoticeTimerRef.current);
      if (copiedApiTimerRef.current !== null) window.clearTimeout(copiedApiTimerRef.current);
    };
  }, []);

  useEffect(() => {
    if (!installDialogOpen) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    installDialogRef.current?.focus();

    const preventEscapeClose = (event: KeyboardEvent) => {
      if (event.key === 'Escape') event.preventDefault();
    };
    document.addEventListener('keydown', preventEscapeClose);

    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener('keydown', preventEscapeClose);
    };
  }, [installDialogOpen]);

  useEffect(() => {
    let disposed = false;
    if (!allowLanAccess) {
      setLanIpv4(null);
      setLanIpChecked(false);
      return;
    }

    setLanIpChecked(false);
    invoke<string | null>('get_lan_ipv4')
      .then((address) => {
        if (!disposed) setLanIpv4(address || null);
      })
      .catch(() => {
        if (!disposed) setLanIpv4(null);
      })
      .finally(() => {
        if (!disposed) setLanIpChecked(true);
      });

    return () => {
      disposed = true;
    };
  }, [allowLanAccess]);

  const runCoreProcessCommand = async (
    command: CoreProcessCommand,
    messages?: { success?: string; failure?: string },
  ) => {
    const actionLabel =
      command === 'start_core_process'
        ? t('kernel.action.start')
        : command === 'stop_core_process'
          ? t('kernel.action.stop')
          : t('kernel.action.restart');
    setProcessBusy(true);

    try {
      const result = await invoke<CoreStatus>(command);
      publishStatus(result);
      showProcessNotice(messages?.success ?? t('kernel.notice.actionSuccess', { action: actionLabel }), 'success');
      return true;
    } catch (error) {
      const errorMessage = String(error);
      await refreshStatus();
      showProcessNotice(
        messages?.failure
          ? `${messages.failure}: ${errorMessage}`
          : t('kernel.notice.actionFailed', { action: actionLabel, error: errorMessage }),
        'error',
      );
      return false;
    } finally {
      setProcessBusy(false);
    }
  };

  const loadGuiSettings = async () => {
    try {
      const settings = await invoke<GuiSettings>('get_gui_settings');
      setAllowLanAccess(settings.allowLan);
      setCustomPort(String(settings.port));
      savedPortRef.current = settings.port;
    } catch {}
  };

  const loadHomeApiKey = async () => {
    try {
      const settings = await invoke<CoreConfigSummary>('get_core_config_settings');
      setHomeApiKey(settings.apiKeys[0]?.apiKey ?? null);
      setHomeApiKeyError(false);
    } catch {
      setHomeApiKey(undefined);
      setHomeApiKeyError(true);
    }
  };

  const loadPlatform = async () => {
    try {
      const result = await invoke<CorePlatform>('detect_core_platform');
      setPlatform(result);
      setPlatformError('');
    } catch (error) {
      setPlatform(null);
      setPlatformError(String(error));
    }
  };

  const loadBundledCore = async () => {
    try {
      const result = await invoke<BundledCoreInfo | null>('detect_bundled_core');
      setBundledCore(result);
      setBundledCoreError('');
    } catch (error) {
      setBundledCore(null);
      setBundledCoreError(String(error));
    }
  };

  const checkLatest = async () => {
    setCheckingLatest(true);
    setLatestError('');
    setMessage('');
    setMessageType('info');

    try {
      const result = await requestLatestCore();
      setLatest(result);
    } catch (error) {
      setLatest(null);
      setLatestError(String(error));
    } finally {
      setCheckingLatest(false);
    }
  };

  const loadInstallTask = async () => {
    try {
      const task = await invoke<CoreInstallTask>('get_core_install_task');
      applyInstallTask(task, false);
    } catch (error) {
      setMessage(t('kernel.error.installTask', { error: String(error) }));
      setMessageType('error');
    }
  };

  const installVersion = async (version: string) => {
    setInstalling(true);
    setMessage(t('kernel.install.installingVersion', { version }));
    setMessageType('info');
    setCancellingInstall(false);
    setInstallDialogOpen(true);
    setProgress({
      running: true,
      cancellable: true,
      phase: '准备下载',
      downloaded: 0,
      total: null,
      percent: null,
      message: null,
      result: null,
    });

    try {
      const result = await invoke<CoreInstallResult>('install_core_version', { version });
      setMessage(t('kernel.install.completed', { version: result.version }));
      setMessageType('success');
      setProgress({
        running: false,
        cancellable: false,
        phase: '安装完成',
        downloaded: 1,
        total: 1,
        percent: 100,
        message: t('kernel.install.completed', { version: result.version }),
        result,
      });
      await Promise.all([refreshStatus(), loadBundledCore()]);
    } catch (error) {
      const errorMessage = String(error);
      setMessage(errorMessage);
      setMessageType(errorMessage.includes('取消') ? 'info' : 'error');
      setProgress((current) => ({
        running: false,
        cancellable: false,
        phase: errorMessage.includes('取消') ? '已取消' : '安装失败',
        downloaded: current?.downloaded ?? 0,
        total: current?.total ?? null,
        percent: current?.percent ?? null,
        message: errorMessage,
        result: null,
      }));
    } finally {
      setInstalling(false);
    }
  };

  const installBundledCore = async () => {
    if (!bundledCore) return;

    setInstalling(true);
    setMessage(t('kernel.install.installingBundled', { version: bundledCore.version }));
    setMessageType('info');
    setCancellingInstall(false);
    setInstallDialogOpen(true);
    setProgress({
      running: true,
      cancellable: false,
      phase: '准备内置内核',
      downloaded: 0,
      total: bundledCore.sizeBytes,
      percent: 0,
      message: null,
      result: null,
    });
    try {
      const result = await invoke<CoreInstallResult>('install_bundled_core');
      setMessage(t('kernel.install.bundledCompleted', { version: result.version }));
      setMessageType('success');
      await Promise.all([refreshStatus(), loadBundledCore()]);
    } catch (error) {
      const errorMessage = String(error);
      setMessage(errorMessage);
      setMessageType('error');
      setProgress((current) => ({
        running: false,
        cancellable: false,
        phase: '安装失败',
        downloaded: current?.downloaded ?? 0,
        total: current?.total ?? null,
        percent: current?.percent ?? null,
        message: errorMessage,
        result: null,
      }));
    } finally {
      setInstalling(false);
    }
  };

  const cancelInstall = async () => {
    if (cancellingInstall || !progress?.running || !progress.cancellable) {
      return;
    }
    setCancellingInstall(true);
    setMessage(t('kernel.install.cancelling'));
    setMessageType('info');
    try {
      await invoke('cancel_core_install');
    } catch (error) {
      setCancellingInstall(false);
      setMessage(String(error));
      setMessageType('error');
    }
  };

  const closeInstallDialog = () => {
    if (installing || progress?.running) return;
    setInstallDialogOpen(false);
    setProgress(null);
    setCancellingInstall(false);
  };

  const copyApiValue = async (value: string, field: string, messageText: string) => {
    try {
      await navigator.clipboard.writeText(value);
      setCopiedApiField(field);
      showProcessNotice(messageText, 'success');
      if (copiedApiTimerRef.current !== null) {
        window.clearTimeout(copiedApiTimerRef.current);
      }
      copiedApiTimerRef.current = window.setTimeout(() => {
        setCopiedApiField('');
        copiedApiTimerRef.current = null;
      }, 1800);
    } catch {
      showProcessNotice(t('kernel.notice.copyFailed'), 'error');
    }
  };

  const openAppRelease = async () => {
    try {
      await invoke('open_external_url', { url: appUpdate?.releaseUrl || APP_RELEASE_URL });
    } catch (error) {
      showProcessNotice(t('kernel.error.openUpdate', { error: String(error) }), 'error');
    }
  };

  const updateCodexModelCatalog = async () => {
    setCatalogUpdating(true);
    setCatalogUpdateError('');
    setCatalogUpdateNotice('');
    try {
      const result = await invoke<CodexModelCatalogUpdateResult>('update_codex_model_catalog');
      setCatalogUpdateNotice(result.outcome === 'updated'
        ? t('appUpdate.catalog.updated')
        : t('appUpdate.catalog.unchanged'));
    } catch (error) {
      setCatalogUpdateError(String(error));
    } finally {
      setCatalogUpdating(false);
    }
  };

  const latestVersion = latest?.version ?? '';
  const currentVersion = coreStatus?.currentVersion ?? '';
  const coreInstalled = Boolean(coreStatus?.installed);
  const coreRunning = Boolean(coreStatus?.running);
  const coreProcessBusy = processBusy || Boolean(coreStatus?.starting);
  const busy = checkingLatest || installing || coreProcessBusy;
  const installDisabled = busy || Boolean(coreStatus?.running);
  const offlineInstallDisabled = installing || coreProcessBusy || coreRunning;
  const computedPercent =
    progress?.percent ??
    (progress?.total && progress.total > 0 ? (progress.downloaded / progress.total) * 100 : null);
  const progressKnown = computedPercent !== null;
  const progressPercent = clampPercent(computedPercent ?? 0);
  const progressText = progress
    ? progress.phase === '安装完成'
      ? t('kernel.progress.completed')
      : progress.phase === '解压中'
        ? t('kernel.progress.extracting')
        : progress.total
          ? `${formatBytes(progress.downloaded)} / ${formatBytes(progress.total)}`
          : progress.downloaded > 0
            ? formatBytes(progress.downloaded)
            : t('kernel.progress.waiting')
    : '';
  const statusTone = statusError ? 'error' : coreRunning ? 'success' : 'neutral';
  const statusLabel = coreStatus
    ? coreRunning
      ? t('kernel.status.running')
      : coreInstalled
        ? t('kernel.status.stopped')
        : t('kernel.status.notInstalled')
    : statusError
      ? t('common.detectionFailed')
      : t('common.detecting');
  const resolvedAppVersion = appUpdate?.currentVersion || installedAppVersion;
  const currentAppVersion = resolvedAppVersion
    ? displayAppVersion(resolvedAppVersion)
    : t('common.detecting');
  const latestLabel = checkingLatest
    ? t('kernel.update.checking')
    : latestVersion || (latestError ? t('kernel.update.failed') : t('kernel.update.notChecked'));
  const updateStateLabel = checkingLatest
    ? t('kernel.update.statusChecking')
    : latestError
      ? t('kernel.update.failed')
      : !latestVersion
        ? t('kernel.update.notYetChecked')
        : currentVersion === latestVersion
          ? t('kernel.update.latest')
          : t('kernel.update.available');
  const platformOsLabel = platform?.os || (platformError ? t('common.detectionFailed') : t('common.detecting'));
  const platformArchLabel = platform?.arch || (platformError ? t('common.detectionFailed') : t('common.detecting'));
  const installTaskRunning = Boolean(installing || progress?.running);
  const offlineInstallRequired = Boolean(coreStatus && !coreInstalled && latestError);
  const versionStatusLabel = installTaskRunning
    ? cancellingInstall
      ? t('kernel.install.cancelling')
      : progress?.phase ? localizeInstallPhase(progress.phase, t) : t('kernel.install.inProgress')
    : offlineInstallRequired
      ? t('kernel.install.githubFailed')
      : message || updateStateLabel;
  const versionStatusTone: MessageType | 'update' = installTaskRunning
    ? 'info'
    : offlineInstallRequired
      ? 'error'
      : message
        ? messageType
        : currentVersion && latestVersion && currentVersion !== latestVersion
          ? 'update'
          : latestError
            ? 'error'
            : 'info';
  const apiProfiles = clientApiProfiles(savedPortRef.current, lanIpv4);
  const apiProfileIcons = {
    openai: openaiIcon,
    claude: claudeIcon,
    gemini: geminiIcon,
  } as const;
  const installDialogTitle = progress?.result
    ? t('kernel.install.titleCompleted')
    : cancellingInstall
      ? t('kernel.install.titleCancelling')
      : progress?.phase === '安装失败'
        ? t('kernel.install.titleFailed')
        : t('kernel.install.titleInstalling');
  const installDialogTone: MessageType = progress?.result
    ? 'success'
    : progress?.phase === '安装失败'
      ? 'error'
      : 'info';
  const installDialogMessage = progress?.message || (progress?.result ? t('kernel.install.completed', { version: progress.result.version }) : '');
  const installDialogActionDisabled = cancellingInstall || (installTaskRunning && !progress?.cancellable);
  const installDialogActionLabel = installTaskRunning
    ? cancellingInstall
      ? t('kernel.install.cancelling')
      : t('kernel.install.cancel')
    : t('common.close');

  return (
    <section className="space-y-6 max-w-6xl mx-auto">
      {/* Process Notice Toast */}
      {processNotice && (
        <div
          className={cn(
            'flex items-center justify-between gap-3 rounded-xl border px-4 py-3 text-xs font-semibold shadow-lg transition-all animate-in fade-in slide-in-from-top-2',
            processNotice.tone === 'success'
              ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400'
              : processNotice.tone === 'error'
                ? 'border-destructive/30 bg-destructive/10 text-destructive'
                : 'border-indigo-500/30 bg-indigo-500/10 text-indigo-600 dark:text-indigo-400',
          )}
        >
          <div className="flex items-center gap-2">
            {processNotice.tone === 'success' ? <Check size={16} /> : <AlertCircle size={16} />}
            <span>{processNotice.message}</span>
          </div>
          <button
            type="button"
            onClick={() => setProcessNotice(null)}
            className="text-xs opacity-70 hover:opacity-100 cursor-pointer"
          >
            ✕
          </button>
        </div>
      )}

      {/* ===================== HOME VIEW: COMMAND CENTER ===================== */}
      {view === 'home' && (
        <div className="space-y-6">
          {/* HERO STATUS CARD */}
          <div className="relative overflow-hidden rounded-2xl border border-border/60 bg-gradient-to-br from-card via-card/90 to-primary/5 p-6 shadow-sm">
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-center">
              {/* Core Status & Version Info */}
              <div className="lg:col-span-5 border-b lg:border-b-0 lg:border-r border-border/40 pb-5 lg:pb-0 lg:pr-6 space-y-3">
                <div className="flex items-center gap-3.5">
                  <div
                    className={cn(
                      'size-12 rounded-2xl flex items-center justify-center border shadow-inner transition-colors',
                      coreRunning
                        ? 'bg-emerald-500/15 border-emerald-500/30 text-emerald-600 dark:text-emerald-400'
                        : 'bg-muted border-border text-muted-foreground',
                    )}
                  >
                    <Server size={24} />
                  </div>
                  <div>
                    <div className="flex items-center gap-2">
                      <h2 className="text-base font-bold tracking-tight text-foreground">
                        CLIProxyAPI Core
                      </h2>
                      <span
                        className={cn(
                          'inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[11px] font-semibold border',
                          coreRunning
                            ? 'bg-emerald-500/15 border-emerald-500/30 text-emerald-600 dark:text-emerald-400'
                            : 'bg-muted border-border text-muted-foreground',
                        )}
                      >
                        <span
                          className={cn(
                            'size-1.5 rounded-full',
                            coreRunning ? 'bg-emerald-500 animate-pulse' : 'bg-slate-400',
                          )}
                        />
                        {coreProcessBusy ? t('common.processing') : statusLabel}
                      </span>
                    </div>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      {t('kernel.overview.coreVersion')}: <strong className="font-mono text-foreground">{currentVersion || t('kernel.status.notInstalled')}</strong>
                      {' · '}{displayAppVersion(currentAppVersion)}
                    </p>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-2 text-xs pt-1">
                  <div className="p-2.5 bg-muted/40 rounded-xl border border-border/40">
                    <span className="text-[10.5px] font-semibold uppercase tracking-wider text-muted-foreground block">
                      Local Endpoint
                    </span>
                    <strong className="font-mono text-primary text-xs truncate block mt-0.5">
                      127.0.0.1:{savedPortRef.current}
                    </strong>
                  </div>
                  <div className="p-2.5 bg-muted/40 rounded-xl border border-border/40">
                    <span className="text-[10.5px] font-semibold uppercase tracking-wider text-muted-foreground block">
                      {t('kernel.control.pid')}
                    </span>
                    <strong className="font-mono text-foreground text-xs truncate block mt-0.5">
                      {coreStatus?.processId || t('kernel.control.noPid')}
                    </strong>
                  </div>
                </div>
              </div>

              {/* Action Controls & Telemetry */}
              <div className="lg:col-span-7 flex flex-col justify-between gap-4">
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  <div className="p-3 bg-muted/30 rounded-xl border border-border/40 flex flex-col justify-between">
                    <span className="text-xs text-muted-foreground font-medium flex items-center justify-between">
                      Architecture <Cpu size={14} className="text-primary" />
                    </span>
                    <span className="text-sm font-bold font-mono text-foreground mt-1 truncate">
                      {platformOsLabel}-{platformArchLabel}
                    </span>
                  </div>

                  <div className="p-3 bg-muted/30 rounded-xl border border-border/40 flex flex-col justify-between">
                    <span className="text-xs text-muted-foreground font-medium flex items-center justify-between">
                      LAN Access <Globe size={14} className="text-cyan-500" />
                    </span>
                    <span className="text-sm font-bold text-foreground mt-1">
                      {allowLanAccess ? (lanIpv4 || 'Enabled') : 'Disabled'}
                    </span>
                  </div>

                  <div className="p-3 bg-muted/30 rounded-xl border border-border/40 flex flex-col justify-between">
                    <span className="text-xs text-muted-foreground font-medium flex items-center justify-between">
                      API Status <Zap size={14} className="text-amber-500" />
                    </span>
                    <span className="text-sm font-bold text-foreground mt-1">
                      {coreRunning ? t('kernel.access.connectable') : t('kernel.access.waiting')}
                    </span>
                  </div>
                </div>

                {/* Primary Action Buttons Bar */}
                <div className="flex flex-wrap items-center gap-2.5 pt-1">
                  <Button
                    type="button"
                    variant={coreRunning ? 'destructive' : 'default'}
                    className="flex-1 min-w-[130px] font-semibold text-xs shadow-sm cursor-pointer"
                    disabled={!coreInstalled || installing || coreProcessBusy}
                    onClick={() =>
                      void runCoreProcessCommand(
                        coreRunning ? 'stop_core_process' : 'start_core_process',
                        { success: coreRunning ? t('kernel.notice.stopped') : t('kernel.notice.started') },
                      )
                    }
                  >
                    <Power size={14} className="mr-1.5" />
                    {coreProcessBusy ? t('common.processing') : coreRunning ? t('kernel.action.stop') : t('kernel.action.start')}
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    className="flex-1 min-w-[110px] text-xs font-semibold cursor-pointer"
                    disabled={!coreInstalled || !coreRunning || installing || coreProcessBusy}
                    onClick={() =>
                      void runCoreProcessCommand('restart_core_process', { success: t('kernel.notice.restarted') })
                    }
                  >
                    <RotateCcw size={14} className="mr-1.5" />
                    {t('kernel.action.restart')}
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    size="icon"
                    className="size-9 rounded-xl text-muted-foreground hover:text-foreground cursor-pointer"
                    title={t('kernel.control.refresh')}
                    disabled={coreProcessBusy}
                    onClick={() => void refreshStatus()}
                  >
                    <RefreshCw size={15} />
                  </Button>
                </div>
              </div>
            </div>
          </div>

          {/* STANDARDIZED API ENDPOINTS SECTION */}
          <div className="space-y-4">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
              <div>
                <h3 className="text-base font-bold tracking-tight text-foreground flex items-center gap-2">
                  <Network size={18} className="text-primary" />
                  {t('kernel.apiUrl.title')}
                </h3>
                <p className="text-xs text-muted-foreground">
                  Các cổng kết nối cục bộ chuẩn hóa tương thích với các AI Coding Agents và IDE extensions
                </p>
              </div>

              {/* Primary API Key Display */}
              {typeof homeApiKey === 'string' && (
                <div className="flex items-center gap-2 bg-card border rounded-xl px-3 py-1.5 shadow-xs">
                  <span className="text-xs font-medium text-muted-foreground">{t('kernel.access.firstKey')}:</span>
                  <code className="font-mono text-xs text-primary font-bold">
                    {showHomeApiKey ? homeApiKey : '••••••••••••••••'}
                  </code>
                  <button
                    type="button"
                    className="p-1 rounded-md text-muted-foreground hover:text-foreground transition-colors cursor-pointer"
                    title={showHomeApiKey ? t('config.keys.hide') : t('config.keys.show')}
                    onClick={() => setShowHomeApiKey((v) => !v)}
                  >
                    {showHomeApiKey ? <EyeOff size={13} /> : <Eye size={13} />}
                  </button>
                  <button
                    type="button"
                    className="p-1 rounded-md text-muted-foreground hover:text-foreground transition-colors cursor-pointer"
                    title={t('config.keys.copy')}
                    onClick={() =>
                      void copyApiValue(
                        homeApiKey,
                        'home:api-key',
                        t('config.notice.keyCopied'),
                      )
                    }
                  >
                    {copiedApiField === 'home:api-key' ? (
                      <Check size={13} className="text-emerald-500" />
                    ) : (
                      <Copy size={13} />
                    )}
                  </button>
                </div>
              )}
            </div>

            {/* 3-Column API Profiles Grid */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              {apiProfiles.map((profile) => (
                <div
                  key={profile.id}
                  className="rounded-2xl border bg-card/60 backdrop-blur-sm p-4 hover:border-primary/40 hover:shadow-md transition-all flex flex-col justify-between gap-4 group"
                >
                  <div>
                    <div className="flex items-center justify-between gap-2 mb-3">
                      <div className="flex items-center gap-2.5">
                        <div className="size-8.5 rounded-xl border bg-background flex items-center justify-center p-1 shadow-xs">
                          <img src={apiProfileIcons[profile.id]} alt="" className="size-5" />
                        </div>
                        <div>
                          <strong className="text-sm font-bold block text-foreground">{profile.name} Format</strong>
                          <span className="text-[11px] text-muted-foreground block truncate">
                            {profile.description}
                          </span>
                        </div>
                      </div>
                      <Badge variant={coreRunning ? 'success' : 'secondary'} className="text-[10px]">
                        {profile.id === 'openai' ? '/v1' : profile.id === 'claude' ? '/v1/messages' : 'v1beta'}
                      </Badge>
                    </div>

                    {/* Base URL Copy Box */}
                    <div className="p-2.5 rounded-xl bg-background/80 border text-xs font-mono flex items-center justify-between gap-2">
                      <code className="truncate text-foreground font-semibold" title={profile.baseUrl}>
                        {profile.baseUrl}
                      </code>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon-sm"
                        className="size-7 shrink-0 text-muted-foreground hover:text-foreground cursor-pointer"
                        onClick={() =>
                          void copyApiValue(
                            profile.baseUrl,
                            `${profile.id}:base`,
                            t('kernel.access.localCopied', { name: profile.name }),
                          )
                        }
                        title={t('kernel.access.copyLocal', { name: profile.name })}
                      >
                        {copiedApiField === `${profile.id}:base` ? (
                          <Check size={13} className="text-emerald-500" />
                        ) : (
                          <Copy size={13} />
                        )}
                      </Button>
                    </div>

                    {/* LAN URL if enabled */}
                    {allowLanAccess && profile.lanUrl && (
                      <div className="p-2.5 rounded-xl bg-muted/40 border text-xs font-mono flex items-center justify-between gap-2 mt-2">
                        <div className="min-w-0">
                          <span className="text-[10px] text-muted-foreground font-sans block uppercase font-semibold">
                            {t('kernel.access.lanUrl')}
                          </span>
                          <code className="truncate text-foreground font-semibold block" title={profile.lanUrl}>
                            {profile.lanUrl}
                          </code>
                        </div>
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon-sm"
                          className="size-7 shrink-0 text-muted-foreground hover:text-foreground cursor-pointer"
                          onClick={() =>
                            void copyApiValue(
                              profile.lanUrl!,
                              `${profile.id}:lan`,
                              t('kernel.access.lanCopied', { name: profile.name }),
                            )
                          }
                          title={t('kernel.access.copyLan', { name: profile.name })}
                        >
                          {copiedApiField === `${profile.id}:lan` ? (
                            <Check size={13} className="text-emerald-500" />
                          ) : (
                            <Copy size={13} />
                          )}
                        </Button>
                      </div>
                    )}
                  </div>

                  <div className="pt-2 border-t border-border/40 flex items-center justify-between text-xs text-muted-foreground">
                    <span>
                      {profile.id === 'openai'
                        ? 'Cursor, Aider, LangChain'
                        : profile.id === 'claude'
                          ? 'Claude Code, Desktop'
                          : 'Google AI Studio SDK'}
                    </span>
                    <span className="text-emerald-500 font-semibold flex items-center gap-1">
                      <Check size={12} /> Ready
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* ===================== VERSIONS MANAGEMENT VIEW ===================== */}
      {view === 'versions' && (
        <div className="space-y-6">
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Card className="gap-1 p-4 rounded-2xl bg-card/60 backdrop-blur-sm">
              <span className="text-xs text-muted-foreground">{t('kernel.versions.current')}</span>
              <strong className="font-mono text-lg font-bold text-foreground">
                {currentVersion || t('kernel.status.notInstalled')}
              </strong>
            </Card>
            <Card className="gap-1 p-4 rounded-2xl bg-card/60 backdrop-blur-sm">
              <span className="text-xs text-muted-foreground">{t('kernel.versions.latest')}</span>
              <strong className="font-mono text-lg font-bold text-primary">{latestLabel}</strong>
            </Card>
            <Card className="gap-1 p-4 rounded-2xl bg-card/60 backdrop-blur-sm">
              <span className="text-xs text-muted-foreground">{t('kernel.versions.bundled')}</span>
              <strong
                className="truncate font-mono text-lg font-bold text-foreground"
                title={bundledCoreError || bundledCore?.assetName}
              >
                {bundledCore?.version ?? (bundledCoreError ? t('common.detectionFailed') : t('kernel.versions.notIncluded'))}
              </strong>
            </Card>
            <Card className="gap-1 p-4 rounded-2xl bg-card/60 backdrop-blur-sm">
              <span className="text-xs text-muted-foreground">{t('kernel.versions.platform')}</span>
              <strong
                className="truncate font-mono text-lg font-bold text-foreground"
                title={platformError || undefined}
              >
                {platformOsLabel} / {platformArchLabel}
              </strong>
            </Card>
          </div>

          <Card className="gap-0 p-0 overflow-hidden rounded-2xl">
            <div className="flex items-start justify-between gap-3 p-5 pb-3">
              <div>
                <h2 className="text-base font-bold text-foreground">{t('appUpdate.title')}</h2>
                <p className={cn('mt-1 text-xs', appUpdateError ? 'text-destructive' : appUpdate?.updateAvailable ? 'text-emerald-500 font-semibold' : 'text-muted-foreground')}>
                  {appUpdateError
                    || (appUpdate?.updateAvailable
                      ? t('appUpdate.available', { version: displayAppVersion(appUpdate.latestVersion) })
                      : appUpdate
                        ? t('appUpdate.upToDate')
                        : t('appUpdate.phase.checking'))}
                </p>
              </div>
              {!appUpdate?.autoUpdateSupported && (
                <Badge variant={appUpdateError ? 'destructive' : 'success'}>
                  {'Portable'}
                </Badge>
              )}
            </div>

            <div className="flex flex-wrap items-center gap-2.5 p-5 pt-2 border-t border-border/40">
              <Button
                type="button"
                variant="outline"
                className="text-xs font-semibold"
                disabled={checkingAppUpdate || Boolean(appUpdateTask?.running)}
                onClick={() => void checkAppUpdate()}
              >
                {checkingAppUpdate ? t('appUpdate.checking') : t('appUpdate.check')}
              </Button>
              {appUpdate?.updateAvailable ? (
                <Button
                  type="button"
                  className="text-xs font-semibold"
                  disabled={Boolean(appUpdateTask?.running)}
                  onClick={() => void requestAppUpdate()}
                >
                  {t('appUpdate.installNow')}
                </Button>
              ) : (
                <Button
                  type="button"
                  variant="outline"
                  className="text-xs font-semibold"
                  onClick={() => void openAppRelease()}
                >
                  <ExternalLink size={13} className="mr-1.5" />
                  {t('appUpdate.openRelease')}
                </Button>
              )}
              <Button
                type="button"
                variant="outline"
                className="text-xs font-semibold"
                disabled={catalogUpdating}
                onClick={() => void updateCodexModelCatalog()}
              >
                <RefreshCw size={13} className={cn('mr-1.5', catalogUpdating && 'animate-spin')} />
                {catalogUpdating ? t('appUpdate.catalog.updating') : t('appUpdate.catalog.update')}
              </Button>
            </div>
          </Card>

          <Card className="gap-3 p-5 rounded-2xl">
            <div className="flex flex-wrap items-center gap-2.5 mb-2">
              <Badge
                variant={
                  versionStatusTone === 'success' ? 'success'
                    : versionStatusTone === 'error' ? 'destructive'
                    : versionStatusTone === 'update' ? 'warning'
                    : 'secondary'
                }
              >
                {versionStatusLabel}
              </Badge>
              <span className="text-xs text-muted-foreground">{t('kernel.versions.offlineHint')}</span>
            </div>
            <div className="flex flex-wrap gap-2.5">
              <Button type="button" variant="outline" className="text-xs font-semibold" disabled={busy} onClick={checkLatest}>
                {checkingLatest ? t('kernel.update.checking') : t('kernel.versions.check')}
              </Button>
              <Button
                type="button"
                variant="outline"
                className="text-xs font-semibold"
                disabled={!latestVersion || installDisabled}
                onClick={() => installVersion(latestVersion)}
              >
                {t('kernel.versions.installLatest')}
              </Button>
              <Button
                type="button"
                variant="outline"
                className="text-xs font-semibold"
                disabled={!currentVersion || installDisabled}
                onClick={() => installVersion(currentVersion)}
              >
                {t('kernel.versions.reinstall')}
              </Button>
              <Button
                type="button"
                className="text-xs font-semibold"
                disabled={!bundledCore || offlineInstallDisabled}
                onClick={() => void installBundledCore()}
              >
                {t('kernel.versions.offlineInstall')}
              </Button>
            </div>
          </Card>
        </div>
      )}

      {/* INSTALL PROGRESS DIALOG */}
      {view === 'versions' && installDialogOpen && progress ? (
        <Dialog open onOpenChange={(open) => !open && !installDialogActionDisabled && (installTaskRunning ? cancelInstall() : closeInstallDialog())}>
          <DialogContent showCloseButton={false} className="sm:max-w-md" aria-busy={installTaskRunning}>
            <div>
              <span className="text-[11px] font-semibold tracking-wide text-muted-foreground uppercase">{t('kernel.dialog.install')}</span>
              <DialogTitle className="mt-1 text-lg font-semibold">{installDialogTitle}</DialogTitle>
            </div>

            <div className="flex items-center justify-between text-sm">
              <span className="text-muted-foreground">{t('kernel.dialog.phase')}</span>
              <strong className="font-semibold">{cancellingInstall ? t('kernel.install.cancellingShort') : localizeInstallPhase(progress.phase, t)}</strong>
            </div>

            <Progress value={progressKnown ? progressPercent : 33} />

            <div className="flex items-center justify-between text-sm">
              <strong className="font-semibold tabular-nums">{progressKnown ? `${progressPercent.toFixed(1)}%` : t('kernel.dialog.unknownProgress')}</strong>
              <span className="text-muted-foreground">{progressText}</span>
            </div>

            <div
              id="install-dialog-message"
              className={cn('min-h-5 text-sm', installDialogTone === 'error' ? 'text-destructive' : installDialogTone === 'success' ? 'text-emerald-500' : 'text-muted-foreground')}
              aria-live="polite"
            >
              {installDialogMessage || ' '}
            </div>

            <div className="flex justify-end gap-2">
              <Button
                type="button"
                variant={installTaskRunning ? 'destructive' : 'default'}
                disabled={installDialogActionDisabled}
                onClick={installTaskRunning ? cancelInstall : closeInstallDialog}
              >
                {installDialogActionLabel}
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      ) : null}
    </section>
  );
}

function clampPercent(value: number) {
  return Math.min(100, Math.max(0, value));
}

function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  const kb = bytes / 1024;
  if (kb < 1024) return `${kb.toFixed(1)} KB`;
  const mb = kb / 1024;
  return `${mb.toFixed(1)} MB`;
}

function localizeInstallPhase(phase: string, t: (key: any) => string): string {
  switch (phase) {
    case '准备下载':
      return t('kernel.phase.preparingDownload');
    case '下载中':
      return t('kernel.phase.downloading');
    case '准备内置内核':
      return t('kernel.phase.preparingBundled');
    case '解压中':
      return t('kernel.phase.extracting');
    case '安装完成':
      return t('kernel.phase.completed');
    case '安装失败':
      return t('kernel.phase.failed');
    case '已取消':
      return t('kernel.phase.cancelled');
    default:
      return phase;
  }
}
