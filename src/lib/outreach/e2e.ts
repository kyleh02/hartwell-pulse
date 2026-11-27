/**
 * The end-to-end checklist (Kyle, 21 Nov 2026), pure, tested in e2e.test.ts.
 * Don't switch to live until all six tick. Each check is met by a business
 * found while test mode was on whose draft went through Pulse's own
 * hour-later re-check, so it proves the real path, not the test pair.
 *
 * The follow-up landing in its thread and a "no thanks" stopping a
 * follow-up can't happen to the same business (one sends it, the other
 * cancels it), so each check names the business that proved it.
 */

export interface E2EProspect {
  id: string;
  name: string;
}

export interface E2EMessage {
  prospect_id: string;
  kind: "first" | "follow_up";
  status: string;
  confirmed_at: string | null;
  sent_at: string | null;
  test_mode: boolean | null;
  subject: string | null;
  body: string | null;
  gmail_thread_id: string | null;
}

export interface E2EReply {
  prospect_id: string;
  kind: string;
  label: string | null;
}

export interface E2ECheck {
  key: string;
  label: string;
  /** The business that proved it, or null while it hasn't ticked. */
  by: string | null;
}

// Every template's opt-out line, old ("won't email again") and give first's.
const OPT_OUT = /won't email again|didn't write again/i;

export function e2eChecklist(prospects: E2EProspect[], messages: E2EMessage[], replies: E2EReply[]): E2ECheck[] {
  const name = new Map(prospects.map((p) => [p.id, p.name]));
  const of = (pid: string, kind: "first" | "follow_up") => messages.find((m) => m.prospect_id === pid && m.kind === kind);
  // Only businesses whose pair went through the hour-later re-check.
  const real = prospects.filter((p) => of(p.id, "first")?.confirmed_at);
  const first = (pid: string) => of(pid, "first")!;
  const sentToTest = (m: E2EMessage | undefined) => !!m && m.status === "sent" && !!m.sent_at && m.test_mode === true;
  const repliesOf = (pid: string) => replies.filter((r) => r.prospect_id === pid);

  const find = (ok: (pid: string) => boolean) => {
    const p = real.find((x) => ok(x.id));
    return p ? (name.get(p.id) ?? "A business") : null;
  };

  return [
    {
      key: "confirmed",
      label: "Pulse's hour-later re-check confirmed both faults",
      by: find((pid) => !!first(pid).confirmed_at && !!of(pid, "follow_up")?.confirmed_at),
    },
    {
      key: "first_sent",
      label: 'The first email landed in the test inbox, subject "your … page"',
      by: find((pid) => sentToTest(first(pid)) && /^your .+ page$/i.test(first(pid).subject ?? "")),
    },
    {
      key: "threaded",
      label: "The follow-up landed in the same thread",
      by: find((pid) => {
        const fu = of(pid, "follow_up");
        return sentToTest(first(pid)) && sentToTest(fu) && !!fu!.gmail_thread_id && fu!.gmail_thread_id === first(pid).gmail_thread_id;
      }),
    },
    {
      key: "opt_out_line",
      label: "The opt-out line was in the email",
      by: find((pid) => sentToTest(first(pid)) && OPT_OUT.test(first(pid).body ?? "")),
    },
    {
      key: "reply_seen",
      label: "A reply was picked up and waited for a label",
      by: find((pid) => repliesOf(pid).some((r) => r.kind === "reply")),
    },
    {
      key: "opt_out_stops",
      label: 'A "no thanks" reply stopped the follow-up',
      by: find((pid) => repliesOf(pid).some((r) => r.kind === "opt_out" || r.label === "no_thanks") && of(pid, "follow_up")?.status === "cancelled"),
    },
  ];
}
