// Procedural sound: every effect is an oscillator or a filtered noise burst
// built on first use, so the game ships no audio files. The context is
// created lazily on the first user gesture; headless runs never create one
// and every call becomes a no-op.
export function createAudio() {
  let ctx = null;
  let noiseBuf = null;

  function ensure() {
    if (ctx) return ctx;
    try {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return null;
      ctx = new AC();
      const len = ctx.sampleRate * 0.5;
      noiseBuf = ctx.createBuffer(1, len, ctx.sampleRate);
      const data = noiseBuf.getChannelData(0);
      for (let i = 0; i < len; i += 1) data[i] = Math.random() * 2 - 1;
    } catch {
      ctx = null;
    }
    return ctx;
  }

  function noise(dur, freq, gain, type = 'lowpass', when = 0) {
    if (!ensure()) return;
    const t = ctx.currentTime + when;
    const src = ctx.createBufferSource();
    src.buffer = noiseBuf;
    src.loop = true;
    const filter = ctx.createBiquadFilter();
    filter.type = type;
    filter.frequency.value = freq;
    const amp = ctx.createGain();
    amp.gain.setValueAtTime(gain, t);
    amp.gain.exponentialRampToValueAtTime(0.001, t + dur);
    src.connect(filter).connect(amp).connect(ctx.destination);
    src.start(t);
    src.stop(t + dur + 0.05);
  }

  function tone(freq, dur, gain, type = 'sine', when = 0, slide = 0) {
    if (!ensure()) return;
    const t = ctx.currentTime + when;
    const osc = ctx.createOscillator();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t);
    if (slide) osc.frequency.exponentialRampToValueAtTime(Math.max(20, freq + slide), t + dur);
    const amp = ctx.createGain();
    amp.gain.setValueAtTime(gain, t);
    amp.gain.exponentialRampToValueAtTime(0.001, t + dur);
    osc.connect(amp).connect(ctx.destination);
    osc.start(t);
    osc.stop(t + dur + 0.05);
  }

  return {
    unlock() {
      ensure();
    },
    shot(kind) {
      if (kind === 'sniper') {
        noise(0.28, 900, 0.5);
        tone(140, 0.22, 0.4, 'sine', 0, -90);
      } else if (kind === 'smg') {
        noise(0.09, 1800, 0.32);
        tone(190, 0.07, 0.22, 'square', 0, -60);
      } else if (kind === 'pistol') {
        noise(0.08, 2200, 0.28);
        tone(220, 0.06, 0.18, 'square', 0, -70);
      } else {
        noise(0.13, 1400, 0.4);
        tone(160, 0.1, 0.3, 'sawtooth', 0, -70);
      }
    },
    dry() {
      tone(1400, 0.03, 0.12, 'square');
    },
    reload() {
      tone(900, 0.04, 0.14, 'square', 0);
      tone(700, 0.04, 0.14, 'square', 0.35);
    },
    hit() {
      tone(2400, 0.05, 0.16, 'sine');
    },
    kill() {
      tone(1800, 0.06, 0.18, 'sine', 0);
      tone(2600, 0.09, 0.18, 'sine', 0.07);
    },
    hurt() {
      tone(120, 0.15, 0.3, 'sawtooth', 0, -40);
    },
    beep(final) {
      tone(final ? 1600 : 1100, 0.09, 0.2, 'sine');
    },
    plant() {
      tone(1100, 0.12, 0.2, 'sine', 0);
      tone(1100, 0.12, 0.2, 'sine', 0.18);
    },
    explosion() {
      noise(1.2, 300, 0.8);
      tone(70, 0.9, 0.6, 'sine', 0, -40);
    },
    sting(win) {
      const notes = win ? [523, 659, 784] : [392, 330, 262];
      notes.forEach((f, i) => tone(f, 0.28, 0.18, 'triangle', i * 0.14));
    },
    buy() {
      tone(1200, 0.05, 0.14, 'sine', 0);
      tone(1600, 0.07, 0.14, 'sine', 0.06);
    },
    denied() {
      tone(220, 0.12, 0.18, 'square');
    },
    flash() {
      tone(3000, 0.4, 0.1, 'sine', 0, -2000);
    },
    round() {
      tone(660, 0.12, 0.16, 'triangle', 0);
      tone(880, 0.16, 0.16, 'triangle', 0.12);
    },
  };
}
