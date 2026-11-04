import { createReadStream, createWriteStream, mkdirSync, rmSync } from 'fs';
import { join } from 'path';
import { pipeline } from 'stream/promises';
import { Readable } from 'stream';
import {
  S3Client,
  ListBucketsCommand,
  ListObjectsV2Command,
  GetObjectCommand,
  PutObjectCommand,
  DeleteObjectCommand
} from '@aws-sdk/client-s3';
import {
  BucketConfig,
  LARGE_FILE_THRESHOLD,
  copyLargeFileChunked,
  createS3Client
} from './index';

export interface AllBucketsOptions {
  source: Omit<BucketConfig, 's3url'>;
  dest: BucketConfig;
  include?: string[];
  exclude?: string[];
  deleteOnDest?: boolean;
  stagingDir?: string;
}

export interface BucketResult {
  name: string;
  status: 'ok' | 'failed';
  objects: number;
  bytes: number;
  error: string;
}

export interface AllBucketsSummary {
  mode: 'all-buckets';
  buckets: BucketResult[];
  failed: number;
}

export interface AllBucketsDeps {
  sourceClient?: S3Client;
  destClient?: S3Client;
  largeCopy?: (
    source: BucketConfig,
    dest: BucketConfig,
    size: number
  ) => Promise<void>;
}

const MAX_ERROR_LENGTH = 300;

export function parseList(value?: string): string[] {
  if (!value) return [];
  return value
    .split(',')
    .map((v) => v.trim())
    .filter((v) => v.length > 0);
}

/**
 * Make an error message safe for the summary line: one line, no credential
 * values, at most 300 characters.
 */
export function sanitizeError(
  message: string,
  secrets: (string | undefined)[]
): string {
  let out = message;
  for (const secret of secrets) {
    if (secret) out = out.split(secret).join('[redacted]');
  }
  out = out.replace(/\s+/g, ' ').trim();
  return out.length > MAX_ERROR_LENGTH
    ? out.substring(0, MAX_ERROR_LENGTH)
    : out;
}

export function normalizePrefix(prefix: string): string {
  const stripped = prefix.replace(/^\/+/, '');
  if (stripped === '') return '';
  return stripped.endsWith('/') ? stripped : stripped + '/';
}

interface ObjectInfo {
  size: number;
  lastModified?: Date;
}

async function* listObjects(
  client: S3Client,
  bucket: string,
  prefix?: string
): AsyncGenerator<{ key: string } & ObjectInfo> {
  let token: string | undefined;
  do {
    const res = await client.send(
      new ListObjectsV2Command({
        Bucket: bucket,
        Prefix: prefix,
        ContinuationToken: token
      })
    );
    for (const obj of res.Contents || []) {
      if (obj.Key === undefined) continue;
      yield {
        key: obj.Key,
        size: obj.Size || 0,
        lastModified: obj.LastModified
      };
    }
    token = res.IsTruncated ? res.NextContinuationToken : undefined;
  } while (token);
}

export function needsCopy(src: ObjectInfo, dst?: ObjectInfo): boolean {
  if (!dst) return true;
  if (src.size !== dst.size) return true;
  if (
    src.lastModified &&
    dst.lastModified &&
    src.lastModified.getTime() > dst.lastModified.getTime()
  ) {
    return true;
  }
  return false;
}

async function copyObject(
  opts: AllBucketsOptions,
  sourceClient: S3Client,
  destClient: S3Client,
  deps: AllBucketsDeps,
  bucket: string,
  key: string,
  size: number,
  destKey: string
): Promise<void> {
  if (size > LARGE_FILE_THRESHOLD) {
    const largeCopy = deps.largeCopy || copyLargeFileChunked;
    await largeCopy(
      {
        ...opts.source,
        s3url: new URL(`s3://${bucket}/${encodeURI(key)}`)
      },
      {
        ...opts.dest,
        s3url: new URL(`s3://${opts.dest.s3url.hostname}/${encodeURI(destKey)}`)
      },
      size
    );
    return;
  }
  const stagingDir = opts.stagingDir || '/tmp/data';
  mkdirSync(stagingDir, { recursive: true });
  const stagedFile = join(
    stagingDir,
    `obj-${Math.random().toString(36).substring(2)}`
  );
  let upload: ReturnType<typeof createReadStream> | undefined;
  try {
    const got = await sourceClient.send(
      new GetObjectCommand({ Bucket: bucket, Key: key })
    );
    if (!got.Body) {
      throw new Error(`Empty body for object ${key}`);
    }
    await pipeline(got.Body as Readable, createWriteStream(stagedFile));
    upload = createReadStream(stagedFile);
    // errors surface through the SDK request; avoid an unhandled event if the
    // stream is abandoned after a failed upload
    upload.on('error', () => undefined);
    await destClient.send(
      new PutObjectCommand({
        Bucket: opts.dest.s3url.hostname,
        Key: destKey,
        Body: upload,
        ContentLength: size
      })
    );
  } finally {
    upload?.destroy();
    rmSync(stagedFile, { force: true });
  }
}

