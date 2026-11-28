# PSO analytics

The analytics pages of [Play Sorcery Online](https://playsorceryonline.com) (PSO), open for anyone to improve. This repo holds:

- **`packages/ui`**, the React dashboard behind [playsorceryonline.com/game-analytics](https://playsorceryonline.com/game-analytics): Cards, Query data, Meta and Site openings. PSO ships the latest `main` of this folder into the site.
- **`packages/replay`**, a small reader for PSO replays: play a replay forward, find what was on each realm square, list the cards each player played, snapshot each turn.
- **`apps/dev`**, a local site that runs the dashboard on sample data, or on live PSO data through your own API key.
- **`docs/`**, the API, the data behind it, the replay format, and how to propose a new stat.

The numbers themselves are computed on PSO's servers. You can change how they are shown here, and you can prototype a new stat and propose it; the PSO team adds the server side (new aggregations, indexes, storage) in the main PSO repo. See [docs/WRITING_A_STAT.md](docs/WRITING_A_STAT.md).

## Start

You need Node 22 or newer.

```sh
npm install
npm run dev        # http://localhost:5180 on sample data
```

The sample data comes from PSO's real aggregation code run over made-up games, so the pages look right but the numbers mean nothing, and changing filters does not change them.

### Live data

1. Sign in to PSO with Discord, open [playsorceryonline.com/analytics-developers](https://playsorceryonline.com/analytics-developers) and make an API key. It is shown once.
2. Copy `.env.example` to `.env.local` and paste the key after `PSO_API_KEY=`.
3. `npm run dev` again. The banner says "Live PSO data": every tab shows live numbers over all games together. The dev server adds your key to requests on the way to PSO, so it never reaches the browser.

### Replays

The API has no replay downloads or match history (PSO publishes a weekly file of anonymized sample replays instead; see the API docs page). `fixtures/replays/replay_example.json` is a small made-up replay for trying `packages/replay`:

```sh
npm run example                     # the sample stat over fixtures/replays
```

## Checks

```sh
npm run check      # typecheck, tests, build: the same as CI
```

## Contributing

Fork the repo, work on a branch in your fork, and open a pull request against `main`. The PSO team reviews and merges. Details in [CONTRIBUTING.md](CONTRIBUTING.md).

## Limits

The API's limits, key rules and every endpoint are on [playsorceryonline.com/analytics-developers](https://playsorceryonline.com/analytics-developers). `GET /api/v1/usage` shows where you are today.
