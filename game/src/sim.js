// The simulation: one state object, one fixed 60 Hz step, rendering kept
// apart. It owns the player, the bomb, the projectiles, the tracers and the
// win conditions; rounds.js owns the phase clock, bots.js the bot brains,
// weapons.js the gun numbers. No allocation in the hot loops: raycasters,
// vectors and the tracer/impact pools are created once and reused.
import * as THREE from 'three';
import { createPlayer, stepBody } from './player.js';
import { WEAPONS, GRENADES, ORDER } from './weapons.js';
import { ROUND_SECONDS, DETONATE_SECONDS, START_MONEY, KILL_REWARD, WIN_ROUNDS } from './rounds.js';

const EYE = 1.6;
const PLANT_RANGE = 4;

export function createSim(deps) {
  const { scene, camera, map, rig, bots, rounds, hud, audio, seed } = deps;
  let a = seed >>> 0;
  function rng() {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  const player = createPlayer(map.colliders);
  const state = {
    time: 0,
    bots: bots.bots,
    player: {
      body: player.body,
      health: 100,
      armor: 0,
      money: START_MONEY,
      alive: true,
      loadout: { p9: { mag: WEAPONS.p9.mag, reserve: WEAPONS.p9.reserve } },
      grenades: { frag: 0, smoke: 0, flash: 0 },
      current: 'p9',
      kills: 0,
      deaths: 0,
      planting: 0,
      flashT: 0,
      blinded: 0,
    },
    bomb: { state: 'carried', carrier: 'player', pos: new THREE.Vector3(0, 0, 16), site: null, explodeT: 0, beepT: 0 },
    projectiles: [],
    smokes: [],
    noise: null,
    stats: { shots: 0, hits: 0 },
    matchShown: false,
  };

  // Player hitboxes: invisible meshes the bots' raycasts can hit.
  const hitMat = new THREE.MeshBasicMaterial({ visible: false });
  const playerHits = [];
  function hitMesh(w, h, d, y, part) {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), hitMat);
    m.position.y = y;
    m.userData = { part, isPlayer: true };
    scene.add(m);
    playerHits.push(m);
    return m;
  }
  hitMesh(0.42, 0.7, 0.26, 0.45, 'legs');
  hitMesh(0.5, 0.78, 0.3, 1.0, 'body');
  const headMesh = new THREE.Mesh(new THREE.SphereGeometry(0.16, 10, 8), hitMat);
  headMesh.position.y = 1.56;
  headMesh.userData = { part: 'head', isPlayer: true };
  scene.add(headMesh);
  playerHits.push(headMesh);

  // Tracers: a pool of two-point lines, reused, never allocated per shot.
  const tracers = [];
  for (let i = 0; i < 12; i += 1) {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(6), 3));
    const line = new THREE.Line(geo, new THREE.LineBasicMaterial({ color: 0xffc46b, transparent: true, opacity: 0 }));
    line.visible = false;
    scene.add(line);
    tracers.push({ line, t: 0 });
  }
  let tracerI = 0;

  // Impact marks: a pool of dark discs stuck to the surface a bullet hit.
  const impacts = [];
  const impactGeo = new THREE.CircleGeometry(0.09, 10);
  const impactMat = new THREE.MeshBasicMaterial({ color: 0x1a140e, transparent: true, opacity: 0.85 });
  for (let i = 0; i < 24; i += 1) {
    const m = new THREE.Mesh(impactGeo, impactMat);
    m.visible = false;
    scene.add(m);
    impacts.push({ mesh: m, t: 0 });
  }
  let impactI = 0;

  // Smoke clouds: five translucent spheres per cloud, one shared geometry.
  const smokeGeo = new THREE.SphereGeometry(1, 12, 10);
  const smokeMat = new THREE.MeshBasicMaterial({ color: 0x9a938a, transparent: true, opacity: 0.55, depthWrite: false });

  const raycaster = new THREE.Raycaster();
  raycaster.far = 90;
  const _dir = new THREE.Vector3();
  const _from = new THREE.Vector3();
  const _to = new THREE.Vector3();
  const _eye = new THREE.Vector3();
  const _hit = new THREE.Vector3();
  const _muzzle = new THREE.Vector3();

  const shootables = map.shootables.concat(bots.hitMeshes, playerHits);

  function addTracer(from, to) {
    const t = tracers[tracerI];
    tracerI = (tracerI + 1) % tracers.length;
    const pos = t.line.geometry.attributes.position;
    pos.setXYZ(0, from.x, from.y, from.z);
    pos.setXYZ(1, to.x, to.y, to.z);
    pos.needsUpdate = true;
    t.line.visible = true;
    t.line.material.opacity = 0.9;
    t.t = 0.07;
  }

  function addImpact(point, normal) {
    const im = impacts[impactI];
    impactI = (impactI + 1) % impacts.length;
    im.mesh.position.copy(point).addScaledVector(normal, 0.01);
    im.mesh.lookAt(_hit.copy(point).add(normal));
    im.mesh.visible = true;
    im.t = 6;
  }

  function smokeBlocked(a, b) {
    for (const s of state.smokes) {
      // Segment-sphere test against each puff of the cloud.
      for (const puff of s.puffs) {
        _dir.subVectors(b, a);
        const len = _dir.length();
        if (len < 0.001) continue;
        _dir.divideScalar(len);
        _to.subVectors(puff, a);
        const t = Math.max(0, Math.min(len, _to.dot(_dir)));
        const closest = _from.copy(a).addScaledVector(_dir, t);
        if (closest.distanceToSquared(puff) < s.r * s.r) return true;
      }
    }
    return false;
  }

  function blocked(a, b) {
    return map.lineBlocked(a.x, a.y, a.z, b.x, b.y, b.z) || smokeBlocked(a, b);
  }

  function partMult(part) {
    return part === 'head' ? 3 : part === 'body' ? 1 : 0.75;
  }

  function applyArmor(target, amount) {
    let left = amount;
    if (target.armor > 0) {
      const absorbed = Math.min(target.armor, amount * 0.5);
      target.armor -= absorbed;
      left = amount - absorbed;
    }
    return left;
  }

  function killFeed(killer, victim, weapon, killerTeam, victimTeam) {
    hud.feed(killer, victim, weapon, killerTeam, victimTeam);
  }

  function damageBot(bot, amount, part, attackerName, attackerTeam, weaponName) {
    if (!bot.alive) return;
    bot.health -= applyArmor(bot, amount * partMult(part));
    if (bot.health <= 0) {
      bot.health = 0;
      bot.alive = false;
      bot.state = 'dead';
      killFeed(attackerName, bot.name, weaponName, attackerTeam, bot.team);
      if (attackerTeam === 'atk') {
        state.player.money += KILL_REWARD;
        if (attackerName === 'Zephyr') {
          state.player.kills += 1;
          audio.kill();
        }
      }
      if (state.bomb.carrier === bot) dropBomb(bot.body.position);
    }
  }

  function damagePlayer(amount, fromPos, attackerName, weaponName) {
    const p = state.player;
    if (!p.alive) return;
    p.health -= applyArmor(p, amount);
    audio.hurt();
    const dx = fromPos.x - p.body.position.x;
    const dz = fromPos.z - p.body.position.z;
    const ang = Math.atan2(-dx, -dz) - p.body.yaw;
    hud.damageFrom(ang);
    if (p.health <= 0) {
      p.health = 0;
      p.alive = false;
      p.deaths += 1;
      killFeed(attackerName, 'Zephyr', weaponName, 'def', 'atk');
      if (state.bomb.carrier === 'player') dropBomb(p.body.position);
    }
  }

  function dropBomb(pos) {
    state.bomb.state = 'dropped';
    state.bomb.carrier = null;
    state.bomb.pos.set(pos.x, 0, pos.z);
  }

  function fireRay(from, dir, maxDist, shooter) {
    raycaster.set(from, dir);
    raycaster.far = maxDist;
    const hits = raycaster.intersectObjects(shootables, false);
    for (const hit of hits) {
      const obj = hit.object;
      if (shooter === 'player' && obj.userData.isPlayer) continue;
      return hit;
    }
    return null;
  }

  function shootPlayer() {
    const p = state.player;
    if (!rig.takeRound()) {
      audio.dry();
      rig.reload();
      return;
    }
    const def = rig.def();
    state.stats.shots += 1;
    camera.getWorldDirection(_dir);
    const spread = rig.spread(player.groundSpeed(), !p.body.onGround);
    _dir.x += (rng() * 2 - 1) * spread;
    _dir.y += (rng() * 2 - 1) * spread;
    _dir.z += (rng() * 2 - 1) * spread;
    _dir.normalize();
    _from.copy(camera.position);
    scene.updateMatrixWorld(true);
    const hit = fireRay(_from, _dir, 90, 'player');
    const end = hit ? hit.point : _to.copy(_from).addScaledVector(_dir, 80);
    // The tracer leaves the muzzle, not the camera: from the camera it
    // would lie exactly on the view ray and foreshorten to a dot.
    _muzzle.set(0.24, -0.18, -0.95).applyMatrix4(camera.matrixWorld);
    addTracer(_muzzle, end);
    if (hit) {
      const obj = hit.object;
      if (obj.userData.bot && obj.userData.bot.team !== 'atk') {
        const bot = obj.userData.bot;
        const dist = hit.distance;
        const falloff = dist > def.range ? Math.max(0.5, 1 - (dist - def.range) / def.range) : 1;
        damageBot(bot, def.damage * falloff, obj.userData.part, 'Zephyr', 'atk', def.name);
        state.stats.hits += 1;
        hud.hitMarker(!bot.alive);
        audio.hit();
      } else if (!obj.userData.bot) {
        addImpact(hit.point, hit.face.normal);
      }
    }
    rig.pullTrigger();
    player.recoil(def.kick * (0.9 + rng() * 0.2), (rng() * 2 - 1) * def.kick * 0.4);
    audio.shot(def.kind);
    state.noise = { x: p.body.position.x, z: p.body.position.z, t: state.time };
  }

  function shootFrom(bot, target, spread) {
    const def = WEAPONS[bot.weaponKey];
    eyePos(bot, _from);
    _to.set(target.pos.x, target.pos.y + 1.3, target.pos.z);
    _dir.subVectors(_to, _from).normalize();
    _dir.x += (rng() * 2 - 1) * spread;
    _dir.y += (rng() * 2 - 1) * spread;
    _dir.z += (rng() * 2 - 1) * spread;
    _dir.normalize();
    scene.updateMatrixWorld(true);
    const hit = fireRay(_from, _dir, 90, bot);
    const end = hit ? hit.point : _to.copy(_from).addScaledVector(_dir, 80);
    addTracer(_from, end);
    if (hit) {
      const obj = hit.object;
      const dist = hit.distance;
      const falloff = dist > def.range ? Math.max(0.5, 1 - (dist - def.range) / def.range) : 1;
      if (obj.userData.isPlayer) {
        damagePlayer(def.damage * falloff * partMult(obj.userData.part), bot.body.position, bot.name, def.name);
      } else if (obj.userData.bot && obj.userData.bot !== bot && obj.userData.bot.team !== bot.team) {
        damageBot(obj.userData.bot, def.damage * falloff, obj.userData.part, bot.name, bot.team, def.name);
      } else if (!obj.userData.bot) {
        addImpact(hit.point, hit.face.normal);
      }
    }
    audio.shot(def.kind);
    state.noise = { x: bot.body.position.x, z: bot.body.position.z, t: state.time };
  }

  function eyePos(bot, out) {
    out.set(bot.body.position.x, bot.body.position.y + bot.body.eye, bot.body.position.z);
    return out;
  }

  function inSite(pos, site) {
    const s = map.sites[site];
    return Math.abs(pos.x - s.center.x) < s.half && Math.abs(pos.z - s.center.z) < s.half;
  }

  function throwGrenade(kind) {
    const p = state.player;
    if ((p.grenades[kind] || 0) <= 0) return;
    p.grenades[kind] -= 1;
    camera.getWorldDirection(_dir);
    const proj = {
      kind,
      pos: new THREE.Vector3(camera.position.x, camera.position.y - 0.1, camera.position.z),
      vel: _dir.clone().multiplyScalar(16).add(new THREE.Vector3(0, 4.5, 0)),
      fuse: GRENADES[kind].fuse,
      bounced: false,
    };
    state.projectiles.push(proj);
    audio.dry();
  }

  function explodeFrag(pos) {
    audio.explosion();
    const targets = [];
    if (state.player.alive) targets.push({ pos: state.player.body.position, isPlayer: true, bot: null });
    for (const bot of bots.bots) if (bot.alive) targets.push({ pos: bot.body.position, isPlayer: false, bot });
    for (const t of targets) {
      const dist = Math.hypot(t.pos.x - pos.x, t.pos.z - pos.z) + Math.abs(1.2 - pos.y) * 0.5;
      if (dist > GRENADES.frag.radius) continue;
      const falloff = 1 - dist / (GRENADES.frag.radius * 1.4);
      _a.set(t.pos.x, 1.2, t.pos.z);
      const amount = GRENADES.frag.damage * Math.max(0.25, falloff) * (blocked(pos, _a) ? 0.5 : 1);
      if (t.isPlayer) damagePlayer(amount, pos, 'Frag', 'Frag');
      else damageBot(t.bot, amount, 'body', 'Zephyr', 'atk', 'Frag');
    }
  }

  const _a = new THREE.Vector3();
  const _b = new THREE.Vector3();

  function detonateGrenade(proj) {
    if (proj.kind === 'frag') {
      explodeFrag(proj.pos);
    } else if (proj.kind === 'smoke') {
      // One cloud record: the puffs' positions for the line-of-sight test,
      // the meshes for the look, both removed together when it expires.
      const puffs = [];
      const meshes = [];
      for (let i = 0; i < 5; i += 1) {
        const mesh = new THREE.Mesh(smokeGeo, smokeMat);
        mesh.position.set(proj.pos.x + (rng() * 2 - 1) * 1.5, 1.2 + rng() * 0.8, proj.pos.z + (rng() * 2 - 1) * 1.5);
        mesh.scale.setScalar(0.5);
        scene.add(mesh);
        puffs.push(mesh.position);
        meshes.push(mesh);
      }
      state.smokes.push({ puffs, meshes, r: 3.5, t: GRENADES.smoke.duration });
    } else if (proj.kind === 'flash') {
      flashAt(proj.pos, null);
    }
  }

  function flashAt(pos, thrower) {
    audio.flash();
    // The player: blinded when the pop is in view, in line of sight, close.
    const p = state.player;
    if (p.alive) {
      _a.subVectors(pos, camera.position);
      const dist = _a.length();
      camera.getWorldDirection(_b);
      const facing = _a.normalize().dot(_b);
      if (dist < GRENADES.flash.radius && facing > 0.2 && !map.lineBlocked(camera.position.x, camera.position.y, camera.position.z, pos.x, pos.y, pos.z)) {
        p.flashT = GRENADES.flash.duration * (1 - dist / GRENADES.flash.radius) + 0.4;
        hud.flashScreen(Math.min(1, p.flashT));
      }
    }
    for (const bot of bots.bots) {
      if (!bot.alive || bot === thrower) continue;
      eyePos(bot, _a);
      const dist = _a.distanceTo(pos);
      if (dist < GRENADES.flash.radius && !map.lineBlocked(_a.x, _a.y, _a.z, pos.x, pos.y, pos.z)) {
        bot.blinded = GRENADES.flash.duration * (1 - dist / GRENADES.flash.radius);
        bot.state = 'hold';
      }
    }
  }

  function enemiesOf(bot) {
    const out = [];
    if (bot.team === 'def' && state.player.alive) {
      out.push({ pos: state.player.body.position, alive: true, isPlayer: true, name: 'Zephyr', team: 'atk' });
    }
    for (const other of bots.bots) {
      if (other.team !== bot.team && other.alive) {
        out.push({ pos: other.body.position, alive: true, isPlayer: false, name: other.name, team: other.team });
      }
    }
    return out;
  }

  function botCtx() {
    return {
      time: state.time,
      phase: rounds.state.phase,
      noise: state.noise,
      enemiesOf,
      blocked: (a, b) => blocked(a, b),
      shootFrom,
      rushing: (bot) => rounds.state.phase === 'live' && bot.team === 'atk' && bot.state === 'move',
      destinationFor(bot) {
        if (bot.team === 'atk') {
          if (state.bomb.state === 'dropped') return bots.nearestNode(state.bomb.pos.x, state.bomb.pos.z);
          if (state.bomb.state === 'planted') return bots.nearestNode(map.sites[state.bomb.site].center.x, map.sites[state.bomb.site].center.z);
          return bot.plan === 'A' ? 6 : bot.plan === 'B' ? 17 : 11;
        }
        if (state.bomb.state === 'planted') {
          return bots.nearestNode(map.sites[state.bomb.site].center.x, map.sites[state.bomb.site].center.z);
        }
        return bot.holdNode;
      },
      atSite(bot) {
        return inSite(bot.body.position, bot.plan === 'B' ? 'B' : 'A') || inSite(bot.body.position, bot.plan === 'A' ? 'A' : 'B');
      },
      isCarrier: (bot) => state.bomb.carrier === bot,
      atPlantedSite(bot) {
        return state.bomb.state === 'planted' && inSite(bot.body.position, state.bomb.site);
      },
      shouldDefuse(bot) {
        if (state.bomb.state !== 'planted') return false;
        const defs = bots.bots.filter((b) => b.team === 'def' && b.alive);
        return defs.length > 0 && defs[0] === bot;
      },
      onPlanted(bot) {
        state.bomb.state = 'planted';
        state.bomb.site = inSite(bot.body.position, 'A') ? 'A' : 'B';
        state.bomb.explodeT = DETONATE_SECONDS;
        state.bomb.beepT = 0;
        rounds.state.timer = 999;
        audio.plant();
        hud.banner('BOMB PLANTED', 3000);
      },
      onDefused(bot) {
        rounds.endRound('def', 'defuse', state.player);
        audio.sting(false);
        hud.banner('BOMB DEFUSED — DEFENDERS WIN', 3800);
      },
    };
  }

  function resetPositions() {
    const p = state.player;
    p.body.position.set(0, 0, 17);
    p.body.velocity.set(0, 0, 0);
    p.body.yaw = 0;
    p.body.pitch = 0;
    p.health = 100;
    p.alive = true;
    p.planting = 0;
    p.flashT = 0;
    bots.reset(map.spawns.atk, map.spawns.def);
  }

  function resetMatch() {
    const p = state.player;
    p.money = START_MONEY;
    p.loadout = { p9: { mag: WEAPONS.p9.mag, reserve: WEAPONS.p9.reserve } };
    p.grenades = { frag: 0, smoke: 0, flash: 0 };
    p.armor = 0;
    p.current = 'p9';
    p.kills = 0;
    p.deaths = 0;
    state.bomb.state = 'carried';
    state.bomb.carrier = 'player';
    state.bomb.site = null;
    state.projectiles = [];
    state.smokes = [];
    state.matchShown = false;
    rig.switchTo('p9', WEAPONS.p9.mag, WEAPONS.p9.reserve);
    rig.models.p9.visible = true;
    rounds.startMatch();
    resetPositions();
  }

  function startRound() {
    state.bomb.state = 'carried';
    state.bomb.carrier = 'player';
    state.bomb.site = null;
    state.projectiles = [];
    for (const s of state.smokes) {
      for (const mesh of s.meshes) scene.remove(mesh);
    }
    state.smokes = [];
    rounds.startRound();
    resetPositions();
  }

  function syncLoadout() {
    const cur = state.player.current;
    state.player.loadout[cur] = { mag: rig.state.mag, reserve: rig.state.reserve };
  }

  function switchWeapon(key) {
    const p = state.player;
    if (!p.loadout[key] || key === p.current) return;
    syncLoadout();
    p.current = key;
    const ammo = p.loadout[key];
    rig.switchTo(key, ammo.mag, ammo.reserve);
    audio.dry();
  }

  function step(dt, input) {
    state.time += dt;
    const p = state.player;
    const rs = rounds.state;

    // --- Player input (live play only; the shot hooks drive the sim directly).
    if (p.alive && (rs.phase === 'live' || rs.phase === 'buy' || rs.phase === 'freeze')) {
      const look = input.takeLook();
      if (p.flashT > 0) {
        player.look(look.x * 0.3, look.y * 0.3);
      } else {
        player.look(look.x, look.y);
      }
      player.step(dt, input.state.keys, input.state.ads);
      if (input.state.ads && rig.def().zoom) {
        camera.fov += (rig.def().zoom - camera.fov) * Math.min(1, dt * 10);
        camera.updateProjectionMatrix();
      } else if (camera.fov !== 74) {
        camera.fov += (74 - camera.fov) * Math.min(1, dt * 10);
        camera.updateProjectionMatrix();
      }
    }
    if (p.flashT > 0) p.flashT = Math.max(0, p.flashT - dt);

    // --- Weapon input.
    if (p.alive && rs.phase === 'live') {
      if (input.state.firing && rig.ready()) {
        if (rig.def().auto) shootPlayer();
        else if (input.wasPressed('MouseLeft')) shootPlayer();
      }
      if (input.wasPressed('KeyR')) rig.reload();
      if (input.wasPressed('KeyG')) throwGrenade(rig.state.grenade);
      if (input.wasPressed('KeyH')) {
        const order = ['frag', 'smoke', 'flash'];
        const i = order.indexOf(rig.state.grenade);
        rig.state.grenade = order[(i + 1) % order.length];
      }
    }
    if (input.wasPressed('KeyR') && rs.phase !== 'live') rig.reload();
    const wheel = input.takeWheel();
    if (wheel !== 0 && p.alive) {
      const owned = ORDER.filter((k) => p.loadout[k]);
      const i = owned.indexOf(p.current);
      const next = owned[(i + (wheel > 0 ? 1 : -1) + owned.length) % owned.length];
      if (next) switchWeapon(next);
    }
    for (let i = 0; i < ORDER.length; i += 1) {
      if (input.wasPressed(`Digit${i + 1}`)) switchWeapon(ORDER[i]);
    }

    // --- Buy menu.
    if (input.wasPressed('KeyB') && (rs.phase === 'freeze' || rs.phase === 'buy')) {
      rs.buyOpen = !rs.buyOpen;
      if (rs.buyOpen) hud.showBuy(p.money);
      else hud.hideBuy();
    }
    if (rs.buyOpen) {
      for (const item of ['wasp', 'jackal', 'longshot', 'frag', 'smoke', 'flash', 'armor']) {
        const key = { wasp: 'Digit2', jackal: 'Digit3', longshot: 'Digit4', frag: 'Digit5', smoke: 'Digit6', flash: 'Digit7', armor: 'Digit8' }[item];
        if (input.wasPressed(key)) {
          const result = rounds.buy(p, item);
          hud.markBuy(item, result);
          hud.setMoney(p.money);
          if (result === 'ok') {
            audio.buy();
            if (WEAPONS[item]) switchWeapon(item);
          } else audio.denied();
        }
      }
      if (rs.phase === 'live') {
        rs.buyOpen = false;
        hud.hideBuy();
      }
    }

    // --- Plant / defuse: hold E in a site zone.
    if (p.alive && rs.phase === 'live' && state.bomb.carrier === 'player') {
      const site = inSite(p.body.position, 'A') ? 'A' : inSite(p.body.position, 'B') ? 'B' : null;
      if (site && input.state.keys.has('KeyE')) {
        p.planting += dt / 3;
        if (p.planting >= 1) {
          p.planting = 0;
          state.bomb.state = 'planted';
          state.bomb.site = site;
          state.bomb.explodeT = DETONATE_SECONDS;
          state.bomb.beepT = 0;
          rounds.state.timer = 999;
          audio.plant();
          hud.banner('BOMB PLANTED', 3000);
        }
      } else {
        p.planting = Math.max(0, p.planting - dt / 1.5);
      }
      hud.setPlant(site ? p.planting : null, site ? `PLANTING AT ${site} — HOLD E` : '');
    } else {
      hud.setPlant(null, '');
      p.planting = Math.max(0, p.planting - dt / 1.5);
    }

    // --- Bomb pickup by walking over it.
    if (state.bomb.state === 'dropped') {
      if (p.alive && p.body.position.distanceTo(state.bomb.pos) < 1.4) {
        state.bomb.state = 'carried';
        state.bomb.carrier = 'player';
      } else {
        for (const bot of bots.bots) {
          if (bot.team === 'atk' && bot.alive && bot.body.position.distanceTo(state.bomb.pos) < 1.4) {
            state.bomb.state = 'carried';
            state.bomb.carrier = bot;
            bot.state = 'move';
            bot.path = [];
            bot.pathI = 0;
            break;
          }
        }
      }
    }

    // --- Bomb countdown.
    if (state.bomb.state === 'planted') {
      state.bomb.explodeT -= dt;
      state.bomb.beepT -= dt;
      if (state.bomb.beepT <= 0) {
        audio.beep(state.bomb.explodeT < 10);
        state.bomb.beepT = state.bomb.explodeT < 10 ? 0.5 : 1;
      }
      if (state.bomb.explodeT <= 0) {
        audio.explosion();
        rounds.endRound('atk', 'detonation', p);
        audio.sting(true);
        hud.banner('BOMB DETONATED — ATTACKERS WIN', 3800);
      }
    }

    // --- Projectiles.
    for (let i = state.projectiles.length - 1; i >= 0; i -= 1) {
      const proj = state.projectiles[i];
      proj.vel.y -= 14 * dt;
      proj.pos.addScaledVector(proj.vel, dt);
      if (proj.pos.y < 0.08) {
        proj.pos.y = 0.08;
        proj.vel.y *= -0.4;
        proj.vel.x *= 0.7;
        proj.vel.z *= 0.7;
        proj.bounced = true;
      }
      proj.fuse -= dt;
      if (proj.fuse <= 0) {
        detonateGrenade(proj);
        state.projectiles.splice(i, 1);
      }
    }

    // --- Smoke clouds grow and fade; expired clouds take their meshes out.
    for (let i = state.smokes.length - 1; i >= 0; i -= 1) {
      const s = state.smokes[i];
      s.t -= dt;
      if (s.t <= 0) {
        for (const mesh of s.meshes) scene.remove(mesh);
        state.smokes.splice(i, 1);
      }
    }

    // --- Tracers and impacts fade.
    for (const t of tracers) {
      if (t.t > 0) {
        t.t -= dt;
        t.line.material.opacity = Math.max(0, t.t / 0.07) * 0.9;
        if (t.t <= 0) t.line.visible = false;
      }
    }
    for (const im of impacts) {
      if (im.t > 0) {
        im.t -= dt;
        if (im.t <= 0) im.mesh.visible = false;
      }
    }

    // --- Bots.
    if (rs.phase === 'live' || rs.phase === 'buy') {
      bots.step(dt, botCtx());
    }

    // --- Round clock and win checks.
    const phaseBefore = rs.phase;
    rounds.step(dt, {
      onLive() {
        audio.round();
        hud.banner(`ROUND ${rs.roundNo} — FIGHT`, 2200);
        hud.hideBuy();
        rs.buyOpen = false;
      },
      onTimeOut() {
        if (state.bomb.state === 'planted') return;
        rounds.endRound('def', 'time', p);
        audio.sting(false);
        hud.banner('TIME — DEFENDERS WIN', 3800);
      },
      onRoundStart() {
        startRound();
      },
    });
    if (phaseBefore === 'end' && rs.phase === 'freeze') {
      // startRound already ran via onRoundStart.
    }

    if (rs.phase === 'live') {
      const atkAlive = (p.alive ? 1 : 0) + bots.aliveCount('atk');
      const defAlive = bots.aliveCount('def');
      if (defAlive === 0 && state.bomb.state !== 'planted') {
        rounds.endRound('atk', 'elimination', p);
        audio.sting(true);
        hud.banner('ALL DEFENDERS DOWN — ATTACKERS WIN', 3800);
      } else if (atkAlive === 0 && state.bomb.state !== 'planted') {
        rounds.endRound('def', 'elimination', p);
        audio.sting(false);
        hud.banner('ALL ATTACKERS DOWN — DEFENDERS WIN', 3800);
      }
      if (rs.matchOver && !state.matchShown) {
        state.matchShown = true;
        hud.showOverlay('match', { winner: rs.scoreA >= WIN_ROUNDS ? 'atk' : 'def', scoreA: rs.scoreA, scoreB: rs.scoreB, kills: p.kills });
      }
    }

    // --- Player hitboxes follow the body; camera follows the head.
    for (const m of playerHits) {
      m.position.x = p.body.position.x;
      m.position.z = p.body.position.z;
      m.rotation.y = p.body.yaw;
    }
    playerHits[0].position.y = p.body.position.y + 0.45;
    playerHits[1].position.y = p.body.position.y + 1.0;
    headMesh.position.y = p.body.position.y + 1.56;

    // --- HUD sync (the HUD only writes the DOM when a value moved).
    syncLoadout();
    hud.setHealth(p.health, p.armor);
    hud.setAmmo(rig.state.mag, rig.state.reserve, rig.def().name);
    hud.setMoney(p.money);
    hud.setTimer(state.bomb.state === 'planted' ? state.bomb.explodeT : rs.timer);
    hud.setScore(rs.scoreA, rs.scoreB);
    hud.setAlive((p.alive ? 1 : 0) + bots.aliveCount('atk'), bots.aliveCount('def'));
    hud.setCrosshair(rig.spread(player.groundSpeed(), !p.body.onGround));
    if (state.bomb.state === 'planted') {
      hud.setBomb(`BOMB PLANTED ${state.bomb.site} — ${Math.ceil(state.bomb.explodeT)}s`, state.bomb.explodeT < 10);
    } else if (state.bomb.carrier === 'player') {
      hud.setBomb('YOU CARRY THE BOMB — PLANT AT A OR B', false);
    } else if (state.bomb.state === 'dropped') {
      hud.setBomb('BOMB DROPPED — PICK IT UP', true);
    } else {
      hud.setBomb('', false);
    }
    if (rs.phase === 'freeze') hud.setHint('FREEZE — ROUND STARTS SOON');
    else if (rs.phase === 'buy') hud.setHint('BUY PHASE — PRESS B FOR THE BUY MENU');
    else if (rs.phase === 'live') hud.setHint('');
    else if (rs.phase === 'end') hud.setHint('');
  }

  return {
    state,
    player,
    resetMatch,
    startRound,
    step,
    shootPlayer,
    throwGrenade,
    switchWeapon,
    syncLoadout,
    inSite,
    rng,
  };
}
