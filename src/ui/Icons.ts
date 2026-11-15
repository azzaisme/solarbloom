/**
 * Phase 4 E02.4: one consistent set of small inline SVG icons for the HUD (resources and the main tools).
 * Rounded, filled shapes in the game's palette; every use also carries a text label or aria-label.
 * Machine silhouettes share the ceramic, brass and botanical model palette.
 */
const svg = (body: string) => `<svg class="icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false">${body}</svg>`;

export const ICONS = {
  pulse: svg('<g fill="#ecf3ac" stroke="#bbd885" stroke-width=".7"><path d="M12 16C7 11 8 5 12 1c4 4 5 10 0 15Z"/><path d="M11 18C5 18 2 13 1 8c6 0 10 3 10 10Z"/><path d="M13 18c6 0 9-5 10-10-6 0-10 3-10 10Z"/></g><path d="M12 11v12M7 22h10" stroke="#f3e6a4" stroke-width="1.5" stroke-linecap="round"/>'),
  solar: svg('<path d="m5 3 17 1-4 12-17-1Z" fill="#326d9d" stroke="#e6ecdd" stroke-width="1.4"/><path d="m10 4-4 11M16 4l-4 11M3 8h17M2 12h17" stroke="#95d9ed" stroke-width=".8"/><path d="M10 16v5m-5 0h11" stroke="#e2c584" stroke-width="2"/>'),
  condenser: svg('<rect x="6" y="3" width="12" height="14" rx="4" fill="#95e6eb" stroke="#f6f0d8" stroke-width="2"/><path d="M8 5v8M7 18h10v3H7" stroke="#d8b56b" stroke-width="2"/><path d="M12 7c-6 6 6 6 0 0" fill="#298ea9"/>'),
  pollinator: svg('<path d="M4 15h16l-3 7H7Z" fill="#f3e3c1"/><path d="M12 16V6m0 6L5 8m7 6 7-5" stroke="#9fce6b" stroke-width="2"/><g fill="#f4b9d4"><circle cx="12" cy="5" r="4"/><circle cx="5" cy="8" r="3"/><circle cx="19" cy="8" r="3"/></g><circle cx="12" cy="5" r="1.5" fill="#ffe198"/>'),
  droneHub: svg('<ellipse cx="12" cy="19" rx="10" ry="3" fill="#a4e6dc"/><rect x="5" y="6" width="14" height="10" rx="5" fill="#f6efd9"/><rect x="7" y="9" width="10" height="5" rx="2" fill="#295651"/><path d="M10 11v1m4-1v1M12 6V3" stroke="#b9efb0" stroke-width="1.5"/><path d="m4 10-3-4 6 2m13 2 3-4-6 2" fill="#a2d478"/>'),
  motherTree: svg('<path d="M12 13v9m-4-1h8" stroke="#dbbf89" stroke-width="2"/><path d="M12 2c-7 0-11 10-7 13h14c4-3 0-13-7-13" fill="#9ccf75"/><circle cx="9" cy="10" r="2" fill="#f2bcd1"/><circle cx="15" cy="7" r="2" fill="#ffdf8a"/>'),
  relay: svg('<path d="M12 8v14m-5 0h10" stroke="#f1e9cc" stroke-width="2"/><circle cx="12" cy="7" r="3" fill="#a8e5b0"/><path d="M6 3a7 7 0 0 0 0 9M18 3a7 7 0 0 1 0 9" fill="none" stroke="#dcbe77" stroke-width="1.5"/>'),
  reservoirGarden: svg('<ellipse cx="12" cy="15" rx="10" ry="6" fill="#eee5cf"/><ellipse cx="12" cy="14" rx="8" ry="4" fill="#78dce1"/><path d="M12 14V4m0 4L7 4m5 5 5-5" stroke="#94bc66" stroke-width="2"/>'),

  energy: svg('<path d="M13.5 2 5 13.2h5.6L9.6 22 19 9.8h-5.7z" fill="#ffc93c" stroke="#c98a00" stroke-width="1.4" stroke-linejoin="round"/>'),
  water: svg('<path d="M12 2.5C9 7 5.5 10.6 5.5 14.6a6.5 6.5 0 0 0 13 0C18.5 10.6 15 7 12 2.5z" fill="#4fb3e8" stroke="#1f7fb3" stroke-width="1.4" stroke-linejoin="round"/><path d="M9.2 14.8a3 3 0 0 0 2.6 3" fill="none" stroke="#e8f7ff" stroke-width="1.6" stroke-linecap="round"/>'),
  biomass: svg('<path d="M19.5 3.5C11 3.5 5 7.8 5 14.2c0 2 .6 3.7 1.6 5 4.6-.3 12.9-3.6 12.9-15.7z" fill="#6cc24a" stroke="#2f7a2a" stroke-width="1.4" stroke-linejoin="round"/><path d="M4 21c3-5 7-8.6 11.5-11" fill="none" stroke="#2f7a2a" stroke-width="1.6" stroke-linecap="round"/>'),
  inspect: svg('<circle cx="10.5" cy="10.5" r="6" fill="#e8f4fb" stroke="#4a6a7a" stroke-width="2"/><path d="m15 15 5.5 5.5" stroke="#4a6a7a" stroke-width="2.6" stroke-linecap="round"/>'),
  build: svg('<path d="M14.2 3.6 20.4 9.8l-2.2 2.2-2-2-8.6 8.6a2 2 0 0 1-2.8 0l-.2-.2a2 2 0 0 1 0-2.8l8.6-8.6-1.2-1.2z" fill="#f0b45a" stroke="#8a5a1a" stroke-width="1.4" stroke-linejoin="round"/>'),
  pulseLegacy: svg('<path d="M12 2.5 13.9 9l6.6 1.9-6.6 1.9L12 19.4l-1.9-6.6L3.5 10.9 10.1 9z" fill="#fff6c2" stroke="#2c8f3b" stroke-width="1.4" stroke-linejoin="round"/><circle cx="18.5" cy="18" r="2" fill="#fff6c2" stroke="#2c8f3b" stroke-width="1.2"/>'),
  harvest: svg('<circle cx="12" cy="12" r="4.6" fill="#ffd34d" stroke="#c98a00" stroke-width="1.4"/><g stroke="#e0a100" stroke-width="2" stroke-linecap="round"><path d="M12 2.5v2.6M12 18.9v2.6M2.5 12h2.6M18.9 12h2.6M5.3 5.3l1.8 1.8M16.9 16.9l1.8 1.8M5.3 18.7l1.8-1.8M16.9 7.1l1.8-1.8"/></g>'),
  upgrades: svg('<path d="M12 3.5 4.5 11h4.6v8.5h5.8V11h4.6z" fill="#8fd36f" stroke="#2f7a2a" stroke-width="1.4" stroke-linejoin="round"/>'),
  pause: svg('<rect x="6" y="5" width="4.2" height="14" rx="1.4" fill="#4a6a7a"/><rect x="13.8" y="5" width="4.2" height="14" rx="1.4" fill="#4a6a7a"/>'),
  play: svg('<path d="M7.5 4.8v14.4L19 12z" fill="#2c8f3b" stroke="#2c8f3b" stroke-width="1.2" stroke-linejoin="round"/>'),
  frenzy: svg('<path d="M12 2.2c1 3.4 3.4 4.6 3.4 7.6a3.4 3.4 0 0 1-6.8 0c0-1.2.5-2.1 1.2-2.9-2.6 1.4-4.6 4.2-4.6 7.6a6.8 6.8 0 0 0 13.6 0c0-5.6-4.4-8.4-6.8-12.3z" fill="#ffd34d" stroke="#3f9a2f" stroke-width="1.4" stroke-linejoin="round"/>'),
} as const;

export type IconName = keyof typeof ICONS;
