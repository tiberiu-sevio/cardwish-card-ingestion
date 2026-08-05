/**
 * Canonical variant-tag vocabulary and the decomposition engine that turns a
 * raw variant name (the "#suffix" on cards.source_id — Scrydex camelCase or
 * YGOPRODeck kebab-case) into ATOMIC tags: "firstEditionShadowlessHolofoil"
 * is [1st Edition] + [Shadowless] + [Holofoil], one junction row each, so a
 * listing saying any subset of those words can be compared set-wise.
 *
 * The curated entries below were verified against collector references
 * (Bulbapedia, Yugipedia, Scryfall api-types, official Bandai/Ravensburger
 * product pages — Aug 2026). Notable ground truth that is NOT guessable:
 *  - greenBack / blueBackNoNumberError / the prism holofoils are 1997 TOPSUN
 *    (Top-Seika gum) cards, not Base Set.
 *  - wStamp is the Wizards of the Coast "W" magazine promo stamp (7 cards,
 *    1999-2001), not a Winner or Worlds stamp.
 *  - pikachuStamp1..60 / charizardStampNN / cinderaceStampNN /
 *    armarougeStampNN are Battle Academy deck-position stamps; the digit is
 *    the deck slot, deliberately dropped here (one tag per deck).
 *  - Bare player names (jasonKlaczynski...) are World Championships Deck
 *    replica printings — classified via expansion context, see decompose().
 *  - Scrydex publishes no variant enum anywhere; this vocabulary is grown
 *    empirically from our own catalog, and the fallback path guarantees any
 *    new variant name still yields a (generated) tag instead of vanishing.
 *
 * MIRRORED into cardwish-card-ingestion (src/lib/variant-vocab.ts) the same
 * way the Prisma schema is — edit here first, then copy.
 */

export type VariantKind =
  | 'edition'
  | 'finish'
  | 'pattern'
  | 'stamp'
  | 'art'
  | 'release'
  | 'rarity'
  | 'error'
  | 'other';

export interface VariantTagDef {
  slug: string;
  label: string;
  kind: VariantKind;
}

/** Whole-suffix corrections for observed source-data typos. */
const SUFFIX_CORRECTIONS: Record<string, string> = {
  alrtArt: 'altArt',
  wantedPosted: 'wantedPoster',
  liveActionfoil: 'liveActionFoil',
  thirdAnnivarsaryAltArt: 'thirdAnniversaryAltArt',
  // One card tagged "redFilm" amid eleven "filmRed" — same FILM RED product.
  redFilm: 'filmRed',
};

