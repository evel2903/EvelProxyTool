import { useEffect, useRef, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import {
  Bot,
  ChevronLeft,
  ExternalLink,
  History,
  House,
  Languages,
  LogIn,
  MessageCircle,
  Moon,
  Network,
  PackageOpen,
  ServerCog,
  Settings,
  Sun,
} from 'lucide-react';
import appLogo from './assets/logo.png';
import { CoreRuntimeProvider, useCoreRuntime } from './coreRuntime';
import { ConfigPanelPage } from './pages/ConfigPanel';
import { ApiAccessPage } from './pages/ApiAccessPage';
import { KernelPage } from './pages/Kernel';
import { AccountsPage } from './pages/AccountsPage';
import { AgentsPage } from './pages/AgentsPage';
import { UsageRecordsPage } from './pages/UsageRecordsPage';
import { languageOptions, useI18n } from './i18n';
import { AppUpdateDialog, AppUpdateProvider, useAppUpdate } from './appUpdate';
import { appUpdateIndicatorState } from './appUpdateModel';
import { canOpenAppPage, isAlwaysAvailablePage } from './navigation';
import { detectInitialTheme, saveTheme, type AppTheme } from './theme';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Dialog, DialogContent, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

const CONTACT_URL = 'https://qm.qq.com/q/3queDaIG';
const SIDEBAR_COLLAPSED_STORAGE_KEY = 'evel-proxy-tool.sidebar-collapsed';

const pages = [
  {
    id: 'home',
    labelKey: 'app.nav.home',
    icon: House,
    component: HomePage,
  },
  {
    id: 'versions',
    labelKey: 'app.nav.versions',
    icon: PackageOpen,
    component: VersionManagementPage,
  },
  {
    id: 'config',
    labelKey: 'app.nav.config',
    icon: Settings,
    component: ConfigPanelPage,
  },
  {
    id: 'oauth',
    labelKey: 'app.nav.oauth',
    icon: LogIn,
    component: AccountsPage,
  },
  {
    id: 'api',
    labelKey: 'app.nav.api',
    icon: Network,
    component: ApiAccessPage,
  },
  {
    id: 'usage-records',
    labelKey: 'app.nav.usageRecords',
    icon: History,
    component: UsageRecordsPage,
  },
  {
    id: 'agents',
    labelKey: 'app.nav.agents',
    icon: Bot,
    component: AgentsPage,
  },
] as const;

type PageId = (typeof pages)[number]['id'];
type WindowsCloseAction = 'exit' | 'minimize-to-tray';
type WindowsCloseBehavior = 'ask' | WindowsCloseAction;

type WindowsClosePrompt = {
  resolvingAction: WindowsCloseAction | null;
  rememberChoice: boolean;
  error: string | null;
};

type GuiSettings = {
  closeBehavior: WindowsCloseBehavior;
};

function HomePage() {
  return <KernelPage view="home" />;
}

function VersionManagementPage() {
  return <KernelPage view="versions" />;
}

function App() {
  return (
    <AppUpdateProvider>
      <CoreRuntimeProvider>
        <AppContent />
      </CoreRuntimeProvider>
    </AppUpdateProvider>
  );
}

function AppContent() {
  const { locale, setLocale, t } = useI18n();
  const { info: appUpdateInfo, hasUpdate, processing: appUpdateProcessing } = useAppUpdate();
  const [active, setActive] = useState<PageId>('home');
  const [theme, setTheme] = useState<AppTheme>(detectInitialTheme);
  const [sidebarCollapsed, setSidebarCollapsed] = useState<boolean>(() => {
    try {
      return window.localStorage.getItem(SIDEBAR_COLLAPSED_STORAGE_KEY) === '1';
    } catch {
      return false;
    }
  });
  const [windowsClosePrompt, setWindowsClosePrompt] = useState<WindowsClosePrompt | null>(null);
  const { status } = useCoreRuntime();
  const coreRunning = Boolean(status?.running);
  const activePage = pages.find((page) => page.id === active) ?? pages[0];
  const ActivePage = activePage.component;
  const selectedLanguage = languageOptions.find((option) => option.value === locale)
    ?? languageOptions[0];

  useEffect(() => {
    saveTheme(theme);
  }, [theme]);

  useEffect(() => {
    try {
      window.localStorage.setItem(SIDEBAR_COLLAPSED_STORAGE_KEY, sidebarCollapsed ? '1' : '0');
    } catch {
      // The in-memory state still works when persistent storage is unavailable.
    }
  }, [sidebarCollapsed]);

  useEffect(() => {
    if (!canOpenAppPage(active, coreRunning)) {
      setActive('home');
    }
  }, [active, coreRunning]);

  useEffect(() => {
    let disposed = false;
    let stopListening: (() => void) | undefined;

    const handleWindowsCloseRequest = async () => {
      try {
        const settings = await invoke<GuiSettings>('get_gui_settings');
        if (settings.closeBehavior !== 'ask') {
          await resolveWindowsCloseRequest(settings.closeBehavior, false);
          return;
        }
      } catch (error) {
        console.error('读取关闭行为设置失败', error);
      }

      setWindowsClosePrompt((current) =>
        current ?? {
          resolvingAction: null,
          rememberChoice: false,
          error: null,
        },
      );
    };

    void listen('windows-close-requested', () => {
      void handleWindowsCloseRequest();
    })
      .then((stop) => {
        if (disposed) {
          stop();
        } else {
          stopListening = stop;
        }
      })
      .catch((error) => {
        console.error('监听 Windows 关闭确认事件失败', error);
      });

    return () => {
      disposed = true;
      stopListening?.();
    };
  }, []);

  const select = (pageId: PageId) => {
    if (!canOpenAppPage(pageId, coreRunning)) {
      return;
    }
    setActive(pageId);
  };

  const openContact = async () => {
    try {
      await invoke('open_external_url', { url: CONTACT_URL });
    } catch (error) {
      console.error('打开联系我们链接失败', error);
    }
  };

  const resolveWindowsCloseRequest = async (
    action: WindowsCloseAction,
    remember = windowsClosePrompt?.rememberChoice ?? false,
  ) => {
    setWindowsClosePrompt((current) =>
      current
        ? {
            ...current,
            resolvingAction: action,
            error: null,
          }
        : current,
    );

    try {
      await invoke('resolve_windows_close_request', { action, remember });
      setWindowsClosePrompt(null);
    } catch (error) {
      setWindowsClosePrompt((current) =>
        current
          ? {
              ...current,
              resolvingAction: null,
              error: error instanceof Error ? error.message : String(error),
            }
          : {
              resolvingAction: null,
              rememberChoice: false,
              error: error instanceof Error ? error.message : String(error),
            },
      );
    }
  };

  return (
    <>
      <div className="flex h-screen w-screen overflow-hidden bg-background text-foreground">
        <aside
          className={cn(
            'flex shrink-0 flex-col border-r bg-sidebar text-sidebar-foreground transition-[width] duration-150',
            sidebarCollapsed ? 'w-[68px]' : 'w-[250px]',
          )}
        >
          <div className="flex items-center justify-between gap-2 px-3 pt-3.5 pb-2.5">
            <div className="flex min-w-0 items-center gap-2.5" title={t('app.brand.tooltip')}>
              <img src={appLogo} alt="" className="size-8 shrink-0 rounded-lg border" />
              {sidebarCollapsed ? null : (
                <div className="min-w-0">
                  <strong className="block truncate text-[13.5px] font-semibold tracking-tight">EvelProxyTool</strong>
                  <span className="block truncate text-[11.5px] text-muted-foreground">{t('app.desktopConsole')}</span>
                </div>
              )}
            </div>
            {sidebarCollapsed ? null : (
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                aria-label={t('app.sidebar.collapse')}
                title={t('app.sidebar.collapse')}
                onClick={() => setSidebarCollapsed(true)}
              >
                <ChevronLeft size={15} aria-hidden="true" />
              </Button>
            )}
          </div>

          <nav className="flex flex-col gap-0.5 px-2 py-1.5" aria-label={t('app.navigation')}>
            {sidebarCollapsed ? (
              <Button
                type="button"
                variant="ghost"
                className="mb-1 h-9 w-full justify-center"
                aria-label={t('app.sidebar.expand')}
                title={t('app.sidebar.expand')}
                onClick={() => setSidebarCollapsed(false)}
              >
                <ChevronLeft size={16} aria-hidden="true" className="rotate-180" />
              </Button>
            ) : null}
            {pages.map((page) => {
              const Icon = page.icon;
              const locked = !canOpenAppPage(page.id, coreRunning);
              const updateIndicator = page.id === 'versions'
                ? appUpdateIndicatorState(hasUpdate, appUpdateProcessing)
                : null;
              const updateTitle = updateIndicator === 'processing'
                ? t('appUpdate.progressTitle')
                : t('appUpdate.badgeAvailable', { version: appUpdateInfo?.latestVersion ?? '' });
              return (
                <button
                  key={page.id}
                  type="button"
                  className={cn(
                    'relative flex h-9 items-center gap-2.5 rounded-md px-2.5 text-[13.5px] font-medium text-muted-foreground transition-colors hover:bg-accent disabled:pointer-events-none disabled:opacity-50',
                    page.id === active && 'bg-accent font-semibold text-foreground',
                    sidebarCollapsed && 'justify-center px-0',
                  )}
                  disabled={locked}
                  title={locked ? t('app.coreRequired.title') : t(page.labelKey)}
                  onClick={() => select(page.id)}
                >
                  <Icon size={17} aria-hidden="true" className="shrink-0" />
                  {sidebarCollapsed ? null : <span className="truncate">{t(page.labelKey)}</span>}
                  {updateIndicator ? (
                    <i
                      className={cn(
                        'size-1.5 shrink-0 rounded-full',
                        sidebarCollapsed ? 'absolute top-1 right-1' : 'ml-auto',
                        updateIndicator === 'processing' ? 'animate-pulse bg-muted-foreground' : 'bg-primary',
                      )}
                      title={updateTitle}
                      aria-label={updateTitle}
                    />
                  ) : null}
                </button>
              );
            })}
          </nav>

          <div className="flex-1" />

          <div className="grid gap-2 border-t p-2">
            {sidebarCollapsed ? (
              <Button
                type="button"
                variant="outline"
                size="icon"
                className="mx-auto"
                title={theme === 'light' ? t('app.theme.switchToDark') : t('app.theme.switchToLight')}
                onClick={() => setTheme(theme === 'light' ? 'dark' : 'light')}
              >
                {theme === 'light' ? <Sun size={15} aria-hidden="true" /> : <Moon size={15} aria-hidden="true" />}
              </Button>
            ) : (
              <>
                <div className="flex gap-0.5 rounded-lg bg-muted p-0.5" role="group" aria-label={`${t('app.theme.light')} / ${t('app.theme.dark')}`}>
                  <button
                    type="button"
                    className={cn(
                      'flex flex-1 items-center justify-center gap-1.5 rounded-md py-1.5 text-xs font-medium transition-colors',
                      theme === 'light' ? 'bg-card text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground',
                    )}
                    aria-pressed={theme === 'light'}
                    title={t('app.theme.switchToLight')}
                    onClick={() => setTheme('light')}
                  >
                    <Sun size={13} aria-hidden="true" /> {t('app.theme.light')}
                  </button>
                  <button
                    type="button"
                    className={cn(
                      'flex flex-1 items-center justify-center gap-1.5 rounded-md py-1.5 text-xs font-medium transition-colors',
                      theme === 'dark' ? 'bg-card text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground',
                    )}
                    aria-pressed={theme === 'dark'}
                    title={t('app.theme.switchToDark')}
                    onClick={() => setTheme('dark')}
                  >
                    <Moon size={13} aria-hidden="true" /> {t('app.theme.dark')}
                  </button>
                </div>

                <Select value={locale} onValueChange={(value) => setLocale(value as typeof locale)}>
                  <SelectTrigger className="w-full" aria-label={t('app.language')}>
                    <div className="flex items-center gap-2">
                      <Languages size={14} aria-hidden="true" className="text-muted-foreground" />
                      <SelectValue>{selectedLanguage.nativeLabel}</SelectValue>
                    </div>
                  </SelectTrigger>
                  <SelectContent>
                    {languageOptions.map((option) => (
                      <SelectItem key={option.value} value={option.value}>
                        <span lang={option.value}>{option.nativeLabel}</span>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>

                <button
                  type="button"
                  className="flex h-8.5 items-center gap-2 rounded-md border bg-card px-2.5 text-[12.5px] font-medium text-muted-foreground hover:bg-accent hover:text-foreground"
                  title={t('app.contact.title')}
                  onClick={() => void openContact()}
                >
                  <MessageCircle size={15} aria-hidden="true" />
                  <span className="flex-1 text-left">{t('app.contact.label')}</span>
                  <ExternalLink size={13} aria-hidden="true" />
                </button>
              </>
            )}
          </div>
        </aside>

        <div className="min-w-0 flex-1 overflow-y-auto">
          <main className="p-6">
            {isAlwaysAvailablePage(activePage.id) || coreRunning ? (
              <ActivePage />
            ) : (
              <CoreLockedPage />
            )}
          </main>
        </div>
      </div>

      <Dialog open={Boolean(windowsClosePrompt)} onOpenChange={(open) => !open && windowsClosePrompt?.resolvingAction === null && setWindowsClosePrompt(null)}>
        {windowsClosePrompt ? (
          <DialogContent showCloseButton={windowsClosePrompt.resolvingAction === null} className="sm:max-w-sm">
            <DialogTitle className="text-lg font-semibold">{t('app.close.title')}</DialogTitle>
            <DialogDescription>{t('app.close.description')}</DialogDescription>
            {windowsClosePrompt.error ? (
              <div className="rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive" role="alert">
                {windowsClosePrompt.error}
              </div>
            ) : null}
            <label className="flex items-center gap-2 text-sm">
              <Checkbox
                checked={windowsClosePrompt.rememberChoice}
                disabled={windowsClosePrompt.resolvingAction !== null}
                onCheckedChange={(checked) =>
                  setWindowsClosePrompt((current) =>
                    current ? { ...current, rememberChoice: checked === true } : current,
                  )
                }
              />
              {t('app.close.remember')}
            </label>
            <div className="flex gap-2">
              <Button
                type="button"
                className="flex-1"
                disabled={windowsClosePrompt.resolvingAction !== null}
                onClick={() => void resolveWindowsCloseRequest('minimize-to-tray')}
              >
                {windowsClosePrompt.resolvingAction === 'minimize-to-tray'
                  ? t('app.close.minimizing')
                  : t('app.close.minimize')}
              </Button>
              <Button
                type="button"
                variant="destructive"
                className="flex-1"
                disabled={windowsClosePrompt.resolvingAction !== null}
                onClick={() => void resolveWindowsCloseRequest('exit')}
              >
                {windowsClosePrompt.resolvingAction === 'exit'
                  ? t('app.close.exiting')
                  : t('app.close.exit')}
              </Button>
            </div>
          </DialogContent>
        ) : null}
      </Dialog>

      <AppUpdateDialog />
    </>
  );
}

function CoreLockedPage() {
  const { t } = useI18n();
  return (
    <section className="grid min-h-[60vh] place-items-center">
      <div className="grid max-w-sm justify-items-center gap-2 text-center">
        <ServerCog size={26} aria-hidden="true" className="text-muted-foreground" />
        <strong className="text-base font-semibold">{t('app.coreRequired.title')}</strong>
        <span className="text-sm text-muted-foreground">{t('app.coreRequired.description')}</span>
      </div>
    </section>
  );
}

export default App;
