import { useEffect, useRef, useState } from "react";
import { ClipboardPaste, File as FileIcon, Image as ImageIcon, X } from "lucide-react";
import { cn } from "@/lib/cn";
import {
  attachmentBasename,
  attachmentsFromFiles,
  formatSize,
  imageAttachmentFromFile,
  isImageFile,
  pasteSummary,
  type Attachment,
} from "@/lib/composer-attachments";

export function pathForFile(file: File): string {
  return window.ogb?.getPathForFile?.(file) ?? "";
}

export function ComposerAttachments({
  items,
  onAdd,
  onRemove,
}: {
  items: Attachment[];
  onAdd: (attachments: Attachment[]) => void;
  onRemove: (id: string) => void;
}) {
  const [dragging, setDragging] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const depth = useRef(0);

  useEffect(() => {
    let active = true;
    const carriesFiles = (event: DragEvent) => Array.from(event.dataTransfer?.types ?? []).includes("Files");
    const onEnter = (event: DragEvent) => {
      if (!carriesFiles(event)) return;
      depth.current += 1;
      setDragging(true);
    };
    const onLeave = (event: DragEvent) => {
      if (!carriesFiles(event)) return;
      depth.current = Math.max(0, depth.current - 1);
      if (depth.current === 0) setDragging(false);
    };
    const onOver = (event: DragEvent) => {
      if (carriesFiles(event)) event.preventDefault();
    };
    const onDrop = async (event: DragEvent) => {
      if (!carriesFiles(event)) return;
      event.preventDefault();
      depth.current = 0;
      setDragging(false);
      const files = Array.from(event.dataTransfer?.files ?? []);
      const images = files.filter(isImageFile);
      const result = await attachmentsFromFiles(files.filter((file) => !isImageFile(file)), pathForFile);
      const uploaded: Attachment[] = [];
      const imageErrors: string[] = [];
      for (const file of images) {
        try {
          const attachment = await imageAttachmentFromFile(file);
          if (attachment) uploaded.push(attachment);
        } catch (error) {
          imageErrors.push(`${file.name}: ${error instanceof Error ? error.message : "上传失败"}`);
        }
      }
      if (!active) return;
      if (result.attachments.length || uploaded.length) onAdd([...result.attachments, ...uploaded]);
      const notices = [
        result.rejectedNames.length ? `${result.rejectedNames.join("、")} 无法读取；请先保存到本机后再添加。` : "",
        ...imageErrors,
      ].filter(Boolean);
      setNotice(notices.length ? notices.join("；") : null);
    };
    window.addEventListener("dragenter", onEnter);
    window.addEventListener("dragleave", onLeave);
    window.addEventListener("dragover", onOver);
    window.addEventListener("drop", onDrop);
    return () => {
      active = false;
      window.removeEventListener("dragenter", onEnter);
      window.removeEventListener("dragleave", onLeave);
      window.removeEventListener("dragover", onOver);
      window.removeEventListener("drop", onDrop);
    };
  }, [onAdd]);

  return (
    <>
      {dragging && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 p-10">
          <div className="rounded-2xl border-2 border-dashed border-accent/70 bg-panel/95 px-8 py-6 text-[14px] font-medium text-ink shadow-2xl">
            松开即可添加文件
          </div>
        </div>
      )}
      {notice && (
        <div className="mb-2 flex items-start gap-2 rounded-lg border border-warning/30 bg-warning/10 px-3 py-2 text-[12px] text-warning">
          <span className="min-w-0 flex-1">{notice}</span>
          <button onClick={() => setNotice(null)} aria-label="关闭提示" className="shrink-0 rounded p-0.5"><X size={12} /></button>
        </div>
      )}
      {items.length > 0 && (
        <div className="mb-2 flex flex-wrap gap-2">
          {items.map((attachment) => (
            <div
              key={attachment.id}
              title={attachment.kind === "file" || attachment.kind === "image" ? attachment.path : attachment.name ?? attachment.text.slice(0, 2000)}
              className={cn("group relative w-[172px] rounded-xl border border-hairline/40 bg-raised px-2.5 py-2", "transition-colors hover:border-hairline")}
            >
              {attachment.kind === "paste" ? (
                <>
                  <div className="relative h-[60px] overflow-hidden">
                    <pre className="whitespace-pre-wrap break-words font-mono text-[10.5px] leading-[1.45] text-ink-secondary">{attachment.text.slice(0, 320)}</pre>
                    <div className="pointer-events-none absolute inset-x-0 bottom-0 h-8 bg-gradient-to-b from-transparent to-raised" />
                  </div>
                  <div className="mt-1 truncate text-[10.5px] text-ink-secondary/70">{attachment.name ?? pasteSummary(attachment)}</div>
                </>
              ) : attachment.kind === "image" ? (
                <>
                  <div className="flex h-[60px] items-center justify-center overflow-hidden rounded-md bg-panel">
                    <img
                      src={`/api/attachments/${encodeURIComponent(attachmentBasename(attachment.path))}`}
                      alt={attachment.name}
                      className="max-h-full max-w-full object-contain"
                    />
                  </div>
                  <div className="mt-1 truncate text-[10.5px] text-ink-secondary/70">{formatSize(attachment.size)}</div>
                </>
              ) : (
                <div className="flex h-[60px] items-center gap-2">
                  <FileIcon size={17} className="shrink-0 text-ink-secondary" />
                  <div className="min-w-0"><div className="truncate text-[12px] text-ink">{attachment.name}</div><div className="text-[10.5px] text-ink-secondary/70">{formatSize(attachment.size)}</div></div>
                </div>
              )}
              <div className="mt-1 flex items-center gap-1 text-[9.5px] font-medium tracking-wide text-ink-secondary">
                {attachment.kind === "paste" ? <ClipboardPaste size={11} /> : attachment.kind === "image" ? <ImageIcon size={11} /> : <FileIcon size={11} />}
                {attachment.kind === "paste" ? (attachment.name ? "文本文件" : "长文本") : attachment.kind === "image" ? "图片附件" : "本地文件"}
              </div>
              <button onClick={() => onRemove(attachment.id)} aria-label="移除附件" className="absolute -right-1.5 -top-1.5 flex size-5 items-center justify-center rounded-full border border-hairline/60 bg-panel text-ink-secondary opacity-0 transition-opacity hover:text-ink focus-visible:opacity-100 group-hover:opacity-100"><X size={11} /></button>
            </div>
          ))}
        </div>
      )}
    </>
  );
}