export const TAGS: Record<string, { label: string; kind: VariantKind }> = {
  // --- Editions / print runs ---
  '1st-edition': { label: '1st Edition', kind: 'edition' },
  unlimited: { label: 'Unlimited', kind: 'edition' },
  shadowless: { label: 'Shadowless', kind: 'edition' },
  'no-rarity': { label: 'No Rarity (JP Base first print)', kind: 'edition' },
  'green-back': { label: 'Green Back (Topsun)', kind: 'edition' },
  'blue-back': { label: 'Blue Back (Topsun)', kind: 'edition' },
  'red-cheeks': { label: 'Red Cheeks', kind: 'edition' },
  'edition-beta': { label: 'Edition Beta (Ver.β)', kind: 'edition' },
  // Topps Pokemon print runs (TV Animation S1: 1st=blue/2nd=black/3rd=green/
  // 4th=red Topps logo; First Movie: 1st=blue, 2nd=black). Edition-kind:
  // grading labels state the printing and prices differ run to run.
  'first-print': { label: '1st Print', kind: 'edition' },
  'second-print': { label: '2nd Print', kind: 'edition' },
  'third-print': { label: '3rd Print', kind: 'edition' },
  'fourth-print': { label: '4th Print', kind: 'edition' },
  // --- Finishes ---
  foil: { label: 'Foil', kind: 'finish' },
  nonfoil: { label: 'Nonfoil', kind: 'finish' },
  holofoil: { label: 'Holofoil', kind: 'finish' },
  'reverse-holofoil': { label: 'Reverse Holofoil', kind: 'finish' },
  'etched-foil': { label: 'Etched Foil', kind: 'finish' },
  'cold-foil': { label: 'Cold Foil', kind: 'finish' },
  'textured-foil': { label: 'Textured Foil', kind: 'finish' },
  'non-textured': { label: 'Non-Textured', kind: 'finish' },
  'jolly-roger-foil': { label: 'Jolly Roger Foil', kind: 'finish' },
  // Topps Pokemon foils / formats
  'silver-foil': { label: 'Silver Foil', kind: 'finish' },
  'rainbow-foil': { label: 'Rainbow Foil', kind: 'finish' },
  'die-cut': { label: 'Die-Cut', kind: 'finish' },
  sticker: { label: 'Sticker', kind: 'finish' },
  // --- Holofoil patterns (which foil, not whether foil) ---
  'cosmos-holofoil': { label: 'Cosmos ("Galaxy") Holofoil', kind: 'pattern' },
  'cosmos-reverse-holofoil': { label: 'Cosmos Reverse Holofoil', kind: 'pattern' },
  'cracked-ice-holofoil': { label: 'Cracked Ice Holofoil', kind: 'pattern' },
  'cracked-ice-reverse-holofoil': { label: 'Cracked Ice Reverse Holofoil', kind: 'pattern' },
  'water-web-holofoil': { label: 'Water Web Holofoil', kind: 'pattern' },
  'sheen-holofoil': { label: 'Sheen Holofoil', kind: 'pattern' },
  'sequin-holofoil': { label: 'Sequin Holofoil', kind: 'pattern' },
  'tinsel-holofoil': { label: 'Tinsel Holofoil', kind: 'pattern' },
  'line-holofoil': { label: 'Line Holofoil', kind: 'pattern' },
  'mirror-reverse-holofoil': { label: 'Mirror Reverse Holofoil', kind: 'pattern' },
  'meadow-pink-holofoil': { label: 'Meadow Pink Holofoil', kind: 'pattern' },
  'meadow-pink-reverse-holofoil': { label: 'Meadow Pink Reverse Holofoil', kind: 'pattern' },
  // Topps Chrome Pokemon parallels (2000, Series 1+2): three chromium
  // patterns, no plain "Refractor" exists in this product (sellers mislabel
  // Spectra as Refractor).
  spectra: { label: 'Spectra-Chrome (Topps)', kind: 'pattern' },
  sparkle: { label: 'Sparkle-Chrome (Topps)', kind: 'pattern' },
  tekno: { label: 'Tekno-Chrome (Topps)', kind: 'pattern' },
  // Topsun prism foils
  'prism-holofoil': { label: 'Prism Holofoil (Topsun)', kind: 'pattern' },
  'checkered-prism-holofoil': { label: 'Checkered Prism Holofoil (Topsun)', kind: 'pattern' },
  'cracked-ice-prism-holofoil': { label: 'Cracked Ice Prism Holofoil (Topsun)', kind: 'pattern' },
  // Themed reverse-holo patterns (combine with reverse-holofoil)
  'poke-ball': { label: 'Poké Ball Pattern', kind: 'pattern' },
  'master-ball': { label: 'Master Ball Pattern', kind: 'pattern' },
  'dusk-ball': { label: 'Dusk Ball Pattern', kind: 'pattern' },
  'love-ball': { label: 'Love Ball Pattern', kind: 'pattern' },
  'friend-ball': { label: 'Friend Ball Pattern', kind: 'pattern' },
  'quick-ball': { label: 'Quick Ball Pattern', kind: 'pattern' },
  'great-ball': { label: 'Great Ball Pattern', kind: 'pattern' },
  'ultra-ball': { label: 'Ultra Ball Pattern', kind: 'pattern' },
  'team-rocket-pattern': { label: 'Team Rocket "R" Pattern', kind: 'pattern' },
  'energy-symbol-pattern': { label: 'Energy Symbol Pattern', kind: 'pattern' },
  // --- Stamps ---
  'prerelease-stamp': { label: 'Prerelease Stamp', kind: 'stamp' },
  'staff-stamp': { label: 'STAFF Stamp', kind: 'stamp' },
  'expansion-stamp': { label: 'Expansion Logo Stamp', kind: 'stamp' },
  'play-pokemon-stamp': { label: 'Play! Pokémon Stamp', kind: 'stamp' },
  'league-stamp': { label: 'Pokémon League Stamp', kind: 'stamp' },
  'league-1st-place-stamp': { label: 'League 1st Place Stamp', kind: 'stamp' },
  'league-2nd-place-stamp': { label: 'League 2nd Place Stamp', kind: 'stamp' },
  'league-3rd-place-stamp': { label: 'League 3rd Place Stamp', kind: 'stamp' },
  'league-4th-place-stamp': { label: 'League 4th Place Stamp', kind: 'stamp' },
  'professor-program-stamp': { label: 'Professor Program Stamp', kind: 'stamp' },
  'w-stamp': { label: 'Wizards "W" Stamp', kind: 'stamp' },
  'e3-stamp': { label: 'E3 Stamp', kind: 'stamp' },
  'winner-stamp': { label: 'Winner Stamp', kind: 'stamp' },
  'pumpkin-pikachu-stamp': { label: 'Pumpkin Pikachu Stamp (Trick or Trade)', kind: 'stamp' },
  'snowflake-stamp': { label: 'Snowflake Stamp (Holiday Calendar)', kind: 'stamp' },
  'burger-king-stamp': { label: 'Burger King Promo Stamp (D&P logo)', kind: 'stamp' },
  'build-a-bear-stamp': { label: 'Build-A-Bear Workshop Stamp', kind: 'stamp' },
  'toys-r-us-stamp': { label: 'Toys "R" Us Stamp', kind: 'stamp' },
  'seven-eleven-stamp': { label: '7-Eleven Stamp', kind: 'stamp' },
  'pokemon-center-stamp': { label: 'Pokémon Center Stamp', kind: 'stamp' },
  'jr-stamp-rally': { label: 'JR Stamp Rally', kind: 'stamp' },
  'gold-stamp-signature': { label: 'Gold Stamp Signature', kind: 'stamp' },
  // --- Art variants ---
  'alt-art': { label: 'Alternate Art', kind: 'art' },
  'special-alt-art': { label: 'Special Alt Art (SP)', kind: 'art' },
  'manga-alt-art': { label: 'Manga Rare', kind: 'art' },
  'premium-alt-art': { label: 'Premium Alternate Art', kind: 'art' },
  'japanese-alt-art': { label: 'Japanese Alternate Art', kind: 'art' },
  'full-art': { label: 'Full Art', kind: 'art' },
  'art-variant': { label: 'Art Variant', kind: 'art' },
  'art-variant-a': { label: 'Art Variant A', kind: 'art' },
  'wanted-poster': { label: 'Wanted Poster', kind: 'art' },
  borderless: { label: 'Borderless', kind: 'art' },
  // --- Releases / products ---
  serialized: { label: 'Serialized', kind: 'release' },
  reprint: { label: 'Reprint', kind: 'release' },
  jumbo: { label: 'Jumbo (Oversized)', kind: 'release' },
  metal: { label: 'Metal Card', kind: 'release' },
  'gold-border': { label: 'Gold Bordered', kind: 'release' },
  'black-star-promo': { label: 'Black Star Promo', kind: 'release' },
  'non-e-reader': { label: 'Non-e-Reader (No Dot Code)', kind: 'release' },
  unnumbered: { label: 'Unnumbered', kind: 'release' },
  'blister-holofoil': { label: 'Blister Holofoil', kind: 'release' },
  'starter-deck': { label: 'Starter Deck', kind: 'release' },
  'film-red': { label: 'FILM RED Edition', kind: 'release' },
  'live-action': { label: 'Live Action Edition', kind: 'release' },
  'twenty-fifth-edition': { label: '25th Anniversary Edition', kind: 'release' },
  st05: { label: 'ST05 Iron Bloom', kind: 'release' },
  'battle-academy-pikachu': { label: 'Battle Academy — Pikachu Deck', kind: 'release' },
  'battle-academy-charizard': { label: 'Battle Academy — Charizard Deck', kind: 'release' },
  'battle-academy-cinderace': { label: 'Battle Academy — Cinderace Deck', kind: 'release' },
  'battle-academy-armarouge': { label: 'Battle Academy — Armarouge Deck', kind: 'release' },
  'battle-academy-mewtwo': { label: 'Battle Academy — Mewtwo Deck', kind: 'release' },
  'battle-academy-eevee': { label: 'Battle Academy — Eevee Deck', kind: 'release' },
  'battle-academy-darkrai': { label: 'Battle Academy — Darkrai Deck', kind: 'release' },
  'short-print': { label: 'Short Print', kind: 'release' },
  'super-short-print': { label: 'Super Short Print', kind: 'release' },
  // --- Yu-Gi-Oh! rarities (verified display names) ---
  rare: { label: 'Rare', kind: 'rarity' },
  'super-rare': { label: 'Super Rare', kind: 'rarity' },
  'ultra-rare': { label: 'Ultra Rare', kind: 'rarity' },
  'ultimate-rare': { label: 'Ultimate Rare', kind: 'rarity' },
  'collector-rare': { label: 'Collector Rare', kind: 'rarity' },
  'secret-rare': { label: 'Secret Rare', kind: 'rarity' },
  'extra-secret-rare': { label: 'Extra Secret Rare', kind: 'rarity' },
  'platinum-secret-rare': { label: 'Platinum Secret Rare', kind: 'rarity' },
  'quarter-century-secret-rare': { label: 'Quarter Century Secret Rare', kind: 'rarity' },
  'starlight-rare': { label: 'Starlight Rare', kind: 'rarity' },
  'starfoil-rare': { label: 'Starfoil Rare', kind: 'rarity' },
  'shatterfoil-rare': { label: 'Shatterfoil Rare', kind: 'rarity' },
  'mosaic-rare': { label: 'Mosaic Rare', kind: 'rarity' },
  'pharaohs-rare': { label: "Ultra Rare (Pharaoh's Rare)", kind: 'rarity' },
  'dt-normal-parallel-rare': { label: 'Duel Terminal Normal Parallel Rare', kind: 'rarity' },
  'dt-normal-rare-parallel-rare': { label: 'Duel Terminal Normal Rare Parallel Rare', kind: 'rarity' },
  'dt-rare-parallel-rare': { label: 'Duel Terminal Rare Parallel Rare', kind: 'rarity' },
  'dt-super-parallel-rare': { label: 'Duel Terminal Super Parallel Rare', kind: 'rarity' },
  'dt-ultra-parallel-rare': { label: 'Duel Terminal Ultra Parallel Rare', kind: 'rarity' },
  'treasure-rare': { label: 'Treasure Rare (TR)', kind: 'rarity' },
  'link-rare': { label: 'Link Rare', kind: 'rarity' },
  // --- Errors / print corrections ---
  'no-number-error': { label: 'No Number (Error)', kind: 'error' },
  'no-damage-error': { label: 'No Damage (Error)', kind: 'error' },
  corrected: { label: 'Corrected', kind: 'error' },
  'alternate-print': { label: 'Alternate Print', kind: 'other' },
  // eBay "Features: Misprint" — an error card, its own collectible.
  misprint: { label: 'Misprint', kind: 'error' },
  'peelable-ditto': { label: 'Peelable Ditto', kind: 'other' },
};

