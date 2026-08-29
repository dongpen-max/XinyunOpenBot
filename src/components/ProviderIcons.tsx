// Theme-safe model creator marks. Model metadata wins over relay driver kind.
import { useId } from "react";
import { Monitor } from "lucide-react";
import { cn } from "@/lib/cn";
import { inferModelVendor, type ModelVendor, type ModelVendorHint } from "@/lib/model-vendor";

export interface IconProps {
  size?: number;
  className?: string;
}

export function GrokMark({ size = 16, className }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" className={cn("fill-current text-ink", className)} aria-hidden="true">
      <path d="M9.26905 15.284L17.2479 9.36086C17.6391 9.07047 18.1981 9.18374 18.3845 9.63478C19.3655 12.0135 18.9272 14.8721 16.9755 16.8349C15.0238 18.7976 12.3082 19.228 9.8261 18.2477L7.1146 19.5102C11.0037 22.1834 15.7263 21.5223 18.6774 18.5525C21.0182 16.1985 21.7432 12.9897 21.0653 10.0961L21.0714 10.1023C20.0884 5.85143 21.3131 4.15233 23.8218 0.677913C23.8812 0.595532 23.9406 0.513151 24 0.428711L20.6987 3.74866V3.73836L9.267 15.2861" />
      <path d="M7.62249 16.7237C4.83113 14.0422 5.3124 9.89222 7.69417 7.49905C9.45541 5.72786 12.341 5.00497 14.86 6.06768L17.5653 4.81138C17.0779 4.45714 16.4533 4.07613 15.7365 3.80839C12.4966 2.46764 8.6178 3.13492 5.98413 5.78141C3.45081 8.32904 2.65415 12.2463 4.02219 15.5889C5.04412 18.0871 3.36889 19.8541 1.68137 21.6377C1.08337 22.2699 0.483318 22.9022 0 23.5716L7.62045 16.7257" />
    </svg>
  );
}

export function ClaudeMark({ size = 16, className }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 256 257" preserveAspectRatio="xMidYMid" className={cn("fill-[#d97757]", className)} aria-hidden="true">
      <path d="m50.228 170.321 50.357-28.257.843-2.463-.843-1.361h-2.462l-8.426-.518-28.775-.778-24.952-1.037-24.175-1.296-6.092-1.297L0 125.796l.583-3.759 5.12-3.434 7.324.648 16.202 1.101 24.304 1.685 17.629 1.037 26.118 2.722h4.148l.583-1.685-1.426-1.037-1.101-1.037-25.147-17.045-27.22-18.017-14.258-10.37-7.713-5.25-3.888-4.925-1.685-10.758 7-7.713 9.397.649 2.398.648 9.527 7.323 20.35 15.75L94.817 91.9l3.889 3.24 1.555-1.102.195-.777-1.75-2.917-14.453-26.118-15.425-26.572-6.87-11.018-1.814-6.61c-.648-2.723-1.102-4.991-1.102-7.778l7.972-10.823L71.42 0 82.05 1.426l4.472 3.888 6.61 15.101 10.694 23.786 16.591 32.34 4.861 9.592 2.592 8.879.973 2.722h1.685v-1.556l1.36-18.211 2.528-22.36 2.463-28.776.843-8.1 4.018-9.722 7.971-5.25 6.222 2.981 5.12 7.324-.713 4.73-3.046 19.768-5.962 30.98-3.889 20.739h2.268l2.593-2.593 10.499-13.934 17.628-22.036 7.778-8.749 9.073-9.657 5.833-4.601h11.018l8.1 12.055-3.628 12.443-11.342 14.388-9.398 12.184-13.48 18.147-8.426 14.518.778 1.166 2.01-.194 30.46-6.481 16.462-2.982 19.637-3.37 8.88 4.148.971 4.213-3.5 8.62-20.998 5.184-24.628 4.926-36.682 8.685-.454.324.519.648 16.526 1.555 7.065.389h17.304l32.21 2.398 8.426 5.574 5.055 6.805-.843 5.184-12.962 6.611-17.498-4.148-40.83-9.721-14-3.5h-1.944v1.167l11.666 11.406 21.387 19.314 26.767 24.887 1.36 6.157-3.434 4.86-3.63-.518-23.526-17.693-9.073-7.972-20.545-17.304h-1.36v1.814l4.73 6.935 25.017 37.59 1.296 11.536-1.814 3.76-6.481 2.268-7.13-1.297-14.647-20.544-15.1-23.138-12.185-20.739-1.49.843-7.194 77.448-3.37 3.953-7.778 2.981-6.48-4.925-3.436-7.972 3.435-15.749 4.148-20.544 3.37-16.333 3.046-20.285 1.815-6.74-.13-.454-1.49.194-15.295 20.999-23.267 31.433-18.406 19.702-4.407 1.75-7.648-3.954.713-7.064 4.277-6.286 25.47-32.405 15.36-20.092 9.917-11.6-.065-1.686h-.583L44.07 198.125l-12.055 1.555-5.185-4.86.648-7.972 2.463-2.593 20.35-13.999-.064.065Z" />
    </svg>
  );
}

