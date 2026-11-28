/**
 * Work by other people that needs a credit in the game (docs/art/CREDITS.md lists the same, with what was changed).
 * Shown under Settings › Game › Credits, on the title screen and in game. The audio is all CC0 and needs none.
 */
export interface Credit {
  /** what it is in the game */
  what: string;
  /** the work's own title */
  title: string;
  author: string;
  source: string;
  licence: string;
  licenceUrl: string;
}

export const CREDITS: readonly Credit[] = [
  {
    what: 'The frog',
    title: 'Frog Hopping',
    author: 'radicalindigo',
    source: 'https://skfb.ly/6S6uZ',
    licence: 'CC BY 4.0',
    licenceUrl: 'http://creativecommons.org/licenses/by/4.0/',
  },
];
