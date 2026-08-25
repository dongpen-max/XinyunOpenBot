// Bot avatar — the Blob Studio "Cursor" mascot (CursorAvatar.tsx), wrapped
// in the app's historical MausAvatar API so no call site changes: per-bot
// color becomes a body gradient, the app's one-shot motion beats borrow the
// face/state for a moment, and the eyes follow the pointer. The previous
// hand-built Maus body + face engine (maus-engine/face/driver) is gone;
// CursorAvatar owns morphing, blinking, drift, body motion and effects.
import {
  forwardRef,
  memo,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
  useId,
  type PointerEvent as ReactPointerEvent,
} from "react";
import { MAUS_COLORS, type MausColor, type MausMotion, type MausState } from "@/lib/mascot";
import { ModelAvatarMark } from "./ProviderIcons";
import type { ModelVendor } from "@/lib/model-vendor";
import { CursorAvatar, SHAPE, type CursorAvatarHandle, type CursorShape } from "./CursorAvatar";
import { ANIMAL_MASCOT_SHAPES, type AnimalMausShape } from "./animalMascotShapes";

/** Restore the gradient slot in the baked cursor artwork. */
const GRADIENT_SHAPE: CursorShape = {
  ...SHAPE,
  body: SHAPE.body.replace(/fill="#000000"/g, 'fill="{{GRADIENT}}"'),
};

export type MausShape =
  | "cursor"
  | "orb"
  | "block"
  | "capsule"
  | "triangle"
  | "crystal"
  | "cloud"
  | "drop"
  // Legacy ids remain accepted so saved workspaces continue to render.
  | "blob"
  | "diamond"
  | "leaf"
  | "comet"
  | "shield"
  | "star"
  | ProviderAvatarId
  | AnimalMausShape;

/** Static local model marks. Keeping these as vector primitives avoids a
 * network dependency and preserves the model's original artwork and colors. */
export type ModelAvatarId =
  | "model-openai"
  | "model-claude"
  | "model-gemini"
  | "model-grok"
  | "model-deepseek"
  | "model-glm"
  | "model-qwen"
  | "model-kimi"
  | "model-mistral"
  | "model-llama"
  | "model-phi"
  | "model-cohere"
  | "model-minimax"
  | "model-baichuan"
  | "model-internlm"
  | "model-hunyuan"
  | "model-stepfun"
  | "model-yi";

/** @deprecated Kept as a type alias for workspaces created during the first
 * branding preview. New selections use model-* ids. */
export type ProviderAvatarId = ModelAvatarId;

export type MascotShapeCategory = "base" | "animal";

export type MascotShapeOption = {
  id: MausShape;
  label: string;
  category: MascotShapeCategory;
  shape: CursorShape;
};

const artwork = (name: MausShape, body: string, clip: string, anchor = { x: 114, y: 118, scale: 0.72 }): CursorShape => ({
  name,
  fit: "",
  body,
  clip,
  anchor,
});

const pathShape = (name: MausShape, d: string, anchor?: CursorShape["anchor"]) =>
  artwork(name, `<path d="${d}" fill="{{GRADIENT}}"/>`, `<path d="${d}"/>`, anchor);

/**
 * Eight compact robot silhouettes inspired by Grok Bot's avatar picker.
 * The body stays deliberately simple; the CursorAvatar expression engine supplies
 * the small white eye language so every option still animates with the app's states.
 */
