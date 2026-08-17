export const APP_THEME_STORAGE_KEY = "xinyunopen-app-theme";

export type AppThemeId = "midnight" | "black" | "slate" | "violet" | "forest" | "white" | "custom";

export interface AppThemePreference {
  id: AppThemeId;
  customColor: string;
}

export interface AppThemeOption {
  id: Exclude<AppThemeId, "custom">;
  label: string;
  description: string;
  preview: string;
}

export const APP_THEME_OPTIONS: AppThemeOption[] = [
  { id: "midnight", label: "心云蓝", description: "品牌默认", preview: "#071426" },
  { id: "black", label: "经典黑", description: "高对比", preview: "#070707" },
  { id: "slate", label: "雾霭灰", description: "中性柔和", preview: "#10151d" },
  { id: "violet", label: "星夜紫", description: "沉静紫调", preview: "#161126" },
  { id: "forest", label: "松林绿", description: "低饱和绿", preview: "#0c1815" },
  { id: "white", label: "纯净白", description: "明亮简洁", preview: "#ffffff" },
];

const DEFAULT_PREFERENCE: AppThemePreference = { id: "midnight", customColor: "#315f9b" };
const HEX_COLOR = /^#[0-9a-f]{6}$/i;

function normalizePreference(value: unknown): AppThemePreference {
  if (!value || typeof value !== "object") return DEFAULT_PREFERENCE;
  const input = value as Partial<AppThemePreference>;
  const ids: AppThemeId[] = ["midnight", "black", "slate", "violet", "forest", "white", "custom"];
  const id = ids.includes(input.id as AppThemeId) ? (input.id as AppThemeId) : DEFAULT_PREFERENCE.id;
  const customColor = typeof input.customColor === "string" && HEX_COLOR.test(input.customColor)
    ? input.customColor.toLowerCase()
    : DEFAULT_PREFERENCE.customColor;
  return { id, customColor };
}

export function readAppTheme(): AppThemePreference {
  try {
    return normalizePreference(JSON.parse(localStorage.getItem(APP_THEME_STORAGE_KEY) ?? "null"));
  } catch {
    return DEFAULT_PREFERENCE;
  }
}

function hexToRgb(hex: string): [number, number, number] {
  const value = Number.parseInt(hex.slice(1), 16);
  return [(value >> 16) & 255, (value >> 8) & 255, value & 255];
}

function rgbToHex(rgb: [number, number, number]): string {
  return `#${rgb.map((channel) => Math.round(channel).toString(16).padStart(2, "0")).join("")}`;
}

/** Mix toward target; amount=0 keeps source, amount=1 becomes target. */
export function mixHex(source: string, target: string, amount: number): string {
  const a = hexToRgb(source);
  const b = hexToRgb(target);
  return rgbToHex(a.map((channel, index) => channel + (b[index] - channel) * amount) as [number, number, number]);
}

function customPalette(color: string): Record<string, string> {
  return {
    "--color-app": mixHex(color, "#03060b", 0.76),
    "--color-panel": mixHex(color, "#07101d", 0.65),
    "--color-inset": mixHex(color, "#050b13", 0.70),
    "--color-card": mixHex(color, "#0b1422", 0.55),
    "--color-raised": mixHex(color, "#172235", 0.45),
    "--color-raised-hover": mixHex(color, "#24334b", 0.34),
    "--color-hairline": mixHex(color, "#4a5870", 0.38),
    "--color-bubble-assistant": mixHex(color, "#0b1422", 0.55),
    "--color-bubble-user": mixHex(color, "#657590", 0.30),
    "--color-accent": mixHex(color, "#8bc4ff", 0.42),
    "--color-accent-border": mixHex(color, "#c0dcff", 0.58),
  };
}

function clearCustomPalette(root: HTMLElement) {
  for (const property of Object.keys(customPalette(DEFAULT_PREFERENCE.customColor))) {
    root.style.removeProperty(property);
  }
}

export function applyAppTheme(preference: AppThemePreference, persist = true): AppThemePreference {
  const next = normalizePreference(preference);
  const root = document.documentElement;
  clearCustomPalette(root);
  root.dataset.appTheme = next.id;

  if (next.id === "custom") {
    for (const [property, value] of Object.entries(customPalette(next.customColor))) {
      root.style.setProperty(property, value);
    }
  }

  syncWindowTitleBarColor("app");

  if (persist) localStorage.setItem(APP_THEME_STORAGE_KEY, JSON.stringify(next));
  return next;
}

export function syncWindowTitleBarColor(surface: "app" | "panel" = "app") {
  const property = surface === "panel" ? "--color-panel" : "--color-app";
  const fallback = surface === "panel" ? "#0d1b31" : "#071426";
  const color = getComputedStyle(document.documentElement).getPropertyValue(property).trim() || fallback;
  void window.ogb?.setTitleBarColor?.(color);
}

export function initializeAppTheme(): AppThemePreference {
  return applyAppTheme(readAppTheme(), false);
}
