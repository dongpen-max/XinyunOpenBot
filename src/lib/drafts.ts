import { useCallback, useState, type SetStateAction } from "react";
import { isAttachment, type Attachment } from "./composer-attachments.js";

export type ReasoningLevel = "minimal" | "low" | "medium" | "high" | "maximum";

const TEXT_KEY = "xinyun-drafts";
const ATTACHMENTS_KEY = "xinyun-draft-attachments";
const LEVEL_KEY = "xinyun-reasoning-level";
const LEGACY_EFFORT_KEY = "xinyun-reasoning-effort";
type Values = Record<string, unknown>;
type Store = Pick<Storage, "getItem" | "setItem"> | undefined;

function read(store: Store, key: string): Values {
  try {
    const raw = store?.getItem(key);
    const parsed = raw ? JSON.parse(raw) : null;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as Values) : {};
  } catch {
    return {};
  }
}

function write(store: Store, key: string, id: string, value: unknown, keep: boolean): void {
  const values = read(store, key);
  if (keep) values[id] = value;
  else delete values[id];
  try {
    store?.setItem(key, JSON.stringify(values));
  } catch {}
}

function getStore(): Store {
  try {
    return typeof localStorage === "undefined" ? undefined : localStorage;
  } catch {
    return undefined;
  }
}

export function getDraft(store: Store, id: string): string {
  const value = read(store, TEXT_KEY)[id];
  return typeof value === "string" ? value : "";
}

export function getDraftAttachments(store: Store, id: string): Attachment[] {
  const value = read(store, ATTACHMENTS_KEY)[id];
  return Array.isArray(value) ? value.filter(isAttachment) : [];
}

function isReasoningLevel(value: unknown): value is ReasoningLevel {
  return value === "minimal" || value === "low" || value === "medium" || value === "high" || value === "maximum";
}

export function getReasoningLevel(store: Store, id: string): ReasoningLevel {
  const value = read(store, LEVEL_KEY)[id];
  if (isReasoningLevel(value)) return value;

  // 0.1.29 stored three levels. Preserve the old top setting as the new
  // visual maximum rather than silently lowering it to the fourth stop.
  const legacy = read(store, LEGACY_EFFORT_KEY)[id];
  if (legacy === "high") return "maximum";
  if (legacy === "low" || legacy === "medium") return legacy;
  return "medium";
}

export function useComposerDraft(
  id: string,
): [string, (next: string) => void, Attachment[], (next: SetStateAction<Attachment[]>) => void] {
  const store = getStore();
  const [text, setTextState] = useState(() => getDraft(store, id));
  const [attachments, setAttachmentsState] = useState(() => getDraftAttachments(store, id));
  const setText = useCallback(
    (next: string) => {
      setTextState(next);
      write(store, TEXT_KEY, id, next, Boolean(next));
    },
    [store, id],
  );
  const setAttachments = useCallback(
    (next: SetStateAction<Attachment[]>) => {
      setAttachmentsState((previous) => {
        const value = typeof next === "function" ? next(previous) : next;
        write(store, ATTACHMENTS_KEY, id, value, value.length > 0);
        return value;
      });
    },
    [store, id],
  );
  return [text, setText, attachments, setAttachments];
}

export function useReasoningLevel(id: string): [ReasoningLevel, (next: ReasoningLevel) => void] {
  const store = getStore();
  const [level, setLevelState] = useState(() => getReasoningLevel(store, id));
  const setLevel = useCallback(
    (next: ReasoningLevel) => {
      setLevelState(next);
      write(store, LEVEL_KEY, id, next, true);
    },
    [store, id],
  );
  return [level, setLevel];
}
