// Bloombot (G.7): a scripted player that uses only a virtual gamepad. It reads the game state to decide where
// to go (as a player reads the screen), but every action goes through `navigator.getGamepads()`: the left
// stick to walk and turn, A to pulse, X to wake the fountain, d-pad left to harvest. No mouse or keyboard.
//
// Loaded into the page by tests/e2e/gamepad.e2e.mjs (real time), and usable by hand from a dev console:
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
  const PULSE = 0;
  const WAKE = 2;
  const NEXT_TOOL = 5;
  const HARVEST = 14;
  /** The park's build goals, in the order the objective card lists them. */
  const NEEDED = { solar: 'Solar Panel', condenser: 'Water Condenser', pollinator: 'Pollinator Garden', droneHub: 'Drone Hub', motherTree: 'Mother Tree' };
  let release = [];
  const press = (b) => {
    pad.buttons[b].pressed = true;
    pad.buttons[b].value = 1;
    release.push(b);
  };
  /** Stick toward a world direction (dx, dz), mapped through the camera's fixed yaw. */
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
  };
  let target; // { stand: {x, z}, face: {x, z}, kind }
  let nudge = 0;
  let lastPulseAt = -99;
  const st = { pulses: 0, woke: false, frames: 0 };

  const sim = game.sim;
  const bot = game.bot;
  const walk = bot.walker;

  /** A pulse would work here now, or as soon as energy and water refill. */
  const pulsable = (t) => {
    if (!t) return false;
    const c = sim.restoration.checkPulse(t);
    return c.ok || /energy|water|need|afford/i.test(c.reason ?? '');
  };

  function pickTarget() {
    const p = bot.pose;
    const fountain = sim.state.machines.find((m) => m.type === 'core' && m.roofId === p.roofId && sim.areas.areaOf(m) === 'park');
    if (fountain && game.landmarkReady(fountain)) {
      const cells = [];
      for (let x = fountain.x - 1; x <= fountain.x + fountain.size; x++)
        for (let z = fountain.z - 1; z <= fountain.z + fountain.size; z++)
          if ((x < fountain.x || x >= fountain.x + fountain.size || z < fountain.z || z >= fountain.z + fountain.size) && walk.walkable(p.roofId, x, z)) cells.push({ x, z });
      cells.sort((a, b) => Math.hypot(a.x + 0.5 - p.x, a.z + 0.5 - p.z) - Math.hypot(b.x + 0.5 - p.x, b.z + 0.5 - p.z));
      const s = cells[0];
      const fx = Math.min(Math.max(s.x, fountain.x), fountain.x + fountain.size - 1);
      const fz = Math.min(Math.max(s.z, fountain.z), fountain.z + fountain.size - 1);
      return { stand: s, face: { x: fx, z: fz }, kind: 'wake' };
    }
    // A machine the fountain still wants, once it's affordable: the nearest spot it fits, built from beside it.
    const reqs = sim.progression.requirements();
    for (const [type, name] of Object.entries(NEEDED)) {
      if (reqs.some((r) => (r.label ?? '').includes(name) && r.done)) continue;
      if (!sim.build.isUnlocked(type)) continue;
      let spot;
      let spotD = Infinity;
      for (const t of sim.progression.tilesFor('home')) {
        const a = sim.build.anchorFor(type, t.x + 0.5, t.z + 0.5);
        const chk = sim.build.check(type, p.roofId, a.x, a.z);
        if (!chk.ok) continue;
        const size = sim.build.anchorFor(type, 0.4, 0.4).x < 0 ? 2 : 1; // a 2x2 anchors half a cell back
        for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          const sx = t.x + dx, sz = t.z + dz;
          const inside = sx >= a.x && sx < a.x + size && sz >= a.z && sz < a.z + size;
          if (inside || !walk.walkable(p.roofId, sx, sz)) continue;
          const d = Math.hypot(sx + 0.5 - p.x, sz + 0.5 - p.z);
          if (d < spotD) {
            spotD = d;
            spot = { stand: { x: sx, z: sz }, face: { x: t.x, z: t.z }, kind: 'build', type };
          }
        }
      }
      if (spot) return spot;
    }
    // Otherwise the nearest park tile a pulse would restore (dead ground first, then nurturing to full bloom),
    // with a walkable cell beside it.
    const restoring = !reqs[0]?.done;
    let best;
    let bestD = Infinity;
    for (const t of sim.progression.tilesFor('home')) {
      if (t.roofId !== p.roofId || t.occupantId || t.ground === 'growing') continue;
      if (restoring && t.ground === 'restored') continue;
      if (!pulsable(t)) continue;
      for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const sx = t.x + dx, sz = t.z + dz;
        if (!walk.walkable(p.roofId, sx, sz)) continue;
        const d = Math.hypot(sx + 0.5 - p.x, sz + 0.5 - p.z);
        if (d < bestD) {
          bestD = d;
          best = { stand: { x: sx, z: sz }, face: { x: t.x, z: t.z }, kind: 'pulse' };
        }
      }
    }
    return best;
  }

  function tick() {
    st.frames++;
    for (const b of release) {
      pad.buttons[b].pressed = false;
      pad.buttons[b].value = 0;
    }
    release = [];
    if (game.hud.introOpen || game.hud.modalOpen) {
      press(1); // B closes whatever is in the way
      return st;
    }
    if (sim.areas.fog('park') === 'cleared') {
      st.woke = true;
      still();
      return st;
    }
    // Harvest sunlight whenever it's ready (free energy).
    if (sim.state.harvestReadyAt <= sim.state.time && st.frames % 15 === 0) press(HARVEST);
    if (!target || (target.kind === 'pulse' && !pulsable(sim.grid.get(bot.pose.roofId, target.face.x, target.face.z))) || st.frames % 90 === 0) target = pickTarget();
    if (!target) {
      still();
      return st;
    }
    const p = bot.pose;
    const cx = target.stand.x + 0.5, cz = target.stand.z + 0.5;
    const d = Math.hypot(cx - p.x, cz - p.z);
    if (d > 0.18) {
      // Walk straight there; if a wall is in the way, slide around it by aiming a little to the side.
      const side = (st.frames >> 6) % 2 ? 1 : -1;
      const blocked = bot.speed < 0.2 && st.frames > 30;
      const ax = cx - p.x, az = cz - p.z;
      stick(blocked ? ax - az * side : ax, blocked ? az + ax * side : az, Math.min(1, 0.35 + d));
      nudge = 0;
      return st;
    }
    // At the spot: a brief tap toward the target turns bloombot to face it without leaving the cell.
    const f = walk.front(p);
    if (f.x !== target.face.x || f.z !== target.face.z) {
      // Keep a light push on until the turn completes (it may drift a little; walking puts it back).
      stick(target.face.x + 0.5 - p.x, target.face.z + 0.5 - p.z, 0.3);
      if (++nudge > 90) target = undefined; // can't line up: pick something else
      return st;
    }
    still();
    if (target.kind === 'wake') press(WAKE);
    else if (target.kind === 'build') {
      // Bumpers step through the tools until the machine is in hand, then A builds it in front.
      if (game.hud.currentTool !== target.type) {
        if (st.frames % 4 === 0) press(NEXT_TOOL);
      } else {
        press(PULSE);
        st.built = (st.built ?? 0) + 1;
        target = undefined;
      }
    }
    else if (sim.restoration.checkPulse(sim.grid.get(p.roofId, f.x, f.z)).ok && sim.time - lastPulseAt > 0.4) {
      press(PULSE);
      lastPulseAt = sim.time;
      st.pulses++;
    }
    return st;
  }
  return { tick, state: st };
}
