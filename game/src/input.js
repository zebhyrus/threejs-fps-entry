// Keyboard and mouse, and the pointer lock that turns the mouse into look.
// Plain browser APIs only. Right mouse aims down sights; the wheel and the
// number keys switch weapons; B opens the buy menu; E is the use key;
// G throws the selected grenade, H cycles the grenade type.
export function createInput(canvas, onLockChange) {
  const keys = new Set();
  const pressed = new Set();
  const state = { keys, locked: false, firing: false, ads: false, lookX: 0, lookY: 0, wheel: 0 };

  function setKey(event, down) {
    if (down) {
      if (!keys.has(event.code)) pressed.add(event.code);
      keys.add(event.code);
    } else keys.delete(event.code);
    if (event.code === 'Space') event.preventDefault();
  }

  window.addEventListener('keydown', (event) => setKey(event, true));
  window.addEventListener('keyup', (event) => setKey(event, false));
  window.addEventListener('blur', () => {
    keys.clear();
    pressed.clear();
    state.firing = false;
    state.ads = false;
  });
  window.addEventListener('mousemove', (event) => {
    if (!state.locked) return;
    state.lookX += event.movementX;
    state.lookY += event.movementY;
  });
  window.addEventListener('mousedown', (event) => {
    if (!state.locked) return;
    if (event.button === 0) {
      state.firing = true;
      pressed.add('MouseLeft');
    }
    if (event.button === 2) state.ads = true;
  });
  window.addEventListener('mouseup', (event) => {
    if (event.button === 0) {
      state.firing = false;
      pressed.delete('MouseLeft');
    }
    if (event.button === 2) state.ads = false;
  });
  window.addEventListener('wheel', (event) => {
    if (!state.locked) return;
    state.wheel += event.deltaY > 0 ? 1 : -1;
  }, { passive: true });
  window.addEventListener('contextmenu', (event) => event.preventDefault());
  document.addEventListener('pointerlockchange', () => {
    state.locked = document.pointerLockElement === canvas;
    if (!state.locked) {
      keys.clear();
      pressed.clear();
      state.firing = false;
      state.ads = false;
    }
    onLockChange(state.locked);
  });

  return {
    state,
    requestLock() {
      canvas.requestPointerLock();
    },
    takeLook() {
      const x = state.lookX;
      const y = state.lookY;
      state.lookX = 0;
      state.lookY = 0;
      return { x, y };
    },
    takeWheel() {
      const w = state.wheel;
      state.wheel = 0;
      return w;
    },
    // Edge-triggered keys: true once per physical press, then consumed.
    wasPressed(code) {
      if (!pressed.has(code)) return false;
      pressed.delete(code);
      return true;
    },
    clearPressed() {
      pressed.clear();
    },
  };
}