export const BASE_MASCOT_SHAPES: MascotShapeOption[] = [
  {
    id: "cursor",
    label: "圆润",
    category: "base",
    shape: pathShape(
      "cursor",
      "M114 17C69 17 31 44 21 88c-10 45 15 91 57 109 36 15 79 7 104-23 27-32 30-78 7-115-16-27-43-42-75-42Z",
      { x: 114, y: 116, scale: 0.53 },
    ),
  },
  {
    id: "orb",
    label: "圆球",
    category: "base",
    shape: artwork(
      "orb",
      '<circle cx="114" cy="114" r="96" fill="{{GRADIENT}}"/>',
      '<circle cx="114" cy="114" r="96"/>',
      { x: 114, y: 114, scale: 0.52 },
    ),
  },
  {
    id: "block",
    label: "方块",
    category: "base",
    shape: artwork(
      "block",
      '<rect x="22" y="22" width="184" height="184" rx="54" fill="{{GRADIENT}}"/>',
      '<rect x="22" y="22" width="184" height="184" rx="54"/>',
      { x: 114, y: 114, scale: 0.5 },
    ),
  },
  {
    id: "capsule",
    label: "胶囊",
    category: "base",
    shape: artwork(
      "capsule",
      '<rect x="16" y="56" width="196" height="116" rx="58" fill="{{GRADIENT}}"/>',
      '<rect x="16" y="56" width="196" height="116" rx="58"/>',
      { x: 114, y: 114, scale: 0.53 },
    ),
  },
  {
    id: "triangle",
    label: "三角",
    category: "base",
    shape: pathShape(
      "triangle",
      "M114 18c8 0 15 5 19 12l79 142c8 15-3 33-20 33H36c-17 0-28-18-20-33L95 30c4-7 11-12 19-12Z",
      { x: 114, y: 127, scale: 0.52 },
    ),
  },
  {
    id: "crystal",
    label: "晶核",
    category: "base",
    shape: pathShape(
      "crystal",
      "M114 14 186 48l28 66-28 66-72 34-72-34-28-66 28-66 72-34Z",
      { x: 114, y: 119, scale: 0.51 },
    ),
  },
  {
    id: "cloud",
    label: "云团",
    category: "base",
    shape: pathShape(
      "cloud",
      "M51 178h127c25 0 42-17 42-39 0-21-16-37-37-39-5-30-29-51-60-51-26 0-48 15-57 38-4-1-8-2-13-2-27 0-48 20-48 46s20 47 46 47Z",
      { x: 114, y: 124, scale: 0.5 },
    ),
  },
  {
    id: "drop",
    label: "水滴",
    category: "base",
    shape: pathShape(
      "drop",
      "M114 16c13 21 58 69 72 104 16 39-5 83-45 96-45 14-92-12-101-56-7-34 12-66 30-92 15-22 31-39 44-52Z",
      { x: 114, y: 122, scale: 0.52 },
    ),
  },
];

/**
 * Reference-only Grok Bot mark used by the avatar picker in Basic settings.
 * It intentionally stays separate from CursorAvatar so the rest of the app
 * keeps its existing renderer and motion behaviour.
 */
const REFERENCE_GROK_COLORS: Record<MausColor, [string, string]> = {
  green: ["#00c972", "#009957"],
  blue: ["#2a92fe", "#0e74e0"],
  red: ["#ff3e51", "#e02135"],
  orange: ["#ff781c", "#ff6700"],
  yellow: ["#ffaf38", "#ff9800"],
  cyan: ["#1cc3b0", "#00a592"],
  purple: ["#a97efe", "#804ee0"],
  pink: ["#ff5eb1", "#e02a88"],
  teal: ["#1cc3b0", "#00a592"],
  coral: ["#ff5e65", "#e02a40"],
};

const REFERENCE_GROK_SHAPES: Record<string, string> = {
  blob: "M228.5 114.2c0 15.9-3.4 31.8-9.8 46.3-6.1 13.7-14.8 26.1-25.7 36.5-37.1 35.4-93.6 41.6-137.5 15.3-10.4-6.3-19.8-14.2-27.8-23.4-8.5-9.9-15.4-21.3-20.1-33.5-5.1-13.1-7.7-27.1-7.7-41.1 0-15.9 3.4-31.8 9.8-46.3 6.1-13.7 14.8-26.1 25.7-36.5C72.6-3.9 129-10.1 173 16.2c10.4 6.3 19.8 14.2 27.8 23.4 8.6 9.9 15.4 21.3 20.1 33.5 5.1 13.1 7.6 27.1 7.6 41.1Z",
  pebble: "M228 114c0 61-51 110-114 110S0 175 0 114 51 4 114 4s114 49 114 110Z",
  squircle: "M22 60c0-21 17-38 38-38h108c21 0 38 17 38 38v108c0 21-17 38-38 38H60c-21 0-38-17-38-38V60Z",
  tablet: "M40 40h148c28 0 50 22 50 50v48c0 28-22 50-50 50H40c-28 0-50-22-50-50V90c0-28 22-50 50-50Z",
  wedge: "M114 0 228 198H0L114 0Z",
  hex: "M114 0 213 57v114l-99 57-99-57V57L114 0Z",
  cloud: "M47 185c-26 0-47-21-47-47s21-47 47-47c9-28 35-47 67-47 36 0 65 28 69 63 25 0 45 18 45 41s-20 37-45 37H47Z",
  teardrop: "M114 0c15 25 70 82 70 128 0 51-31 86-70 86s-70-35-70-86C44 82 99 25 114 0Z",
};

