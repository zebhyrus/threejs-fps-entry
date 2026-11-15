// Rounds and money: the match state machine, the buy menu's rules, and the
// economy. A round is freeze, buy, live, end; the first team to 5 round wins
// takes the match. The bomb is the objective; elimination is the fallback.
import { WEAPONS, GRENADES, ARMOR_PRICE } from './weapons.js';

export const FREEZE_SECONDS = 3;
export const BUY_SECONDS = 15;
export const ROUND_SECONDS = 100;
export const PLANT_SECONDS = 3;
export const DEFUSE_SECONDS = 5;
export const DETONATE_SECONDS = 35;
export const WIN_ROUNDS = 5;
export const START_MONEY = 800;
export const KILL_REWARD = 300;
export const WIN_REWARD = 3250;
export const LOSS_REWARD = 1900;

export const BUY_ITEMS = [
  { id: 'wasp', label: 'Wasp PDW-9', kind: 'weapon', price: WEAPONS.wasp.price, key: '2' },
  { id: 'jackal', label: 'Jackal AR-7', kind: 'weapon', price: WEAPONS.jackal.price, key: '3' },
  { id: 'longshot', label: 'Longshot LR-50', kind: 'weapon', price: WEAPONS.longshot.price, key: '4' },
  { id: 'frag', label: 'Frag grenade', kind: 'grenade', price: GRENADES.frag.price, key: '5' },
  { id: 'smoke', label: 'Smoke grenade', kind: 'grenade', price: GRENADES.smoke.price, key: '6' },
  { id: 'flash', label: 'Flash grenade', kind: 'grenade', price: GRENADES.flash.price, key: '7' },
  { id: 'armor', label: 'Kevlar armor', kind: 'armor', price: ARMOR_PRICE, key: '8' },
];

export function createRounds() {
  const state = {
    phase: 'freeze',
    phaseT: 0,
    roundNo: 1,
    scoreA: 0,
    scoreB: 0,
    timer: ROUND_SECONDS,
    winner: null,
    winReason: '',
    matchOver: false,
    buyOpen: false,
  };

  function startRound() {
    state.phase = 'freeze';
    state.phaseT = 0;
    state.timer = ROUND_SECONDS;
    state.winner = null;
    state.winReason = '';
    state.buyOpen = false;
  }

  function startMatch() {
    state.roundNo = 1;
    state.scoreA = 0;
    state.scoreB = 0;
    state.matchOver = false;
    startRound();
  }

  // buy: one item from the menu. Returns 'ok', 'poor', 'owned' or 'closed'.
  function buy(player, itemId) {
    if (state.phase !== 'freeze' && state.phase !== 'buy') return 'closed';
    const item = BUY_ITEMS.find((i) => i.id === itemId);
    if (!item) return 'closed';
    if (player.money < item.price) return 'poor';
    if (item.kind === 'weapon') {
      if (player.loadout[item.id]) return 'owned';
      player.loadout[item.id] = { mag: WEAPONS[item.id].mag, reserve: WEAPONS[item.id].reserve };
    } else if (item.kind === 'grenade') {
      player.grenades[item.id] = (player.grenades[item.id] || 0) + 1;
    } else if (item.kind === 'armor') {
      if (player.armor >= 100) return 'owned';
      player.armor = 100;
    }
    player.money -= item.price;
    return 'ok';
  }

  // endRound pays the economy and advances the match. Returns true if the match ended.
  function endRound(winner, reason, player) {
    if (state.phase === 'end') return state.matchOver;
    state.phase = 'end';
    state.phaseT = 0;
    state.winner = winner;
    state.winReason = reason;
    if (winner === 'atk') {
      state.scoreA += 1;
      player.money += WIN_REWARD;
    } else {
      state.scoreB += 1;
      player.money += LOSS_REWARD;
    }
    if (state.scoreA >= WIN_ROUNDS || state.scoreB >= WIN_ROUNDS) {
      state.matchOver = true;
    }
    return state.matchOver;
  }

  function step(dt, ctx) {
    state.phaseT += dt;
    if (state.phase === 'freeze' && state.phaseT >= FREEZE_SECONDS) {
      state.phase = 'buy';
      state.phaseT = 0;
    } else if (state.phase === 'buy' && state.phaseT >= BUY_SECONDS) {
      state.phase = 'live';
      state.phaseT = 0;
      ctx.onLive();
    } else if (state.phase === 'live') {
      state.timer -= dt;
      if (state.timer <= 0) {
        state.timer = 0;
        ctx.onTimeOut();
      }
    } else if (state.phase === 'end' && state.phaseT >= 4) {
      if (state.matchOver) return;
      state.roundNo += 1;
      startRound();
      ctx.onRoundStart();
    }
  }

  return { state, startMatch, startRound, buy, endRound, step };
}
