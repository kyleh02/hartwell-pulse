# Generates src/lib/crm-pipeline-v2.ts from the handoff markdown.
#
# Generated, not transcribed. Nineteen email bodies retyped by hand is nineteen
# chances to change a word Kyle chose, and the whole shape of these emails is
# deliberate: he has explicitly rejected specific phrasings. Parsing keeps them
# byte for byte.
#
# Structured fields come from the Part E CSV, which is unambiguous. Bodies and
# notes come from Part B, keyed by rank.

import csv, io, json, re, sys

SRC = r"H:\My Drive\Ironpeak Consulting Build\portal-handoff-pipeline.md"
OUT = r"H:\My Drive\Website Code\hartwell-pulse\src\lib\crm-pipeline-v2.ts"

md = io.open(SRC, encoding="utf-8").read()

# ---- Part E: the CSV ----
m = re.search(r"# PART E.*?```csv\n(.*?)```", md, re.S)
if not m:
    sys.exit("Part E CSV not found")
rows = list(csv.DictReader(io.StringIO(m.group(1))))
print(f"CSV rows: {len(rows)}")

# ---- Part B: split into records by the "### N. Company" headings ----
partb = md[md.index("# PART B"): md.index("# PART C")]
chunks = re.split(r"\n### (\d+)\.\s", partb)
records = {}
for i in range(1, len(chunks), 2):
    records[int(chunks[i])] = chunks[i + 1]
print(f"Part B records: {len(records)}")

def email_for(rank):
    """The subject and body block for one record, verbatim."""
    body_md = records.get(rank, "")
    # The status may carry a suffix, e.g. "READY - send immediately", and one
    # heading reads "WRITTEN BUT HELD" with a trailing space. Match loosely and
    # classify on keywords rather than on an exact form.
    head = re.search(r"^#### (EMAIL|FOLLOW-UP) . (.+?)\s*$", body_md, re.M)
    if not head:
        return None, None
    # The first fenced block after the heading is the email.
    after = body_md[head.end():]
    fence = re.search(r"```\n(.*?)```", after, re.S)
    return (fence.group(1).rstrip("\n") if fence else None), head.group(2).strip()

def notes_for(rank, blocker):
    """The prose above the email heading, minus the metadata line block."""
    body_md = records.get(rank, "")
    cut = re.search(r"^#### ", body_md, re.M)
    prose = body_md[: cut.start()] if cut else body_md
    lines = prose.split("\n")
    # Drop the heading remainder and the dotted metadata lines under it.
    keep = []
    for ln in lines[1:]:
        s = ln.strip()
        if not s or s == "---":
            continue
        if s.startswith("`DIDG`") or s.startswith("`AIC`"):
            continue
        if re.match(r"^\*\*[^*]+\*\* · `(own-site|directory|unverified)`", s):
            continue
        if s.startswith("sent **") or s.startswith("`send_at`"):
            continue
        if re.match(r"^`?email_status`?\s*[:·]", s, re.I):
            continue
        keep.append(s)
    text = " ".join(keep)
    # Markdown emphasis and code ticks are noise once this is a database field.
    text = re.sub(r"\*\*(.+?)\*\*", r"\1", text)
    text = re.sub(r"\*(.+?)\*", r"\1", text)
    text = text.replace("`", "").replace("×", "x")
    text = re.sub(r"\s+", " ", text).strip()
    if blocker:
        text = f"{blocker}\n\n{text}"
    return text

STAGE = {
    "contacted": "contacted",
    "queued": "queued",
    "blocked": "blocked",
    "linkedin-only": "linkedin_only",
    # Change 8: a bounce means the recipient never saw it and refused nothing,
    # so it is no longer terminal. email-closed is Coastal: email is not
    # viable, LinkedIn and phone stay open.
    "bounced": "bounced",
    "email-closed": "email_closed",
}

def iso(send_at, state):
    """Stored with an explicit offset. Every send_at in the file is a local
    Australian eastern time; WA sends are already expressed that way so they
    land mid-morning Perth."""
    if not send_at or send_at.strip().upper() == "IMMEDIATE":
        return None
    d, t = send_at.strip().split(" ")
    return f"{d}T{t}:00+10:00"


