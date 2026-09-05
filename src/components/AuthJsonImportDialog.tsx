import { useRef, useState, type ChangeEvent } from 'react';
import { FileJson, Import, LoaderCircle } from 'lucide-react';
import { useI18n } from '../i18n';
import { AuthJsonImportError, MAX_AUTH_JSON_IMPORT_BYTES, parseAuthJsonImport, type AuthJsonImportMode, type AuthJsonImportProvider } from '../services/authJsonImport';
import type { AuthFileUploadResult } from '../services/authFileUpload';
import { Alert, AlertDescription } from './ui/alert';
import { Button } from './ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from './ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from './ui/select';

const providers = [
  { id: 'codex', name: 'Codex (ChatGPT)' },
  { id: 'claude', name: 'Claude' },
  { id: 'antigravity', name: 'Antigravity' },
  { id: 'kimi', name: 'Kimi' },
  { id: 'xai', name: 'xAI' },
  { id: 'gemini', name: 'Gemini' },
  { id: 'qwen', name: 'Qwen' },
  { id: 'vertex', name: 'Vertex AI' },
] as const;

export function AuthJsonImportDialog({ onClose, onImport }: {
  onClose: () => void;
  onImport: (files: readonly File[]) => Promise<AuthFileUploadResult>;
}) {
  const { t } = useI18n();
  const [provider, setProvider] = useState<AuthJsonImportProvider>('codex');
  const [mode, setMode] = useState<AuthJsonImportMode>('session');
  const [content, setContent] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [pending, setPending] = useState<File[]>([]);
  const fileInput = useRef<HTMLInputElement>(null);
  const requestInFlight = useRef(false);

  const resetError = () => {
    setError('');
    setPending([]);
  };

  const readFile = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.currentTarget.files?.[0];
    event.currentTarget.value = '';
    if (!file || requestInFlight.current) return;
    resetError();
    setContent('');
    if (file.size > MAX_AUTH_JSON_IMPORT_BYTES) {
      setError(t('jsonImport.error.too_large'));
      return;
    }
    requestInFlight.current = true;
    setBusy(true);
    try {
      setContent(await file.text());
    } catch {
      setError(t('jsonImport.fileReadFailed'));
    } finally {
      requestInFlight.current = false;
      setBusy(false);
    }
  };

  const submit = async () => {
    if (requestInFlight.current) return;
    setError('');
    let files: File[];
    try {
      files = pending.length > 0 ? pending : parseAuthJsonImport(content, mode, provider).map((entry) =>
        new File([JSON.stringify(entry.content)], entry.name, { type: 'application/json' }),
      );
    } catch (cause) {
      const message = cause instanceof AuthJsonImportError
        ? t(`jsonImport.error.${cause.code}`)
        : t('jsonImport.error.invalid_shape');
      setError(cause instanceof AuthJsonImportError && cause.entryIndex !== undefined
        ? t('jsonImport.error.entry', { index: cause.entryIndex + 1, message })
        : message);
      return;
    }
    requestInFlight.current = true;
    setBusy(true);
    try {
      const result = await onImport(files);
      // Release successful credentials immediately; only failed files are retained for retry.
      setContent('');
      setPending(result.failed.map(({ file }) => file));
      if (result.failed.length === 0) onClose();
      else setError(t('jsonImport.failed', { count: result.failed.length }));
    } catch {
      setError(t('jsonImport.uploadFailed'));
    } finally {
      requestInFlight.current = false;
      setBusy(false);
    }
  };

  return (
    <Dialog open onOpenChange={(open) => !open && !requestInFlight.current && onClose()}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl" showCloseButton={!busy}>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><FileJson size={18} aria-hidden="true" />{t('jsonImport.title')}</DialogTitle>
          <DialogDescription>{t('jsonImport.description')}</DialogDescription>
        </DialogHeader>
        <form className="grid gap-4" onSubmit={(event) => { event.preventDefault(); void submit(); }}>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="grid gap-2">
              <label htmlFor="auth-json-provider" className="font-medium">{t('jsonImport.provider')}</label>
              <Select value={provider} disabled={busy} onValueChange={(value) => {
                setProvider(value as AuthJsonImportProvider);
                if (value !== 'codex') setMode('auth');
                resetError();
              }}>
                <SelectTrigger id="auth-json-provider" className="w-full"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {providers.map((item) => <SelectItem key={item.id} value={item.id}>{item.name}</SelectItem>)}
                  <SelectItem value="auto">{t('jsonImport.provider.auto')}</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-2">
              <label htmlFor="auth-json-format" className="font-medium">{t('jsonImport.format')}</label>
              <Select value={mode} disabled={busy} onValueChange={(value) => { setMode(value as AuthJsonImportMode); resetError(); }}>
                <SelectTrigger id="auth-json-format" className="w-full"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {(provider === 'codex' ? ['session', 'auth', 'sub2api'] as const : ['auth'] as const).map((value) => (
                    <SelectItem key={value} value={value}>{t(`jsonImport.mode.${value}`)}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <p id="auth-json-hint" className="text-xs text-muted-foreground break-words">{t(`jsonImport.hint.${mode}`)}</p>
          <div className="grid gap-2">
            <div className="flex items-center justify-between gap-2">
              <label htmlFor="auth-json-content" className="font-medium">{t('jsonImport.content')}</label>
              <Button type="button" size="sm" variant="outline" disabled={busy} onClick={() => fileInput.current?.click()}>
                <FileJson size={14} aria-hidden="true" />{t('jsonImport.chooseFile')}
              </Button>
              <input ref={fileInput} type="file" accept=".json,application/json" hidden disabled={busy} onChange={(event) => void readFile(event)} />
            </div>
            <textarea
              id="auth-json-content"
              className="min-h-56 w-full resize-y rounded-md border border-input bg-transparent p-3 font-mono text-xs outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50"
              value={content}
              onChange={(event) => { setContent(event.currentTarget.value); resetError(); }}
              disabled={busy}
              spellCheck={false}
              autoComplete="off"
              autoCapitalize="off"
              autoCorrect="off"
              aria-describedby="auth-json-hint"
              aria-invalid={Boolean(error)}
              placeholder="{ … }"
            />
          </div>
          {error ? <Alert variant="destructive"><AlertDescription>{error}</AlertDescription></Alert> : null}
          <DialogFooter>
            <Button type="button" variant="outline" disabled={busy} onClick={onClose}>{t('common.cancel')}</Button>
            <Button type="submit" disabled={busy || (!content.trim() && pending.length === 0)}>
              {busy ? <LoaderCircle size={16} className="animate-spin" aria-hidden="true" /> : <Import size={16} aria-hidden="true" />}
              {busy ? t('jsonImport.importing') : pending.length > 0 ? t('jsonImport.retry') : t('jsonImport.submit')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