/**
 * Word-sequence -> tag slugs, matched greedily longest-first over the
 * tokenized variant name. A sequence may emit several atomic tags
 * (expansionStaffStamp is the expansion stamp's staff version).
 */
const TOKEN_ENTRIES: { words: string[]; tags: string[] }[] = [
  // Longest / most specific sequences first is not required (the matcher
  // sorts), but grouping helps review.
  { words: ['ultra', 'rare', 'pharaoh', 's', 'rare'], tags: ['pharaohs-rare'] },
  { words: ['duel', 'terminal', 'normal', 'rare', 'parallel', 'rare'], tags: ['dt-normal-rare-parallel-rare'] },
  { words: ['duel', 'terminal', 'normal', 'parallel', 'rare'], tags: ['dt-normal-parallel-rare'] },
  { words: ['duel', 'terminal', 'rare', 'parallel', 'rare'], tags: ['dt-rare-parallel-rare'] },
  { words: ['duel', 'terminal', 'super', 'parallel', 'rare'], tags: ['dt-super-parallel-rare'] },
  { words: ['duel', 'terminal', 'ultra', 'parallel', 'rare'], tags: ['dt-ultra-parallel-rare'] },
  { words: ['quarter', 'century', 'secret', 'rare'], tags: ['quarter-century-secret-rare'] },
  { words: ['extra', 'secret', 'rare'], tags: ['extra-secret-rare'] },
  { words: ['platinum', 'secret', 'rare'], tags: ['platinum-secret-rare'] },
  { words: ['secret', 'rare'], tags: ['secret-rare'] },
  { words: ['starlight', 'rare'], tags: ['starlight-rare'] },
  { words: ['starfoil', 'rare'], tags: ['starfoil-rare'] },
  // YGOPRODeck lists bare "Starfoil" for the same Star Pack cards.
  { words: ['starfoil'], tags: ['starfoil-rare'] },
  { words: ['shatterfoil', 'rare'], tags: ['shatterfoil-rare'] },
  { words: ['mosaic', 'rare'], tags: ['mosaic-rare'] },
  { words: ['ultimate', 'rare'], tags: ['ultimate-rare'] },
  { words: ['ultra', 'rare'], tags: ['ultra-rare'] },
  { words: ['super', 'rare'], tags: ['super-rare'] },
  { words: ['treasure', 'rare'], tags: ['treasure-rare'] },
  { words: ['link', 'rare'], tags: ['link-rare'] },
  { words: ['rare'], tags: ['rare'] },
  { words: ['super', 'short', 'print'], tags: ['super-short-print'] },
  { words: ['short', 'print'], tags: ['short-print'] },

  { words: ['first', 'edition'], tags: ['1st-edition'] },
  { words: ['unlimited'], tags: ['unlimited'] },
  { words: ['shadowless'], tags: ['shadowless'] },
  // Topps Pokemon print runs, foils and Chrome parallels
  { words: ['first', 'print'], tags: ['first-print'] },
  { words: ['second', 'print'], tags: ['second-print'] },
  { words: ['third', 'print'], tags: ['third-print'] },
  { words: ['fourth', 'print'], tags: ['fourth-print'] },
  { words: ['silver', 'foil'], tags: ['silver-foil'] },
  { words: ['rainbow', 'foil'], tags: ['rainbow-foil'] },
  { words: ['die', 'cut'], tags: ['die-cut'] },
  { words: ['sticker'], tags: ['sticker'] },
  { words: ['spectra'], tags: ['spectra'] },
  { words: ['sparkle'], tags: ['sparkle'] },
  { words: ['tekno'], tags: ['tekno'] },
  { words: ['no', 'rarity', 'symbol'], tags: ['no-rarity'] },
  { words: ['green', 'back'], tags: ['green-back'] },
  { words: ['blue', 'back'], tags: ['blue-back'] },
  { words: ['red', 'cheeks'], tags: ['red-cheeks'] },
  { words: ['no', 'number', 'error'], tags: ['no-number-error'] },
  { words: ['no', 'damage', 'error'], tags: ['no-damage-error'] },
  { words: ['corrected'], tags: ['corrected'] },
  { words: ['beta'], tags: ['edition-beta'] },

  { words: ['reverse', 'holofoil'], tags: ['reverse-holofoil'] },
  { words: ['holofoil'], tags: ['holofoil'] },
  { words: ['foil'], tags: ['foil'] },
  { words: ['normal'], tags: ['nonfoil'] },
  { words: ['etched', 'foil'], tags: ['etched-foil'] },
  { words: ['cold', 'foil'], tags: ['cold-foil'] },
  { words: ['textured', 'foil'], tags: ['textured-foil'] },
  { words: ['non', 'textured'], tags: ['non-textured'] },
  { words: ['jolly', 'roger', 'foil'], tags: ['jolly-roger-foil'] },
  { words: ['serialized'], tags: ['serialized'] },

  { words: ['cosmos', 'reverse', 'holofoil'], tags: ['cosmos-reverse-holofoil'] },
  { words: ['cosmos', 'holofoil'], tags: ['cosmos-holofoil'] },
  { words: ['cracked', 'ice', 'prism', 'holofoil'], tags: ['cracked-ice-prism-holofoil'] },
  { words: ['cracked', 'ice', 'reverse', 'holofoil'], tags: ['cracked-ice-reverse-holofoil'] },
  { words: ['cracked', 'ice', 'holofoil'], tags: ['cracked-ice-holofoil'] },
  { words: ['checkered', 'prism', 'holofoil'], tags: ['checkered-prism-holofoil'] },
  { words: ['prism', 'holofoil'], tags: ['prism-holofoil'] },
  { words: ['water', 'web', 'holofoil'], tags: ['water-web-holofoil'] },
  { words: ['sheen', 'holofoil'], tags: ['sheen-holofoil'] },
  { words: ['sequin', 'holofoil'], tags: ['sequin-holofoil'] },
  { words: ['tinsel', 'holofoil'], tags: ['tinsel-holofoil'] },
  { words: ['line', 'holofoil'], tags: ['line-holofoil'] },
  { words: ['mirror', 'reverse', 'holofoil'], tags: ['mirror-reverse-holofoil'] },
  { words: ['meadow', 'pink', 'reverse', 'holofoil'], tags: ['meadow-pink-reverse-holofoil'] },
  { words: ['meadow', 'pink', 'holofoil'], tags: ['meadow-pink-holofoil'] },
  { words: ['blister', 'holofoil'], tags: ['blister-holofoil'] },
  { words: ['poke', 'ball'], tags: ['poke-ball'] },
  { words: ['master', 'ball'], tags: ['master-ball'] },
  { words: ['dusk', 'ball'], tags: ['dusk-ball'] },
  { words: ['love', 'ball'], tags: ['love-ball'] },
  { words: ['friend', 'ball'], tags: ['friend-ball'] },
  { words: ['quick', 'ball'], tags: ['quick-ball'] },
  { words: ['great', 'ball'], tags: ['great-ball'] },
  { words: ['ultra', 'ball'], tags: ['ultra-ball'] },
  { words: ['rocket', 'reverse', 'holofoil'], tags: ['team-rocket-pattern', 'reverse-holofoil'] },
  { words: ['energy', 'reverse', 'holofoil'], tags: ['energy-symbol-pattern', 'reverse-holofoil'] },

  { words: ['prerelease', 'staff', 'stamp'], tags: ['prerelease-stamp', 'staff-stamp'] },
  { words: ['prerelease', 'stamp'], tags: ['prerelease-stamp'] },
  { words: ['expansion', 'staff', 'stamp'], tags: ['expansion-stamp', 'staff-stamp'] },
  { words: ['expansion', 'stamp'], tags: ['expansion-stamp'] },
  { words: ['staff', 'stamp'], tags: ['staff-stamp'] },
  { words: ['play', 'pokemon', 'stamp'], tags: ['play-pokemon-stamp'] },
  { words: ['play', 'pokemon', 'thank', 'you', 'stamp'], tags: ['play-pokemon-stamp'] },
  { words: ['league', '1', 'st', 'place', 'stamp'], tags: ['league-1st-place-stamp'] },
  { words: ['league', '2', 'nd', 'place', 'stamp'], tags: ['league-2nd-place-stamp'] },
  { words: ['league', '3', 'rd', 'place', 'stamp'], tags: ['league-3rd-place-stamp'] },
  { words: ['league', '4', 'th', 'place', 'stamp'], tags: ['league-4th-place-stamp'] },
  { words: ['league', 'stamp'], tags: ['league-stamp'] },
  { words: ['professor', 'program', 'stamp'], tags: ['professor-program-stamp'] },
  { words: ['professor', 'program'], tags: ['professor-program-stamp'] },
  { words: ['w', 'stamp'], tags: ['w-stamp'] },
  { words: ['e', '3', 'stamp'], tags: ['e3-stamp'] },
  { words: ['winner', 'stamp'], tags: ['winner-stamp'] },
  { words: ['pumpkin', 'pikachu', 'stamp'], tags: ['pumpkin-pikachu-stamp'] },
  { words: ['snowflake', 'stamp'], tags: ['snowflake-stamp'] },
  { words: ['burger', 'king', 'expansion', 'stamp'], tags: ['burger-king-stamp', 'expansion-stamp'] },
  { words: ['burger', 'king', 'stamp'], tags: ['burger-king-stamp'] },
  { words: ['build', 'a', 'bear', 'stamp'], tags: ['build-a-bear-stamp'] },
  { words: ['toys', 'r', 'us', 'stamp'], tags: ['toys-r-us-stamp'] },
  { words: ['seven', 'eleven', 'stamp'], tags: ['seven-eleven-stamp'] },
  { words: ['pokemon', 'center', 'stamp'], tags: ['pokemon-center-stamp'] },
  { words: ['jr', 'stamp', 'rally'], tags: ['jr-stamp-rally'] },
  { words: ['gold', 'stamp', 'signature'], tags: ['gold-stamp-signature'] },

  { words: ['japanese', 'alt', 'art'], tags: ['japanese-alt-art'] },
  { words: ['special', 'alt', 'art'], tags: ['special-alt-art'] },
  { words: ['manga', 'alt', 'art'], tags: ['manga-alt-art'] },
  { words: ['premium', 'alt', 'art'], tags: ['premium-alt-art'] },
  { words: ['alt', 'art'], tags: ['alt-art'] },
  { words: ['full', 'art'], tags: ['full-art'] },
  { words: ['art', 'variant', 'a'], tags: ['art-variant-a'] },
  { words: ['art', 'variant'], tags: ['art-variant'] },
  { words: ['wanted', 'poster'], tags: ['wanted-poster'] },
  { words: ['borderless'], tags: ['borderless'] },

  { words: ['reprint'], tags: ['reprint'] },
  { words: ['jumbo'], tags: ['jumbo'] },
  { words: ['metal'], tags: ['metal'] },
  { words: ['gold', 'border'], tags: ['gold-border'] },
  { words: ['black', 'star', 'promo'], tags: ['black-star-promo'] },
  { words: ['non', 'e', 'reader'], tags: ['non-e-reader'] },
  { words: ['unnumbered'], tags: ['unnumbered'] },
  { words: ['alternate'], tags: ['alternate-print'] },
  { words: ['starter', 'deck'], tags: ['starter-deck'] },
  { words: ['film', 'red'], tags: ['film-red'] },
  { words: ['live', 'action', 'foil'], tags: ['live-action', 'foil'] },
  { words: ['twenty', 'fifth', 'edition'], tags: ['twenty-fifth-edition'] },
  { words: ['st', '05'], tags: ['st05'] },
  { words: ['peelable', 'ditto'], tags: ['peelable-ditto'] },
  { words: ['pikachu', 'stamp'], tags: ['battle-academy-pikachu'] },
  { words: ['charizard', 'stamp'], tags: ['battle-academy-charizard'] },
  { words: ['cinderace', 'stamp'], tags: ['battle-academy-cinderace'] },
  { words: ['armarouge', 'stamp'], tags: ['battle-academy-armarouge'] },
  { words: ['mewtwo', 'stamp'], tags: ['battle-academy-mewtwo'] },
  { words: ['eevee', 'stamp'], tags: ['battle-academy-eevee'] },
  { words: ['darkrai', 'stamp'], tags: ['battle-academy-darkrai'] },
];