export function CodexMark({ size = 16, className }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 256 260" preserveAspectRatio="xMidYMid" className={cn("fill-current text-ink", className)} aria-hidden="true">
      <path d="M239.184 106.203a64.716 64.716 0 0 0-5.576-53.103C219.452 28.459 191 15.784 163.213 21.74A65.586 65.586 0 0 0 52.096 45.22a64.716 64.716 0 0 0-43.23 31.36c-14.31 24.602-11.061 55.634 8.033 76.74a64.665 64.665 0 0 0 5.525 53.102c14.174 24.65 42.644 37.324 70.446 31.36a64.72 64.72 0 0 0 48.754 21.744c28.481.025 53.714-18.361 62.414-45.481a64.767 64.767 0 0 0 43.229-31.36c14.137-24.558 10.875-55.423-8.083-76.483Zm-97.56 136.338a48.397 48.397 0 0 1-31.105-11.255l1.535-.87 51.67-29.825a8.595 8.595 0 0 0 4.247-7.367v-72.85l21.845 12.636c.218.111.37.32.409.563v60.367c-.056 26.818-21.783 48.545-48.601 48.601Zm-104.466-44.61a48.345 48.345 0 0 1-5.781-32.589l1.534.921 51.722 29.826a8.339 8.339 0 0 0 8.441 0l63.181-36.425v25.221a.87.87 0 0 1-.358.665l-52.335 30.184c-23.257 13.398-52.97 5.431-66.404-17.803ZM23.549 85.38a48.499 48.499 0 0 1 25.58-21.333v61.39a8.288 8.288 0 0 0 4.195 7.316l62.874 36.272-21.845 12.636a.819.819 0 0 1-.767 0L41.353 151.53c-23.211-13.454-31.171-43.144-17.804-66.405v.256Zm179.466 41.695-63.08-36.63L161.73 77.86a.819.819 0 0 1 .768 0l52.233 30.184a48.6 48.6 0 0 1-7.316 87.635v-61.391a8.544 8.544 0 0 0-4.4-7.213Zm21.742-32.69-1.535-.922-51.619-30.081a8.39 8.39 0 0 0-8.492 0L99.98 99.808V74.587a.716.716 0 0 1 .307-.665l52.233-30.133a48.652 48.652 0 0 1 72.236 50.391v.205ZM88.061 139.097l-21.845-12.585a.87.87 0 0 1-.41-.614V65.685a48.652 48.652 0 0 1 79.757-37.346l-1.535.87-51.67 29.825a8.595 8.595 0 0 0-4.246 7.367l-.051 72.697Zm11.868-25.58 28.138-16.217 28.188 16.218v32.434l-28.086 16.218-28.188-16.218-.052-32.434Z" />
    </svg>
  );
}

export function GeminiMark({ size = 16, className }: IconProps) {
  const gradientId = useId().replace(/:/g, "");
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" className={className} aria-hidden="true">
      <defs>
        <linearGradient id={gradientId} x1="3" y1="21" x2="21" y2="3" gradientUnits="userSpaceOnUse">
          <stop stopColor="#246FDB" />
          <stop offset="0.48" stopColor="#A04BEB" />
          <stop offset="1" stopColor="#E95C9E" />
        </linearGradient>
      </defs>
      <path fill={`url(#${gradientId})`} d="M12 1.5c.58 5.83 4.67 9.92 10.5 10.5-5.83.58-9.92 4.67-10.5 10.5C11.42 16.67 7.33 12.58 1.5 12 7.33 11.42 11.42 7.33 12 1.5Z" />
    </svg>
  );
}

