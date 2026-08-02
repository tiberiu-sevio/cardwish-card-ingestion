import { env } from '../lib/env';
import { createLogger } from '../lib/logger';
import { sleep, sleepWithJitter } from '../lib/sleep';
import type { ScrydexUsage } from './types';

const log = createLogger('scrydex');

const BASE = 'https://api.scrydex.com';
const PAGE_SIZE = 100;
const MAX_ATTEMPTS = 4;

let requestCount = 0;

/** API requests made by this process — logged so credit spend is visible per run. */
export function requestsMade(): number {
  return requestCount;
}

async function scrydexFetch<T>(path: string, params: Record<string, string | number> = {}): Promise<T> {
  const url = new URL(`${BASE}${path}`);
  for (const [key, value] of Object.entries(params)) {
    url.searchParams.set(key, String(value));
  }

  let lastError: unknown;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      const response = await fetch(url, {
        headers: { 'X-Api-Key': env.scrydexApiKey, 'X-Team-ID': env.scrydexTeamId },
        signal: AbortSignal.timeout(30_000),
      });
      requestCount++;
      if (response.ok) return (await response.json()) as T;

      const body = await response.text().catch(() => '');
      // Auth/plan errors won't heal on retry — surface them immediately.
      if (response.status === 401 || response.status === 403) {
        throw new Error(`Scrydex auth error ${response.status}: ${body.slice(0, 200)}`);
      }
      if (response.status === 429) {
        const retryAfter = Number(response.headers.get('retry-after')) || 2 ** attempt;
        log.warn(`429 rate limited, waiting ${retryAfter}s`, path);
        await sleep(retryAfter * 1000);
        continue;
      }
      lastError = new Error(`Scrydex HTTP ${response.status} for ${path}: ${body.slice(0, 200)}`);
    } catch (error) {
      if (String(error).includes('auth error')) throw error;
      lastError = error;
    }
    await sleepWithJitter(1000 * 2 ** attempt);
  }
  throw lastError;
}

/** Envelope-tolerant list extraction: Scrydex wraps arrays in a data field. */
function extractItems<T>(body: unknown): T[] {
  if (Array.isArray(body)) return body as T[];
  const data = (body as { data?: unknown })?.data;
  if (Array.isArray(data)) return data as T[];
  throw new Error(`Unexpected Scrydex response shape: ${JSON.stringify(body).slice(0, 200)}`);
}

/** Iterate every item of a paged endpoint. One API credit per page. */
export async function* pagedItems<T>(path: string, params: Record<string, string | number> = {}): AsyncGenerator<T> {
  let page = 1;
  for (;;) {
    const body = await scrydexFetch<unknown>(path, { ...params, page, page_size: PAGE_SIZE });
    const items = extractItems<T>(body);
    for (const item of items) yield item;
    if (items.length < PAGE_SIZE) return;
    page++;
    // ~5 req/s: far under the 100/s limit; credits are the real budget.
    await sleepWithJitter(150);
  }
}

export async function getUsage(): Promise<ScrydexUsage> {
  const body = await scrydexFetch<ScrydexUsage | { data?: ScrydexUsage }>('/account/v1/usage');
  return ((body as { data?: ScrydexUsage }).data ?? body) as ScrydexUsage;
}

/**
 * Guard against silent overage billing: Scrydex keeps serving after the quota
 * is spent and bills the difference, so refuse to start work near the floor.
 * Usage data lags 20-30 minutes — the floor should have margin built in.
 */
export async function assertCreditsAvailable(): Promise<void> {
  const usage = await getUsage();
  const remaining = usage.remaining_credits;
  if (typeof remaining === 'number' && remaining < env.scrydexMinCredits) {
    throw new Error(
      `Scrydex credits low: ${remaining} remaining < floor ${env.scrydexMinCredits}. ` +
        'Raise SCRYDEX_MIN_CREDITS=0 to override knowingly.',
    );
  }
  log.info(`credits: ${remaining ?? 'unknown'} remaining (floor ${env.scrydexMinCredits})`);
}
