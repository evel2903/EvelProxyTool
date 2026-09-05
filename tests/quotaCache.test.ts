import { describe, expect, it } from 'bun:test';
import {
  captureQuotaCacheGeneration,
  commitQuotaCacheIfCurrent,
  getQuotaCacheSnapshot,
  invalidateQuotaCache,
  pruneQuotaCache,
  updateQuotaCache,
} from '../src/services/quotaCache';

describe('额度跨页面缓存', () => {
  it('invalidates replaced credentials and rejects pending results from before import', () => {
    updateQuotaCache({
      replaced: { status: 'success', rows: [], fetchedAt: 1 },
      pending: { status: 'loading', rows: [] },
      retained: { status: 'success', rows: [], fetchedAt: 2 },
    });
    const generation = captureQuotaCacheGeneration();
    invalidateQuotaCache(new Set(['replaced']));
    expect(commitQuotaCacheIfCurrent(generation, () => { throw new Error('stale request committed'); })).toBe(false);
    expect(getQuotaCacheSnapshot()).toEqual({
      replaced: { status: 'idle', rows: [] },
      pending: { status: 'idle', rows: [] },
      retained: { status: 'success', rows: [], fetchedAt: 2 },
    });
  });

  it('保留仍存在的认证文件额度并清理失效项', () => {
    updateQuotaCache({
      first: { status: 'success', rows: [], fetchedAt: 1 },
      removed: { status: 'error', rows: [], error: 'old' },
    });
    pruneQuotaCache(new Set(['first']));

    expect(getQuotaCacheSnapshot()).toEqual({
      first: { status: 'success', rows: [], fetchedAt: 1 },
    });
  });

  it('认证文件集合变化后拒绝过期请求写回', () => {
    updateQuotaCache({
      stale: { status: 'loading', rows: [] },
      retained: { status: 'loading', rows: [] },
    });
    const generation = captureQuotaCacheGeneration();
    pruneQuotaCache(new Set(['retained']));
    let committed = false;

    expect(commitQuotaCacheIfCurrent(generation, () => {
      committed = true;
    })).toBe(false);
    expect(committed).toBe(false);
    expect(getQuotaCacheSnapshot().retained).toEqual({ status: 'idle', rows: [] });
  });
});
