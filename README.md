# cardwish-card-ingestion

Canonical card & expansion catalog for Cardwish, with card images mirrored
to our own CDN (DO Spaces today; S3-compatible and swappable). Five sources:

- [Scrydex API](https://scrydex.com/docs) — Pokémon, Lorcana, Magic, Gundam,
  One Piece, Riftbound (credit-metered; `X-Api-Key` + `X-Team-ID`)
- [YGOPRODeck API](https://ygoprodeck.com/api-guide/) — Yu-Gi-Oh (free, no
  auth; cards stored one row per print, artwork-deduplicated image mirroring)
- **Japanese One Piece** ([src/optcgjp/sync.ts](src/optcgjp/sync.ts)) —
  Scrydex is EN-only for One Piece, so the ja side syncs from the OFFICIAL
  Bandai cardlists via the [punk-records](https://github.com/buhbbl/punk-records)
  GitHub mirror (refreshed ~2x/week): all JP sets plus the full global
  P-### promo sequence. Cards group into `ja` expansions by code prefix,
  each named EXACTLY like its EN twin (the matcher's set dictionary then
  sees language pairs). English names join from the english-asia locale by
  card code, then dotgg for the JP-only residue. `_pN`/`_rN` suffixes
  collapse to base codes. Don!! cards deliberately absent (no official
  machine-readable list).
- **Curated Carddass One Piece** ([data/carddass-onepiece/](data/carddass-onepiece/)) —
  the 1999–2002 pre-TCG Bandai lines (Hyper Battle stages/Grand Boxes/
  Compilations/Treasure Packs/promos + Visual Adventure), two-source
  verified checklists, `series='Carddass'`. Carddass Masters and the
  2002–05 successor card game are deliberately absent (unverified /
  colliding numbering) and guarded against in the matcher.
- **Curated Topps Pokemon** ([data/topps-pokemon/](data/topps-pokemon/)) —
  the 1999–2004 licensed Topps sets (TV Animation S1–S3, First Movie,
  Movie 2000, Chrome S1–S2, Johto, Johto League Champions, Advanced,
  Advanced Challenge). No API carries them; checklists were cross-verified
  against public sources (TCDb, Bulbapedia, Cardboard Connection, nslists,
  PSA labels), verified-only — unverified chase subsets are deliberately
  absent. Stored under `game=pokemon` with `series='Topps'` (the matcher
  partitions candidates on that series). Synced by `src/topps/sync.ts`
  inside `sync pokemon`, or standalone: `npx tsx src/scripts/topps.ts`.

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

## Variant rows and variant tags

Cards are stored **one row per printing variant**: the base printing keeps
the source id and an unsuffixed slug; siblings live at
`{sourceId}#{variantName}` (`gym2-2#firstEditionHolofoil`) with the reduced
variant appended to the slug (`…-1st-edition`). Yu-Gi-Oh's variant dimension
is rarity: a set code printed in several rarities becomes one row per
rarity (`…#ultra-rare`).

During sync, each variant row is tagged with **atomic variant tags**
(`card_variant_tags`): the raw variant name decomposes via
[src/lib/variant-vocab.ts](src/lib/variant-vocab.ts) —
`firstEditionShadowlessHolofoil` → [1st Edition] + [Shadowless] +
[Holofoil]. That file is a **mirror of
`cardwish-crawler/src/matching/variant-vocab.ts`** (same convention as the
Prisma schema: edit there first, copy here). Base printings deliberately
carry no tags — absence of edition/finish tags *is* the base variant. The
matcher uses these tags to land listings on the exact variant row; full
spec in the crawler repo's `docs/matching.md`.

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
