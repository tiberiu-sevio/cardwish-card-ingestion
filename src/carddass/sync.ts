import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Prisma } from '@prisma/client';
import { createLogger } from '../lib/logger';
import { prisma } from '../lib/prisma';
import { cardSlug, slugify } from '../lib/slug';
import { upsertCard } from '../sync/upsert';

const log = createLogger('sync:carddass');

/**
 * Bandai's pre-TCG One Piece CARDDASS lines (1999-2002): Hyper Battle
 * (vending stages, Grand Boxes, Grand Line Compilations, Treasure Packs,
 * promos — one continuous C/S/H/FP numbering across the whole line) and
 * Visual Adventure (continuous #1-168 across four parts, seeded as one
 * expansion; only rows with verified names are present).
 *
 * Like Topps Pokemon, these dominate a graded niche (~8k PSA slabs) and no
 * API carries them — the checklists are CURATED data in
 * data/carddass-onepiece/*.json, two-source-verified (Grand Line Wiki ×
 * onepiececollection.fr, slab-spot-checked). Stored under game "one-piece"
 * with `series = 'Carddass'`, languageCode ja. Deliberately absent:
 * Carddass Masters (no verified checklists), the 2002-05 "One Piece Card
 * Game" successor (its C-numbers COLLIDE with Hyper Battle ranges — do not
 * seed it into the same number space without a disambiguation plan), and
 * Grand Box gold-stamp variants.
 */

interface CarddassCard {
  number: string;
  name: string;
}

interface CarddassSet {
  sourceId: string;
  name: string;
  year: number;
  releaseDate?: string;
  cards: CarddassCard[];
}

const DATA_DIR = join(__dirname, '..', '..', 'data', 'carddass-onepiece');

export async function syncCarddass(): Promise<{ expansions: number; cards: number }> {
  const files = readdirSync(DATA_DIR).filter((file) => file.endsWith('.json'));
  let cardCount = 0;

  for (const file of files) {
    const set = JSON.parse(readFileSync(join(DATA_DIR, file), 'utf8')) as CarddassSet;
    const releaseDate = new Date(set.releaseDate ?? `${set.year}-01-01`);
    const expansion = await prisma.expansion.upsert({
      where: { game_sourceId: { game: 'one-piece', sourceId: set.sourceId } },
      create: {
        game: 'one-piece',
        sourceId: set.sourceId,
        name: set.name,
        series: 'Carddass',
        language: 'Japanese',
        languageCode: 'ja',
        totalCardCount: set.cards.length,
        numberedCardCount: set.cards.length,
        releaseDate,
      },
      update: {
        name: set.name,
        series: 'Carddass',
        totalCardCount: set.cards.length,
        numberedCardCount: set.cards.length,
        releaseDate,
      },
    });

    const setSlug = slugify(set.name);
    for (const card of set.cards) {
      await upsertCard('one-piece', `${set.sourceId}-${slugify(card.number)}`, {
        name: card.name,
        setName: set.name,
        setSlug,
        cardNumber: card.number,
        language: 'ja',
        expansionId: expansion.id,
        rarity: null,
        slug: cardSlug(card.name, card.number),
        payload: { source: 'carddass-curated' } as Prisma.InputJsonValue,
      });
      cardCount++;
    }
    await prisma.expansion.update({
      where: { id: expansion.id },
      data: { cardsSyncedAt: new Date(), syncedCardCount: set.cards.length },
    });
    log.info(`one-piece/${set.sourceId} "${set.name}": ${set.cards.length} cards`);
  }
  return { expansions: files.length, cards: cardCount };
}
