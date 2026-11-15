// Weapons: the numbers, the view models and the firing cycle. Hitscan guns
// with magazine, reserve, reload and spread that punishes moving; a sniper
// that zooms when aimed. Grenades are thrown, not hitscan: the sim owns the
// projectile, this module owns the definitions and the hand that throws it.
import * as THREE from 'three';
import { PALETTE } from './palette.js';

export const WEAPONS = {
  p9: {
    name: 'P9', kind: 'pistol', price: 0, damage: 26, headMult: 3, rate: 0.14,
    mag: 12, reserve: 48, reload: 1.4, spreadStill: 0.006, spreadMove: 0.02,
    spreadAir: 0.05, adsMult: 0.5, kick: 0.008, range: 25, auto: false,
  },
  wasp: {
    name: 'Wasp PDW-9', kind: 'smg', price: 1200, damage: 22, headMult: 3, rate: 0.075,
    mag: 30, reserve: 120, reload: 2.0, spreadStill: 0.008, spreadMove: 0.03,
    spreadAir: 0.06, adsMult: 0.55, kick: 0.006, range: 22, auto: true,
  },
  jackal: {
    name: 'Jackal AR-7', kind: 'rifle', price: 2700, damage: 33, headMult: 3, rate: 0.1,
    mag: 30, reserve: 90, reload: 2.2, spreadStill: 0.004, spreadMove: 0.024,
    spreadAir: 0.055, adsMult: 0.45, kick: 0.011, range: 35, auto: true,
  },
  longshot: {
    name: 'Longshot LR-50', kind: 'sniper', price: 4750, damage: 95, headMult: 3, rate: 1.1,
    mag: 5, reserve: 15, reload: 3.0, spreadStill: 0.001, spreadMove: 0.05,
    spreadAir: 0.09, adsMult: 0.3, kick: 0.045, range: 80, auto: false, zoom: 30,
  },
};

export const GRENADES = {
  frag: { name: 'Frag', price: 300, fuse: 1.6, radius: 6, damage: 100 },
  smoke: { name: 'Smoke', price: 300, fuse: 1.4, radius: 4, duration: 15 },
  flash: { name: 'Flash', price: 200, fuse: 1.2, radius: 25, duration: 2.5 },
};

export const ARMOR_PRICE = 650;
export const ORDER = ['p9', 'wasp', 'jackal', 'longshot'];

function boxMesh(w, h, d, material, x, y, z) {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), material);
  mesh.position.set(x, y, z);
  return mesh;
}

