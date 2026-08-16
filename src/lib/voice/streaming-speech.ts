export interface StreamingSpeechOptions {
  preferredChars?: number;
  maxChars?: number;
}

export interface StreamingSpeechUpdate {
  /** Flush a useful prefix after the model has paused without punctuation. */
  idle?: boolean;
  /** Flush every remaining character when the settled message arrives. */
  final?: boolean;
}

const COMMON_ABBREVIATIONS = new Set([
  "approx.",
  "dr.",
  "e.g.",
  "etc.",
  "i.e.",
  "mr.",
  "mrs.",
  "ms.",
  "no.",
  "vs.",
]);

/**
 * Turns an ever-growing assistant reply into stable, non-overlapping pieces.
 *
 * It deliberately keeps the original Markdown. The server's existing
 * `/api/voice/prepare` endpoint remains the single source of truth for what
 * Markdown, links and code should sound like.
 */
export class StreamingSpeechBuffer {
  private source = "";
  private consumed = 0;
  private readonly preferredChars: number;
  private readonly maxChars: number;

  constructor({ preferredChars = 28, maxChars = 48 }: StreamingSpeechOptions = {}) {
    this.preferredChars = Math.max(1, preferredChars);
    this.maxChars = Math.max(this.preferredChars, maxChars);
  }

  reset() {
    this.source = "";
    this.consumed = 0;
  }

  update(text: string, { idle = false, final = false }: StreamingSpeechUpdate = {}): string[] {
    if (!text) return [];
    this.reconcile(text);

    const chunks: string[] = [];
    let start = this.consumed;
    let cursor = start;
    let fence: "```" | "~~~" | null = null;
    let inlineCode = false;
    let linkLabel = false;
    let linkDepth = 0;

    while (cursor < this.source.length) {
      const marker = this.source.slice(cursor, cursor + 3);
      if (!inlineCode && !linkLabel && linkDepth === 0 && (marker === "```" || marker === "~~~")) {
        if (fence === marker) fence = null;
        else if (!fence) fence = marker;
        cursor += 3;
        continue;
      }

      const char = this.source[cursor];
      if (!fence && !linkLabel && linkDepth === 0 && char === "`") {
        inlineCode = !inlineCode;
        cursor += 1;
        continue;
      }
      if (!fence && !inlineCode) {
        if (linkDepth === 0 && !linkLabel && char === "[") {
          linkLabel = true;
          cursor += 1;
          continue;
        }
        if (linkLabel) {
          if (char === "]" && this.source[cursor + 1] === "(") {
            linkLabel = false;
            linkDepth = 1;
            cursor += 2;
            continue;
          }
          if (char === "]") linkLabel = false;
          cursor += 1;
          continue;
        }
        if (linkDepth === 0 && char === "]" && this.source[cursor + 1] === "(") {
          linkDepth = 1;
          cursor += 2;
          continue;
        }
        if (linkDepth > 0) {
          if (char === "(") linkDepth += 1;
          else if (char === ")") linkDepth -= 1;
          cursor += 1;
          continue;
        }
      }

      if (!fence && !inlineCode && !linkLabel && linkDepth === 0) {
        const boundaryEnd = this.boundaryEnd(cursor);
        if (boundaryEnd !== null) {
          this.append(chunks, start, boundaryEnd);
          start = this.skipWhitespace(boundaryEnd);
          cursor = start;
          continue;
        }
      }
      cursor += 1;
    }

    this.consumed = start;
    if (final) {
      this.append(chunks, this.consumed, this.source.length);
      this.consumed = this.source.length;
    } else if (idle || this.source.length - this.consumed >= this.maxChars) {
      const idleEnd = this.idleBoundary(this.consumed);
      if (idleEnd !== null) {
        this.append(chunks, this.consumed, idleEnd);
        this.consumed = this.skipWhitespace(idleEnd);
      }
    }
    return chunks;
  }

  private reconcile(next: string) {
    if (!this.source || next.startsWith(this.source)) {
      this.source = next;
      return;
    }
    if (this.source.startsWith(next)) return;

    let common = 0;
    const length = Math.min(this.source.length, next.length);
    while (common < length && this.source[common] === next[common]) common += 1;
    this.source = next;
    this.consumed = Math.min(this.consumed, common);
  }