const REFERENCE_SHAPE_ALIASES: Record<string, string> = {
  cursor: "blob",
  orb: "pebble",
  block: "squircle",
  capsule: "tablet",
  triangle: "wedge",
  crystal: "hex",
  cloud: "cloud",
  drop: "teardrop",
};

export function ReferenceGrokAvatar({
  color = "green",
  shape = "blob",
  size = 42,
  label,
}: {
  color?: MausColor;
  shape?: MausShape | string | null;
  size?: number;
  label?: string;
}) {
  const id = useId().replace(/:/g, "");
  const [light, dark] = REFERENCE_GROK_COLORS[color] ?? REFERENCE_GROK_COLORS.green;
  const shapeId = normalizeMascotShapeId(shape);
  const path = REFERENCE_GROK_SHAPES[REFERENCE_SHAPE_ALIASES[shapeId] ?? shapeId] ?? REFERENCE_GROK_SHAPES.blob;
  return (
    <svg
      aria-label={label}
      aria-hidden={label ? undefined : true}
      className="reference-grok-avatar"
      height={size}
      role={label ? "img" : undefined}
      viewBox="0 0 228 228"
      width={size}
    >
      <defs>
        <linearGradient id={`${id}-grok`} x1="0" x2="1" y1="0" y2="1">
          <stop offset="0" stopColor={light} />
          <stop offset="1" stopColor={dark} />
        </linearGradient>
      </defs>
      <path d={path} fill={`url(#${id}-grok)`} />
      <g fill="var(--panel, #fff)">
        <ellipse cx="85" cy="106" rx="10" ry="24" />
        <ellipse cx="143" cy="106" rx="10" ry="24" />
      </g>
    </svg>
  );
}

const LEGACY_BASE_SHAPE_ALIASES: Record<string, MausShape> = {
  blob: "drop",
  diamond: "crystal",
  leaf: "drop",
  comet: "cloud",
  shield: "crystal",
  star: "crystal",
};

export type ModelAvatarOption = {
  id: ModelAvatarId;
  label: string;
  vendor: Exclude<ModelVendor, "computer" | "unknown">;
  /** Black/dark marks receive a small adaptive halo on dark app themes. */
  contrastOnDark?: boolean;
};

export const MODEL_AVATAR_OPTIONS: ModelAvatarOption[] = [
  { id: "model-openai", label: "GPT / Codex", vendor: "openai", contrastOnDark: true },
  { id: "model-claude", label: "Claude", vendor: "anthropic" },
  { id: "model-gemini", label: "Gemini", vendor: "google" },
  { id: "model-grok", label: "Grok", vendor: "xai", contrastOnDark: true },
  { id: "model-deepseek", label: "DeepSeek", vendor: "deepseek" },
  { id: "model-glm", label: "GLM", vendor: "zhipu" },
  { id: "model-qwen", label: "Qwen", vendor: "qwen" },
  { id: "model-kimi", label: "Kimi", vendor: "moonshot", contrastOnDark: true },
  { id: "model-mistral", label: "Mixtral", vendor: "mistral" },
  { id: "model-llama", label: "Llama", vendor: "meta" },
  { id: "model-phi", label: "Phi", vendor: "microsoft" },
  { id: "model-cohere", label: "Command R", vendor: "cohere" },
  { id: "model-minimax", label: "MiniMax-01", vendor: "minimax" },
  { id: "model-baichuan", label: "Baichuan", vendor: "baichuan", contrastOnDark: true },
  { id: "model-internlm", label: "InternLM", vendor: "internlm" },
  { id: "model-hunyuan", label: "Hunyuan", vendor: "tencent" },
  { id: "model-stepfun", label: "Step", vendor: "stepfun" },
  { id: "model-yi", label: "Yi", vendor: "yi", contrastOnDark: true },
];

