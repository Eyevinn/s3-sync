#! /usr/bin/env node

import { Command } from 'commander';
import { doSync } from '.';

const cli = new Command();
cli
  .description('Script to sync files on one S3 bucket to another')
  .argument('<source>', 'Source S3 URL')
  .argument('<dest>', 'Destination S3 URL')
  .option('--source-region <sourceRegion>', 'Source S3 region (SOURCE_REGION)')
  .option(
    '--source-endpoint <sourceEndpoint>',
    'Source S3 endpoint (SOURCE_ENDPOINT)'
  )
  .option(
    '--source-access-key <sourceAccessKey>',
    'Source S3 access key (SOURCE_ACCESS_KEY)'
  )
  .option(
    '--source-secret-key <sourceSecretKey>',
    'Source S3 secret key (SOURCE_SECRET_KEY)'
  )
  .option('--dest-region <destRegion>', 'Destination S3 region (DEST_REGION)')
  .option(
    '--dest-endpoint <destEndpoint>',
    'Destination S3 endpoint (DEST_ENDPOINT)'
  )
  .option(
    '--dest-access-key <destAccessKey>',
    'Destination S3 access key (DEST_ACCESS_KEY)'
  )
  .option(
    '--dest-secret-key <destSecretKey>',
    'Destination S3 secret key (DEST_SECRET_KEY)'
  )
  .option(
    '--staging-dir <stagingDir>',
    'Staging directory (STAGING_DIR)',
    '/tmp/data'
  )
  .action(async (source, dest, options) => {
    try {
      await doSync({
        source: {
          s3url: new URL(source),
          s3region: process.env.SOURCE_REGION || options.sourceRegion,
          s3endpoint: process.env.SOURCE_ENDPOINT || options.sourceEndpoint,
          s3accessKey: process.env.SOURCE_ACCESS_KEY || options.sourceAccessKey,
          s3secretKey: process.env.SOURCE_SECRET_KEY || options.sourceSecretKey
        },
        dest: {
          s3url: new URL(dest),
          s3region: process.env.DEST_REGION || options.destRegion,
          s3endpoint: process.env.DEST_ENDPOINT || options.destEndpoint,
          s3accessKey: process.env.DEST_ACCESS_KEY || options.destAccessKey,
          s3secretKey: process.env.DEST_SECRET_KEY || options.destSecretKey
        },
        stagingDir: process.env.STAGING_DIR || options.stagingDir
      });
    } catch (err) {
      console.log((err as Error).message);
    }
  });

cli.parseAsync(process.argv);
