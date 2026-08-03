import type { Prisma } from '@prisma/client';
import { prisma } from '../lib/prisma';
import { slugify } from '../lib/slug';

/**
 * Card upsert that survives (game, language, set_slug, slug) collisions:
 * two prints can legitimately share name+number (variant artworks, 100a/100b
 * numbering quirks). The retry disambiguates deterministically by appending
 * the slugified source id — same input, same slug, forever.
 */
export async function upsertCard(
  game: string,
  sourceId: string,
  data: Omit<Prisma.CardUncheckedCreateInput, 'game' | 'sourceId'>,
): Promise<void> {
  try {
    await prisma.card.upsert({
      where: { game_sourceId: { game, sourceId } },
      create: { game, sourceId, ...data },
      update: data,
    });
  } catch (error) {
    if ((error as { code?: string })?.code !== 'P2002' || !data.slug) throw error;
    const suffixed = { ...data, slug: `${data.slug}-${slugify(sourceId)}` };
    await prisma.card.upsert({
      where: { game_sourceId: { game, sourceId } },
      create: { game, sourceId, ...suffixed },
      update: suffixed,
    });
  }
}
