# Name the Players

Football quiz: name as many footballers as you can for a theme (league, club, seasons).
Solo modes, a daily challenge, leaderboards, and private rooms to play Bomb and Duel with friends.
English by default, also in French, German, Spanish, Italian and Portuguese.

## Stack

- **Front**: React + Vite (`src/`), no UI framework.
- **API**: Cloudflare Worker with Hono (`worker/`).
- **Database**: Cloudflare D1 (SQLite): profiles, games, scores, citation counts (`migrations/`).
- **Rooms**: one Durable Object per room code acts as referee (`worker/room.ts`).
- **Data**: built from Wikidata (CC0) and English Wikipedia (CC BY-SA 4.0, credited in the footer) by `scripts/build-wiki.mjs` and `scripts/build-data.mjs` into `src/data/football.json`, bundled with the Worker.

## Data

Two steps:

1. `NODE_USE_ENV_PROXY=1 node scripts/build-wiki.mjs` reads English Wikipedia into `scripts/wiki-data.json` (committed): squads of every World Cup since 1998, Euro since 2000 and Copa América since 2001, Champions League clubs per season since 2000-01, Ballon d'Or rankings and league top scorers. The Wikipedia API rate-limits hard, so requests are throttled and cached in `.cache/wiki/`.
2. `npm run data` queries Wikidata and rebuilds `src/data/football.json` (raw answers are cached in `.cache/`, add `--refresh` to refetch).

- Players: everyone with at least one season since 2000-01 at a club that was then in the Premier League, Ligue 1, La Liga, Serie A or Bundesliga.
- League membership is **per season**: a club counts for a league only in the seasons it played in it (Wikidata league season items, property P1923). Seasons missing or wrong in Wikidata are filled by hand in `scripts/season-overrides.json`. The build warns if a season does not have 18 or 20 clubs.
- The ongoing season uses each league's current members on Wikidata.
- A season is named by its start year: 2007 = 2007-08.
- Since 2020 Wikidata lists some seasons with "men's team" items instead of clubs: they are mapped to their parent club (P361).
- Player attributes: positions, nationalities (national team played for, else sporting nationality, else citizenship; England/Scotland/Wales/Northern Ireland are separate), caps, height, birth date, still active.
- Trophies: league and Champions League winners up to 2024-25 are in `scripts/titles.json` (Wikidata is patchy there), later seasons come from Wikidata. Tournament winners are hardcoded in `build-wiki.mjs` except the 2026 World Cup (Wikidata). Bundesliga top scorers are hardcoded too.
- "Played the Champions League" means being at a top-5 club during a season it was in the group stage or league phase: a squad approximation, not minutes played.

## Theme filters

League, club, seasons, plus: position, nationality, international, age, height, still active, tournament played or won (World Cup, Euro, Copa América), Champions League played or won, league champion, league top scorer, ranked in the Ballon d'Or, and "also played for" a second club.

## Answer matching (`worker/data.ts`, `worker/normalize.ts`)

No autocomplete: the player has to remember the name. Matching is tolerant:

- case, accents, punctuation and spaces are ignored (`Ozil` = `Özil`, `vanpersie` = `van Persie`);
- full names, Wikidata aliases and labels in 7 languages are accepted, so are surnames alone (`Henry`), with particles (`De Bruyne`);
- typos: 1 to 2 edits depending on length (stricter in Hardcore);
- homonyms: the most famous player not yet named is credited, so `Neville` twice gives Gary then Phil;
- a real player outside the theme gets a specific message ("not in this theme").

## Game rules

| Mode | Rule |
| --- | --- |
| 1 / 3 / 10 minutes | Name as many as possible before the clock runs out |
| Unlimited | No clock; ends after 10 minutes without an answer |
| Hardcore | One mistake or repeat ends the game; 60 s per answer |
| Streak | 15 s on the clock, each right answer resets it |
| Chain | Starts from a well-known player of the theme: each answer must be a teammate of the previous one (same club, overlapping seasons, within the theme). 30 s per link |
| Daily | Same theme for everyone, 5 minutes, one ranked attempt per profile. Alternates easy and hard days |

The server owns the clock and validates every answer, so scores can't be forged from the browser. A profile can start 80 games per hour.

Daily challenge leaderboards: number of players named, and **rarity points** (1 to 3 per player depending on how few of the day's participants named them; everyone counts 1 until 10 games exist). Past challenges can be replayed, unranked.

**Bomb** (2 to 10 players): the holder must name a valid player to pass the bomb to the next player. A hidden fuse (15 to 45 s) explodes in someone's hands: they lose one of their 2 lives. Last one standing wins.

**Duel** (2 players): the ball starts at the centre and rolls towards a player (20 s to reach them). Naming a valid player sends it back from where it is, a bit faster each time. The one it reaches loses.

**Chain** (2 to 10 players): in turn, name a teammate of the last player of the chain within 20 s, or lose one of 2 lives. If every teammate has been named, a new chain starts.

**Battle royale** (2 to 20 players): everyone answers at once, each player can be named only once in the room. Rounds last 30 s, then 2 s less each round (15 s minimum). At the end of a round, whoever named the fewest players is out (ties go out together, unless everyone is tied). Last one standing wins.

**Clubs & countries war**: each profile's daily challenge results (players named) add up for their club and their country, by week (Monday to Sunday, Paris time) or all time. Only the daily challenge counts, so playing more games doesn't help.

## Profiles

No account: a nickname, a supported club and a country, tied to the device. The device secret is shown once as a recovery code to restore the profile on another device.

## Search engines (`worker/seo.ts`)

The Worker renders the pages Google indexes, in 6 languages (English at `/`, others under `/fr/`, `/de/`, `/es/`, `/it/`, `/pt/`):

- `/` home, `/quiz` all clubs, `/quiz/<club>` every player of a club since 2000,
- `/quiz/<club-a>/<club-b>` players who played for both clubs (slugs in alphabetical order, the other order redirects; only pairs with 15+ players, the smallest theme a game accepts),
- `/league/<league>` and `/league/<league>/<season>` (e.g. `/league/serie-a/2005-06`).

Each page is the normal app plus a server-rendered section below it (title, description, canonical, hreflang, Open Graph, breadcrumb JSON-LD, facts, links to related quizzes). "Play this quiz" opens the solo setup with the theme preset (`#/solo?c=…`). `/robots.txt`, `/sitemap.xml` (index) and `/sitemap-<lang>.xml` are generated from the data. API responses are `noindex`.

Once the domain is chosen, set `CANONICAL_ORIGIN` in `wrangler.jsonc`: other hosts (workers.dev, previews) then answer `noindex` and point their canonical URLs to the real domain. The brand in page titles is `BRAND` in `worker/seo.ts`.

## Develop

```bash
npm install
npm run db:migrate:local
npm run dev          # http://localhost:5173 (front + Worker + D1 + Durable Objects locally)
npm test
```

## Deploy (Cloudflare)

```bash
npx wrangler login
npx wrangler d1 create name-the-players   # copy the database_id into wrangler.jsonc
npm run db:migrate:remote
npm run deploy
```

The Workers Paid plan ($5/month) is recommended for launch: the free plan's 10 ms CPU limit per request is too tight for name matching on large themes.
