/**
 * Canonical slugifier for card/set slugs. One implementation for sync paths
 * AND backfills — slugs must never diverge by code path.
 */
export function slugify(text: string): string {
  return text
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '') // strip diacritics (Pokémon -> pokemon)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/** Card slug: name plus printed number ("umbreon-vmax-215-203"). */
export function cardSlug(name: string, cardNumber: string | null): string {
  return slugify(cardNumber ? `${name} ${cardNumber}` : name);
}
