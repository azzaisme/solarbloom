/** Vite's `?raw` imports (file contents as a string), used by source checks in tests. */
declare module '*?raw' {
  const text: string;
  export default text;
}

/** Vite's `import.meta.glob` (eager raw imports of many source files, for source checks in tests). */
interface ImportMeta {
  glob(pattern: string | string[], options: { query: '?raw'; import: 'default'; eager: true }): Record<string, string>;
}
