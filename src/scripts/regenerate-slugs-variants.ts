import type { Prisma } from '@prisma/client';
import { createLogger } from '../lib/logger';
import { prisma } from '../lib/prisma';
import { cardSlug, slugify, variantSlots } from '../lib/slug';
import { upsertCard } from '../sync/upsert';

const log = createLogger('regen');

/**
 * One-off: bring pre-variant rows up to the current model, from stored
 * payloads only (zero source-API calls):
 *  - number-first slugs ("215-umbreon-vmax") and canonical set slugs
 *  - variant siblings ("{sourceId}#{variant}") for Scrydex games, per-rarity
 *    siblings for Yu-Gi-Oh — copying the base row's images and payload
 * Idempotent: base rows are recomputed in place, siblings are upserts.
 */
async function main() {
  let updated = 0;
  let siblings = 0;
  let cursor: string | null = null;

  type CardRow = Prisma.CardGetPayload<{ include: { expansion: { select: { name: true } } } }>;
  for (;;) {
    const cards: CardRow[] = await prisma.card.findMany({
      where: { NOT: { sourceId: { contains: '#' } }, ...(cursor ? { id: { gt: cursor } } : {}) },
      orderBy: { id: 'asc' },
      take: 1000,
      include: { expansion: { select: { name: true } } },
    });
    if (cards.length === 0) break;
    cursor = cards[cards.length - 1].id;

    let index = 0;
    await Promise.all(
      Array.from({ length: 4 }, async () => {
        while (index < cards.length) {
          const card = cards[index++];
          const payload = (card.payload ?? {}) as Record<string, unknown>;
          const expansionName = card.expansion?.name ?? card.setName ?? 'unknown';

          if (card.game === 'yugioh') {
            const setSlug = slugify(`${expansionName} ${card.setCode ?? ''}`);
            const runNumber =
              card.cardNumber && card.setCode
                ? card.cardNumber.slice(card.setCode.length).replace(/^-/, '') || card.cardNumber
                : card.cardNumber;
            const rarities = (payload.rarities as string[] | undefined) ?? [];
            await prisma.card.update({
              where: { id: card.id },
              data: { setSlug, slug: cardSlug(card.name, runNumber ?? null) },
            });
            updated++;
            for (const rarity of rarities.slice(1)) {
              await upsertCard(card.game, `${card.sourceId}#${slugify(rarity)}`, {
                name: card.name,
                setName: card.setName,
                setCode: card.setCode,
                setSlug,
                slug: cardSlug(card.name, runNumber ?? null, slugify(rarity)),
                cardNumber: card.cardNumber,
                language: card.language,
                imageUrl: card.imageUrl,
                expansionId: card.expansionId,
                rarity,
                imageSmallKey: card.imageSmallKey,
                imageLargeKey: card.imageLargeKey,
                payload: payload as never,
              });
              siblings++;
            }
          } else {
            const setSlug = slugify(expansionName);
            const variantNames = ((payload.variants as string[] | undefined) ?? []).filter(Boolean);
            for (const slot of variantSlots(variantNames)) {
              const slug = cardSlug(card.name, card.cardNumber, slot.suffix);
              if (slot.suffix === null) {
                try {
                  await prisma.card.update({
                    where: { id: card.id },
                    data: { setSlug, slug, payload: { ...payload, variant: slot.name || null } as never },
                  });
                } catch (error) {
                  if ((error as { code?: string })?.code !== 'P2002') throw error;
                  await prisma.card.update({
                    where: { id: card.id },
                    data: {
                      setSlug,
                      slug: `${slug}-${slugify(card.sourceId ?? card.id)}`,
                      payload: { ...payload, variant: slot.name || null } as never,
                    },
                  });
                }
                updated++;
              } else {
                await upsertCard(card.game, `${card.sourceId}#${slot.name}`, {
                  name: card.name,
                  setName: card.setName,
                  setCode: card.setCode,
                  setSlug,
                  slug,
                  cardNumber: card.cardNumber,
                  language: card.language,
                  imageUrl: card.imageUrl,
                  expansionId: card.expansionId,
                  rarity: card.rarity,
                  imageSmallKey: card.imageSmallKey,
                  imageLargeKey: card.imageLargeKey,
                  payload: { ...payload, variant: slot.name } as never,
                });
                siblings++;
              }
            }
          }
        }
      }),
    );
    log.info(`${updated} base rows updated, ${siblings} variant siblings`);
  }
  log.info(`done: ${updated} updated, ${siblings} siblings`);
  await prisma.$disconnect();
}

main().catch((error) => {
  log.error('regeneration failed', String(error));
  process.exit(1);
});
