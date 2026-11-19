# Adding to the notbot region

notbot shows an agent's work as a small monster-collecting RPG: a trainer and a
companion creature walk a top-down region, meet wild creatures in tall grass and
challenge arena leaders. The engine is finished. What the region needs is
**content**: more towns, routes, creatures and arenas.

Content is data. You add files; you never edit engine code or an index.

## The one hard rule: everything is original

This is our own world. Do **not** use names, creatures, characters, maps, town
layouts, music or designs from Pokémon or any other existing game, and do not
make lightly renamed copies of them. Invent the creature, its name and its look.
Creature names here lean on software ideas (Bugbyte, Cachemoth, Regexnake); keep
to that flavour.

## Where things go

```
src/renderer/game/content/
  types.ts            the contract (read this first)
  maps/<id>.ts        one town, route, cave or interior per file
  creatures/<id>.ts   one creature per file
  arenas/<id>.ts      one arena per file
  content.test.ts     the validator: your work is done when it passes
```

Each file `export default`s one object and its file name is its `id`. Files are
picked up automatically. Copy `maps/willowbrook.ts`, `maps/route-1.ts`,
`creatures/cindle.ts` and `arenas/scholar.ts` as starting points.

## Maps

A map is `rows`: strings of equal length, one character per 16-pixel tile.

| Char      | Tile                                    | Walkable |
| --------- | --------------------------------------- | -------- |
| `.`       | grass                                   | yes      |
| `:`       | tall grass, where wild creatures appear | yes      |
| `=`       | path                                    | yes      |
| `,`       | sand                                    | yes      |
| `f`       | flowers                                 | yes      |
| `b`       | bridge                                  | yes      |
| `_`       | cave floor                              | yes      |
| `D`       | house door                              | yes      |
| `a`       | arena door                              | yes      |
| `p`       | rest-house door                         | yes      |
| `#`       | tree                                    | no       |
| `~`       | water                                   | no       |
| `^`       | rock                                    | no       |
| `X`       | cave wall                               | no       |
| `F`       | fence                                   | no       |
| `s`       | signpost                                | no       |
| `R` / `H` | house roof / wall                       | no       |
| `G` / `A` | arena roof / wall                       | no       |
| `Q` / `P` | rest-house roof / wall                  | no       |

Buildings are drawn from tiles: two rows of roof over one row of wall with a
door in it, for example a rest house is `QQQQ` / `QQQQ` / `PpPP`. Leave a
walkable tile in front of every door.

Rules:

- Surround the map with non-walkable tiles, except where a path leaves it.
- `spawn` must be a walkable tile.
- A **warp** joins two maps: `{ at: [x, y], to: 'other-map', spot: [x, y] }`.
  `at` is the walkable tile you step on (usually where a path meets the map
  edge); `spot` is where you appear on the other map. `spot` must be walkable
  and must not itself be a warp, so put it one tile in from the edge. Warps are
  one-way: add the return warp in the other map's file.
- Every map must be reachable from `willowbrook` by walking through warps.
- A map with tall grass needs `wild`: at least three creature ids.
- Keep maps between about 24×16 and 48×32 tiles.

To attach a new route to an existing map you will need to open an exit in that
map's border and add a warp to it. That is the only time you edit an existing
content file; say so in your summary.

## Creatures

A creature is drawn as the **left half** of its sprite and mirrored by the
engine, so it is always symmetrical and faces forward.

- `half`: 8 to 16 rows, each **exactly 8 characters**. `.` is transparent.
- `palette`: a colour for every other character used. By convention `o` is the
  outline (`#1b1b3a`), `e` the eye, `a` the main colour, `b` its shade, `c` an
  accent, `w` a light belly.
- Give it a clear silhouette: ears, horns, fins, wings, a tail. Outline it.
- `type`: one of `ember`, `tide`, `sprout`, `spark`, `stone`, `gust`.
- `moves`: exactly three short move names.
- `name`: 12 characters or fewer.
- Do not set `starter`; there are exactly three starters already.

## Arenas

An arena is where a quest ends. There is one per notbot skill. `scholar`
(Browser research) exists; these five are still needed:

| Skill               | Suggested `match` keywords                           |
| ------------------- | ---------------------------------------------------- |
| File management     | organi[sz]e, file, folder, tidy, clean, sort, rename |
| Terminal            | run, install, build, deploy, script, command, server |
| Document writing    | write, draft, essay, summar, email, report, notes    |
| Desktop interaction | click, open, screenshot, window, app, desktop        |
| Code review         | review, refactor, bug, fix, test, lint, pull request |

An arena needs:

- `town`: a map containing an arena door `a` and a rest-house door `p`, each
  reachable on foot.
- `route`: a map with at least three tall-grass tiles and a `wild` list, close
  to the town (the trainer walks from the grass to the arena during a quest; more
  than about 60 steps and the game skips the walk with a fade).
- `team`: one or more creature ids. The first is the one the leader sends out;
  make it a creature of its own rather than a common wild one.
- `leader`, `badge`, `name`: original names.
- `match`: a regular-expression source, matched case-insensitively against the
  user's prompt to choose this arena.

## Checklist

1. `npm test` passes (this runs the validator over every content file).
2. `npm run typecheck`, `npm run lint` and `npm run format:check` pass
   (`npm run format` fixes formatting).
3. You only added files under `content/`, plus exits and warps in existing maps
   where you joined a new one on.
4. Nothing is taken from an existing game.

## What is left to build

- Five towns, each with an arena and a rest house, themed to the five skills
  above.
- The routes between them (each with tall grass and its own wild list) and one
  cave, joined up so the whole region can be walked from Willowbrook. Route 1
  currently dead-ends at its east side.
- About 30 more creatures: wild ones for the new routes and a signature
  creature for each new leader.
- The five arenas.
