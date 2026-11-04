import { Command } from 'commander';
import { doSync } from '.';
import {
  formatSummary,
  parseList,
  sanitizeError,
  syncAllBuckets
} from './allbuckets';

export interface CliDeps {
  doSync: typeof doSync;
  syncAllBuckets: typeof syncAllBuckets;
}

export function buildCli(deps: CliDeps = { doSync, syncAllBuckets }): Command {
  const cli = new Command();
  cli
    .description('Script to sync files on one S3 bucket to another')
    .argument(
      '[source]',
      'Source S3 URL (with --all-buckets the only argument is the destination)'
    )
    .argument('[dest]', 'Destination S3 URL')
    .option(
      '--source-region <sourceRegion>',
      'Source S3 region (SOURCE_REGION)'
    )
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
    .option(
      '--source-session-token <sourceSessionToken>',
      'Source S3 session token (SOURCE_SESSION_TOKEN)'
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
      '--dest-session-token <destSessionToken>',
      'Destination S3 session token (DEST_SESSION_TOKEN)'
    )
    .option(
      '--staging-dir <stagingDir>',
      'Staging directory (STAGING_DIR)',
      '/tmp/data'
    )
    .option(
      '--single-file',
      'Use copy instead of sync for single file operations'
    )
    .option(
      '--aws-cli-path <awsCliPath>',
      'Full path to AWS CLI executable (AWS_CLI_PATH)',
      'aws'
    )
    .option(
      '--all-buckets',
      'Back up every bucket of the source endpoint to <dest>/<bucket>/ (ALL_BUCKETS=true)'
    )
    .option(
      '--include <buckets>',
      'All-buckets mode: comma separated bucket names to include (INCLUDE_BUCKETS)'
    )
    .option(
      '--exclude <buckets>',
      'All-buckets mode: comma separated bucket names to exclude (EXCLUDE_BUCKETS)'
    )
    .option(
      '--delete',
      'All-buckets mode: delete destination objects absent from the source (DELETE_ON_DEST=true)'
    )
    .action(async (source, dest, options) => {
      const sourceCfg = {
        s3region: process.env.SOURCE_REGION || options.sourceRegion,
        s3endpoint: process.env.SOURCE_ENDPOINT || options.sourceEndpoint,
        s3accessKey: process.env.SOURCE_ACCESS_KEY || options.sourceAccessKey,
        s3secretKey: process.env.SOURCE_SECRET_KEY || options.sourceSecretKey,
        s3sessionToken:
          process.env.SOURCE_SESSION_TOKEN || options.sourceSessionToken
      };
      const destCfg = {
        s3region: process.env.DEST_REGION || options.destRegion,
        s3endpoint: process.env.DEST_ENDPOINT || options.destEndpoint,
        s3accessKey: process.env.DEST_ACCESS_KEY || options.destAccessKey,
        s3secretKey: process.env.DEST_SECRET_KEY || options.destSecretKey,
        s3sessionToken:
          process.env.DEST_SESSION_TOKEN || options.destSessionToken
      };
      const stagingDir = process.env.STAGING_DIR || options.stagingDir;
      const allBuckets =
        options.allBuckets || process.env.ALL_BUCKETS === 'true';

      if (allBuckets) {
        const destArg = dest || source;
        if (!destArg) {
          cli.error('error: missing required argument <dest>');
        }
        const secrets = [
          sourceCfg.s3accessKey,
          sourceCfg.s3secretKey,
          sourceCfg.s3sessionToken,
          destCfg.s3accessKey,
          destCfg.s3secretKey,
          destCfg.s3sessionToken
        ];
        try {
          const summary = await deps.syncAllBuckets({
            source: sourceCfg,
            dest: { ...destCfg, s3url: new URL(destArg) },
            include: parseList(options.include || process.env.INCLUDE_BUCKETS),
            exclude: parseList(options.exclude || process.env.EXCLUDE_BUCKETS),
            deleteOnDest:
              options.delete || process.env.DELETE_ON_DEST === 'true',
            stagingDir
          });
          console.log(formatSummary(summary));
          if (summary.failed > 0) {
            process.exitCode = 1;
          }
        } catch (err) {
          console.log(
            sanitizeError((err as Error).message || String(err), secrets)
          );
          console.log(
            formatSummary({ mode: 'all-buckets', buckets: [], failed: 1 })
          );
          process.exitCode = 1;
        }
        return;
      }

      if (!source || !dest) {
        cli.error("error: missing required argument 'dest'");
      }
      try {
        await deps.doSync({
          source: { ...sourceCfg, s3url: new URL(source) },
          dest: { ...destCfg, s3url: new URL(dest) },
          stagingDir,
          singleFile: options.singleFile,
          awsCliPath: process.env.AWS_CLI_PATH || options.awsCliPath
        });
      } catch (err) {
        console.log((err as Error).message);
      }
    });
  return cli;
}
