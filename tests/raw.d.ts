/** Vite's `?raw` imports (file contents as a string), used by source checks in tests. */
declare module '*?raw' {
  const text: string;
  export default text;
}
