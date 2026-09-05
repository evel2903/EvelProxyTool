import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, test } from 'bun:test';
import {
  generatePortableUpdateManifest,
} from '../scripts/manifest.mjs';

describe('Windows 便携更新清单', () => {
  test('URL、大小和哈希与实际上传资产一致', async () => {
    const root = await mkdtemp(join(tmpdir(), 'easycli-manifest-test-'));
    try {
      const payloads = {
        amd64: Buffer.from('amd64 full portable package'),
        aarch64: Buffer.from('aarch64 full portable package'),
      };
      for (const [arch, contents] of Object.entries(payloads)) {
        await writeFile(
          join(root, `EvelProxyTool-update-v1.2.3-Windows-${arch}.zip`),
          Buffer.from(`${arch} legacy update package`),
        );
        await writeFile(
          join(root, `EvelProxyTool-v1.2.3-Windows-${arch}.zip`),
          contents,
        );
      }

      const output = join(root, 'portable-update-windows.json');
      const manifest = await generatePortableUpdateManifest({
        directory: root,
        output,
        gitcodeRepository: 'mirror-owner/EvelProxyTool',
        tag: 'v1.2.3',
        publishedAt: '2026-07-24T00:00:00.000Z',
      });
      const saved = JSON.parse(await readFile(output, 'utf8'));

      expect(saved).toEqual(manifest);
      expect(manifest.releaseUrl).toBe('https://github.com/evel2903/EvelProxyTool/releases/tag/v1.2.3');
      for (const arch of ['amd64', 'aarch64'] as const) {
        const asset = manifest.assets[`windows-${arch}`];
        expect(asset.url).toBe(
          `https://github.com/evel2903/EvelProxyTool/releases/download/v1.2.3/EvelProxyTool-update-v1.2.3-Windows-${arch}.zip`,
        );
        expect(asset.fallbackUrls).toEqual([
          `https://api.gitcode.com/api/v5/repos/mirror-owner/EvelProxyTool/releases/v1.2.3/attach_files/EvelProxyTool-update-v1.2.3-Windows-${arch}.zip/download`,
        ]);
        const legacyPayload = Buffer.from(`${arch} legacy update package`);
        expect(asset.sizeBytes).toBe(legacyPayload.byteLength);
        expect(asset.sha256).toBe(createHash('sha256').update(legacyPayload).digest('hex'));
        const fullAsset = manifest.fullAssets[`windows-${arch}`];
        expect(fullAsset.url).toBe(
          `https://github.com/evel2903/EvelProxyTool/releases/download/v1.2.3/EvelProxyTool-v1.2.3-Windows-${arch}.zip`,
        );
        expect(fullAsset.fallbackUrls).toEqual([
          `https://api.gitcode.com/api/v5/repos/mirror-owner/EvelProxyTool/releases/v1.2.3/attach_files/EvelProxyTool-v1.2.3-Windows-${arch}.zip/download`,
        ]);
        expect(fullAsset.sizeBytes).toBe(payloads[arch].byteLength);
        expect(fullAsset.sha256).toBe(createHash('sha256').update(payloads[arch]).digest('hex'));
      }
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test('仅发布 amd64 时保留旧版更新包和完整包', async () => {
    const root = await mkdtemp(join(tmpdir(), 'easycli-manifest-missing-'));
    try {
      await writeFile(
        join(root, 'EvelProxyTool-update-v1.2.3-Windows-amd64.zip'),
        'amd64 legacy',
      );
      await writeFile(
        join(root, 'EvelProxyTool-v1.2.3-Windows-amd64.zip'),
        'amd64 full',
      );
      const manifest = await generatePortableUpdateManifest({
        directory: root,
        output: join(root, 'portable-update-windows.json'),
        tag: 'v1.2.3',
      });
      expect(Object.keys(manifest.assets)).toEqual(['windows-amd64']);
      expect(Object.keys(manifest.fullAssets)).toEqual(['windows-amd64']);
      expect(manifest.assets['windows-amd64'].url).toBe(
        'https://github.com/evel2903/EvelProxyTool/releases/download/v1.2.3/EvelProxyTool-update-v1.2.3-Windows-amd64.zip',
      );
      expect(manifest.fullAssets['windows-amd64'].url).toBe(
        'https://github.com/evel2903/EvelProxyTool/releases/download/v1.2.3/EvelProxyTool-v1.2.3-Windows-amd64.zip',
      );
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test('所有版本同时保留旧版更新包和完整包', async () => {
    const root = await mkdtemp(join(tmpdir(), 'easycli-manifest-dual-'));
    try {
      for (const arch of ['amd64', 'aarch64']) {
        await writeFile(
          join(root, `EvelProxyTool-update-v1.2.3-Windows-${arch}.zip`),
          `legacy update ${arch}`,
        );
        await writeFile(
          join(root, `EvelProxyTool-v1.2.3-Windows-${arch}.zip`),
          `full package ${arch}`,
        );
      }
      const manifest = await generatePortableUpdateManifest({
        directory: root,
        output: join(root, 'portable-update-windows.json'),
        tag: 'v1.2.3',
        publishedAt: '2026-08-02T00:00:00.000Z',
      });

      expect(manifest.assets['windows-amd64'].url).toEndWith(
        '/EvelProxyTool-update-v1.2.3-Windows-amd64.zip',
      );
      expect(manifest.assets['windows-aarch64'].url).toEndWith(
        '/EvelProxyTool-update-v1.2.3-Windows-aarch64.zip',
      );
      expect(manifest.fullAssets['windows-amd64'].url).toEndWith(
        '/EvelProxyTool-v1.2.3-Windows-amd64.zip',
      );
      expect(manifest.fullAssets['windows-aarch64'].url).toEndWith(
        '/EvelProxyTool-v1.2.3-Windows-aarch64.zip',
      );
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test.each(['full', 'legacy'] as const)('仅有 %s 包时仍生成可用的 amd64 清单', async (kind) => {
    const root = await mkdtemp(join(tmpdir(), `easycli-manifest-${kind}-only-`));
    try {
      const filename = kind === 'full'
        ? 'EvelProxyTool-v1.2.3-Windows-amd64.zip'
        : 'EvelProxyTool-update-v1.2.3-Windows-amd64.zip';
      const payload = Buffer.from(`${kind} amd64 package`);
      await writeFile(join(root, filename), payload);
      const manifest = await generatePortableUpdateManifest({ directory: root, tag: 'v1.2.3' });

      expect(Object.keys(manifest.assets)).toEqual(['windows-amd64']);
      const asset = manifest.assets['windows-amd64'];
      expect(asset.url).toBe(`https://github.com/evel2903/EvelProxyTool/releases/download/v1.2.3/${filename}`);
      expect(asset.sha256).toBe(createHash('sha256').update(payload).digest('hex'));
      expect(asset.sizeBytes).toBe(payload.byteLength);
      if (kind === 'full') {
        expect(manifest.fullAssets).toEqual({ 'windows-amd64': asset });
      } else {
        expect(manifest.fullAssets).toBeUndefined();
      }
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test('不同架构可以分别发布旧版更新包或完整包', async () => {
    const root = await mkdtemp(join(tmpdir(), 'easycli-manifest-mixed-'));
    try {
      await writeFile(join(root, 'EvelProxyTool-update-v1.2.3-Windows-amd64.zip'), 'legacy amd64');
      await writeFile(join(root, 'EvelProxyTool-v1.2.3-Windows-aarch64.zip'), 'full aarch64');
      const manifest = await generatePortableUpdateManifest({ directory: root, tag: 'v1.2.3' });

      expect(Object.keys(manifest.assets).sort()).toEqual(['windows-aarch64', 'windows-amd64']);
      expect(Object.keys(manifest.fullAssets)).toEqual(['windows-aarch64']);
      expect(manifest.assets['windows-aarch64']).toEqual(manifest.fullAssets['windows-aarch64']);
      expect(manifest.assets['windows-amd64'].url).toBe(
        'https://github.com/evel2903/EvelProxyTool/releases/download/v1.2.3/EvelProxyTool-update-v1.2.3-Windows-amd64.zip',
      );
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test('显式仓库覆盖默认发布地址', async () => {
    const root = await mkdtemp(join(tmpdir(), 'easycli-manifest-repository-'));
    try {
      await writeFile(join(root, 'EvelProxyTool-v1.2.3-Windows-amd64.zip'), 'full amd64');
      const manifest = await generatePortableUpdateManifest({
        directory: root,
        tag: 'v1.2.3',
        repository: 'test-owner/custom-fork',
      });
      expect(manifest.releaseUrl).toBe('https://github.com/test-owner/custom-fork/releases/tag/v1.2.3');
      expect(manifest.assets['windows-amd64'].url).toBe(
        'https://github.com/test-owner/custom-fork/releases/download/v1.2.3/EvelProxyTool-v1.2.3-Windows-amd64.zip',
      );
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});

describe('跨平台便携更新清单', () => {
  test.each(['windows', 'linux', 'darwin'])('%s 没有受支持的发布资产时拒绝生成清单', async (platform) => {
    const root = await mkdtemp(join(tmpdir(), `easycli-${platform}-manifest-empty-`));
    try {
      // An unrelated release/architecture must not make an empty catalog valid.
      await writeFile(join(root, 'EvelProxyTool-v1.2.3-Windows-unknown.zip'), 'unsupported');
      const output = join(root, `portable-update-${platform}.json`);
      await expect(generatePortableUpdateManifest({
        directory: root,
        output,
        platform,
        tag: 'v1.2.3',
      })).rejects.toThrow(`No supported portable release assets found for ${platform}`);
      await expect(readFile(output)).rejects.toMatchObject({ code: 'ENOENT' });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test('空发布包不能生成可用更新清单', async () => {
    const root = await mkdtemp(join(tmpdir(), 'easycli-manifest-empty-asset-'));
    try {
      await writeFile(join(root, 'EvelProxyTool-v1.2.3-Windows-amd64.zip'), '');
      await expect(generatePortableUpdateManifest({ directory: root, tag: 'v1.2.3' }))
        .rejects.toThrow('Portable release asset is empty or not a file');
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test.each([
    ['linux', 'Linux', 'tar.gz'],
    ['darwin', 'Darwin', 'dmg'],
  ] as const)('%s 清单直接引用完整发布包', async (platform, display, suffix) => {
    const root = await mkdtemp(join(tmpdir(), `easycli-${platform}-manifest-test-`));
    try {
      for (const arch of ['amd64', 'aarch64']) {
        await writeFile(
          join(root, `EvelProxyTool-v1.2.3-${display}-${arch}.${suffix}`),
          `${platform} ${arch} full package`,
        );
      }
      const output = join(root, `portable-update-${platform}.json`);
      const manifest = await generatePortableUpdateManifest({
        directory: root,
        output,
        platform,
        tag: 'v1.2.3',
        publishedAt: '2026-08-10T00:00:00.000Z',
      });

      expect(manifest.fullAssets).toBeUndefined();
      for (const arch of ['amd64', 'aarch64']) {
        expect(manifest.assets[`${platform}-${arch}`].url).toBe(
          `https://github.com/evel2903/EvelProxyTool/releases/download/v1.2.3/EvelProxyTool-v1.2.3-${display}-${arch}.${suffix}`,
        );
      }
      expect(JSON.parse(await readFile(output, 'utf8'))).toEqual(manifest);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
