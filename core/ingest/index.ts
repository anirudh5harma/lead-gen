/**
 * Signal ingestion. See docs/signal-ingestion.md for the architecture.
 *
 * Two stages, decoupled by the typed event bus:
 *   Stage 1 — adapters poll + embed + dedup + insert into signal_candidates;
 *             emit signal.ingested.
 *   Stage 2 — classifier batches off signal.ingested, scores candidates
 *             against every ICP segment in their workspace, emits
 *             signal.matched / signal.dismissed.
 *
 * Catalog-driven adapters (Greenhouse, Lever, Ashby, Workable, SEC EDGAR)
 * poll ONCE platform-wide and fan results out to interested workspaces.
 * Workspace-driven adapters (custom RSS, keyword searches) poll per
 * workspace.
 */

export type { RawCandidate, EmbeddingInput } from "./types.ts";
export {
  createOpenAIEmbeddingClient,
  createMockEmbeddingClient,
  vectorToPgLiteral,
  EmbeddingError,
} from "./embeddings.ts";
export type {
  EmbeddingClient,
  OpenAIEmbeddingOptions,
  MockEmbeddingOptions,
} from "./embeddings.ts";
export {
  computeNoveltyKey,
  probeExactDuplicate,
  probeFuzzyDuplicate,
  recordCollision,
  dedupCheck,
} from "./novelty.ts";
export type {
  NoveltyKeyInput,
  FuzzyProbeOptions,
  FuzzyProbeResult,
  DedupCheckInput,
  DedupCheckResult,
} from "./novelty.ts";
