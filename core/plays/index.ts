/**
 * Plays — declarative workflows. Per ARCHITECTURE.md, Plays are authored
 * in natural language and compiled to durable workflows; for foundation we
 * hand-author the compiled form. NL → spec compilation comes when there's
 * a second Play that justifies the abstraction.
 */

export {
  createSeriesAColdOpenPlay,
} from "./series_a_cold_open.ts";
export type {
  ColdOpenInput,
  ColdOpenOutput,
  SeriesAColdOpenDeps,
} from "./series_a_cold_open.ts";

export { seedMayaForDemo } from "./seed.ts";
export type { SeedMayaResult, SeedMayaOptions } from "./seed.ts";
