import { describe, expect, test } from 'bun:test';
import {
  appUpdateIndicatorState,
  appUpdateManualHint,
  canInstallAppUpdate,
  type AppUpdateInfo,
} from '../src/appUpdateModel';

const availableUpdate: AppUpdateInfo = {
  currentVersion: '0.2.28',
  latestVersion: '0.2.29',
  updateAvailable: true,
  releaseUrl: 'https://github.com/evel2903/EvelProxyTool/releases/tag/v0.2.29',
  autoUpdateSupported: true,
  downloadSizeBytes: 1024,
  unsupportedReason: null,
};

describe('application update eligibility', () => {
  test('only an available, supported update can be installed', () => {
    expect(canInstallAppUpdate(availableUpdate, false, false)).toBe(true);
    expect(canInstallAppUpdate(null, false, false)).toBe(false);
    expect(canInstallAppUpdate({ ...availableUpdate, updateAvailable: false }, false, false)).toBe(false);
    expect(canInstallAppUpdate({ ...availableUpdate, autoUpdateSupported: false }, false, false)).toBe(false);
  });

  test('a recheck or running installation invalidates a previous install confirmation', () => {
    expect(canInstallAppUpdate(availableUpdate, true, false)).toBe(false);
    expect(canInstallAppUpdate(availableUpdate, false, true)).toBe(false);
    expect(canInstallAppUpdate(availableUpdate, true, true)).toBe(false);
  });

  test('a newer version still has an available indicator when manual download is required', () => {
    const manualUpdate = { ...availableUpdate, autoUpdateSupported: false };
    expect(canInstallAppUpdate(manualUpdate, false, false)).toBe(false);
    expect(appUpdateIndicatorState(manualUpdate.updateAvailable, false)).toBe('available');
    expect(appUpdateIndicatorState(true, true)).toBe('processing');
    expect(appUpdateIndicatorState(false, false)).toBeNull();
  });
});

describe('manual update guidance', () => {
  test('does not label an unknown or supported installation as unsupported', () => {
    expect(appUpdateManualHint(null)).toBeNull();
    expect(appUpdateManualHint(availableUpdate)).toBeNull();
  });

  test('localizes the unsupported installation reason', () => {
    expect(appUpdateManualHint({
      ...availableUpdate,
      autoUpdateSupported: false,
      unsupportedReason: 'current build is not a portable version that supports auto-update; download the first supported version manually',
    })).toEqual({ messageKey: 'appUpdate.unsupported.portable', detail: null });
  });

  test('distinguishes a missing platform package from an unsupported installation', () => {
    expect(appUpdateManualHint({
      ...availableUpdate,
      autoUpdateSupported: false,
      unsupportedReason: 'update manifest does not include the current platform or architecture',
    })).toEqual({ messageKey: 'appUpdate.unsupported.platform', detail: null });
  });

  test('keeps a future backend reason alongside localized manual download guidance', () => {
    expect(appUpdateManualHint({
      ...availableUpdate,
      autoUpdateSupported: false,
      unsupportedReason: '  This installation is on a read-only volume.  ',
    })).toEqual({
      messageKey: 'appUpdate.unsupported.manual',
      detail: 'This installation is on a read-only volume.',
    });
  });

  test('gives manual download guidance even when the backend omits a reason', () => {
    for (const unsupportedReason of [null, '', '  ']) {
      expect(appUpdateManualHint({
        ...availableUpdate,
        autoUpdateSupported: false,
        unsupportedReason,
      })).toEqual({ messageKey: 'appUpdate.unsupported.manual', detail: null });
    }
  });
});
