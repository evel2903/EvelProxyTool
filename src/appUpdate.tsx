import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { AlertCircle, Download, ExternalLink, RefreshCw } from 'lucide-react';
import { getCurrentLocale, translate, useI18n } from './i18n';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import { appUpdateManualHint, canInstallAppUpdate, type AppUpdateInfo } from './appUpdateModel';
import {
  APP_UPDATE_CHECK_INTERVAL_MS,
  APP_UPDATE_SNOOZE_STORAGE_KEY,
  createAppUpdateSnooze,
  parseAppUpdateSnooze,
  shouldCheckForAppUpdate,
  shouldPromptForAppUpdate,
  type AppUpdateSnooze,
} from './appUpdatePolicy';

export type { AppUpdateInfo } from './appUpdateModel';

export type AppUpdatePhase =
  | 'idle'
  | 'checking'
  | 'available'
  | 'downloading'
  | 'verifying'
  | 'staging'
  | 'waitingForExit'
  | 'restarting'
  | 'completed'
  | 'cancelled'
  | 'failed';

export type AppUpdateTask = {
  running: boolean;
  cancellable: boolean;
  phase: AppUpdatePhase;
  targetVersion: string | null;
  downloadedBytes: number;
  totalBytes: number | null;
  percent: number | null;
  message: string | null;
};

type AppUpdateContextValue = {
  info: AppUpdateInfo | null;
  task: AppUpdateTask;
  error: string;
  checking: boolean;
  confirmOpen: boolean;
  hasUpdate: boolean;
  processing: boolean;
  canInstall: boolean;
  check: () => Promise<void>;
  requestInstall: () => void;
  dismissConfirm: () => void;
  install: () => Promise<void>;
  openRelease: () => Promise<void>;
  cancel: () => Promise<void>;
};

const idleTask: AppUpdateTask = {
  running: false,
  cancellable: false,
  phase: 'idle',
  targetVersion: null,
  downloadedBytes: 0,
  totalBytes: null,
  percent: null,
  message: null,
};

const AppUpdateContext = createContext<AppUpdateContextValue | null>(null);