  private append(chunks: string[], start: number, end: number) {
    const chunk = this.source.slice(start, end).trim();
    if (chunk) chunks.push(chunk);
  }

  private skipWhitespace(from: number): number {
    let cursor = from;
    while (cursor < this.source.length && /\s/.test(this.source[cursor])) cursor += 1;
    return cursor;
  }

  private boundaryEnd(at: number): number | null {
    const char = this.source[at];
    if (char === "\n") return at + 1;
    if (/[。！？!?；;]/.test(char)) return this.includeClosingPunctuation(at + 1);
    if (char !== "." || !this.isEnglishPeriodBoundary(at)) return null;
    return this.includeClosingPunctuation(at + 1);
  }

  private includeClosingPunctuation(from: number): number {
    let cursor = from;
    while (cursor < this.source.length && /["')\]}”’]/.test(this.source[cursor])) cursor += 1;
    return cursor;
  }

  private isEnglishPeriodBoundary(at: number): boolean {
    const previous = this.source[at - 1] ?? "";
    const next = this.source[at + 1] ?? "";
    if (/\d/.test(previous) && /\d/.test(next)) return false;
    if (next && !/\s|["')\]}”’]/.test(next)) return false;

    const before = this.source.slice(Math.max(0, at - 12), at + 1);
    const token = before.match(/[A-Za-z.]+\.$/)?.[0]?.toLowerCase();
    if (token && COMMON_ABBREVIATIONS.has(token)) return false;
    if (token && /^[a-z]\.$/.test(token)) return false;
    return true;
  }

  private idleBoundary(start: number): number | null {
    if (this.source.length - start < this.preferredChars) return null;

    const preferred = Math.min(this.source.length, start + this.preferredChars);
    const limit = Math.min(this.source.length, start + this.maxChars);
    let fence: "```" | "~~~" | null = null;
    let fenceStart = -1;
    let inlineCode = false;
    let inlineStart = -1;
    let linkLabel = false;
    let linkDepth = 0;
    let linkStart = -1;
    let lastSafe = start;
    let preferredSafe: number | null = null;

    for (let cursor = start; cursor < limit; cursor += 1) {
      const marker = this.source.slice(cursor, cursor + 3);
      if (!inlineCode && !linkLabel && linkDepth === 0 && (marker === "```" || marker === "~~~")) {
        if (fence === marker) {
          fence = null;
          fenceStart = -1;
        } else if (!fence) {
          fence = marker;
          fenceStart = cursor;
        }
        cursor += 2;
        continue;
      }

      const char = this.source[cursor];
      if (!fence && !linkLabel && linkDepth === 0 && char === "`") {
        inlineCode = !inlineCode;
        inlineStart = inlineCode ? cursor : -1;
        continue;
      }
      if (!fence && !inlineCode) {
        if (linkDepth === 0 && !linkLabel && char === "[") {
          linkLabel = true;
          linkStart = cursor;
          continue;
        }
        if (linkLabel) {
          if (char === "]" && this.source[cursor + 1] === "(") {
            linkLabel = false;
            linkDepth = 1;
            cursor += 1;
            continue;
          }
          if (char === "]") {
            linkLabel = false;
            linkStart = -1;
          }
          continue;
        }
        if (linkDepth === 0 && char === "]" && this.source[cursor + 1] === "(") {
          linkDepth = 1;
          linkStart = cursor;
          cursor += 1;
          continue;
        }
        if (linkDepth > 0) {
          if (char === "(") linkDepth += 1;
          else if (char === ")") {
            linkDepth -= 1;
            if (linkDepth === 0) linkStart = -1;
          }
          continue;
        }
      }

      if (!fence && !inlineCode && !linkLabel && linkDepth === 0) {
        lastSafe = cursor + 1;
        if (cursor + 1 >= preferred) {
          preferredSafe ??= cursor + 1;
          if (/[\s，,、：:]/.test(char)) return cursor + 1;
        }
      }
    }

    const unsafeStart = [fenceStart, inlineStart, linkStart]
      .filter((value) => value >= start)
      .reduce((earliest, value) => Math.min(earliest, value), Number.POSITIVE_INFINITY);
    if (Number.isFinite(unsafeStart)) lastSafe = Math.min(lastSafe, unsafeStart);
    const cut = Math.min(preferredSafe ?? lastSafe, lastSafe);
    return cut > start ? cut : null;
  }
}
