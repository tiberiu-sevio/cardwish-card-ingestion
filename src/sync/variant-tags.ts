import { prisma } from '../lib/prisma';
import { decomposeVariantName, type VariantTagDef } from '../lib/variant-vocab';

/**
 * Maintains variant_tags (the dictionary) and card_variant_tags (the facts).
 * The dictionary is upserted on demand: labels/kinds follow the vocabulary
 * module, so a vocab improvement propagates on the next sync touching that
 * tag. Only variant rows (source_id containing '#') get tags — the base
 * printing is expressed by the ABSENCE of edition/finish tags.
 */
const tagIdCache = new Map<string, string>();

export async function ensureTagIds(defs: VariantTagDef[]): Promise<string[]> {
  const ids: string[] = [];
  for (const def of defs) {
    const cached = tagIdCache.get(def.slug);
    if (cached) {
      ids.push(cached);
      continue;
    }
    const tag = await prisma.variantTag.upsert({
      where: { slug: def.slug },
      create: { slug: def.slug, label: def.label, kind: def.kind },
      update: { label: def.label, kind: def.kind },
    });
    tagIdCache.set(def.slug, tag.id);
    ids.push(tag.id);
  }
  return ids;
}

/** Sync one card's tag set from its raw variant name (full replace). */
export async function applyVariantTags(cardId: string, variantName: string): Promise<void> {
  const defs = decomposeVariantName(variantName);
  const ids = await ensureTagIds(defs);
  if (ids.length > 0) {
    await prisma.cardVariantTag.createMany({
      data: ids.map((variantTagId) => ({ cardId, variantTagId })),
      skipDuplicates: true,
    });
  }
  await prisma.cardVariantTag.deleteMany({
    where: { cardId, variantTagId: { notIn: ids } },
  });
}
