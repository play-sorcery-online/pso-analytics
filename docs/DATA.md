# The data

PSO turns every finished game into one row per player: their deck, their opening hand after mulligans, the cards they played and on which of their turns, the cards they drew, and who won. The rows live in BigQuery and are refreshed daily. The analytics API aggregates them on request; nothing in this repo sees the rows themselves.

## Which games count

- **Format**: constructed or limited, from the table's format.
- **Released data only.** On the 1st of each month data is released through the end of the previous month, and on the 15th through the 14th (00:00 UTC). Corrections can still change released numbers a little.
- **Results**: a reported result, or one PSO inferred from the life totals when nobody reported. Games with no result are left out.
- Every game type counts: ranked, casual, other queues and custom tables. The public pages have no game type switch.

## What the card rates mean

All of these count player-games: one player's side of one game.

| Rate | Counts a player-game when the card… |
| --- | --- |
| `inDeck` | was in the player's starting deck |
| `played` | was confirmed played onto the table from hand or pile |
| `inDeckUnplayed` | was in the deck and never confirmed played |
| `openingHand` | was in the hand kept after mulligans |
| `inHand` | reached the hand at any point after the mulligan, opening hand included |
| `notInHand` | was in the deck and a complete hand history shows it never reached the hand |

"In hand vs. not in hand" in the dashboard is `inHand.winRate − notInHand.winRate`, in percentage points.

## Where it gets fuzzy

Replays record what players did on a shared table, not a rules engine's log, so some moves are ambiguous:

- **Uncertain plays.** A card moved to the table and straight back, or dragged around in ways that may not be a cast, is marked uncertain and kept out of both `played` and `inDeckUnplayed`.
- **Missing replays.** Some older games have a deck and a result but no replay. They count in `inDeck` and Meta, not in the play or hand rates.
- **Incomplete hand history** (for example a replay that started late) leaves a player-game out of both `inHand` and `notInHand`.
- **Turn numbers** come from the table's turn button. When players forget it, a play's turn is unknown and it cannot match a "by turn N" query.
- **Avatars** are matched by name across printings. Any lineup that includes Imposter counts only as Imposter.
- **Spellbook colors** are the elements of the positive thresholds of the starting spellbook. Sites, Avatars and sideboards don't add colors; one splash card does.

## Sample minimums

Card rates need 20 player-games across 10 matches, and are `null` below that. Query (cohort) answers use the same minimum and are `null` below it, except an empty answer, which stays 0. Meta has no minimum, so small samples show up there; the UI says so. A win rate on 30 games swings by about ±18 points by chance alone.
