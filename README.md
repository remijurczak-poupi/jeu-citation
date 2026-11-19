# Name the Players

Football quiz: name as many footballers as you can for a theme (league, club, seasons).
Solo modes, a daily challenge, leaderboards, and private rooms to play Bomb and Duel with friends.
English by default, French available.

## Stack

- **Front**: React + Vite (`src/`), no UI framework.
- **API**: Cloudflare Worker with Hono (`worker/`).
- **Database**: Cloudflare D1 (SQLite): profiles, games, scores, citation counts (`migrations/`).
- **Rooms**: one Durable Object per room code acts as referee (`worker/room.ts`).
- **Data**: built from Wikidata (CC0) by `scripts/build-data.mjs` into `src/data/football.json`, bundled with the Worker.

## Data

`npm run data` queries Wikidata and rebuilds `src/data/football.json` (raw answers are cached in `.cache/`, add `--refresh` to refetch).

- Players: everyone with at least one season since 2000-01 at a club that was then in the Premier League, Ligue 1, La Liga, Serie A or Bundesliga.
- League membership is **per season**: a club counts for a league only in the seasons it played in it (Wikidata league season items, property P1923). Seasons missing or wrong in Wikidata are filled by hand in `scripts/season-overrides.json`. The build warns if a season does not have 18 or 20 clubs.
- The ongoing season uses each league's current members on Wikidata.
- A season is named by its start year: 2007 = 2007-08.

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
| Daily | Same theme for everyone, 5 minutes, one ranked attempt per profile. Alternates easy and hard days |

The server owns the clock and validates every answer, so scores can't be forged from the browser. A profile can start 80 games per hour.

Daily challenge leaderboards: number of players named, and **rarity points** (1 to 3 per player depending on how few of the day's participants named them; everyone counts 1 until 10 games exist). Past challenges can be replayed, unranked.

**Bomb** (2 to 10 players): the holder must name a valid player to pass the bomb to the next player. A hidden fuse (15 to 45 s) explodes in someone's hands: they lose one of their 2 lives. Last one standing wins.

**Duel** (2 players): the ball starts at the centre and rolls towards a player (20 s to reach them). Naming a valid player sends it back from where it is, a bit faster each time. The one it reaches loses.

## Profiles

No account: a nickname, a supported club and a country, tied to the device. The device secret is shown once as a recovery code to restore the profile on another device.

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
