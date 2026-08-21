import { useCallback, useEffect, useRef, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { Activity, BarChart3, CircleDollarSign, Clock3, Database, List, Pencil, RefreshCw, ShieldCheck, Sparkles, Trash2, TriangleAlert, X } from 'lucide-react';
import { getCurrentLocale, useI18n } from '../i18n';
import { formatUsageNumber } from '../services/usageNumber';
import { cn } from '@/lib/utils';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';

type UsageTab = 'overview' | 'analysis' | 'events' | 'pricing';
type UsageRange = '4h' | '24h' | 'today' | '7d' | '30d' | 'all' | 'custom';

type CollectorStatus = {
  state: 'waiting-core' | 'collecting' | 'error';
  message: string;
  lastCollectedAt: string | null;
  totalRecords: number;
};

type TimelinePoint = {
  hour: string;
  requests: number;
  success: number;
  failure: number;
  tokens: number;
};

type UsageOverview = {
  totalRequests: number;
  successCount: number;
  failureCount: number;
  successRate: number;
  inputTokens: number;
  outputTokens: number;
  reasoningTokens: number;
  cacheReadTokens: number;
  cacheCreationTokens: number;
  totalTokens: number;
  rpm: number;
  tpm: number;
  tps: number;
  averageLatencyMs: number;
  cacheHitRate: number;
  estimatedCost: number;
  pricedRequests: number;
  timeline: TimelinePoint[];
};

type UsageCategory = {
  key: string;
  label: string;
  requests: number;
  failures: number;
  tokens: number;
};

type UsageAnalysis = {
  models: UsageCategory[];
  providers: UsageCategory[];
  sources: UsageCategory[];
  apiKeys: UsageCategory[];
};

type UsageRecord = {
  id: string;
  timestamp: string;
  latency_ms: number;
  ttft_ms: number | null;
  source: string;
  source_display: string;
  failed: boolean;
  provider: string;
  model: string;
  alias: string;
  reasoning_effort: string;
  endpoint: string;
  api_key_hash: string;
  api_key_display: string;
  api_key_remark: string;
  tokens: {
    input_tokens: number;
    output_tokens: number;
    reasoning_tokens: number;
    cache_read_tokens: number;
    cache_creation_tokens: number;
    total_tokens: number;
  };
};

type UsageEventPage = {
  items: UsageRecord[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
};

type ModelPrice = {
  model: string;
  prompt: number;
  completion: number;
  cache: number;
  cacheRead: number;
  cacheCreation: number;
  promptConfigured: boolean;
  completionConfigured: boolean;
  cacheReadConfigured: boolean;
  cacheCreationConfigured: boolean;
  source: string;
  sourceModelId: string;
  updatedAtMs: number;
};

type UsagePriceRow = {
  model: string;
  requests: number;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheCreationTokens: number;
  totalTokens: number;
  estimatedCost: number;
  price: ModelPrice | null;
};

type UsagePricing = {
  rows: UsagePriceRow[];
  totalCost: number;
  totalRequests: number;
  pricedRequests: number;
  savedPrices: number;
};

type ModelPriceSyncResult = {
  imported: number;
  skipped: number;
  unmatched: string[];
  usedBuiltin: boolean;
};

type UsageQuery = {
  start?: string;
  end?: string;
  model?: string;
  provider?: string;
  source?: string;
  api_key_hash?: string;
  failed?: boolean;
  page?: number;
  page_size?: number;
};

const TAB_KEY = 'cpa-gui.usage-records-tab.v1';
const RANGE_KEY = 'cpa-gui.usage-records-range.v1';
const emptyAnalysis: UsageAnalysis = { models: [], providers: [], sources: [], apiKeys: [] };

const loadTab = (): UsageTab => {
  try {
    const saved = localStorage.getItem(TAB_KEY);
    return saved === 'analysis' || saved === 'events' || saved === 'pricing' ? saved : 'overview';
  } catch {
    return 'overview';
  }
};

const loadRange = (): UsageRange => {
  try {
    const saved = localStorage.getItem(RANGE_KEY) as UsageRange | null;
    return ['4h', '24h', 'today', '7d', '30d', 'all', 'custom'].includes(saved ?? '')
      ? saved as UsageRange
      : '24h';
  } catch {
    return '24h';
  }
};

const rangeQuery = (range: UsageRange, customStart: string, customEnd: string): Pick<UsageQuery, 'start' | 'end'> => {
  const now = new Date();
  if (range === 'all') return {};
  if (range === 'custom') {
    const start = customStart ? new Date(customStart) : null;
    const end = customEnd ? new Date(customEnd) : null;
    return {
      start: start && !Number.isNaN(start.getTime()) ? start.toISOString() : undefined,
      end: end && !Number.isNaN(end.getTime()) ? end.toISOString() : undefined,
    };
  }
  if (range === 'today') {
    const start = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    return { start: start.toISOString(), end: now.toISOString() };
  }
  const hours = range === '4h' ? 4 : range === '24h' ? 24 : range === '7d' ? 24 * 7 : 24 * 30;
  return { start: new Date(now.getTime() - hours * 3_600_000).toISOString(), end: now.toISOString() };
};

const compactNumber = (value: number) => formatUsageNumber(value, getCurrentLocale());

const formatUsd = (value: number) => {
  const amount = Number.isFinite(value) ? value : 0;
  const absolute = Math.abs(amount);
  const maximumFractionDigits = absolute === 0 || absolute >= 1
    ? 2
    : absolute >= 0.01
      ? 4
      : absolute >= 0.0001
        ? 6
        : 8;
  return `$${new Intl.NumberFormat(getCurrentLocale(), {
    minimumFractionDigits: 2,
    maximumFractionDigits,
  }).format(amount)}`;
};

const formatTime = (value: string) => {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : new Intl.DateTimeFormat(getCurrentLocale(), {
    month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit',
  }).format(date);
};

const filterOptions = (items: UsageCategory[]) => items.filter((item) => item.key && item.label);

export function UsageRecordsPage() {
  const { t } = useI18n();
  const [activeTab, setActiveTab] = useState<UsageTab>(loadTab);
  const [range, setRange] = useState<UsageRange>(loadRange);
  const [customStart, setCustomStart] = useState('');
  const [customEnd, setCustomEnd] = useState('');
  const [model, setModel] = useState('');
  const [provider, setProvider] = useState('');
  const [source, setSource] = useState('');
  const [apiKeyHash, setApiKeyHash] = useState('');
  const [result, setResult] = useState('all');
  const [page, setPage] = useState(1);
  const [status, setStatus] = useState<CollectorStatus | null>(null);
  const [overview, setOverview] = useState<UsageOverview | null>(null);
  const [analysis, setAnalysis] = useState<UsageAnalysis>(emptyAnalysis);
  const [optionsAnalysis, setOptionsAnalysis] = useState<UsageAnalysis>(emptyAnalysis);
  const [events, setEvents] = useState<UsageEventPage | null>(null);
  const [pricing, setPricing] = useState<UsagePricing | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const requestIdRef = useRef(0);

  useEffect(() => {
    try { localStorage.setItem(TAB_KEY, activeTab); } catch { /* Keep the in-memory tab. */ }
  }, [activeTab]);

  useEffect(() => {
    try { localStorage.setItem(RANGE_KEY, range); } catch { /* Keep the in-memory range. */ }
  }, [range]);

  const buildQueries = useCallback(() => {
    const nextTimeQuery = rangeQuery(range, customStart, customEnd);
    return {
      timeQuery: nextTimeQuery,
      query: {
        ...nextTimeQuery,
        model: model || undefined,
        provider: provider || undefined,
        source: source || undefined,
        api_key_hash: apiKeyHash || undefined,
        failed: result === 'failed' ? true : result === 'success' ? false : undefined,
      } satisfies UsageQuery,
    };
  }, [apiKeyHash, customEnd, customStart, model, provider, range, result, source]);

  const loadData = useCallback(async (quiet = false) => {
    const requestId = ++requestIdRef.current;
    const { timeQuery, query } = buildQueries();
    if (!quiet) setLoading(true);
    try {
      const statusRequest = invoke<CollectorStatus>('get_usage_collector_status');
      const optionsRequest = invoke<UsageAnalysis>('get_usage_analysis', { query: timeQuery });
      if (activeTab === 'overview') {
        const [nextStatus, nextOptions, nextOverview] = await Promise.all([
          statusRequest,
          optionsRequest,
          invoke<UsageOverview>('get_usage_overview', { query }),
        ]);
        if (requestId !== requestIdRef.current) return;
        setStatus(nextStatus);
        setOptionsAnalysis(nextOptions);
        setOverview(nextOverview);
      } else if (activeTab === 'analysis') {
        const [nextStatus, nextOptions, nextOverview, nextAnalysis] = await Promise.all([
          statusRequest,
          optionsRequest,
          invoke<UsageOverview>('get_usage_overview', { query }),
          invoke<UsageAnalysis>('get_usage_analysis', { query }),
        ]);
        if (requestId !== requestIdRef.current) return;
        setStatus(nextStatus);
        setOptionsAnalysis(nextOptions);
        setOverview(nextOverview);
        setAnalysis(nextAnalysis);
      } else if (activeTab === 'events') {
        const [nextStatus, nextOptions, nextEvents] = await Promise.all([
          statusRequest,
          optionsRequest,
          invoke<UsageEventPage>('get_usage_events', {
            query: { ...query, page, page_size: 50 },
          }),
        ]);
        if (requestId !== requestIdRef.current) return;
        setStatus(nextStatus);
        setOptionsAnalysis(nextOptions);
        setEvents(nextEvents);
      } else {
        const [nextStatus, nextOptions, nextPricing] = await Promise.all([
          statusRequest,
          optionsRequest,
          invoke<UsagePricing>('get_usage_pricing', { query }),
        ]);
        if (requestId !== requestIdRef.current) return;
        setStatus(nextStatus);
        setOptionsAnalysis(nextOptions);
        setPricing(nextPricing);
      }
      setError('');
    } catch (requestError) {
      if (requestId === requestIdRef.current) setError(String(requestError));
    } finally {
      if (requestId === requestIdRef.current) setLoading(false);
    }
  }, [activeTab, buildQueries, page]);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  useEffect(() => {
    let disposed = false;
    let unlisten: (() => void) | null = null;
    const refresh = () => {
      if (!disposed && !document.hidden) void loadData(true);
    };
    listen('usage-records-updated', refresh).then((stop) => {
      if (disposed) stop(); else unlisten = stop;
    }).catch(() => {});
    const timer = window.setInterval(refresh, 5_000);
    const refreshWhenVisible = () => {
      if (!document.hidden) refresh();
    };
    window.addEventListener('focus', refresh);
    document.addEventListener('visibilitychange', refreshWhenVisible);
    return () => {
      disposed = true;
      unlisten?.();
      window.clearInterval(timer);
      window.removeEventListener('focus', refresh);
      document.removeEventListener('visibilitychange', refreshWhenVisible);
    };
  }, [loadData]);

  const changeFilter = (setter: (value: string) => void, value: string) => {
    setter(value);
    setPage(1);
  };

  const collectorTone = status?.state === 'error' ? 'error' : status?.state === 'collecting' ? 'success' : '';
  const showInitialLoading = loading && (
    (activeTab === 'overview' && !overview)
    || (activeTab === 'analysis' && !overview)
    || (activeTab === 'events' && !events)
    || (activeTab === 'pricing' && !pricing)
  );

  return (
    <section className="grid gap-4">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <span className="block text-xs font-bold tracking-wide text-muted-foreground uppercase">{t('usage.eyebrow')}</span>
          <h1 className="mt-1 text-2xl font-bold">{t('usage.title')}</h1>
        </div>
        <div className="flex items-center gap-2.5 rounded-lg border bg-card px-3.5 py-2.5" title={status?.message}>
          <span className={cn('size-1.5 rounded-full', collectorTone === 'success' ? 'bg-[var(--theme-2f6b3f)]' : collectorTone === 'error' ? 'bg-destructive' : 'bg-muted-foreground')} />
          <div>
            <strong className="block text-sm font-semibold">{status?.state === 'collecting' ? t('usage.collector.collecting') : status?.state === 'error' ? t('usage.collector.error') : t('usage.collector.waiting')}</strong>
            <span className="block text-xs text-muted-foreground">{t('usage.longTermRecords', { count: compactNumber(status?.totalRecords ?? 0) })}</span>
          </div>
        </div>
      </header>

      {error ? <div className="rounded-lg border border-destructive/30 bg-destructive/10 px-3.5 py-2.5 text-sm text-destructive">{error}</div> : null}

      <div className="inline-flex w-fit gap-0.5 rounded-lg bg-muted p-0.5" role="tablist" aria-label={t('usage.pageLabel')}>
        {([
          ['overview', Activity, t('usage.tab.overview')],
          ['analysis', BarChart3, t('usage.tab.analysis')],
          ['events', List, t('usage.tab.events')],
          ['pricing', CircleDollarSign, t('usage.tab.pricing')],
        ] as const).map(([id, Icon, label]) => (
          <button
            key={id}
            type="button"
            className={cn(
              'flex items-center gap-1.5 rounded-md px-3.5 py-1.5 text-sm font-medium whitespace-nowrap transition-colors',
              activeTab === id ? 'bg-card text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground',
            )}
            onClick={() => setActiveTab(id)}
          >
            <Icon size={14} aria-hidden="true" />{label}
          </button>
        ))}
      </div>

      <Card className="grid grid-cols-2 gap-2.5 p-3 sm:grid-cols-3 lg:grid-cols-6">
        <Select value={range} onValueChange={(value) => { setRange(value as UsageRange); setPage(1); }}>
          <SelectTrigger aria-label={t('usage.filter.timeRange')}><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="4h">{t('usage.range.4h')}</SelectItem>
            <SelectItem value="24h">{t('usage.range.24h')}</SelectItem>
            <SelectItem value="today">{t('usage.range.today')}</SelectItem>
            <SelectItem value="7d">{t('usage.range.7d')}</SelectItem>
            <SelectItem value="30d">{t('usage.range.30d')}</SelectItem>
            <SelectItem value="all">{t('usage.range.all')}</SelectItem>
            <SelectItem value="custom">{t('usage.range.custom')}</SelectItem>
          </SelectContent>
        </Select>
        <Select value={model || 'all'} onValueChange={(value) => changeFilter(setModel, value === 'all' ? '' : value)}>
          <SelectTrigger aria-label={t('usage.filter.model')}><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">{t('usage.filter.allModels')}</SelectItem>
            {filterOptions(optionsAnalysis.models).map((item) => <SelectItem value={item.key} key={item.key}>{item.label}</SelectItem>)}
          </SelectContent>
        </Select>
        <Select value={provider || 'all'} onValueChange={(value) => changeFilter(setProvider, value === 'all' ? '' : value)}>
          <SelectTrigger aria-label={t('usage.column.provider')}><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">{t('usage.filter.allProviders')}</SelectItem>
            {filterOptions(optionsAnalysis.providers).map((item) => <SelectItem value={item.key} key={item.key}>{item.label}</SelectItem>)}
          </SelectContent>
        </Select>
        <Select value={source || 'all'} onValueChange={(value) => changeFilter(setSource, value === 'all' ? '' : value)}>
          <SelectTrigger aria-label={t('usage.filter.source')}><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">{t('usage.filter.allSources')}</SelectItem>
            {filterOptions(optionsAnalysis.sources).map((item) => <SelectItem value={item.key} key={item.key}>{item.label}</SelectItem>)}
          </SelectContent>
        </Select>
        <Select value={apiKeyHash || 'all'} onValueChange={(value) => changeFilter(setApiKeyHash, value === 'all' ? '' : value)}>
          <SelectTrigger aria-label={t('usage.column.apiKey')}><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">{t('usage.filter.allKeys')}</SelectItem>
            {filterOptions(optionsAnalysis.apiKeys).map((item) => <SelectItem value={item.key} key={item.key}>{item.label}</SelectItem>)}
          </SelectContent>
        </Select>
        <Select value={result} onValueChange={(value) => changeFilter(setResult, value)}>
          <SelectTrigger aria-label={t('usage.filter.result')}><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">{t('usage.filter.allResults')}</SelectItem>
            <SelectItem value="success">{t('usage.result.success')}</SelectItem>
            <SelectItem value="failed">{t('usage.result.failed')}</SelectItem>
          </SelectContent>
        </Select>
        {range === 'custom' ? (
          <div className="col-span-full flex flex-wrap items-center gap-2 border-t pt-3">
            <Input type="datetime-local" className="w-auto" value={customStart} onChange={(event) => setCustomStart(event.currentTarget.value)} aria-label={t('usage.filter.startTime')} />
            <span className="text-sm text-muted-foreground">{t('usage.filter.to')}</span>
            <Input type="datetime-local" className="w-auto" value={customEnd} onChange={(event) => setCustomEnd(event.currentTarget.value)} aria-label={t('usage.filter.endTime')} />
          </div>
        ) : null}
      </Card>

      {showInitialLoading ? <div className="flex items-center gap-2 text-sm text-muted-foreground"><Database size={20} aria-hidden="true" /><span>{t('usage.loading')}</span></div> : null}

      {activeTab === 'overview' && overview ? <OverviewView overview={overview} /> : null}
      {activeTab === 'analysis' ? <AnalysisView analysis={analysis} overview={overview} /> : null}
      {activeTab === 'events' && events ? <EventsView events={events} onPage={setPage} /> : null}
      {activeTab === 'pricing' && pricing ? <PricingView pricing={pricing} query={buildQueries().query} onChanged={() => loadData(true)} /> : null}
    </section>
  );
}

function OverviewView({ overview }: { overview: UsageOverview }) {
  const { t } = useI18n();
  const cards = [
    { icon: Activity, label: t('usage.stat.requests'), value: compactNumber(overview.totalRequests), meta: t('usage.stat.requestMeta', { success: compactNumber(overview.successCount), failed: compactNumber(overview.failureCount) }) },
    { icon: Sparkles, label: t('usage.stat.tokens'), value: compactNumber(overview.totalTokens), meta: t('usage.stat.tokenMeta', { input: compactNumber(overview.inputTokens), output: compactNumber(overview.outputTokens) }) },
    { icon: ShieldCheck, label: t('usage.stat.successRate'), value: `${overview.successRate.toFixed(1)}%`, meta: t('usage.stat.reasoningMeta', { tokens: compactNumber(overview.reasoningTokens) }) },
    { icon: Clock3, label: t('usage.stat.tps'), value: `${overview.tps.toFixed(1)} TPS`, meta: t('usage.stat.performanceMeta', { rpm: overview.rpm.toFixed(2), latency: Math.round(overview.averageLatencyMs) }) },
    { icon: Database, label: t('usage.stat.cacheHitRate'), value: `${(overview.cacheHitRate * 100).toFixed(1)}%`, meta: t('usage.stat.cacheHitMeta', { hit: compactNumber(overview.cacheReadTokens), input: compactNumber(overview.inputTokens) }) },
    { icon: CircleDollarSign, label: t('usage.stat.estimatedCost'), value: formatUsd(overview.estimatedCost), meta: t('usage.stat.costMeta', { priced: compactNumber(overview.pricedRequests), total: compactNumber(overview.totalRequests) }) },
  ];
  return (
    <div className="grid gap-4">
      <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 lg:grid-cols-6">
        {cards.map(({ icon: Icon, label, value, meta }) => (
          <Card className="gap-2 p-3.5" key={label}>
            <span className="flex items-center gap-1.5 truncate text-xs font-medium text-muted-foreground"><Icon size={14} aria-hidden="true" />{label}</span>
            <strong className="text-xl font-bold tracking-tight tabular-nums">{value}</strong>
            <small className="truncate text-[11px] text-muted-foreground" title={meta}>{meta}</small>
          </Card>
        ))}
      </div>
      <div className="grid grid-cols-1 gap-3.5 lg:grid-cols-[1.9fr_1fr]">
        <Card className="gap-1 p-4 pb-3.5">
          <strong className="text-sm font-semibold">{t('usage.trend.title')}</strong>
          <span className="text-xs text-muted-foreground">{t('usage.trend.description')}</span>
          {overview.timeline.length ? <UsageTrend points={overview.timeline} /> : <UsageEmpty />}
        </Card>
        <Card className="gap-1 p-4">
          <strong className="text-sm font-semibold">{t('usage.token.title')}</strong>
          <span className="text-xs text-muted-foreground">{t('usage.token.description')}</span>
          <div className="mt-2 grid gap-3">
            <TokenMetric label={t('usage.token.input')} value={overview.inputTokens} total={overview.totalTokens} />
            <TokenMetric label={t('usage.token.output')} value={overview.outputTokens} total={overview.totalTokens} />
            <TokenMetric label={t('usage.token.reasoning')} value={overview.reasoningTokens} total={overview.totalTokens} />
            <TokenMetric label={t('usage.token.cacheRead')} value={overview.cacheReadTokens} total={overview.totalTokens} />
            <TokenMetric label={t('usage.token.cacheCreation')} value={overview.cacheCreationTokens} total={overview.totalTokens} />
          </div>
        </Card>
      </div>
    </div>
  );
}

function UsageTrend({ points }: { points: TimelinePoint[] }) {
  const { t } = useI18n();
  const recent = points.slice(-48);
  const max = Math.max(...recent.map((point) => point.requests), 1);
  const polyline = recent.map((point, index) => `${recent.length === 1 ? 50 : index * 100 / (recent.length - 1)},${28 - point.requests * 24 / max}`).join(' ');
  return (
    <div className="mt-2">
      <svg viewBox="0 0 100 32" preserveAspectRatio="none" aria-label={t('usage.trend.aria')} className="h-44 w-full">
        <polyline points={polyline} fill="none" stroke="var(--theme-2d2a26)" strokeWidth="1.5" vectorEffect="non-scaling-stroke" />
      </svg>
      <div className="mt-2.5 flex justify-between font-mono text-[11.5px] text-muted-foreground">
        <span>{recent[0]?.hour ?? ''}</span>
        <strong className="font-medium text-foreground">{compactNumber(recent.reduce((sum, point) => sum + point.tokens, 0))} Token</strong>
        <span>{recent[recent.length - 1]?.hour ?? ''}</span>
      </div>
    </div>
  );
}

function TokenMetric({ label, value, total }: { label: string; value: number; total: number }) {
  const percent = total ? Math.min(value * 100 / total, 100) : 0;
  return (
    <div>
      <div className="flex justify-between text-[12.5px]">
        <strong className="font-medium">{label}</strong>
        <small className="text-muted-foreground tabular-nums">{compactNumber(value)}</small>
      </div>
      <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-muted">
        <div className="h-full rounded-full bg-primary" style={{ width: `${percent}%` }} />
      </div>
    </div>
  );
}

function AnalysisView({ analysis, overview }: { analysis: UsageAnalysis; overview: UsageOverview | null }) {
  const { t } = useI18n();
  const hours = (overview?.timeline ?? []).map((point) => ({
    key: point.hour,
    label: point.hour,
    requests: point.requests,
    failures: point.failure,
    tokens: point.tokens,
  })).sort((left, right) => right.tokens - left.tokens);
  return (
    <div className="grid grid-cols-1 gap-3.5 lg:grid-cols-2">
      <CategoryPanel title={t('usage.analysis.models')} items={analysis.models} />
      <CategoryPanel title={t('usage.column.provider')} items={analysis.providers} />
      <CategoryPanel title={t('usage.analysis.sources')} items={analysis.sources} compactLabels />
      <CategoryPanel title={t('usage.analysis.keys')} items={analysis.apiKeys} />
      <CategoryPanel title={t('usage.analysis.hours')} items={hours} />
    </div>
  );
}

function CategoryPanel({ title, items, compactLabels = false }: { title: string; items: UsageCategory[]; compactLabels?: boolean }) {
  const { t } = useI18n();
  const max = Math.max(...items.map((item) => item.tokens), 1);
  const total = items.reduce((sum, item) => sum + item.tokens, 0);
  return (
    <Card className="gap-1 p-4">
      <div className="flex items-baseline justify-between">
        <strong className="text-sm font-semibold">{title}</strong>
        <span className="text-xs text-muted-foreground">{t('usage.analysis.sortedByTokens')}</span>
      </div>
      {items.length ? (
        <div className="mt-2 grid gap-3">
          {items.slice(0, 10).map((item) => (
            <div key={item.key}>
              <div className={cn('flex justify-between gap-3 text-[12.5px]', compactLabels ? undefined : 'font-mono')}>
                <span className="truncate font-medium" title={item.label}>{item.label}</span>
                <span className="shrink-0 text-muted-foreground">
                  {t('usage.analysis.itemMeta', { requests: compactNumber(item.requests), percent: total ? (item.tokens * 100 / total).toFixed(1) : '0.0', tokens: compactNumber(item.tokens) })}
                </span>
              </div>
              <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-muted">
                <div className="h-full rounded-full bg-primary" style={{ width: `${item.tokens * 100 / max}%` }} />
              </div>
            </div>
          ))}
        </div>
      ) : <UsageEmpty />}
    </Card>
  );
}

function EventsView({ events, onPage }: { events: UsageEventPage; onPage: (page: number) => void }) {
  const { t } = useI18n();
  return (
    <Card className="gap-0 p-0">
      <div className="flex items-center justify-between gap-3 p-4 pb-3 text-sm">
        <span className="text-muted-foreground">{t('usage.events.total', { count: compactNumber(events.total) })}</span>
        <span className="text-muted-foreground">{t('usage.events.page', { page: events.page, total: events.totalPages })}</span>
      </div>
      {events.items.length ? (
        <div className="overflow-x-auto border-t">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t('usage.column.time')}</TableHead>
                <TableHead>{t('usage.column.model')}</TableHead>
                <TableHead>{t('usage.column.provider')}</TableHead>
                <TableHead>{t('usage.column.source')}</TableHead>
                <TableHead>{t('usage.column.apiKey')}</TableHead>
                <TableHead>{t('usage.column.input')}</TableHead>
                <TableHead>{t('usage.column.output')}</TableHead>
                <TableHead>{t('usage.column.reasoning')}</TableHead>
                <TableHead>{t('usage.column.cache')}</TableHead>
                <TableHead>{t('usage.column.total')}</TableHead>
                <TableHead>{t('usage.column.result')}</TableHead>
                <TableHead>{t('usage.column.latency')}</TableHead>
                <TableHead>{t('usage.column.ttft')}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {events.items.map((record) => (
                <TableRow key={record.id}>
                  <TableCell className="font-mono text-xs whitespace-nowrap text-muted-foreground">{formatTime(record.timestamp)}</TableCell>
                  <TableCell className="whitespace-nowrap">
                    <strong className="block font-mono text-xs" title={record.alias || record.model}>{record.alias || record.model}</strong>
                    {record.alias || record.reasoning_effort ? <small className="block text-[11px] text-muted-foreground" title={record.model}>{record.alias ? record.model : ''}{record.alias && record.reasoning_effort ? ' · ' : ''}{record.reasoning_effort}</small> : null}
                  </TableCell>
                  <TableCell className="whitespace-nowrap text-muted-foreground" title={record.provider}>{record.provider || '—'}</TableCell>
                  <TableCell className="whitespace-nowrap" title={record.source_display || undefined}>{record.source_display || '—'}</TableCell>
                  <TableCell className="whitespace-nowrap">
                    <strong className="block text-xs" title={record.api_key_remark}>{record.api_key_remark || t('usage.key.noRemark')}</strong>
                    <small className="block text-[11px] text-muted-foreground">{record.api_key_display || '—'}</small>
                  </TableCell>
                  <TableCell className="tabular-nums">{compactNumber(record.tokens.input_tokens)}</TableCell>
                  <TableCell className="tabular-nums">{compactNumber(record.tokens.output_tokens)}</TableCell>
                  <TableCell className="tabular-nums">{compactNumber(record.tokens.reasoning_tokens)}</TableCell>
                  <TableCell className="tabular-nums">{compactNumber(record.tokens.cache_read_tokens)}</TableCell>
                  <TableCell className="font-semibold tabular-nums">{compactNumber(record.tokens.total_tokens)}</TableCell>
                  <TableCell><Badge variant={record.failed ? 'destructive' : 'success'}>{record.failed ? t('usage.result.failed') : t('usage.result.success')}</Badge></TableCell>
                  <TableCell className="tabular-nums text-muted-foreground">{record.latency_ms} ms</TableCell>
                  <TableCell className="tabular-nums text-muted-foreground">{record.ttft_ms == null ? '—' : `${record.ttft_ms} ms`}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      ) : <div className="border-t p-8"><UsageEmpty /></div>}
      <div className="flex items-center justify-between gap-3 border-t p-3">
        <Button type="button" variant="outline" size="sm" disabled={events.page <= 1} onClick={() => onPage(events.page - 1)}>{t('usage.previous')}</Button>
        <Button type="button" variant="outline" size="sm" disabled={events.page >= events.totalPages} onClick={() => onPage(events.page + 1)}>{t('usage.next')}</Button>
      </div>
    </Card>
  );
}

type PriceDraft = {
  model: string;
  prompt: string;
  completion: string;
  cache: string;
  cacheRead: string;
  cacheCreation: string;
};

const emptyPriceDraft = (): PriceDraft => ({ model: '', prompt: '', completion: '', cache: '', cacheRead: '', cacheCreation: '' });
const priceDraftFor = (model = '', price?: ModelPrice | null): PriceDraft => ({
  model,
  prompt: price ? String(price.prompt) : '',
  completion: price ? String(price.completion) : '',
  cache: price ? String(price.cache) : '',
  cacheRead: price && (price.cacheReadConfigured || price.cacheRead > 0) ? String(price.cacheRead) : '',
  cacheCreation: price && (price.cacheCreationConfigured || price.cacheCreation > 0) ? String(price.cacheCreation) : '',
});

const parsePrice = (value: string) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : 0;
};

const priceUnit = (value: number | undefined) => Number.isFinite(value) ? `$${Number(value).toFixed(4)}` : '—';

function PricingView({ pricing, query, onChanged }: { pricing: UsagePricing; query: UsageQuery; onChanged: () => void | Promise<void> }) {
  const { t } = useI18n();
  const [search, setSearch] = useState('');
  const [draft, setDraft] = useState<PriceDraft | null>(null);
  const [saving, setSaving] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [message, setMessage] = useState('');
  const [localError, setLocalError] = useState('');
  const visibleRows = pricing.rows.filter((row) => {
    const keyword = search.trim().toLowerCase();
    return !keyword || row.model.toLowerCase().includes(keyword);
  });

  const savePrice = async () => {
    if (!draft?.model.trim()) {
      setLocalError(t('usage.pricing.modelRequired'));
      return;
    }
    setSaving(true);
    setLocalError('');
    try {
      await invoke('save_usage_model_price', {
        price: {
          model: draft.model.trim(),
          prompt: parsePrice(draft.prompt),
          completion: parsePrice(draft.completion),
          cache: draft.cache.trim() ? parsePrice(draft.cache) : parsePrice(draft.prompt),
          cacheRead: parsePrice(draft.cacheRead),
          cacheCreation: parsePrice(draft.cacheCreation),
          promptConfigured: draft.prompt.trim() !== '',
          completionConfigured: draft.completion.trim() !== '',
          cacheReadConfigured: draft.cacheRead.trim() !== '',
          cacheCreationConfigured: draft.cacheCreation.trim() !== '',
          source: 'manual',
          sourceModelId: '',
          updatedAtMs: 0,
        } satisfies ModelPrice,
      });
      setDraft(null);
      setMessage(t('usage.pricing.saved'));
      await onChanged();
    } catch (saveError) {
      setLocalError(String(saveError));
    } finally {
      setSaving(false);
    }
  };

  const deletePrice = async (model: string) => {
    if (!window.confirm(t('usage.pricing.deleteConfirm', { model }))) return;
    setLocalError('');
    try {
      await invoke('delete_usage_model_price', { model });
      setMessage(t('usage.pricing.deleted'));
      await onChanged();
    } catch (deleteError) {
      setLocalError(String(deleteError));
    }
  };

  const syncPrices = async () => {
    setSyncing(true);
    setLocalError('');
    setMessage('');
    try {
      const result = await invoke<ModelPriceSyncResult>('sync_usage_model_prices', { query });
      setMessage(result.usedBuiltin
        ? t('usage.pricing.syncFallback')
        : t('usage.pricing.syncResult', { imported: result.imported, skipped: result.skipped, unmatched: result.unmatched.length }));
      await onChanged();
    } catch (syncError) {
      setLocalError(String(syncError));
    } finally {
      setSyncing(false);
    }
  };

  return (
    <Card className="gap-0 p-0">
      <div className="flex flex-wrap items-center justify-between gap-3 p-4 pb-3">
        <div>
          <strong className="text-xl font-bold tabular-nums">{formatUsd(pricing.totalCost)}</strong>
          <span className="block text-xs text-muted-foreground">{t('usage.pricing.coverage', { priced: compactNumber(pricing.pricedRequests), total: compactNumber(pricing.totalRequests), saved: compactNumber(pricing.savedPrices) })}</span>
        </div>
        <div className="flex items-center gap-2">
          <Input value={search} onChange={(event) => setSearch(event.currentTarget.value)} placeholder={t('usage.pricing.search')} aria-label={t('usage.pricing.search')} className="w-52" />
          <Button type="button" variant="outline" size="sm" onClick={() => setDraft(emptyPriceDraft())}>{t('usage.pricing.add')}</Button>
          <Button type="button" size="sm" disabled={syncing} onClick={() => void syncPrices()}><RefreshCw size={14} className={syncing ? 'animate-spin' : undefined} />{syncing ? t('usage.pricing.syncing') : t('usage.pricing.sync')}</Button>
        </div>
      </div>

      {localError ? <div className="mx-4 mb-3 rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">{localError}</div> : null}
      {message ? <div className="mx-4 mb-3 rounded-lg border border-[var(--theme-b8d1bb)] bg-[var(--theme-f1f8f1)] px-3 py-2 text-sm text-[var(--theme-2f6b3f)]">{message}</div> : null}

      {draft ? (
        <div className="mx-4 mb-4 grid grid-cols-2 gap-3 rounded-lg border bg-muted/30 p-4 sm:grid-cols-3">
          <label className="grid gap-1.5"><span className="text-xs font-medium">{t('usage.pricing.model')}</span><Input value={draft.model} onChange={(event) => setDraft({ ...draft, model: event.currentTarget.value })} placeholder="gpt-5.6-terra" /></label>
          <label className="grid gap-1.5"><span className="text-xs font-medium">{t('usage.pricing.prompt')}</span><Input type="number" min="0" step="0.0001" value={draft.prompt} onChange={(event) => setDraft({ ...draft, prompt: event.currentTarget.value })} /></label>
          <label className="grid gap-1.5"><span className="text-xs font-medium">{t('usage.pricing.completion')}</span><Input type="number" min="0" step="0.0001" value={draft.completion} onChange={(event) => setDraft({ ...draft, completion: event.currentTarget.value })} /></label>
          <label className="grid gap-1.5"><span className="text-xs font-medium">{t('usage.pricing.cache')}</span><Input type="number" min="0" step="0.0001" value={draft.cache} onChange={(event) => setDraft({ ...draft, cache: event.currentTarget.value })} /></label>
          <label className="grid gap-1.5"><span className="text-xs font-medium">{t('usage.pricing.cacheRead')}</span><Input type="number" min="0" step="0.0001" value={draft.cacheRead} onChange={(event) => setDraft({ ...draft, cacheRead: event.currentTarget.value })} placeholder={t('usage.pricing.optional')} /></label>
          <label className="grid gap-1.5"><span className="text-xs font-medium">{t('usage.pricing.cacheCreation')}</span><Input type="number" min="0" step="0.0001" value={draft.cacheCreation} onChange={(event) => setDraft({ ...draft, cacheCreation: event.currentTarget.value })} placeholder={t('usage.pricing.optional')} /></label>
          <div className="col-span-full flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={() => setDraft(null)}><X size={14} aria-hidden="true" />{t('common.cancel')}</Button>
            <Button type="button" disabled={saving} onClick={() => void savePrice()}>{saving ? t('usage.pricing.saving') : t('common.save')}</Button>
          </div>
        </div>
      ) : null}

      {visibleRows.length ? (
        <div className="overflow-x-auto border-t">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t('usage.pricing.model')}</TableHead>
                <TableHead>{t('usage.pricing.calls')}</TableHead>
                <TableHead>{t('usage.column.token')}</TableHead>
                <TableHead>{t('usage.pricing.cost')}</TableHead>
                <TableHead>{t('usage.pricing.prompt')}</TableHead>
                <TableHead>{t('usage.pricing.completion')}</TableHead>
                <TableHead>{t('usage.pricing.cacheRead')}</TableHead>
                <TableHead>{t('usage.pricing.cacheCreation')}</TableHead>
                <TableHead>{t('usage.pricing.actions')}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {visibleRows.map((row) => (
                <TableRow key={row.model}>
                  <TableCell className="font-mono font-medium whitespace-nowrap">{row.model}</TableCell>
                  <TableCell className="tabular-nums">{compactNumber(row.requests)}</TableCell>
                  <TableCell className="tabular-nums">{compactNumber(row.totalTokens)}</TableCell>
                  <TableCell className="font-semibold tabular-nums">{row.price ? formatUsd(row.estimatedCost) : '—'}</TableCell>
                  <TableCell className="tabular-nums text-muted-foreground">{row.price ? priceUnit(row.price.prompt) : '—'}</TableCell>
                  <TableCell className="tabular-nums text-muted-foreground">{row.price ? priceUnit(row.price.completion) : '—'}</TableCell>
                  <TableCell className="tabular-nums text-muted-foreground">{row.price ? priceUnit(row.price.cacheReadConfigured || row.price.cacheRead > 0 ? row.price.cacheRead : row.price.cache) : '—'}</TableCell>
                  <TableCell className="tabular-nums text-muted-foreground">{row.price ? priceUnit(row.price.cacheCreationConfigured || row.price.cacheCreation > 0 ? row.price.cacheCreation : row.price.prompt) : '—'}</TableCell>
                  <TableCell>
                    <div className="flex items-center gap-1">
                      <Button type="button" variant="ghost" size="icon-sm" title={t('common.edit')} onClick={() => setDraft(priceDraftFor(row.model, row.price))}><Pencil size={14} aria-hidden="true" /></Button>
                      {row.price?.source === 'manual' ? <Button type="button" variant="ghost" size="icon-sm" className="text-destructive hover:text-destructive" title={t('common.delete')} onClick={() => void deletePrice(row.model)}><Trash2 size={14} aria-hidden="true" /></Button> : null}
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      ) : <div className="border-t p-8"><UsageEmpty /></div>}
    </Card>
  );
}

function UsageEmpty() {
  const { t } = useI18n();
  return <div className="grid justify-items-center gap-2 py-8 text-center text-sm text-muted-foreground"><TriangleAlert size={18} aria-hidden="true" /><span>{t('usage.empty')}</span></div>;
}
