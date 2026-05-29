import type { SignalKind } from "../../primitives/signal.ts";
import type { RawCandidate } from "../types.ts";

/**
 * Workspace-driven adapter. Polled per-workspace by the workspace poll
 * workflow against the workspace's own graph_sources rows.
 *
 * Unlike catalog adapters, these bypass the shared signal_candidates
 * pool: their items are workspace-specific by definition (a custom RSS
 * feed the workspace added, a keyword search it cares about) so the
 * fanout shape doesn't apply. Polling adapters feed the shared
 * workspace-discovery primitive, which emits signal.discovered; push
 * sources call that same primitive directly.
 *
 * Adapters are pure — they normalise upstream payloads into RawCandidates
 * + a new cursor. The poll module owns dedup (check by external_id),
 * budget, embedding, and insertion.
 */

export interface WorkspacePollInput {
  workspace_id: string;
  source: {
    id: string;
    name: string;
    config: Record<string, unknown>;
  };
  cursor: Record<string, unknown>;
  fetchImpl?: typeof fetch;
}

export interface WorkspacePollResult {
  items: RawCandidate[];
  cursor: Record<string, unknown>;
}

export interface WorkspaceAdapter {
  /** Adapter id; matches graph_sources.kind for the routing. */
  id: string;
  /** Static kind for every item this adapter produces. Null when stage 2 must classify. */
  kindHint: SignalKind | null;
  poll(input: WorkspacePollInput): Promise<WorkspacePollResult>;
}
