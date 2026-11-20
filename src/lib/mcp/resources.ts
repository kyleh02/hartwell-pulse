/**
 * The portal's MCP resources: what each connector address is, and the scope
 * that goes with it. Pure, tested in resources.test.ts.
 *
 * One OAuth server, three resources (Draper decision 4, 19 Nov 2026):
 *   /api/mcp                    "pipeline"          the pipeline connector (0057)
 *   /api/mcp/outreach           "outreach"          Draper, for the morning run
 *   /api/mcp/outreach-advisor   "outreach-advisor"  Draper advisor
 *
 * A token is issued for exactly one of them and only ever works there (the
 * audience check in oauth.ts), so a Draper token can't reach the pipeline,
 * the pipeline's can't reach Draper, and neither Draper token can stand in
 * for the other. The two Draper resources exist only while OUTREACH_ENABLED
 * is on.
 */

export interface McpResourceDef {
  path: string;
  scope: string;
  /** What Kyle sees on the consent page and Claude sees as the server name. */
  name: string;
  draper: boolean;
}

export const PIPELINE: McpResourceDef = { path: "/api/mcp", scope: "pipeline", name: "Hartwell Pulse pipeline", draper: false };
export const OUTREACH: McpResourceDef = { path: "/api/mcp/outreach", scope: "outreach", name: "Draper", draper: true };
export const OUTREACH_ADVISOR: McpResourceDef = { path: "/api/mcp/outreach-advisor", scope: "outreach-advisor", name: "Draper advisor", draper: true };

export const RESOURCES: readonly McpResourceDef[] = [PIPELINE, OUTREACH, OUTREACH_ADVISOR];

export function resources(draperOn: boolean): McpResourceDef[] {
  return RESOURCES.filter((r) => draperOn || !r.draper);
}

export function resourceUrl(origin: string, def: McpResourceDef): string {
  return `${origin}${def.path}`;
}

const bare = (s: string) => s.trim().replace(/\/+$/, "");

/**
 * Which resource an authorization or token request is for. `resource` is the
 * RFC 8707 parameter (the connector's address), `scope` the OAuth scope.
 * Either may be missing: no resource and no scope is the pipeline, as it
 * always was; the bare origin as the resource is decided by the scope. A
 * resource and a scope that disagree, an unknown resource or an unknown
 * scope is null: refuse.
 */
export function resourceFor(origin: string, req: { resource?: string | null; scope?: string | null }, draperOn: boolean): McpResourceDef | null {
  const known = resources(draperOn);
  const scopes = (req.scope ?? "").split(/\s+/).filter(Boolean);
  const res = req.resource ? bare(req.resource) : "";

  // A named address decides. Some clients ask for every scope the server
  // lists, so its own scope only has to be among those asked for; the token
  // is bound to the address either way.
  if (res && res !== bare(origin)) {
    const byResource = known.find((r) => bare(resourceUrl(origin, r)) === res) ?? null;
    if (!byResource) return null;
    if (scopes.length && !scopes.includes(byResource.scope)) return null;
    return byResource;
  }
  // No address (or the bare origin): the scope decides, and it must name one.
  if (!scopes.length) return PIPELINE;
  return known.find((r) => scopes.every((s) => s === r.scope)) ?? null;
}

/** The resource a /.well-known/oauth-protected-resource path describes, or null. The bare document is the pipeline's. */
export function resourceForMetadataPath(segments: string[] | undefined, draperOn: boolean): McpResourceDef | null {
  const path = `/${(segments ?? []).join("/")}`;
  if (path === "/") return PIPELINE;
  return resources(draperOn).find((r) => r.path === path) ?? null;
}

/**
 * Whether a token issued for `tokenResource` may be used at `def` on this
 * origin. Exact match only.
 */
export function tokenFits(tokenResource: string, origin: string, def: McpResourceDef): boolean {
  return tokenResource === resourceUrl(origin, def);
}
