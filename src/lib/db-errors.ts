// Postgres and PostgREST codes for "that column does not exist".
//
// Code ships before its migration is run, by hand, in the Supabase editor. A
// write that adds a new column to an existing update would then be refused
// whole, which is exactly how a client was once emailed an invoice for $0.00.
// New columns are therefore written in their own update, and this tells that
// update apart from a real failure.
export function isMissingColumn(err: { code?: string } | null | undefined): boolean {
  return !!err && (err.code === "PGRST204" || err.code === "42703");
}
