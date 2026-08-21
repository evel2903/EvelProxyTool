import { Component, type ErrorInfo, type ReactNode } from 'react';
import { useI18n } from './i18n';
import { Button } from '@/components/ui/button';

type Props = { children: ReactNode };
type State = { error: Error | null };

export class AppErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('EvelProxyTool 渲染异常', error, info.componentStack);
  }

  render() {
    if (!this.state.error) return this.props.children;
    return <AppErrorFallback error={this.state.error} />;
  }
}

function AppErrorFallback({ error }: { error: Error }) {
  const { t } = useI18n();
  return (
    <main className="grid min-h-screen place-items-center bg-background p-6">
      <section className="grid max-w-sm gap-3 rounded-xl border border-border bg-card p-6 text-center shadow-sm">
        <strong className="text-base font-semibold">{t('error.render.title')}</strong>
        <span className="text-sm text-muted-foreground">{error.message || t('error.unknown')}</span>
        <Button type="button" onClick={() => window.location.reload()}>
          {t('error.reload')}
        </Button>
      </section>
    </main>
  );
}
