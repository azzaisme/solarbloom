/**
 * E22.2 (#339): the one prompt at the bottom centre: the button's glyph, a verb and a name ("E Talk to Pylon"),
 * a ring round the glyph that fills while a hold is under way, a second, smaller line when Pulse also applies
 * ("X Pulse"), and the reason when the action is refused ("Backpack full"). Nothing shows when there is nothing
 * to do. Glyphs are HTML (E22.3 draws them as SVG for the device in use). E23.11: a 54 px paper pill, the hold ring
 * in leaf green, the Pulse line a smaller pill under it, refused in clay (docs/art/ui-sunlit-glass/Walk.dc.html).
 */
export interface PromptModel {
  glyph: string;
  text: string;
  /** a hold: the glyph gets a ring, and "Hold" before the verb */
  hold?: boolean;
  /** 0..1 while a hold is under way */
  progress?: number;
  refused?: string;
  /** the Pulse line under it, when Pulse also does something here */
  pulse?: { glyph: string; text: string };
  /** E23.11: what it costs, as chips on the second line ("2 of 2 Timber"; ok = you have enough) */
  chips?: { text: string; ok: boolean }[];
}

export class Prompt {
  readonly el: HTMLElement;
  private shown = '';
  private ring?: HTMLElement;

  constructor(root: HTMLElement) {
    this.el = document.createElement('div');
    this.el.id = 'prompt';
    this.el.setAttribute('role', 'status');
    this.el.setAttribute('aria-live', 'polite');
    this.el.hidden = true;
    root.appendChild(this.el);
  }

  show(m: PromptModel | undefined) {
    const html = m ? promptHtml(m) : '';
    if (html !== this.shown) {
      this.shown = html;
      this.el.innerHTML = html;
      this.el.hidden = !m;
      this.ring = this.el.querySelector<HTMLElement>('.pr-ring') ?? undefined;
    }
    // The ring fills every frame without rebuilding the prompt.
    if (this.ring) this.ring.style.setProperty('--p', String(Math.max(0, Math.min(1, m?.progress ?? 0))));
  }

  get visible(): boolean {
    return !this.el.hidden;
  }

  get text(): string {
    return this.el.textContent ?? '';
  }
}

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);

/** The prompt's markup (glyph, words, ring, the pulse line). Exported for tests. */
export function promptHtml(m: PromptModel): string {
  const glyph = `<span class="pr-glyph${m.hold ? ' pr-hold' : ''}">${m.hold ? '<i class="pr-ring" aria-hidden="true"></i>' : ''}${m.glyph}</span>`;
  const words = `${m.hold ? 'Hold ' : ''}${esc(m.text)}`;
  // #590: refused, the words keep to one line and the reason wraps under them (side by side, a long reason squeezed
  // the words to one per line)
  const main = m.refused
    ? `<div class="pr-main pr-refused sg-card">${glyph}<span class="pr-body"><span class="pr-text">${words}</span><span class="pr-why">${esc(m.refused)}</span></span></div>`
    : `<div class="pr-main sg-card">${glyph}<span class="pr-text">${words}</span></div>`;
  const chips = (m.chips ?? []).map((c) => `<span class="pr-chip ${c.ok ? 'ok' : 'need'}">${esc(c.text)}</span>`).join('');
  const lead = m.pulse ? `<span class="pr-glyph">${m.pulse.glyph}</span><span class="pr-text">${esc(m.pulse.text)}</span>` : '';
  const pulse = lead || chips ? `<div class="pr-sub sg-card">${lead}${chips}</div>` : '';
  return main + pulse;
}
