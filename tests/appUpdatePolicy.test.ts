import { describe, expect, test } from 'bun:test';
import type { AppUpdateInfo } from '../src/appUpdateModel';
import {
  APP_UPDATE_CHECK_INTERVAL_MS,
  APP_UPDATE_RESUME_INTERVAL_MS,
  APP_UPDATE_SNOOZE_MS,
  createAppUpdateSnooze,
  parseAppUpdateSnooze,
  shouldCheckForAppUpdate,
  shouldPromptForAppUpdate,
} from '../src/appUpdatePolicy';

const now = Date.UTC(2026, 8, 6, 12);
const availableUpdate: AppUpdateInfo = {
  currentVersion: '0.2.30',
  latestVersion: '0.2.31',
  updateAvailable: true,
  releaseUrl: 'https://github.com/evel2903/EvelProxyTool/releases/tag/v0.2.31',
  autoUpdateSupported: true,
  downloadSizeBytes: 1024,
  unsupportedReason: null,
};

describe('automatic update check timing', () => {
  test('checks at startup and when no attempt has been made', () => {
    expect(shouldCheckForAppUpdate(now, now, 'startup')).toBe(true);
    for (const trigger of ['startup', 'interval', 'resume'] as const) {
      expect(shouldCheckForAppUpdate(null, now, trigger)).toBe(true);
    }
  });

  test('background intervals respect the 30-minute boundary', () => {
    expect(APP_UPDATE_CHECK_INTERVAL_MS).toBe(30 * 60 * 1000);
    expect(shouldCheckForAppUpdate(now, now, 'interval')).toBe(false);
    expect(shouldCheckForAppUpdate(now, now + APP_UPDATE_CHECK_INTERVAL_MS - 1, 'interval')).toBe(false);
    expect(shouldCheckForAppUpdate(now, now + APP_UPDATE_CHECK_INTERVAL_MS, 'interval')).toBe(true);
    expect(shouldCheckForAppUpdate(now, now + 2 * APP_UPDATE_CHECK_INTERVAL_MS, 'interval')).toBe(true);
  });

  test('resume events wait five minutes after any attempt, including a failed one', () => {
    expect(APP_UPDATE_RESUME_INTERVAL_MS).toBe(5 * 60 * 1000);
    expect(shouldCheckForAppUpdate(now, now + APP_UPDATE_RESUME_INTERVAL_MS - 1, 'resume')).toBe(false);
    expect(shouldCheckForAppUpdate(now, now + APP_UPDATE_RESUME_INTERVAL_MS, 'resume')).toBe(true);
    // Recording the retry as an attempt also throttles repeated online/focus events.
    const retryTime = now + APP_UPDATE_RESUME_INTERVAL_MS;
    expect(shouldCheckForAppUpdate(retryTime, retryTime + 1, 'resume')).toBe(false);
    expect(shouldCheckForAppUpdate(now, retryTime, 'interval')).toBe(false);
  });

  test('a backward clock change or corrupt attempt time cannot stall checks', () => {
    for (const trigger of ['interval', 'resume'] as const) {
      expect(shouldCheckForAppUpdate(now + 1, now, trigger)).toBe(true);
      expect(shouldCheckForAppUpdate(Number.NaN, now, trigger)).toBe(true);
      expect(shouldCheckForAppUpdate(Number.POSITIVE_INFINITY, now, trigger)).toBe(true);
      expect(shouldCheckForAppUpdate(now, Number.NaN, trigger)).toBe(false);
    }
  });
});

