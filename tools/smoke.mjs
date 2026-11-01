#!/usr/bin/env node
// Headless smoke test for index.html.
//
// The game is one self-contained <script>. This harness runs that exact code with
// stubbed DOM / Canvas / AudioContext / localStorage objects, drives a few thousand
// frames through requestAnimationFrame and then checks the rules that are easy to
// break: shield energy, air/water collision layers, refuelling and respawn safety.
//
// No browser and no third-party packages required: node tools/smoke.mjs

import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import assert from 'node:assert/strict';

const root = path.resolve(import.meta.dirname, '..');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');

const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(m => m[1]);
const main = scripts.slice().sort((a, b) => b.length - a.length)[0];
if (!main || !main.includes('RIVERBREAKER')) {
  console.error('smoke: could not find the main game script in index.html');
  process.exit(1);
}

// Expose the internals the assertions need. Only the in-memory copy is patched,
// the shipped index.html stays untouched.
const debugApi = `
window.__rb = {
  get state() { return state; },
  get shieldEnergy() { return shieldEnergy; },
  set shieldEnergy(v) { shieldEnergy = v; },
  get shieldHitCd() { return shieldHitCd; },
  set shieldHitCd(v) { shieldHitCd = v; },
  get fuel() { return fuel; },
  set fuel(v) { fuel = v; },
  get refueling() { return refueling; },
  get invuln() { return invuln; },
  set invuln(v) { invuln = v; },
  get bridgesPassed() { return bridgesPassed; },
  set bridgesPassed(v) { bridgesPassed = v; },
  get checkpointCam() { return checkpointCam; },
  set checkpointCam(v) { checkpointCam = v; },
  get cam() { return cam; },
  set cam(v) { cam = v; },
  get ents() { return ents; },
  get weather() { return weather; },
  get missiles() { return missiles; },
  get rockets() { return rockets; },
  set rockets(v) { rockets = v; },
  get fuelEvery() { return FUEL_EVERY; },
  get sinkSplash() { return sinkSplash; },
  get deathTimer() { return deathTimer; },
  launchRocket,
  get mission() { return mission; },
  get draft() { return draft; },
  get perks() { return perks; },
  get rockets() { return rockets; },
  get lives() { return lives; },
  get shieldEnergy() { return shieldEnergy; },
  get cam() { return cam; },
  get livesLost() { return livesLost; },
  get survivors() { return survivors; },
  spawnSurvivor, rescueSurvivor,
  totalStars, chooseUpgrade, finishDistrict, killEnt, startMission, missionTick,
  get score() { return score; },
  set score(v) { score = v; },
  get lives() { return lives; },
  set lives(v) { lives = v; },
  get scoreTable() { return scoreTable; },
  get entry() { return entry; },
  confirmEntry, entrySetLetter, qualifiesForTable,
  get revives() { return revives; },
  set revives(v) { revives = v; },
  get diffIndex() { return diffIndex; },
  setDifficulty,
  themeForSector, themeForRow, themeNow,
  get dailyRun() { return dailyRun; },
  setDaily, dailySeed, dailyLabel, beginOver,
  get dailyBest() { return dailyBest; },
  get rows() { return rows; },
  get progress() { return progress; },
  get runUpgrades() { return runUpgrades; },
  get runBest() { return runBest; },
  get tally() { return tally; },
  get fuel() { return fuel; },
  get weather() { return weather; },
  get P() { return P; },
  get score() { return score; },
  newGame, respawn, raiseShield, hitPlayer, update, spawnRow,
  toScreenY, playerWy, isBoatMode, ensureRows
};
`;
const patched = main.replace(/\}\)\(\);\s*$/, debugApi + '\n})();');
if (patched === main) {
  console.error('smoke: could not inject the debug hook (IIFE tail not found)');
  process.exit(1);
}

