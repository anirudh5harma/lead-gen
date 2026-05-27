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

// Platform source registry + catalog poll cursors
export {
  ensurePlatformSource,
  getPlatformSourceByAdapter,
  listPlatformSources,
  loadCursor,
  saveCursor,
  recordCursorError,
} from "./sources.ts";
export type { PlatformSignalSource, CatalogCursor } from "./sources.ts";

// Adapter framework
export {
  catalogAdapters,
  getCatalogAdapter,
  listCatalogAdapterIds,
} from "./adapters/registry.ts";
export type {
  CatalogAdapter,
  CatalogPollInput,
  CatalogPollResult,
} from "./adapters/types.ts";
export { greenhouseAdapter, GreenhouseError, stripHtml } from "./adapters/greenhouse.ts";
export { leverAdapter, LeverError } from "./adapters/lever.ts";
export { ashbyAdapter, AshbyError } from "./adapters/ashby.ts";
export { workableAdapter, WorkableError } from "./adapters/workable.ts";
export {
  secEdgarAdapter,
  SecEdgarError,
  resolveKind as resolveSecKind,
  paddedCik,
} from "./adapters/sec-edgar.ts";
export {
  inferFunction,
  inferSeniority,
} from "./adapters/_hiring-heuristics.ts";

// Poll + fanout
export { pollOnce } from "./poll.ts";
export type { PollDeps, PollInput, PollOutcome } from "./poll.ts";
export { fanoutCandidate } from "./fanout.ts";
export type {
  FanoutCandidate,
  FanoutDeps,
  FanoutResult,
} from "./fanout.ts";

// Workflow
export { createCatalogPollWorkflow } from "./poll-workflow.ts";
export type {
  CatalogPollWorkflowDeps,
  CatalogPollInput as CatalogPollWorkflowInput,
  CatalogPollSummary,
} from "./poll-workflow.ts";

// Workspace adapters + poll
export {
  workspaceAdapters,
  getWorkspaceAdapter,
  listWorkspaceAdapterIds,
} from "./adapters/registry.ts";
export type {
  WorkspaceAdapter,
  WorkspacePollInput,
  WorkspacePollResult,
} from "./adapters/_workspace-types.ts";
export { rssAdapter, RssError, parseFeed } from "./adapters/rss.ts";
export { hnFrontAdapter, HnError } from "./adapters/hn-front.ts";
export {
  hnWhosHiringAdapter,
  HnHiringError,
} from "./adapters/hn-whos-hiring.ts";
export { productHuntAdapter, ProductHuntError } from "./adapters/product-hunt.ts";
export { redditAdapter, RedditError } from "./adapters/reddit.ts";
export { googleNewsAdapter } from "./adapters/google-news.ts";
export {
  workspacePollOnce,
  createWorkspacePollWorkflow,
} from "./workspace-poll.ts";
export type {
  WorkspacePollDeps,
  WorkspacePollInput as WorkspacePollWorkflowInput,
  WorkspacePollSummary,
} from "./workspace-poll.ts";

// Stage 2 classifier
export { classifySignal } from "./classify.ts";
export type {
  ClassifyDeps,
  ClassifyInput,
  ClassifyOutcome,
} from "./classify.ts";
export { startClassifyWorkflow } from "./classify-workflow.ts";
export type {
  ClassifyWorkflowOptions,
  ClassifyWorkflow,
} from "./classify-workflow.ts";

// Periodic expiration sweep
export {
  expireOnce,
  createExpireWorkflow,
  ttlDaysForKind,
  DEFAULT_KIND_TTL_DAYS,
} from "./expire.ts";
export type { ExpireDeps, ExpireSummary } from "./expire.ts";
