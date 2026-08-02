import { env } from '../lib/env';
import { createLogger } from '../lib/logger';
import { prisma } from '../lib/prisma';
import { createRun, finishRun, incrementRun } from '../lib/runs';
import { assertCreditsAvailable, getUsage, requestsMade } from '../scrydex/client';
import { GAME_SLUGS } from '../scrydex/types';
import { syncExpansionCards, expansionsNeedingCards } from '../sync/cards';
import { syncExpansions } from '../sync/expansions';
import { mirrorMissingCardImages } from '../sync/images';

const log = createLogger('sync');

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
  await assertCreditsAvailable();
  for (const scrydexGame of games) {
    const runId = await createRun('scrydex', `${scrydexGame}_sync`);
    try {
      const expansionCount = await syncExpansions(scrydexGame);
      await incrementRun(runId, 'itemsSeen', expansionCount);

      const pending = await expansionsNeedingCards(GAME_SLUGS[scrydexGame] ?? scrydexGame);
      log.info(`${scrydexGame}: ${pending.length}/${expansionCount} expansions need card sync`);
      for (const expansion of pending) {
        const cards = await syncExpansionCards(scrydexGame, expansion);
        await incrementRun(runId, 'itemsUpdated', cards);
      }
      await finishRun(runId, 'success');
    } catch (error) {
      await finishRun(runId, 'failed', String(error));
      throw error;
    }
  }
  log.info(`API requests this run: ${requestsMade()}`);
}

async function main() {
  const command = process.argv[2];
  const gameArg = process.argv[3];
  if (gameArg && !(gameArg in GAME_SLUGS)) {
    throw new Error(`Unknown game "${gameArg}". Valid: ${Object.keys(GAME_SLUGS).join(', ')}`);
  }
  const games = gameArg ? [gameArg] : env.scrydexGames;

  if (command === 'sync') {
    await syncGames(games);
  } else if (command === 'images') {
    await mirrorMissingCardImages(gameArg ? GAME_SLUGS[gameArg] : undefined);
  } else if (command === 'all') {
    await syncGames(games);
    for (const game of games) {
      await mirrorMissingCardImages(GAME_SLUGS[game] ?? game);
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
