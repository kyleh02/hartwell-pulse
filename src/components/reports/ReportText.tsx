// Renders a report's written text. Plain text with two light touches: blank
// lines split paragraphs, and lines starting with "- " become a bullet list.
export function ReportText({ body }: { body: string | null }) {
  if (!body || !body.trim()) return null;

  const blocks: React.ReactNode[] = [];
  let bullets: string[] = [];
  let key = 0;

  const flushBullets = () => {
    if (bullets.length === 0) return;
    blocks.push(
      <ul
        key={key++}
        className="my-2 list-disc space-y-1 pl-5 text-pulse-text-dim"
      >
        {bullets.map((b, i) => (
          <li key={i}>{b}</li>
        ))}
      </ul>,
    );
    bullets = [];
  };

  for (const raw of body.split("\n")) {
    const line = raw.trim();
    if (line.startsWith("- ")) {
      bullets.push(line.slice(2));
      continue;
    }
    flushBullets();
    if (line.length > 0) {
      blocks.push(
        <p key={key++} className="my-2 leading-relaxed text-pulse-text-dim">
          {line}
        </p>,
      );
    }
  }
  flushBullets();

  return <div className="text-sm">{blocks}</div>;
}
