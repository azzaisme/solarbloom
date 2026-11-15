/** Vite's build flags (the project doesn't load vite/client types). */
interface ImportMeta {
  readonly env: { readonly DEV: boolean; readonly PROD: boolean; readonly MODE: string; readonly BASE_URL: string };
}
