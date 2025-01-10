export function createS3cmdArgs(
  cmdArgs: string[],
  s3EndpointUrl?: string
): string[] {
  const args = ['s3'];
  if (s3EndpointUrl) {
    args.push(`--endpoint-url=${s3EndpointUrl}`);
  }
  return args.concat(cmdArgs);
}