// --- stubs -----------------------------------------------------------------
function makeCtx() {
  const target = {
    canvas: null,
    createLinearGradient: () => ({ addColorStop() {} }),
    createRadialGradient: () => ({ addColorStop() {} }),
    createPattern: () => ({ setTransform() {} }),
    measureText: () => ({ width: 120 }),
    setLineDash() {},
    getLineDash: () => []
  };
  return new Proxy(target, {
    get(t, k) {
      if (k in t) return t[k];
      if (typeof k === 'string' && /^[a-z]/.test(k)) return (t[k] = () => {});
      return undefined;
    },
    set(t, k, v) { t[k] = v; return true; }
  });
}

function makeElement(tag) {
  const ctx = makeCtx();
  const el = {
    tagName: tag, width: 1, height: 1, style: {}, hidden: false,
    handlers: Object.create(null),
    getContext: () => ctx,
    addEventListener(type, fn) { (this.handlers[type] ||= []).push(fn); },
    removeEventListener() {},
    getBoundingClientRect: () => ({ left: 0, top: 0, right: 480, bottom: 720, width: 480, height: 720 }),
    focus() {},
    setPointerCapture() {},
    releasePointerCapture() {},
    appendChild() {}
  };
  return el;
}

class Param {
  constructor(v) { this.value = v; }
  setValueAtTime() { return this; }
  exponentialRampToValueAtTime() { return this; }
  linearRampToValueAtTime() { return this; }
  setTargetAtTime() { return this; }
  cancelScheduledValues() { return this; }
}
class AudioNodeStub {
  constructor() {
    this.gain = new Param(1);
    this.frequency = new Param(440);
    this.Q = new Param(1);
    this.detune = new Param(0);
    this.type = 'sine';
    this.buffer = null;
    this.loop = false;
  }
  connect(dest) { return dest; }
  disconnect() {}
  start() {}
  stop() {}
}
class AudioContextStub {
  constructor() {
    this.currentTime = 0;
    this.sampleRate = 48000;
    this.state = 'running';
    this.destination = new AudioNodeStub();
  }
  resume() {}
  createOscillator() { return new AudioNodeStub(); }
  createGain() { return new AudioNodeStub(); }
  createBiquadFilter() { return new AudioNodeStub(); }
  createBuffer(channels, length) {
    const data = new Float32Array(length);
    return { getChannelData: () => data, length };
  }
  createBufferSource() { return new AudioNodeStub(); }
}

function createGame({ touch = false } = {}) {
  let clock = 1000;
  let raf = null;
  const windowHandlers = Object.create(null);
  const documentHandlers = Object.create(null);
  const view = makeElement('div');
  const gameCanvas = makeElement('canvas');
  const iosHint = makeElement('p');
  const store = new Map();

  const ctx = {
    console,
    Math, JSON, Date, Object, Array, String, Number, Boolean, Error, Map, Set,
    Float32Array, Promise, parseInt, parseFloat, isNaN,
    performance: { now: () => clock },
    requestAnimationFrame: cb => { raf = cb; return 1; },
    cancelAnimationFrame: () => {},
    devicePixelRatio: 2,
    matchMedia: () => ({ matches: touch, addEventListener() {}, removeEventListener() {}, addListener() {} }),
    addEventListener(type, fn) { (windowHandlers[type] ||= []).push(fn); },
    removeEventListener() {},
    ResizeObserver: class { observe() {} disconnect() {} unobserve() {} },
    localStorage: {
      getItem: k => (store.has(k) ? store.get(k) : null),
      setItem: (k, v) => store.set(k, String(v)),
      removeItem: k => store.delete(k)
    },
    navigator: { userAgent: 'node-smoke', vibrate() {} },
    location: { pathname: '/river/', search: '', hash: '', replace() {} },
    document: {
      hidden: false,
      fonts: { load: () => Promise.resolve() },
      getElementById: id => (id === 'game' ? gameCanvas : id === 'view' ? view : iosHint),
      createElement: tag => makeElement(tag),
      addEventListener(type, fn) { (documentHandlers[type] ||= []).push(fn); },
      removeEventListener() {}
    },
    AudioContext: AudioContextStub,
    webkitAudioContext: AudioContextStub
  };
  ctx.window = ctx;
  ctx.globalThis = ctx;
  vm.createContext(ctx);
  vm.runInContext(patched, ctx, { filename: 'index.html#game' });

  const api = ctx.__rb;
  if (!api) throw new Error('smoke: debug hook was not installed');

  const step = (frames = 1) => {
    for (let i = 0; i < frames; i++) {
      const cb = raf;
      if (!cb) throw new Error('smoke: the game stopped requesting animation frames');
      raf = null;
      clock += 1000 / 60;
      cb(clock);
    }
  };
  const key = (code, type = 'keydown') => {
    for (const fn of windowHandlers[type] || []) fn({ code, repeat: false, preventDefault() {} });
  };
  return { api, step, key, windowHandlers };
}

