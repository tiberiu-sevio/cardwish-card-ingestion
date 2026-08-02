import { existsSync } from 'node:fs';

if (existsSync('.env')) {
  process.loadEnvFile('.env');
}

function required(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

export const env = {
  databaseUrl: required('DATABASE_URL'),
  scrydexApiKey: required('SCRYDEX_API_KEY'),
  scrydexTeamId: required('SCRYDEX_TEAM_ID'),
  scrydexGames: (process.env.SCRYDEX_GAMES ?? 'pokemon,lorcana,magicthegathering,gundam,onepiece,riftbound')
    .split(',')
    .map((game) => game.trim())
    .filter(Boolean),
  // Credit floor: syncs abort below this because Scrydex overage auto-bills.
  scrydexMinCredits: Number(process.env.SCRYDEX_MIN_CREDITS ?? 500),
  spacesEndpoint: required('SPACES_ENDPOINT'),
  spacesRegion: process.env.SPACES_REGION ?? 'fra1',
  spacesBucket: required('SPACES_BUCKET'),
  spacesAccessKey: required('SPACES_ACCESS_KEY'),
  spacesSecretKey: required('SPACES_SECRET_KEY'),
  imageConcurrency: Number(process.env.IMAGE_CONCURRENCY ?? 8),
};
