import { existsSync, mkdirSync, rmSync } from 'fs';
import { join } from 'path';
import { createS3cmdArgs } from './util';
import { spawnSync } from 'child_process';

const DEFAULT_STAGING_DIR = '/tmp/data';

export interface BucketConfig {
  s3url: URL;
  s3region?: string;
  s3endpoint?: string;
  s3accessKey?: string;
  s3secretKey?: string;
}

export interface SyncOptions {
  source: BucketConfig;
  dest: BucketConfig;
  stagingDir?: string;
}

async function prepare(stagingDir = DEFAULT_STAGING_DIR) {
  const jobId = Math.random().toString(36).substring(7);
  const jobDir = join(stagingDir, jobId);
  if (!existsSync(jobDir)) {
    mkdirSync(jobDir, { recursive: true });
  }
  return jobDir;
}

async function cleanup(stagingDir: string) {
  console.log(`Cleaning up ${stagingDir}`);
  rmSync(stagingDir, { recursive: true, force: true });
}

async function syncToLocal(source: BucketConfig, stagingDir: string) {
  console.log(`Syncing from ${source.s3url} to ${stagingDir}`);
  const args = createS3cmdArgs(
    ['sync', source.s3url.toString(), stagingDir],
    source.s3endpoint
  );
  const { status, stderr } = spawnSync('aws', args, {
    env: {
      AWS_ACCESS_KEY_ID: source.s3accessKey,
      AWS_SECRET_ACCESS_KEY: source.s3secretKey,
      AWS_REGION: source.s3region
    },
    shell: true
  });
  if (status !== 0) {
    if (stderr) {
      console.log(stderr.toString());
    }
    throw new Error('Sync to staging dir failed');
  }
  console.log(`Synced ${source.s3url.toString()} to ${stagingDir}`);
}

async function syncLocalToRemote(dest: BucketConfig, stagingDir: string) {
  console.log(`Syncing from ${stagingDir} to ${dest.s3url}`);
  const args = createS3cmdArgs(
    ['sync', stagingDir, dest.s3url.toString()],
    dest.s3endpoint
  );
  const { status, stderr } = spawnSync('aws', args, {
    env: {
      AWS_ACCESS_KEY_ID: dest.s3accessKey,
      AWS_SECRET_ACCESS_KEY: dest.s3secretKey,
      AWS_REGION: dest.s3region
    },
    shell: true
  });
  if (status !== 0) {
    if (stderr) {
      console.log(stderr.toString());
    }
    throw new Error('Sync to remote bucket failed');
  }
  console.log(`Synced ${stagingDir} to ${dest.s3url.toString()}`);
}

export async function doSync(opts: SyncOptions) {
  const stagingDir = await prepare(opts.stagingDir);
  try {
    await syncToLocal(opts.source, stagingDir);
    await syncLocalToRemote(opts.dest, stagingDir);
    await cleanup(stagingDir);
  } catch (err) {
    await cleanup(stagingDir);
    throw err;
  }
}
