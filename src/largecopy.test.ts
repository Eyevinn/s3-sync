import { S3Client } from '@aws-sdk/client-s3';
import { copyLargeFileChunked } from './index';

describe('copyLargeFileChunked key handling', () => {
  afterEach(() => jest.restoreAllMocks());

  function run(keyed: boolean, srcKey: string, dstKey: string) {
    const seen: { cmd: string; key?: string; bucket?: string }[] = [];
    jest.spyOn(console, 'log').mockImplementation(() => undefined);
    jest.spyOn(S3Client.prototype, 'send').mockImplementation((async (
      command: any
    ) => {
      const name = command.constructor.name;
      seen.push({
        cmd: name,
        key: command.input.Key,
        bucket: command.input.Bucket
      });
      if (name === 'HeadObjectCommand')
        return { ContentLength: 600 * 1024 * 1024 };
      if (name === 'CreateMultipartUploadCommand') return { UploadId: 'u1' };
      if (name === 'GetObjectCommand')
        return { Body: [Buffer.from('x')] as any };
      if (name === 'UploadPartCommand') return { ETag: 'e' };
      return {};
    }) as any);
    const mk = (bucket: string, k: string) => ({
      s3url: keyed
        ? new URL(`s3://${bucket}/`)
        : new URL(`s3://${bucket}/${encodeURI(k)}`),
      ...(keyed ? { key: k } : {}),
      s3region: 'us-east-1',
      s3accessKey: 'a',
      s3secretKey: 'b'
    });
    return {
      seen,
      go: () => copyLargeFileChunked(mk('src', srcKey), mk('dst', dstKey))
    };
  }

  it('uses the exact key for keys with space, # and ?', async () => {
    const srcKey = 'a b/c#d?e%20f.bin';
    const dstKey = 'instance/a b/c#d?e%20f.bin';
    const { seen, go } = run(true, srcKey, dstKey);
    await go();
    const byCmd = (c: string) => seen.filter((x) => x.cmd === c);
    expect(byCmd('HeadObjectCommand')[0].key).toBe(srcKey);
    expect(byCmd('GetObjectCommand').every((x) => x.key === srcKey)).toBe(true);
    expect(byCmd('CreateMultipartUploadCommand')[0].key).toBe(dstKey);
    expect(byCmd('UploadPartCommand').every((x) => x.key === dstKey)).toBe(
      true
    );
    expect(byCmd('CompleteMultipartUploadCommand')[0].key).toBe(dstKey);
  });

  it('keeps deriving the key from the URL pathname when no key is given', async () => {
    const { seen, go } = run(false, 'dir/file.bin', 'out/file.bin');
    await go();
    expect(seen.find((x) => x.cmd === 'HeadObjectCommand')?.key).toBe(
      'dir/file.bin'
    );
    expect(
      seen.find((x) => x.cmd === 'CreateMultipartUploadCommand')?.key
    ).toBe('out/file.bin');
  });
});
