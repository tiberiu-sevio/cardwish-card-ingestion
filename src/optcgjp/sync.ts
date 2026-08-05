import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Prisma } from '@prisma/client';
import { createLogger } from '../lib/logger';
import { prisma } from '../lib/prisma';
import { cardSlug, slugify } from '../lib/slug';
import { upsertCard } from '../sync/upsert';

const log = createLogger('sync:optcg-jp');

/**
 * Japanese One Piece Card Game catalog. Scrydex is EN-only for One Piece, so
 * the JP side comes from the OFFICIAL Bandai cardlists via punk-records — a
 * GitHub mirror (vegapull scraper) of onepiece-cardgame.com refreshed ~2x a
 * week — which covers every JP set and the full global P-### promo sequence
 * (P-001 through P-159 today) that Scrydex's 103-card EN Promos set lacks.
 *
 * Modeling:
 * - Cards are grouped into `ja` expansions by CODE PREFIX (OP01, ST13, EB02,
 *   PRB01, P). Each ja expansion takes the EXACT NAME of its EN (Scrydex)
 *   counterpart, so the matcher's set dictionary sees a language pair for
 *   every set — same pattern as the Pokemon en+ja catalog. Prefixes with no
 *   EN counterpart yet fall back to the official Asia-EN pack title.
 * - English card names join from punk-records' english-asia locale by card
 *   id (codes are shared across regions), then dotgg's dataset for JP-only
 *   residue (newest magazine promos), else the Japanese name stays.
 * - Parallel ids (`P-001_p1`) are collapsed to their base id: the _pN
 *   suffixes are NOT stable across Bandai regions and community sources, so
 *   only code-level rows are safe. Alt-art identity stays listing-side.
 * - Don!! cards are absent from the official cardlist and are NOT seeded
 *   here (separate curated effort).
 *
 * IMPORTANT matcher interplay: the moment ja One Piece rows exist, the
 * matcher's language-mismatch penalty re-activates for the whole game — so
 * this sync must stay COMPLETE (all main sets, not just exclusives), and
 * previously-matched JP listings should be re-enqueued once after the first
 * sync so they migrate from EN rows to their ja siblings.
 */

const TARBALL_URL = 'https://codeload.github.com/buhbbl/punk-records/tar.gz/refs/heads/main';
const DOTGG_URL = 'https://api.dotgg.gg/cgfw/getcards?game=onepiece&mode=indexed';

interface PunkCard {
  id: string;
  name: string;
  rarity?: string | null;
  category?: string | null;
  pack_id?: string | null;
  img_full_url?: string | null;
  [key: string]: unknown;
}

function readCards(root: string, locale: string): Map<string, PunkCard> {
  const cardsDir = join(root, locale, 'cards');
  const byId = new Map<string, PunkCard>();
  for (const pack of readdirSync(cardsDir)) {
    for (const file of readdirSync(join(cardsDir, pack))) {
      if (!file.endsWith('.json')) continue;
      const card = JSON.parse(readFileSync(join(cardsDir, pack, file), 'utf8')) as PunkCard;
      if (!byId.has(card.id)) byId.set(card.id, card);
    }
  }
  return byId;
}

function readPackTitles(root: string, locale: string): Map<string, string> {
  const packs = JSON.parse(readFileSync(join(root, locale, 'packs.json'), 'utf8')) as Record<
    string,
    { id: string; raw_title?: string; title_parts?: { title?: string | null } }
  >;
  const titles = new Map<string, string>();
  for (const pack of Object.values(packs)) {
    titles.set(pack.id, pack.title_parts?.title || pack.raw_title || pack.id);
  }
  return titles;
}

/** dotgg's columnar payload -> id_normal -> English name (en + jpe rows). */
async function fetchDotggNames(): Promise<Map<string, string>> {
  const names = new Map<string, string>();
  try {
    const response = await fetch(DOTGG_URL, { signal: AbortSignal.timeout(60_000) });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const body = (await response.json()) as { names: string[]; data: unknown[][] };
    const col = (field: string) => body.names.indexOf(field);
    const [idNormal, name, language] = [col('id_normal'), col('name'), col('language')];
    for (const row of body.data) {
      const lang = String(row[language] ?? '');
      if (lang !== 'en' && lang !== 'jpe') continue;
      const id = String(row[idNormal] ?? '');
      if (id && !names.has(id)) names.set(id, String(row[name] ?? ''));
    }
  } catch (error) {
    // Supplementary only — a dotgg outage must not block the official sync.
    log.warn('dotgg name supplement unavailable', String(error));
  }
  return names;
}

// _pN = parallel print, _rN = reprint in a later product — both collapse to
// the base code (suffixes are region/source-unstable; codes are not).
const baseId = (id: string) => id.replace(/_[pr]\d+$/i, '');
const codePrefix = (id: string) => id.match(/^([A-Z]+\d*)-/i)?.[1]?.toUpperCase() ?? null;
const isAscii = (text: string) => /^[ -~]+$/.test(text);

const JP_COLORS: Record<string, string> = {
  赤: 'RED', 緑: 'GREEN', 青: 'BLUE', 紫: 'PURPLE', 黄: 'YELLOW', 黒: 'BLACK',
};

/**
 * Newest JP starter decks have no EN counterpart yet and Japanese-only pack
 * titles ("スタートデッキ 赤 モンキー・D・ルフィ【ST-31】"). Scrydex names
 * these decks "{COLOR} {Leader}" ("PURPLE Monkey.D.Luffy"), and both parts
 * are derivable: the color word from the JP title, the leader from the
 * deck's Leader card's English name. Only applied when the result is fully
 * ASCII — otherwise the JP title stays until translations exist.
 */
