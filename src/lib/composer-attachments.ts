export type PasteAttachment = {
  kind: "paste";
  id: string;
  text: string;
  size: number;
  lines: number;
  name?: string;
};

export type FileAttachment = {
  kind: "file";
  id: string;
  path: string;
  name: string;
  size: number;
};

export type Attachment = PasteAttachment | FileAttachment;

function validSize(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

export function isAttachment(value: unknown): value is Attachment {
  if (!value || typeof value !== "object") return false;
  const attachment = value as Record<string, unknown>;
  if (typeof attachment.id !== "string" || !validSize(attachment.size)) return false;
  if (attachment.kind === "paste") {
    return (
      typeof attachment.text === "string" &&
      typeof attachment.lines === "number" &&
      Number.isInteger(attachment.lines) &&
      attachment.lines >= 1 &&
      (attachment.name === undefined || typeof attachment.name === "string")
    );
  }
  return (
    attachment.kind === "file" &&
    typeof attachment.path === "string" &&
    attachment.path.length > 0 &&
    typeof attachment.name === "string"
  );
}

export const PASTE_CHARS = 900;
export const PASTE_LINES = 12;
export const INLINE_TEXT_LIMIT = 512 * 1024;

export function countLines(text: string): number {
  return text.split("\n").length;
}

export function isLongPaste(text: string): boolean {
  return text.length >= PASTE_CHARS || countLines(text) >= PASTE_LINES;
}

function newId(): string {
  return globalThis.crypto?.randomUUID?.() ?? `a${Math.random().toString(36).slice(2)}`;
}

export function byteLength(text: string): number {
  return new TextEncoder().encode(text).length;
}

export function pasteAttachment(text: string, name?: string): PasteAttachment {
  return { kind: "paste", id: newId(), text, size: byteLength(text), lines: countLines(text), ...(name ? { name } : {}) };
}

export function fileAttachment(name: string, path: string, size: number): FileAttachment {
  return { kind: "file", id: newId(), path, name, size };
}

export type DroppedFile = Pick<File, "name" | "size" | "type" | "text">;

function isInlineText(file: DroppedFile): boolean {
  return (
    file.type.startsWith("text/") ||
    ["application/json", "application/xml", "application/javascript"].includes(file.type) ||
    /\.(?:txt|md|json|jsonl|csv|tsv|ya?ml|toml|xml|html?|css|scss|less|jsx?|tsx?|py|go|rs|java|kt|swift|c|cc|cpp|h|hpp|cs|php|rb|sh|ps1|sql|log)$/i.test(file.name)
  );
}

/** Small text/code files are inlined so API and cloud models can read them.
 * Other desktop files remain path references for local agent providers. */
export async function attachmentsFromFiles<T extends DroppedFile>(
  files: readonly T[],
  getPath: (file: T) => string,
): Promise<{ attachments: Attachment[]; rejectedNames: string[] }> {
  const results = await Promise.all(
    files.map(async (file) => {
      if (isInlineText(file) && file.size <= INLINE_TEXT_LIMIT) {
        try {
          return { attachment: pasteAttachment(await file.text(), file.name) };
        } catch {}
      }
      let path = "";
      try {
        path = getPath(file);
      } catch {}
      if (path) return { attachment: fileAttachment(file.name, path, file.size) };
      return { rejectedName: file.name };
    }),
  );
  return {
    attachments: results.flatMap((result) => ("attachment" in result && result.attachment ? [result.attachment] : [])),
    rejectedNames: results.flatMap((result) => ("rejectedName" in result && result.rejectedName ? [result.rejectedName] : [])),
  };
}

export function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function pasteSummary(attachment: { lines: number; size: number }): string {
  return `${attachment.lines} 行 · ${formatSize(attachment.size)}`;
}

export function composeMessage(text: string, attachments: Attachment[]): string {
  const parts = [text.trim()];
  attachments.forEach((attachment, index) => {
    if (attachment.kind === "paste") {
      const name = attachment.name ? ` name="${escapeAttribute(attachment.name)}"` : "";
      parts.push(`<pasted-text index="${index + 1}"${name}>\n${attachment.text}\n</pasted-text>`);
    } else {
      parts.push(`<attached-file path="${escapeAttribute(attachment.path)}" name="${escapeAttribute(attachment.name)}" />`);
    }
  });
  return parts.filter(Boolean).join("\n\n");
}

export function escapeAttribute(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll('"', "&quot;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll("\t", "&#9;")
    .replaceAll("\r", "&#13;")
    .replaceAll("\n", "&#10;");
}
