// Movement: one body, one step, used by the player and by every bot. A body is
// an axis-aligned box resolved against the map's colliders one axis at a time,
// so a wall never swallows it. Acceleration, friction, gravity, crouch and
// jump live here; the player and the bots only choose where to wish to go.
import * as THREE from 'three';

const RADIUS = 0.34;
const STAND_HEIGHT = 1.72;
const CROUCH_HEIGHT = 1.12;
const STAND_EYE = 1.6;
const CROUCH_EYE = 1.02;
const GROUND_ACCEL = 42;
const AIR_ACCEL = 9;
const FRICTION = 9;
const GRAVITY = 20;
const JUMP_SPEED = 6.2;

export function createBody(x, z, yaw = 0) {
  return {
    position: new THREE.Vector3(x, 0, z),
    velocity: new THREE.Vector3(),
    yaw,
    pitch: 0,
    eye: STAND_EYE,
    onGround: true,
    crouching: false,
    height: STAND_HEIGHT,
  };
}

// stepBody moves a body one fixed step. wishX/wishZ is the desired horizontal
// direction (already rotated to the world), speed the target speed, and opts
// { crouch, jump } the body's intent. No allocation: the probe box is shared.
export function stepBody(body, colliders, dt, wishX, wishZ, speed, opts) {
  const probe = stepBody.probe || (stepBody.probe = new THREE.Box3());
  function overlaps(x, y, z, height, lift) {
    probe.min.set(x - RADIUS, y + lift, z - RADIUS);
    probe.max.set(x + RADIUS, y + height - lift, z + RADIUS);
    for (let i = 0; i < colliders.length; i += 1) {
      if (probe.intersectsBox(colliders[i])) return colliders[i];
    }
    return null;
  }

  if (opts.crouch && !body.crouching) {
    body.crouching = true;
    body.height = CROUCH_HEIGHT;
  } else if (!opts.crouch && body.crouching && !overlaps(body.position.x, body.position.y, body.position.z, STAND_HEIGHT, 0.02)) {
    body.crouching = false;
    body.height = STAND_HEIGHT;
  }
  const eyeTarget = body.crouching ? CROUCH_EYE : STAND_EYE;
  body.eye += (eyeTarget - body.eye) * Math.min(1, dt * 12);

  const wishLen = Math.hypot(wishX, wishZ);
  const wx = wishLen > 0 ? wishX / wishLen : 0;
  const wz = wishLen > 0 ? wishZ / wishLen : 0;
  const blend = Math.min(1, (body.onGround ? GROUND_ACCEL : AIR_ACCEL) * dt / speed);
  body.velocity.x += (wx * speed - body.velocity.x) * blend;
  body.velocity.z += (wz * speed - body.velocity.z) * blend;
  if (body.onGround && wishLen === 0) {
    const damp = Math.max(0, 1 - FRICTION * dt);
    body.velocity.x *= damp;
    body.velocity.z *= damp;
  }

  if (opts.jump && body.onGround) {
    body.velocity.y = JUMP_SPEED;
    body.onGround = false;
  }
  body.velocity.y -= GRAVITY * dt;

  const nextX = body.position.x + body.velocity.x * dt;
  if (!overlaps(nextX, body.position.y, body.position.z, body.height, 0.04)) body.position.x = nextX;
  else body.velocity.x = 0;
  const nextZ = body.position.z + body.velocity.z * dt;
  if (!overlaps(body.position.x, body.position.y, nextZ, body.height, 0.04)) body.position.z = nextZ;
  else body.velocity.z = 0;

  body.position.y += body.velocity.y * dt;
  body.onGround = false;
  const hit = overlaps(body.position.x, body.position.y, body.position.z, body.height, 0);
  if (hit && body.velocity.y <= 0) {
    body.position.y = hit.max.y;
    body.velocity.y = 0;
    body.onGround = true;
  } else if (hit) {
    body.position.y = hit.min.y - body.height;
    body.velocity.y = 0;
  }
  if (body.position.y < 0) {
    body.position.y = 0;
    body.velocity.y = 0;
    body.onGround = true;
  }
  body.velocity.y = Math.max(-30, body.velocity.y);
}

export const SPEEDS = { WALK: 5.2, CROUCH: 2.4, ADS: 3.2, BOT: 4.2, BOT_RUSH: 5.0 };

export function createPlayer(colliders) {
  const body = createBody(0, 16, 0);
  function look(dx, dy, sensitivity = 0.0022) {
    body.yaw -= dx * sensitivity;
    body.pitch = Math.max(-1.45, Math.min(1.45, body.pitch - dy * sensitivity));
  }
  function recoil(pitchKick, yawKick) {
    body.pitch = Math.min(1.45, body.pitch + pitchKick);
    body.yaw += yawKick;
  }
  function step(dt, keys, ads) {
    const crouching = keys.has('ControlLeft') || keys.has('ControlRight') || keys.has('KeyC');
    const forward = (keys.has('KeyW') ? 1 : 0) - (keys.has('KeyS') ? 1 : 0);
    const strafe = (keys.has('KeyD') ? 1 : 0) - (keys.has('KeyA') ? 1 : 0);
    const sin = Math.sin(body.yaw);
    const cos = Math.cos(body.yaw);
    const wishX = -sin * forward + cos * strafe;
    const wishZ = -cos * forward - sin * strafe;
    const speed = crouching ? SPEEDS.CROUCH : ads ? SPEEDS.ADS : SPEEDS.WALK;
    stepBody(body, colliders, dt, wishX, wishZ, speed, { crouch: crouching, jump: keys.has('Space') });
  }
  return {
    body,
    step,
    look,
    recoil,
    groundSpeed() {
      return Math.hypot(body.velocity.x, body.velocity.z);
    },
  };
}