# ---- Part H overrides the CSV on send times ----
#
# Change 6 rewrote Part H and did not touch the Part E CSV, so the two now
# disagree: the CSV still holds Monday's slots, Part H holds the shifted
# Tuesday-to-Monday week. Part H is the later authority and says so, and a
# generator that silently preferred the stale column would put emails out at
# times nobody chose.
#
# Any Part H row that cannot be matched to a company is reported rather than
# dropped, because a send quietly missing from the schedule is the failure
# mode this whole file exists to prevent.
MONTHS = {"Jan":1,"Feb":2,"Mar":3,"Apr":4,"May":5,"Jun":6,
          "Jul":7,"Aug":8,"Sep":9,"Oct":10,"Nov":11,"Dec":12}

def part_h_schedule(md, companies):
    if "# PART H" not in md:
        return {}, []
    # The WHOLE of Part H, not a slice of it. An earlier version cut at
    # "## 2.", which was fine when the schedule was section 1 and silently
    # returned nothing the moment the schedule moved to section 2. The strict
    # HH:MM test below is what keeps other tables out, not the boundary.
    block = md[md.index("# PART H"):]
    out, unmatched, day = {}, [], None
    for line in block.split("\n"):
        if not line.strip().startswith("|"):
            continue
        cells = [c.strip() for c in line.strip().strip("|").split("|")]
        if len(cells) < 3:
            continue
        # "**Tue 11 Aug**" in the first cell, or blank to mean "same day".
        dm = re.search(r"(\d{1,2})\s+([A-Z][a-z]{2})", cells[0].replace("*", ""))
        if dm:
            day = (int(dm.group(1)), MONTHS.get(dm.group(2)))
        tm = re.match(r"^(\d{1,2}):(\d{2})$", cells[1].replace("*", "").strip())
        if not tm or not day or day[1] is None:
            continue
        name = cells[2].replace("*", "").replace("~", "").strip()
        match = None
        for full in companies:
            a = re.sub(r"[^a-z0-9]", "", name.lower())
            b = re.sub(r"[^a-z0-9]", "", full.lower())
            if a and (b.startswith(a) or a in b):
                match = full
                break
        if not match:
            unmatched.append(name)
            continue
        out[match] = f"2026-{day[1]:02d}-{day[0]:02d}T{int(tm.group(1)):02d}:{tm.group(2)}:00+10:00"
    return out, unmatched

H_SCHEDULE, H_UNMATCHED = part_h_schedule(md, [r["company"] for r in rows])
print(f"Part H schedule rows: {len(H_SCHEDULE)}")
if H_UNMATCHED:
    print("  UNMATCHED (check these):", H_UNMATCHED)


HARD_WARNINGS = {
    14: "NEVER reference the founder or company history in any communication with this company, ever. Their founder died in November 2021.",
    26: "NO LinkedIn presence. Email only. Do not attempt a connect request.",
    3: "BLOCKED on the Spam Act consent basis. The address was collected while their site was up; the site is gone, so the publication that created inferred consent no longer exists. Clear it by finding the address published live somewhere public today, screenshotting it onto this record, then moving to queued.",
    30: "LinkedIn only, by Kyle's instruction. No further email to this company.",
    1: "EMAIL IS CLOSED. Their server refused the connection with 550 5.7.708, an IP-reputation rejection at their end, and Ironpeak's own sending was verified healthy the same day. Do not retry by email, it will fail the same way. Reach Robert by LinkedIn or telephone. This is an infrastructure failure, NOT a decline: he has never seen the message.",
}

# Every address in the handoff was confirmed published on the company's own
# website on 7 August 2026, Tynbell excepted, and Tynbell is blocked so it
# cannot send. Recorded as what was observed rather than as a URL: fabricating
# a URL would fake the one thing that has to be checkable.
EMAIL_SOURCE_NOTE = "published on the company's own website, checked 7 August 2026"

