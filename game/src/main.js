// Boot and the one loop: a fixed 60 Hz simulation feeding a render at the
// display's rate. ?shot=buy|fight|plant|site with &seed=N stages a real
// render on load (fixed camera pose, no pointer lock, the round auto-started),
// renders it twice, freezes it and sets window.__shotReady. ?selftest=1
// runs a scripted check of the sim and writes window.__selftest.
import * as THREE from 'three';
import { PALETTE } from './palette.js';
import { createMap } from './map.js';
import { createInput } from './input.js';
import { createWeaponRig } from './weapons.js';
import { createBots } from './bots.js';
import { createRounds } from './rounds.js';
import { createHud } from './hud.js';
import { createAudio } from './audio.js';
import { createSim } from './sim.js';

const FIXED_STEP = 1 / 60;
const params = new URLSearchParams(window.location.search);
const shot = params.get('shot');
const selftest = params.get('selftest') === '1';
const seed = Number.parseInt(params.get('seed') ?? '7', 10) || 7;

const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
document.getElementById('game').appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(PALETTE.canvas);
scene.fog = new THREE.Fog(new THREE.Color(PALETTE.canvas), 26, 70);
const camera = new THREE.PerspectiveCamera(74, window.innerWidth / window.innerHeight, 0.05, 160);
scene.add(camera);

const map = createMap(scene);
const bots = createBots(scene, map, seed);
const rig = createWeaponRig(camera);
const rounds = createRounds();
const hud = createHud(map);
const audio = createAudio();
const input = createInput(renderer.domElement, onLockChange);
const sim = createSim({ scene, camera, map, rig, bots, rounds, hud, audio, seed });

let started = false;
let frozen = false;
let accumulator = 0;
let lastTime = performance.now();
let minimapT = 0;

sim.resetMatch();
hud.setMoney(sim.state.player.money);

hud.onPlay(() => {
  audio.unlock();
  if (shot || selftest) return;
  if (rounds.state.matchOver) {
    sim.resetMatch();
    hud.hideOverlay();
    input.requestLock();
    return;
  }
  input.requestLock();
});

function onLockChange(locked) {
  if (shot || selftest) return;
  if (locked) {
    started = true;
    hud.hideOverlay();
  } else if (!rounds.state.matchOver) {
    hud.showOverlay(started ? 'paused' : 'start');
  }
}

function syncCamera() {
  const body = sim.state.player.body;
  camera.position.set(body.position.x, body.position.y + body.eye, body.position.z);
  camera.rotation.set(body.pitch, body.yaw, 0, 'YXZ');
}

function step(dt) {
  sim.step(dt, input);
  minimapT += dt;
  if (minimapT >= 0.25) {
    minimapT = 0;
    hud.drawMinimap(sim.state);
  }
}

function frame(now) {
  requestAnimationFrame(frame);
  const dt = Math.min((now - lastTime) / 1000, 0.1);
  lastTime = now;
  if (!frozen) {
    accumulator += dt;
    let steps = 0;
    while (accumulator >= FIXED_STEP && steps < 5) {
      step(FIXED_STEP);
      accumulator -= FIXED_STEP;
      steps += 1;
    }
    if (accumulator > FIXED_STEP * 5) accumulator = 0;
    syncCamera();
  }
  renderer.render(scene, camera);
}

function settle(steps) {
  for (let i = 0; i < steps; i += 1) step(FIXED_STEP);
}

function paintTwiceThenReady() {
  let painted = 0;
  function paint() {
    requestAnimationFrame(paint);
    renderer.render(scene, camera);
    painted += 1;
    if (painted === 2) {
      window.__shotReady = true;
      frozen = true;
    }
  }
  requestAnimationFrame(paint);
}