export function AppUpdateProvider({ children }: { children: ReactNode }) {
  const [info, setInfo] = useState<AppUpdateInfo | null>(null);
  const [task, setTask] = useState<AppUpdateTask>(idleTask);
  const [error, setError] = useState('');
  const [checking, setChecking] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [starting, setStarting] = useState(false);
  const mounted = useRef(false);
  const checkPromise = useRef<Promise<void> | null>(null);
  const taskPromise = useRef<Promise<boolean> | null>(null);
  const scheduleNextCheck = useRef<() => void>(() => undefined);
  const taskRevision = useRef(0);
  const runtime = useRef({
    info: null as AppUpdateInfo | null,
    task: idleTask,
    checking: false,
    starting: false,
    confirmOpen: false,
    ready: false,
    lastAttempt: null as number | null,
    snooze: null as AppUpdateSnooze | null,
  });
  const processing = task.running || starting;
  const canInstall = canInstallAppUpdate(info, checking, processing);

  const showConfirm = useCallback((open: boolean) => {
    runtime.current.confirmOpen = open;
    setConfirmOpen(open);
  }, []);

  const attemptAutoPrompt = useCallback(() => {
    const current = runtime.current;
    if (!mounted.current || !current.ready || current.checking || current.starting
      || current.task.running || current.confirmOpen || document.visibilityState === 'hidden'
      || document.querySelector('[role="dialog"], [role="alertdialog"]')) return;
    const now = Date.now();
    if (shouldPromptForAppUpdate(current.info, current.snooze, now)) {
      // Keep a memory fallback even if localStorage is unavailable or the install fails.
      current.snooze = createAppUpdateSnooze(current.info!.latestVersion, now);
      showConfirm(true);
    }
  }, [showConfirm]);

  const applyTask = useCallback((next: AppUpdateTask) => {
    taskRevision.current += 1;
    runtime.current.ready = true;
    runtime.current.task = next;
    setTask(next);
    if (next.running) showConfirm(false);
    if (next.phase === 'failed') {
      setError(next.message || translate(getCurrentLocale(), 'appUpdate.error.failed'));
      if (runtime.current.info?.updateAvailable) showConfirm(true);
    } else if (next.phase !== 'cancelled') {
      setError('');
    }
  }, [showConfirm]);

  const refreshTask = useCallback((): Promise<boolean> => {
    if (taskPromise.current) return taskPromise.current;
    const revision = taskRevision.current;
    const request = invoke<AppUpdateTask>('get_app_update_task')
      .then((snapshot) => {
        if (!mounted.current) return false;
        if (taskRevision.current === revision) applyTask(snapshot);
        return runtime.current.ready;
      })
      .catch((nextError) => {
        if (mounted.current && !runtime.current.ready) setError(String(nextError));
        return runtime.current.ready;
      })
      .finally(() => { taskPromise.current = null; });
    taskPromise.current = request;
    return request;
  }, [applyTask]);

  const check = useCallback((trigger: 'manual' | 'startup' | 'interval' | 'resume' = 'manual'): Promise<void> => {
    const current = runtime.current;
    if (!mounted.current || current.starting || current.task.running) return Promise.resolve();
    if (checkPromise.current) return checkPromise.current;
    if (trigger !== 'manual' && (current.confirmOpen
      || !shouldCheckForAppUpdate(current.lastAttempt, Date.now(), trigger))) return Promise.resolve();
    const request = (async () => {
      try {
        if (!current.ready && !(await refreshTask())) return;
        if (!mounted.current || current.starting || current.task.running) return;
        current.lastAttempt = Date.now();
        scheduleNextCheck.current();
        current.checking = true;
        setChecking(true);
        setError('');
        const result = await invoke<AppUpdateInfo>('check_app_update');
        if (!mounted.current) return;
        current.info = result;
        setInfo(result);
        if (!result.updateAvailable) showConfirm(false);
        const next = {
          ...current.task,
          phase: result.updateAvailable ? 'available' as const : 'idle' as const,
          targetVersion: result.updateAvailable ? result.latestVersion : null,
          message: null,
        };
        current.task = next;
        setTask(next);
      } catch (nextError) {
        if (!mounted.current) return;
        current.info = null;
        setInfo(null);
        showConfirm(false);
        setError(String(nextError));
      } finally {
        current.checking = false;
        checkPromise.current = null;
        if (mounted.current) {
          setChecking(false);
          attemptAutoPrompt();
        }
      }
    })();
    checkPromise.current = request;
    return request;
  }, [attemptAutoPrompt, refreshTask, showConfirm]);

  useEffect(() => {
    mounted.current = true;
    let disposed = false;
    let stopListening: (() => void) | undefined;
    try {
      runtime.current.snooze = parseAppUpdateSnooze(window.localStorage.getItem(APP_UPDATE_SNOOZE_STORAGE_KEY), Date.now());
    } catch { /* The in-memory snooze still prevents repeated prompts. */ }

    void refreshTask().then((ready) => {
      if (!disposed && ready) void check('startup');
    });

    void listen<AppUpdateTask>('app-update-progress', (event) => {
      if (disposed) return;
      const wasReady = runtime.current.ready;
      applyTask(event.payload);
      if (!wasReady) void check('startup');
    }).then((stop) => {
      if (disposed) stop();
      else stopListening = stop;
    }).catch(() => undefined);

    const resume = () => {
      if (document.visibilityState === 'hidden') return;
      void check('resume');
      attemptAutoPrompt();
    };
    let timer: number;
    const schedule = () => {
      window.clearTimeout(timer);
      timer = window.setTimeout(() => {
        // Re-arm even when a modal or running installer postpones this attempt.
        schedule();
        void check('interval');
        attemptAutoPrompt();
      }, APP_UPDATE_CHECK_INTERVAL_MS);
    };
    scheduleNextCheck.current = schedule;
    schedule();
    window.addEventListener('focus', resume);
    window.addEventListener('online', resume);
    document.addEventListener('visibilitychange', resume);
    // A pending notice can open after another modal closes, without interrupting it.
    const observer = new MutationObserver(attemptAutoPrompt);
    observer.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['data-state', 'role'] });

    return () => {
      disposed = true;
      mounted.current = false;
      window.clearTimeout(timer);
      scheduleNextCheck.current = () => undefined;
      window.removeEventListener('focus', resume);
      window.removeEventListener('online', resume);
      document.removeEventListener('visibilitychange', resume);
      observer.disconnect();
      stopListening?.();
    };
  }, [applyTask, attemptAutoPrompt, check, refreshTask]);

  useEffect(() => {
    if (!processing) return;
    // Recover if a progress event is missed without permitting another install/check.
    const timer = window.setInterval(() => {
      if (!runtime.current.starting) void refreshTask();
    }, 5000);
    return () => window.clearInterval(timer);
  }, [processing, refreshTask]);

  const dismissConfirm = useCallback(() => {
    const current = runtime.current;
    if (current.info) {
      current.snooze = createAppUpdateSnooze(current.info.latestVersion, Date.now());
      try {
        window.localStorage.setItem(APP_UPDATE_SNOOZE_STORAGE_KEY, JSON.stringify(current.snooze));
      } catch { /* Retain the snooze in memory if browser storage is blocked. */ }
    }
    showConfirm(false);
  }, [showConfirm]);

  const requestInstall = useCallback(() => {
    const current = runtime.current;
    if (canInstallAppUpdate(current.info, current.checking, current.starting || current.task.running)) {
      current.snooze = createAppUpdateSnooze(current.info!.latestVersion, Date.now());
      showConfirm(true);
    }
  }, [showConfirm]);

  const install = useCallback(async () => {
    const current = runtime.current;
    if (!canInstallAppUpdate(current.info, current.checking, current.starting || current.task.running)) return;
    current.starting = true;
    showConfirm(false);
    setStarting(true);
    setError('');
    const startRevision = taskRevision.current;
    try {
      await invoke('start_app_update');
      if (!mounted.current) return;
      // An accepted start is running even if the next status request fails.
      if (taskRevision.current === startRevision) {
        applyTask({ ...idleTask, running: true, cancellable: true, phase: 'downloading', targetVersion: current.info!.latestVersion });
      }
      // Recover the running state even when the first progress event arrives late.
      const revision = taskRevision.current;
      try {
        const snapshot = await invoke<AppUpdateTask>('get_app_update_task');
        if (mounted.current && taskRevision.current === revision) applyTask(snapshot);
      } catch (nextError) {
        if (mounted.current && taskRevision.current === revision && current.task.phase !== 'failed') {
          setError(String(nextError));
        }
      }
    } catch (nextError) {
      if (mounted.current) {
        setError(String(nextError));
        showConfirm(true);
      }
    } finally {
      current.starting = false;
      if (mounted.current) setStarting(false);
    }
  }, [applyTask, showConfirm]);

  const openRelease = useCallback(async () => {
    const releaseUrl = runtime.current.info?.releaseUrl;
    if (!releaseUrl) return;
    try {
      await invoke('open_external_url', { url: releaseUrl });
      if (mounted.current) dismissConfirm();
    } catch (nextError) {
      if (mounted.current) setError(String(nextError));
    }
  }, [dismissConfirm]);

  const cancel = useCallback(async () => {
    try {
      await invoke('cancel_app_update');
    } catch (nextError) {
      setError(String(nextError));
    }
  }, []);

  const value = useMemo<AppUpdateContextValue>(() => ({
    info,
    task,
    error,
    checking,
    confirmOpen: confirmOpen && Boolean(info?.updateAvailable) && !processing,
    hasUpdate: Boolean(info?.updateAvailable),
    processing,
    canInstall,
    check: () => check('manual'),
    requestInstall,
    dismissConfirm,
    install,
    openRelease,
    cancel,
  }), [cancel, canInstall, check, checking, confirmOpen, dismissConfirm, error, info, install, openRelease, processing, requestInstall, task]);

  return <AppUpdateContext.Provider value={value}>{children}</AppUpdateContext.Provider>;
}

