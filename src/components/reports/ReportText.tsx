// Renders a report's written text. Deliberately a small, closed subset of
// Markdown rather than a library: blank lines split paragraphs, "- " makes a
// bullet list, "### " a subheading, pipe rows make a table, and **text** goes
// bold. Everything is parsed into React elements, so nothing in a report body
// can inject markup.
//
// Tables earn their place. A table of search queries against impressions,
// clicks and position is in every report draft, and rendering one as
// pipe-delimited text would make the whole report look broken.

import { StatRow, BarChart, Compare } from "@/components/reports/ReportBlocks";
import type { StatItem, BarItem } from "@/components/reports/ReportBlocks";

/**
 * Fenced blocks a report can declare, on top of the Markdown subset:
 *
 *   ```stats
 *   Search impressions | 146
 *   Search clicks | 12 | up from 0
 *   ```
 *
 *   ```bar Top queries by impressions
 *   secure supply | 7 | 3
 *   ```                         (a third number draws a second, paler bar)
 *
 *   ```compare Mobile against desktop
 *   Mobile | 9.9 | average position
 *   Desktop | 40.2 | average position
 *   Mobile ranks far better, though on a small sample.
 *   ```
 *
 * They exist because a column of numbers in a table is data, and a report is
 * meant to make a point. A bar chart shows at a glance that one query carries
 * the whole result, which a table makes you work out.
 */
function parseRows(lines: string[]): string[][] {
  return lines
    .map((l) => l.split("|").map((c) => c.trim()))
    .filter((r) => r[0]);
}

function inline(text: string, keyBase: string): React.ReactNode[] {
  const out: React.ReactNode[] = [];
  const re = /\*\*(.+?)\*\*/g;
  let last = 0;
  let m: RegExpExecArray | null;
  let i = 0;
  while ((m = re.exec(text)) !== null) {
    if (m.index > last) out.push(text.slice(last, m.index));
    out.push(
      <strong key={`${keyBase}-b${i++}`} className="font-medium text-pulse-text">
        {m[1]}
      </strong>,
    );
    last = m.index + m[0].length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

function splitRow(line: string): string[] {
  return line
    .replace(/^\s*\|/, "")
    .replace(/\|\s*$/, "")
    .split("|")
    .map((c) => c.trim());
}

const isDivider = (line: string) => /^\s*\|?[\s:|-]+\|[\s:|-]*$/.test(line.trim());

export function ReportText({ body }: { body: string | null }) {
  if (!body || !body.trim()) return null;

  const lines = body.split("\n");
  const blocks: React.ReactNode[] = [];
  let bullets: string[] = [];
  let key = 0;

  const flushBullets = () => {
    if (bullets.length === 0) return;
    const k = key++;
    blocks.push(
      <ul key={k} className="my-2 list-disc space-y-1 pl-5 text-pulse-text-dim">
        {bullets.map((b, i) => (
          <li key={i}>{inline(b, `u${k}-${i}`)}</li>
        ))}
      </ul>,
    );
    bullets = [];
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();

    // ---- fenced visual block ----
    if (line.startsWith("```")) {
      const header = line.slice(3).trim();
      const [kind, ...titleParts] = header.split(/\s+/);
      const title = titleParts.join(" ");
      const inner: string[] = [];
      i++;
      while (i < lines.length && !lines[i].trim().startsWith("```")) {
        inner.push(lines[i]);
        i++;
      }
      flushBullets();
      const rows = parseRows(inner);

      if (kind === "stats") {
        const items: StatItem[] = rows.map((r) => ({
          label: r[0],
          value: r[1] ?? "",
          note: r[2] || undefined,
        }));
        blocks.push(<StatRow key={key++} items={items} />);
        continue;
      }
      if (kind === "bar") {
        const items: BarItem[] = rows.map((r) => ({
          label: r[0],
          display: r[1] ?? "",
          value: Number(String(r[1] ?? "").replace(/[^0-9.-]/g, "")) || 0,
          display2: r[2] || undefined,
          value2:
            r[2] === undefined
              ? undefined
              : Number(String(r[2]).replace(/[^0-9.-]/g, "")) || 0,
        }));
        blocks.push(
          <BarChart key={key++} title={title || undefined} items={items} />,
        );
        continue;
      }
      if (kind === "compare" && rows.length >= 2) {
        const note = inner
          .map((l) => l.trim())
          .filter((l) => l && !l.includes("|"))
          .join(" ");
        blocks.push(
          <Compare
            key={key++}
            title={title || undefined}
            left={{ label: rows[0][0], value: rows[0][1] ?? "", note: rows[0][2] }}
            right={{ label: rows[1][0], value: rows[1][1] ?? "", note: rows[1][2] }}
            note={note || undefined}
          />,
        );
        continue;
      }
      // Unknown fence: show the contents rather than swallowing them.
      blocks.push(
        <pre
          key={key++}
          className="my-3 overflow-x-auto rounded-[var(--radius-input)] border border-pulse-border bg-pulse-surface-2 p-3 text-xs text-pulse-text-dim"
        >
          {inner.join("\n")}
        </pre>,
      );
      continue;
    }

    // ---- table ----
    if (line.startsWith("|") && isDivider(lines[i + 1] ?? "")) {
      const header = splitRow(line);
      const rows: string[][] = [];
      i += 2;
      while (i < lines.length && lines[i].trim().startsWith("|")) {
        rows.push(splitRow(lines[i].trim()));
        i++;
      }
      i--;
      flushBullets();
      const hasHeader = header.some((h) => h.length > 0);
      const k = key++;
      blocks.push(
        // Scrolls in its own box so a wide table never drags the page sideways
        // on a phone.
        <div key={k} className="my-3 overflow-x-auto">
          <table className="w-full min-w-[18rem] text-sm">
            {hasHeader && (
              <thead>
                <tr className="border-b border-pulse-border text-left">
                  {header.map((h, hi) => (
                    <th
                      key={hi}
                      className={`mono-label py-2 pr-4 font-medium ${hi > 0 ? "text-right" : ""}`}
                    >
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
            )}
            <tbody>
              {rows.map((r, ri) => (
                <tr key={ri} className="border-b border-pulse-border last:border-0">
                  {r.map((c, ci) => (
                    <td
                      key={ci}
                      className={
                        ci === 0
                          ? "py-2 pr-4 align-top text-pulse-text-dim"
                          : "data-mono py-2 pr-4 text-right align-top text-pulse-text"
                      }
                    >
                      {inline(c, `t${k}-${ri}-${ci}`)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>,
      );
      continue;
    }

    // ---- subheading ----
    if (line.startsWith("### ")) {
      flushBullets();
      blocks.push(
        <h4
          key={key++}
          className="report-heading mb-1 mt-5 text-sm font-medium text-pulse-text"
        >
          {line.slice(4)}
        </h4>,
      );
      continue;
    }

    // ---- rule, used as a divider in drafts ----
    if (/^-{3,}$/.test(line)) {
      flushBullets();
      blocks.push(<hr key={key++} className="my-4 border-pulse-border" />);
      continue;
    }

    if (line.startsWith("- ")) {
      bullets.push(line.slice(2));
      continue;
    }

    flushBullets();
    if (line.length > 0) {
      const k = key++;
      blocks.push(
        <p key={k} className="my-2 leading-relaxed text-pulse-text-dim">
          {inline(line, `p${k}`)}
        </p>,
      );
    }
  }
  flushBullets();

  return <div className="text-sm">{blocks}</div>;
}
