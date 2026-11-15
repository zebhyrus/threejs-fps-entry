// The DOM HUD: health, armor, ammo, timer, score, money, kill feed, the
// dynamic crosshair, hit marker, damage direction, bomb status, buy menu,
// round banners, the match overlay and a top-down minimap. It never touches
// the simulation; the sim pushes numbers in and reads menu choices out.
import { BUY_ITEMS } from './rounds.js';

export function createHud(map) {
  const $ = (id) => document.getElementById(id);
  const els = {
    overlay: $('overlay'), title: $('overlay-title'), copy: $('overlay-copy'), play: $('play'),
    healthFill: $('health-fill'), healthNum: $('health-num'), armorFill: $('armor-fill'),
    ammoMag: $('ammo-mag'), ammoReserve: $('ammo-reserve'), weaponName: $('weapon-name'),
    money: $('money'), timer: $('timer'), scoreA: $('score-a'), scoreB: $('score-b'),
    aliveA: $('alive-a'), aliveB: $('alive-b'), feed: $('feed'),
    crosshair: $('crosshair'), hitmarker: $('hitmarker'), damage: $('damage'),
    bomb: $('bomb'), banner: $('banner'), bannerText: $('banner-text'),
    buy: $('buy'), buyMoney: $('buy-money'), buyItems: $('buy-items'),
    minimap: $('minimap'), flash: $('flash'), plant: $('plant'), plantFill: $('plant-fill'),
    hint: $('hint'),
  };
  const mctx = els.minimap.getContext('2d');
  const last = { health: -1, armor: -1, mag: -1, reserve: -1, money: -1, timer: -1, scoreA: -1, scoreB: -1, weapon: '' };
  let hitTimer = 0;
  let bannerTimer = 0;
  let damageTimer = 0;

  function setText(el, value, key) {
    if (last[key] === value) return;
    last[key] = value;
    el.textContent = value;
  }

  return {
    setHealth(health, armor) {
      if (health !== last.health) {
        last.health = health;
        els.healthFill.style.width = `${Math.max(0, health)}%`;
        els.healthNum.textContent = String(Math.max(0, Math.ceil(health)));
        els.healthFill.classList.toggle('low', health <= 30);
      }
      if (armor !== last.armor) {
        last.armor = armor;
        els.armorFill.style.width = `${Math.max(0, armor)}%`;
      }
    },
    setAmmo(mag, reserve, name) {
      if (mag !== last.mag) {
        last.mag = mag;
        els.ammoMag.textContent = String(mag);
      }
      if (reserve !== last.reserve) {
        last.reserve = reserve;
        els.ammoReserve.textContent = `/ ${reserve}`;
      }
      if (name !== last.weapon) {
        last.weapon = name;
        els.weaponName.textContent = name;
      }
    },
    setMoney(value) {
      setText(els.money, `$${value}`, 'money');
    },
    setTimer(seconds) {
      const s = Math.max(0, Math.ceil(seconds));
      const text = `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
      setText(els.timer, text, 'timer');
      els.timer.classList.toggle('low', s <= 10);
    },
    setScore(a, b) {
      setText(els.scoreA, String(a), 'scoreA');
      setText(els.scoreB, String(b), 'scoreB');
    },
    setAlive(a, b) {
      els.aliveA.textContent = '●'.repeat(Math.max(0, a)) + '○'.repeat(Math.max(0, 5 - a));
      els.aliveB.textContent = '●'.repeat(Math.max(0, b)) + '○'.repeat(Math.max(0, 5 - b));
    },
    setCrosshair(spread) {
      const gap = 3 + spread * 260;
      els.crosshair.style.setProperty('--gap', `${gap.toFixed(1)}px`);
    },
    hitMarker(killed) {
      els.hitmarker.classList.add('on');
      els.hitmarker.classList.toggle('kill', killed);
      clearTimeout(hitTimer);
      hitTimer = setTimeout(() => els.hitmarker.classList.remove('on', 'kill'), 110);
    },
    damageFrom(angleRad) {
      els.damage.style.transform = `translate(-50%, -50%) rotate(${angleRad}rad)`;
      els.damage.classList.add('on');
      clearTimeout(damageTimer);
      damageTimer = setTimeout(() => els.damage.classList.remove('on'), 450);
    },
    feed(killer, victim, weapon, killerTeam, victimTeam) {
      const row = document.createElement('div');
      row.className = 'feed-row';
      const k = document.createElement('span');
      k.className = killerTeam === 'atk' ? 'atk' : 'def';
      k.textContent = killer;
      const w = document.createElement('span');
      w.className = 'feed-weapon';
      w.textContent = ` ${weapon} `;
      const v = document.createElement('span');
      v.className = victimTeam === 'atk' ? 'atk' : 'def';
      v.textContent = victim;
      row.append(k, w, v);
      els.feed.prepend(row);
      while (els.feed.children.length > 5) els.feed.lastChild.remove();
      setTimeout(() => row.remove(), 6000);
    },
    setBomb(text, urgent) {
      if (els.bomb.textContent !== text) els.bomb.textContent = text;
      els.bomb.classList.toggle('urgent', !!urgent);
      els.bomb.hidden = !text;
    },
    setPlant(progress, label) {
      if (progress === null) {
        els.plant.hidden = true;
        return;
      }
      els.plant.hidden = false;
      els.plantFill.style.width = `${Math.round(progress * 100)}%`;
      els.plant.querySelector('.plant-label').textContent = label;
    },
    banner(text, ms = 2600) {
      els.bannerText.textContent = text;
      els.banner.hidden = false;
      clearTimeout(bannerTimer);
      bannerTimer = setTimeout(() => {
        els.banner.hidden = true;
      }, ms);
    },
    flashScreen(strength) {
      els.flash.style.opacity = String(Math.min(1, strength));
      if (strength > 0) {
        setTimeout(() => {
          els.flash.style.opacity = '0';
        }, 120);
      }
    },
    showBuy(money) {
      els.buy.hidden = false;
      els.buyMoney.textContent = `$${money}`;
      els.buyItems.innerHTML = '';
      for (const item of BUY_ITEMS) {
        const row = document.createElement('div');
        row.className = 'buy-row';
        row.dataset.id = item.id;
        const key = document.createElement('kbd');
        key.textContent = item.key;
        const label = document.createElement('span');
        label.textContent = item.label;
        const price = document.createElement('b');
        price.textContent = `$${item.price}`;
        row.append(key, label, price);
        els.buyItems.appendChild(row);
      }
    },
    hideBuy() {
      els.buy.hidden = true;
    },
    markBuy(id, result) {
      const row = els.buyItems.querySelector(`[data-id="${id}"]`);
      if (!row) return;
      row.classList.remove('ok', 'no');
      row.classList.add(result === 'ok' ? 'ok' : 'no');
      setTimeout(() => row.classList.remove('ok', 'no'), 250);
    },
    showOverlay(mode, data) {
      if (mode === 'start') {
        els.title.textContent = 'SANDLINE';
        els.copy.textContent = 'A desert compound at dusk. Plant the bomb at A or B — or wipe the defenders out. Click to play.';
        els.play.textContent = 'Click to play';
      } else if (mode === 'paused') {
        els.title.textContent = 'SANDLINE';
        els.copy.textContent = 'Paused. Click to resume.';
        els.play.textContent = 'Click to resume';
      } else if (mode === 'match') {
        els.title.textContent = data.winner === 'atk' ? 'SANDLINE TAKEN' : 'SANDLINE HELD';
        els.copy.textContent = `Final score ${data.scoreA} – ${data.scoreB}. ${data.winner === 'atk' ? 'The bomb went off and the compound is yours.' : 'The defenders held the compound.'} You had ${data.kills} kills.`;
        els.play.textContent = 'Play again';
      }
      els.overlay.hidden = false;
      els.play.focus();
    },
    hideOverlay() {
      els.overlay.hidden = true;
    },
    onPlay(handler) {
      els.play.addEventListener('click', handler);
    },
    setHint(text) {
      if (els.hint.textContent !== text) els.hint.textContent = text;
    },
    drawMinimap(state) {
      const c = mctx;
      const W = els.minimap.width;
      const H = els.minimap.height;
      const sx = W / 48;
      const sz = H / 40;
      const px = (x) => (x + 24) * sx;
      const pz = (z) => (z + 20) * sz;
      c.clearRect(0, 0, W, H);
      c.fillStyle = '#241f18';
      c.fillRect(0, 0, W, H);
      c.fillStyle = '#4a4234';
      for (const [x, z, w, d] of map.minimapWalls) c.fillRect(px(x - w / 2), pz(z - d / 2), w * sx, d * sz);
      c.font = 'bold 11px system-ui, sans-serif';
      c.textAlign = 'center';
      c.fillStyle = '#2fae8f';
      c.fillText('A', px(-18), pz(-12) + 4);
      c.fillText('B', px(18), pz(-12) + 4);
      const dot = (x, z, color, r = 3) => {
        c.fillStyle = color;
        c.beginPath();
        c.arc(px(x), pz(z), r, 0, Math.PI * 2);
        c.fill();
      };
      for (const bot of state.bots) {
        if (!bot.alive) continue;
        const seen = bot.team === 'atk' || state.time - bot.seenT < 4;
        if (bot.team === 'atk') dot(bot.body.position.x, bot.body.position.z, '#2fae8f');
        else if (seen) dot(bot.body.position.x, bot.body.position.z, '#e5484d');
      }
      if (state.player.alive) {
        const p = state.player.body.position;
        c.fillStyle = '#f2e8d5';
        c.beginPath();
        c.arc(px(p.x), pz(p.z), 4, 0, Math.PI * 2);
        c.fill();
        const yaw = state.player.body.yaw;
        c.strokeStyle = '#f2e8d5';
        c.beginPath();
        c.moveTo(px(p.x), pz(p.z));
        c.lineTo(px(p.x) - Math.sin(yaw) * 10, pz(p.z) - Math.cos(yaw) * 10);
        c.stroke();
      }
      if (state.bomb.state === 'dropped') dot(state.bomb.pos.x, state.bomb.pos.z, '#ff5a2a', 4);
      if (state.bomb.state === 'planted') {
        c.fillStyle = '#ff5a2a';
        const s = state.bomb.site === 'A' ? [-18, -12] : [18, -12];
        c.fillRect(px(s[0]) - 5, pz(s[1]) - 5, 10, 10);
      }
    },
  };
}
