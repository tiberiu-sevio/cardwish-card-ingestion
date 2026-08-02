import type { Expansion } from '@prisma/client';
import { extensionFromUrl, mirrorAll, mirrorImage } from '../cdn/spaces';
import { createLogger } from '../lib/logger';
import { prisma } from '../lib/prisma';
import { sleepWithJitter } from '../lib/sleep';
import { fetchYgoSetCards, fetchYgoSets } from './client';
import type { YgoCard } from './types';

const log = createLogger('ygo:sync');

const GAME = 'yugioh';

/**
 * YGOPRODeck set_codes are NOT unique (142 collisions, e.g. reprint products
 * sharing a code), but set names are — so the expansion sourceId is the
 * slugified name, which is also the join key card prints use.
 */
function slugifySetName(name: string): string {
  return name
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

export async function syncYugiohExpansions(): Promise<number> {
  const sets = await fetchYgoSets();
  let count = 0;
  for (const set of sets) {
    const releaseDate = set.tcg_date ? new Date(`${set.tcg_date}T00:00:00Z`) : null;
    const data = {
      name: set.set_name,
      code: set.set_code ?? null,
      totalCardCount: set.num_of_cards ?? null,
      language: 'English',
      languageCode: 'en',
      releaseDate,
    };
    const row = await prisma.expansion.upsert({
      where: { game_sourceId: { game: GAME, sourceId: slugifySetName(set.set_name) } },
      create: { game: GAME, sourceId: slugifySetName(set.set_name), ...data },
      update: data,
    });
    count++;
    if (set.set_image && !row.logoKey) {
      const key = `expansions/${GAME}/${row.sourceId}-logo.${extensionFromUrl(set.set_image)}`;
      try {
        await mirrorImage(set.set_image, key);
        await prisma.expansion.update({ where: { id: row.id }, data: { logoKey: key } });
      } catch (error) {
        log.warn(`set image mirror failed for ${row.sourceId}`, String(error));
      }
    }
  }
  log.info(`${GAME}: ${count} sets upserted`);
  return count;
}

/**
 * One DB row per PRINT (card × printed number), mirroring how Scrydex games
 * store one row per per-language print — that's the granularity graded slabs
 * identify. A card printed at the same number in several rarities is one row;
 * the rarity list survives in the payload.
 */
export async function syncYugiohSetCards(expansion: Expansion): Promise<number> {
  const cards = await fetchYgoSetCards(expansion.name);
  let prints = 0;

  for (const card of cards) {
    const entries = (card.card_sets ?? []).filter((entry) => entry.set_name === expansion.name);
    const byCode = new Map<string, { rarities: string[] }>();
    for (const entry of entries) {
      const existing = byCode.get(entry.set_code) ?? { rarities: [] };
      if (entry.set_rarity && !existing.rarities.includes(entry.set_rarity)) {
        existing.rarities.push(entry.set_rarity);
      }
      byCode.set(entry.set_code, existing);
    }

    const artwork = card.card_images?.[0] ?? null;
    for (const [setCode, { rarities }] of byCode) {
      const data = {
        name: card.name,
        setName: expansion.name,
        // Prefix before the dash ("LOB-EN005" -> "LOB"); the full printed
        // number is the card number, which is what slab labels carry.
        setCode: setCode.split('-')[0] ?? null,
        cardNumber: setCode,
        language: 'en',
        imageUrl: artwork?.image_url ?? null,
        expansionId: expansion.id,
        rarity: rarities[0] ?? null,
        payload: buildPayload(card, rarities),
      };
      // The expansion is part of the print identity: reprint products (e.g.
      // LOB 25th Anniversary) reuse the original's set_codes for their new
      // rarities, and without the expansion in the key the two products
      // steal the shared codes from each other on every sync.
      const sourceId = `${expansion.sourceId}/${card.id}-${setCode}`;
      await prisma.card.upsert({
        where: { game_sourceId: { game: GAME, sourceId } },
        create: { game: GAME, sourceId, ...data },
        update: data,
      });
      prints++;
    }
  }

  const syncedCardCount = await prisma.card.count({ where: { expansionId: expansion.id } });
  await prisma.expansion.update({
    where: { id: expansion.id },
    data: { cardsSyncedAt: new Date(), syncedCardCount },
  });
  log.info(`${GAME}/${expansion.sourceId}: ${prints} prints from ${cards.length} cards (total ${expansion.totalCardCount ?? '?'})`);
  return prints;
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

export async function syncYugioh(): Promise<{ expansions: number; prints: number }> {
  const expansions = await syncYugiohExpansions();
  const pending = (
    await prisma.expansion.findMany({ where: { game: GAME }, orderBy: { releaseDate: 'desc' } })
  ).filter((row) => row.cardsSyncedAt === null || (row.totalCardCount !== null && row.totalCardCount !== row.syncedCardCount));
  log.info(`${GAME}: ${pending.length} sets need card sync`);
  let prints = 0;
  for (const expansion of pending) {
    prints += await syncYugiohSetCards(expansion);
    await sleepWithJitter(200);
  }
  return { expansions, prints };
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
