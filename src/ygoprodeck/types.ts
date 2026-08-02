/** YGOPRODeck API v7 objects (https://ygoprodeck.com/api-guide/). */

export interface YgoSet {
  set_name: string;
  set_code?: string | null;
  num_of_cards?: number | null;
  /** YYYY-MM-DD */
  tcg_date?: string | null;
  set_image?: string | null;
}

export interface YgoCardSetEntry {
  set_name: string;
  /** Full printed card number, e.g. "LOB-EN005". */
  set_code: string;
  set_rarity?: string | null;
  set_rarity_code?: string | null;
}

export interface YgoCardImage {
  id: number;
  image_url?: string | null;
  image_url_small?: string | null;
}

export interface YgoCard {
  id: number;
  name: string;
  type?: string | null;
  frameType?: string | null;
  desc?: string | null;
  race?: string | null;
  archetype?: string | null;
  card_sets?: YgoCardSetEntry[] | null;
  card_images?: YgoCardImage[] | null;
  [key: string]: unknown;
}
