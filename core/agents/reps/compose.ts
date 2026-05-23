import type { Rep } from "../../primitives/index.ts";
import type {
  ComposedRep,
  RoleAgent,
  RoleAgentKind,
} from "./types.ts";

/**
 * Compose a Rep from its persona + a set of role agents. Validates that the
 * roles named on `rep.persona` (when explicit) are provided.
 *
 * In practice, callers pass the persistent Rep row (from `reps` table) and
 * a registry of role agents to bind. The role agents themselves are
 * typically singletons defined in `core/agents/reps/roles/*`.
 */
export function composeRep(
  rep: Rep,
  roles: Partial<Record<RoleAgentKind, RoleAgent>>,
): ComposedRep {
  return {
    rep,
    roles,
    role<K extends RoleAgentKind>(kind: K): RoleAgent {
      const r = roles[kind];
      if (!r) {
        throw new Error(
          `Rep ${rep.name} (${rep.id}) has no '${kind}' role agent bound`,
        );
      }
      return r;
    },
  };
}
