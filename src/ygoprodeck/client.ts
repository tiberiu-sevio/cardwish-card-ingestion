import { createLogger } from '../lib/logger';
import { sleepWithJitter } from '../lib/sleep';
import type { YgoCard, YgoSet } from './types';

const log = createLogger('ygoprodeck');

// Free community API, no auth. Documented limit is 20 req/s per IP; the
// per-set sync stays far below it.
const BASE = 'https://db.ygoprodeck.com/api/v7';
const MAX_ATTEMPTS = 3;

async function ygoFetch<T>(path: string): Promise<T | null> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      const response = await fetch(`${BASE}${path}`, { signal: AbortSignal.timeout(60_000) });
      if (response.ok) return (await response.json()) as T;
      const body = await response.text().catch(() => '');
      // The API answers 400 with an error body for empty matches — not a failure.
      if (response.status === 400 && body.includes('No card matching')) return null;
      lastError = new Error(`YGOPRODeck HTTP ${response.status} for ${path}: ${body.slice(0, 150)}`);
      log.warn(`attempt ${attempt}/${MAX_ATTEMPTS} failed`, String(lastError));
    } catch (error) {
      lastError = error;
      log.warn(`attempt ${attempt}/${MAX_ATTEMPTS} failed`, String(error));
    }
    await sleepWithJitter(1500 * attempt);
  }
  throw lastError;
}

export async function fetchYgoSets(): Promise<YgoSet[]> {
  const sets = await ygoFetch<YgoSet[]>('/cardsets.php');
  if (!Array.isArray(sets)) throw new Error('Unexpected cardsets.php response shape');
  return sets;
}

/** All cards printed in one set (empty for sets the card DB has no entries for). */
export async function fetchYgoSetCards(setName: string): Promise<YgoCard[]> {
  const body = await ygoFetch<{ data?: YgoCard[] }>(`/cardinfo.php?cardset=${encodeURIComponent(setName)}`);
  return body?.data ?? [];
}
