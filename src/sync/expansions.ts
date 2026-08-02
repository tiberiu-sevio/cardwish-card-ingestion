import { extensionFromUrl, mirrorImage } from '../cdn/spaces';
import { createLogger } from '../lib/logger';
import { prisma } from '../lib/prisma';
import { pagedItems } from '../scrydex/client';
import { GAME_SLUGS, type ScrydexExpansion } from '../scrydex/types';

const log = createLogger('sync:expansions');

function parseReleaseDate(value: string | null | undefined): Date | null {
  if (!value) return null;
  const match = value.match(/^(\d{4})\/(\d{2})\/(\d{2})$/);
  return match ? new Date(`${match[1]}-${match[2]}-${match[3]}T00:00:00Z`) : null;
}

/**
 * Upsert every expansion of one Scrydex game. Logo/symbol art is mirrored to
 * the CDN inline (the source URLs only exist in this response, and the volume
 * is a few hundred small images across all games). Returns expansion count.
 */
export async function syncExpansions(scrydexGame: string): Promise<number> {
  const game = GAME_SLUGS[scrydexGame] ?? scrydexGame;
  let count = 0;

  for await (const expansion of pagedItems<ScrydexExpansion>(`/${scrydexGame}/v1/expansions`)) {
    const data = {
      // Canonical names are English: Japanese (and other non-EN) expansions
      // carry their English rendering in translation.en. The printed-language
      // original stays reachable via sourceId; language columns record it.
      name: expansion.translation?.en?.name ?? expansion.name,
      code: expansion.code ?? null,
      series: expansion.series ?? null,
      total: expansion.total ?? null,
      printedTotal: expansion.printed_total ?? null,
      language: expansion.language ?? null,
      languageCode: expansion.language_code?.toLowerCase() ?? null,
      releaseDate: parseReleaseDate(expansion.release_date),
      isOnlineOnly: expansion.is_online_only ?? false,
    };
    const row = await prisma.expansion.upsert({
      where: { game_sourceId: { game, sourceId: expansion.id } },
      create: { game, sourceId: expansion.id, ...data },
      update: data,
    });
    count++;

    for (const [field, sourceUrl] of [
      ['logoKey', expansion.logo],
      ['symbolKey', expansion.symbol],
    ] as const) {
      if (!sourceUrl || row[field]) continue;
      const kind = field === 'logoKey' ? 'logo' : 'symbol';
      const key = `expansions/${game}/${expansion.id}-${kind}.${extensionFromUrl(sourceUrl)}`;
      try {
        await mirrorImage(sourceUrl, key);
        await prisma.expansion.update({ where: { id: row.id }, data: { [field]: key } });
      } catch (error) {
        // Non-fatal: retried on the next sync because the key stays null.
        log.warn(`${kind} mirror failed for ${game}/${expansion.id}`, String(error));
      }
    }
  }

  log.info(`${game}: ${count} expansions upserted`);
  return count;
}
