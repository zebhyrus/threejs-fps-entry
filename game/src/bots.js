// Bots: five attackers' teammates and five defenders, all driven by the same
// body physics as the player. They walk a waypoint graph, hold angles, react
// to what they see and hear, burst-fire with distance falloff, strafe in a
// fight, plant and defuse the bomb, and rotate when the objective moves.
// One bot per role; the sim owns damage, the map owns line of sight.
import * as THREE from 'three';
import { PALETTE } from './palette.js';
import { createBody, stepBody, SPEEDS } from './player.js';
import { WEAPONS } from './weapons.js';

const ATK_NAMES = ['Dune', 'Mirage', 'Cinder', 'Vesper'];
const DEF_NAMES = ['Onyx', 'Havoc', 'Sable', 'Rook', 'Ibis'];
const HOLD_YAW = { A: Math.PI, B: Math.PI, mid: Math.PI, spawn: 0 };

function mulberry32(initial) {
  let a = initial;
  return function random() {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function createBots(scene, map, seed) {
  const rng = mulberry32(seed);
  const { nodes, adjacency } = map.waypoints;
  const bots = [];
  const hitMeshes = [];

  const atkMat = new THREE.MeshStandardMaterial({ color: new THREE.Color(PALETTE.ochre), roughness: 0.85 });
  const defMat = new THREE.MeshStandardMaterial({ color: new THREE.Color(PALETTE.concrete), roughness: 0.85 });
  const darkMat = new THREE.MeshStandardMaterial({ color: new THREE.Color(PALETTE.dark), roughness: 0.9 });
  const allyVisor = new THREE.MeshStandardMaterial({ color: new THREE.Color(PALETTE.ally), roughness: 0.4 });
  const enemyVisor = new THREE.MeshStandardMaterial({ color: new THREE.Color(PALETTE.enemy), roughness: 0.4 });

  function nearestNode(x, z) {
    let best = 0;
    let bestD = Infinity;
    for (let i = 0; i < nodes.length; i += 1) {
      const dx = nodes[i][0] - x;
      const dz = nodes[i][1] - z;
      const d = dx * dx + dz * dz;
      if (d < bestD) {
        bestD = d;
        best = i;
      }
    }
    return best;
  }

  function findPath(from, to) {
    if (from === to) return [to];
    const prev = new Array(nodes.length).fill(-1);
    const queue = [from];
    prev[from] = from;
    while (queue.length) {
      const cur = queue.shift();
      for (const next of adjacency[cur]) {
        if (prev[next] !== -1) continue;
        prev[next] = cur;
        if (next === to) {
          const path = [to];
          let n = to;
          while (n !== from) {
            n = prev[n];
            path.unshift(n);
          }
          return path;
        }
        queue.push(next);
      }
    }
    return [to];
  }

  function makeBot(id, team, name, x, z, weaponKey) {
    const body = createBody(x, z, team === 'atk' ? 0 : Math.PI);
    const group = new THREE.Group();
    const mat = team === 'atk' ? atkMat : defMat;
    const visor = team === 'atk' ? allyVisor : enemyVisor;
    const legs = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.7, 0.26), darkMat);
    legs.position.y = 0.45;
    const torso = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.78, 0.3), mat);
    torso.position.y = 1.0;
    const head = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.28, 0.28), mat);
    head.position.y = 1.56;
    const visorMesh = new THREE.Mesh(new THREE.BoxGeometry(0.26, 0.08, 0.02), visor);
    visorMesh.position.set(0, 1.58, -0.15);
    const gun = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.1, 0.55), darkMat);
    gun.position.set(0.18, 1.15, -0.3);
    group.add(legs, torso, head, visorMesh, gun);
    group.traverse((m) => {
      if (m.isMesh) {
        m.castShadow = true;
      }
    });
    scene.add(group);
    const bot = {
      id, team, name, body, group, weaponKey,
      health: 100, armor: 0, alive: true,
      role: 'hold', plan: 'A', path: [], pathI: 0,
      state: 'move', holdNode: 0, holdYaw: 0,
      reactT: 0, burstLeft: 0, burstT: 0, aimT: 0,
      strafeDir: 1, strafeT: 0, fall: 0, seenT: -99, blinded: 0,
      target: null, plantT: 0, defuseT: 0, investigateT: 0, scanT: rng() * 6,
      lastShotT: -99, speed: SPEEDS.BOT,
    };
    legs.userData = { bot, part: 'legs' };
    torso.userData = { bot, part: 'body' };
    head.userData = { bot, part: 'head' };
    bot.hitMeshes = [legs, torso, head];
    hitMeshes.push(legs, torso, head);
    bots.push(bot);
    return bot;
  }

  function reset(atkSpawns, defSpawns) {
    for (let i = 0; i < bots.length; i += 1) {
      const bot = bots[i];
      const spawn = bot.team === 'atk' ? atkSpawns[i % atkSpawns.length] : defSpawns[i % defSpawns.length];
      bot.body.position.set(spawn.x, 0, spawn.z);
      bot.body.velocity.set(0, 0, 0);
      bot.body.yaw = bot.team === 'atk' ? 0 : Math.PI;
      bot.body.pitch = 0;
      bot.health = 100;
      bot.armor = 0;
      bot.alive = true;
      bot.fall = 0;
      bot.plantT = 0;
      bot.defuseT = 0;
      bot.state = 'move';
      bot.path = [];
      bot.pathI = 0;
      bot.target = null;
      bot.seenT = -99;
      bot.group.rotation.set(0, bot.body.yaw, 0);
      bot.group.visible = true;
    }
    // Attackers: two to A, one mid, one to B. Defenders: two A, two B, one mid.
    const atk = bots.filter((b) => b.team === 'atk');
    atk[0].plan = 'A';
    atk[1].plan = 'A';
    atk[2].plan = 'mid';
    atk[3].plan = 'B';
    atk[0].holdNode = 6;
    atk[1].holdNode = 5;
    atk[2].holdNode = 11;
    atk[3].holdNode = 17;
    const def = bots.filter((b) => b.team === 'def');
    def[0].plan = 'A';
    def[1].plan = 'A';
    def[2].plan = 'mid';
    def[3].plan = 'B';
    def[4].plan = 'B';
    def[0].holdNode = 22;
    def[1].holdNode = 23;
    def[2].holdNode = 26;
    def[3].holdNode = 24;
    def[4].holdNode = 25;
    for (const bot of bots) {
      bot.holdYaw = bot.team === 'def' ? (bot.plan === 'A' ? HOLD_YAW.A : bot.plan === 'B' ? HOLD_YAW.B : HOLD_YAW.mid) : 0;
    }
  }

  function makeAll() {
    for (let i = 0; i < 4; i += 1) {
      makeBot(i, 'atk', ATK_NAMES[i], -4 + i * 2, 16, i === 3 ? 'wasp' : 'jackal');
    }
    for (let i = 0; i < 5; i += 1) {
      makeBot(4 + i, 'def', DEF_NAMES[i], -4 + i * 2, -16, i === 4 ? 'longshot' : i === 2 ? 'wasp' : 'jackal');
    }
  }
  makeAll();

  function eyePos(bot, out) {
    out.set(bot.body.position.x, bot.body.position.y + bot.body.eye, bot.body.position.z);
    return out;
  }

  const _a = new THREE.Vector3();
  const _b = new THREE.Vector3();

  function step(dt, ctx) {
    for (const bot of bots) {
      if (!bot.alive) {
        bot.fall = Math.min(1, bot.fall + dt / 0.4);
        bot.group.rotation.x = -bot.fall * 1.5;
        continue;
      }
      const p = bot.body.position;
      // A flashed bot sees nothing and stands still until its eyes clear.
      if (bot.blinded > 0) {
        bot.blinded -= dt;
        bot.state = 'hold';
      }
      // --- Find a visible enemy: in range, in the view cone, line of sight clear.
      let enemy = null;
      let enemyDist = Infinity;
      const candidates = bot.blinded > 0 ? [] : ctx.enemiesOf(bot);
      for (const c of candidates) {
        if (!c.alive) continue;
        const dx = c.pos.x - p.x;
        const dz = c.pos.z - p.z;
        const dist = Math.hypot(dx, dz);
        if (dist > 45 || dist < enemyDist) continue;
        // View cone: ~100 degrees, or close enough to hear.
        const ang = Math.atan2(-dx, -dz);
        let diff = ang - bot.body.yaw;
        while (diff > Math.PI) diff -= Math.PI * 2;
        while (diff < -Math.PI) diff += Math.PI * 2;
        if (Math.abs(diff) > 0.95 && dist > 6) continue;
        eyePos(bot, _a);
        _b.set(c.pos.x, c.pos.y + 1.4, c.pos.z);
        if (ctx.blocked(_a, _b)) continue;
        enemy = c;
        enemyDist = dist;
      }
      if (enemy) {
        bot.target = enemy;
        bot.seenT = ctx.time;
        if (bot.state !== 'engage') {
          bot.state = 'engage';
          bot.reactT = 0.35 + rng() * 0.35;
          bot.aimT = 0;
          bot.burstLeft = 0;
        }
      } else if (bot.state === 'engage' && ctx.time - bot.seenT > 1.5) {
        bot.state = 'move';
        bot.target = null;
        bot.burstLeft = 0;
      }

      let wishX = 0;
      let wishZ = 0;
      let speed = SPEEDS.BOT;
      let crouch = false;

      if (bot.state === 'engage' && bot.target) {
        const t = bot.target;
        const dx = t.pos.x - p.x;
        const dz = t.pos.z - p.z;
        const wantYaw = Math.atan2(-dx, -dz);
        let diff = wantYaw - bot.body.yaw;
        while (diff > Math.PI) diff -= Math.PI * 2;
        while (diff < -Math.PI) diff += Math.PI * 2;
        bot.body.yaw += diff * Math.min(1, dt * 10);
        bot.aimT += dt;
        bot.reactT -= dt;
        if (bot.reactT <= 0) {
          bot.burstT -= dt;
          if (bot.burstLeft <= 0 && bot.burstT <= 0) {
            bot.burstLeft = 3 + Math.floor(rng() * 3);
            bot.burstT = 0.5 + rng() * 0.5;
          }
          if (bot.burstLeft > 0 && bot.burstT <= 0.55) {
            // One round of the burst, every 0.12 s.
            if (ctx.time - bot.lastShotT >= WEAPONS[bot.weaponKey].rate * 1.6) {
              const dist = Math.hypot(dx, dz);
              const spread = 0.012 + dist * 0.0009 - Math.min(0.006, bot.aimT * 0.002);
              ctx.shootFrom(bot, t, spread);
              bot.lastShotT = ctx.time;
              bot.burstLeft -= 1;
              bot.burstT = 0.12;
            }
          }
        }
        // Strafe sideways while fighting.
        bot.strafeT -= dt;
        if (bot.strafeT <= 0) {
          bot.strafeDir = rng() < 0.5 ? -1 : 1;
          bot.strafeT = 0.6 + rng() * 0.5;
        }
        const sin = Math.sin(bot.body.yaw);
        const cos = Math.cos(bot.body.yaw);
        wishX = cos * bot.strafeDir;
        wishZ = -sin * bot.strafeDir;
        speed = SPEEDS.BOT * 0.6;
      } else if (bot.state === 'plant') {
        bot.plantT += dt;
        if (bot.plantT >= 3) ctx.onPlanted(bot);
      } else if (bot.state === 'defuse') {
        bot.defuseT += dt;
        if (bot.defuseT >= 5) ctx.onDefused(bot);
      } else if (bot.state === 'hold') {
        // Hold an angle: slow scan, weapon ready.
        bot.scanT += dt;
        bot.body.yaw = bot.holdYaw + Math.sin(bot.scanT * 0.5) * 0.35;
      } else {
        // Move along the current path; replan when the objective changes.
        if (bot.pathI >= bot.path.length) {
          const dest = ctx.destinationFor(bot);
          if (dest !== null) {
            bot.path = findPath(nearestNode(p.x, p.z), dest);
            bot.pathI = 0;
          }
        }
        if (bot.pathI < bot.path.length) {
          const node = nodes[bot.path[bot.pathI]];
          const dx = node[0] - p.x;
          const dz = node[1] - p.z;
          const dist = Math.hypot(dx, dz);
          if (dist < 0.7) {
            bot.pathI += 1;
          } else {
            wishX = dx / dist;
            wishZ = dz / dist;
            bot.body.yaw = Math.atan2(-wishX, -wishZ);
            speed = ctx.rushing(bot) ? SPEEDS.BOT_RUSH : SPEEDS.BOT;
          }
        } else {
          // Arrived: attackers plant or hold, defenders hold.
          if (bot.team === 'atk' && ctx.atSite(bot)) {
            if (ctx.isCarrier(bot)) {
              bot.state = 'plant';
              bot.plantT = 0;
            } else {
              bot.state = 'hold';
              bot.holdYaw = bot.body.yaw;
            }
          } else if (bot.team === 'def' && ctx.atPlantedSite(bot)) {
            if (ctx.shouldDefuse(bot)) {
              bot.state = 'defuse';
              bot.defuseT = 0;
            } else {
              bot.state = 'hold';
              bot.holdYaw = bot.body.yaw;
            }
          } else {
            bot.state = 'hold';
            bot.holdYaw = bot.body.yaw;
          }
        }
      }

      // A noise nearby pulls a bot off its route to look.
      if (ctx.noise && bot.state !== 'engage' && bot.state !== 'plant' && bot.state !== 'defuse') {
        const dx = ctx.noise.x - p.x;
        const dz = ctx.noise.z - p.z;
        if (Math.hypot(dx, dz) < 25 && ctx.time - ctx.noise.t < 1.2) {
          bot.path = findPath(nearestNode(p.x, p.z), nearestNode(ctx.noise.x, ctx.noise.z));
          bot.pathI = 0;
          bot.state = 'move';
        }
      }

      stepBody(bot.body, map.colliders, dt, wishX, wishZ, speed, { crouch, jump: false });
      bot.group.position.copy(bot.body.position);
      bot.group.rotation.y = bot.body.yaw;
      // Walk bob: the body dips a little with each stride.
      const moving = Math.hypot(bot.body.velocity.x, bot.body.velocity.z);
      bot.group.position.y = bot.body.position.y + Math.abs(Math.sin(ctx.time * 9)) * 0.02 * Math.min(1, moving / 4);
    }
  }

  return {
    bots,
    hitMeshes,
    reset,
    step,
    nearestNode,
    findPath,
    aliveCount(team) {
      let n = 0;
      for (const bot of bots) if (bot.team === team && bot.alive) n += 1;
      return n;
    },
  };
}
