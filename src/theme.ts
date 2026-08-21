import { getCurrentWebview } from '@tauri-apps/api/webview';
import { getCurrentWindow } from '@tauri-apps/api/window';

export type AppTheme = 'light' | 'dark';

const STORAGE_KEY = 'evel-proxy-tool.theme';
const WINDOW_BACKGROUND: Record<AppTheme, string> = {
  light: '#f6f7f5',
  dark: '#111412',
};

async function applyNativeTheme(theme: AppTheme): Promise<void> {
  const background = WINDOW_BACKGROUND[theme];
  const currentWindow = getCurrentWindow();
  const currentWebview = getCurrentWebview();

  await Promise.allSettled([
    currentWindow.setTheme(theme),
    currentWindow.setBackgroundColor(background),
    currentWebview.setBackgroundColor(background),
  ]);
}

export function detectInitialTheme(): AppTheme {
  if (typeof window === 'undefined') return 'light';

  try {
    const saved = window.localStorage.getItem(STORAGE_KEY);
    if (saved === 'light' || saved === 'dark') return saved;
  } catch {
    // Storage may be unavailable in a restricted WebView; use the OS preference.
  }

  return window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

export function applyTheme(theme: AppTheme): void {
  document.documentElement.dataset.theme = theme;
  document.documentElement.style.colorScheme = theme;
  document.documentElement.style.backgroundColor = WINDOW_BACKGROUND[theme];
  if (document.body) {
    document.body.style.backgroundColor = WINDOW_BACKGROUND[theme];
  }
  void applyNativeTheme(theme);
}

export function saveTheme(theme: AppTheme): void {
  applyTheme(theme);
  try {
    window.localStorage.setItem(STORAGE_KEY, theme);
  } catch {
    // The in-memory theme still works when persistent storage is unavailable.
  }
}
