import { prisma } from '../lib/prisma';
import { syncToppsPokemon } from '../topps/sync';

/** Standalone Topps Pokemon sync (also runs inside `sync pokemon`). */
async function main() {
  const result = await syncToppsPokemon();
  console.log(`topps: ${result.expansions} expansions, ${result.cards} cards`);
  await prisma.$disconnect();
}

main().catch((error) => {
  console.error('topps sync failed', error);
  process.exit(1);
});
