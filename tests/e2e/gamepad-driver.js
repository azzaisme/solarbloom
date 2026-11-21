// Bloombot (G.7, rewritten for E23's island, #572): a scripted player that uses only a virtual gamepad. It reads the
// game state to decide where to go (as a player reads the screen), but every action goes through
// `navigator.getGamepads()`: the left stick to walk and turn, X to pulse, A to interact (held to salvage a pile; a
// tap opens the fountain's panel), the d-pad to walk a panel's focus ring and A to press its button, B to close a
// panel, d-pad left to eat. No mouse or keyboard.
//
// Its goal is the island's first one, fountain step 1 ("Water returns", data/salvage TIERS[0]): salvage the Scrap
// and Seeds the fountain wants from the piles and the park's broken pots, restore the park's ground with pulses
// until the step's park tiles are done, and hand it all in at the fountain ("Give all I have"). The step wakes the
// park (its fog clears).
//
// Loaded into the page by tests/e2e/gamepad.e2e.mjs, and usable by hand from a dev console:
//   installVirtualPad(); const d = padDriver(window.solarbloom); then call d.tick() every frame.

/** Replaces navigator.getGamepads with one standard-mapping pad the script controls. */
export function installVirtualPad() {
  const pad = {
    id: 'virtual pad (STANDARD GAMEPAD)',
    index: 0,
    connected: true,
    mapping: 'standard',
    timestamp: 0,
    axes: [0, 0, 0, 0],
    buttons: Array.from({ length: 17 }, () => ({ pressed: false, touched: false, value: 0 })),
  };
  navigator.getGamepads = () => [pad, null, null, null];
  window.__pad = pad;
  return pad;
}

