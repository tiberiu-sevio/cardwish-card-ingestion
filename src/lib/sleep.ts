export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Sleep for `baseMs` plus up to 40% random jitter, to avoid a mechanical request cadence. */
export function sleepWithJitter(baseMs: number): Promise<void> {
  return sleep(baseMs + Math.floor(Math.random() * baseMs * 0.4));
}
