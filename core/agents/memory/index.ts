/**
 * Rep memory — three explicit tiers. See ./types.ts and ARCHITECTURE.md.
 *
 * Procedural memory is the moat: it grows from positive outcomes, and the
 * hot-path judge (core/agents/eval/) retrieves from it as few-shot examples
 * when grading new drafts. The outcome → procedural loop is the single
 * compounding asset in pivot-v2.
 */

export * from "./types.ts";
