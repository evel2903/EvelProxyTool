import { managementApi } from './managementApi';

export type AuthFileUploadResult = {
  uploaded: string[];
  failed: Array<{ file: File; error: string }>;
};

/** Keep individual failures so retrying a batch never resends successful accounts. */
export async function uploadAuthFiles(
  files: readonly File[],
  upload: (file: File) => Promise<unknown> = managementApi.uploadAuthFile,
): Promise<AuthFileUploadResult> {
  const result: AuthFileUploadResult = { uploaded: [], failed: [] };
  for (const file of files) {
    try {
      await upload(file);
      result.uploaded.push(file.name);
    } catch (error) {
      result.failed.push({ file, error: error instanceof Error ? error.message : String(error) });
    }
  }
  return result;
}