/** @deprecated Use MODEL_AVATAR_OPTIONS. */
export const PROVIDER_AVATAR_OPTIONS = MODEL_AVATAR_OPTIONS;

const LEGACY_PROVIDER_AVATAR_ALIASES: Record<string, ModelAvatarId> = {
  "provider-openai": "model-openai",
  "provider-anthropic": "model-claude",
  "provider-gemini": "model-gemini",
  "provider-grok": "model-grok",
  "provider-deepseek": "model-deepseek",
  "provider-qwen": "model-qwen",
  "provider-kimi": "model-kimi",
  "provider-glm": "model-glm",
};
const MODEL_AVATAR_IDS = new Set<string>(MODEL_AVATAR_OPTIONS.map(({ id }) => id));

export function isModelAvatar(id?: string | null): id is ModelAvatarId {
  return Boolean(id && MODEL_AVATAR_IDS.has(id));
}

/** @deprecated Use isModelAvatar. */
export function isProviderAvatar(id?: string | null): id is ModelAvatarId {
  return isModelAvatar(LEGACY_PROVIDER_AVATAR_ALIASES[id ?? ""] ?? id);
}

export type AvatarKind = "mascot" | "model";

/** Resolves the independently persisted mascot/model selections to the mark
 * that should be rendered. Legacy model-* mascotShape values remain valid. */
export function resolveAvatarShape(profile: {
  mascotShape?: MausShape | string | null;
  avatarKind?: AvatarKind | string | null;
  modelAvatar?: ModelAvatarId | string | null;
}): MausShape {
  const legacyShape = normalizeMascotShapeId(profile.mascotShape);
  if (profile.avatarKind === "model" || (profile.avatarKind == null && isModelAvatar(legacyShape))) {
    return isModelAvatar(profile.modelAvatar) ? profile.modelAvatar : isModelAvatar(legacyShape) ? legacyShape : "model-openai";
  }
  return isModelAvatar(legacyShape) ? "cursor" : legacyShape;
}

export const MASCOT_SHAPES: MascotShapeOption[] = [
  ...BASE_MASCOT_SHAPES,
  ...ANIMAL_MASCOT_SHAPES.map((entry) => ({ ...entry, category: "animal" as const })),
];

const SHAPES_BY_ID = new Map(MASCOT_SHAPES.map((entry) => [entry.id, entry.shape]));

export function normalizeMascotShapeId(id?: string | null): MausShape {
  const candidate = id ?? "cursor";
  return (LEGACY_BASE_SHAPE_ALIASES[candidate] ?? LEGACY_PROVIDER_AVATAR_ALIASES[candidate] ?? candidate) as MausShape;
}

export function mascotShape(id?: string | null): CursorShape {
  return SHAPES_BY_ID.get(normalizeMascotShapeId(id)) ?? SHAPES_BY_ID.get("cursor") ?? GRADIENT_SHAPE;
}

const BASE_MASCOT_IDS = new Set(BASE_MASCOT_SHAPES.map(({ id }) => id));

export function mascotUsesEyesOnly(id?: string | null): boolean {
  return BASE_MASCOT_IDS.has(normalizeMascotShapeId(id));
}

/**
 * Legacy face-placement knobs from the Maus body era. The cursor mascot
 * places its own face; these remain only so the preview harness's sliders
 * keep compiling — the matching props are accepted and ignored.
 */
export const FACE_X = 80;
export const FACE_Y = 102;
export const FACE_SCALE = 0.47;
export const EYE_SCALE = 1.12;
export const MOUTH_WEIGHT = 11;

