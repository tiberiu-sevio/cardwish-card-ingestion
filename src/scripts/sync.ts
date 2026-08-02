import { env } from '../lib/env';
import { createLogger } from '../lib/logger';
import { prisma } from '../lib/prisma';
import { createRun, finishRun, incrementRun } from '../lib/runs';
import { assertCreditsAvailable, getUsage, requestsMade } from '../scrydex/client';
import { GAME_SLUGS } from '../scrydex/types';
import { syncExpansionCards, expansionsNeedingCards } from '../sync/cards';
import { syncExpansions } from '../sync/expansions';
import { mirrorMissingCardImages } from '../sync/images';
import { mirrorYugiohImages, syncYugioh } from '../ygoprodeck/sync';

const log = createLogger('sync');

const VALID_GAMES = [...Object.keys(GAME_SLUGS), 'yugioh'];

/** DB game slug for a configured game name. */
function dbGame(game: string): string {
  return game === 'yugioh' ? 'yugioh' : (GAME_SLUGS[game] ?? game);
}

function mirrorImagesFor(game: string) {
  return game === 'yugioh' ? mirrorYugiohImages() : mirrorMissingCardImages(dbGame(game));
}

/**
 * CLI:
 *   tsx src/scripts/sync.ts sync [game]    expansions + cards for new/changed expansions
 *   tsx src/scripts/sync.ts images [game]  mirror missing card images to the CDN
 *   tsx src/scripts/sync.ts all [game]     sync then images (what the daily timer runs)
 *   tsx src/scripts/sync.ts usage          print Scrydex credit usage
 *
 * `game` is a Scrydex slug (pokemon, lorcana, magic, gundam, onepiece,
 * riftbound); omitted = every configured game. The same code path serves the
 * first full backfill and the daily delta: an expansion's cards re-sync only
 * while it is new or its card total disagrees with what we have.
 */
async function syncGames(games: string[]): Promise<void> {
  for (const game of games) {
    // Yu-Gi-Oh comes from YGOPRODeck (free, no credits); everything else is
    // Scrydex, re-checked between games because overage bills silently.
    const source = game === 'yugioh' ? 'ygoprodeck' : 'scrydex';
    if (source === 'scrydex') await assertCreditsAvailable();
    const runId = await createRun(source, `${game}_sync`);
    try {
      if (source === 'ygoprodeck') {
        const result = await syncYugioh();
        await incrementRun(runId, 'itemsSeen', result.expansions);
        await incrementRun(runId, 'itemsUpdated', result.prints);
      } else {
        const expansionCount = await syncExpansions(game);
        await incrementRun(runId, 'itemsSeen', expansionCount);

        const pending = await expansionsNeedingCards(dbGame(game));
        log.info(`${game}: ${pending.length}/${expansionCount} expansions need card sync`);
        for (const expansion of pending) {
          const cards = await syncExpansionCards(game, expansion);
          await incrementRun(runId, 'itemsUpdated', cards);
        }
      }
      await finishRun(runId, 'success');
    } catch (error) {
      await finishRun(runId, 'failed', String(error));
      throw error;
    }
  }
  log.info(`Scrydex API requests this run: ${requestsMade()}`);
}

async function main() {
  const command = process.argv[2];
  const gameArg = process.argv[3];
  if (gameArg && !VALID_GAMES.includes(gameArg)) {
    throw new Error(`Unknown game "${gameArg}". Valid: ${VALID_GAMES.join(', ')}`);
  }
  const games = gameArg ? [gameArg] : env.syncGames;

  if (command === 'sync') {
    await syncGames(games);
  } else if (command === 'images') {
    for (const game of games) {
      await mirrorImagesFor(game);
    }
  } else if (command === 'all') {
    // Per game: sync then images, so one slow game's card sync doesn't hold
    // every other game's images hostage.
    for (const game of games) {
      await syncGames([game]);
      await mirrorImagesFor(game);
    }
  } else if (command === 'usage') {
    console.log(await getUsage());
  } else {
    console.error('Usage: sync.ts <sync|images|all|usage> [game]');
    process.exitCode = 1;
  }
  await prisma.$disconnect();
}

main().catch((error) => {
  log.error('sync failed', String(error));
  process.exit(1);
});