export function padDriver(game) {
  const pad = window.__pad;
  const A = 0;
  const B = 1;
  const PULSE = 2;
  const EAT = 14;
  const DPAD = { up: 12, down: 13, left: 14, right: 15 };
  const N4 = [[1, 0], [-1, 0], [0, 1], [0, -1]];
  let release = [];
  const press = (b) => {
    pad.buttons[b].pressed = true;
    pad.buttons[b].value = 1;
    release.push(b);
  };
  /** A held button stays down across frames until let go. */
  const hold = (b, on) => {
    pad.buttons[b].pressed = on;
    pad.buttons[b].value = on ? 1 : 0;
  };
  /** Stick toward a world direction (dx, dz), mapped through the camera's yaw. */
  const stick = (dx, dz, mag = 1) => {
    const yr = (game.camera.yaw * Math.PI) / 180;
    // BotController: world = right * x + forward * y, forward = (-sin, -cos), right = (cos, -sin)
    const fx = -Math.sin(yr), fz = -Math.cos(yr), rx = Math.cos(yr), rz = -Math.sin(yr);
    const l = Math.hypot(dx, dz) || 1;
    const ux = dx / l, uz = dz / l;
    pad.axes[0] = (ux * rx + uz * rz) * mag;
    pad.axes[1] = -(ux * fx + uz * fz) * mag;
  };
  const still = () => {
    pad.axes[0] = 0;
    pad.axes[1] = 0;
    pad.axes[2] = 0;
    pad.axes[3] = 0;
  };
  let target; // { stand: {x, z}, face: {x, z}, kind: 'salvage' | 'deliver' | 'pulse', pile? }
  /** the path to the target's stand, from bloombot's pathfinder (refreshed every second) */
  let route;
  let nudge = 0;
  let held = 0;
  let lastPulseAt = -99;
  const st = { pulses: 0, woke: false, frames: 0, interacts: 0, salvaged: 0, delivered: 0, trace: [] };

  const sim = game.sim;
  const bot = game.bot;
  const walk = bot.walker;
  const f = sim.fountain;

  /** The panel the pad's focus ring is in (the fountain's, a toast's, ...), if one is open. */
  const panelOpen = () => game.padFocus?.panel?.();
  const giveBtn = () => {
    const b = document.querySelector('[data-act="giveAll"]');
    return b && b.offsetParent !== null ? b : undefined;
  };
  /** Walks the open panel's focus ring to an element with the d-pad (as a player would), then presses it with A. */
  function padTo(el) {
    const cur = document.activeElement;
    if (cur === el) {
      press(A);
      return;
    }
    const panel = panelOpen();
    if (!cur || !panel?.contains(cur)) {
      press(DPAD.down); // the first press lands the focus ring in the panel
      return;
    }
    const a = cur.getBoundingClientRect();
    const b = el.getBoundingClientRect();
    const dx = b.left + b.width / 2 - (a.left + a.width / 2);
    const dy = b.top + b.height / 2 - (a.top + a.height / 2);
    press(Math.abs(dx) >= Math.abs(dy) ? (dx > 0 ? DPAD.right : DPAD.left) : dy > 0 ? DPAD.down : DPAD.up);
  }

  /** Every pile with something left around the park (rescanned now and then: a storm blows new ones in). */
  let pileCache;
  let pileScanAt = -1e9;
  function piles() {
    if (!pileCache || st.frames - pileScanAt > 900) {
      pileScanAt = st.frames;
      const seen = new Map();
      for (let x = -48; x <= 48; x++)
        for (let z = -48; z <= 48; z++) {
          const pile = sim.salvage.pileAt(x, z);
          if (pile && !seen.has(pile.id)) seen.set(pile.id, pile);
        }
      pileCache = [...seen.values()];
    }
    return pileCache;
  }

  /** What the fountain's next step still wants of each material, beyond what bloombot already has. */
  function stillToFind() {
    const t = f.next();
    if (!t) return [];
    return Object.keys(t.delivery).filter((m) => m !== 'biomass' && f.remaining(m) > sim.inventory.available(m));
  }
  /** Something the fountain wants that bloombot carries or keeps in the store. */
  const canGive = () => {
    const t = f.next();
    return !!t && Object.keys(t.delivery).some((m) => m !== 'biomass' && f.remaining(m) > 0 && sim.inventory.available(m) > 0);
  };

  /** Cells bloombot found no way to (for a while): a player gives up on what it can't get to and tries elsewhere. */
  const noWay = new Map();
  /** Bloombot's own pathfinder finds a way to a cell from where it stands (or it is there). */
  function reachable(p, stand) {
    const key = `${stand.x},${stand.z}`;
    if ((noWay.get(key) ?? -1) > st.frames) return false;
    if (Math.floor(p.x) === stand.x && Math.floor(p.z) === stand.z) return true;
    const ok = !!walk.path(p.roofId, p.x, p.z, (x, z) => x === stand.x && z === stand.z, stand);
    if (!ok) noWay.set(key, st.frames + 1800); // a minute of play
    return ok;
  }
  /** The nearest walkable cell beside a cell (or a footprint) that bloombot can get to, and the cell to face from it. */
  function besideOf(cells, p) {
    const inside = (x, z) => cells.some((c) => c.x === x && c.z === z);
    const opts = [];
    for (const c of cells)
      for (const [dx, dz] of N4) {
        const sx = c.x + dx, sz = c.z + dz;
        if (inside(sx, sz) || !walk.walkable(p.roofId, sx, sz)) continue;
        opts.push({ stand: { x: sx, z: sz }, face: { x: c.x, z: c.z }, d: Math.hypot(sx + 0.5 - p.x, sz + 0.5 - p.z) });
      }
    opts.sort((a, b) => a.d - b.d);
    return opts.find((o) => reachable(p, o.stand));
  }
  /** The nearest of some targets bloombot can get to (by straight distance first, then checked one by one). */
  function nearestReachable(list, p) {
    const near = list
      .map((c) => ({ c, d: Math.hypot(c.x + 0.5 - p.x, c.z + 0.5 - p.z) }))
      .sort((a, b) => a.d - b.d)
      .slice(0, 12);
    for (const { c } of near) {
      const b = besideOf([{ x: c.x, z: c.z }], p);
      if (b) return { ...b, c };
    }
    return undefined;
  }

  function pickTarget() {
    const p = bot.pose;
    // 1. Salvage what the fountain still wants: the nearest pile of it bloombot can take from now
    const want = stillToFind();
    if (want.length) {
      const b = nearestReachable(piles().filter((pile) => want.includes(pile.material) && !sim.salvage.problem(pile.id)), p);
      if (b) return { stand: b.stand, face: b.face, kind: 'salvage', pile: b.c.id };
    }
    // 2. Everything found (or nothing more to take): hand it in at the fountain
    if (canGive()) {
      const m = sim.state.machines.find((q) => q.type === 'core' && sim.areas.areaOf(q) === 'park');
      if (m) {
        const cells = [];
        for (let x = m.x; x < m.x + m.size; x++) for (let z = m.z; z < m.z + m.size; z++) cells.push({ x, z });
        const b = besideOf(cells, p);
        if (b) return { ...b, kind: 'deliver' };
      }
    }
    // 3. The park's ground: the nearest dead park tile a pulse would restore, while the step still wants more
    if (f.next() && !f.condition().done) {
      const dead = sim.progression.tilesFor('home').filter((t) => {
        if (t.roofId !== p.roofId || t.occupantId || t.ground === 'restored' || t.ground === 'growing') return false;
        const c = sim.restoration.checkPulse(t);
        return c.ok || /energy|charge|water|need|afford/i.test(c.reason ?? '');
      });
      const b = nearestReachable(dead, p);
      if (b) return { stand: b.stand, face: b.face, kind: 'pulse' };
    }
    return undefined;
  }

  function tick() {
    st.frames++;
    for (const b of release) {
      pad.buttons[b].pressed = false;
      pad.buttons[b].value = 0;
    }
    release = [];
    if (sim.areas.fog('park') === 'cleared') {
      st.woke = true;
      hold(A, false);
      still();
      return st;
    }
    if (game.hud.modalOpen) {
      press(B); // B closes the menu or Settings
      return st;
    }
    // a panel is open: at the fountain with something to give, give all; anything else, B closes it
    if (panelOpen()) {
      still();
      hold(A, false);
      const give = giveBtn();
      if (target?.kind === 'deliver' && give && !give.disabled && canGive()) {
        if (st.frames % 4 === 0) padTo(give);
      } else if (st.frames % 4 === 0) {
        if (target?.kind === 'deliver') target = undefined;
        press(B);
      }
      return st;
    }
    // E23.1.4: an empty charge: d-pad left eats
    if (sim.charge.empty && st.frames % 15 === 0) press(EAT);
    const stale =
      !target ||
      (target.kind === 'salvage' && (sim.salvage.problem(target.pile) || !stillToFind().length)) ||
      (target.kind === 'pulse' && sim.grid.get(bot.pose.roofId, target.face.x, target.face.z)?.ground === 'restored') ||
      (target.kind === 'deliver' && !canGive());
    if (stale || (st.frames % 90 === 0 && target.kind !== 'salvage')) {
      hold(A, false);
      held = 0;
      const was = target ? `${target.kind}@${target.face.x},${target.face.z}` : 'none';
      target = pickTarget();
      const now = target ? `${target.kind}@${target.face.x},${target.face.z}` : 'none';
      // a short trace of what it went for (for a run that stalls)
      if (now !== was && st.trace.length < 60) st.trace.push(`${(sim.time / 60).toFixed(1)}m ${now} want[${stillToFind()}] charge ${sim.charge.empty ? 'empty' : 'ok'}`);
    }
    if (!target) {
      still();
      return st;
    }
    const p = bot.pose;
    const cx = target.stand.x + 0.5, cz = target.stand.z + 0.5;
    const d = Math.hypot(cx - p.x, cz - p.z);
    if (st.frames % 1800 === 0 && st.trace.length < 60) {
      const fr0 = walk.front(p);
      const pr = (document.querySelector('#interactPrompt, .interact-prompt, #prompt')?.textContent ?? '').trim();
      st.trace.push(`${(sim.time / 60).toFixed(1)}m at ${p.x.toFixed(1)},${p.z.toFixed(1)} → ${target.kind} stand ${target.stand.x},${target.stand.z} (d ${d.toFixed(2)}) face ${target.face.x},${target.face.z} front ${fr0.x},${fr0.z} A ${pad.buttons[A].pressed} prompt "${pr}"${target.pile ? ` left ${sim.salvage.left(target.pile)} ${sim.salvage.problem(target.pile) ?? ''}` : ''} route ${route?.path?.length ?? '-'}`);
    }
    if (d > 0.18) {
      hold(A, false);
      // Walk there along the path bloombot's own pathfinder finds; straight on for the last cell.
      if (!route || route.to !== target || st.frames % 30 === 0) {
        const goal = (x, z) => x === target.stand.x && z === target.stand.z;
        route = { to: target, path: walk.path(p.roofId, p.x, p.z, goal, target.stand) ?? [] };
      }
      if (!route.path.length && d > 1.5) {
        // no way there any more (something got in the way): try something else
        noWay.set(`${target.stand.x},${target.stand.z}`, st.frames + 1800);
        target = undefined;
        still();
        return st;
      }
      while (route.path.length && Math.hypot(route.path[0].x - p.x, route.path[0].z - p.z) < 0.3) route.path.shift();
      const next = route.path.length > 1 ? route.path[0] : { x: cx, z: cz };
      const side = (st.frames >> 6) % 2 ? 1 : -1;
      const blocked = bot.speed < 0.2 && st.frames > 30;
      const ax = next.x - p.x, az = next.z - p.z;
      stick(blocked ? ax - az * side : ax, blocked ? az + ax * side : az, Math.min(1, 0.35 + d));
      nudge = 0;
      return st;
    }
    // At the spot: a light push toward the target turns bloombot to face it without leaving the cell.
    const fr = walk.front(p);
    if (fr.x !== target.face.x || fr.z !== target.face.z) {
      hold(A, false);
      stick(target.face.x + 0.5 - p.x, target.face.z + 0.5 - p.z, 0.3);
      if (++nudge > 90) target = undefined; // can't line up: pick something else
      return st;
    }
    still();
    if (target.kind === 'salvage') {
      // hold A on the pile (E22.2: salvaging is a hold), let go once it gave something, then hold again
      const before = sim.salvage.left(target.pile);
      if (!pad.buttons[A].pressed) {
        hold(A, true);
        held = 0;
        target.left = before;
        st.interacts++;
      } else if (before < target.left || ++held > 90) {
        if (before < target.left) st.salvaged += target.left - before;
        hold(A, false);
      }
    } else if (target.kind === 'deliver') {
      // a tap of A opens the fountain's panel (the panel branch above gives all)
      if (st.frames % 6 === 0) {
        press(A);
        st.interacts++;
      }
    } else if (target.kind === 'pulse' && sim.restoration.checkPulse(sim.grid.get(p.roofId, fr.x, fr.z)).ok && sim.time - lastPulseAt > 0.4) {
      press(PULSE);
      lastPulseAt = sim.time;
      st.pulses++;
    }
    return st;
  }
  // count what reached the fountain (from its own news)
  sim.bus.on('fountain.delivered', (e) => (st.delivered += e.n));
  return { tick, state: st };
}
