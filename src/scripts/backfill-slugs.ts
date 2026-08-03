import { createLogger } from '../lib/logger';
import { prisma } from '../lib/prisma';
import { cardSlug, slugify } from '../lib/slug';

const log = createLogger('backfill-slugs');

/**
 * One-off: fill set_slug/slug on rows synced before slugs existed, using the
 * exact same functions the sync paths now use. Idempotent and resumable —
 * only null-slug rows are touched. Collisions on the (game, language,
 * set_slug, slug) unique get the slugified source id appended, matching
 * upsertCard's behavior.
 */
async function main() {
  const yugiohArg = process.argv.includes('--game')
    ? process.argv[process.argv.indexOf('--game') + 1]
    : null;
  let done = 0;
  let collisions = 0;

  for (;;) {
    const cards = await prisma.card.findMany({
      where: { slug: null, ...(yugiohArg ? { game: yugiohArg } : {}) },
      select: {
        id: true,
        game: true,
        sourceId: true,
        name: true,
        cardNumber: true,
        setCode: true,
        expansion: { select: { name: true } },
      },
      take: 2000,
    });
    if (cards.length === 0) break;

    let index = 0;
    await Promise.all(
      Array.from({ length: 4 }, async () => {
        while (index < cards.length) {
          const card = cards[index++];
          const setSlug =
            card.game === 'yugioh'
              ? slugify(`${card.expansion?.name ?? ''} ${card.setCode ?? ''}`)
              : slugify(card.expansion?.name ?? card.setCode ?? 'unknown');
          const slug = cardSlug(card.name, card.cardNumber);
          try {
            await prisma.card.update({ where: { id: card.id }, data: { setSlug, slug } });
          } catch (error) {
            if ((error as { code?: string })?.code !== 'P2002') throw error;
            collisions++;
            await prisma.card.update({
              where: { id: card.id },
              data: { setSlug, slug: `${slug}-${slugify(card.sourceId ?? card.id)}` },
            });
          }
          done++;
        }
      }),
    );
    log.info(`${done} slugged (${collisions} collisions disambiguated)`);
  }
  log.info(`done: ${done} cards, ${collisions} collisions`);
  await prisma.$disconnect();
}

main().catch((error) => {
  log.error('backfill failed', String(error));
  process.exit(1);
});
