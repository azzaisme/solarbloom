import { DECOR_OPTION, DECOR_OPTIONS } from '../data/cozy';
import { BUILDABLE, MACHINES, OLD_CITY_BUILDABLE } from '../data/machines';
import { TUNING } from '../data/tuning';
import { type Action, type Bindings, keyLabel } from '../app/Bindings';
import { actionGlyph, type GlyphStyle, type PadStyle, padName } from './Glyphs';
import { ICONS, iconize, MACHINE_ICONS, plain } from './Icons';
import { $, esc, HudPart } from './HudPart';
import { decorType, machineTool, type Tool } from './Hud';

/**
 * E22.5 (#342): the classic hotbar (Inspect, Pulse, the build tray, Harvest, Upgrades).
 * Under old-city rules it is not on the walking view: the build hotbar (slots 1–9, BuildBar) shows above the
 * prompt only while build mode is open.
 */
export class Hotbar extends HudPart {
  private tool: Tool = 'pulse';

  static template(oldCity = false): string {
    return [
      `<button class="slot" data-tool="inspect" aria-label="Inspect tool (1)"><span class="key">1</span><span class="si">${ICONS.inspect}</span><span class="sl">Inspect</span><span class="sc">&nbsp;</span></button>`,
      `<button class="slot" data-tool="pulse" aria-label="Restoration Pulse (2)"><span class="key">2</span><span class="si">${ICONS.pulse}</span><span class="sl"><span class="long">Restoration </span>Pulse</span><span class="sc"></span></button>`,
      `<span class="sep"></span>`,
      `<button class="slot" id="buildToggle" aria-label="Build menu (B)" aria-expanded="false"><span class="key">B</span><span class="si">${ICONS.build}</span><span class="sl">Build</span><span class="sc"></span></button>`,
      `<div id="buildTray">`,
      // E21.3: the Old City adds the Storage Chest (no number keys: the build menu reaches them)
      ...(oldCity ? OLD_CITY_BUILDABLE : BUILDABLE).map(
        (t) =>
          `<button class="slot" data-tool="${t}" aria-label="Build ${MACHINES[t].name}${MACHINES[t].hotkey ? ` (${MACHINES[t].hotkey})` : ''}"><span class="key">${MACHINES[t].hotkey ?? ''}</span><span class="si">${ICONS[MACHINE_ICONS[t]]}</span><span class="sl">${MACHINES[t].name.replace('Water ', '').replace('Pollinator ', '')}</span><span class="sc"></span></button>`,
      ),
      // E19.2: decorations, free once earned, and the remove tool
      `<span class="tray-break" aria-hidden="true"></span>`,
      ...DECOR_OPTIONS.map(
        (o) => `<button class="slot decor" data-tool="decor:${o.id}" hidden aria-label="Place a ${esc(plain(o.name))}" title="${esc(plain(o.blurb))}"><span class="si">${o.icon}</span><span class="sl">${esc(o.name)}</span><span class="sc">${o.solid ? '' : 'walk over'}</span></button>`,
      ),
      `<button class="slot decor" data-tool="remove" aria-label="Remove or move a decoration"><span class="si">🧹</span><span class="sl">Remove</span><span class="sc">or move</span></button>`,
      `</div>`,
      `<span class="sep"></span>`,
      `<button class="slot" id="harvestBtn" aria-label="Harvest sunlight (H)"><span class="key">H</span><span class="si">${ICONS.harvest}</span><span class="sl">Harvest</span><span class="sc">+${TUNING.harvest.energy}⚡</span><span class="cd"></span></button>`,
    ].join('');
  }

  wire() {
    const r = this.root;
    r.querySelectorAll<HTMLButtonElement>('#hotbar [data-tool]').forEach((b) => b.addEventListener('click', () => this.cb.selectTool(b.dataset.tool as Tool)));
    $(r, '#harvestBtn').addEventListener('click', () => this.cb.harvest());
    $(r, '#buildToggle').addEventListener('click', () => this.toggleTray());
  }

  get currentTool() {
    return this.tool;
  }

  setTool(t: Tool) {
    this.tool = t;
    this.root.querySelectorAll<HTMLElement>('[data-tool]').forEach((b) => b.classList.toggle('active', b.dataset.tool === t));
    const building = t !== 'pulse' && t !== 'inspect';
    const tg = $(this.root, '#buildToggle');
    tg.classList.toggle('active', building);
    const dk = decorType(t);
    const dec = dk ? DECOR_OPTION[dk] : undefined;
    const def = machineTool(t) ? MACHINES[t] : undefined;
    $(tg, '.si').innerHTML = machineTool(t) ? ICONS[MACHINE_ICONS[t]] : dec ? iconize(dec.icon) : t === 'remove' ? iconize('🧹') : ICONS.build;
    $(tg, '.sl').textContent = def ? def.name.replace('Water ', '').replace('Pollinator ', '') : dec ? dec.name : t === 'remove' ? 'Remove' : 'Build';
    this.toggleTray(false);
    this.hud.buildBar.render(t);
  }

