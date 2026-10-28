import { ExternalLink, FileText } from "lucide-react";
import { HARTWELL } from "@/lib/brand";
import { KINDS, isImage, isVideo, type Approval, type ApprovalFile } from "@/lib/approvals-shared";
import { formatBytes } from "@/lib/assets-shared";
import { ZoomableImage } from "@/components/ui/ZoomableImage";

/**
 * The work itself, as the client will see it. One component for both sides,
 * so the preview Kyle checks is exactly what lands in front of the client.
 *
 * Each kind is laid out the way it will be used: copy as a readable page, a
 * social post as a post, an ad as an ad. Seeing it in place is half of
 * deciding whether it is right.
 */
export function ApprovalContent({
  approval,
  files,
}: {
  approval: Pick<Approval, "kind" | "body" | "note" | "channel">;
  files: ApprovalFile[];
}) {
  const images = files.filter((f) => isImage(f.file_name, f.mime_type) && f.url);
  const videos = files.filter((f) => isVideo(f.file_name, f.mime_type) && f.url);
  const others = files.filter((f) => !images.includes(f) && !videos.includes(f));
  const body = approval.body?.trim() || null;

  return (
    <div className="space-y-5">
      {approval.note && (
        <div className="rounded-[16px] border border-pulse-gold/30 bg-pulse-gold/[0.06] px-5 py-4">
          <p className="eyebrow mb-1.5">From {HARTWELL.personFirst}</p>
          <p className="text-[15px] leading-relaxed whitespace-pre-wrap text-pulse-text">{approval.note}</p>
        </div>
      )}

      {approval.kind === "social" ? (
        <div className="mx-auto max-w-md overflow-hidden rounded-[16px] border border-pulse-border bg-pulse-surface">
          <div className="flex items-center gap-2.5 px-4 py-3">
            <span className="h-8 w-8 rounded-full bg-pulse-gold/25" aria-hidden="true" />
            <span className="text-sm font-semibold text-pulse-text">{approval.channel || "Your post"}</span>
          </div>
          {images[0] && <Gallery images={images} single />}
          {body && <p className="px-4 py-3 text-[15px] leading-relaxed whitespace-pre-wrap text-pulse-text">{body}</p>}
        </div>
      ) : approval.kind === "ad" ? (
        <div className="max-w-xl rounded-[16px] border border-pulse-border bg-pulse-surface p-5">
          <p className="text-[11px] font-bold tracking-[0.14em] text-pulse-text-mute uppercase">
            Sponsored{approval.channel ? ` · ${approval.channel}` : ""}
          </p>
          {body && <p className="mt-2 text-[16px] leading-relaxed whitespace-pre-wrap text-pulse-text">{body}</p>}
          {images.length > 0 && (
            <div className="mt-4">
              <Gallery images={images} />
            </div>
          )}
        </div>
      ) : (
        <>
          {body && (
            <div className="rounded-[16px] border border-pulse-border bg-pulse-surface px-6 py-6 sm:px-8">
              <p className="mono-label mb-3">{approval.kind === "copy" ? KINDS.copy.label : "Notes"}</p>
              <div className="max-w-[68ch] text-[16px] leading-[1.8] whitespace-pre-wrap text-pulse-text">{body}</div>
            </div>
          )}
          {images.length > 0 && <Gallery images={images} />}
        </>
      )}

      {videos.map((v) => (
        <video key={v.id} src={v.url ?? undefined} controls playsInline className="w-full max-w-2xl rounded-[16px] bg-black" />
      ))}

      {others.length > 0 && (
        <ul className="space-y-2">
          {others.map((f) => (
            <li key={f.id}>
              <a
                href={f.url ?? undefined}
                target="_blank"
                rel="noreferrer"
                className="lift flex items-center gap-3 rounded-[16px] border border-pulse-border bg-pulse-surface px-4 py-3"
              >
                <FileText size={18} className="shrink-0 text-pulse-gold" aria-hidden="true" />
                <span className="min-w-0 flex-1 truncate text-sm text-pulse-text">{f.file_name}</span>
                <span className="data-mono shrink-0 text-xs text-pulse-text-mute">{formatBytes(f.size_bytes)}</span>
                <ExternalLink size={14} className="shrink-0 text-pulse-text-mute" aria-hidden="true" />
              </a>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function Gallery({ images, single = false }: { images: ApprovalFile[]; single?: boolean }) {
  if (single || images.length === 1) {
    return (
      <ZoomableImage
        src={images[0].url as string}
        alt={images[0].file_name}
        className="block max-h-[70vh] w-full bg-black/20 object-contain"
      />
    );
  }
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      {images.map((img) => (
        <ZoomableImage
          key={img.id}
          src={img.url as string}
          alt={img.file_name}
          className="aspect-[4/3] w-full rounded-[16px] border border-pulse-border bg-black/20 object-cover"
        />
      ))}
    </div>
  );
}
