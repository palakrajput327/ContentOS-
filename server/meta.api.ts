export const META_SCOPES =
  "pages_show_list,pages_read_engagement,pages_manage_posts,instagram_basic,instagram_content_publish";
export const metaVersion = () =>
  process.env.FACEBOOK_GRAPH_API_VERSION || "v25.0";
export class MetaGraphError extends Error {
  constructor(public readonly endpoint: string, public readonly status: number, public readonly code?: number, public readonly subcode?: number) {
    super(`Meta ${endpoint} failed (HTTP ${status}, code ${code ?? "unknown"}${subcode === undefined ? "" : `, subcode ${subcode}`}). ${code === 190 ? "Access token expired or invalid; reconnect Meta." : code === 10 || code === 200 ? "Check granted permissions and access to the selected Page." : "Check the Meta app configuration and retry."}`);
  }
}
export async function metaRequest(
  path: string,
  token: string,
  params: Record<string, string> = {},
  method = "GET",
  host: "graph.facebook.com" | "graph-video.facebook.com" = "graph.facebook.com",
): Promise<any> {
  const url = new URL(
    "https://" + host + "/" + metaVersion() + "/" + path,
  );
  const options: RequestInit = {
    method,
    headers: { Authorization: "Bearer " + token },
    signal: AbortSignal.timeout(30000),
  };
  if (method === "GET") url.search = new URLSearchParams(params).toString();
  else options.body = new URLSearchParams(params);
  let response: Response;
  try { response = await fetch(url, options); }
  catch { throw new Error(`Meta ${path} request could not complete. Check connectivity and retry.`); }
  let data: any;
  try { data = await response.json(); }
  catch { throw new Error(`Meta ${path} returned an invalid response (HTTP ${response.status}).`); }
  if (!response.ok || data.error)
    throw new MetaGraphError(path, response.status, typeof data.error?.code === "number" ? data.error.code : undefined, typeof data.error?.error_subcode === "number" ? data.error.error_subcode : undefined);
  return data;
}
export async function metaPermissions(token: string): Promise<void> {
  const result = await metaRequest("me/permissions", token);
  const granted = new Set(
    (result.data || [])
      .filter((p: any) => p.status === "granted")
      .map((p: any) => p.permission),
  );
  const missing = META_SCOPES.split(",").filter((scope) => !granted.has(scope));
  if (missing.length)
    throw new Error(
      "Meta publishing permissions missing: " +
        missing.join(", ") +
        ". Reconnect Meta and grant all requested permissions. In development mode, use an app admin/developer/tester account.",
    );
}
export async function metaPages(token: string): Promise<any[]> {
  const pages: any[] = [];
  let after = "";
  do {
    const data = await metaRequest("me/accounts", token, {
      fields:
        "id,name,access_token,tasks,instagram_business_account{id,username}",
      limit: "100",
      ...(after ? { after } : {}),
    });
    if (!Array.isArray(data.data)) throw new Error("Meta me/accounts returned an invalid Page list; reconnect and retry.");
    pages.push(...data.data);
    after = data.paging?.next ? data.paging?.cursors?.after : "";
  } while (after);
  if (!pages.length) {
    const debug = await metaTokenDetails(token);
    const targets = new Set<string>(
      (debug.granular_scopes || []).filter((s: any) => s.scope === "pages_show_list")
        .flatMap((s: any) => Array.isArray(s.target_ids) ? s.target_ids : [])
        .filter((id: unknown) => typeof id === "string" && /^\d+$/.test(id)),
    );
    for (const id of targets) {
      // Only resolve Page IDs explicitly authorized for this user token.
      const page = await metaRequest(id, token, {
        fields: "id,name,access_token,instagram_business_account{id,username}",
      });
      if (page.id !== id || !page.access_token)
        throw new Error("Selected Facebook Page did not return a Page access token. Check New Pages Experience Page access/content creation tasks, then reconnect Meta.");
      pages.push(page);
    }
    if (!pages.length)
      throw new Error("No managed Facebook Page found: me/accounts returned an empty list and pages_show_list has no selected Page IDs. Check Facebook Page settings > Page access (New Pages Experience), grant Facebook/content creation access to the login account, and reconnect selecting the Page. Instagram selection alone does not grant Facebook Page access.");
  }
  return pages;
}

export async function metaTokenDetails(token: string): Promise<any> {
  const appId = process.env.FACEBOOK_APP_ID;
  const secret = process.env.FACEBOOK_APP_SECRET;
  if (!appId || !secret) throw new Error("Meta app credentials missing; cannot diagnose Page discovery.");
  const result = await metaRequest("debug_token", `${appId}|${secret}`, { input_token: token });
  const data = result.data;
  if (!data || data.is_valid !== true) throw new Error("Meta user access token is invalid or expired. Reconnect Meta.");
  if (String(data.app_id) !== appId) throw new Error("Meta token belongs to a different app. Reconnect with the configured Meta app.");
  if (data.type !== "USER") throw new Error("Meta Page discovery requires a Facebook USER token; this login returned a different token type. Check Facebook Login for Business configuration.");
  const missing = META_SCOPES.split(",").filter(scope => !Array.isArray(data.scopes) || !data.scopes.includes(scope));
  if (missing.length) throw new Error("Meta user token missing permissions: " + missing.join(", ") + ". Reconnect and grant all publishing permissions.");
  return data;
}
