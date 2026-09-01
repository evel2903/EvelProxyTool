import { useEffect, useRef, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import {
  Bot,
  Check,
  ChevronLeft,
  ChevronRight,
  Copy,
  ExternalLink,
  GitBranch,
  History,
  House,
  Languages,
  LogIn,
  MessageCircle,
  Moon,
  Network,
  PackageOpen,
  RefreshCw,
  Send,
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
import type { MessageKey } from './i18n/resources';
import { AppUpdateDialog, AppUpdateProvider, useAppUpdate } from './appUpdate';
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
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';

const CONTACT_LINKS = [
  { key: 'telegramChannel', name: 'Evel Service', url: 'https://t.me/gptserviceprochannel', icon: Send },
  { key: 'telegramPersonal', name: 'San Lee', url: 'https://t.me/sanlee035', icon: Send },
  { key: 'github', name: 'GitHub', url: 'https://github.com/evel2903/EvelProxyTool', icon: GitBranch },
] as const;
const SIDEBAR_COLLAPSED_STORAGE_KEY = 'evel-proxy-tool.sidebar-collapsed';

type PageGroup = 'core' | 'routing' | 'settings';

type PageItem = {
  id: 'home' | 'oauth' | 'agents' | 'versions' | 'config' | 'api' | 'usage-records';
  labelKey: MessageKey;
  group: PageGroup;
  icon: typeof House;
  component: () => React.JSX.Element;
};

const pages: PageItem[] = [
  {
    id: 'home',
    labelKey: 'app.nav.home',
    group: 'core',
    icon: House,
    component: HomePage,
  },
  {
    id: 'oauth',
    labelKey: 'app.nav.oauth',
    group: 'core',
    icon: LogIn,
    component: AccountsPage,
  },
  {
    id: 'agents',
    labelKey: 'app.nav.agents',
    group: 'core',
    icon: Bot,
    component: AgentsPage,
  },
  {
    id: 'api',
    labelKey: 'app.nav.api',
    group: 'routing',
    icon: Network,
    component: ApiAccessPage,
  },
  {
    id: 'usage-records',
    labelKey: 'app.nav.usageRecords',
    group: 'routing',
    icon: History,
    component: UsageRecordsPage,
  },
  {
    id: 'config',
    labelKey: 'app.nav.config',
    group: 'settings',
    icon: Settings,
    component: ConfigPanelPage,
  },
  {
    id: 'versions',
    labelKey: 'app.nav.versions',
    group: 'settings',
    icon: PackageOpen,
    component: VersionManagementPage,
  },
];

type PageId = (typeof pages)[number]['id'];
type WindowsCloseAction = 'exit' | 'minimize-to-tray';
type WindowsCloseBehavior = 'ask' | WindowsCloseAction;

type WindowsClosePrompt = {
  resolvingAction: WindowsCloseAction | null;
  rememberChoice: boolean;
  error: string | null;
};

type GuiSettings = {
  port: number;
  allowLan: boolean;
  runOnStartup: boolean;
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
  const [active, setActive] = useState<PageId>('home');
  const [theme, setTheme] = useState<AppTheme>(detectInitialTheme);
  const [currentPort, setCurrentPort] = useState<number>(8317);
  const [sidebarCollapsed, setSidebarCollapsed] = useState<boolean>(() => {
    try {
      return window.localStorage.getItem(SIDEBAR_COLLAPSED_STORAGE_KEY) === '1';
    } catch {
      return false;
    }
  });
  const [windowsClosePrompt, setWindowsClosePrompt] = useState<WindowsClosePrompt | null>(null);
  const [copiedTopEndpoint, setCopiedTopEndpoint] = useState(false);
  const { status, refreshStatus } = useCoreRuntime();
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
      // Storage unavailable fallback
    }
  }, [sidebarCollapsed]);

  useEffect(() => {
    if (!canOpenAppPage(active, coreRunning)) {
      setActive('home');
    }
  }, [active, coreRunning]);

  useEffect(() => {
    invoke<GuiSettings>('get_gui_settings')
      .then((settings) => {
        if (settings?.port) {
          setCurrentPort(settings.port);
        }
      })
      .catch(() => {});
  }, []);

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
        console.error('Failed to read close settings:', error);
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
        console.error('Failed to listen for windows close request:', error);
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

  const openContact = async (url: string) => {
    try {
      await invoke('open_external_url', { url });
    } catch (error) {
      console.error('Failed to open contact url:', error);
    }
  };

  const copyTopEndpoint = async () => {
    const url = `http://127.0.0.1:${currentPort}/v1`;
    try {
      await navigator.clipboard.writeText(url);
      setCopiedTopEndpoint(true);
      setTimeout(() => setCopiedTopEndpoint(false), 1800);
    } catch {}
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

  const groupPages = (group: PageGroup) => pages.filter((p) => p.group === group);

  return (
    <>
      <div className="flex h-screen w-screen overflow-hidden bg-background text-foreground">
        {/* SIDEBAR */}
        <aside
          className={cn(
            'flex shrink-0 flex-col border-r bg-card/60 backdrop-blur-md text-sidebar-foreground transition-[width] duration-200 ease-in-out select-none',
            sidebarCollapsed ? 'w-[70px]' : 'w-[255px]',
          )}
        >
          {/* Brand Header */}
          <div className="flex items-center justify-between gap-2 px-3.5 py-4 border-b border-border/40">
            <div className="flex min-w-0 items-center gap-2.5" title={t('app.brand.tooltip')}>
              <div className="relative">
                <img src={appLogo} alt="" className="size-8.5 shrink-0 rounded-xl border shadow-sm" />
                <span
                  className={cn(
                    'absolute -bottom-0.5 -right-0.5 size-2.5 rounded-full border-2 border-background',
                    coreRunning ? 'bg-emerald-500' : 'bg-slate-400',
                  )}
                />
              </div>
              {sidebarCollapsed ? null : (
                <div className="min-w-0">
                  <strong className="block truncate text-[14px] font-bold tracking-tight text-foreground">
                    EvelProxyTool
                  </strong>
                  <span className="block truncate text-[11px] text-muted-foreground">
                    {t('app.desktopConsole')}
                  </span>
                </div>
              )}
            </div>
            {sidebarCollapsed ? null : (
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                aria-label={t('app.sidebar.collapse')}
                className="size-7 rounded-lg text-muted-foreground hover:text-foreground"
                onClick={() => setSidebarCollapsed(true)}
              >
                <ChevronLeft size={16} aria-hidden="true" />
              </Button>
            )}
          </div>

          {/* Navigation Links */}
          <div className="flex-1 overflow-y-auto px-2.5 py-3 space-y-4">
            {/* Core Services Section */}
            <div className="space-y-1">
              {!sidebarCollapsed && (
                <div className="px-2 pb-1 text-[10.5px] font-bold uppercase tracking-wider text-muted-foreground/70">
                  Core Services
                </div>
              )}
              {groupPages('core').map((page) => {
                const Icon = page.icon;
                const isSelected = active === page.id;
                const available = canOpenAppPage(page.id, coreRunning);
                const label = t(page.labelKey);

                return (
                  <button
                    key={page.id}
                    type="button"
                    disabled={!available}
                    onClick={() => select(page.id)}
                    title={sidebarCollapsed ? label : undefined}
                    className={cn(
                      'group flex w-full items-center gap-3 rounded-xl px-2.5 py-2 text-xs font-semibold transition-all duration-150 cursor-pointer',
                      isSelected
                        ? 'bg-primary text-primary-foreground shadow-md shadow-primary/20'
                        : available
                          ? 'text-muted-foreground hover:bg-accent/80 hover:text-foreground'
                          : 'cursor-not-allowed text-muted-foreground/40 opacity-50',
                      sidebarCollapsed ? 'justify-center px-0' : '',
                    )}
                  >
                    <Icon
                      size={17}
                      aria-hidden="true"
                      className={cn(
                        'shrink-0 transition-transform duration-150 group-hover:scale-105',
                        isSelected ? 'text-primary-foreground' : '',
                      )}
                    />
                    {!sidebarCollapsed && <span className="truncate">{label}</span>}
                  </button>
                );
              })}
            </div>

            {/* Routing & Insights Section */}
            <div className="space-y-1">
              {!sidebarCollapsed && (
                <div className="px-2 pb-1 text-[10.5px] font-bold uppercase tracking-wider text-muted-foreground/70">
                  Routing & Insights
                </div>
              )}
              {groupPages('routing').map((page) => {
                const Icon = page.icon;
                const isSelected = active === page.id;
                const available = canOpenAppPage(page.id, coreRunning);
                const label = t(page.labelKey);

                return (
                  <button
                    key={page.id}
                    type="button"
                    disabled={!available}
                    onClick={() => select(page.id)}
                    title={sidebarCollapsed ? label : undefined}
                    className={cn(
                      'group flex w-full items-center gap-3 rounded-xl px-2.5 py-2 text-xs font-semibold transition-all duration-150 cursor-pointer',
                      isSelected
                        ? 'bg-primary text-primary-foreground shadow-md shadow-primary/20'
                        : available
                          ? 'text-muted-foreground hover:bg-accent/80 hover:text-foreground'
                          : 'cursor-not-allowed text-muted-foreground/40 opacity-50',
                      sidebarCollapsed ? 'justify-center px-0' : '',
                    )}
                  >
                    <Icon
                      size={17}
                      aria-hidden="true"
                      className={cn(
                        'shrink-0 transition-transform duration-150 group-hover:scale-105',
                        isSelected ? 'text-primary-foreground' : '',
                      )}
                    />
                    {!sidebarCollapsed && <span className="truncate">{label}</span>}
                  </button>
                );
              })}
            </div>

            {/* System Settings Section */}
            <div className="space-y-1">
              {!sidebarCollapsed && (
                <div className="px-2 pb-1 text-[10.5px] font-bold uppercase tracking-wider text-muted-foreground/70">
                  System
                </div>
              )}
              {groupPages('settings').map((page) => {
                const Icon = page.icon;
                const isSelected = active === page.id;
                const available = canOpenAppPage(page.id, coreRunning);
                const label = t(page.labelKey);

                return (
                  <button
                    key={page.id}
                    type="button"
                    disabled={!available}
                    onClick={() => select(page.id)}
                    title={sidebarCollapsed ? label : undefined}
                    className={cn(
                      'group flex w-full items-center gap-3 rounded-xl px-2.5 py-2 text-xs font-semibold transition-all duration-150 cursor-pointer',
                      isSelected
                        ? 'bg-primary text-primary-foreground shadow-md shadow-primary/20'
                        : available
                          ? 'text-muted-foreground hover:bg-accent/80 hover:text-foreground'
                          : 'cursor-not-allowed text-muted-foreground/40 opacity-50',
                      sidebarCollapsed ? 'justify-center px-0' : '',
                    )}
                  >
                    <Icon
                      size={17}
                      aria-hidden="true"
                      className={cn(
                        'shrink-0 transition-transform duration-150 group-hover:scale-105',
                        isSelected ? 'text-primary-foreground' : '',
                      )}
                    />
                    {!sidebarCollapsed && <span className="truncate">{label}</span>}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Sidebar Footer Controls */}
          <div className="border-t border-border/40 p-2.5 space-y-2">
            {sidebarCollapsed ? (
              <div className="flex flex-col items-center gap-2">
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  aria-label={t('app.sidebar.expand')}
                  className="size-8 rounded-lg text-muted-foreground hover:text-foreground"
                  onClick={() => setSidebarCollapsed(false)}
                >
                  <ChevronRight size={16} aria-hidden="true" />
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  title={theme === 'dark' ? t('app.theme.switchToLight') : t('app.theme.switchToDark')}
                  onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
                  className="size-8 rounded-lg text-muted-foreground hover:text-foreground"
                >
                  {theme === 'dark' ? <Moon size={15} /> : <Sun size={15} />}
                </Button>
              </div>
            ) : (
              <>
                <div className="grid grid-cols-2 gap-1.5 rounded-lg border bg-muted/40 p-1 text-xs">
                  <button
                    type="button"
                    className={cn(
                      'flex items-center justify-center gap-1.5 rounded-md py-1 font-medium transition-colors cursor-pointer',
                      theme === 'light'
                        ? 'bg-card text-foreground shadow-xs'
                        : 'text-muted-foreground hover:text-foreground',
                    )}
                    onClick={() => setTheme('light')}
                  >
                    <Sun size={13} aria-hidden="true" /> {t('app.theme.light')}
                  </button>
                  <button
                    type="button"
                    className={cn(
                      'flex items-center justify-center gap-1.5 rounded-md py-1 font-medium transition-colors cursor-pointer',
                      theme === 'dark'
                        ? 'bg-card text-foreground shadow-xs'
                        : 'text-muted-foreground hover:text-foreground',
                    )}
                    onClick={() => setTheme('dark')}
                  >
                    <Moon size={13} aria-hidden="true" /> {t('app.theme.dark')}
                  </button>
                </div>

                <Select value={locale} onValueChange={(value) => setLocale(value as typeof locale)}>
                  <SelectTrigger className="w-full h-8 text-xs" aria-label={t('app.language')}>
                    <div className="flex items-center gap-2">
                      <Languages size={13} aria-hidden="true" className="text-muted-foreground" />
                      <SelectValue>{selectedLanguage.nativeLabel}</SelectValue>
                    </div>
                  </SelectTrigger>
                  <SelectContent>
                    {languageOptions.map((option) => (
                      <SelectItem key={option.value} value={option.value} className="text-xs">
                        <span lang={option.value}>{option.nativeLabel}</span>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>

                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <button
                      type="button"
                      className="flex h-8 w-full items-center gap-2 rounded-lg border bg-card/60 px-2.5 text-[12px] font-medium text-muted-foreground hover:bg-accent hover:text-foreground transition-colors cursor-pointer"
                      title={t('app.contact.title')}
                    >
                      <MessageCircle size={14} aria-hidden="true" />
                      <span className="flex-1 text-left">{t('app.contact.label')}</span>
                      <ExternalLink size={12} aria-hidden="true" />
                    </button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="start" side="top">
                    {CONTACT_LINKS.map((link) => (
                      <DropdownMenuItem key={link.key} onClick={() => void openContact(link.url)}>
                        <link.icon size={14} aria-hidden="true" />
                        <span className="flex-1">{t(`app.contact.${link.key}` as MessageKey)}</span>
                      </DropdownMenuItem>
                    ))}
                  </DropdownMenuContent>
                </DropdownMenu>
              </>
            )}
          </div>
        </aside>

        {/* MAIN AREA */}
        <div className="min-w-0 flex-1 flex flex-col overflow-hidden">
          {/* TOP GLOBAL TELEMETRY HEADER */}
          <header className="h-14 shrink-0 border-b border-border/40 bg-card/40 backdrop-blur-md px-6 flex items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              <h1 className="text-base font-bold text-foreground tracking-tight flex items-center gap-2">
                {t(activePage.labelKey)}
              </h1>
            </div>

            {/* Live Telemetry Status Pills */}
            <div className="flex items-center gap-2.5">
              <div className="hidden sm:flex items-center gap-2 px-3 py-1 rounded-full border bg-background/80 text-xs text-muted-foreground shadow-xs">
                <span
                  className={cn(
                    'size-2 rounded-full',
                    coreRunning ? 'bg-emerald-500 animate-pulse' : 'bg-slate-400',
                  )}
                />
                <span>
                  Core: <strong className="font-mono text-foreground">{coreRunning ? `127.0.0.1:${currentPort}` : 'Stopped'}</strong>
                </span>
                {status?.processId ? (
                  <span className="text-[11px] text-muted-foreground/80 font-mono">
                    (PID: {status.processId})
                  </span>
                ) : null}
              </div>

              {coreRunning && (
                <button
                  type="button"
                  onClick={() => void copyTopEndpoint()}
                  className="flex items-center gap-1.5 px-2.5 py-1 rounded-full border bg-primary/10 border-primary/20 text-primary text-xs font-semibold hover:bg-primary/20 transition-colors cursor-pointer"
                  title="Sao chép Endpoint OpenAI: http://127.0.0.1:{port}/v1"
                >
                  {copiedTopEndpoint ? <Check size={13} /> : <Copy size={13} />}
                  <span>{copiedTopEndpoint ? 'Đã chép /v1' : 'Copy /v1'}</span>
                </button>
              )}

              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                className="size-8 rounded-lg text-muted-foreground hover:text-foreground cursor-pointer"
                title="Làm mới trạng thái Core"
                onClick={() => void refreshStatus()}
              >
                <RefreshCw size={14} />
              </Button>
            </div>
          </header>

          {/* MAIN PAGE VIEW CONTAINER */}
          <div className="min-w-0 flex-1 overflow-y-auto">
            <main className="p-6 max-w-7xl mx-auto">
              {isAlwaysAvailablePage(activePage.id) || coreRunning ? (
                <ActivePage />
              ) : (
                <CoreLockedPage />
              )}
            </main>
          </div>
        </div>
      </div>

      {/* WINDOWS CLOSE CONFIRMATION DIALOG */}
      <Dialog
        open={Boolean(windowsClosePrompt)}
        onOpenChange={(open) =>
          !open && windowsClosePrompt?.resolvingAction === null && setWindowsClosePrompt(null)
        }
      >
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
        <ServerCog size={28} aria-hidden="true" className="text-muted-foreground" />
        <strong className="text-base font-semibold">{t('app.coreRequired.title')}</strong>
        <span className="text-sm text-muted-foreground">{t('app.coreRequired.description')}</span>
      </div>
    </section>
  );
}

export default App;
