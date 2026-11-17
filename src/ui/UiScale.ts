/**
 * Steam Deck (#243): the HUD's UI scale (100 / 125 / 150%). The HUD root is zoomed with CSS `zoom`, so anything
 * placed inside it from screen coordinates (tooltips, labels, flying numbers) divides by the scale first, and
 * "the window's width" inside the HUD is the real width divided by it.
 */
export const ui = { scale: 1 };
/** A screen length (CSS px of the window) as a length inside the zoomed HUD. */
export const toHud = (v: number) => v / ui.scale;
export const hudWidth = () => window.innerWidth / ui.scale;
export const hudHeight = () => window.innerHeight / ui.scale;