/**
 * How far the pointer may pull the eyes. Facing forward the full range is
 * safe; with the expressions' authored gaze they already start off-centre.
 */
const POINTER_GAZE = { forward: 1, authored: 0.25 };

/**
 * What a one-shot motion does while it plays: CursorAvatar animates the body
 * per state, so borrowing the state for a beat moves body and face together.
 */
const MOTION_FACE: Partial<
  Record<Exclude<MausMotion, "none">, { state?: MausState; blink?: boolean; spin?: number }>
> = {
  arrive: { state: "spawning", spin: 900 },
  switch: { state: "waking", spin: 620 },
  customize: { state: "proud", blink: true },
  alert: { state: "alerting" },
  thinking: { state: "thinking" },
  working: { state: "working" },
  launch: { state: "loading" },
  success: { state: "happy", blink: true },
  celebrate: { state: "celebrate", spin: 700 },
  blink: { blink: true },
  surprise: { state: "surprised", blink: true },
  failure: { state: "sad" },
};

/** How long a one-shot motion holds its state before the bot's own returns. */
const MOTION_FACE_MS = 1400;

/** Channel-wise mix of a hex color toward another, t in 0..1. */
function mix(hex: string, toward: string, t: number): string {
  const a = Number.parseInt(hex.slice(1), 16);
  const b = Number.parseInt(toward.slice(1), 16);
  const channel = (shift: number) => {
    const va = (a >> shift) & 0xff;
    const vb = (b >> shift) & 0xff;
    return Math.round(va + (vb - va) * t);
  };
  return `#${[channel(16), channel(8), channel(0)]
    .map((part) => part.toString(16).padStart(2, "0"))
    .join("")}`;
}

/**
 * Bot color -> the mascot's three-stop body gradient (highlight, base,
 * shadow), with the same light/dark spread as the pack's default green
 * ["#9FE6B5", "#3FAE6E", "#1C7A4C"].
 */
const gradientFor = (color: MausColor): [string, string, string] => {
  const fill = MAUS_COLORS[color] ?? MAUS_COLORS.green;
  return [mix(fill, "#ffffff", 0.55), fill, mix(fill, "#000000", 0.42)];
};

export type MausAvatarHandle = CursorAvatarHandle;

function ModelAvatar({
  id,
  size,
  label,
}: {
  id: ModelAvatarId;
  size: number;
  label?: string;
}) {
  const option = MODEL_AVATAR_OPTIONS.find((entry) => entry.id === id) ?? MODEL_AVATAR_OPTIONS[0];
  return (
    <span
      className="model-avatar"
      style={{ width: size, height: size }}
      role={label ? "img" : undefined}
      aria-label={label}
    >
      <ModelAvatarMark
        model={option.id}
        size={Math.round(size * 0.74)}
        className={option.contrastOnDark ? "model-avatar__mark model-avatar__mark--contrast" : "model-avatar__mark"}
      />
    </span>
  );
}

export type MausAvatarProps = {
  color: MausColor;
  shape?: MausShape | string | null;
  /** Optional user-supplied avatar image stored as a validated data URL. */
  image?: string | null;
  /** Named behaviour — drives the expression pool, its cadence and blinking. */
  state?: MausState;
  /** Pin one of the 25 faces and stop the state's own drift. */
  expression?: number;
  size?: number;
  label?: string;
  motion?: MausMotion;
  motionKey?: number;
  /** Head turn in degrees. */
  turn?: number;
  gaze?: { x?: number; y?: number };
  spring?: number;
  eyeScale?: number;
  showMouth?: boolean;
  mouthStroke?: number;
  /**
   * Face the viewer at turn 0, cancelling each expression's authored gaze
   * direction. Off restores the engine's own drawn-in directions.
   */
  forward?: boolean;
  /** Let the eyes follow the pointer across this avatar. */
  trackPointer?: boolean;
  /** Run the animation. Off renders the state's resting face. */
  animated?: boolean;
  /** Legacy Maus face-placement knobs — accepted, ignored. */
  eyeSpacing?: number;
  faceX?: number;
  faceY?: number;
  faceScale?: number;
};