const SORTED_ENTRIES = [...TOKEN_ENTRIES].sort((a, b) => b.words.length - a.words.length);

/**
 * World Championships Deck replicas: Scrydex tags the finalist's bare name
 * as a variant of the card in its ORIGINAL expansion (not a Worlds set), so
 * the names must be known explicitly. Extracted from our catalog (71 names,
 * all verified Worlds finalists 2004-present); new finalists appear here
 * as generated 'other' tags until added.
 */
const WORLDS_DECK_PLAYERS = new Set([
  'jason-klaczynski', 'zachary-bokhari', 'shintaro-ito', 'david-cohen', 'michael-pramawat',
  'sebastian-lashmet', 'yuta-komatsuda', 'rikuto-ohashi', 'tsubasa-nakamura', 'dylan-lefavour',
  'ian-whiton', 'jimmy-ballard', 'ross-cawthon', 'jun-hasebe', 'michikazu-tsuda',
  'takashi-yoneda', 'reed-weichler', 'alejandro-ng', 'jeremy-scharff', 'stephen-silvestro',
  'miska-saari', 'haruki-miyamoto', 'mychael-bryan', 'magnus-pedersen', 'trent-orndorff',
  'robin-schulz', 'michael-gonzalez', 'chris-fulop', 'tom-roos', 'diego-cassiraga',
  'haruto-kobayashi', 'henry-brand', 'yuka-furusawa', 'jason-martinez', 'hiroki-yano',
  'shuntu-sadahiro', 'naoto-suzuki', 'naohito-inoue', 'kevin-nguyen', 'vance-kelley',
  'patrick-martinez', 'jacob-van-wagner', 'kabu-fukase', 'shao-tong-yen', 'tsuguyoshi-yamato',
  'jesper-eriksen', 'gabriel-fernandez', 'andrew-estrada', 'rowan-stavenow', 'chase-moloney',
  'ondrej-skubal', 'yugo-sato', 'igor-costa', 'tord-reklev', 'andre-chiasson',
  'gustavo-wada', 'cody-walinski', 'pedro-eugenio-torres', 'akira-miyazaki', 'kaya-lichtleitner',
  'shuto-itagaki', 'paul-atanassov', 'christopher-kan', 'jeremy-maron', 'tristan-robinson',
  'clement-lamberton', 'curran-hill', 'sakuya-ota', 'jesse-parker', 'fernando-cifuentes',
  'evan-pavelsk',
]);