  /** The Build tray: machines and their costs pop up above the hotbar (Phase 4 E02.2: all screen sizes). */
  toggleTray(open?: boolean) {
    const tray = $(this.root, '#buildTray');
    const o = open ?? !tray.classList.contains('open');
    tray.classList.toggle('open', o);
    $(this.root, '#buildToggle').setAttribute('aria-expanded', String(o));
    // A closed menu keeps no focus: the pad's A and the keyboard's Space go back to the game, not to a hidden card.
    const a = document.activeElement as HTMLElement | null;
    if (!o && a && $(this.root, '#hotbar').contains(a)) a.blur();
  }

  get trayOpen() {
    return $(this.root, '#buildTray').classList.contains('open');
  }

  /**
   * Bloombot (G.16, G.7): the hotbar's key badges from the bindings, or gamepad buttons when the pad was used
   * last. Without bindings, the cursor map.
   */
  /** E22.3: the badges follow the glyph set in use (a key, or the pad button's name in that pad's family). */
  setKeyMap(style: GlyphStyle | undefined, b?: Bindings) {
    const mode = style === undefined ? undefined : style === 'keys' ? 'keys' : 'pad';
    const slots: [string, Action, string][] = [
      ['[data-tool="inspect"]', 'interact', '1'],
      ['[data-tool="pulse"]', 'pulse', '2'],
      ['#buildToggle', 'buildMenu', 'B'],
      ['#harvestBtn', 'harvest', 'H'],
    ];
    for (const [sel, action, cursor] of slots) {
      const el = this.root.querySelector<HTMLElement>(`#hotbar ${sel} .key`);
      if (!el) continue;
      // E22.1: a badge shows a keyboard key (the mouse buttons are too long for it)
      const key = b?.keys[action].find((c) => !c.startsWith('Mouse') && c !== 'Wheel');
      el.textContent = !b || !mode ? cursor : mode === 'pad' ? padShort(style as PadStyle, b.pad[action]) : key ? keyLabel(key) : '';
    }
    this.root.classList.toggle('pad-keys', mode === 'pad');
  }

  update() {
    const s = this.sim;
    // Hotbar costs
    for (const t of s.oldCity ? OLD_CITY_BUILDABLE : BUILDABLE) {
      const btn = $(this.root, `#hotbar [data-tool="${t}"]`);
      // E21.3: under old-city rules the price is the recipe (material icons, have / need)
      this.set(`hc-${t}`, $(btn, '.sc'), 'text', s.build.costLabel(t));
      this.set(`hk-${t}`, btn, 'cls', s.build.affordable(t) ? '0' : '1', 'cant');
      const locked = !s.build.isUnlocked(t);
      this.set(`hl-${t}`, btn, 'cls', locked ? '1' : '0', 'locked');
      // A rooftop's specialty piece only appears once that rooftop is reachable.
      const roofOnly = MACHINES[t].roofs;
      btn.hidden = !!roofOnly && !s.build.isUnlocked(t);
      if (locked) this.set(`hc-${t}`, $(btn, '.sc'), 'text', s.build.lockLabel(t));
    }
    // E19.2: a decoration's slot appears once it's earned
    const earned = s.state.cozy?.decorUnlocked;
    for (const o of DECOR_OPTIONS) {
      const on = 'start' in o.unlock || !!earned?.includes(o.id);
      if (this.last.get(`dc-${o.id}`) === String(on)) continue;
      this.last.set(`dc-${o.id}`, String(on));
      $(this.root, `#hotbar [data-tool="decor:${o.id}"]`).hidden = !on;
    }
    // Overcharge countdown on the Pulse button
    const every = s.upgrades.overchargeEvery;
    const pc0 = s.state.progression.pulseCharge ?? 0;
    const mega = s.restoration.megaReady();
    const pulseSc = mega ? '💥 MEGA next!' : every ? (pc0 === every - 1 ? '🌟 next!' : '●'.repeat(pc0) + '○'.repeat(every - pc0)) : '';
    this.set('pulseSc', $(this.root, '[data-tool="pulse"] .sc'), 'text', pulseSc);
    // Mega Pulse meter: a fill along the bottom of the Pulse button.
    const mf = s.state.progression.coreActivated ? Math.min(1, (s.state.progression.megaCharge ?? 0) / TUNING.mega.charge) : 0;
    const pb = $(this.root, '[data-tool="pulse"]');
    this.set('megaFill', pb, 'style', mf.toFixed(2), '--mega');
    this.set('megaOn', pb, 'cls', mega ? '1' : '0', 'mega');
    const cd = Math.max(0, s.state.harvestReadyAt - s.time);
    const hb = $(this.root, '#harvestBtn');
    this.set('hcd', $(hb, '.cd'), 'html', '');
    ($(hb, '.cd') as HTMLElement).style.transform = `scaleY(${cd / TUNING.harvest.cooldown})`;
    this.set('hsc', $(hb, '.sc'), 'text', cd > 0 ? `${Math.ceil(cd)}s` : `+${TUNING.harvest.energy}⚡`);
  }
}

