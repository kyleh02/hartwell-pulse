import {
  File,
  FileAudio,
  FileImage,
  FileSpreadsheet,
  FileText,
  FileVideo,
  Folder,
  PenTool,
  Presentation,
  type LucideIcon,
} from "lucide-react";
import type { DriveKind } from "@/lib/drive-shared";

const ICONS: Record<DriveKind, LucideIcon> = {
  folder: Folder,
  image: FileImage,
  pdf: FileText,
  video: FileVideo,
  audio: FileAudio,
  doc: FileText,
  sheet: FileSpreadsheet,
  slides: Presentation,
  drawing: PenTool,
  google: File,
  file: File,
};

/** The icon for a kind of file, where there is no thumbnail to show. */
export function DriveKindIcon({
  kind,
  size = 20,
  className,
}: {
  kind: DriveKind;
  size?: number;
  className?: string;
}) {
  const Icon = ICONS[kind];
  return <Icon size={size} strokeWidth={1.5} className={className} aria-hidden="true" />;
}
