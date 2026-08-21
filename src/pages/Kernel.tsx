import { useEffect, useRef, useState } from 'react';
import { getVersion } from '@tauri-apps/api/app';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { AlertCircle, Check, Copy, ExternalLink, Eye, EyeOff, Info } from 'lucide-react';
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

  const showProcessNotice = (message: string, tone: MessageType) => {
    if (processNoticeTimerRef.current !== null) {
      window.clearTimeout(processNoticeTimerRef.current);
    }

    setProcessNotice({ message, tone });
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
    if (!task.running) {
      setCancellingInstall(false);
    }

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
        if (disposed) {
          unlistenProgress();
        } else {
          unlisten = unlistenProgress;
        }
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
    if (view === 'home') {
      void loadHomeApiKey();
    }

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
      if (processNoticeTimerRef.current !== null) {
        window.clearTimeout(processNoticeTimerRef.current);
      }
      if (copiedApiTimerRef.current !== null) {
        window.clearTimeout(copiedApiTimerRef.current);
      }
    };
  }, []);

  useEffect(() => {
    if (!installDialogOpen) {
      return;
    }

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    installDialogRef.current?.focus();

    const preventEscapeClose = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
      }
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
        if (!disposed) {
          setLanIpv4(address || null);
        }
      })
      .catch(() => {
        if (!disposed) {
          setLanIpv4(null);
        }
      })
      .finally(() => {
        if (!disposed) {
          setLanIpChecked(true);
        }
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
    if (installing || progress?.running) {
      return;
    }

    setInstallDialogOpen(false);
    setProgress(null);
    setCancellingInstall(false);
  };

  const copyApiValue = async (value: string, field: string, message: string) => {
    try {
      await navigator.clipboard.writeText(value);
      setCopiedApiField(field);
      showProcessNotice(message, 'success');
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
      : latestError
        ? 'error'
        : currentVersion && currentVersion === latestVersion
          ? 'success'
          : latestVersion && currentVersion !== latestVersion
            ? 'update'
            : 'info';
  const installDialogTone: MessageType = progress?.result
    ? 'success'
    : progress?.phase === '安装失败'
      ? 'error'
      : 'info';
  const installDialogTitle = installTaskRunning
    ? cancellingInstall
      ? t('kernel.install.titleCancelling')
      : t('kernel.install.titleInstalling')
    : progress?.result
      ? t('kernel.install.titleCompleted')
      : progress?.phase === '已取消'
        ? t('kernel.install.titleCancelled')
        : t('kernel.install.titleFailed');
  const installDialogMessage = cancellingInstall
    ? t('kernel.install.waitingStop')
    : progress?.message || (installTaskRunning ? message || t('kernel.install.taskRunning') : '');
  const installDialogAction = installTaskRunning
    ? cancellingInstall
      ? t('kernel.install.cancellingShort')
      : progress?.cancellable
        ? t('kernel.install.cancel')
        : t('common.processing')
    : t('common.close');
  const installDialogActionDisabled =
    installTaskRunning && (cancellingInstall || !progress?.cancellable);
  const apiPort = Number(customPort);
  const apiProfiles = clientApiProfiles(
    Number.isInteger(apiPort) && apiPort >= 1 && apiPort <= 65535
      ? apiPort
      : savedPortRef.current,
    allowLanAccess ? lanIpv4 : null,
  );
  const apiProfileIcons = {
    openai: openaiIcon,
    claude: claudeIcon,
    gemini: geminiIcon,
  } as const;

  return (
    <section className="grid gap-4">
      <div className={view === 'home' ? 'grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,380px)_minmax(0,1fr)] lg:items-start' : 'grid gap-4'}>
        {view === 'home' ? (
        <Card className="gap-0 p-0">
          <div className="flex items-center justify-between gap-3 p-4 pb-3">
            <h2 className="text-base font-semibold">{t('kernel.control.title')}</h2>
            <Badge variant={statusTone === 'success' ? 'success' : statusTone === 'error' ? 'destructive' : 'secondary'} title={statusError || undefined}>
              {coreProcessBusy ? t('common.processing') : statusLabel}
            </Badge>
          </div>

          <dl className="px-4">
            <div className="flex items-center justify-between gap-3 border-t py-2.5 text-sm">
              <dt className="text-muted-foreground">{t('kernel.control.installStatus')}</dt>
              <dd className="font-medium">{coreStatus ? (coreInstalled ? t('kernel.control.installed') : t('kernel.status.notInstalled')) : t('common.detecting')}</dd>
            </div>
            <div className="flex items-center justify-between gap-3 border-t py-2.5 text-sm">
              <dt className="text-muted-foreground">{t('kernel.control.runStatus')}</dt>
              <dd className="font-medium">{coreStatus ? (coreRunning ? t('kernel.status.running') : t('kernel.control.notRunning')) : t('common.detecting')}</dd>
            </div>
            <div className="flex items-center justify-between gap-3 border-t py-2.5 text-sm">
              <dt className="text-muted-foreground">{t('kernel.control.pid')}</dt>
              <dd className="font-mono font-medium">{coreStatus?.processId || t('kernel.control.noPid')}</dd>
            </div>
            <div className="flex items-center justify-between gap-3 border-t py-2.5 text-sm">
              <dt className="text-muted-foreground">{t('kernel.overview.coreVersion')}</dt>
              <dd className="font-mono font-medium">
                {currentVersion
                  || (coreInstalled ? t('common.unavailable') : t('kernel.status.notInstalled'))}
              </dd>
            </div>
            <div className="flex items-center justify-between gap-3 border-t py-2.5 text-sm">
              <dt className="text-muted-foreground">{t('kernel.overview.appVersion')}</dt>
              <dd className="font-mono font-medium">{currentAppVersion}</dd>
            </div>
          </dl>

          <div className="flex gap-2 border-t p-4">
            <Button
              type="button"
              variant={coreRunning ? 'destructive' : 'default'}
              className="flex-1"
              disabled={!coreInstalled || installing || coreProcessBusy}
              onClick={() =>
                void runCoreProcessCommand(
                  coreRunning ? 'stop_core_process' : 'start_core_process',
                  { success: coreRunning ? t('kernel.notice.stopped') : t('kernel.notice.started') },
                )
              }
            >
              {coreProcessBusy ? t('common.processing') : coreRunning ? t('kernel.action.stop') : t('kernel.action.start')}
            </Button>
            <Button
              type="button"
              variant="outline"
              className="flex-1"
              disabled={!coreInstalled || !coreRunning || installing || coreProcessBusy}
              onClick={() =>
                void runCoreProcessCommand('restart_core_process', { success: t('kernel.notice.restarted') })
              }
            >
              {t('kernel.action.restart')}
            </Button>
            <Button
              type="button"
              variant="outline"
              className="flex-1"
              disabled={coreProcessBusy}
              onClick={() => void refreshStatus()}
            >
              {t('kernel.control.refresh')}
            </Button>
          </div>
        </Card>
        ) : null}

        {view === 'versions' ? (
          <Card className="gap-0 p-0">
            <div className="flex items-start justify-between gap-3 p-4 pb-3">
              <div>
                <h2 className="text-base font-semibold">{t('appUpdate.title')}</h2>
                <p className={cn('mt-1 text-sm', appUpdateError ? 'text-destructive' : appUpdate?.updateAvailable ? 'text-[var(--theme-2f6b3f)]' : 'text-muted-foreground')}>
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
                  {t('appUpdate.manualFallback')}
                </Badge>
              )}
            </div>

            <dl className="px-4">
              <div className="flex items-center justify-between gap-3 border-t py-2.5 text-sm">
                <dt className="text-muted-foreground">{t('appUpdate.current')}</dt>
                <dd className="font-mono font-medium">{currentAppVersion}</dd>
              </div>
              <div className="flex items-center justify-between gap-3 border-t py-2.5 text-sm">
                <dt className="text-muted-foreground">{t('appUpdate.latest')}</dt>
                <dd className="font-mono font-medium">{appUpdate ? displayAppVersion(appUpdate.latestVersion) : t('common.detecting')}</dd>
              </div>
              <div className="flex items-center justify-between gap-3 border-t py-2.5 text-sm">
                <dt className="text-muted-foreground">{t('appUpdate.status')}</dt>
                <dd className={cn('font-medium', appUpdateError ? 'text-destructive' : appUpdate?.updateAvailable ? 'text-[var(--theme-2f6b3f)]' : undefined)}>
                  {appUpdateTask.running
                    ? t(`appUpdate.phase.${appUpdateTask.phase}` as Parameters<typeof t>[0])
                    : appUpdateError
                      ? t('kernel.update.failed')
                      : appUpdate?.updateAvailable
                        ? t('appUpdate.available', { version: displayAppVersion(appUpdate.latestVersion) })
                        : appUpdate
                          ? t('appUpdate.upToDate')
                          : t('appUpdate.phase.checking')}
                </dd>
              </div>
              <div className="flex items-center justify-between gap-3 border-t py-2.5 text-sm">
                <dt className="text-muted-foreground">{t('appUpdate.catalog.label')}</dt>
                <dd
                  className={cn('font-medium', catalogUpdateError ? 'text-destructive' : catalogUpdateNotice ? 'text-[var(--theme-2f6b3f)]' : undefined)}
                  role={catalogUpdateError ? 'alert' : undefined}
                  aria-live="polite"
                >
                  {catalogUpdateError
                    || catalogUpdateNotice
                    || t('appUpdate.catalog.description')}
                </dd>
              </div>
            </dl>

            <div className="flex flex-wrap gap-2 border-t p-4">
              <Button type="button" variant="outline" disabled={checkingAppUpdate || appUpdateTask.running} onClick={() => void checkAppUpdate()}>
                {checkingAppUpdate ? t('appUpdate.checking') : t('appUpdate.check')}
              </Button>
              {appUpdate?.updateAvailable && appUpdate.autoUpdateSupported ? (
                <Button type="button" disabled={appUpdateTask.running} onClick={requestAppUpdate}>
                  {t('appUpdate.installNow')}
                </Button>
              ) : (
                <Button type="button" variant="outline" onClick={() => void openAppRelease()}>
                  {t('appUpdate.openRelease')} <ExternalLink size={14} aria-hidden="true" />
                </Button>
              )}
              <Button type="button" variant="outline" disabled={catalogUpdating || appUpdateTask.running} onClick={() => void updateCodexModelCatalog()} title={t('appUpdate.catalog.updateHint')}>
                {catalogUpdating
                  ? t('appUpdate.catalog.updating')
                  : t('appUpdate.catalog.update')}
              </Button>
            </div>
          </Card>
        ) : null}

        {view === 'versions' ? (
          <div className="grid gap-4">
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <Card className="gap-1 p-4">
                <span className="text-xs text-muted-foreground">{t('kernel.versions.current')}</span>
                <strong className="font-mono text-lg font-semibold">{currentVersion || t('kernel.status.notInstalled')}</strong>
              </Card>
              <Card className="gap-1 p-4">
                <span className="text-xs text-muted-foreground">{t('kernel.versions.latest')}</span>
                <strong className="font-mono text-lg font-semibold">{latestLabel}</strong>
              </Card>
              <Card className="gap-1 p-4">
                <span className="text-xs text-muted-foreground">{t('kernel.versions.bundled')}</span>
                <strong className="truncate font-mono text-lg font-semibold" title={bundledCoreError || bundledCore?.assetName}>
                  {bundledCore?.version ?? (bundledCoreError ? t('common.detectionFailed') : t('kernel.versions.notIncluded'))}
                </strong>
              </Card>
              <Card className="gap-1 p-4">
                <span className="text-xs text-muted-foreground">{t('kernel.versions.platform')}</span>
                <strong className="truncate font-mono text-lg font-semibold" title={platformError || undefined}>{platformOsLabel} / {platformArchLabel}</strong>
              </Card>
            </div>

            <Card className="gap-3 p-4">
              <div className="flex flex-wrap items-center gap-2.5">
                <Badge
                  variant={
                    versionStatusTone === 'success' ? 'success'
                      : versionStatusTone === 'error' ? 'destructive'
                      : versionStatusTone === 'update' ? 'warning'
                      : 'secondary'
                  }
                  title={versionStatusLabel}
                >
                  {versionStatusLabel}
                </Badge>
                <span className="text-sm text-muted-foreground">{t('kernel.versions.offlineHint')}</span>
              </div>
              <div className="flex flex-wrap gap-2">
                <Button type="button" variant="outline" disabled={busy} onClick={checkLatest}>
                  {checkingLatest ? t('kernel.update.checking') : t('kernel.versions.check')}
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  title={latestVersion ? t('kernel.versions.installVersion', { version: latestVersion }) : t('kernel.versions.installLatest')}
                  disabled={!latestVersion || installDisabled}
                  onClick={() => installVersion(latestVersion)}
                >
                  {t('kernel.versions.installLatest')}
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  title={t('kernel.versions.reinstallTitle')}
                  disabled={!currentVersion || installDisabled}
                  onClick={() => installVersion(currentVersion)}
                >
                  {t('kernel.versions.reinstall')}
                </Button>
                <Button
                  type="button"
                  title={(bundledCore?.assetName ?? bundledCoreError) || t('kernel.versions.noBundled')}
                  disabled={!bundledCore || offlineInstallDisabled}
                  onClick={() => void installBundledCore()}
                >
                  {t('kernel.versions.offlineInstall')}
                </Button>
              </div>
            </Card>
          </div>
        ) : null}
      </div>

      {view === 'home' ? (
      <Card className="gap-0 p-0">
        <div className="flex flex-wrap items-start justify-between gap-3 p-4 pb-3">
          <div>
            <h2 className="text-base font-semibold">{t('kernel.apiUrl.title')}</h2>
            {typeof homeApiKey === 'string' ? (
              <div className="mt-2 flex items-center gap-2">
                <button
                  type="button"
                  className="flex items-center gap-2 rounded-md border px-2.5 py-1.5 text-sm hover:bg-accent"
                  aria-pressed={showHomeApiKey}
                  title={showHomeApiKey ? t('config.keys.hide') : t('config.keys.show')}
                  onClick={() => setShowHomeApiKey((visible) => !visible)}
                >
                  <span>{t('kernel.access.firstKey')}</span>
                  <code>{showHomeApiKey ? homeApiKey : '******'}</code>
                  {showHomeApiKey ? (
                    <EyeOff size={14} aria-hidden="true" />
                  ) : (
                    <Eye size={14} aria-hidden="true" />
                  )}
                </button>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  title={t('config.keys.copy')}
                  aria-label={t('config.keys.copy')}
                  onClick={() =>
                    void copyApiValue(
                      homeApiKey,
                      'home:api-key',
                      t('config.notice.keyCopied'),
                    )
                  }
                >
                  {copiedApiField === 'home:api-key' ? (
                    <Check size={14} aria-hidden="true" />
                  ) : (
                    <Copy size={14} aria-hidden="true" />
                  )}
                </Button>
              </div>
            ) : homeApiKey === null ? (
              <p className="mt-2 text-sm text-muted-foreground">{t('kernel.access.noConfiguredKey')}</p>
            ) : (
              <p className={cn('mt-2 text-sm', homeApiKeyError ? 'text-destructive' : 'text-muted-foreground')}>
                {homeApiKeyError ? t('common.unavailable') : t('common.loading')}
              </p>
            )}
          </div>
          <Badge variant={coreRunning ? 'success' : 'secondary'}>
            {coreRunning ? t('kernel.access.connectable') : t('kernel.access.waiting')}
          </Badge>
        </div>

        <div className="grid grid-cols-1 gap-3 p-4 pt-1 sm:grid-cols-2 lg:grid-cols-3">
          {apiProfiles.map((profile) => (
            <article className="rounded-lg border bg-muted/40 p-3.5" key={profile.id}>
              <div className="flex items-center gap-2.5">
                <span className="flex size-8 shrink-0 items-center justify-center rounded-md border bg-card">
                  <img src={apiProfileIcons[profile.id]} alt="" className="size-4" />
                </span>
                <div className="min-w-0">
                  <strong className="block text-sm font-semibold">{profile.name}</strong>
                  <span className="block truncate text-xs text-muted-foreground">{profile.description}</span>
                </div>
              </div>

              <div className="mt-3 grid gap-2">
                <div className="flex items-center gap-2 rounded-md border bg-card px-2.5 py-2">
                  <div className="min-w-0 flex-1">
                    <div className="text-[10px] font-semibold tracking-wide text-muted-foreground uppercase">{t('kernel.access.localUrl')}</div>
                    <code className="block truncate font-mono text-xs" title={profile.baseUrl}>{profile.baseUrl}</code>
                  </div>
                  <Button
                    type="button"
                    variant="outline"
                    size="icon-sm"
                    onClick={() =>
                      void copyApiValue(
                        profile.baseUrl,
                        `${profile.id}:base`,
                        t('kernel.access.localCopied', { name: profile.name }),
                      )
                    }
                    title={t('kernel.access.copyLocal', { name: profile.name })}
                    aria-label={t('kernel.access.copyLocal', { name: profile.name })}
                  >
                    {copiedApiField === `${profile.id}:base` ? (
                      <Check size={13} aria-hidden="true" />
                    ) : (
                      <Copy size={13} aria-hidden="true" />
                    )}
                  </Button>
                </div>
                {allowLanAccess ? (
                  <div className="flex items-center gap-2 rounded-md border bg-card px-2.5 py-2">
                    <div className="min-w-0 flex-1">
                      <div className="text-[10px] font-semibold tracking-wide text-muted-foreground uppercase">{t('kernel.access.lanUrl')}</div>
                      <code className="block truncate font-mono text-xs" title={profile.lanUrl || undefined}>
                        {!lanIpChecked
                          ? t('kernel.access.detectingIp')
                          : profile.lanUrl || t('kernel.access.noIp')}
                      </code>
                    </div>
                    {profile.lanUrl ? (
                      <Button
                        type="button"
                        variant="outline"
                        size="icon-sm"
                        onClick={() =>
                          void copyApiValue(
                            profile.lanUrl!,
                            `${profile.id}:lan`,
                            t('kernel.access.lanCopied', { name: profile.name }),
                          )
                        }
                        title={t('kernel.access.copyLan', { name: profile.name })}
                        aria-label={t('kernel.access.copyLan', { name: profile.name })}
                      >
                        {copiedApiField === `${profile.id}:lan` ? (
                          <Check size={13} aria-hidden="true" />
                        ) : (
                          <Copy size={13} aria-hidden="true" />
                        )}
                      </Button>
                    ) : null}
                  </div>
                ) : null}
              </div>
            </article>
          ))}
        </div>
      </Card>
      ) : null}

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

            <div className="h-2 overflow-hidden rounded-full bg-muted">
              <div
                className={cn('h-full rounded-full bg-primary transition-[width]', !progressKnown && 'w-1/3 animate-pulse')}
                style={progressKnown ? { width: `${progressPercent}%` } : undefined}
              />
            </div>

            <div className="flex items-center justify-between text-sm">
              <strong className="font-semibold tabular-nums">{progressKnown ? `${progressPercent.toFixed(1)}%` : t('kernel.dialog.unknownProgress')}</strong>
              <span className="text-muted-foreground">{progressText}</span>
            </div>

            <div
              id="install-dialog-message"
              className={cn('min-h-5 text-sm', installDialogTone === 'error' ? 'text-destructive' : installDialogTone === 'success' ? 'text-[var(--theme-2f6b3f)]' : 'text-muted-foreground')}
              aria-live="polite"
            >
              {installDialogMessage || '\u00a0'}
            </div>

            <Button
              type="button"
              variant={installTaskRunning ? 'destructive' : 'default'}
              disabled={installDialogActionDisabled}
              onClick={installTaskRunning ? cancelInstall : closeInstallDialog}
            >
              {installDialogAction}
            </Button>
          </DialogContent>
        </Dialog>
      ) : null}

      {processNotice ? (
        <div
          className={cn(
            'fixed right-6 bottom-6 z-50 flex items-center gap-2.5 rounded-xl border bg-card px-4 py-3 text-sm shadow-lg',
            processNotice.tone === 'success' && 'border-[var(--theme-b8d1bb)] text-[var(--theme-2f6b3f)]',
            processNotice.tone === 'error' && 'border-destructive/30 text-destructive',
          )}
          role="status"
          title={processNotice.message}
        >
          {processNotice.tone === 'success' ? (
            <Check size={17} aria-hidden="true" />
          ) : processNotice.tone === 'error' ? (
            <AlertCircle size={17} aria-hidden="true" />
          ) : (
            <Info size={17} aria-hidden="true" />
          )}
          <span>{processNotice.message}</span>
        </div>
      ) : null}
    </section>
  );
}

function localizeInstallPhase(
  phase: string,
  t: ReturnType<typeof useI18n>['t'],
) {
  const keys = {
    '准备下载': 'kernel.phase.preparingDownload',
    '下载中': 'kernel.phase.downloading',
    '解压中': 'kernel.phase.extracting',
    '准备内置内核': 'kernel.phase.preparingBundled',
    '安装完成': 'kernel.phase.completed',
    '安装失败': 'kernel.phase.failed',
    '已取消': 'kernel.phase.cancelled',
  } as const;
  const key = keys[phase as keyof typeof keys];
  return key ? t(key) : phase;
}

function clampPercent(percent: number) {
  return Math.min(100, Math.max(0, percent));
}

function formatBytes(bytes: number) {
  if (bytes < 1024) {
    return `${bytes} B`;
  }

  if (bytes < 1024 * 1024) {
    return `${(bytes / 1024).toFixed(1)} KB`;
  }

  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}