/** A short gamepad label for the small hotbar badges. */
function padShort(style: PadStyle, button: number | undefined): string {
  const arrows: Record<number, string> = { 12: '↑', 13: '↓', 14: '←', 15: '→' };
  return button === undefined ? '' : (arrows[button] ?? padName(style, button));
}

/** E22.1 / E22.7: the build hotbar's default contents (slots 1–9): the machines in the old number-row order. */
export const HOTBAR_DEFAULT: readonly string[] = ['solar', 'condenser', 'pollinator', 'droneHub', 'motherTree', 'reservoirGarden', 'relay', 'cultivator', ''];

/** A tool's icon and short name, for the build hotbar and the build menu. */
export function toolFace(t: string): { icon: string; name: string } | undefined {
  if (!t) return undefined;
  if (t === 'remove') return { icon: '🧹', name: 'Remove' };
  const d = decorType(t as Tool);
  if (d) return DECOR_OPTION[d] ? { icon: DECOR_OPTION[d].icon, name: DECOR_OPTION[d].name } : undefined;
  if (machineTool(t as Tool)) return { icon: ICONS[MACHINE_ICONS[t as keyof typeof MACHINE_ICONS]] ?? MACHINES[t as keyof typeof MACHINES].icon, name: MACHINES[t as keyof typeof MACHINES].name };
  return undefined;
}

/**
 * E22.5 (#342): the build hotbar: slots 1–9 (keyboard; the pad uses the build menu), above the prompt while
 * build mode is open, with the piece in hand lit. What each slot holds is a setting (E22.7 pins cards to it).
 */
export class BuildBar extends HudPart {
  private keys: string[] = ['1', '2', '3', '4', '5', '6', '7', '8', '9'];
  /** E23.3.4: the Power view's glyph, and whether it is on (the game sets it). */
  private powerGlyph = '';
  powerOn = false;

  static template(): string {
    return `<div id="buildbar" class="panel" role="toolbar" aria-label="Build hotbar" hidden></div>`;
  }

  slots(): string[] {
    const h = this.settings.hotbar ?? HOTBAR_DEFAULT;
    return Array.from({ length: 9 }, (_, i) => h[i] ?? '');
  }

  setKeys(style: GlyphStyle | undefined, b?: Bindings) {
    if (!b) return;
    this.keys = (['slot1', 'slot2', 'slot3', 'slot4', 'slot5', 'slot6', 'slot7', 'slot8', 'slot9'] as Action[]).map((a) => (b.keys[a][0] ? keyLabel(b.keys[a][0]) : ''));
    this.powerGlyph = actionGlyph(b, 'powerOverlay', style ?? 'keys');
    this.last.delete('buildbar');
  }

  /** Shows the bar while something is in hand to build (or remove), with that slot lit. */
  render(tool: Tool) {
    const el = $(this.root, '#buildbar');
    const building = tool !== 'pulse' && tool !== 'inspect';
    el.hidden = !building;
    document.body.classList.toggle('building', building);
    if (!building) return;
    const html = this.slots()
      .map((t, i) => {
        const f = toolFace(t);
        const locked = machineTool(t as Tool) && !this.sim.build.isUnlocked(t as never);
        return `<div class="bslot${t === tool ? ' on' : ''}${f ? '' : ' empty'}${locked ? ' locked' : ''}" aria-label="${f ? `Slot ${i + 1}: ${esc(f.name)}` : `Slot ${i + 1}: empty`}"><span class="key">${esc(this.keys[i] ?? '')}</span>${f ? `<span class="si">${f.icon}</span><span class="sl">${esc(f.name)}</span>` : ''}</div>`;
      })
      .join('');
    // E23.3.4: the Power view toggle sits at the end of the bar (once there is a grid to show)
    const power = this.sim.power.networks().length
      ? `<div class="bslot power${this.powerOn ? ' on' : ''}" aria-label="Power view ${this.powerOn ? 'on' : 'off'}"><span class="key glyph">${this.powerGlyph}</span><span class="sl">Power</span></div>`
      : '';
    this.set('buildbar', el, 'html', html + power);
  }
}