// --- Screenshot staging: real renders of the game code, posed on load.
function runShot(name) {
  hud.hideOverlay();
  const p = sim.state.player;
  const body = p.body;
  if (name === 'buy') {
    // Buy phase at attacker spawn, menu open, bots walking out.
    rounds.state.phase = 'buy';
    rounds.state.phaseT = 0;
    rounds.state.buyOpen = true;
    p.money = 3200;
    hud.showBuy(p.money);
    body.position.set(0, 0, 16);
    body.yaw = 0;
    body.pitch = 0;
    settle(90);
    syncCamera();
  } else if (name === 'fight') {
    // Live round, mid lane: the player sights a defender at the doors.
    rounds.state.phase = 'live';
    rounds.state.phaseT = 0;
    rounds.state.timer = 92;
    p.loadout.jackal = { mag: 30, reserve: 90 };
    sim.switchWeapon('jackal');
    body.position.set(0, 0, 9);
    body.yaw = 0;
    body.pitch = 0.02;
    settle(30);
    const def = bots.bots.find((b) => b.team === 'def' && b.alive);
    if (def) {
      // Mid lane, well east of the big crate, close enough to read: frozen
      // in place so the frame catches them, not an empty lane.
      def.body.position.set(4.5, 0, 2);
      def.body.yaw = Math.PI;
      def.group.position.copy(def.body.position);
      def.state = 'hold';
      def.path = [];
      def.pathI = 0;
    }
    // Two aimed rounds down the lane; the tracer is still lit when we freeze.
    const aimAt = () => {
      if (!def) return;
      const dx = def.body.position.x - body.position.x;
      const dy = 1.4 - (body.position.y + body.eye);
      const dz = def.body.position.z - body.position.z;
      const len = Math.hypot(dx, dy, dz) || 1;
      body.yaw = Math.atan2(-dx, -dz);
      body.pitch = Math.asin(Math.max(-1, Math.min(1, dy / len)));
      syncCamera();
    };
    for (let i = 0; i < 2; i += 1) {
      // Re-place before every round: the AI strafes while shots settle,
      // and it would end up behind the crate.
      if (def) {
        def.body.position.set(4.5, 0, 2);
        def.group.position.copy(def.body.position);
        def.state = 'hold';
        def.path = [];
        def.pathI = 0;
      }
      aimAt();
      sim.shootPlayer();
      // No settle after the last round: the tracer stays lit for the freeze.
      // 8 steps clears the Jackal's 0.1 s cooldown with margin to spare.
      if (i === 0) settle(8);
    }
    aimAt();
    syncCamera();
  } else if (name === 'plant') {
    // Live round, A site: the player is mid-plant, a teammate covers the door.
    rounds.state.phase = 'live';
    rounds.state.phaseT = 0;
    rounds.state.timer = 74;
    body.position.set(-18, 0, -5.5);
    body.yaw = 0;
    body.pitch = 0.02;
    settle(20);
    p.planting = 0.62;
    hud.setPlant(0.62, 'PLANTING AT A — HOLD E');
    const mate = bots.bots.find((b) => b.team === 'atk' && b.alive);
    if (mate) {
      mate.body.position.set(-16.5, 0, -13);
      mate.body.yaw = Math.PI;
      mate.group.position.copy(mate.body.position);
    }
    syncCamera();
  } else {
    // 'site': a wide look at the B warehouse from the connector, defenders
    // holding inside, an attacker pushing the south entrance.
    rounds.state.phase = 'live';
    rounds.state.phaseT = 0;
    rounds.state.timer = 88;
    settle(60);
    camera.position.set(8, 6.5, 2);
    camera.lookAt(18, 1.2, -12);
    // No first-person gun on a scenic overview.
    rig.models[rig.state.current].visible = false;
    // The camera is posed, not player-driven, for this one frame.
    paintTwiceThenReady();
    return;
  }
  paintTwiceThenReady();
}

// --- Headless self-test: a scripted pass over the sim, logged to the console
// and to window.__selftest. It never ships a different game: it only drives
// the same step() the player drives.
function runSelftest() {
  const out = { ok: true, checks: {} };
  function check(name, cond) {
    out.checks[name] = !!cond;
    if (!cond) out.ok = false;
    console.log(`[selftest] ${name}: ${cond ? 'PASS' : 'FAIL'}`);
  }
  const p = sim.state.player;
  check('match starts in freeze', rounds.state.phase === 'freeze');
  check('player alive with p9', p.alive && p.current === 'p9' && rig.state.mag === 12);
  settle(200);
  check('freeze ends into buy', rounds.state.phase === 'buy');
  const botStart = bots.bots.map((b) => [b.body.position.x, b.body.position.z]);
  settle(120);
  const botMoved = bots.bots.some((b, i) => Math.hypot(b.body.position.x - botStart[i][0], b.body.position.z - botStart[i][1]) > 0.5);
  check('bots walk out during buy', botMoved);
  p.money = 3200;
  const bought = rounds.buy(p, 'jackal');
  check('buy jackal for 2700', bought === 'ok' && p.loadout.jackal && p.money === 500);
  settle(1000);
  check('buy ends into live', rounds.state.phase === 'live');
  sim.switchWeapon('jackal');
  const shotsBefore = sim.state.stats.shots;
  const enemy = bots.bots.find((b) => b.team === 'def' && b.alive);
  if (enemy) {
    // A long lane, clear line of fire: player south, defender north.
    // Each round is aimed at the defender's current spot before firing.
    enemy.body.position.set(-18, 0, 2);
    enemy.group.position.copy(enemy.body.position);
    enemy.state = 'hold';
    enemy.path = [];
    enemy.pathI = 0;
    p.body.position.set(-18, 0, 10);
    for (let i = 0; i < 5; i += 1) {
      const dx = enemy.body.position.x - p.body.position.x;
      const dy = 1.4 - (p.body.position.y + p.body.eye);
      const dz = enemy.body.position.z - p.body.position.z;
      const len = Math.hypot(dx, dy, dz) || 1;
      p.body.yaw = Math.atan2(-dx, -dz);
      p.body.pitch = Math.asin(Math.max(-1, Math.min(1, dy / len)));
      syncCamera();
      sim.shootPlayer();
      settle(6);
    }
  }
  check('shots fired', sim.state.stats.shots > shotsBefore);
  check('shots hit something', sim.state.stats.hits > 0);
  check('player health sane', p.health >= 0 && p.health <= 100);
  window.__selftest = out;
  console.log(`[selftest] ${out.ok ? 'ALL PASS' : 'FAILURES PRESENT'}`);
}

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

syncCamera();
if (shot) runShot(shot);
else if (selftest) {
  hud.hideOverlay();
  runSelftest();
  requestAnimationFrame(frame);
} else {
  requestAnimationFrame(frame);
}
