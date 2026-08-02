import type { Expansion } from '@prisma/client';
import { createLogger } from '../lib/logger';
import { prisma } from '../lib/prisma';
import { pagedItems } from '../scrydex/client';
import { GAME_SLUGS, type ScrydexCard, type ScrydexImage } from '../scrydex/types';

const log = createLogger('sync:cards');

function frontImage(images: ScrydexImage[] | null | undefined): ScrydexImage | null {
  if (!images?.length) return null;
  return images.find((image) => (image.type ?? 'front') === 'front') ?? images[0];
}

/**
 * Payload kept for future features (gameplay attributes, variant names), with
 * the bulky parts we already store elsewhere stripped: the nested expansion
 * (we have the row) and variant image/price arrays (variant names survive).
 */
function trimPayload(card: ScrydexCard): object {
  const { expansion: _expansion, variants, ...rest } = card;
  return {
    ...rest,
    variants: variants?.map((variant) => variant.name).filter(Boolean) ?? [],
  };
}

/** Expansions whose cards are unsynced or whose card count moved (new secret rares etc.). */
export async function expansionsNeedingCards(game: string): Promise<Expansion[]> {
  const rows = await prisma.expansion.findMany({ where: { game }, orderBy: { releaseDate: 'desc' } });
  return rows.filter(
    (row) => row.cardsSyncedAt === null || (row.total !== null && row.total !== row.syncedCardCount),
  );
}

/** Sync all cards of one expansion. Images are mirrored in a separate pass. */
export async function syncExpansionCards(scrydexGame: string, expansion: Expansion): Promise<number> {
  const game = GAME_SLUGS[scrydexGame] ?? scrydexGame;
  let seen = 0;

  for await (const card of pagedItems<ScrydexCard>(`/${scrydexGame}/v1/expansions/${expansion.scrydexId}/cards`)) {
    const front = frontImage(card.images);
    const data = {
      // English canonical name (see syncExpansions); the printed-language
      // original survives in payload.name.
      name: card.translation?.en?.name ?? card.name,
      setName: expansion.name,
      setCode: expansion.code,
      cardNumber: card.number ?? card.printed_number ?? null,
      language: card.language_code?.toLowerCase() ?? expansion.languageCode,
      imageUrl: front?.large ?? front?.medium ?? front?.small ?? null,
      expansionId: expansion.id,
      rarity: card.rarity ?? null,
      payload: trimPayload(card) as object,
    };
    await prisma.card.upsert({
      where: { game_scrydexId: { game, scrydexId: card.id } },
      create: { game, scrydexId: card.id, ...data },
      update: data,
    });
    seen++;
  }

  const syncedCardCount = await prisma.card.count({ where: { expansionId: expansion.id } });
  await prisma.expansion.update({
    where: { id: expansion.id },
    data: { cardsSyncedAt: new Date(), syncedCardCount },
  });
  log.info(`${game}/${expansion.scrydexId} "${expansion.name}": ${seen} cards (total ${expansion.total ?? '?'})`);
  return seen;
}
