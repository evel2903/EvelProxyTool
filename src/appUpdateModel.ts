export type AppUpdateIndicatorState = 'available' | 'processing' | null;

export type AppUpdateInfo = {
  currentVersion: string;
  latestVersion: string;
  updateAvailable: boolean;
  releaseUrl: string;
  autoUpdateSupported: boolean;
  downloadSizeBytes: number | null;
  unsupportedReason: string | null;
};

export function canInstallAppUpdate(
  info: AppUpdateInfo | null,
  checking: boolean,
  processing: boolean,
): boolean {
  return Boolean(info?.updateAvailable && info.autoUpdateSupported && !checking && !processing);
}

type AppUpdateManualHint = {
  messageKey:
    | 'appUpdate.unsupported.portable'
    | 'appUpdate.unsupported.platform'
    | 'appUpdate.unsupported.manual';
  detail: string | null;
};

export function appUpdateManualHint(info: AppUpdateInfo | null): AppUpdateManualHint | null {
  if (!info || info.autoUpdateSupported) return null;

  const reason = info.unsupportedReason?.trim();
  if (reason === 'current build is not a portable version that supports auto-update; download the first supported version manually') {
    return { messageKey: 'appUpdate.unsupported.portable', detail: null };
  }
  if (reason === 'update manifest does not include the current platform or architecture') {
    return { messageKey: 'appUpdate.unsupported.platform', detail: null };
  }
  return { messageKey: 'appUpdate.unsupported.manual', detail: reason || null };
}

export function appUpdateIndicatorState(
  hasUpdate: boolean,
  processing: boolean,
): AppUpdateIndicatorState {
  if (processing) return 'processing';
  return hasUpdate ? 'available' : null;
}
