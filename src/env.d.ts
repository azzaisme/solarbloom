/** Vite's build flags (the project doesn't load vite/client types). */
interface ImportMeta {
  /** Vite's glob import (the painted icons' URLs). */
  glob(pattern: string | string[], options: { query: '?url'; import: 'default'; eager: true }): Record<string, unknown>;
  readonly env: { readonly DEV: boolean; readonly PROD: boolean; readonly MODE: string };
}
