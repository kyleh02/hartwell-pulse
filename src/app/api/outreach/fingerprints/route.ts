import { NextResponse, type NextRequest } from "next/server";
import { getPulseSession } from "@/lib/auth/session";
import { createAdminSupabase } from "@/lib/supabase/admin";
import { outreachEnabled } from "@/lib/outreach/flag";
import { keysFromCsv } from "@/lib/outreach/csv";
import { businessKeys, type Key } from "@/lib/outreach/normalise";
import { recordFingerprints } from "@/lib/outreach/check";

export const runtime = "nodejs";
export const maxDuration = 60;

/** Well under Vercel's 4.5 MB request cap; a contact list is a few KB a hundred rows. */
const MAX_BYTES = 3_000_000;

/**
 * Adds suppression fingerprints (Draper Stage 2), admins only:
 *   - a CSV upload (multipart, field "file"): a contact list kept elsewhere,
 *     columns domain, email and business name, ABN and phone if present;
 *   - JSON { "from": "do_not_contact" }: every do-not-contact entry, so the
 *     list's business-wide blocks are kept for good as well.
 *
 * Only hashes are stored. A key already on file is left alone. Each import is
 * written to the change log. A route, not a server action: an action has ten
 * seconds and a 1 MB body.
 */
export async function POST(req: NextRequest) {
  if (!outreachEnabled()) return new NextResponse("Not found", { status: 404 });
  const session = await getPulseSession();
  if (session?.role !== "admin") return NextResponse.json({ ok: false, message: "Admins only." }, { status: 403 });

  const db = createAdminSupabase();
  const type = req.headers.get("content-type") ?? "";

  let keys: Key[];
  let source: string;
  let report: Record<string, unknown>;

  if (type.includes("multipart/form-data")) {
    const form = await req.formData();
    const file = form.get("file");
    if (!(file instanceof File)) return NextResponse.json({ ok: false, message: "Choose a CSV file." }, { status: 400 });
    if (file.size > MAX_BYTES) return NextResponse.json({ ok: false, message: "That file is over 3 MB. Split it up." }, { status: 413 });
    const parsed = keysFromCsv(await file.text());
    if (parsed.problem) return NextResponse.json({ ok: false, message: parsed.problem }, { status: 400 });
    keys = parsed.keys;
    source = `Import: ${file.name}`.slice(0, 200);
    report = { file: file.name, rows: parsed.rows, skipped: parsed.skipped, columns: parsed.columns };
  } else {
    const body = (await req.json().catch(() => null)) as { from?: string } | null;
    if (body?.from !== "do_not_contact") return NextResponse.json({ ok: false, message: "Nothing to import." }, { status: 400 });
    let { data, error } = await db.from("do_not_contact").select("email, business, website, abn, phone");
    if (error && (error.code === "42703" || error.code === "PGRST204")) {
      ({ data, error } = await db.from("do_not_contact").select("email, business, website"));
    }
    if (error) return NextResponse.json({ ok: false, message: error.message }, { status: 500 });
    const rows = (data as Record<string, string | null>[] | null) ?? [];
    keys = rows.flatMap((r) =>
      businessKeys({ email: r.email, name: r.business, website: r.website, abn: r.abn, phone: r.phone }),
    );
    source = "Do-not-contact list";
    report = { rows: rows.length };
  }

  try {
    const { added, already } = await recordFingerprints(
      db,
      keys,
      source === "Do-not-contact list" ? "do_not_contact" : "imported",
      source,
    );
    await db.from("outreach_change_log").insert({
      what: `${source}: ${added} fingerprints added, ${already} already on file`,
      why: "Draper no-repeat rule",
      changed_by: session.clerkUserId,
    });
    return NextResponse.json({ ok: true, ...report, keys: keys.length, added, already });
  } catch (e) {
    return NextResponse.json({ ok: false, message: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}
