import {
  createRemoteJWKSet,
  customFetch,
  jwtVerify,
  type JWTPayload,
} from "jose";

/**
 * Microsoft Graph lifecycle-token validation + lifecycle-event handling.
 *
 * Graph sends `validationTokens` (a JWT array) with every change AND every
 * lifecycle notification on subscriptions that opted into a
 * `lifecycleNotificationUrl`. Each token is a JWS signed by Microsoft
 * Entra; the `aud` claim is the app's `MICROSOFT_CLIENT_ID`, the `iss`
 * is one of:
 *   - https://sts.windows.net/<tenantId>/                (v1.0 token)
 *   - https://login.microsoftonline.com/<tenantId>/v2.0  (v2.0 token)
 *
 * Validating these tokens is the only defence against a forged
 * notification spoofing a real subscriptionId — clientState alone is
 * insufficient once an attacker observes a clientState off the wire.
 *
 * Lifecycle events Graph emits via the same webhook POST endpoint:
 *   - `reauthorizationRequired` : Graph wants the app to refresh/renew the
 *     subscription using a valid access token. This is usually backend repair,
 *     not user OAuth re-consent.
 *   - `subscriptionRemoved` : Graph deleted the subscription server-side.
 *     The repair workflow recreates it when credentials are still valid.
 *   - `missed` : Graph noticed it failed to deliver some notifications.
 *     We log + rely on the next change to fall through naturally.
 */

const V1_ISSUER_PREFIX = "https://sts.windows.net/";
const V2_ISSUER_PREFIX = "https://login.microsoftonline.com/";
const V2_ISSUER_SUFFIX = "/v2.0";

const DEFAULT_JWKS_URL = "https://login.microsoftonline.com/common/discovery/v2.0/keys";

export interface LifecycleTokenValidatorOptions {
  /** Expected aud claim — the app's MICROSOFT_CLIENT_ID. */
  clientId: string;
  /**
   * Optional tenant restriction. When set, every token's issuer must
   * carry exactly this tenantId. Multi-tenant deployments leave this
   * undefined and rely on aud + signature alone.
   */
  tenantId?: string;
  /**
   * JWKS endpoint. Multi-tenant deployments use the `common` endpoint
   * (default); single-tenant can use the tenant-specific JWKS.
   */
  jwksUrl?: string;
  /** Optional fetch override (tests). */
  fetchImpl?: typeof fetch;
}

export interface LifecycleNotificationEnvelope {
  validationTokens?: string[];
  value?: Array<{
    lifecycleEvent?: string;
    subscriptionId: string;
    clientState?: string;
    tenantId?: string;
    resource?: string;
  }>;
}

export interface LifecycleValidationOk {
  ok: true;
  /** One entry per validated token (in input order). */
  payloads: JWTPayload[];
}

export interface LifecycleValidationFailed {
  ok: false;
  error: string;
}

export type LifecycleValidationResult =
  | LifecycleValidationOk
  | LifecycleValidationFailed;

export interface LifecycleTokenValidator {
  validate(tokens: string[]): Promise<LifecycleValidationResult>;
}

/**
 * Build a validator that can verify validationTokens batches. The JWKS
 * set is fetched lazily and cached internally by `jose` — calls across
 * many notifications reuse the same key cache.
 */
export function createLifecycleTokenValidator(
  opts: LifecycleTokenValidatorOptions,
): LifecycleTokenValidator {
  const jwksUrl = opts.jwksUrl ?? DEFAULT_JWKS_URL;
  const remoteOpts: Record<string | symbol, unknown> = {};
  if (opts.fetchImpl) {
    remoteOpts[customFetch] = opts.fetchImpl;
  }
  const jwks = createRemoteJWKSet(
    new URL(jwksUrl),
    remoteOpts as Parameters<typeof createRemoteJWKSet>[1],
  );

  return {
    async validate(tokens: string[]): Promise<LifecycleValidationResult> {
      if (!tokens || tokens.length === 0) {
        return { ok: false, error: "no validationTokens present" };
      }
      const payloads: JWTPayload[] = [];
      for (const token of tokens) {
        try {
          const { payload } = await jwtVerify(token, jwks, {
            audience: opts.clientId,
          });
          if (!isAcceptableIssuer(payload.iss, opts.tenantId)) {
            return {
              ok: false,
              error: `issuer not accepted: ${payload.iss ?? "(missing)"}`,
            };
          }
          payloads.push(payload);
        } catch (err) {
          return {
            ok: false,
            error: err instanceof Error ? err.message : String(err),
          };
        }
      }
      return { ok: true, payloads };
    },
  };
}

function isAcceptableIssuer(iss: unknown, tenantId: string | undefined): boolean {
  if (typeof iss !== "string") return false;
  if (tenantId) {
    return (
      iss === `${V1_ISSUER_PREFIX}${tenantId}/` ||
      iss === `${V2_ISSUER_PREFIX}${tenantId}${V2_ISSUER_SUFFIX}`
    );
  }
  return (
    iss.startsWith(V1_ISSUER_PREFIX) ||
    (iss.startsWith(V2_ISSUER_PREFIX) && iss.endsWith(V2_ISSUER_SUFFIX))
  );
}

/**
 * Detect whether a notification envelope is a lifecycle batch (has
 * lifecycleEvent on at least one item) vs. a regular change batch.
 */
export function isLifecycleEnvelope(
  envelope: LifecycleNotificationEnvelope,
): boolean {
  if (!envelope.value) return false;
  return envelope.value.some((n) => typeof n.lifecycleEvent === "string");
}

export interface LifecycleEvent {
  lifecycleEvent: string;
  subscriptionId: string;
  clientState?: string;
  tenantId?: string;
  resource?: string;
}

/**
 * Walk a lifecycle envelope and return only the lifecycle events;
 * non-lifecycle entries are filtered out.
 */
export function extractLifecycleEvents(
  envelope: LifecycleNotificationEnvelope,
): LifecycleEvent[] {
  if (!envelope.value) return [];
  return envelope.value.flatMap((n) =>
    typeof n.lifecycleEvent === "string"
      ? [{
          lifecycleEvent: n.lifecycleEvent,
          subscriptionId: n.subscriptionId,
          clientState: n.clientState,
          tenantId: n.tenantId,
          resource: n.resource,
        }]
      : [],
  );
}
