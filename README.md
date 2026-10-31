# Riverbreaker

Arcade river shooter, installable as a PWA and playable offline: fly upstream,
break every bridge, then take command of a patrol boat. Live at
(https://sensboston.github.io/river/)

```
index.html            the whole game: rendering, audio, input, HUD
manifest.webmanifest  PWA manifest (icons, screenshots, standalone display)
sw.js                 service worker: precache, cache-first, versioned caches
icons/ fonts/ screenshots/ favicon.ico
tools/                dependency-free check, smoke test and build scripts
tools/server-check.sh read-only readiness check for the deploy target
.github/workflows/    CI and the SSH deploy pipeline
DEPLOY-CI.md          automatic deployment: server setup, secrets, threat model
DEPLOY-ORACLE-UBUNTU.md  step-by-step server setup on Oracle Cloud Ubuntu
```

## Difficulty and onboarding

* Three temperaments on the title screen (`Chill` / `Standard` / `Arcade`) change
  enemy density, hazard frequency, fuel burn, enemy fire rate, starting lives and
  whether the run gets a free second wind. The choice is remembered.
* The first sector is a quiet tutorial: no mines, no storm cells, fewer enemies and
  three coaching lines (steer, fire, break the bridge).
* Soft failure: the first time the last life is lost, the run gets one **second
  wind** instead of ending. Chill and Standard have one, Arcade has none.

## Daily run

* The `DAILY RUN` pill on the title screen (or `D`) switches the run to the river
  of the day: the course and the upgrade offers are generated from the date, so
  everyone who plays today flies the same stretches and gets the same three cards.
  No server and no accounts, the calendar is the seed (`dailySeed`).
* Every run is rebuildable from a seed: `reseedRiver()` regenerates the cached row
  layout, so the everyday river and today's river differ only by their seed. The
  opening 40 rows are deliberately straight on every seed.
* Today's best score is kept in `localStorage` and shown on the title screen and on
  the report screen. Daily runs still count for the all-time board.
* **Salvage**: the last upgrade taken in a lost run is kept and is already fitted
  when the next run starts (`progress.vet`). A bad run always leaves something.

The report screen counts the final score up, marks a `NEW RECORD`, shows the daily
best and names the salvaged upgrade.

## Landscape

The river runs from one kind of country into the next, two sectors at a time:
**JUNGLE** (grass, trees, bushes, boulders) -> **CITY** (asphalt embankments, flat
roofs, a narrower channel) -> **WORKS** (yards, storage tanks, hazard-striped
sheds) -> **DESERT** (sand, cacti, dry rocks) -> back to the jungle.

* A theme is data, not code: `THEMES` holds the water tint, the bank tile, the
  shore colours, the decoration sprites, their density and the river width. A new
  one is a few lines.
* The change happens **at a bridge**: banks are filled per sector segment, so the
  jungle on one side of the bridge and the city on the other are visible in the
  same frame. The sector banner announces `INTO THE CITY` and the HUD keeps the
  current landscape on the left.
* Islands take the land colour and the decoration of their own stretch of river.
* Bank tiles are baked once at start-up (`PAT_GRASS`, `PAT_CITY`, `PAT_YARD`,
  `PAT_SAND`) and the segment list is reused every frame: no gradients or
  allocations in the draw path, which matters on Android.

## Controls

* Mouse: move to steer, hold the left button to fire, right button or `V` for a rocket.
* Keyboard: arrows or `WASD`, `Space` to fire, `V` rocket, `P` pause, `M` sound.
* Touch: drag to steer (drag up/down for faster/slower), hold **FIRE**, tap **ROCKET**.

Shields are automatic: a shield pod raises the dome at once, and the dome drains
with time and with every hit it absorbs. When the meter is empty the next hit hurts.
The dome is a full bubble around the craft and absorbs hits from any direction, so
it also covers the tail. The craft sits 190 px above the bottom edge, clear of the
holding thumb on a phone.

## Progression

The river is a chain of sectors, not an endless scroller:

* every sector has **one mission** (destroy targets, sweep mines, collect pods) with
  a live counter in the HUD and a score bonus;
* the sector ends at the bridge, which opens a **report + upgrade draft** screen:
  three of six upgrades (fire rate, fuel burn, rockets, shield, life, score);
* each sector is rated **1-3 stars** (cleared / mission done / no life lost) and the
  stars are stored in `localStorage`, so progress survives between sessions;
* sector difficulty scales: enemy density, mine fields and storm frequency all grow
  with the sector number;
* a qualifying score goes straight onto the top-five board (best runs shown on the
  title screen between sessions). The three-letter prompt still exists behind
  `ASK_INITIALS` for a future settings screen, but it is off by default.

The draft screen is deliberately the only place a full-screen ad could go: it is a
natural pause between missions, never mid-run.

## Hazards

* **Fuel barges**: one every 300 rows (2400 px) against roughly 4400 px of range,
  so the tank has to be managed but a missed barge is not a death sentence. A
  single pass with the hose down fills the tank.
* **Mines** are anchored in the river. The patrol boat detonates on contact, the
  jet flies over them. They also detonate when shot, and the blast sets off the
  neighbouring mines.
* **Clouds** are harmless scenery. **Storm cells** are dark and deadly: flying into
  the core starts a charge, the cell flickers for a fifth of a second and then
  drops a lightning bolt. Leave the core in time and the strike fizzles.
* Losing all fuel is a sequence, not an instant: the boat ships water and rolls
  under, the jet glides down, ditches and floats hull-deep before it sinks.
* A destroyed craft breaks up: staged explosions, a burning wreck and a smoke
  column, then the respawn.

## Local development

The game needs to be served over HTTP (service workers are disabled on `file://`):

```bash
python3 -m http.server 8000        # then open http://localhost:8000/
```

Checks, gameplay smoke test and build (Node 22, no packages, nothing to install):

```bash
node tools/check.mjs     # HTML/manifest/service worker/assets consistency
node tools/smoke.mjs     # runs the real game headlessly, checks gameplay rules
node tools/build.mjs     # writes dist/ and stamps sw.js with the commit id
```

`tools/smoke.mjs` executes the game script against stubbed DOM/Canvas/Audio
objects, drives thousands of frames and asserts the rules that are easy to break:
air and water collision layers, shield energy, refuelling, respawn safety, mines,
storm cells, the rocket lock, the out-of-fuel sequence, sector missions, the
upgrade draft, star persistence, the initials/hi-score flow, difficulty scaling,
the tutorial sector, the second wind, the daily seed and course, the salvage on
death, the score tally, the landscape theme table and a render pass in all four
themes (78 checks).

## Deployment

Pull requests run the checks, the smoke test and the build. Publishing is manual:
`node tools/build.mjs`, then rsync `dist/` to the server (see
[README-DEPLOY.txt](README-DEPLOY.txt)). The optional `Deploy` workflow does the
same thing automatically, but only when you start it by hand — merging to `master`
never deploys anything.

Full setup, rollback and security notes: **[DEPLOY-CI.md](DEPLOY-CI.md)**.
Oracle Cloud Ubuntu instance (Always Free / PAYG): **[DEPLOY-ORACLE-UBUNTU.md](DEPLOY-ORACLE-UBUNTU.md)**.
Server layout, nginx/Apache snippets and manual release steps:
[README-DEPLOY.txt](README-DEPLOY.txt).