describe('persisted update snooze', () => {
  test('dismissing a release creates a normalized 24-hour snooze that survives serialization', () => {
    expect(APP_UPDATE_SNOOZE_MS).toBe(24 * 60 * 60 * 1000);
    const snooze = createAppUpdateSnooze(' v0.2.31 ', now);
    expect(snooze).toEqual({ version: '0.2.31', until: now + APP_UPDATE_SNOOZE_MS });
    expect(parseAppUpdateSnooze(JSON.stringify(snooze), now + 1)).toEqual(snooze);
    expect(parseAppUpdateSnooze(JSON.stringify(snooze), now + APP_UPDATE_SNOOZE_MS - 1)).toEqual(snooze);
    expect(parseAppUpdateSnooze(JSON.stringify(snooze), now + APP_UPDATE_SNOOZE_MS)).toBeNull();
  });

  test('missing, malformed, wrong-type or incomplete stored data is ignored', () => {
    for (const value of [
      null, '', '{', 'null', 'false', '42', '"0.2.31"', '[]', '{}',
      JSON.stringify({ version: '0.2.31' }),
      JSON.stringify({ until: now + 1000 }),
      JSON.stringify({ version: 31, until: now + 1000 }),
      JSON.stringify({ version: '0.2.31', until: String(now + 1000) }),
      JSON.stringify({ version: '', until: now + 1000 }),
      JSON.stringify({ version: ' v ', until: now + 1000 }),
      '{"version":"0.2.31","until":1e999}',
    ]) {
      expect(parseAppUpdateSnooze(value, now)).toBeNull();
    }
  });

  test('expired and excessively distant deadlines do not suppress updates', () => {
    for (const until of [now - 1, now, now + 2 * APP_UPDATE_SNOOZE_MS + 1]) {
      expect(parseAppUpdateSnooze(JSON.stringify({ version: '0.2.31', until }), now)).toBeNull();
    }
    const clockAdjustedSnooze = { version: '0.2.31', until: now + 2 * APP_UPDATE_SNOOZE_MS };
    expect(parseAppUpdateSnooze(JSON.stringify(clockAdjustedSnooze), now)).toEqual(clockAdjustedSnooze);
  });

  test('invalid creation inputs do not persist unusable snoozes', () => {
    expect(createAppUpdateSnooze('', now)).toBeNull();
    expect(createAppUpdateSnooze('v', now)).toBeNull();
    expect(createAppUpdateSnooze('0.2.31', Number.NaN)).toBeNull();
    expect(createAppUpdateSnooze('0.2.31', Number.POSITIVE_INFINITY)).toBeNull();
    expect(parseAppUpdateSnooze(JSON.stringify({ version: '0.2.31', until: now + 1 }), Number.NaN)).toBeNull();
  });
});

describe('automatic update notification', () => {
  test('requires an available version, including updates that need a manual download', () => {
    expect(shouldPromptForAppUpdate(null, null, now)).toBe(false);
    expect(shouldPromptForAppUpdate({ ...availableUpdate, updateAvailable: false }, null, now)).toBe(false);
    expect(shouldPromptForAppUpdate({ ...availableUpdate, latestVersion: ' v ' }, null, now)).toBe(false);
    expect(shouldPromptForAppUpdate(availableUpdate, null, now)).toBe(true);
    expect(shouldPromptForAppUpdate({
      ...availableUpdate,
      autoUpdateSupported: false,
      downloadSizeBytes: null,
      unsupportedReason: 'update manifest does not include the current platform or architecture',
    }, null, now)).toBe(true);
  });

  test('snoozes the same release until the exact expiry boundary', () => {
    const snooze = createAppUpdateSnooze('V0.2.31', now);
    expect(shouldPromptForAppUpdate(availableUpdate, snooze, now)).toBe(false);
    expect(shouldPromptForAppUpdate({ ...availableUpdate, latestVersion: ' v0.2.31 ' }, snooze, now)).toBe(false);
    expect(shouldPromptForAppUpdate(availableUpdate, snooze, now + APP_UPDATE_SNOOZE_MS - 1)).toBe(false);
    expect(shouldPromptForAppUpdate(availableUpdate, snooze, now + APP_UPDATE_SNOOZE_MS)).toBe(true);
  });

  test('a newer or different available release bypasses the previous release snooze immediately', () => {
    const snooze = createAppUpdateSnooze('0.2.31', now);
    for (const latestVersion of ['0.2.32', '0.3.0', '0.2.31-beta.1']) {
      expect(shouldPromptForAppUpdate({ ...availableUpdate, latestVersion }, snooze, now)).toBe(true);
    }
  });

  test('invalid in-memory snoozes cannot hide a release indefinitely', () => {
    for (const until of [Number.NaN, Number.POSITIVE_INFINITY, now + 2 * APP_UPDATE_SNOOZE_MS + 1]) {
      expect(shouldPromptForAppUpdate(availableUpdate, { version: '0.2.31', until }, now)).toBe(true);
    }
  });
});
