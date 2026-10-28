import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  isImage,
  type Approval,
  type ApprovalEvent,
  type ApprovalFile,
} from "@/lib/approvals-shared";

const BUCKET = "pulse-reports";
const HOUR = 60 * 60;

function isMissingTable(err: { code?: string } | null | undefined): boolean {
  return !!err && (err.code === "PGRST205" || err.code === "42P01");
}

export interface ApprovalRow extends Approval {
  /** The first image, signed, for the card. */
  cover: string | null;
  fileCount: number;
  clientName?: string | null;
}

/**
 * Approvals for the board, newest activity first, each with its first image
 * signed for the card. Read through whichever client is passed, so RLS decides
 * what a client sees (sent work only) and an admin sees everything.
 *
 * `missing` is true until migration 0054 has run, so pages can say so rather
 * than fail.
 */
export async function listApprovals(
  supabase: SupabaseClient,
  opts: { clientId?: string | null } = {},
): Promise<{ rows: ApprovalRow[]; missing: boolean }> {
  let q = supabase.from("approvals").select("*, clients(business_name)").order("updated_at", { ascending: false });
  if (opts.clientId) q = q.eq("client_id", opts.clientId);
  const { data, error } = await q;
  if (isMissingTable(error)) return { rows: [], missing: true };
  if (error) throw new Error(`Could not read approvals: ${error.message}`);
  const approvals = (data as (Approval & { clients: { business_name: string } | { business_name: string }[] | null })[] | null) ?? [];
  if (approvals.length === 0) return { rows: [], missing: false };

  const { data: fileData } = await supabase
    .from("approval_files")
    .select("approval_id, storage_path, file_name, mime_type, position")
    .in("approval_id", approvals.map((a) => a.id))
    .order("position");
  const files = (fileData as Pick<ApprovalFile, "approval_id" | "storage_path" | "file_name" | "mime_type" | "position">[] | null) ?? [];

  const coverPath = new Map<string, string>();
  const counts = new Map<string, number>();
  for (const f of files) {
    counts.set(f.approval_id, (counts.get(f.approval_id) ?? 0) + 1);
    if (!coverPath.has(f.approval_id) && isImage(f.file_name, f.mime_type)) coverPath.set(f.approval_id, f.storage_path);
  }
  const signed = await signPaths(supabase, [...coverPath.values()]);

  return {
    missing: false,
    rows: approvals.map((a) => {
      const client = Array.isArray(a.clients) ? a.clients[0] : a.clients;
      const { clients: _clients, ...rest } = a;
      void _clients;
      return {
        ...rest,
        cover: coverPath.has(a.id) ? (signed.get(coverPath.get(a.id) as string) ?? null) : null,
        fileCount: counts.get(a.id) ?? 0,
        clientName: client?.business_name ?? null,
      };
    }),
  };
}

export interface ApprovalDetail {
  approval: Approval & { clientName: string | null };
  files: ApprovalFile[];
  events: ApprovalEvent[];
}

/** One piece of work with its files (signed for an hour) and its history. */
export async function getApproval(supabase: SupabaseClient, id: string): Promise<ApprovalDetail | null> {
  if (!/^[0-9a-f-]{36}$/i.test(id)) return null;
  const [{ data: a, error }, { data: f }, { data: e }] = await Promise.all([
    supabase.from("approvals").select("*, clients(business_name)").eq("id", id).maybeSingle(),
    supabase.from("approval_files").select("*").eq("approval_id", id).order("position"),
    supabase.from("approval_events").select("*").eq("approval_id", id).order("created_at"),
  ]);
  if (isMissingTable(error) || !a) return null;
  if (error) throw new Error(`Could not read that approval: ${error.message}`);
  const row = a as Approval & { clients: { business_name: string } | { business_name: string }[] | null };
  const client = Array.isArray(row.clients) ? row.clients[0] : row.clients;
  const files = (f as ApprovalFile[] | null) ?? [];
  const signed = await signPaths(supabase, files.map((x) => x.storage_path));
  const { clients: _c, ...approval } = row;
  void _c;
  return {
    approval: { ...approval, clientName: client?.business_name ?? null },
    files: files.map((x) => ({ ...x, url: signed.get(x.storage_path) ?? null })),
    events: (e as ApprovalEvent[] | null) ?? [],
  };
}

async function signPaths(supabase: SupabaseClient, paths: string[]): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  if (paths.length === 0) return out;
  const { data } = await supabase.storage.from(BUCKET).createSignedUrls(paths, HOUR);
  for (const s of data ?? []) if (s.path && s.signedUrl) out.set(s.path, s.signedUrl);
  return out;
}
