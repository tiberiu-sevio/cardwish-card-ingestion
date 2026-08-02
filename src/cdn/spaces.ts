import { PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { env } from '../lib/env';
import { createLogger } from '../lib/logger';

const log = createLogger('cdn');

// DO Spaces is S3-compatible. The bucket may later move to another S3 provider
// or sit behind our own CNAME — which is exactly why the DB stores object keys
// only, never absolute URLs.
const s3 = new S3Client({
  region: env.spacesRegion,
  endpoint: env.spacesEndpoint,
  credentials: { accessKeyId: env.spacesAccessKey, secretAccessKey: env.spacesSecretKey },
});

/** File extension from a source URL path, defaulting to png (Scrydex serves png/webp/jpg). */
export function extensionFromUrl(url: string): string {
  const match = new URL(url).pathname.match(/\.(png|webp|jpe?g|gif)$/i);
  return match ? match[1].toLowerCase().replace('jpeg', 'jpg') : 'png';
}

/**
 * Download `sourceUrl` and store it under `key`. Idempotent — re-uploading the
 * same key just overwrites the same bytes. Returns the key on success.
 */
export async function mirrorImage(sourceUrl: string, key: string): Promise<string> {
  const response = await fetch(sourceUrl, { signal: AbortSignal.timeout(60_000) });
  if (!response.ok) {
    throw new Error(`image download HTTP ${response.status}: ${sourceUrl}`);
  }
  const body = Buffer.from(await response.arrayBuffer());
  const contentType = response.headers.get('content-type') ?? 'image/png';

  await s3.send(
    new PutObjectCommand({
      Bucket: env.spacesBucket,
      Key: key,
      Body: body,
      ContentType: contentType,
      ACL: 'public-read',
      // Keys are content-addressed by card id + size, so cache forever.
      CacheControl: 'public, max-age=31536000, immutable',
    }),
  );
  return key;
}

/** Run image mirror jobs with bounded concurrency; failures are logged, not fatal. */
export async function mirrorAll(
  jobs: { sourceUrl: string; key: string; onDone: (key: string) => Promise<void> }[],
): Promise<{ done: number; failed: number }> {
  let done = 0;
  let failed = 0;
  let index = 0;

  async function workerLoop() {
    while (index < jobs.length) {
      const job = jobs[index++];
      try {
        await mirrorImage(job.sourceUrl, job.key);
        await job.onDone(job.key);
        done++;
        if (done % 500 === 0) log.info(`mirrored ${done}/${jobs.length} images`);
      } catch (error) {
        failed++;
        log.warn(`mirror failed for ${job.key}`, String(error));
      }
    }
  }

  await Promise.all(Array.from({ length: Math.min(env.imageConcurrency, jobs.length) }, workerLoop));
  return { done, failed };
}
