import { buildCli } from './program';

const ENV_KEYS = [
  'ALL_BUCKETS',
  'INCLUDE_BUCKETS',
  'EXCLUDE_BUCKETS',
  'DELETE_ON_DEST',
  'SOURCE_ACCESS_KEY',
  'SOURCE_SECRET_KEY',
  'SOURCE_ENDPOINT',
  'DEST_ENDPOINT',
  'STAGING_DIR'
];

async function run(args: string[], deps: any) {
  await buildCli(deps).parseAsync(['node', 's3-sync', ...args]);
}

describe('cli', () => {
  const saved: Record<string, string | undefined> = {};
  beforeEach(() => {
    ENV_KEYS.forEach((k) => {
      saved[k] = process.env[k];
      delete process.env[k];
    });
    process.exitCode = undefined;
    jest.spyOn(console, 'log').mockImplementation(() => undefined);
  });
  afterEach(() => {
    ENV_KEYS.forEach((k) => {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    });
    process.exitCode = undefined;
    jest.restoreAllMocks();
  });

  it('parses the cmdLineArgs string deploy-manager sends', async () => {
    process.env.SOURCE_ENDPOINT = 'https://src.example';
    process.env.SOURCE_ACCESS_KEY = 'ak';
    const syncAllBuckets = jest
      .fn()
      .mockResolvedValue({ mode: 'all-buckets', buckets: [], failed: 0 });
    const doSync = jest.fn();
    const cmdLineArgs =
      '--all-buckets --include=a,b --exclude=c --delete s3://dest-bucket/instance/';
    await run(cmdLineArgs.split(/\s+/), { doSync, syncAllBuckets });
    expect(doSync).not.toHaveBeenCalled();
    expect(syncAllBuckets).toHaveBeenCalledTimes(1);
    const opts = syncAllBuckets.mock.calls[0][0];
    expect(opts.include).toEqual(['a', 'b']);
    expect(opts.exclude).toEqual(['c']);
    expect(opts.deleteOnDest).toBe(true);
    expect(opts.dest.s3url.hostname).toBe('dest-bucket');
    expect(opts.dest.s3url.pathname).toBe('/instance/');
    expect(opts.source.s3endpoint).toBe('https://src.example');
    expect(opts.source.s3accessKey).toBe('ak');
  });

  it('reads the all-buckets options from env vars', async () => {
    process.env.ALL_BUCKETS = 'true';
    process.env.INCLUDE_BUCKETS = 'a';
    process.env.EXCLUDE_BUCKETS = 'b';
    process.env.DELETE_ON_DEST = 'true';
    const syncAllBuckets = jest
      .fn()
      .mockResolvedValue({ mode: 'all-buckets', buckets: [], failed: 0 });
    await run(['s3://d/p/'], { doSync: jest.fn(), syncAllBuckets });
    const opts = syncAllBuckets.mock.calls[0][0];
    expect(opts).toMatchObject({
      include: ['a'],
      exclude: ['b'],
      deleteOnDest: true
    });
  });

  it('exits 1 when any bucket failed and prints the summary line', async () => {
    const summary = {
      mode: 'all-buckets',
      buckets: [
        { name: 'a', status: 'ok', objects: 1, bytes: 2, error: '' },
        { name: 'b', status: 'failed', objects: 0, bytes: 0, error: 'x' }
      ],
      failed: 1
    };
    const syncAllBuckets = jest.fn().mockResolvedValue(summary);
    await run(['--all-buckets', 's3://d/p/'], {
      doSync: jest.fn(),
      syncAllBuckets
    });
    expect(process.exitCode).toBe(1);
    expect(console.log).toHaveBeenCalledWith(
      `S3SYNC_SUMMARY ${JSON.stringify(summary)}`
    );
  });

  it('exits 0 when every bucket succeeded', async () => {
    const syncAllBuckets = jest.fn().mockResolvedValue({
      mode: 'all-buckets',
      buckets: [{ name: 'a', status: 'ok', objects: 0, bytes: 0, error: '' }],
      failed: 0
    });
    await run(['--all-buckets', 's3://d/p/'], {
      doSync: jest.fn(),
      syncAllBuckets
    });
    expect(process.exitCode).toBeUndefined();
  });

  it('exits 1 and redacts credentials when listing buckets throws', async () => {
    process.env.SOURCE_SECRET_KEY = 'TOPSECRET';
    const syncAllBuckets = jest
      .fn()
      .mockRejectedValue(new Error('denied for TOPSECRET'));
    await run(['--all-buckets', 's3://d/p/'], {
      doSync: jest.fn(),
      syncAllBuckets
    });
    expect(process.exitCode).toBe(1);
    const printed = (console.log as jest.Mock).mock.calls
      .map((c) => c.join(' '))
      .join('\n');
    expect(printed).not.toContain('TOPSECRET');
    expect(printed).toContain('S3SYNC_SUMMARY');
  });

  describe('without --all-buckets (unchanged behaviour)', () => {
    it('passes source and dest to doSync', async () => {
      const doSync = jest.fn().mockResolvedValue(undefined);
      const syncAllBuckets = jest.fn();
      await run(['s3://src/a/', 's3://dst/b/', '--single-file'], {
        doSync,
        syncAllBuckets
      });
      expect(syncAllBuckets).not.toHaveBeenCalled();
      expect(doSync).toHaveBeenCalledTimes(1);
      const opts = doSync.mock.calls[0][0];
      expect(opts.source.s3url.toString()).toBe('s3://src/a/');
      expect(opts.dest.s3url.toString()).toBe('s3://dst/b/');
      expect(opts.singleFile).toBe(true);
      expect(opts.stagingDir).toBe('/tmp/data');
      expect(opts.awsCliPath).toBe('aws');
    });

    it('still exits 0 when doSync throws', async () => {
      const doSync = jest.fn().mockRejectedValue(new Error('sync failed'));
      await run(['s3://src/a/', 's3://dst/b/'], {
        doSync,
        syncAllBuckets: jest.fn()
      });
      expect(process.exitCode).toBeUndefined();
      expect(console.log).toHaveBeenCalledWith('sync failed');
    });
  });
});
