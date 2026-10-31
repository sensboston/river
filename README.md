# Riverbreaker

Arcade river shooter, installable as a PWA and playable offline: fly upstream,
break every bridge, then take command of a patrol boat. Live at
<https://senssoft.com/river/>.

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

## Controls

* Mouse: move to steer, hold the left button to fire, right button or `V` for a rocket.
* Keyboard: arrows or `WASD`, `Space` to fire, `V` rocket, `P` pause, `M` sound.
* Touch: drag to steer (drag up/down for faster/slower), hold **FIRE**, tap **ROCKET**.

Shields are automatic: a shield pod raises the dome at once, and the dome drains
with time and with every hit it absorbs. When the meter is empty the next hit hurts.

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
* a qualifying score ends the run on the arcade **initials screen**: three letters,
  five slots, best scores shown on the title screen between sessions.

The draft screen is deliberately the only place a full-screen ad could go: it is a
natural pause between missions, never mid-run.

## Hazards

* **Fuel barges** are rare: one every 400 rows, so the tank has to be managed.
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
the tutorial sector and the second wind.

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
