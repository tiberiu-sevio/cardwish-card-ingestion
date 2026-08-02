/** Scrydex objects (snake_case responses). Fields we don't map stay in the payload. */

/** Non-English objects carry an English rendering nested under translation.en. */
export interface ScrydexTranslation {
  en?: { name?: string | null; rarity?: string | null } | null;
}

export interface ScrydexExpansion {
  id: string;
  name: string;
  series?: string | null;
  code?: string | null;
  total?: number | null;
  printed_total?: number | null;
  language?: string | null;
  language_code?: string | null;
  /** YYYY/MM/DD */
  release_date?: string | null;
  is_online_only?: boolean | null;
  logo?: string | null;
  symbol?: string | null;
  translation?: ScrydexTranslation | null;
}

export interface ScrydexImage {
  type?: string | null;
  small?: string | null;
  medium?: string | null;
  large?: string | null;
}

export interface ScrydexCard {
  id: string;
  name: string;
  number?: string | null;
  printed_number?: string | null;
  rarity?: string | null;
  language?: string | null;
  language_code?: string | null;
  images?: ScrydexImage[] | null;
  expansion?: ScrydexExpansion | null;
  variants?: { name?: string | null }[] | null;
  translation?: ScrydexTranslation | null;
  [key: string]: unknown;
}

export interface ScrydexUsage {
  /** Live response field (the docs' remaining_credits name is outdated). */
  credits_remaining?: number;
  total_credits_consumed?: number;
  overage_credits_consumed?: number;
  period_start?: string;
  period_end?: string;
  [key: string]: unknown;
}

/** Scrydex API slug → our canonical game slug (matches parsing/games.ts in the crawler). */
export const GAME_SLUGS: Record<string, string> = {
  pokemon: 'pokemon',
  lorcana: 'lorcana',
  // Scrydex's path slug for MTG is the long form; /magic/v1 404s.
  magicthegathering: 'magic',
  gundam: 'gundam',
  onepiece: 'one-piece',
  riftbound: 'riftbound',
};
