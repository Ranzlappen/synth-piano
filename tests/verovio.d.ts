// Minimal typings for the parts of the Verovio toolkit used in tests (the app loads
// Verovio in a classic worker, see src/renderer/public/workers/engraver.js).
declare module 'verovio/wasm' {
  const createVerovioModule: () => Promise<unknown>;
  export default createVerovioModule;
}
declare module 'verovio/esm' {
  export class VerovioToolkit {
    constructor(module: unknown);
    setOptions(options: Record<string, unknown>): void;
    loadData(data: string): boolean | number;
    getMEI(options?: Record<string, unknown>): string;
    getPageCount(): number;
    renderToSVG(page: number): string;
    getLog(): string;
    getVersion(): string;
  }
}
