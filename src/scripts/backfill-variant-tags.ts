import { createLogger } from '../lib/logger';
import { prisma } from '../lib/prisma';
import { decomposeVariantName, isCuratedTag } from '../lib/variant-vocab';
import { ensureTagIds } from '../sync/variant-tags';

const log = createLogger('backfill-variant-tags');

const BATCH = 2000;

/**
 * One-off: tag every existing variant row (source_id containing '#') from
 * its decomposed variant name. Idempotent — junction inserts skip
 * duplicates, and the dictionary upsert refreshes labels/kinds. Daily syncs
 * maintain tags for new cards from here on (see sync/variant-tags.ts).
 */
async function main() {
  let cursor: string | null = null;
  let cards = 0;
  let junctionRows = 0;
  const generated = new Map<string, number>();

  for (;;) {
    const rows: { id: string; sourceId: string | null }[] = await prisma.card.findMany({
      where: { sourceId: { contains: '#' } },
      select: { id: true, sourceId: true },
      orderBy: { id: 'asc' },
      take: BATCH,
      cursor: cursor ? { id: cursor } : undefined,
      skip: cursor ? 1 : undefined,
    });
    if (rows.length === 0) break;
    cursor = rows[rows.length - 1].id;

    const inserts: { cardId: string; variantTagId: string }[] = [];
    for (const row of rows) {
      const suffix = row.sourceId?.split('#')[1];
      if (!suffix) continue;
      const defs = decomposeVariantName(suffix);
      for (const def of defs) {
        if (!isCuratedTag(def.slug)) generated.set(def.slug, (generated.get(def.slug) ?? 0) + 1);
      }
      const ids = await ensureTagIds(defs);
      inserts.push(...ids.map((variantTagId) => ({ cardId: row.id, variantTagId })));
      cards++;
    }

    if (inserts.length > 0) {
      await prisma.cardVariantTag.createMany({ data: inserts, skipDuplicates: true });
      junctionRows += inserts.length;
    }
    log.info(`${cards} cards processed, ${junctionRows} junction rows`);
  }

  const tagCount = await prisma.variantTag.count();
  const junctionCount = await prisma.cardVariantTag.count();
  log.info(`done: ${cards} variant cards tagged, dictionary holds ${tagCount} tags, ${junctionCount} junction rows`);
  if (generated.size > 0) {
    log.info(`generated (uncurated) tags: ${generated.size} — top 20:`);
    for (const [slug, n] of [...generated.entries()].sort((a, b) => b[1] - a[1]).slice(0, 20)) {
      log.info(`  ${slug}: ${n}`);
    }
  }
  await prisma.$disconnect();
}

main().catch((error) => {
  log.error('backfill failed', String(error));
  process.exit(1);
});
