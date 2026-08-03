import type { Expansion, Prisma } from '@prisma/client';
import { upsertCard } from './upsert';
import { createLogger } from '../lib/logger';
import { prisma } from '../lib/prisma';
import { cardSlug, slugify, variantSlots } from '../lib/slug';
import { pagedItems } from '../scrydex/client';
import { GAME_SLUGS, type ScrydexCard, type ScrydexImage } from '../scrydex/types';

const log = createLogger('sync:cards');

function frontImage(images: ScrydexImage[] | null | undefined): ScrydexImage | null {
  if (!images?.length) return null;
  return images.find((image) => (image.type ?? 'front') === 'front') ?? images[0];
}

/** The rare cards Scrydex leaves untranslated (no translation.en.name). */
const NAME_OVERRIDES: Record<string, string> = {
  'mp_ja-8': 'Mega Signal', // メガシグナル — JP promo without a translation entry
};

function englishName(card: ScrydexCard): string {
  const override = NAME_OVERRIDES[card.id];
  if (override) return override;
  const raw = card.translation?.en?.name ?? card.name;
  // Scrydex occasionally names a card "ナッシー[Exeggutor]" — Japanese with the
  // English in brackets. Canonical name is the bracket content.
  const bracket = raw.match(/^[^\x00-\x7F][^[]*\[(.+)\]$/);
  return bracket ? bracket[1] : raw;
}

/**
 * Payload kept for future features (gameplay attributes, variant names), with
 * the bulky parts we already store elsewhere stripped: the nested expansion
 * (we have the row) and variant image/price arrays (variant names survive).
 *
 * Everything stored is English: for non-English prints, translation.en (a full
 * English rendering — name, attacks, abilities, flavor text, rarity...) is
 * overlaid on the original, replacing the printed-language fields it covers.
 * The language columns still record the actual print language.
 */
export function trimPayload(card: ScrydexCard): object {
  const { expansion: _expansion, variants, translation, ...rest } = card;
  const en = (translation?.en ?? {}) as Record<string, unknown>;
  const { expansion: _enExpansion, ...enFields } = en;
  return {
    ...rest,
    ...Object.fromEntries(Object.entries(enFields).filter(([, value]) => value !== undefined)),
    variants: variants?.map((variant) => variant.name).filter(Boolean) ?? [],
  };
}

/** Expansions whose cards are unsynced or whose card count moved (new secret rares etc.). */
export async function expansionsNeedingCards(game: string): Promise<Expansion[]> {
  const rows = await prisma.expansion.findMany({ where: { game }, orderBy: { releaseDate: 'desc' } });
  return rows.filter(
    (row) => row.cardsSyncedAt === null || (row.totalCardCount !== null && row.totalCardCount !== row.syncedCardCount),
  );
}

/** Sync all cards of one expansion. Images are mirrored in a separate pass. */
export async function syncExpansionCards(scrydexGame: string, expansion: Expansion): Promise<number> {
  const game = GAME_SLUGS[scrydexGame] ?? scrydexGame;
  let seen = 0;

  const setSlug = slugify(expansion.name);
  for await (const card of pagedItems<ScrydexCard>(`/${scrydexGame}/v1/expansions/${expansion.sourceId}/cards`)) {
    const front = frontImage(card.images);
    const name = englishName(card);
    const cardNumber = card.number ?? card.printed_number ?? null;
    const common = {
      // English canonical name (see syncExpansions); the printed-language
      // original survives in payload.name.
      name,
      setName: expansion.name,
      setCode: expansion.code,
      setSlug,
      cardNumber,
      language: card.language_code?.toLowerCase() ?? expansion.languageCode,
      imageUrl: front?.large ?? front?.medium ?? front?.small ?? null,
      expansionId: expansion.id,
      // English canonical rarity too — JP prints label rarity in Japanese.
      rarity: card.translation?.en?.rarity ?? card.rarity ?? null,
    };
    // One row per VARIANT: 1st Edition and Unlimited are different
    // collectibles with different price histories, and slab labels state
    // the edition. The base variant keeps the card's own sourceId (and an
    // unsuffixed slug); siblings live at "{id}#{variantName}".
    const variantNames = (card.variants ?? []).map((v) => v.name).filter((n): n is string => Boolean(n));
    for (const slot of variantSlots(variantNames)) {
      const sourceId = slot.suffix === null ? card.id : `${card.id}#${slot.name}`;
      await upsertCard(game, sourceId, {
        ...common,
        slug: cardSlug(name, cardNumber, slot.suffix),
        payload: { ...(trimPayload(card) as object), variant: slot.name || null } as Prisma.InputJsonValue,
      });
    }
    seen++;
  }

  // Base rows only — variant siblings would desync the count from the
  // source's card total and re-trigger this expansion forever.
  const syncedCardCount = await prisma.card.count({
    where: { expansionId: expansion.id, NOT: { sourceId: { contains: '#' } } },
  });
  await prisma.expansion.update({
    where: { id: expansion.id },
    data: { cardsSyncedAt: new Date(), syncedCardCount },
  });
  log.info(`${game}/${expansion.sourceId} "${expansion.name}": ${seen} cards (total ${expansion.totalCardCount ?? '?'})`);
  return seen;
}