function deriveStarterDeckName(jpTitle: string, leaderName: string | null): string | null {
  const colorToken = jpTitle.match(/スタートデッキ\s+([赤緑青紫黄黒]+)\s/)?.[1];
  if (!colorToken || !leaderName || !isAscii(leaderName)) return null;
  const colors = [...colorToken].map((ch) => JP_COLORS[ch]).filter(Boolean);
  if (colors.length === 0) return null;
  return `${colors.join('/')} ${leaderName}`;
}

export async function syncOptcgJp(): Promise<{ expansions: number; cards: number }> {
  const work = mkdtempSync(join(tmpdir(), 'punk-records-'));
  try {
    log.info('downloading punk-records tarball');
    const tarball = join(work, 'repo.tar.gz');
    const response = await fetch(TARBALL_URL, { signal: AbortSignal.timeout(300_000) });
    if (!response.ok) throw new Error(`punk-records tarball HTTP ${response.status}`);
    const bytes = Buffer.from(await response.arrayBuffer());
    writeFileSync(tarball, bytes);
    execFileSync('tar', ['-xzf', tarball, '-C', work]);
    const root = join(work, readdirSync(work).find((name) => name.startsWith('punk-records')) ?? '');

    const jpCards = readCards(root, 'japanese');
    const asiaCards = readCards(root, 'english-asia');
    const asiaPackTitles = readPackTitles(root, 'english-asia');
    const jpPackTitles = readPackTitles(root, 'japanese');
    const dotggNames = await fetchDotggNames();
    log.info(`punk-records: ${jpCards.size} JP cards, ${asiaCards.size} asia-EN cards; dotgg names: ${dotggNames.size}`);

    // Collapse parallels to base ids.
    const byBase = new Map<string, PunkCard>();
    for (const card of jpCards.values()) {
      const id = baseId(card.id);
      if (!byBase.has(id) || card.id === id) byBase.set(id, { ...card, id });
    }
    const asiaByBase = new Map<string, PunkCard>();
    for (const card of asiaCards.values()) {
      const id = baseId(card.id);
      if (!asiaByBase.has(id) || card.id === id) asiaByBase.set(id, { ...card, id });
    }

    // Group by code prefix -> one ja expansion each, named like its EN twin.
    const groups = new Map<string, PunkCard[]>();
    for (const card of byBase.values()) {
      const prefix = codePrefix(card.id);
      if (!prefix) {
        log.warn(`unrecognized card id shape, skipping: ${card.id}`);
        continue;
      }
      (groups.get(prefix) ?? groups.set(prefix, []).get(prefix)!).push(card);
    }

    const enExpansions = await prisma.expansion.findMany({
      where: { game: 'one-piece', languageCode: { not: 'ja' } },
      select: { id: true, name: true, code: true, series: true, releaseDate: true },
    });
    const enByCode = new Map(
      enExpansions
        .filter((expansion) => expansion.code)
        .map((expansion) => [expansion.code!.toUpperCase().replace(/[^A-Z0-9]/g, ''), expansion]),
    );

    let cardCount = 0;
    for (const [prefix, cards] of groups) {
      const enTwin = enByCode.get(prefix) ?? (prefix === 'P' ? enExpansions.find((e) => e.name === 'Promos') : undefined);
      const samplePack = cards.find((card) => card.pack_id)?.pack_id ?? '';
      let name =
        enTwin?.name ?? asiaPackTitles.get(samplePack) ?? jpPackTitles.get(samplePack) ?? `One Piece ${prefix} (JP)`;
      if (!isAscii(name)) {
        const leader = cards.find((card) => card.category === 'Leader');
        const leaderName = leader
          ? (asiaByBase.get(leader.id)?.name ?? dotggNames.get(leader.id) ?? leader.name)
          : null;
        name = deriveStarterDeckName(name, leaderName) ?? name;
      }
      const expansion = await prisma.expansion.upsert({
        where: { game_sourceId: { game: 'one-piece', sourceId: `optcgjp-${prefix.toLowerCase()}` } },
        create: {
          game: 'one-piece',
          sourceId: `optcgjp-${prefix.toLowerCase()}`,
          name,
          code: prefix,
          series: enTwin?.series ?? null,
          language: 'Japanese',
          languageCode: 'ja',
          totalCardCount: cards.length,
          numberedCardCount: cards.length,
          releaseDate: enTwin?.releaseDate ?? null,
        },
        update: {
          name,
          code: prefix,
          series: enTwin?.series ?? null,
          totalCardCount: cards.length,
          numberedCardCount: cards.length,
          releaseDate: enTwin?.releaseDate ?? null,
        },
      });

      const setSlug = slugify(name);
      for (const card of cards) {
        const cardNumber = card.id.slice(prefix.length + 1); // "OP01-024" -> "024"
        const englishName = asiaByBase.get(card.id)?.name ?? dotggNames.get(card.id) ?? card.name;
        await upsertCard('one-piece', `optcgjp-${card.id}`, {
          name: englishName,
          setName: name,
          setCode: prefix,
          setSlug,
          cardNumber,
          language: 'ja',
          imageUrl: card.img_full_url ?? null,
          expansionId: expansion.id,
          rarity: card.rarity ?? null,
          slug: cardSlug(englishName, cardNumber),
          payload: {
            source: 'optcg-jp',
            nameJa: card.name,
            category: card.category ?? null,
            packId: card.pack_id ?? null,
          } as Prisma.InputJsonValue,
        });
        cardCount++;
      }
      await prisma.expansion.update({
        where: { id: expansion.id },
        data: { cardsSyncedAt: new Date(), syncedCardCount: cards.length },
      });
      log.info(`one-piece/optcgjp-${prefix.toLowerCase()} "${name}": ${cards.length} cards`);
    }
    return { expansions: groups.size, cards: cardCount };
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}
