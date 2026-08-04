import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Prisma } from '@prisma/client';
import { createLogger } from '../lib/logger';
import { prisma } from '../lib/prisma';
import { cardSlug, slugify } from '../lib/slug';
import { upsertCard } from '../sync/upsert';
import { applyVariantTags } from '../sync/variant-tags';

const log = createLogger('sync:topps');

/**
 * Topps Pokemon (1999-2003): licensed non-TCG card sets that dominate the
 * graded-slab market alongside the TCG — TV Animation S1-S3, The First
 * Movie, The Movie 2000, Chrome S1-S2, Advanced Challenge.
 *
 * No API carries these, so the checklists are CURATED data in
 * data/topps-pokemon/*.json, compiled from cross-verified public checklists
 * (TCDb, Cardboard Connection, PSA registry). They live under game
 * "pokemon" with `series = "Topps"` — the matcher partitions candidates on
 * that series, so Topps titles and TCG titles can never cross-match.
 *
 * Data shape: every card lists its OWN variants (parallels/foils are
 * resolved per card at data-generation time, not implied set-wide), so the
 * sync stays a dumb loop.
 */

interface ToppsCard {
  number: string;
  name: string;
  /** null/absent = base checklist; else e.g. "tv-episode", "evolution", "sticker". */
  subset?: string | null;
  /** Variant sibling names in vocab token form ("spectra", "silverFoil"). */
  variants?: string[];
}

interface ToppsSet {
  /** Expansion sourceId, e.g. "topps-pokemon-tv1". */
  sourceId: string;
  name: string;
  year: number;
  /** ISO date when known; falls back to Jan 1 of `year`. */
  releaseDate?: string;
  totalCardCount?: number;
  cards: ToppsCard[];
}

const DATA_DIR = join(__dirname, '..', '..', 'data', 'topps-pokemon');

export function loadToppsSets(): ToppsSet[] {
  const files = readdirSync(DATA_DIR).filter((file) => file.endsWith('.json'));
  return files.map((file) => JSON.parse(readFileSync(join(DATA_DIR, file), 'utf8')) as ToppsSet);
}

export async function syncToppsPokemon(): Promise<{ expansions: number; cards: number }> {
  const sets = loadToppsSets();
  let cardCount = 0;

  for (const set of sets) {
    const releaseDate = new Date(set.releaseDate ?? `${set.year}-01-01`);
    const expansion = await prisma.expansion.upsert({
      where: { game_sourceId: { game: 'pokemon', sourceId: set.sourceId } },
      create: {
        game: 'pokemon',
        sourceId: set.sourceId,
        name: set.name,
        series: 'Topps',
        language: 'English',
        languageCode: 'en',
        totalCardCount: set.totalCardCount ?? set.cards.length,
        numberedCardCount: set.totalCardCount ?? set.cards.length,
        releaseDate,
      },
      update: {
        name: set.name,
        series: 'Topps',
        totalCardCount: set.totalCardCount ?? set.cards.length,
        numberedCardCount: set.totalCardCount ?? set.cards.length,
        releaseDate,
      },
    });

    const setSlug = slugify(set.name);
    for (const card of set.cards) {
      const common = {
        name: card.name,
        setName: set.name,
        setSlug,
        cardNumber: card.number,
        language: 'en',
        expansionId: expansion.id,
        rarity: null as string | null,
      };
      // Subset-qualified id: Movie 2000 has a scene #6, a sticker #6 AND a
      // hologram #6 — number alone is not unique within an expansion.
      const baseSourceId = card.subset
        ? `${set.sourceId}-${slugify(card.subset)}-${slugify(card.number)}`
        : `${set.sourceId}-${slugify(card.number)}`;
      await upsertCard('pokemon', baseSourceId, {
        ...common,
        slug: cardSlug(card.name, card.number),
        payload: { source: 'topps-curated', subset: card.subset ?? null } as Prisma.InputJsonValue,
      });
      for (const variant of card.variants ?? []) {
        const cardId = await upsertCard('pokemon', `${baseSourceId}#${variant}`, {
          ...common,
          slug: cardSlug(card.name, card.number, slugify(variant)),
          payload: {
            source: 'topps-curated',
            subset: card.subset ?? null,
            variant,
          } as Prisma.InputJsonValue,
        });
        await applyVariantTags(cardId, variant);
      }
      cardCount++;
    }

    // Curated sets are complete by construction — mark synced so nothing
    // downstream treats them as pending.
    await prisma.expansion.update({
      where: { id: expansion.id },
      data: { cardsSyncedAt: new Date(), syncedCardCount: set.cards.length },
    });
    log.info(`pokemon/${set.sourceId} "${set.name}": ${set.cards.length} cards`);
  }

  return { expansions: sets.length, cards: cardCount };
}