function overlapPlayer(api, kind, extra = {}) {
  api.ents.push({
    kind, x: api.P.x, wy: api.playerWy(), w: 60, h: 40, hp: 3, flash: 0,
    vx: 0, cd: 99999, active: true, t: 0, ...extra
  });
}

const checks = [];
function check(name, fn) {
  try { fn(); checks.push([name, true]); }
  catch (err) { checks.push([name, false, err]); }
}

for (const mode of ['desktop', 'touch']) {
  const touch = mode === 'touch';
  const { api, step, key } = createGame({ touch });

  check(`[${mode}] title screen renders`, () => {
    step(30);
    assert.equal(api.state, 'title');
  });

  check(`[${mode}] game starts from the title screen`, () => {
    key('Enter');
    assert.equal(api.state, 'play');
    step(120);
    assert.equal(api.state, 'play');
  });

  check(`[${mode}] shield raises automatically, drains with time and from hits`, () => {
    api.shieldEnergy = 0;
    api.raiseShield();
    const after = api.shieldEnergy;
    assert.ok(after > 0, 'shield energy should rise when a shield is raised');
    step(30);
    assert.ok(api.shieldEnergy < after, 'shield should bleed energy over time');
    const beforeHit = api.shieldEnergy;
    api.shieldHitCd = 0;
    api.hitPlayer();
    assert.ok(api.shieldEnergy < beforeHit, 'a hit must drain the shield');
    assert.equal(api.state, 'play', 'shield absorbs the hit');
  });

  check(`[${mode}] shield collapses on its own when the energy runs out`, () => {
    api.shieldHitCd = 0;
    api.shieldEnergy = 0.3;
    step(3);
    assert.equal(Math.round(api.shieldEnergy), 0);
    assert.equal(api.state, 'play');
  });

  check(`[${mode}] boat is not destroyed by an aircraft overhead`, () => {
    api.newGame();
    api.invuln = 0;
    api.bridgesPassed = 1;          // river patrol
    api.shieldEnergy = 0;
    api.ents.length = 0;
    overlapPlayer(api, 'jet');
    step(1);
    assert.equal(api.state, 'play');
    api.ents.length = 0;
    overlapPlayer(api, 'heli');
    step(1);
    assert.equal(api.state, 'play', 'a helicopter passes over the boat');
  });

  check(`[${mode}] boat still dies when it rams a boat`, () => {
    api.invuln = 0;
    api.shieldEnergy = 0;
    api.ents.length = 0;
    overlapPlayer(api, 'gunboat');
    step(1);
    assert.equal(api.state, 'dying');
  });

  check(`[${mode}] jet is not destroyed by a boat below`, () => {
    api.newGame();
    api.invuln = 0;
    api.bridgesPassed = 0;          // air patrol
    api.ents.length = 0;
    overlapPlayer(api, 'gunboat');
    step(1);
    assert.equal(api.state, 'play');
  });

  check(`[${mode}] jet still dies when it rams another aircraft`, () => {
    api.invuln = 0;
    api.shieldEnergy = 0;
    api.ents.length = 0;
    overlapPlayer(api, 'jet');
    step(1);
    assert.equal(api.state, 'dying');
  });

  check(`[${mode}] refuelling tops the tank up and draws the hose`, () => {
    api.newGame();
    api.invuln = 0;
    api.fuel = 40;
    api.ents.length = 0;
    overlapPlayer(api, 'fuel', { x: api.P.x, w: 46, h: 96 });
    step(10);
    assert.ok(api.fuel > 40, 'fuel should increase while sitting on the barge');
    assert.equal(api.refueling, true);
    assert.equal(api.state, 'play');
    step(40);   // drive past the barge: the hose must disappear without errors
    assert.equal(api.refueling, false);
  });

  check(`[${mode}] respawn does not drop the player into a wall of enemies`, () => {
    api.newGame();
    api.checkpointCam = 20000;
    api.respawn();
    step(1);
    const H = 720;
    const near = api.ents.filter(e => {
      if (!['boat', 'gunboat', 'heli', 'jet', 'turret', 'launcher'].includes(e.kind)) return false;
      const sy = api.toScreenY(e.wy);
      return sy > -80 && sy < H - 300;
    });
    assert.equal(near.length, 0, `found ${near.length} enemies close to the respawn point`);
  });

  check(`[${mode}] fuel is tight but survivable`, () => {
    // One barge pass has to fill the tank: a long contact is ~45 frames.
    api.newGame();
    api.invuln = 0;
    api.fuel = 5;
    api.ents.length = 0;
    overlapPlayer(api, 'fuel', { x: api.P.x, w: 46, h: 96 });
    step(45);
    assert.ok(api.fuel >= 95, `one pass should essentially fill the tank (reached ${Math.round(api.fuel)})`);
    // And the distance between barges must be shorter than the range of a tank.
    const rowsPerTank = 100 / 0.055 / 60 * 2.4 * 60 / 8;   // 100 fuel -> frames -> px -> rows
    assert.ok(api.fuelEvery <= rowsPerTank * 0.8,
      `barges every ${api.fuelEvery} rows vs ${Math.round(rowsPerTank)} rows of range`);
  });

  check(`[${mode}] the map generator places minefields`, () => {
    api.newGame();
    api.checkpointCam = 30000;
    api.respawn();
    step(120);
    assert.ok(api.ents.some(e => e.kind === 'mine'), 'no mines were generated upstream');
  });

  check(`[${mode}] boat detonates on a mine`, () => {
    api.newGame();
    api.invuln = 0;
    api.bridgesPassed = 1;           // river patrol
    api.shieldEnergy = 0;
    api.ents.length = 0;
    api.ents.push({ kind: 'mine', x: api.P.x, wy: api.playerWy(), w: 30, h: 30, hp: 1, flash: 0, ph: 0 });
    step(1);
    assert.equal(api.state, 'dying');
  });

  check(`[${mode}] a mine nearly collapses the shield`, () => {
    api.newGame();
    api.invuln = 0;
    api.bridgesPassed = 1;
    api.raiseShield();
    api.shieldEnergy = 60;
    api.shieldHitCd = 0;
    api.ents.length = 0;
    api.ents.push({ kind: 'mine', x: api.P.x, wy: api.playerWy(), w: 30, h: 30, hp: 1, flash: 0, ph: 0 });
    step(1);
    assert.equal(api.state, 'play', 'the dome absorbs the blast');
    assert.ok(api.shieldEnergy <= 10, `shield left at ${api.shieldEnergy}`);
  });

  check(`[${mode}] jet flies over the minefield`, () => {
    api.newGame();
    api.invuln = 0;
    api.bridgesPassed = 0;           // air patrol
    api.ents.length = 0;
    api.ents.push({ kind: 'mine', x: api.P.x, wy: api.playerWy(), w: 30, h: 30, hp: 1, flash: 0, ph: 0 });
    step(1);
    assert.equal(api.state, 'play');
  });

  check(`[${mode}] storm cell charges before it strikes`, () => {
    api.newGame();
    api.invuln = 0;
    api.bridgesPassed = 0;
    api.shieldEnergy = 0;
    api.weather.length = 0;
    api.weather.push({ kind: 'storm', x: api.P.x, wy: api.playerWy(), w: 186, h: 104, drift: 0, ph: 0,
      charge: 0, struck: false, fade: 0, bolt: 0 });
    step(1);
    assert.ok(api.weather[0].charge > 0, 'the cell must telegraph the strike');
    assert.equal(api.state, 'play', 'the flicker itself is harmless');
    step(30);
    assert.equal(api.state, 'dying');
  });

  check(`[${mode}] harmless clouds never hurt the jet`, () => {
    api.newGame();
    api.invuln = 0;
    api.bridgesPassed = 0;
    api.weather.length = 0;
    api.weather.push({ kind: 'cloud', x: api.P.x, wy: api.playerWy(), w: 158, h: 86, drift: 0, ph: 0,
      charge: 0, struck: false, fade: 0, bolt: 0 });
    step(60);
    assert.equal(api.state, 'play');
  });

  check(`[${mode}] boat ignores storm cells`, () => {
    api.newGame();
    api.invuln = 0;
    api.bridgesPassed = 1;
    api.shieldEnergy = 0;
    api.weather.length = 0;
    api.weather.push({ kind: 'storm', x: api.P.x, wy: api.playerWy(), w: 186, h: 104, drift: 0, ph: 0,
      charge: 0, struck: false, fade: 0, bolt: 0 });
    step(60);
    assert.equal(api.state, 'play');
  });

  check(`[${mode}] rocket launch is visible and locks onto a target`, () => {
    api.newGame();
    api.invuln = 0;
    api.ents.length = 0;
    api.rockets = 2;
    api.ents.push({ kind: 'boat', x: api.P.x + 40, wy: api.playerWy() + 320, w: 84, h: 30, hp: 3, flash: 0, vx: 0, cd: 9999 });
    assert.equal(api.launchRocket(), true);
    assert.equal(api.missiles.length, 1);
    step(4);
    assert.equal(api.missiles.length, 1, 'the missile should still be flying');
    assert.notEqual(api.missiles[0].lockX, null, 'the missile should lock onto the boat');
  });

  check(`[${mode}] running dry sinks the craft and respawns`, () => {
    api.newGame();
    api.invuln = 0;
    api.fuel = 0.01;
    step(1);
    assert.equal(api.state, 'sinking');
    step(160);
    assert.notEqual(api.state, 'sinking');
    assert.ok(['play', 'over'].includes(api.state));
  });

  check(`[${mode}] every district opens with a mission`, () => {
    api.newGame();
    assert.ok(['sweep', 'rescue', 'mine'].includes(api.mission.id), 'no mission was assigned');
    assert.ok(api.mission.goal >= 2, 'the mission goal is too small');
    assert.equal(api.mission.done, 0);
    assert.equal(api.mission.complete, false);
  });

  check(`[${mode}] kills advance the mission and complete it`, () => {
    api.newGame();
    api.ents.length = 0;
    assert.equal(api.mission.id, 'sweep');
    const goal = api.mission.goal;
    for (let i = 0; i < goal; i++) {
      const e = { kind: 'boat', x: 120 + i * 10, wy: api.playerWy() + 400, w: 84, h: 30, hp: 1, flash: 0, vx: 0, cd: 9999 };
      api.ents.push(e);
      api.killEnt(e);
    }
    assert.equal(api.mission.done, goal);
    assert.equal(api.mission.complete, true);
  });

  check(`[${mode}] a rescue mission is reachable without luck`, () => {
    api.newGame();
    api.startMission(3);            // sector 3 is the rescue mission
    assert.equal(api.mission.id, 'rescue');
    api.ents.length = 0;
    for (let i = 0; i < 6 && !api.mission.complete; i++) {
      const e = { kind: 'boat', x: 120 + i * 12, wy: api.playerWy() + 400, w: 84, h: 30, hp: 1, flash: 0, vx: 0, cd: 9999 };
      api.ents.push(e);
      api.killEnt(e);
    }
    assert.ok(api.mission.kills >= 2, 'kills should be counted for the rescue mission');
    assert.ok(api.survivors.length >= 2, 'every second kill should bring somebody out');
  });

  check(`[${mode}] survivors stand on the shore in the air and swim in the river`, () => {
    api.newGame();
    api.ents.length = 0;
    api.bridgesPassed = 0;                       // air patrol
    const e = { kind: 'boat', x: 240, wy: api.playerWy() + 300, w: 84, h: 30, hp: 1, flash: 0, vx: 0, cd: 9999 };
    api.spawnSurvivor(e);
    const a = api.survivors[api.survivors.length - 1];
    assert.equal(a.water, false, 'from the air you rescue people on the bank');
    api.bridgesPassed = 1;                       // river patrol
    api.spawnSurvivor(e);
    const b = api.survivors[api.survivors.length - 1];
    assert.equal(b.water, true, 'from the boat you rescue swimmers in life rings');
    api.survivors.length = 0;
  });

  check(`[${mode}] swimming up to a survivor rescues them and scores`, () => {
    api.newGame();
    api.invuln = 999;
    api.survivors.length = 0;
    api.score = 0;
    api.startMission(3);                         // rescue mission, goal >= 2
    api.survivors.push({ x: api.P.x, wy: api.playerWy(), water: true, born: 0, kind: 'shield', v: 0 });
    step(1);
    assert.equal(api.survivors.length, 0, 'the survivor is picked up');
    assert.ok(api.score >= 100, `a rescue should score (got ${api.score})`);
    assert.equal(api.mission.done, 1, 'a rescue counts for the mission');
    assert.ok(api.shieldEnergy > 0, 'the rescue grants its help');
  });

  check(`[${mode}] clearing a district awards stars and opens the draft`, () => {
    api.newGame();
    api.invuln = 999;
    const before = api.totalStars();
    api.ents.length = 0;
    api.ents.push({ kind: 'bridge', x: 240, wy: api.playerWy() - 40, w: 480, h: 32, hp: 0, maxHp: 6, flash: 0, dead: true, passed: false });
    step(1);
    assert.equal(api.state, 'draft', 'the bridge should end the district');
    assert.equal(api.draft.cards.length, 3, 'three upgrade cards');
    const ids = new Set(api.draft.cards.map(c => c.id));
    assert.equal(ids.size, 3, 'the cards must be distinct');
    assert.ok(api.draft.stars >= 1, 'at least one star for clearing the district');
    assert.ok(api.totalStars() > before, 'stars should be persisted');
  });

  check(`[${mode}] the draft freezes the world until a card is picked`, () => {
    const cam = api.cam, done = api.mission.done;
    step(30);
    assert.equal(api.state, 'draft');
    assert.equal(api.cam, cam, 'the river must not scroll behind the draft');
    assert.equal(api.mission.done, done);
  });

  check(`[${mode}] picking an upgrade resumes play and changes the craft`, () => {
    const snap = JSON.stringify([api.rockets, api.perks, api.lives, api.shieldEnergy, api.mission.id]);
    const card = api.draft.cards[0];
    assert.equal(api.chooseUpgrade(0), true);
    assert.equal(api.state, 'play');
    assert.equal(api.draft.cards.length, 0);
    const after = JSON.stringify([api.rockets, api.perks, api.lives, api.shieldEnergy, api.mission.id]);
    assert.notEqual(after, snap, 'the chosen upgrade had no effect');
    assert.ok(card && card.id, 'the card should have an id');
    assert.equal(api.mission.done, 0, 'the next district starts with a fresh mission');
  });

  check(`[${mode}] a second wind keeps the run going once`, () => {
    api.newGame();
    api.lives = 1;
    api.revives = 1;
    api.shieldEnergy = 0;
    api.shieldHitCd = 0;
    api.invuln = 0;
    api.hitPlayer(999);
    step(130);
    assert.equal(api.state, 'play', 'the run should continue after the second wind');
    assert.equal(api.lives, 1, 'back in with one life');
    assert.equal(api.revives, 0, 'the second wind is spent');
    api.lives = 1;
    api.shieldEnergy = 0;
    api.invuln = 0;
    api.hitPlayer(999);
    step(130);
    assert.notEqual(api.state, 'play', 'the next death really ends the run');
  });

  check(`[${mode}] the first sector is a safe tutorial`, () => {
    api.newGame();
    api.shieldEnergy = 100;
    for (let i = 0; i < 260; i++) { api.invuln = 999; step(1); }
    assert.equal(api.ents.some(e => e.kind === 'mine'), false, 'no mines in the opening sector');
    assert.equal(api.weather.some(w => w.kind === 'storm'), false, 'no storms in the opening sector');
  });

  check(`[${mode}] difficulty changes the pressure`, () => {
    api.setDifficulty(0);                        // CHILL
    api.newGame();
    api.fuel = 60;
    step(60);
    const chill = 60 - api.fuel;
    api.setDifficulty(2);                        // ARCADE
    api.newGame();
    api.fuel = 60;
    step(60);
    const arcade = 60 - api.fuel;
    assert.ok(arcade > chill * 1.2, `arcade burn ${arcade.toFixed(2)} should exceed chill ${chill.toFixed(2)}`);
    assert.equal(api.lives, 2, 'arcade starts with fewer lives');
    api.setDifficulty(1);                        // back to STANDARD for the rest
    api.newGame();
    assert.equal(api.lives, 3);
  });

  check(`[${mode}] a record run lands on the board without asking for a name`, () => {
    api.newGame();
    api.score = 54321;
    api.lives = 1;
    api.revives = 0;
    api.shieldEnergy = 0;
    api.shieldHitCd = 0;
    api.invuln = 0;
    api.hitPlayer(999);
    assert.equal(api.state, 'dying');
    step(130);
    assert.equal(api.state, 'over', 'the report screen comes straight after the crash');
    assert.equal(api.scoreTable[0].s, 54321);
    assert.ok(api.scoreTable.length <= 5, 'the board keeps five entries');
  });

  check(`[${mode}] a weak run goes straight to game over`, () => {
    api.newGame();
    api.score = 0;
    api.lives = 1;
    api.revives = 0;
    api.shieldEnergy = 0;
    api.shieldHitCd = 0;
    api.invuln = 0;
    assert.equal(api.qualifiesForTable(0), false);
    api.hitPlayer(999);
    step(130);
    assert.notEqual(api.state, 'entry');
  });

  check(`[${mode}] the landscape changes every two sectors`, () => {
    assert.equal(api.themeForSector(0).id, 'jungle');
    assert.equal(api.themeForSector(1).id, 'jungle');
    assert.equal(api.themeForSector(2).id, 'city');
    assert.equal(api.themeForSector(4).id, 'industry');
    assert.equal(api.themeForSector(6).id, 'desert');
    assert.equal(api.themeForSector(8).id, 'jungle', 'the list comes back around');
    const bridgeRow = 2 * 700;                       // two sectors of jungle, then the city
    assert.equal(api.themeForRow(bridgeRow - 1).id, 'jungle');
    assert.equal(api.themeForRow(bridgeRow).id, 'city');
  });

  check(`[${mode}] every landscape renders without breaking`, () => {
    for (const sec of [0, 2, 4, 6]) {
      api.newGame();
      api.bridgesPassed = sec;
      api.cam = sec * 700 * 8 + 1200;
      api.checkpointCam = api.cam;
      api.respawn();
      assert.equal(api.themeNow().id, ['jungle', 'city', 'industry', 'desert'][sec / 2]);
      step(4);
      assert.equal(api.state, 'play');
    }
    api.newGame();
  });

  check(`[${mode}] the daily seed is the calendar, not the clock`, () => {
    assert.equal(api.dailySeed(20261031), api.dailySeed(20261031));
    assert.notEqual(api.dailySeed(20261031), api.dailySeed(20261101));
    assert.equal(api.dailyLabel(20261031), '31 OCT');
    assert.equal(api.dailyLabel(20261101), '01 NOV');
  });

  check(`[${mode}] one daily course for the whole day, different from the usual river`, () => {
    // Rows 0-39 are the straight opening stretch on every seed: compare further up.
    const sig = () => { api.ensureRows(220); return api.rows.slice(0, 220).map(r => r.l + ':' + r.r).join(','); };
    api.setDaily(false);
    api.newGame();
    const plain = sig();
    api.setDaily(true);
    api.newGame();
    const day = sig();
    assert.equal(api.dailyRun, true);
    assert.notEqual(day, plain, 'the daily course has to differ from the everyday one');
    api.newGame();
    assert.equal(sig(), day, 'the same date must rebuild the same course');
    api.setDaily(false);
    api.newGame();
    assert.equal(api.dailyRun, false);
    assert.equal(sig(), plain, 'switching back restores the everyday river');
  });

  check(`[${mode}] the last upgrade of a lost run waits for the next one`, () => {
    api.newGame();
    api.runUpgrades.length = 0;
    api.finishDistrict();
    assert.equal(api.state, 'draft');
    const id = api.draft.cards[0].id;
    assert.equal(api.chooseUpgrade(0), true);
    assert.equal(api.state, 'play');
    api.score = 0;
    api.lives = 1;
    api.revives = 0;
    api.shieldEnergy = 0;
    api.shieldHitCd = 0;
    api.invuln = 0;
    api.hitPlayer(999);
    step(130);
    assert.equal(api.state, 'over');
    assert.equal(api.progress.vet, id, 'the last upgrade is salvaged');
    api.newGame();
    assert.equal(api.progress.vet, '', 'the salvage is spent by the next run');
    assert.ok(api.runUpgrades.indexOf(id) >= 0, 'the new run starts with it');
  });

  check(`[${mode}] the report screen counts the score up`, () => {
    api.newGame();
    api.score = 4321;
    api.beginOver(90);
    step(1);
    const mid = api.tally.v;
    assert.ok(mid > 0 && mid < 4321, `the tally should still be running (got ${mid})`);
    step(90);
    assert.equal(api.tally.v, 4321);
    assert.equal(api.state, 'over');
  });

  check(`[${mode}] long run with restarts stays stable`, () => {
    for (let i = 0; i < 900; i++) {
      if (i % 120 === 0) key('Enter');
      if (i % 7 === 0) key('Space');
      step(1);
    }
    assert.ok(['play', 'dying', 'sinking', 'over', 'paused', 'title', 'draft'].includes(api.state));
  });

  check(`[${mode}] pause and resume work`, () => {
    api.newGame();
    key('KeyP');
    assert.equal(api.state, 'paused');
    step(10);
    key('KeyP');
    assert.equal(api.state, 'play');
  });
}

let failed = 0;
for (const [name, ok, err] of checks) {
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}`);
  if (!ok) { failed++; console.error(String(err && err.stack || err).split('\n').slice(0, 6).join('\n')); }
}
console.log(`\n${checks.length - failed}/${checks.length} smoke checks passed`);
process.exit(failed ? 1 : 0);
