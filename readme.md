<h1 align="center">
  S3 Sync
</h1>

<div align="center">
  Script to sync files on one S3 bucket to another S3 bucket
  <br />
</div>

<div align="center">
<br />

[![npm](https://img.shields.io/npm/v/@eyevinn/s3-sync?style=flat-square)](https://www.npmjs.com/package/@eyevinn/s3-sync)
[![github release](https://img.shields.io/github/v/release/Eyevinn/s3-sync?style=flat-square)](https://github.com/Eyevinn/s3-sync/releases)
[![license](https://img.shields.io/github/license/eyevinn/s3-sync.svg?style=flat-square)](LICENSE)

[![PRs welcome](https://img.shields.io/badge/PRs-welcome-ff69b4.svg?style=flat-square)](https://github.com/eyevinn/s3-sync/issues?q=is%3Aissue+is%3Aopen+label%3A%22help+wanted%22)
[![made with hearth by Eyevinn](https://img.shields.io/badge/made%20with%20%E2%99%A5%20by-Eyevinn-59cbe8.svg?style=flat-square)](https://github.com/eyevinn)
[![Slack](http://slack.streamingtech.se/badge.svg)](http://slack.streamingtech.se)

</div>

---
<div align="center">

## Quick Demo: Open Source Cloud

Run this service in the cloud with a single click.

[![Badge OSC](https://img.shields.io/badge/Try%20it%20out!-1E3A8A?style=for-the-badge&logo=data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iMjQiIGhlaWdodD0iMjQiIHZpZXdCb3g9IjAgMCAyNCAyNCIgZmlsbD0ibm9uZSIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj4KPGNpcmNsZSBjeD0iMTIiIGN5PSIxMiIgcj0iMTIiIGZpbGw9InVybCgjcGFpbnQwX2xpbmVhcl8yODIxXzMxNjcyKSIvPgo8Y2lyY2xlIGN4PSIxMiIgY3k9IjEyIiByPSI3IiBzdHJva2U9ImJsYWNrIiBzdHJva2Utd2lkdGg9IjIiLz4KPGRlZnM+CjxsaW5lYXJHcmFkaWVudCBpZD0icGFpbnQwX2xpbmVhcl8yODIxXzMxNjcyIiB4MT0iMTIiIHkxPSIwIiB4Mj0iMTIiIHkyPSIyNCIgZ3JhZGllbnRVbml0cz0idXNlclNwYWNlT25Vc2UiPgo8c3RvcCBzdG9wLWNvbG9yPSIjQzE4M0ZGIi8+CjxzdG9wIG9mZnNldD0iMSIgc3RvcC1jb2xvcj0iIzREQzlGRiIvPgo8L2xpbmVhckdyYWRpZW50Pgo8L2RlZnM+Cjwvc3ZnPgo=)](https://app.osaas.io/browse/eyevinn-s3-sync)

</div>

---

Sync files on one S3 bucket to another S3 bucket with support for large files, session tokens, and single file operations.

## Features

- **Directory and Single File Sync**: Sync entire directories or individual files between S3 buckets
- **Large File Support**: Automatic chunked copying for files over 500MB using AWS SDK multipart upload
- **Session Token Support**: Compatible with temporary AWS credentials including session tokens
- **Cross-Region Support**: Sync between different AWS regions and S3-compatible endpoints
- **Configurable Staging**: Customizable local staging directory for operations

## Requirements

- AWS S3 CLI
- NodeJS 18+

## Installation / Usage

Options can be provided either as command line options or environment variables.

### Basic Usage

```bash
% npx @eyevinn/s3-sync \
  --source-access-key=<source-access-key> \
  --source-secret-key=<source-secret-key> \
  --source-region=<source-region> \
  --dest-endpoint=<dest-endpoint> \
  --dest-access-key=<dest-access-key> \
  --dest-secret-key=<dest-secret-key> \
  s3://source/files/ s3://dest/files/
```

### Single File Copy

```bash
% npx @eyevinn/s3-sync \
  --single-file \
  --source-access-key=<source-access-key> \
  --source-secret-key=<source-secret-key> \
  s3://source/large-file.mp4 s3://dest/large-file.mp4
```

### With Session Tokens (for temporary credentials)

```bash
% npx @eyevinn/s3-sync \
  --source-access-key=<source-access-key> \
  --source-secret-key=<source-secret-key> \
  --source-session-token=<source-session-token> \
  --dest-access-key=<dest-access-key> \
  --dest-secret-key=<dest-secret-key> \
  --dest-session-token=<dest-session-token> \
  s3://source/files/ s3://dest/files/
```

### Using Environment Variables

Store credentials in a file called `.env`:

```bash
SOURCE_ACCESS_KEY=<source-access-key>
SOURCE_SECRET_KEY=<source-secret-key>
SOURCE_SESSION_TOKEN=<source-session-token>  # Optional
SOURCE_REGION=<source-region>
SOURCE_ENDPOINT=<source-endpoint>             # Optional
DEST_ACCESS_KEY=<dest-access-key>
DEST_SECRET_KEY=<dest-secret-key>
DEST_SESSION_TOKEN=<dest-session-token>       # Optional
DEST_REGION=<dest-region>
DEST_ENDPOINT=<dest-endpoint>                 # Optional
STAGING_DIR=/tmp/data                         # Optional, default: /tmp/data
AWS_CLI_PATH=/usr/local/bin/aws               # Optional, default: aws
```

```bash
% set -a ; source .env ; set +a
% npx @eyevinn/s3-sync s3://source/files s3://dest/files/
```

## Command Line Options

| Option                   | Environment Variable   | Description                                              | Default     |
| ------------------------ | ---------------------- | -------------------------------------------------------- | ----------- |
| `--source-access-key`    | `SOURCE_ACCESS_KEY`    | Source S3 access key                                     | -           |
| `--source-secret-key`    | `SOURCE_SECRET_KEY`    | Source S3 secret key                                     | -           |
| `--source-session-token` | `SOURCE_SESSION_TOKEN` | Source S3 session token (for temporary credentials)      | -           |
| `--source-region`        | `SOURCE_REGION`        | Source S3 region                                         | -           |
| `--source-endpoint`      | `SOURCE_ENDPOINT`      | Source S3 endpoint (for S3-compatible services)          | -           |
| `--dest-access-key`      | `DEST_ACCESS_KEY`      | Destination S3 access key                                | -           |
| `--dest-secret-key`      | `DEST_SECRET_KEY`      | Destination S3 secret key                                | -           |
| `--dest-session-token`   | `DEST_SESSION_TOKEN`   | Destination S3 session token (for temporary credentials) | -           |
| `--dest-region`          | `DEST_REGION`          | Destination S3 region                                    | -           |
| `--dest-endpoint`        | `DEST_ENDPOINT`        | Destination S3 endpoint (for S3-compatible services)     | -           |
| `--staging-dir`          | `STAGING_DIR`          | Local staging directory                                  | `/tmp/data` |
| `--single-file`          | -                      | Use copy instead of sync for single file operations      | `false`     |
| `--aws-cli-path`         | `AWS_CLI_PATH`         | Full path to AWS CLI executable                          | `aws`       |

## Large File Handling

Files larger than 500MB are automatically processed using chunked copying with the AWS SDK for improved performance and reliability. This feature:

- Uses multipart upload for better error recovery
- Processes files in 100MB chunks
- Provides progress logging for large transfers
- Automatically falls back to traditional copy for smaller files

## Eyevinn Open Source Cloud

Looking for a hassle-free way to sync S3 buckets without installing anything locally? The S3 Sync service is also available as a managed web service in [Eyevinn Open Source Cloud](https://www.osaas.io).

### Why Use OSC?

- **No Local Setup**: No need to install AWS CLI or Node.js
- **Cloud-to-Cloud**: Direct bucket synchronization without routing through your computer
- **Secure Credential Management**: Store AWS credentials safely in OSC's secret management system
- **All Features Supported**: Large file handling, session tokens, cross-region sync, and more

### Getting Started with OSC

1. **Sign up** for a free account at [app.osaas.io](https://app.osaas.io)

2. **Create credential secrets** for your source bucket:
   - Navigate to Secrets and create `sourceaccesskey` 
   - Create another secret `sourcesecretkey`

3. **Create credential secrets** for your destination bucket:
   - Create `destinationaccesskey`
   - Create `destinationsecretkey`

4. **Launch the S3 Sync service**:
   - Browse to the [S3 Sync service](https://app.osaas.io/browse/eyevinn-s3-sync)
   - Configure your source and destination bucket URLs
   - Reference your stored credentials
   - Optional: Configure regions, endpoints, and other advanced settings

5. **Start syncing**: Your buckets will sync directly in the cloud!

For detailed setup instructions and advanced configuration options, see the [complete OSC documentation](https://docs.osaas.io/osaas.wiki/Service%3A-S3-Sync.html).

## Development

```
% npm install
% set -a ; source .env ; set +a
% npm start -- s3://source/files s3://dest/files/
```

## Contributing

See [CONTRIBUTING](CONTRIBUTING.md)

## License

This project is licensed under the MIT License, see [LICENSE](LICENSE).

# Support

Join our [community on Slack](http://slack.streamingtech.se) where you can post any questions regarding any of our open source projects. Eyevinn's consulting business can also offer you:

- Further development of this component
- Customization and integration of this component into your platform
- Support and maintenance agreement

Contact [sales@eyevinn.se](mailto:sales@eyevinn.se) if you are interested.

# About Eyevinn Technology

[Eyevinn Technology](https://www.eyevinntechnology.se) is an independent consultant firm specialized in video and streaming. Independent in a way that we are not commercially tied to any platform or technology vendor. As our way to innovate and push the industry forward we develop proof-of-concepts and tools. The things we learn and the code we write we share with the industry in [blogs](https://dev.to/video) and by open sourcing the code we have written.

Want to know more about Eyevinn and how it is to work here. Contact us at work@eyevinn.se!
