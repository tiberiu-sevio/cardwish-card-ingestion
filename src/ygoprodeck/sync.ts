import { extensionFromUrl, mirrorAll, mirrorImage } from '../cdn/spaces';
import { createLogger } from '../lib/logger';
import { prisma } from '../lib/prisma';
import { cardSlug, slugify } from '../lib/slug';
import { sleepWithJitter } from '../lib/sleep';
import { upsertCard } from '../sync/upsert';
import { fetchYgoSetCards, fetchYgoSets } from './client';
import type { YgoCard, YgoSet } from './types';

const log = createLogger('ygo:sync');

const GAME = 'yugioh';

/**
 * YGOPRODeck set_codes are NOT unique (142 collisions, e.g. reprint products
 * sharing a code), but set names are — so slugified names anchor identity.
 */
function slugifySetName(name: string): string {
  return name
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

/**
 * Numbering-run prefix of a printed card number: "LOB-001" -> "LOB",
 * "LOB-E001" -> "LOB-E", "LOB-EN001" -> "LOB-EN", "25LP-EN000" -> "25LP-EN".
 * Strips only the trailing digit run (plus an optional variant letter).
 */
export function runPrefix(setCode: string): string {
  return setCode.replace(/-?\d+[A-Za-z]?$/, '') || setCode;
}

/**
 * One EXPANSION row per numbering run of a product ("LOB", "LOB-E", "LOB-EN"
 * all named "Legend of Blue Eyes White Dragon") — the same granularity the
 * Scrydex games use for per-language prints, and the set size collectors
 * recognize (~126, not 355). Run rows are derived from print data during the
 * card sync; total_card_count is the run's print count.
 *
 * The "anything new?" gate therefore compares the SOURCE set's num_of_cards
 * against the sum of its runs' synced counts.
 */
export async function syncYugioh(): Promise<{ expansions: number; prints: number }> {
  const sets = await fetchYgoSets();

  const rows = await prisma.expansion.findMany({
    where: { game: GAME },
    select: { sourceId: true, cardsSyncedAt: true, syncedCardCount: true },
  });
  const runsBySet = new Map<string, { synced: number; complete: boolean }>();
  for (const row of rows) {
    const setSlug = row.sourceId.split('/')[0];
    const entry = runsBySet.get(setSlug) ?? { synced: 0, complete: true };
    entry.synced += row.syncedCardCount;
    entry.complete &&= row.cardsSyncedAt !== null;
    runsBySet.set(setSlug, entry);
  }

  const pending = sets.filter((set) => {
    const state = runsBySet.get(slugifySetName(set.set_name));
    return !state || !state.complete || (set.num_of_cards != null && state.synced !== set.num_of_cards);
  });
  log.info(`${GAME}: ${sets.length} sets, ${pending.length} need card sync`);

  let prints = 0;
  let expansions = 0;
  for (const set of pending) {
    const result = await syncYugiohSet(set);
    prints += result.prints;
    expansions += result.runs;
    await sleepWithJitter(200);
  }
  return { expansions, prints };
}

interface PrintData {
  cardId: number;
  setCode: string;
  rarities: string[];
  card: YgoCard;
}

export async function syncYugiohSet(set: YgoSet): Promise<{ runs: number; prints: number }> {
  const setSlug = slugifySetName(set.set_name);
  const cards = await fetchYgoSetCards(set.set_name);

  // Collect prints (deduped by code: multi-rarity prints are one row with the
  // rarity list in the payload), grouped by numbering run.
  const runs = new Map<string, PrintData[]>();
  for (const card of cards) {
    const byCode = new Map<string, string[]>();
    for (const entry of (card.card_sets ?? []).filter((e) => e.set_name === set.set_name)) {
      const rarities = byCode.get(entry.set_code) ?? [];
      if (entry.set_rarity && !rarities.includes(entry.set_rarity)) rarities.push(entry.set_rarity);
      byCode.set(entry.set_code, rarities);
    }
    for (const [setCode, rarities] of byCode) {
      const run = runPrefix(setCode);
      const prints = runs.get(run) ?? [];
      prints.push({ cardId: card.id, setCode, rarities, card });
      runs.set(run, prints);
    }
  }

  let printCount = 0;
  for (const [run, prints] of runs) {
    const expansionSourceId = `${setSlug}/${run}`;
    const data = {
      name: set.set_name,
      code: run,
      totalCardCount: prints.length,
      language: 'English',
      languageCode: 'en',
      releaseDate: set.tcg_date ? new Date(`${set.tcg_date}T00:00:00Z`) : null,
    };
    const expansion = await prisma.expansion.upsert({
      where: { game_sourceId: { game: GAME, sourceId: expansionSourceId } },
      create: { game: GAME, sourceId: expansionSourceId, ...data },
      update: data,
    });

    // Product logo, shared by every run of the set (one CDN object).
    if (set.set_image && !expansion.logoKey) {
      const key = `expansions/${GAME}/${setSlug}-logo.${extensionFromUrl(set.set_image)}`;
      try {
        await mirrorImage(set.set_image, key);
        await prisma.expansion.update({ where: { id: expansion.id }, data: { logoKey: key } });
      } catch (error) {
        log.warn(`set image mirror failed for ${setSlug}`, String(error));
      }
    }

    // Runs share a product name, so the run code disambiguates the set slug:
    // "legend-of-blue-eyes-white-dragon-lob-e".
    const cardSetSlug = slugify(`${set.set_name} ${run}`);
    for (const print of prints) {
      const artwork = print.card.card_images?.[0] ?? null;
      const baseSourceId = `${expansionSourceId}/${print.cardId}-${print.setCode}`;
      // Number within the run ("LOB-E001" -> "001") — the run is already in
      // the set slug, so the card slug reads "001-blue-eyes-white-dragon".
      const runNumber = print.setCode.slice(run.length).replace(/^-/, '') || print.setCode;
      // A code printed in several rarities is one collectible per rarity —
      // Yu-Gi-Oh's variant dimension. First listed is the base row.
      const rarities: (string | null)[] = print.rarities.length ? print.rarities : [null];
      for (const [index, rarity] of rarities.entries()) {
        const suffix = index === 0 ? null : slugify(rarity ?? '');
        await upsertCard(GAME, index === 0 ? baseSourceId : `${baseSourceId}#${slugify(rarity ?? '')}`, {
          name: print.card.name,
          setName: set.set_name,
          setCode: run,
          setSlug: cardSetSlug,
          slug: cardSlug(print.card.name, runNumber, suffix),
          cardNumber: print.setCode,
          language: 'en',
          imageUrl: artwork?.image_url ?? null,
          expansionId: expansion.id,
          rarity,
          payload: buildPayload(print.card, print.rarities) as never,
        });
      }
      printCount++;
    }

    // Base rows only — rarity siblings would desync the count from the
    // source's print total and re-trigger this set forever.
    const syncedCardCount = await prisma.card.count({
      where: { expansionId: expansion.id, NOT: { sourceId: { contains: '#' } } },
    });
    await prisma.expansion.update({
      where: { id: expansion.id },
      data: { cardsSyncedAt: new Date(), syncedCardCount },
    });
  }

  log.info(
    `${GAME}/${setSlug}: ${printCount} prints in ${runs.size} run(s) [${[...runs.keys()].join(', ')}] (source total ${set.num_of_cards ?? '?'})`,
  );
  return { runs: runs.size, prints: printCount };
}

function buildPayload(card: YgoCard, rarities: string[]): object {
  const { card_sets: _sets, card_images, card_prices: _prices, ygoprodeck_url: _url, ...rest } = card as YgoCard & {
    card_prices?: unknown;
    ygoprodeck_url?: unknown;
  };
  const artwork = card_images?.[0] ?? null;
  return {
    ...rest,
    passcode: card.id,
    rarities,
    artwork: artwork ? { small: artwork.image_url_small ?? null, large: artwork.image_url ?? null } : null,
  };
}

/**
 * Yu-Gi-Oh image mirroring is artwork-deduplicated: every print of a card
 * shares one artwork, so each is uploaded once (keyed by passcode) and the
 * CDN key is fanned out to all print rows in one update.
 */
export async function mirrorYugiohImages(): Promise<{ done: number; failed: number }> {
  const artworks: { passcode: string; small: string | null; large: string | null }[] = await prisma.$queryRawUnsafe(`
    SELECT payload->>'passcode' AS passcode,
           payload->'artwork'->>'small' AS small,
           payload->'artwork'->>'large' AS large
    FROM cards
    WHERE game = '${GAME}' AND (image_small_key IS NULL OR image_large_key IS NULL)
    GROUP BY 1, 2, 3`);

  const jobs: { sourceUrl: string; key: string; onDone: (key: string) => Promise<void> }[] = [];
  for (const artwork of artworks) {
    if (!artwork.small && !artwork.large) {
      // No source artwork: sentinel both keys so these rows leave the filter.
      await prisma.$executeRawUnsafe(
        `UPDATE cards SET image_small_key = '', image_large_key = '' WHERE game = $1 AND payload->>'passcode' = $2`,
        GAME,
        artwork.passcode,
      );
      continue;
    }
    for (const [column, url, suffix] of [
      ['image_small_key', artwork.small ?? artwork.large, 'small'],
      ['image_large_key', artwork.large ?? artwork.small, 'large'],
    ] as const) {
      if (!url) continue;
      jobs.push({
        sourceUrl: url,
        key: `cards/${GAME}/${artwork.passcode}-${suffix}.${extensionFromUrl(url)}`,
        onDone: async (doneKey) => {
          // Column name comes from the hardcoded tuple above, never from data.
          await prisma.$executeRawUnsafe(
            `UPDATE cards SET ${column} = $1 WHERE game = $2 AND payload->>'passcode' = $3`,
            doneKey,
            GAME,
            artwork.passcode,
          );
        },
      });
    }
  }

  log.info(`${GAME}: ${jobs.length} artwork uploads for ${artworks.length} artworks`);
  return mirrorAll(jobs);
}
