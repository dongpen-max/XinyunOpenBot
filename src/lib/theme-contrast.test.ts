import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const css = readFileSync(new URL("../styles.css", import.meta.url), "utf8");

function themeTokens(theme: string): Record<string, string> {
  const selector = `:root[data-app-theme="${theme}"]`;
  const start = css.indexOf(selector);
  expect(start, `missing ${selector}`).toBeGreaterThanOrEqual(0);
  const open = css.indexOf("{", start);
  const close = css.indexOf("}", open);
  const entries = [...css.slice(open + 1, close).matchAll(/(--[\w-]+):\s*([^;]+);/g)];
  return Object.fromEntries(entries.map((entry) => [entry[1], entry[2].trim()]));
}

function rgb(hex: string): [number, number, number] {
  expect(hex).toMatch(/^#[0-9a-f]{6}$/i);
  const value = Number.parseInt(hex.slice(1), 16);
  return [(value >> 16) & 255, (value >> 8) & 255, value & 255];
}

function luminance(hex: string): number {
  const channels = rgb(hex).map((channel) => {
    const value = channel / 255;
    return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2];
}

function contrast(a: string, b: string): number {
  const [lighter, darker] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (lighter + 0.05) / (darker + 0.05);
}

function composite(foreground: string, background: string, alpha: number): string {
  const fg = rgb(foreground);
  const bg = rgb(background);
  return `#${fg
    .map((channel, index) => Math.round(channel * alpha + bg[index] * (1 - alpha)).toString(16).padStart(2, "0"))
    .join("")}`;
}

describe("pure-white theme contrast", () => {
  const white = themeTokens("white");

  it("keeps primary and secondary text at WCAG AA contrast", () => {
    expect(contrast(white["--color-ink"], white["--color-app"])).toBeGreaterThanOrEqual(7);
    expect(contrast(white["--color-ink-secondary"], white["--color-app"])).toBeGreaterThanOrEqual(4.5);
  });

  it("uses distinct transcript, panel, card, and inset surfaces", () => {
    expect(white["--color-bubble-assistant"]).not.toBe(white["--color-app"]);
    expect(white["--color-panel"]).not.toBe(white["--color-card"]);
    expect(white["--color-inset"]).not.toBe(white["--color-card"]);
    expect(white["--color-bubble-user"]).not.toBe(white["--color-bubble-assistant"]);
  });

  it("keeps translucent shared hairlines visible on white cards", () => {
    const border = composite(white["--color-hairline"], white["--color-card"], 0.35);
    expect(contrast(border, white["--color-card"])).toBeGreaterThanOrEqual(1.35);
  });

  it("routes every assistant reply through the semantic message surface", () => {
    const chat = readFileSync(new URL("../components/ChatView.tsx", import.meta.url), "utf8");
    const group = readFileSync(new URL("../components/GroupView.tsx", import.meta.url), "utf8");
    expect(chat).not.toMatch(/assistant-message-width[^"\n]*bg-card/);
    expect(group).not.toMatch(/assistant-message-width[^"\n]*bg-card/);
    expect(chat.match(/assistant-message-surface/g)?.length).toBeGreaterThanOrEqual(3);
    expect(group.match(/assistant-message-surface/g)?.length).toBeGreaterThanOrEqual(2);
  });
});

describe("assistant message surface coverage", () => {
  it("keeps assistant replies separate from the transcript canvas in every built-in theme", () => {
    for (const theme of ["midnight", "black", "slate", "violet", "forest", "white"]) {
      const tokens = themeTokens(theme);
      expect(tokens["--color-bubble-assistant"], theme).toBeTruthy();
      expect(tokens["--color-bubble-assistant"], theme).not.toBe(tokens["--color-app"]);
    }
  });

  it("includes the assistant surface in generated custom palettes", () => {
    const themeSource = readFileSync(new URL("./theme.ts", import.meta.url), "utf8");
    expect(themeSource).toContain('"--color-bubble-assistant"');
  });
});
