"use client";

import { MessageCircle } from "lucide-react";
import { openChat } from "@/components/messages/ChatLauncher";
import { cn } from "@/lib/utils/cn";

/**
 * Opens the chat panel in place, so "Message Kyle" on Home is the bubble's
 * conversation rather than a trip to another page. Inert in the admin preview,
 * where there is no client chat to open.
 */
export function OpenChatButton({
  label,
  preview = false,
  className,
}: {
  label: string;
  preview?: boolean;
  className?: string;
}) {
  return (
    <button
      type="button"
      onClick={preview ? undefined : openChat}
      aria-disabled={preview || undefined}
      className={cn(
        "inline-flex h-11 items-center justify-center gap-2 rounded-[2px] px-5 text-xs font-bold tracking-[0.14em] uppercase bg-pulse-gold text-pulse-bg transition-[background-color,transform,box-shadow] duration-200 hover:-translate-y-px hover:bg-pulse-gold-light hover:shadow-[0_12px_32px_rgba(181,166,117,0.25)] motion-reduce:hover:translate-y-0",
        preview && "cursor-default hover:translate-y-0 hover:bg-pulse-gold hover:shadow-none",
        className,
      )}
    >
      <MessageCircle size={18} strokeWidth={1.9} />
      {label}
    </button>
  );
}
