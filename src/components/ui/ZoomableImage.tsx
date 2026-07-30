"use client";

import { useState } from "react";
import { Lightbox } from "@/components/ui/Lightbox";
import { cn } from "@/lib/utils/cn";

/**
 * An image that opens fullscreen when clicked. Client-side so it can be
 * dropped into server-rendered pages (reports, share links) as-is.
 */
export function ZoomableImage({
  src,
  alt,
  className,
  onDownload,
}: {
  src: string;
  alt: string;
  className?: string;
  onDownload?: () => void;
}) {
  const [open, setOpen] = useState(false);

  return (
    <>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={src}
        alt={alt}
        onClick={() => setOpen(true)}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            setOpen(true);
          }
        }}
        role="button"
        tabIndex={0}
        aria-label={`View ${alt} fullscreen`}
        className={cn("cursor-zoom-in", className)}
      />
      {open && (
        <Lightbox
          src={src}
          alt={alt}
          onClose={() => setOpen(false)}
          onDownload={onDownload}
        />
      )}
    </>
  );
}
