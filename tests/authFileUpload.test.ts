import { describe, expect, it } from 'bun:test';
import { uploadAuthFiles } from '../src/services/authFileUpload';

describe('auth file batch upload', () => {
  it('continues after a failure and retries only failed credentials', async () => {
    const files = ['one', 'two', 'three'].map((name) => new File(['{}'], `${name}.json`));
    const calls: string[] = [];
    const first = await uploadAuthFiles(files, async (file) => {
      calls.push(file.name);
      if (file.name === 'two.json') throw new Error('HTTP 503');
    });
    expect(calls).toEqual(files.map((file) => file.name));
    expect(first.uploaded).toEqual(['one.json', 'three.json']);
    expect(first.failed).toEqual([{ file: files[1], error: 'HTTP 503' }]);
    const retry = await uploadAuthFiles(first.failed.map(({ file }) => file), async (file) => { calls.push(file.name); });
    expect(retry).toEqual({ uploaded: ['two.json'], failed: [] });
    expect(calls).toEqual(['one.json', 'two.json', 'three.json', 'two.json']);
  });
});
