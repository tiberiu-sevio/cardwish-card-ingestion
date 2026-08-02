import { prisma } from './prisma';

export async function createRun(marketplace: string, jobType: string): Promise<string> {
  const run = await prisma.ingestionRun.create({
    data: { marketplace, jobType, startedAt: new Date(), status: 'running' },
  });
  return run.id;
}

export async function finishRun(runId: string, status: 'success' | 'failed' | 'partial', errorMessage?: string) {
  await prisma.ingestionRun.update({
    where: { id: runId },
    data: { finishedAt: new Date(), status, errorMessage: errorMessage ?? null },
  });
}

export type RunCounter = 'itemsSeen' | 'itemsCreated' | 'itemsUpdated' | 'itemsFailed';

export async function incrementRun(runId: string, counter: RunCounter, by = 1) {
  await prisma.ingestionRun.update({
    where: { id: runId },
    data: { [counter]: { increment: by } },
  });
}
