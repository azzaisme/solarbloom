import type { Sim } from '../gameplay/Sim';
import type { Hud, HudCallbacks, Settings } from './Hud';

export type SetProp = 'text' | 'html' | 'width' | 'cls' | 'style' | 'title';

/**
 * E22.5 (#342): Hud.ts is a shell over parts (Bars, ObjectiveCard, Hotbar, Toasts, Panels). Each part reads the
 * shared state through this base: the HUD root, the sim, the callbacks into the game, the settings and the
 * change-detected `set` (so a value that didn't change never touches the DOM).
 */
export abstract class HudPart {
  constructor(protected readonly hud: Hud) {}

  protected get root(): HTMLElement {
    return this.hud.root;
  }

  protected get sim(): Sim {
    return this.hud.sim;
  }

  protected get cb(): HudCallbacks {
    return this.hud.cb;
  }

  protected get settings(): Settings {
    return this.hud.settings;
  }

  protected get last(): Map<string, string> {
    return this.hud.last;
  }

  protected set(key: string, el: HTMLElement, prop: SetProp, value: string, cls?: string) {
    this.hud.set(key, el, prop, value, cls);
  }
}

export const $ = <T extends HTMLElement = HTMLElement>(root: ParentNode, sel: string) => root.querySelector(sel) as T;

export function esc(s: string) {
  return s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
}
