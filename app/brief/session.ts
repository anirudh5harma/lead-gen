import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { cookies } from "next/headers";
import {
  resolveProductUser,
  supabaseAuthConfigFromEnv,
  validUuid,
  type ResolvedProductUser,
} from "@/core/product/auth";
import {
  assertProductWorkspaceAccess,
  bootstrapWorkspace,
  DEFAULT_PRODUCT_USER_ID,
  DEFAULT_PRODUCT_WORKSPACE_SLUG,
  findFirstProductWorkspaceForUser,
  type ProductWorkspaceSession,
} from "@/core/product/app";
import { getPool, WorkspaceMembershipError } from "@/core/substrate/storage";

const USER_COOKIE = "bombsell_user_id";
const WORKSPACE_COOKIE = "bombsell_workspace_id";
const WORKSPACE_SLUG_COOKIE = "bombsell_workspace_slug";

type BriefCookieStore = Awaited<ReturnType<typeof cookies>>;

async function getSupabaseUserId(
  cookieStore: BriefCookieStore,
): Promise<string | null> {
  const config = supabaseAuthConfigFromEnv();
  if (!config) return null;

  const supabase = createServerClient(config.url, config.anonKey, {
    cookies: {
      getAll() {
        return cookieStore.getAll().map(({ name, value }) => ({ name, value }));
      },
      setAll(
        cookiesToSet: Array<{
          name: string;
          value: string;
          options: CookieOptions;
        }>,
      ) {
        try {
          cookiesToSet.forEach(({ name, value, options }) => {
            cookieStore.set(name, value, options);
          });
        } catch {
          // Server component render paths cannot mutate cookies; middleware can refresh them.
        }
      },
    },
  });

  const { data, error } = await supabase.auth.getUser();
  if (error) return null;
  return validUuid(data.user?.id);
}

async function resolveBriefUser(
  cookieStore: BriefCookieStore,
): Promise<ResolvedProductUser | null> {
  return resolveProductUser({
    verifiedAuthUserId: await getSupabaseUserId(cookieStore),
    cookieUserId: cookieStore.get(USER_COOKIE)?.value,
    envDemoUserId: process.env.BOMBSELL_DEMO_USER_ID,
    defaultDemoUserId: DEFAULT_PRODUCT_USER_ID,
    nodeEnv: process.env.NODE_ENV,
    allowDemoAuth: process.env.BOMBSELL_ALLOW_DEMO_AUTH,
  });
}

export async function getBriefUserId(): Promise<string | null> {
  const cookieStore = await cookies();
  return (await resolveBriefUser(cookieStore))?.user_id ?? null;
}

function workspaceSlugForUser(
  cookieStore: BriefCookieStore,
  user: ResolvedProductUser,
): string | null {
  const cookieSlug = cookieStore.get(WORKSPACE_SLUG_COOKIE)?.value;
  if (cookieSlug) return cookieSlug;
  if (user.demo) {
    return process.env.BOMBSELL_DEMO_WORKSPACE_SLUG || DEFAULT_PRODUCT_WORKSPACE_SLUG;
  }
  return null;
}

function provisionedWorkspaceSlug(user: ResolvedProductUser): string {
  return user.demo
    ? process.env.BOMBSELL_DEMO_WORKSPACE_SLUG || DEFAULT_PRODUCT_WORKSPACE_SLUG
    : `workspace-${user.user_id.slice(0, 8)}`;
}

export async function getBriefWorkspaceSession(opts: {
  create?: boolean;
} = {}): Promise<ProductWorkspaceSession | null> {
  const pool = getPool();
  const cookieStore = await cookies();
  const user = await resolveBriefUser(cookieStore);
  if (!user) return null;

  const workspace_id = validUuid(cookieStore.get(WORKSPACE_COOKIE)?.value);
  const slug = workspaceSlugForUser(cookieStore, user);
  const hasExplicitWorkspaceSelector = Boolean(workspace_id || slug);

  const existing = workspace_id
    ? await pool.query<{ id: string }>(
        `select id from workspaces where id = $1`,
        [workspace_id],
      )
    : slug
      ? await pool.query<{ id: string }>(
          `select id from workspaces where slug = $1`,
          [slug],
        )
      : { rows: [] };

  let resolved =
    existing.rows[0]?.id ??
    (hasExplicitWorkspaceSelector
      ? null
      : await findFirstProductWorkspaceForUser(user.user_id, pool));
  if (!resolved && opts.create) {
    resolved = (
      await bootstrapWorkspace(pool, user.user_id, {
        workspace_id: workspace_id ?? undefined,
        workspace_slug: slug ?? provisionedWorkspaceSlug(user),
        workspace_name: user.demo ? "Bombsell Demo Workspace" : "Bombsell Workspace",
      })
    ).workspace_id;
  }
  if (!resolved) return null;

  const session = { workspace_id: resolved, user_id: user.user_id };
  try {
    await assertProductWorkspaceAccess(session, pool);
  } catch (err) {
    if (!(err instanceof WorkspaceMembershipError)) throw err;
    if (!opts.create || !user.demo) return null;

    await bootstrapWorkspace(pool, user.user_id, {
      workspace_id: resolved,
      workspace_slug: slug ?? provisionedWorkspaceSlug(user),
      ensureMembership: true,
    });
    await assertProductWorkspaceAccess(session, pool);
  }
  return session;
}
