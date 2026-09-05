import type { AppUpdateInfo } from './appUpdateModel';

export const APP_UPDATE_CHECK_INTERVAL_MS = 30 * 60 * 1000;
export const APP_UPDATE_RESUME_INTERVAL_MS = 5 * 60 * 1000;
export const APP_UPDATE_SNOOZE_MS = 24 * 60 * 60 * 1000;
export const APP_UPDATE_SNOOZE_STORAGE_KEY = 'evelproxytool.app-update-snooze.v1';

// Allow a backward clock adjustment, but never let corrupt storage hide updates indefinitely.
const MAX_SNOOZE_REMAINING_MS = 2 * APP_UPDATE_SNOOZE_MS;

export type AppUpdateSnooze = {
  version: string;
  until: number;
};

function normalizeVersion(version: string): string {
  return version.trim().replace(/^v/i, '').trim();
}

function validSnooze(value: unknown, now: number): AppUpdateSnooze | null {
  if (!Number.isFinite(now) || !value || typeof value !== 'object' || Array.isArray(value)) return null;
  const candidate = value as Partial<AppUpdateSnooze>;
  if (typeof candidate.version !== 'string' || typeof candidate.until !== 'number') return null;
  const version = normalizeVersion(candidate.version);
  if (!version || !Number.isFinite(candidate.until)
    || candidate.until <= now || candidate.until - now > MAX_SNOOZE_REMAINING_MS) return null;
  return { version, until: candidate.until };
}

export function parseAppUpdateSnooze(value: string | null, now: number): AppUpdateSnooze | null {
  if (value === null) return null;
  try {
    return validSnooze(JSON.parse(value), now);
  } catch {
    return null;
  }
}

export function createAppUpdateSnooze(version: string, now: number): AppUpdateSnooze | null {
  return validSnooze({ version, until: now + APP_UPDATE_SNOOZE_MS }, now);
}

export function shouldCheckForAppUpdate(
  lastAttempt: number | null,
  now: number,
  trigger: 'startup' | 'interval' | 'resume',
): boolean {
  if (!Number.isFinite(now)) return false;
  if (trigger === 'startup' || lastAttempt === null
    || !Number.isFinite(lastAttempt) || lastAttempt > now) return true;
  const interval = trigger === 'resume'
    ? APP_UPDATE_RESUME_INTERVAL_MS
    : APP_UPDATE_CHECK_INTERVAL_MS;
  return now - lastAttempt >= interval;
}

export function shouldPromptForAppUpdate(
  info: AppUpdateInfo | null,
  snooze: AppUpdateSnooze | null,
  now: number,
): boolean {
  if (!info?.updateAvailable || !normalizeVersion(info.latestVersion)) return false;
  const activeSnooze = validSnooze(snooze, now);
  return activeSnooze?.version !== normalizeVersion(info.latestVersion);
}
