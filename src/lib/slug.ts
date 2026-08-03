/**
 * Canonical slugifier for card/set slugs. One implementation for sync paths
 * AND backfills — slugs must never diverge by code path.
 *
 * URL shape: /{game}/{setSlug}/{slug}/ e.g.
 *   /pokemon/evolving-skies/215-umbreon-vmax/
 *   /pokemon/gym-challenge/2-blaine-s-charizard-1st-edition/
 */
export function slugify(text: string): string {
  return text
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '') // strip diacritics (Pokémon -> pokemon)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/**
 * The number component of a card slug: the numerator of fraction numbers
 * ("215/203" -> "215"), promo codes as-is ("SWSH061").
 */
export function slugNumber(cardNumber: string | null): string | null {
  if (!cardNumber) return null;
  return slugify(cardNumber.split('/')[0]) || null;
}

/** Number-first card slug: "215-umbreon-vmax", "2-blaine-s-charizard". */
export function cardSlug(name: string, cardNumber: string | null, variantSuffix?: string | null): string {
  const number = slugNumber(cardNumber);
  const base = slugify(number ? `${number} ${name}` : name);
  return variantSuffix ? `${base}-${variantSuffix}` : base;
}

/** camelCase variant token -> words: "firstEditionHolofoil" -> ["1st","edition","holofoil"]. */
function variantWords(name: string): string[] {
  const spaced = name.replace(/([a-z0-9])([A-Z])/g, '$1 $2').toLowerCase();
  return spaced.replace(/\bfirst edition\b/, '1st edition').split(/\s+/).filter(Boolean);
}

export interface VariantSlot {
  /** Source variant name, verbatim (goes into sourceId + payload). */
  name: string;
  /** null for the base variant (unsuffixed slug), else the slug suffix. */
  suffix: string | null;
}

/**
 * Decide base variant and slug suffixes for a card's variant list.
 * - single variant (or none): it is the base, no suffix
 * - among several, the "unlimited"/"normal" one is the base; the rest are
 *   suffixed with the words that distinguish them (words shared by every
 *   variant are dropped: firstEditionHolofoil/unlimitedHolofoil -> 1st-edition)
 */
export function variantSlots(names: string[]): VariantSlot[] {
  if (names.length === 0) return [{ name: '', suffix: null }];
  if (names.length === 1) return [{ name: names[0], suffix: null }];

  const words = names.map((name) => variantWords(name));
  const common = words[0].filter((word) => words.every((list) => list.includes(word)));
  const baseIndex = Math.max(
    0,
    names.findIndex((_, i) => words[i].includes('unlimited') || words[i].join(' ') === 'normal'),
  );
  return names.map((name, i) => {
    if (i === baseIndex) return { name, suffix: null };
    const distinct = words[i].filter((word) => !common.includes(word));
    return { name, suffix: slugify(distinct.join(' ')) || slugify(words[i].join(' ')) };
  });
}
