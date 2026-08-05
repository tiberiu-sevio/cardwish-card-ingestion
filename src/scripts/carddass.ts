import { syncCarddass } from '../carddass/sync';
import { prisma } from '../lib/prisma';

/** Standalone Carddass sync (also runs inside `sync onepiece`). */
async function main() {
  const result = await syncCarddass();
  console.log(`carddass: ${result.expansions} expansions, ${result.cards} cards`);
  await prisma.$disconnect();
}

main().catch((error) => {
  console.error('carddass sync failed', error);
  process.exit(1);
});
