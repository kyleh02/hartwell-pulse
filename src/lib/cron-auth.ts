import "server-only";
import { type NextRequest } from "next/server";

/**
 * Authorise a cron request. Fails CLOSED: a missing CRON_SECRET is treated as a
 * misconfiguration (503), never as "allow". With the secret set, only a caller
 * presenting it as a Bearer token (e.g. Vercel Cron) gets through.
 */
export function cronAuthorized(req: NextRequest): { ok: boolean; status: number } {
  const secret = process.env.CRON_SECRET;
  if (!secret) return { ok: false, status: 503 };
  const header = req.headers.get("authorization") ?? "";
  return { ok: header === `Bearer ${secret}`, status: 401 };
}
