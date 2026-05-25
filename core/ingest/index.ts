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

// Cheap-path infrastructure
export {
  ensureBudgetRow,
  reserveCandidate,
  reserveClassify,
  refundCandidate,
  recordOverflow,
  readBudget,
} from "./budget.ts";
export type { BudgetState } from "./budget.ts";

export {
  listIcps,
  getIcp,
  createIcp,
  updateIcp,
  deleteIcp,
  IcpInput,
  IcpRow,
  IcpPredicateRule,
} from "./icps.ts";

export {
  evaluateRule,
  evaluateMustHaves,
  firstMatchingIcp,
  allMatchingIcps,
} from "./icp-filter.ts";
export type { PredicateContext, PredicateResult } from "./icp-filter.ts";

export {
  upsertTrackedCompany,
  getTrackedCompany,
  findTrackedByDomain,
  listCatalogForAdapter,
  addCompanyExplicit,
  addCompaniesByFilter,
  removeCompany,
  listWorkspaceCompanies,
  findWorkspacesTrackingCompany,
} from "./catalog.ts";
export type { TrackedCompany, UpsertTrackedCompanyInput, AddCompanyByFilter } from "./catalog.ts";
