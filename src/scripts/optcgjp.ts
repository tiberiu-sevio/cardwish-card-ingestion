import { prisma } from '../lib/prisma';
import { syncOptcgJp } from '../optcgjp/sync';

/** Standalone Japanese One Piece sync (also runs inside `sync onepiece`). */
async function main() {
  const result = await syncOptcgJp();
  console.log(`optcg-jp: ${result.expansions} expansions, ${result.cards} cards`);
  await prisma.$disconnect();
}

main().catch((error) => {
  console.error('optcg-jp sync failed', error);
  process.exit(1);
});