export function DeepSeekMark({ size = 16, className }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" className={className} aria-hidden="true">
      <path fill="#4D6BFE" d="M2.2 13.2c1.75.22 3.2-.2 4.33-1.24.2-.18.5-.2.72-.04 1.24.9 2.7 1.38 4.37 1.42 3.04.08 5.58-1.12 7.64-3.61.26-.32.77-.23.91.15.46 1.25.3 2.64-.47 4.16-1.53 3.04-4.2 4.8-7.74 5.3-3.97.56-7.17-.68-9.61-3.73-.56-.7-.96-1.42-1.2-2.16-.1-.32.24-.65.57-.46.14.08.3.15.48.2Z" />
      <path fill="#4D6BFE" d="M16.9 9.2c.63-1.73 1.87-2.85 3.72-3.35.4-.1.78.22.71.63-.18 1.15-.8 2.2-1.88 3.14a.65.65 0 0 1-.65.12l-1.57-.5a.55.55 0 0 1-.33-.04Z" />
      <circle cx="15.75" cy="12.4" r=".78" fill="white" />
    </svg>
  );
}

export function ZhipuMark({ size = 16, className }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" className={className} aria-hidden="true">
      <path fill="#315CEC" d="M4 3h8.4c4.75 0 7.6 2.55 7.6 6.45 0 2.72-1.42 4.75-4.03 5.73L20.3 21h-5.1l-5.45-7.55h2.7c1.88 0 3.05-1.25 3.05-3.02 0-1.8-1.2-2.93-3.2-2.93H8.5V21H4V3Z" />
    </svg>
  );
}

export function QwenMark({ size = 16, className }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" className={className} aria-hidden="true">
      <g fill="none" stroke="#6C55F9" strokeWidth="2.2" strokeLinecap="round">
        <path d="M12 3.1a8.9 8.9 0 1 0 6.3 2.6" />
        <path d="M20.9 12a8.9 8.9 0 0 0-2.6-6.3M12 7.2a4.8 4.8 0 1 0 4.8 4.8" />
      </g>
      <circle cx="18.35" cy="5.65" r="1.75" fill="#32B6FF" />
    </svg>
  );
}

export function MoonshotMark({ size = 16, className }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" className={className} aria-hidden="true">
      <path className="fill-current text-ink" d="M15.7 2.2A9.9 9.9 0 1 0 21.8 15 8.15 8.15 0 0 1 15.7 2.2Z" />
      <circle cx="17.8" cy="6.2" r="1.15" fill="#6C55F9" />
    </svg>
  );
}

export function OpenCodeMark({ size = 16, className }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" className={cn("fill-none stroke-current text-ink", className)} aria-hidden="true">
      <path d="m8 4-6 8 6 8M16 4l6 8-6 8M14 5l-4 14" strokeWidth="2.1" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function ComputerMark({ size = 16, className }: IconProps) {
  return <Monitor size={size} className={cn("text-ink-secondary", className)} />;
}

export interface ProviderMarkProps extends IconProps, ModelVendorHint {
  vendor?: ModelVendor;
}

export function ProviderMark({ vendor, size, className, ...hint }: ProviderMarkProps) {
  const resolved = vendor ?? inferModelVendor(hint);
  switch (resolved) {
    case "openai":
      return <CodexMark size={size} className={className} />;
    case "anthropic":
      return <ClaudeMark size={size} className={className} />;
    case "google":
      return <GeminiMark size={size} className={className} />;
    case "xai":
      return <GrokMark size={size} className={className} />;
    case "deepseek":
      return <DeepSeekMark size={size} className={className} />;
    case "zhipu":
      return <ZhipuMark size={size} className={className} />;
    case "qwen":
      return <QwenMark size={size} className={className} />;
    case "moonshot":
      return <MoonshotMark size={size} className={className} />;
    case "opencode":
      return <OpenCodeMark size={size} className={className} />;
    case "computer":
      return <ComputerMark size={size} className={className} />;
    default:
      return <span className="text-[11px] font-semibold text-ink-secondary">??</span>;
  }
}
