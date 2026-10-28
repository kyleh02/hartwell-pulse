import { createAdminSupabase } from "@/lib/supabase/admin";
import { exchange } from "@/lib/mcp/oauth";
import { CORS, json, originOf, preflight } from "@/lib/mcp/http";

export const dynamic = "force-dynamic";

/** The token endpoint: an approval code for tokens, or a refresh token for new ones. */
export async function POST(req: Request) {
  const raw = await req.text();
  if (raw.length > 10_000) return json({ error: "invalid_request", error_description: "Too large." }, 400, CORS);
  let form: Record<string, string> = {};
  const type = req.headers.get("content-type") ?? "";
  try {
    if (type.includes("application/json")) {
      const parsed = JSON.parse(raw) as Record<string, unknown>;
      for (const [k, v] of Object.entries(parsed)) if (typeof v === "string") form[k] = v;
    } else {
      form = Object.fromEntries(new URLSearchParams(raw));
    }
  } catch {
    return json({ error: "invalid_request", error_description: "Could not read the request." }, 400, CORS);
  }

  // RFC 6749 2.3.1: Basic credentials are form-urlencoded before base64.
  let basic: { id: string; secret: string } | null = null;
  const m = /^Basic\s+(\S+)$/i.exec(req.headers.get("authorization") ?? "");
  if (m) {
    const decoded = Buffer.from(m[1], "base64").toString("utf8");
    const i = decoded.indexOf(":");
    if (i > 0) {
      try {
        basic = { id: decodeURIComponent(decoded.slice(0, i)), secret: decodeURIComponent(decoded.slice(i + 1)) };
      } catch {
        return json({ error: "invalid_client", error_description: "Malformed credentials." }, 401, CORS);
      }
    }
  }

  const res = await exchange(createAdminSupabase(), form, originOf(req), basic);
  if ("error" in res) {
    const { status, ...body } = res;
    return json(body, status ?? 400, { ...CORS, Pragma: "no-cache" });
  }
  return json(res, 200, { ...CORS, Pragma: "no-cache" });
}

export const OPTIONS = preflight;