/** camelCase / kebab-case / letter-digit boundaries -> lowercase word list. */
export function tokenizeVariantName(name: string): string[] {
  return name
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    // Uppercase runs keep their last capital with the following word:
    // "nonEReader" -> "non E Reader".
    .replace(/([A-Z])([A-Z][a-z])/g, '$1 $2')
    .replace(/([A-Za-z])(\d)/g, '$1 $2')
    .replace(/(\d)([A-Za-z])/g, '$1 $2')
    .replace(/[-_]+/g, ' ')
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean);
}

function titleCase(words: string[]): string {
  return words.map((word) => (/^\d+$/.test(word) ? word : word.charAt(0).toUpperCase() + word.slice(1))).join(' ');
}

/** Kind for a generated (uncurated) run, inferred from its trailing word. */
function inferKind(words: string[]): VariantKind {
  // Trailing numbers qualify, they don't classify ("championshipStamp2024").
  const meaningful = [...words].reverse().find((word) => !/^\d+$/.test(word));
  const last = meaningful ?? words[words.length - 1];
  if (last === 'stamp') return 'stamp';
  if (last === 'art') return 'art';
  if (last === 'foil' || last === 'holofoil') return 'finish';
  if (last === 'rare') return 'rarity';
  if (last === 'error') return 'error';
  return 'other';
}

