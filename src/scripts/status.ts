import { createLogger } from '../lib/logger';
import { prisma } from '../lib/prisma';
import { getUsage } from '../scrydex/client';

const log = createLogger('status');

async function main() {
  const perGame: {
    game: string;
    expansions: bigint;
    synced_expansions: bigint;
    cards: bigint;
    with_large_image: bigint;
  }[] = await prisma.$queryRawUnsafe(`
    SELECT e.game,
           count(DISTINCT e.id) AS expansions,
           count(DISTINCT e.id) FILTER (WHERE e.cards_synced_at IS NOT NULL) AS synced_expansions,
           count(c.id) AS cards,
           count(c.id) FILTER (WHERE c.image_large_key IS NOT NULL AND c.image_large_key <> '') AS with_large_image
    FROM expansions e LEFT JOIN cards c ON c.expansion_id = e.id
    GROUP BY e.game ORDER BY e.game`);

  console.log('catalog by game:');
  for (const row of perGame) {
    console.log(
      `  ${row.game.padEnd(10)} expansions ${row.synced_expansions}/${row.expansions} synced` +
        ` | cards ${row.cards} | large image ${row.with_large_image}`,
    );
  }

  const runs = await prisma.ingestionRun.findMany({
    where: { marketplace: 'scrydex' },
    orderBy: { startedAt: 'desc' },
    take: 8,
  });
  console.log('\nlast scrydex runs:');
  for (const run of runs) {
    console.log(
      `  ${run.startedAt.toISOString()} ${run.jobType} ${run.status}` +
        ` expansions=${run.itemsSeen} cards=${run.itemsUpdated}`,
    );
  }

  try {
    const usage = await getUsage();
    console.log(`\nscrydex credits: ${usage.credits_remaining ?? '?'} remaining (consumed ${usage.total_credits_consumed ?? '?'})`);
  } catch (error) {
    console.log(`\nscrydex usage unavailable: ${String(error)}`);
  }

  await prisma.$disconnect();
}

main().catch((error) => {
  log.error('status failed', String(error));
  process.exit(1);
});
