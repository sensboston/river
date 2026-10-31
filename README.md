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
.github/workflows/    CI and the SSH deploy pipeline
DEPLOY-CI.md          automatic deployment: server setup, secrets, threat model
```

## Controls

* Mouse: move to steer, hold the left button to fire, `V` for a rocket.
* Keyboard: arrows or `WASD`, `Space` to fire, `V` rocket, `P` pause, `M` sound.
* Touch: drag to steer (drag up/down for faster/slower), hold **FIRE**, tap **ROCKET**.

Shields are automatic: a shield pod raises the dome at once, and the dome drains
with time and with every hit it absorbs. When the meter is empty the next hit hurts.

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
air and water collision layers, shield energy, refuelling, respawn safety.

## Deployment

Pushing to `master` runs the checks, builds `dist/`, waits for the approval of the
`production` environment and rsyncs the result to the web server over a
restricted SSH key. Pull requests only run the checks and never see secrets.

Full setup, rollback and security notes: **[DEPLOY-CI.md](DEPLOY-CI.md)**.
Server layout, nginx/Apache snippets and manual release steps:
[README-DEPLOY.txt](README-DEPLOY.txt).