/**
 * Raw variant name -> atomic tag definitions. Curated sequences match
 * greedily (longest first); every maximal unmatched word run becomes ONE
 * generated tag (kind inferred from its trailing word), so unknown variants
 * surface as data instead of vanishing. Purely numeric leftovers adjacent to
 * curated matches are dropped (Battle Academy deck-position numbers).
 */
export function decomposeVariantName(rawName: string): VariantTagDef[] {
  const name = SUFFIX_CORRECTIONS[rawName] ?? rawName;
  const words = tokenizeVariantName(name);
  const result: VariantTagDef[] = [];
  let pending: string[] = [];

  const flushPending = () => {
    if (pending.length === 0) return;
    // Bare digits between curated matches carry no variant identity we keep.
    const meaningful = pending.some((word) => !/^\d+$/.test(word));
    if (meaningful) {
      const slug = pending.join('-');
      if (WORLDS_DECK_PLAYERS.has(slug)) {
        result.push({ slug, label: `World Championships Deck — ${titleCase(pending)}`, kind: 'release' });
      } else {
        result.push({ slug, label: titleCase(pending), kind: inferKind(pending) });
      }
    }
    pending = [];
  };

  let index = 0;
  while (index < words.length) {
    const entry = SORTED_ENTRIES.find(
      (candidate) =>
        candidate.words.length <= words.length - index &&
        candidate.words.every((word, offset) => words[index + offset] === word),
    );
    if (entry) {
      flushPending();
      for (const slug of entry.tags) {
        const def = TAGS[slug];
        result.push({ slug, label: def.label, kind: def.kind });
      }
      index += entry.words.length;
    } else {
      pending.push(words[index]);
      index += 1;
    }
  }
  flushPending();

  // Dedupe by slug, preserving order.
  const seen = new Set<string>();
  return result.filter((tag) => (seen.has(tag.slug) ? false : (seen.add(tag.slug), true)));
}

/** True when a slug is part of the curated dictionary (vs generated). */
export function isCuratedTag(slug: string): boolean {
  return slug in TAGS;
}
