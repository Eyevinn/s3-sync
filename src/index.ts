import { existsSync, mkdirSync, rmSync } from 'fs';
import { join } from 'path';
import { createS3cmdArgs } from './util';
import { spawnSync } from 'child_process';
import {
  S3Client,
  GetObjectCommand,
  CreateMultipartUploadCommand,
  UploadPartCommand,
  CompleteMultipartUploadCommand,
  AbortMultipartUploadCommand,
  HeadObjectCommand
} from '@aws-sdk/client-s3';

const DEFAULT_STAGING_DIR = '/tmp/data';
export const LARGE_FILE_THRESHOLD = 500 * 1024 * 1024; // 500MB
const CHUNK_SIZE = 100 * 1024 * 1024; // 100MB chunks

export interface BucketConfig {
  s3url: URL;
  // Exact object key (not URL-encoded). When set it takes precedence over the
  // key derived from s3url.pathname, which is lossy for keys containing
  // characters such as '#', '?', '%' or spaces.
  key?: string;
  s3region?: string;
  s3endpoint?: string;
  s3accessKey?: string;
  s3secretKey?: string;
  s3sessionToken?: string;
}

export interface SyncOptions {
  source: BucketConfig;
  dest: BucketConfig;
  stagingDir?: string;
  singleFile?: boolean;
  awsCliPath?: string;
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

export function createS3Client(config: BucketConfig): S3Client {
  const clientConfig: any = {
    region: config.s3region || 'us-east-1',
    credentials: {
      accessKeyId: config.s3accessKey || '',
      secretAccessKey: config.s3secretKey || ''
    }
  };

  if (config.s3sessionToken) {
    clientConfig.credentials.sessionToken = config.s3sessionToken;
  }

  if (config.s3endpoint) {
    clientConfig.endpoint = config.s3endpoint;
    clientConfig.forcePathStyle = true;
  }

  return new S3Client(clientConfig);
}

function objectKey(cfg: BucketConfig): string {
  return cfg.key !== undefined ? cfg.key : cfg.s3url.pathname.substring(1);
}

async function getFileSize(
  source: BucketConfig,
  awsCliPath = 'aws'
): Promise<number> {
  const args = createS3cmdArgs(
    [
      's3api',
      'head-object',
      '--bucket',
      source.s3url.hostname,
      '--key',
      objectKey(source)
    ],
    source.s3endpoint
  );
  const { status, stdout, stderr } = spawnSync(awsCliPath, args, {
    env: {
      AWS_ACCESS_KEY_ID: source.s3accessKey,
      AWS_SECRET_ACCESS_KEY: source.s3secretKey,
      AWS_SESSION_TOKEN: source.s3sessionToken,
      AWS_REGION: source.s3region
    },
    shell: true
  });
  if (status !== 0) {
    if (stderr) {
      console.log(stderr.toString());
    }
    throw new Error('Failed to get file size');
  }
  const metadata = JSON.parse(stdout.toString());
  return parseInt(metadata.ContentLength);
}

async function getFileSizeSDK(source: BucketConfig): Promise<number> {
  const sourceClient = createS3Client(source);
  const sourceKey = objectKey(source);

  const command = new HeadObjectCommand({
    Bucket: source.s3url.hostname,
    Key: sourceKey
  });

  const response = await sourceClient.send(command);
  return response.ContentLength || 0;
}

async function copyLargeFileChunkedSDK(
  source: BucketConfig,
  dest: BucketConfig
): Promise<void> {
  console.log(
    `Starting SDK chunked copy from ${source.s3url} to ${dest.s3url}`
  );

  const fileSize = await getFileSizeSDK(source);
  console.log(
    `File size: ${fileSize} bytes (${(fileSize / 1024 / 1024).toFixed(2)} MB)`
  );

  if (fileSize <= LARGE_FILE_THRESHOLD) {
    throw new Error('File is not large enough for chunked copy');
  }

  const sourceClient = createS3Client(source);
  const destClient = createS3Client(dest);

  const sourceKey = objectKey(source);
  let destKey = objectKey(dest);

  // If destination ends with '/' or is empty, append the source filename
  if (destKey === '' || destKey.endsWith('/')) {
    const sourceFileName = objectKey(source).split('/').pop();
    if (sourceFileName) {
      destKey = destKey + sourceFileName;
    }
  }

  // Initiate multipart upload on destination
  const createCommand = new CreateMultipartUploadCommand({
    Bucket: dest.s3url.hostname,
    Key: destKey
  });

  const { UploadId } = await destClient.send(createCommand);
  if (!UploadId) {
    throw new Error('Failed to initiate multipart upload');
  }

  console.log(`Initiated multipart upload with ID: ${UploadId}`);

  try {
    const parts: { ETag: string; PartNumber: number }[] = [];
    let partNumber = 1;
    let currentByte = 0;

    while (currentByte < fileSize) {
      const endByte = Math.min(currentByte + CHUNK_SIZE - 1, fileSize - 1);
      console.log(
        `Processing part ${partNumber}: bytes ${currentByte}-${endByte}`
      );

      // Download chunk from source
      const getCommand = new GetObjectCommand({
        Bucket: source.s3url.hostname,
        Key: sourceKey,
        Range: `bytes=${currentByte}-${endByte}`
      });

      const sourceResponse = await sourceClient.send(getCommand);
      if (!sourceResponse.Body) {
        throw new Error(`Failed to download part ${partNumber} from source`);
      }

      // Convert stream to buffer
      const chunks: Uint8Array[] = [];
      for await (const chunk of sourceResponse.Body as any) {
        chunks.push(chunk);
      }
      const buffer = Buffer.concat(chunks);

      // Upload chunk to destination
      const uploadCommand = new UploadPartCommand({
        Bucket: dest.s3url.hostname,
        Key: destKey,
        PartNumber: partNumber,
        UploadId,
        Body: buffer
      });

      const uploadResponse = await destClient.send(uploadCommand);
      if (!uploadResponse.ETag) {
        throw new Error(`Failed to upload part ${partNumber} to destination`);
      }

      parts.push({
        ETag: uploadResponse.ETag,
        PartNumber: partNumber
      });

      currentByte = endByte + 1;
      partNumber++;
    }

    console.log(`Completing multipart upload with ${parts.length} parts`);

    // Complete multipart upload
    const completeCommand = new CompleteMultipartUploadCommand({
      Bucket: dest.s3url.hostname,
      Key: destKey,
      UploadId,
      MultipartUpload: {
        Parts: parts.sort((a, b) => a.PartNumber - b.PartNumber)
      }
    });

    await destClient.send(completeCommand);
    console.log(
      `Successfully copied large file from ${source.s3url} to ${dest.s3url}`
    );
  } catch (error) {
    console.log('Error during chunked copy, aborting multipart upload...');

    try {
      const abortCommand = new AbortMultipartUploadCommand({
        Bucket: dest.s3url.hostname,
        Key: destKey,
        UploadId
      });
      await destClient.send(abortCommand);
    } catch (abortError) {
      console.log('Warning: Failed to abort multipart upload:', abortError);
    }

    throw error;
  }
}

export async function copyLargeFileChunked(
  source: BucketConfig,
  dest: BucketConfig
): Promise<void> {
  // Use SDK-based implementation for better credential handling
  return copyLargeFileChunkedSDK(source, dest);
}

async function syncToLocal(
  source: BucketConfig,
  stagingDir: string,
  awsCliPath = 'aws'
) {
  console.log(`Syncing from ${source.s3url} to ${stagingDir}`);
  const args = createS3cmdArgs(
    ['sync', source.s3url.toString(), stagingDir],
    source.s3endpoint
  );
  const { status, stderr } = spawnSync(awsCliPath, args, {
    env: {
      AWS_ACCESS_KEY_ID: source.s3accessKey,
      AWS_SECRET_ACCESS_KEY: source.s3secretKey,
      AWS_SESSION_TOKEN: source.s3sessionToken,
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

async function copyToLocal(
  source: BucketConfig,
  stagingDir: string,
  awsCliPath = 'aws'
) {
  console.log(`Copying from ${source.s3url} to ${stagingDir}`);
  const args = createS3cmdArgs(
    ['cp', source.s3url.toString(), stagingDir],
    source.s3endpoint
  );
  const { status, stderr } = spawnSync(awsCliPath, args, {
    env: {
      AWS_ACCESS_KEY_ID: source.s3accessKey,
      AWS_SECRET_ACCESS_KEY: source.s3secretKey,
      AWS_SESSION_TOKEN: source.s3sessionToken,
      AWS_REGION: source.s3region
    },
    shell: true
  });
  if (status !== 0) {
    if (stderr) {
      console.log(stderr.toString());
    }
    throw new Error('Copy to staging dir failed');
  }
  console.log(`Copied ${source.s3url.toString()} to ${stagingDir}`);
}

async function syncLocalToRemote(
  dest: BucketConfig,
  stagingDir: string,
  awsCliPath = 'aws'
) {
  console.log(`Syncing from ${stagingDir} to ${dest.s3url}`);
  const args = createS3cmdArgs(
    ['sync', stagingDir, dest.s3url.toString()],
    dest.s3endpoint
  );
  const { status, stderr } = spawnSync(awsCliPath, args, {
    env: {
      AWS_ACCESS_KEY_ID: dest.s3accessKey,
      AWS_SECRET_ACCESS_KEY: dest.s3secretKey,
      AWS_SESSION_TOKEN: dest.s3sessionToken,
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

async function copyLocalToRemote(
  dest: BucketConfig,
  filePath: string,
  awsCliPath = 'aws'
) {
  console.log(`Copying from ${filePath} to ${dest.s3url}`);
  const args = createS3cmdArgs(
    ['cp', filePath, dest.s3url.toString()],
    dest.s3endpoint
  );
  const { status, stderr } = spawnSync(awsCliPath, args, {
    env: {
      AWS_ACCESS_KEY_ID: dest.s3accessKey,
      AWS_SECRET_ACCESS_KEY: dest.s3secretKey,
      AWS_SESSION_TOKEN: dest.s3sessionToken,
      AWS_REGION: dest.s3region
    },
    shell: true
  });
  if (status !== 0) {
    if (stderr) {
      console.log(stderr.toString());
    }
    throw new Error('Copy to remote bucket failed');
  }
  console.log(`Copied ${filePath} to ${dest.s3url.toString()}`);
}

export async function doSync(opts: SyncOptions) {
  const awsCliPath = opts.awsCliPath || 'aws';

  if (opts.singleFile) {
    // Check file size first for single file operations
    const fileSize = await getFileSize(opts.source, awsCliPath);

    if (fileSize > LARGE_FILE_THRESHOLD) {
      console.log(
        `Large file detected (${(fileSize / 1024 / 1024).toFixed(
          2
        )} MB), using chunked copy...`
      );
      await copyLargeFileChunked(opts.source, opts.dest);
    } else {
      console.log(
        `Small file detected (${(fileSize / 1024 / 1024).toFixed(
          2
        )} MB), using traditional copy...`
      );
      const stagingDir = await prepare(opts.stagingDir);
      try {
        await copyToLocal(opts.source, stagingDir, awsCliPath);
        const fileName = opts.source.s3url.pathname.split('/').pop();
        const filePath = join(stagingDir, fileName || '');
        await copyLocalToRemote(opts.dest, filePath, awsCliPath);
        await cleanup(stagingDir);
      } catch (err) {
        await cleanup(stagingDir);
        throw err;
      }
    }
  } else {
    // For directory sync operations, use traditional method with staging
    const stagingDir = await prepare(opts.stagingDir);
    try {
      await syncToLocal(opts.source, stagingDir, awsCliPath);
      await syncLocalToRemote(opts.dest, stagingDir, awsCliPath);
      await cleanup(stagingDir);
    } catch (err) {
      await cleanup(stagingDir);
      throw err;
    }
  }
}
