# API

The dashboard reads PSO's public analytics API. The full reference, with every endpoint, its limits and sample answers, is on [playsorceryonline.com/analytics-developers](https://playsorceryonline.com/analytics-developers); this page covers what the dashboard uses.

Everything is counted over all PSO games together. There is no match history, no player lookup, no replay download, and no ranked-only filter.

Base URL: `https://playsorceryonline.com/api/v1`. Send your key in the `x-pso-api-key` header, from a server, a script or the dev proxy, never from code that runs in a browser.

```sh
curl -H "x-pso-api-key: $PSO_API_KEY" \
  "https://playsorceryonline.com/api/v1/analytics/meta?format=constructed"
```

`GET /status` (no key) says whether the API is open and what is released; `GET /usage` shows your requests today and your limits. A `429` names the limit it hit and sets `Retry-After`. Analytics change only on release days (the 1st and 15th), so keep answers until `releasedThrough` changes, and use `ETag` / `If-None-Match`.

## How the dashboard maps to the API

The dashboard calls routes relative to its `endpoint` prop. The dev site serves them at `/api/analytics` and proxies them like this:

| Dashboard route | Public API |
| --- | --- |
| `GET /cards` | `GET /api/v1/analytics/cards` |
| `GET /meta` | `GET /api/v1/analytics/meta` |
| `GET /site-openings` | `GET /api/v1/analytics/site-openings` |
| `GET /query-options` | `GET /api/v1/analytics/query-options` |
| `POST /cohort` | `POST /api/v1/analytics/query` |
| `GET /cards/:cardKey/replays` | not served (the dev site answers an empty list) |

## Analytics

### Selection

Every GET takes these query parameters; `POST /analytics/query` takes them as `selection`.

| Parameter | Values |
| --- | --- |
| `format` | Required. `constructed` or `limited` |
| `from`, `through` | Optional inclusive UTC dates, `YYYY-MM-DD` |
| `limitedSource` | Limited only: `alpha_beta`, `arthurian_legends`, `gothic`, `dragonlord`, `frogimago_cube`, `mixed` |
| `avatar` | Optional. Only player-games with this Avatar (card table and site openings) |

Data is released twice a month, so the newest games are never included; `releasedThrough` in each response says how far it goes. `queueType` is not accepted here (it gives a `400`).

### Routes

| Method | Route | Returns |
| --- | --- | --- |
| GET | `/analytics/cards` | `{ generatedAt, releasedThrough, dataAvailable, totalGames, totalPlayerGames, cards }` |
| GET | `/analytics/meta` | `{ generatedAt, releasedThrough, dataAvailable, totalGames, totalPlayerGames, avatars, combinations }` |
| GET | `/analytics/site-openings` | `{ …population, trackedPlayerGames, sites }`. Extra parameters: `elements` (`air,fire`, or `none` for colorless) and `turnOrder` (`first` or `second`) |
| GET | `/analytics/query-options` | `{ releasedThrough, dataAvailable, totalGames, options: [{ name, kind: 'card' \| 'avatar' }] }` |
| POST | `/analytics/query` | `{ generatedAt, releasedThrough, dataAvailable, cohort, unresolvedPlayerGames, unresolvedTurnPlayerGames }` |

`generatedAt` is Unix milliseconds. `dataAvailable: false` means the data source is not loaded, which is different from a loaded source with no matching games.

A **rate** is `{ playerGames, matches, wins, winRate }` with `winRate` from 0 to 1. One player-game is one player's side of one game, so a game between two players gives two player-games.

**Cards.** Each card has `cardKey`, `cardName`, `deckShare` (0–1) and the rates `inDeck`, `played`, `openingHand`, `inHand`, `notInHand` and `inDeckUnplayed`. A rate with fewer than 20 player-games or 10 matches comes back with `null` fields, and cards below that in their deck rate are left out. See [DATA.md](DATA.md) for what each one counts.

**Meta.** `avatars` and `combinations` are lists of `{ avatarKeys, colors, metaShare, rate }`. `colors` are spellbook elements in Air/Earth/Fire/Water order, `[]` for colorless, `null` when unknown; Avatar rows have `colors: null`. There is no sample minimum here.

**Site openings.** `sites[i]` is the player's (i+1)th site: `{ playerGames, squares: [{ forward, right, share, rate }] }`. Squares are relative to the player's Avatar start: `forward` counts rows toward the opponent, `right` columns to the player's right.

**Query.** POST a body like:

```json
{
  "selection": { "format": "constructed", "from": "2026-08-01" },
  "filter": {
    "kind": "group", "operator": "and",
    "children": [
      { "kind": "condition", "field": "avatar", "value": "Seer" },
      { "kind": "condition", "field": "played_card", "value": "Mudslide", "byPlayerTurn": 4 },
      { "kind": "condition", "field": "went_first", "value": true, "negate": true }
    ]
  }
}
```

Fields: `avatar`, `opponent_avatar`, `deck_card`, `opening_card`, `in_hand_card`, `not_in_hand_card`, `played_card` (names), `went_first` (boolean), `mulligan_count` (0–20), `mulliganed_card` (a card put back in the mulligan; unresolved on games analyzed before it existed). Any condition except `queue_type` can set `"side": "opponent"` to test the other player in the same game instead, so `opening_card` Toolbox AND `opening_card` Toolbox with `side: "opponent"` counts games where both players opened Toolbox (each such game counts as two player-games, one per side). Opponent conditions are unresolved when the other side was not recorded. An opening hand is known whether or not the player mulliganed; `mulligan_count: 0` counts kept hands. `byPlayerTurn` (1–100) is allowed on `played_card` and counts the player's own turns. Groups take `and` or `or` with 1–10 children, at most four levels deep and 25 nodes. `cohort` holds totals only, never single games: a non-empty answer under 20 player-games or 10 matches comes back with every field `null` (an empty answer stays 0). `unresolvedPlayerGames` counts player-games the filter could not decide from the replay evidence; they are not in the rate.
