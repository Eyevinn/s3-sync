import { existsSync, mkdtempSync, readdirSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { Readable } from 'stream';
import {
  formatSummary,
  normalizePrefix,
  needsCopy,
  sanitizeError,
  syncAllBuckets
} from './allbuckets';

type Obj = { Key: string; Size: number; LastModified: Date };
const OLD = new Date('2026-01-01T00:00:00Z');
const NEW = new Date('2026-02-01T00:00:00Z');

const SECRETS = {
  s3accessKey: 'SRCACCESSKEY',
  s3secretKey: 'SRCSECRETKEY',
  s3sessionToken: 'SRCTOKEN'
};
const DEST_SECRETS = {
  s3accessKey: 'DSTACCESSKEY',
  s3secretKey: 'DSTSECRETKEY',
  s3sessionToken: 'DSTTOKEN'
};

function listResult(objs: Obj[]) {
  return { Contents: objs, IsTruncated: false };
}

function makeClients(
  sourceBuckets: Record<string, Obj[]>,
  destObjects: Record<string, Obj[]> = {},
  opts: { failGetFor?: string; stagingDir?: string } = {}
) {
  const calls: { cmd: string; input: any }[] = [];
  const stagingSnapshots: string[][] = [];
  const sourceClient: any = {
    send: jest.fn(async (command: any) => {
      const cmd = command.constructor.name;
      calls.push({ cmd: 'src:' + cmd, input: command.input });
      if (cmd === 'ListBucketsCommand') {
        return {
          Buckets: Object.keys(sourceBuckets).map((Name) => ({ Name }))
        };
      }
      if (cmd === 'ListObjectsV2Command') {
        return listResult(sourceBuckets[command.input.Bucket]);
      }
      if (cmd === 'GetObjectCommand') {
        if (command.input.Bucket === opts.failGetFor) {
          throw new Error(
            `boom using ${SECRETS.s3secretKey} and ${DEST_SECRETS.s3accessKey}\nsecond line`
          );
        }
        return { Body: Readable.from([Buffer.from('data')]) };
      }
      throw new Error('unexpected ' + cmd);
    })
  };
  const destClient: any = {
    send: jest.fn(async (command: any) => {
      const cmd = command.constructor.name;
      calls.push({ cmd: 'dst:' + cmd, input: command.input });
      if (cmd === 'ListObjectsV2Command') {
        const prefix: string = command.input.Prefix;
        return listResult(
          Object.values(destObjects)
            .flat()
            .filter((o) => o.Key.startsWith(prefix))
        );
      }
      if (cmd === 'PutObjectCommand') {
        // drain the body like the real client does
        for await (const chunk of command.input.Body as Readable) {
          void chunk;
        }
        if (opts.stagingDir) {
          stagingSnapshots.push(readdirSync(opts.stagingDir));
        }
        return {};
      }
      if (cmd === 'DeleteObjectCommand') return {};
      throw new Error('unexpected ' + cmd);
    })
  };
  return { sourceClient, destClient, calls, stagingSnapshots };
}

function baseOpts(destUrl = 's3://dest-bucket/instance/', stagingDir?: string) {
  return {
    source: { ...SECRETS },
    dest: { ...DEST_SECRETS, s3url: new URL(destUrl) },
    stagingDir
  };
}

describe('syncAllBuckets', () => {
  let stagingDir: string;
  beforeEach(() => {
    stagingDir = mkdtempSync(join(tmpdir(), 's3sync-test-'));
    jest.spyOn(console, 'log').mockImplementation(() => undefined);
  });
  afterEach(() => {
    rmSync(stagingDir, { recursive: true, force: true });
    jest.restoreAllMocks();
  });

  const buckets = () => ({
    a: [{ Key: 'x.txt', Size: 4, LastModified: OLD }],
    b: [{ Key: 'y.txt', Size: 4, LastModified: OLD }],
    c: [{ Key: 'z.txt', Size: 4, LastModified: OLD }]
  });

  it('enumerates with include, exclude and a missing include', async () => {
    const { sourceClient, destClient } = makeClients(buckets());
    const summary = await syncAllBuckets(
      {
        ...baseOpts(undefined, stagingDir),
        include: ['a', 'b', 'nope'],
        exclude: ['b']
      },
      { sourceClient, destClient }
    );
    expect(summary.buckets.map((b) => b.name)).toEqual(['a', 'nope']);
    expect(summary.buckets[0].status).toBe('ok');
    expect(summary.buckets[1]).toEqual({
      name: 'nope',
      status: 'failed',
      objects: 0,
      bytes: 0,
      error: 'bucket not found'
    });
    expect(summary.failed).toBe(1);
  });

  it('includes every bucket when no include list is given', async () => {
    const { sourceClient, destClient } = makeClients(buckets());
    const summary = await syncAllBuckets(baseOpts(undefined, stagingDir), {
      sourceClient,
      destClient
    });
    expect(summary.buckets.map((b) => b.name)).toEqual(['a', 'b', 'c']);
    expect(summary.failed).toBe(0);
  });

  it.each([
    ['s3://dest-bucket/instance/', 'instance/a/x.txt'],
    ['s3://dest-bucket/instance', 'instance/a/x.txt'],
    ['s3://dest-bucket/', 'a/x.txt']
  ])('maps prefix for %s', async (url, expectedKey) => {
    const { sourceClient, destClient, calls } = makeClients({
      a: buckets().a
    });
    await syncAllBuckets(baseOpts(url, stagingDir), {
      sourceClient,
      destClient
    });
    const put = calls.find((c) => c.cmd === 'dst:PutObjectCommand');
    expect(put?.input.Bucket).toBe('dest-bucket');
    expect(put?.input.Key).toBe(expectedKey);
  });

  it('skips objects with equal size and time, copies when either differs', async () => {
    const src = {
      a: [
        { Key: 'same', Size: 4, LastModified: OLD },
        { Key: 'size', Size: 4, LastModified: OLD },
        { Key: 'newer', Size: 4, LastModified: NEW },
        { Key: 'missing', Size: 4, LastModified: OLD }
      ]
    };
    const dst = {
      a: [
        { Key: 'instance/a/same', Size: 4, LastModified: OLD },
        { Key: 'instance/a/size', Size: 9, LastModified: OLD },
        { Key: 'instance/a/newer', Size: 4, LastModified: OLD }
      ]
    };
    const { sourceClient, destClient, calls } = makeClients(src, dst);
    const summary = await syncAllBuckets(baseOpts(undefined, stagingDir), {
      sourceClient,
      destClient
    });
    const keys = calls
      .filter((c) => c.cmd === 'dst:PutObjectCommand')
      .map((c) => c.input.Key);
    expect(keys).toEqual([
      'instance/a/size',
      'instance/a/newer',
      'instance/a/missing'
    ]);
    expect(summary.buckets[0]).toMatchObject({ objects: 3, bytes: 12 });
  });

  it('removes the staged file after each object (peak staging is one object)', async () => {
    const src = {
      a: [
        { Key: '1', Size: 4, LastModified: OLD },
        { Key: '2', Size: 4, LastModified: OLD },
        { Key: '3', Size: 4, LastModified: OLD }
      ]
    };
    const { sourceClient, destClient, stagingSnapshots } = makeClients(
      src,
      {},
      { stagingDir }
    );
    await syncAllBuckets(baseOpts(undefined, stagingDir), {
      sourceClient,
      destClient
    });
    expect(stagingSnapshots).toHaveLength(3);
    stagingSnapshots.forEach((s) => expect(s).toHaveLength(1));
    expect(readdirSync(stagingDir)).toEqual([]);
  });

  it('removes the staged file when the copy fails', async () => {
    const { sourceClient, destClient } = makeClients(
      buckets(),
      {},
      {
        failGetFor: 'a'
      }
    );
    await syncAllBuckets(baseOpts(undefined, stagingDir), {
      sourceClient,
      destClient
    });
    expect(readdirSync(stagingDir)).toEqual([]);
  });

  it('--delete removes only objects under the bucket own prefix', async () => {
    const dst = {
      a: [
        { Key: 'instance/a/x.txt', Size: 4, LastModified: OLD },
        { Key: 'instance/a/stale.txt', Size: 4, LastModified: OLD }
      ],
      ab: [{ Key: 'instance/ab/other.txt', Size: 4, LastModified: OLD }],
      outside: [{ Key: 'unrelated/file', Size: 4, LastModified: OLD }]
    };
    const { sourceClient, destClient, calls } = makeClients(
      { a: buckets().a },
      dst
    );
    await syncAllBuckets(
      { ...baseOpts(undefined, stagingDir), deleteOnDest: true },
      { sourceClient, destClient }
    );
    const deleted = calls
      .filter((c) => c.cmd === 'dst:DeleteObjectCommand')
      .map((c) => c.input.Key);
    expect(deleted).toEqual(['instance/a/stale.txt']);
  });

  it('does not delete without the flag', async () => {
    const dst = {
      a: [{ Key: 'instance/a/stale.txt', Size: 4, LastModified: OLD }]
    };
    const { sourceClient, destClient, calls } = makeClients(
      { a: buckets().a },
      dst
    );
    await syncAllBuckets(baseOpts(undefined, stagingDir), {
      sourceClient,
      destClient
    });
    expect(calls.some((c) => c.cmd === 'dst:DeleteObjectCommand')).toBe(false);
  });

  it('keeps going after a failed bucket and never leaks credentials', async () => {
    const { sourceClient, destClient } = makeClients(
      { a: buckets().a, b: buckets().b },
      {},
      { failGetFor: 'a' }
    );
    const summary = await syncAllBuckets(baseOpts(undefined, stagingDir), {
      sourceClient,
      destClient
    });
    expect(summary.buckets[0].status).toBe('failed');
    expect(summary.buckets[1].status).toBe('ok');
    expect(summary.failed).toBe(1);
    const line = formatSummary(summary);
    for (const secret of [
      ...Object.values(SECRETS),
      ...Object.values(DEST_SECRETS)
    ]) {
      expect(line).not.toContain(secret);
    }
    expect(summary.buckets[0].error).not.toContain('\n');
    expect(summary.buckets[0].error).toContain('[redacted]');
  });

  it('uses the multipart path for objects above 500 MB', async () => {
    const big = {
      a: [{ Key: 'big.bin', Size: 600 * 1024 * 1024, LastModified: OLD }]
    };
    const { sourceClient, destClient, calls } = makeClients(big);
    const largeCopy = jest.fn().mockResolvedValue(undefined);
    await syncAllBuckets(baseOpts(undefined, stagingDir), {
      sourceClient,
      destClient,
      largeCopy
    });
    expect(largeCopy).toHaveBeenCalledTimes(1);
    expect(largeCopy.mock.calls[0][0].s3url.hostname).toBe('a');
    expect(largeCopy.mock.calls[0][1].s3url.pathname).toBe(
      '/instance/a/big.bin'
    );
    expect(calls.some((c) => c.cmd === 'dst:PutObjectCommand')).toBe(false);
  });

  it('pages through ListObjectsV2', async () => {
    const { sourceClient, destClient } = makeClients({ a: [] });
    const original = sourceClient.send.getMockImplementation();
    let page = 0;
    sourceClient.send.mockImplementation(async (command: any) => {
      if (
        command.constructor.name === 'ListObjectsV2Command' &&
        command.input.Bucket === 'a'
      ) {
        page++;
        return page === 1
          ? {
              Contents: [{ Key: '1', Size: 4, LastModified: OLD }],
              IsTruncated: true,
              NextContinuationToken: 't'
            }
          : {
              Contents: [{ Key: '2', Size: 4, LastModified: OLD }],
              IsTruncated: false
            };
      }
      return original(command);
    });
    const summary = await syncAllBuckets(baseOpts(undefined, stagingDir), {
      sourceClient,
      destClient
    });
    expect(summary.buckets[0].objects).toBe(2);
  });

  it('summary JSON has the contracted shape', async () => {
    const { sourceClient, destClient } = makeClients({ a: buckets().a });
    const summary = await syncAllBuckets(baseOpts(undefined, stagingDir), {
      sourceClient,
      destClient
    });
    const line = formatSummary(summary);
    expect(line.startsWith('S3SYNC_SUMMARY ')).toBe(true);
    expect(JSON.parse(line.substring('S3SYNC_SUMMARY '.length))).toEqual({
      mode: 'all-buckets',
      buckets: [{ name: 'a', status: 'ok', objects: 1, bytes: 4, error: '' }],
      failed: 0
    });
    expect(existsSync(stagingDir)).toBe(true);
  });
});

describe('helpers', () => {
  it('sanitizeError truncates to 300 chars on one line', () => {
    const out = sanitizeError('x\n'.repeat(500), []);
    expect(out.length).toBeLessThanOrEqual(300);
    expect(out).not.toContain('\n');
  });
  it('normalizePrefix', () => {
    expect(normalizePrefix('/')).toBe('');
    expect(normalizePrefix('/a')).toBe('a/');
    expect(normalizePrefix('/a/b/')).toBe('a/b/');
  });
  it('needsCopy', () => {
    expect(needsCopy({ size: 1 })).toBe(true);
    expect(
      needsCopy({ size: 1, lastModified: OLD }, { size: 1, lastModified: NEW })
    ).toBe(false);
  });
});
