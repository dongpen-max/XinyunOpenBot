/** Long conversations can contain hundreds of rows and inline screenshots.
 * Mount a bounded tail by default, then expand backwards in stable chunks. */
export const TRANSCRIPT_WINDOW_SIZE = 120;

export interface TranscriptWindow<T> {
  visible: T[];
  hiddenCount: number;
  startIndex: number;
}

export function tailWindowStart(total: number, size: number = TRANSCRIPT_WINDOW_SIZE): number {
  return Math.max(0, total - size);
}

export function expandWindowStart(startIndex: number, size: number = TRANSCRIPT_WINDOW_SIZE): number {
  return Math.max(0, startIndex - size);
}

/** Keep an anchored boundary while messages append. If a branch switch or
 * edit makes the list shorter than the stored boundary, start from a fresh
 * tail instead of rendering an empty transcript. */
export function resolveTranscriptWindow<T>(
  messages: readonly T[],
  startIndex: number,
  size: number = TRANSCRIPT_WINDOW_SIZE,
): TranscriptWindow<T> {
  const start = startIndex >= messages.length ? tailWindowStart(messages.length, size) : Math.max(0, startIndex);
  return { visible: messages.slice(start), hiddenCount: start, startIndex: start };
}