function MausAvatarComponent(
  {
    color,
    shape,
    image,
    state = "idle",
    expression,
    size = 44,
    label,
    motion = "none",
    motionKey = 0,
    turn,
    gaze,
    spring,
    eyeScale,
    showMouth,
    mouthStroke,
    forward = true,
    trackPointer = true,
    animated = true,
  }: MausAvatarProps,
  ref: React.Ref<MausAvatarHandle>,
) {
  const inner = useRef<CursorAvatarHandle>(null);
  useImperativeHandle(ref, () => ({
    blink: () => inner.current?.blink(),
    spin: (durationMs?: number) => inner.current?.spin(durationMs),
    setExpression: (index: number) => inner.current?.setExpression(index),
  }));

  // A one-shot motion borrows the state for a moment, then hands it back.
  const [motionState, setMotionState] = useState<MausState | null>(null);
  useEffect(() => {
    if (motion === "none" || !animated) return;
    const beat = MOTION_FACE[motion];
    if (!beat) return;
    if (beat.blink) inner.current?.blink();
    if (beat.spin) inner.current?.spin(beat.spin);
    if (!beat.state) return;
    setMotionState(beat.state);
    const timer = setTimeout(() => setMotionState(null), MOTION_FACE_MS);
    return () => clearTimeout(timer);
  }, [motion, motionKey, animated]);

  // Pointer-follow gaze, composed with any gaze the caller pins.
  const [pointer, setPointer] = useState({ x: 0, y: 0 });
  const range = forward ? POINTER_GAZE.forward : POINTER_GAZE.authored;
  const onPointerMove = (event: ReactPointerEvent<HTMLSpanElement>) => {
    if (!trackPointer || !animated) return;
    const rect = event.currentTarget.getBoundingClientRect();
    setPointer({
      x: Math.max(-1, Math.min(1, ((event.clientX - rect.left) / rect.width) * 2 - 1)) * range,
      y: Math.max(-1, Math.min(1, ((event.clientY - rect.top) / rect.height) * 2 - 1)) * range,
    });
  };
  const onPointerLeave = () => setPointer({ x: 0, y: 0 });
  const resolvedShapeId = normalizeMascotShapeId(shape);
  const eyesOnly = mascotUsesEyesOnly(resolvedShapeId);

  if (image) {
    return (
      <span
        className="model-avatar inline-flex shrink-0 overflow-hidden rounded-full"
        style={{ width: size, height: size }}
      >
        <img
          src={image}
          alt={label ?? ""}
          className="size-full object-cover"
          draggable={false}
        />
      </span>
    );
  }

  if (isModelAvatar(resolvedShapeId)) {
    return <ModelAvatar id={resolvedShapeId} size={size} label={label} />;
  }

  return (
    <span
      className="inline-flex shrink-0"
      onPointerMove={trackPointer && animated ? onPointerMove : undefined}
      onPointerLeave={trackPointer && animated ? onPointerLeave : undefined}
    >
      <CursorAvatar
        ref={inner}
        state={motionState ?? state}
        expression={expression}
        size={size}
        shape={mascotShape(resolvedShapeId)}
        gradient={gradientFor(color)}
        title={label ?? null}
        lookAround={forward ? 0 : 1}
        gaze={{ x: (gaze?.x ?? 0) + pointer.x, y: (gaze?.y ?? 0) + pointer.y }}
        turn={turn}
        spring={spring}
        eyeScale={eyeScale ?? (eyesOnly ? 0.9 : undefined)}
        showMouth={showMouth ?? !eyesOnly}
        mouthStroke={mouthStroke}
        paused={!animated}
      />
    </span>
  );
}

export const MausAvatar = memo(forwardRef(MausAvatarComponent));

export function InitialsAvatar({
  initials,
  size = 32,
}: {
  initials: string;
  size?: number;
}) {
  return (
    <div
      className="flex shrink-0 items-center justify-center rounded-full bg-raised text-ink-secondary font-medium"
      style={{ width: size, height: size, fontSize: size * 0.38 }}
    >
      {initials}
    </div>
  );
}
