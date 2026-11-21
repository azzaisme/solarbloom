/**
 * #616: a setting with a few choices, changed in place: ‹ Normal ›. It replaces the native drop-down, which a
 * gamepad can't open (and on the Steam Deck opens a list the d-pad can't drive).
 *
 * - The pad: d-pad left and right change it while it has the focus (PadFocus); A steps to the next choice, round
 *   to the first after the last.
 * - The keyboard: the arrow keys left and right change it, Enter and Space step on, like A.
 * - The mouse: the arrows step back and on; a click on the value steps on.
 *
 * Each change sets `data-value` and fires a bubbling `change` event, as a <select> does, so the screen that drew it
 * saves the new value the same way. It is one focus stop (`role="spinbutton"`, its value read out by name); the
 * arrows are for the mouse only and never take the focus.
 */
type Choice = readonly [value: string, label: string];

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);

export interface StepperSpec {
  id: string;
  /** what a screen reader says it is (the row's label) */
  label: string;
  options: readonly Choice[];
  value: string;
  /** extra attributes for the stepper itself (`data-key="uiScale"`) */
  attrs?: string;
}

/** The stepper's markup, showing `value` (or the first choice when it isn't one). */
export function stepperHtml(s: StepperSpec): string {
  const i = Math.max(0, s.options.findIndex(([v]) => v === s.value));
  const [v, l] = s.options[i];
  const last = s.options.length - 1;
  return (
    `<span class="stepper" id="${esc(s.id)}" role="spinbutton" tabindex="0" aria-label="${esc(s.label)}" aria-valuemin="0" aria-valuemax="${last}" aria-valuenow="${i}" aria-valuetext="${esc(l)}" data-value="${esc(v)}" data-options="${esc(JSON.stringify(s.options))}" ${s.attrs ?? ''}>` +
    `<button type="button" class="st-arrow" data-step="-1" tabindex="-1" aria-hidden="true"${i === 0 ? ' disabled' : ''}>‹</button>` +
    `<span class="st-val">${esc(l)}</span>` +
    `<button type="button" class="st-arrow" data-step="1" tabindex="-1" aria-hidden="true"${i === last ? ' disabled' : ''}>›</button></span>`
  );
}

const options = (el: HTMLElement): Choice[] => JSON.parse(el.dataset.options ?? '[]') as Choice[];

/**
 * Moves a stepper `dir` choices along: stops at either end, or with `wrap` goes round. True when the value changed
 * (and then the `change` event has fired).
 */
export function stepStepper(el: HTMLElement, dir: number, wrap = false): boolean {
  const opts = options(el);
  if (!opts.length) return false;
  const i = Math.max(0, opts.findIndex(([v]) => v === el.dataset.value));
  let j = i + dir;
  if (wrap) j = ((j % opts.length) + opts.length) % opts.length;
  else j = Math.min(opts.length - 1, Math.max(0, j));
  if (j === i) return false;
  const [v, l] = opts[j];
  el.dataset.value = v;
  el.setAttribute('aria-valuenow', String(j));
  el.setAttribute('aria-valuetext', l);
  el.querySelector('.st-val')!.textContent = l;
  const [prev, next] = el.querySelectorAll<HTMLButtonElement>('.st-arrow');
  prev.disabled = j === 0;
  next.disabled = j === opts.length - 1;
  el.dispatchEvent(new Event('change', { bubbles: true }));
  return true;
}

/** Wires every stepper inside `root`, now and drawn later: the mouse on its arrows and value, and the keys. */
export function wireSteppers(root: HTMLElement): void {
  root.addEventListener('click', (e) => {
    const t = e.target as HTMLElement;
    const st = t.closest<HTMLElement>('.stepper');
    if (!st || !root.contains(st)) return;
    e.preventDefault(); // a stepper inside a <label> must not pass the click on
    const arrow = t.closest<HTMLButtonElement>('.st-arrow');
    stepStepper(st, arrow ? Number(arrow.dataset.step) : 1, !arrow);
    st.focus();
  });
  root.addEventListener('keydown', (e) => {
    const st = (e.target as HTMLElement).closest?.<HTMLElement>('.stepper');
    // the game's own arrow handling (PadFocus) may have stepped it already: it marks the key as used
    if (!st || e.defaultPrevented) return;
    const dir = e.key === 'ArrowLeft' ? -1 : e.key === 'ArrowRight' ? 1 : e.key === 'Enter' || e.key === ' ' ? 0 : undefined;
    if (dir === undefined) return;
    e.preventDefault();
    e.stopPropagation();
    if (dir) stepStepper(st, dir);
    else stepStepper(st, 1, true);
  });
}
