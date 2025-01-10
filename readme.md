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

Sync files on one S3 bucket to another S3 bucket.

## Requirements

- AWS S3 CLI
- NodeJS 18+

## Installation / Usage

Options can be provided either as command line options or environment variables.

```
% npx @eyevinn/s3-sync \
  --source-access-key=<source-access-key> \
  --source-secret-key=<source-secret-key> \
  --source-region=<source-region> \
  --dest-endpoint=<dest-endpoint> \
  --dest-access-key=<dest-access-key> \
  --dest-secret-key=<dest-secret-key> \
  s3://source/files/ s3://dest/files/
```

Using environment variables stored in a file called `.env` in this example:

```
SOURCE_ACCESS_KEY=<source-access-key>
SOURCE_SECRET_KEY=<source-secret-key>
SOURCE_REGION=<source-region>
DEST_ENDPOINT=<dest-endpoint>
DEST_ACCESS_KEY=<dest-access-key>
DEST_SECRET_KEY=<dest-secret-key>
```

```
% set -a ; source .env ; set +a
% npx @eyevinn/s3-sync s3://source/files s3://dest/files/
```

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
