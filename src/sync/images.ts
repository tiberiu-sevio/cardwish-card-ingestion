import { extensionFromUrl, mirrorAll } from '../cdn/spaces';
import { createLogger } from '../lib/logger';
import { prisma } from '../lib/prisma';
import type { ScrydexImage } from '../scrydex/types';

const log = createLogger('sync:images');

const BATCH = 5000;

/**
 * Mirror missing card images (front, small + large) to the CDN. Source URLs
 * live in the stored payload; the DB gets object keys only. Resumable by
 * construction: a card is picked up until both keys are set, and failures
 * leave the key null for the next run.
 */
export async function mirrorMissingCardImages(game?: string): Promise<{ done: number; failed: number }> {
  let totalDone = 0;
  let totalFailed = 0;

  for (;;) {
    const cards = await prisma.card.findMany({
      where: {
        ...(game ? { game } : {}),
        sourceId: { not: null },
        OR: [{ imageSmallKey: null }, { imageLargeKey: null }],
      },
      select: {
        id: true,
        game: true,
        sourceId: true,
        imageSmallKey: true,
        imageLargeKey: true,
        payload: true,
        expansion: { select: { sourceId: true } },
      },
      take: BATCH,
    });
    if (cards.length === 0) break;

    const jobs: { sourceUrl: string; key: string; onDone: (key: string) => Promise<void> }[] = [];
    for (const card of cards) {
      const images = (card.payload as { images?: ScrydexImage[] } | null)?.images;
      const front = images?.find((image) => (image.type ?? 'front') === 'front') ?? images?.[0];
      if (!front || (!front.small && !front.medium && !front.large)) {
        // No source images: mark both keys empty-string so the card stops
        // matching the null filter instead of looping forever.
        await prisma.card.update({ where: { id: card.id }, data: { imageSmallKey: '', imageLargeKey: '' } });
        continue;
      }
      // Variant siblings ("id#variant") share the base print's artwork —
      // one CDN object per artwork, referenced by every variant row.
      const baseSourceId = card.sourceId!.split('#')[0];
      const prefix = `cards/${card.game}/${card.expansion?.sourceId ?? 'unknown'}/${baseSourceId}`;
      const sizes = [
        { column: 'imageSmallKey' as const, url: front.small ?? front.medium ?? front.large, suffix: 'small' },
        { column: 'imageLargeKey' as const, url: front.large ?? front.medium ?? front.small, suffix: 'large' },
      ];
      for (const size of sizes) {
        if (card[size.column] !== null || !size.url) continue;
        jobs.push({
          sourceUrl: size.url,
          key: `${prefix}-${size.suffix}.${extensionFromUrl(size.url)}`,
          onDone: (key) => prisma.card.update({ where: { id: card.id }, data: { [size.column]: key } }).then(() => {}),
        });
      }
    }

    // A batch can consist entirely of no-image cards that were just marked
    // with the sentinel — they left the filter, so move to the next batch.
    if (jobs.length === 0) continue;
    log.info(`mirroring ${jobs.length} images (${cards.length} cards in batch)`);
    const { done, failed } = await mirrorAll(jobs);
    totalDone += done;
    totalFailed += failed;
    // Every job failing means something systemic (network, bucket auth) —
    // stop instead of spinning on the same batch.
    if (done === 0) break;
  }

  log.info(`image mirror pass: ${totalDone} uploaded, ${totalFailed} failed`);
  return { done: totalDone, failed: totalFailed };
}
