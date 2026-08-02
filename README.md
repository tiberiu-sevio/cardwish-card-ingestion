# cardwish-card-ingestion

Canonical card & expansion catalog for Cardwish, with card images mirrored
to our own CDN (DO Spaces today; S3-compatible and swappable). Two sources:

- [Scrydex API](https://scrydex.com/docs) — Pokémon, Lorcana, Magic, Gundam,
  One Piece, Riftbound (credit-metered; `X-Api-Key` + `X-Team-ID`)
- [YGOPRODeck API](https://ygoprodeck.com/api-guide/) — Yu-Gi-Oh (free, no
  auth; cards stored one row per print, artwork-deduplicated image mirroring)

Everything stored is English — non-English prints keep only their language
code as metadata.

## How it works

- `sync` upserts every **expansion** per game, then syncs **cards** only for
  expansions that are new or whose card `total` no longer matches what we
  have. The same code path is the initial backfill and the daily delta.
- `images` mirrors missing card fronts (small + large) to the CDN bucket.
  **The database stores object keys only** (e.g. `cards/pokemon/sv1/sv1-25-large.png`),
  never absolute URLs — the public base URL will move behind our own CNAME.
- A systemd timer runs `all` (sync + images) daily at 05:00 UTC on the
  ingestion droplet.
- Credit guard: Scrydex bills overage automatically, so syncs abort when
  `remaining_credits` drops below `SCRYDEX_MIN_CREDITS`.

## Commands

```bash
npm run sync              # expansions + new/changed cards, all games
npm run all -- pokemon    # sync + images for one game
npm run images            # mirror missing images
npm run usage             # Scrydex credit usage
npm run status            # catalog counts, runs, credits
```

## Database schema ownership — IMPORTANT

This service writes to the shared Cardwish Postgres, but the **migration
history is owned by the `cardwish-crawler` repo**. `prisma/schema.prisma`
here is a mirror used only for `prisma generate`. Never run `prisma migrate`
from this repo — add schema changes as a migration in cardwish-crawler,
apply them there, then copy the model changes into the mirror schema.

## Deploy

Droplet: `161.35.223.39` (`/opt/cardwish-card-ingestion`).

```bash
deploy/deploy.sh                 # rsync + npm ci + prisma generate
```

First-time setup: rsync the repo, run `deploy/setup-droplet.sh`, create
`/opt/cardwish-card-ingestion/.env` (see `.env.example`).