async function syncBucket(
  opts: AllBucketsOptions,
  sourceClient: S3Client,
  destClient: S3Client,
  deps: AllBucketsDeps,
  bucket: string,
  basePrefix: string
): Promise<{ objects: number; bytes: number }> {
  const destBucket = opts.dest.s3url.hostname;
  const bucketPrefix = `${basePrefix}${bucket}/`;

  const destObjects = new Map<string, ObjectInfo>();
  for await (const o of listObjects(destClient, destBucket, bucketPrefix)) {
    destObjects.set(o.key, o);
  }

  const sourceKeys = new Set<string>();
  let objects = 0;
  let bytes = 0;
  for await (const obj of listObjects(sourceClient, bucket)) {
    sourceKeys.add(obj.key);
    const destKey = bucketPrefix + obj.key;
    if (!needsCopy(obj, destObjects.get(destKey))) continue;
    await copyObject(
      opts,
      sourceClient,
      destClient,
      deps,
      bucket,
      obj.key,
      obj.size,
      destKey
    );
    objects++;
    bytes += obj.size;
  }

  if (opts.deleteOnDest) {
    for (const destKey of destObjects.keys()) {
      // Only ever touch keys under this bucket's own prefix
      if (!destKey.startsWith(bucketPrefix)) continue;
      if (sourceKeys.has(destKey.substring(bucketPrefix.length))) continue;
      await destClient.send(
        new DeleteObjectCommand({ Bucket: destBucket, Key: destKey })
      );
    }
  }
  return { objects, bytes };
}

export async function syncAllBuckets(
  opts: AllBucketsOptions,
  deps: AllBucketsDeps = {}
): Promise<AllBucketsSummary> {
  const sourceClient =
    deps.sourceClient ||
    createS3Client({ ...opts.source, s3url: new URL('s3://unused/') });
  const destClient = deps.destClient || createS3Client(opts.dest);
  const secrets = [
    opts.source.s3accessKey,
    opts.source.s3secretKey,
    opts.source.s3sessionToken,
    opts.dest.s3accessKey,
    opts.dest.s3secretKey,
    opts.dest.s3sessionToken
  ];
  const basePrefix = normalizePrefix(opts.dest.s3url.pathname);
  const include = opts.include || [];
  const exclude = opts.exclude || [];

  const listed = await sourceClient.send(new ListBucketsCommand({}));
  const sourceNames = (listed.Buckets || [])
    .map((b) => b.Name)
    .filter((n): n is string => !!n);

  const selected = sourceNames.filter(
    (n) => (include.length === 0 || include.includes(n)) && !exclude.includes(n)
  );
  const missing = include.filter(
    (n) => !sourceNames.includes(n) && !exclude.includes(n)
  );

  const buckets: BucketResult[] = [];
  for (const name of selected) {
    try {
      console.log(`Syncing bucket ${name}`);
      const { objects, bytes } = await syncBucket(
        opts,
        sourceClient,
        destClient,
        deps,
        name,
        basePrefix
      );
      buckets.push({ name, status: 'ok', objects, bytes, error: '' });
    } catch (err) {
      buckets.push({
        name,
        status: 'failed',
        objects: 0,
        bytes: 0,
        error: sanitizeError((err as Error).message || String(err), secrets)
      });
    }
  }
  for (const name of missing) {
    buckets.push({
      name,
      status: 'failed',
      objects: 0,
      bytes: 0,
      error: 'bucket not found'
    });
  }
  return {
    mode: 'all-buckets',
    buckets,
    failed: buckets.filter((b) => b.status === 'failed').length
  };
}

export function formatSummary(summary: AllBucketsSummary): string {
  return `S3SYNC_SUMMARY ${JSON.stringify(summary)}`;
}