export function useAppUpdate() {
  const context = useContext(AppUpdateContext);
  if (!context) throw new Error('useAppUpdate must be used inside AppUpdateProvider');
  return context;
}

export function AppUpdateDialog() {
  const { t } = useI18n();
  const {
    info,
    task,
    error,
    confirmOpen,
    canInstall,
    dismissConfirm,
    install,
    openRelease,
    cancel,
  } = useAppUpdate();

  if (!confirmOpen && !task.running) return null;

  const percent = task.percent ?? (
    task.totalBytes && task.totalBytes > 0
      ? (task.downloadedBytes / task.totalBytes) * 100
      : null
  );
  const phaseLabel = t(`appUpdate.phase.${task.phase}` as Parameters<typeof t>[0]);
  const manualHint = appUpdateManualHint(info);

  return (
    <Dialog open onOpenChange={(open) => !open && confirmOpen && dismissConfirm()}>
      <DialogContent showCloseButton={confirmOpen} className="sm:max-w-md">
        <div>
          <span className="text-[11px] font-semibold tracking-wide text-muted-foreground uppercase">
            {t('appUpdate.eyebrow')}
          </span>
          <DialogTitle className="mt-1 text-lg font-semibold">
            {confirmOpen ? t('appUpdate.notificationTitle', { version: info?.latestVersion ?? '' }) : t('appUpdate.progressTitle')}
          </DialogTitle>
        </div>

        {confirmOpen ? (
          <>
            <DialogDescription>
              {t('appUpdate.notificationDescription')}
            </DialogDescription>
            {manualHint ? (
              <p className="text-sm text-muted-foreground">
                {t(manualHint.messageKey)}{manualHint.detail && ` ${manualHint.detail}`}
              </p>
            ) : (
              <p className="text-sm text-muted-foreground">
                {t('appUpdate.confirmDescription', { version: info?.latestVersion ?? '' })}
              </p>
            )}
            {error && <p className="break-words text-sm text-destructive" role="alert">{error}</p>}
            <div className="flex flex-wrap justify-end gap-2">
              <Button type="button" variant="outline" onClick={dismissConfirm}>
                {t('appUpdate.remindLater')}
              </Button>
              {info?.autoUpdateSupported ? (
                <Button type="button" disabled={!canInstall} onClick={() => void install()}>
                  <Download size={15} aria-hidden="true" />
                  {t('appUpdate.installNow')}
                </Button>
              ) : (
                <Button type="button" onClick={() => void openRelease()}>
                  <ExternalLink size={15} aria-hidden="true" />
                  {t('appUpdate.openRelease')}
                </Button>
              )}
            </div>
          </>
        ) : (
          <>
            <div className="flex items-center justify-between text-sm">
              <span className="text-muted-foreground">{t('kernel.dialog.phase')}</span>
              <strong className="font-semibold">{phaseLabel}</strong>
            </div>
            <div className="h-2 overflow-hidden rounded-full bg-muted">
              <div
                className={cn(
                  'h-full rounded-full bg-primary transition-[width]',
                  percent === null && 'w-1/3 animate-pulse',
                )}
                style={percent === null ? undefined : { width: `${Math.max(0, Math.min(100, percent))}%` }}
              />
            </div>
            <div className="flex items-center justify-between text-sm">
              <strong className="font-semibold tabular-nums">
                {percent === null ? t('kernel.dialog.unknownProgress') : `${percent.toFixed(1)}%`}
              </strong>
              <span className="text-muted-foreground">{task.message || phaseLabel}</span>
            </div>
            {error ? (
              <div className="flex items-center gap-2 rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive" role="alert">
                <AlertCircle size={15} aria-hidden="true" /> {error}
              </div>
            ) : null}
            <Button
              type="button"
              variant="destructive"
              disabled={!task.cancellable}
              onClick={() => void cancel()}
            >
              {task.cancellable ? t('appUpdate.cancelDownload') : (
                <><RefreshCw size={15} className="animate-spin" aria-hidden="true" /> {phaseLabel}</>
              )}
            </Button>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