out = []
for r in rows:
    rank = int(r["rank"])
    subject = (r.get("email_subject") or "").strip()
    status = (r.get("email_status") or "").strip()
    body, heading = email_for(rank)
    blocker = None
    heading = (heading or "").upper()
    if "NOT WRITTEN" in heading:
        blocker = "No email written: the fault is late-July research and may not be quoted without re-verification."
    elif "HELD" in heading:
        blocker = "Email written but HELD. It may not be sent until its blocker clears."
    elif "NONE" in heading:
        blocker = "No email. This record is LinkedIn only."

    rec = {
        "rank": rank,
        "tier": int(r["tier"]),
        "company": r["company"],
        "channel": r["channel"],
        "stage": STAGE[r["status"]],
        "state": r["state"],
        "domain": r["domain"],
        "email": r["email"],
        "contactName": r["contact_name"],
        "nameVerified": r["name_verified"],
        "fallbackGreeting": (r.get("fallback_greeting") or "").strip() or None,
        "sentDate": (r.get("sent_date") or "").strip() or None,
        "followupDue": (r.get("followup_due") or "").strip() or None,
        # Part E no longer carries send_at at all. Part H is the clock.
        "scheduledSendAt": H_SCHEDULE.get(r["company"]),
        "sendImmediately": (r.get("send_at") or "").strip().upper() == "IMMEDIATE",
        "hook": "",  # filled below from the record
        "hookVerified": (r.get("hook_verified") or "").strip() or None,
        "emailStatus": status or "not-written",
        "emailSubject": subject or None,
        "emailBody": body,
        "emailBlocker": blocker,
        "emailSourceNote": EMAIL_SOURCE_NOTE,
        "hardWarning": HARD_WARNINGS.get(rank),
        "notes": notes_for(rank, blocker),
    }

    hook = re.search(r"\*\*Hook\*\*[^:]*:\s*(.+?)(?:\n\n|\n\*\*)", records.get(rank, ""), re.S)
    if hook:
        h = re.sub(r"\*\*(.+?)\*\*", r"\1", hook.group(1))
        h = re.sub(r"\*(.+?)\*", r"\1", h)
        h = re.sub(r"\s+", " ", h.replace("`", "").replace("×", "x")).strip()
        rec["hook"] = h.replace("*", "")
    out.append(rec)

print(f"with a body: {sum(1 for r in out if r['emailBody'])}")
print(f"no body:     {sum(1 for r in out if not r['emailBody'])}")

header = '''/**
 * The Ironpeak pipeline, version 4 of the handoff, 18 August 2026.
 *
 * GENERATED from portal-handoff-pipeline.md by scripts/gen-pipeline.py. Do not
 * hand-edit: change the markdown and regenerate.
 *
 * Generated rather than transcribed on purpose. Nineteen email bodies retyped
 * by hand is nineteen chances to change a word Kyle chose, and the shape of
 * these emails is deliberate down to the phrasing he has explicitly rejected.
 * Parsing keeps them byte for byte.
 *
 * Version 4 rewrote 16 of the 19 bodies to the shape fault, second
 * observation, scope block, link, costless close, at 150 to 175 words. Two
 * exceptions are deliberate and must not be normalised: Kennewell runs 198
 * words and carries no link, because its offer is a caption pass rather than a
 * rebuild, and Universal Motion Simulation opens "Good morning Dr Meikle"
 * because the man publishes a doctorate.
 *
 * This REPLACES every earlier dataset. The previous files held 76 records of
 * which 51 were triaged out; those are gone deliberately.
 */

export type PipelineStage =
  | "contacted"
  | "queued"
  | "blocked"
  | "linkedin_only"
  /** Bounced, and NOT terminal: nobody saw it, so nobody refused it. */
  | "bounced"
  /** Their server refuses this sender. LinkedIn and phone stay open. */
  | "email_closed";
export type EmailStatus = "ready" | "held" | "not-written";

export interface PipelineRecord {
  rank: number;
  tier: 1 | 2 | 3;
  company: string;
  channel: "DIDG" | "AIC";
  stage: PipelineStage;
  state: string;
  /** "NO WEBSITE" is a valid and important value. */
  domain: string;
  email: string;
  contactName: string;
  nameVerified: "own-site" | "directory" | "unverified";
  fallbackGreeting: string | null;
  sentDate: string | null;
  followupDue: string | null;
  scheduledSendAt: string | null;
  /** Coastal Aviation only: send on receipt, overriding the day 8 to 10 window. */
  sendImmediately: boolean;
  hook: string;
  hookVerified: string | null;
  emailStatus: EmailStatus;
  emailSubject: string | null;
  /** Verbatim. The signature and opt-out are appended at send, not stored. */
  emailBody: string | null;
  emailBlocker: string | null;
  emailSourceNote: string;
  /** Shown as a warning that cannot be dismissed. */
  hardWarning: string | null;
  notes: string;
}

export const PIPELINE_V2: PipelineRecord[] = '''

io.open(OUT, "w", encoding="utf-8").write(
    header + json.dumps(out, indent=2, ensure_ascii=False) + ";\n"
)
print("written")