export function createWeaponRig(camera) {
  const grip = new THREE.MeshStandardMaterial({ color: new THREE.Color(PALETTE.dark), roughness: 0.7, metalness: 0.2 });
  const body = new THREE.MeshStandardMaterial({ color: new THREE.Color(PALETTE.ink), roughness: 0.5, metalness: 0.35 });
  const accent = new THREE.MeshStandardMaterial({ color: new THREE.Color(PALETTE.accent), roughness: 0.5, metalness: 0.2 });

  const models = {};
  // P9: a short pistol.
  {
    const g = new THREE.Group();
    g.add(boxMesh(0.05, 0.09, 0.2, body, 0, 0, -0.08));
    g.add(boxMesh(0.045, 0.07, 0.08, grip, 0, -0.07, 0.04));
    models.p9 = g;
  }
  // Wasp: a compact SMG with a long magazine.
  {
    const g = new THREE.Group();
    g.add(boxMesh(0.07, 0.09, 0.34, body, 0, 0, -0.1));
    g.add(boxMesh(0.04, 0.04, 0.22, grip, 0, 0.02, -0.34));
    g.add(boxMesh(0.05, 0.16, 0.06, grip, 0, -0.1, -0.08));
    g.add(boxMesh(0.06, 0.05, 0.16, grip, 0, -0.02, 0.22));
    models.wasp = g;
  }
  // Jackal: a rifle with a sight and a foregrip.
  {
    const g = new THREE.Group();
    g.add(boxMesh(0.08, 0.1, 0.46, body, 0, 0, -0.12));
    g.add(boxMesh(0.04, 0.04, 0.34, grip, 0, 0.025, -0.42));
    g.add(boxMesh(0.05, 0.05, 0.1, accent, 0, 0.07, -0.14));
    g.add(boxMesh(0.05, 0.12, 0.06, grip, 0, -0.09, -0.2));
    g.add(boxMesh(0.07, 0.08, 0.2, grip, 0, -0.02, 0.28));
    models.jackal = g;
  }
  // Longshot: a long bolt rifle with a scope.
  {
    const g = new THREE.Group();
    g.add(boxMesh(0.07, 0.09, 0.62, body, 0, 0, -0.2));
    g.add(boxMesh(0.035, 0.035, 0.3, grip, 0, 0.02, -0.6));
    g.add(boxMesh(0.05, 0.06, 0.16, accent, 0, 0.075, -0.2));
    g.add(boxMesh(0.06, 0.08, 0.18, grip, 0, -0.02, 0.26));
    models.longshot = g;
  }

  const rig = new THREE.Group();
  for (const key of ORDER) {
    models[key].visible = false;
    rig.add(models[key]);
  }
  rig.position.set(0.24, -0.2, -0.42);
  camera.add(rig);

  const flash = new THREE.Mesh(
    new THREE.PlaneGeometry(0.24, 0.24),
    new THREE.MeshBasicMaterial({ color: new THREE.Color('#ffb36b'), transparent: true, opacity: 0.9, depthWrite: false, side: THREE.DoubleSide }),
  );
  flash.position.set(0.24, -0.18, -0.95);
  flash.visible = false;
  camera.add(flash);
  const flashLight = new THREE.PointLight(new THREE.Color('#ffb36b'), 0, 5);
  flashLight.position.set(0.24, -0.16, -0.6);
  camera.add(flashLight);

  const state = {
    current: 'p9',
    mag: WEAPONS.p9.mag,
    reserve: WEAPONS.p9.reserve,
    cooldown: 0,
    reloadLeft: 0,
    flash: 0,
    kick: 0,
    bloom: 0,
    ads: 0,
    grenade: 'frag',
  };
  models.p9.visible = true;

  function step(dt, adsHeld) {
    state.cooldown = Math.max(0, state.cooldown - dt);
    state.flash = Math.max(0, state.flash - dt);
    state.kick += (0 - state.kick) * Math.min(1, dt * 14);
    state.bloom = Math.max(0, state.bloom - dt * 0.05);
    state.ads += ((adsHeld ? 1 : 0) - state.ads) * Math.min(1, dt * 10);
    rig.position.z = -0.42 + state.kick;
    rig.position.x = 0.24 - state.ads * 0.24;
    rig.position.y = -0.2 + state.ads * 0.045;
    rig.rotation.x = state.kick * 2.2;
    flash.visible = state.flash > 0;
    flash.rotation.z = state.flash * 30;
    flashLight.intensity = state.flash > 0 ? 18 : 0;
    if (state.reloadLeft > 0) {
      state.reloadLeft = Math.max(0, state.reloadLeft - dt);
      const def = WEAPONS[state.current];
      rig.rotation.x = -0.55 * Math.min(1, (def.reload - state.reloadLeft) * 2);
      if (state.reloadLeft === 0) {
        const need = def.mag - state.mag;
        const take = Math.min(need, state.reserve);
        state.mag += take;
        state.reserve -= take;
      }
    }
  }

  return {
    state,
    models,
    step,
    def() {
      return WEAPONS[state.current];
    },
    ready() {
      return state.mag > 0 && state.cooldown === 0 && state.reloadLeft === 0;
    },
    pullTrigger() {
      const def = WEAPONS[state.current];
      state.cooldown = def.rate;
      state.flash = 0.06;
      state.kick = 0.055;
      state.bloom = Math.min(0.05, state.bloom + 0.006);
    },
    takeRound() {
      if (state.mag <= 0) return false;
      state.mag -= 1;
      return true;
    },
    reload() {
      const def = WEAPONS[state.current];
      if (state.reloadLeft > 0 || state.mag === def.mag || state.reserve === 0) return;
      state.reloadLeft = def.reload;
    },
    spread(speed, airborne) {
      const def = WEAPONS[state.current];
      let s = def.spreadStill + Math.min(1, speed / 5.2) * def.spreadMove + state.bloom;
      if (airborne) s += def.spreadAir;
      return s * (1 - state.ads * (1 - def.adsMult));
    },
    // Ammo lives in the sim's loadout (one magazine per owned weapon); the rig
    // only shows the current one, so switching restores what that weapon had.
    switchTo(key, mag, reserve) {
      if (!WEAPONS[key] || key === state.current) return false;
      models[state.current].visible = false;
      state.current = key;
      models[key].visible = true;
      state.mag = mag;
      state.reserve = reserve;
      state.cooldown = 0.3;
      state.reloadLeft = 0;
      return true;
    },
    setAmmo(mag, reserve) {
      state.mag = mag;
      state.reserve = reserve;
    },
    refill() {
      const def = WEAPONS[state.current];
      state.mag = def.mag;
      state.reserve = def.reserve;
      state.cooldown = 0;
      state.reloadLeft = 0;
      state.flash = 0;
      state.kick = 0;
      state.bloom = 0;
    },
  };
}
