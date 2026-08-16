import { useCallback, useState, type SetStateAction } from "react";
import { isAttachment, type Attachment } from "./composer-attachments.js";

export type ReasoningEffort = "low" | "medium" | "high";

const TEXT_KEY = "xinyun-drafts";
const ATTACHMENTS_KEY = "xinyun-draft-attachments";
const EFFORT_KEY = "xinyun-reasoning-effort";
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

export function getReasoningEffort(store: Store, id: string): ReasoningEffort {
  const value = read(store, EFFORT_KEY)[id];
  return value === "low" || value === "high" || value === "medium" ? value : "medium";
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

export function useReasoningEffort(id: string): [ReasoningEffort, (next: ReasoningEffort) => void] {
  const store = getStore();
  const [effort, setEffortState] = useState(() => getReasoningEffort(store, id));
  const setEffort = useCallback(
    (next: ReasoningEffort) => {
      setEffortState(next);
      write(store, EFFORT_KEY, id, next, true);
    },
    [store, id],
  );
  return [effort, setEffort];
}
