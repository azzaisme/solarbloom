/**
 * Phase 4 E02.4: one consistent set of small inline SVG icons for the HUD (resources and the main tools).
 * Rounded, filled shapes in the game's palette; every use also carries a text label or aria-label.
 * Machines keep their emoji as placeholders until they get icons of their own.
 */
const svg = (body: string) => `<svg class="icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false">${body}</svg>`;

export const ICONS = {
  energy: svg('<path d="M13.5 2 5 13.2h5.6L9.6 22 19 9.8h-5.7z" fill="#ffc93c" stroke="#c98a00" stroke-width="1.4" stroke-linejoin="round"/>'),
  water: svg('<path d="M12 2.5C9 7 5.5 10.6 5.5 14.6a6.5 6.5 0 0 0 13 0C18.5 10.6 15 7 12 2.5z" fill="#4fb3e8" stroke="#1f7fb3" stroke-width="1.4" stroke-linejoin="round"/><path d="M9.2 14.8a3 3 0 0 0 2.6 3" fill="none" stroke="#e8f7ff" stroke-width="1.6" stroke-linecap="round"/>'),
  biomass: svg('<path d="M19.5 3.5C11 3.5 5 7.8 5 14.2c0 2 .6 3.7 1.6 5 4.6-.3 12.9-3.6 12.9-15.7z" fill="#6cc24a" stroke="#2f7a2a" stroke-width="1.4" stroke-linejoin="round"/><path d="M4 21c3-5 7-8.6 11.5-11" fill="none" stroke="#2f7a2a" stroke-width="1.6" stroke-linecap="round"/>'),
  inspect: svg('<circle cx="10.5" cy="10.5" r="6" fill="#e8f4fb" stroke="#4a6a7a" stroke-width="2"/><path d="m15 15 5.5 5.5" stroke="#4a6a7a" stroke-width="2.6" stroke-linecap="round"/>'),
  build: svg('<path d="M14.2 3.6 20.4 9.8l-2.2 2.2-2-2-8.6 8.6a2 2 0 0 1-2.8 0l-.2-.2a2 2 0 0 1 0-2.8l8.6-8.6-1.2-1.2z" fill="#f0b45a" stroke="#8a5a1a" stroke-width="1.4" stroke-linejoin="round"/>'),
  pulse: svg('<path d="M12 2.5 13.9 9l6.6 1.9-6.6 1.9L12 19.4l-1.9-6.6L3.5 10.9 10.1 9z" fill="#fff6c2" stroke="#2c8f3b" stroke-width="1.4" stroke-linejoin="round"/><circle cx="18.5" cy="18" r="2" fill="#fff6c2" stroke="#2c8f3b" stroke-width="1.2"/>'),
  harvest: svg('<circle cx="12" cy="12" r="4.6" fill="#ffd34d" stroke="#c98a00" stroke-width="1.4"/><g stroke="#e0a100" stroke-width="2" stroke-linecap="round"><path d="M12 2.5v2.6M12 18.9v2.6M2.5 12h2.6M18.9 12h2.6M5.3 5.3l1.8 1.8M16.9 16.9l1.8 1.8M5.3 18.7l1.8-1.8M16.9 7.1l1.8-1.8"/></g>'),
  upgrades: svg('<path d="M12 3.5 4.5 11h4.6v8.5h5.8V11h4.6z" fill="#8fd36f" stroke="#2f7a2a" stroke-width="1.4" stroke-linejoin="round"/>'),
  pause: svg('<rect x="6" y="5" width="4.2" height="14" rx="1.4" fill="#4a6a7a"/><rect x="13.8" y="5" width="4.2" height="14" rx="1.4" fill="#4a6a7a"/>'),
  play: svg('<path d="M7.5 4.8v14.4L19 12z" fill="#2c8f3b" stroke="#2c8f3b" stroke-width="1.2" stroke-linejoin="round"/>'),
  frenzy: svg('<path d="M12 2.2c1 3.4 3.4 4.6 3.4 7.6a3.4 3.4 0 0 1-6.8 0c0-1.2.5-2.1 1.2-2.9-2.6 1.4-4.6 4.2-4.6 7.6a6.8 6.8 0 0 0 13.6 0c0-5.6-4.4-8.4-6.8-12.3z" fill="#ffd34d" stroke="#3f9a2f" stroke-width="1.4" stroke-linejoin="round"/>'),
} as const;

export type IconName = keyof typeof ICONS;
