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
  type PointerEvent as ReactPointerEvent,
} from "react";
import { MAUS_COLORS, type MausColor, type MausMotion, type MausState } from "@/lib/mascot";
import { CursorAvatar, SHAPE, type CursorAvatarHandle, type CursorShape } from "./CursorAvatar";

/** Restore the gradient slot in the baked cursor artwork. */
const GRADIENT_SHAPE: CursorShape = {
  ...SHAPE,
  body: SHAPE.body.replace(/fill="#000000"/g, 'fill="{{GRADIENT}}"'),
};

export type MausShape =
  | "cursor"
  | "blob"
  | "orb"
  | "diamond"
  | "leaf"
  | "cloud"
  | "comet"
  | "shield"
  | "capsule"
  | "star";

const artwork = (name: MausShape, body: string, clip: string, anchor = { x: 114, y: 118, scale: 0.72 }): CursorShape => ({
  name,
  fit: "",
  body,
  clip,
  anchor,
});

const pathShape = (name: MausShape, d: string, anchor?: CursorShape["anchor"]) =>
  artwork(name, `<path d="${d}" fill="{{GRADIENT}}"/>`, `<path d="${d}"/>`, anchor);

/** Lightweight silhouettes inspired by modern mascot pickers. */
export const MASCOT_SHAPES: Array<{ id: MausShape; label: string; shape: CursorShape }> = [
  { id: "cursor", label: "光标", shape: GRADIENT_SHAPE },
  {
    id: "blob",
    label: "水滴",
    shape: pathShape(
      "blob",
      "M114 15C73 15 36 42 25 80c-13 45 5 98 49 120 29 15 66 14 93-3 36-22 47-65 35-105-11-37-45-77-88-77Z",
      { x: 114, y: 118, scale: 0.73 },
    ),
  },
  { id: "orb", label: "圆球", shape: artwork("orb", '<circle cx="114" cy="114" r="98" fill="{{GRADIENT}}"/>', '<circle cx="114" cy="114" r="98"/>', { x: 114, y: 114, scale: 0.72 }) },
  { id: "diamond", label: "菱形", shape: pathShape("diamond", "M114 12L216 114L114 216L12 114Z", { x: 114, y: 114, scale: 0.68 }) },
  { id: "leaf", label: "叶片", shape: pathShape("leaf", "M114 18C172 30 207 70 205 121c-2 54-40 86-91 91-4-43 9-78 34-104-30 16-53 38-70 67C45 142 27 105 42 70c13-28 38-45 72-52Z", { x: 115, y: 118, scale: 0.67 }) },
  { id: "cloud", label: "云朵", shape: pathShape("cloud", "M51 178h127c25 0 42-17 42-39 0-21-16-37-37-39-5-30-29-51-60-51-26 0-48 15-57 38-4-1-8-2-13-2-27 0-48 20-48 46s20 47 46 47Z", { x: 114, y: 124, scale: 0.62 }) },
  { id: "comet", label: "彗星", shape: artwork("comet", '<path d="M40 165c15 13 31 22 49 27-7-13-10-26-8-39 4-28 23-52 50-63 28-11 60-6 82 16 21 21 26 53 15 80-11 27-35 46-64 51-14 2-28 0-41-5-15 18-37 28-61 29 7-16 10-31 8-46-11-8-21-18-30-30Z" fill="{{GRADIENT}}"/>', '<path d="M40 165c15 13 31 22 49 27-7-13-10-26-8-39 4-28 23-52 50-63 28-11 60-6 82 16 21 21 26 53 15 80-11 27-35 46-64 51-14 2-28 0-41-5-15 18-37 28-61 29 7-16 10-31 8-46-11-8-21-18-30-30Z"/>', { x: 125, y: 128, scale: 0.62 }) },
  { id: "shield", label: "盾牌", shape: pathShape("shield", "M114 12 205 45v69c0 48-35 84-91 101-56-17-91-53-91-101V45l91-33Z", { x: 114, y: 116, scale: 0.67 }) },
  { id: "capsule", label: "胶囊", shape: artwork("capsule", '<rect x="24" y="45" width="180" height="138" rx="69" fill="{{GRADIENT}}"/>', '<rect x="24" y="45" width="180" height="138" rx="69"/>', { x: 114, y: 114, scale: 0.69 }) },
  { id: "star", label: "星芒", shape: pathShape("star", "M114 13l25 58 62-7-47 42 25 58-55-30-55 30 25-58-47-42 62 7 25-58Z", { x: 114, y: 120, scale: 0.57 }) },
];

const SHAPES_BY_ID = new Map(MASCOT_SHAPES.map((entry) => [entry.id, entry.shape]));

export function mascotShape(id?: string | null): CursorShape {
  return SHAPES_BY_ID.get((id as MausShape) ?? "cursor") ?? GRADIENT_SHAPE;
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

export type MausAvatarProps = {
  color: MausColor;
  shape?: MausShape | string | null;
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
        shape={mascotShape(shape)}
        gradient={gradientFor(color)}
        title={label ?? null}
        lookAround={forward ? 0 : 1}
        gaze={{ x: (gaze?.x ?? 0) + pointer.x, y: (gaze?.y ?? 0) + pointer.y }}
        turn={turn}
        spring={spring}
        eyeScale={eyeScale}
        showMouth={showMouth}
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
