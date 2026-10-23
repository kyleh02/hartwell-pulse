"use client";

import { useCallback, useRef, useState } from "react";

export interface UploadItem {
  key: string;
  name: string;
  size: number;
  /** 0 to 1. */
  progress: number;
  state: "queued" | "uploading" | "done" | "error";
  error?: string;
}

const CONCURRENCY = 3;

/**
 * Uploads into a shared Drive folder, straight from the browser to Google.
 *
 * Each file asks the portal to open an upload (which checks the folder and
 * fixes the destination), then sends its bytes directly to the URL Google
 * gave back, with real progress. Three at a time, so a drop of twenty photos
 * moves steadily rather than all crawling at once.
 *
 * When every file in a drop has finished, `onBatchDone` hears which ones
 * arrived, so the folder can refresh and Kyle can be told.
 */
export function useDriveUploads({
  linkId,
  onBatchDone,
}: {
  linkId: string;
  onBatchDone: (pathKey: string, ids: string[]) => void;
}) {
  const [items, setItems] = useState<UploadItem[]>([]);
  const counter = useRef(0);

  const patch = useCallback((key: string, p: Partial<UploadItem>) => {
    setItems((all) => all.map((i) => (i.key === key ? { ...i, ...p } : i)));
  }, []);

  const uploadOne = useCallback(
    async (file: File, key: string, pathKey: string): Promise<string | null> => {
      patch(key, { state: "uploading", progress: 0 });
      try {
        const res = await fetch("/api/drive/upload", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            link: linkId,
            p: pathKey,
            name: file.name,
            type: file.type,
            size: file.size,
          }),
        });
        const json = (await res.json().catch(() => ({}))) as { url?: string; message?: string };
        if (!res.ok || !json.url) throw new Error(json.message || "Couldn't start the upload.");

        const id = await new Promise<string>((resolve, reject) => {
          const xhr = new XMLHttpRequest();
          xhr.open("PUT", json.url as string);
          xhr.upload.onprogress = (e) => {
            if (e.lengthComputable) patch(key, { progress: e.loaded / e.total });
          };
          xhr.onload = () => {
            if (xhr.status >= 200 && xhr.status < 300) {
              try {
                resolve((JSON.parse(xhr.responseText) as { id: string }).id);
              } catch {
                resolve("");
              }
            } else {
              reject(new Error(`Google refused the upload (${xhr.status}).`));
            }
          };
          xhr.onerror = () => reject(new Error("The connection dropped. Try again."));
          xhr.send(file);
        });
        patch(key, { state: "done", progress: 1 });
        return id || null;
      } catch (e) {
        patch(key, { state: "error", error: e instanceof Error ? e.message : "Upload failed." });
        return null;
      }
    },
    [linkId, patch],
  );

  const enqueue = useCallback(
    (files: File[], pathKey: string) => {
      if (files.length === 0) return;
      const batch = files.map((file) => ({ file, key: `u${++counter.current}` }));
      setItems((all) => [
        ...all.filter((i) => i.state !== "done"),
        ...batch.map(({ file, key }) => ({
          key,
          name: file.name,
          size: file.size,
          progress: 0,
          state: "queued" as const,
        })),
      ]);

      void (async () => {
        const ids: string[] = [];
        let next = 0;
        async function worker() {
          while (next < batch.length) {
            const { file, key } = batch[next++];
            const id = await uploadOne(file, key, pathKey);
            if (id) ids.push(id);
          }
        }
        await Promise.all(Array.from({ length: Math.min(CONCURRENCY, batch.length) }, worker));
        if (ids.length) onBatchDone(pathKey, ids);
      })();
    },
    [uploadOne, onBatchDone],
  );

  const dismiss = useCallback(() => {
    setItems((all) => all.filter((i) => i.state === "queued" || i.state === "uploading"));
  }, []);

  return { items, enqueue, dismiss };
}
