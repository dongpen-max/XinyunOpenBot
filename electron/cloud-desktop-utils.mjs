export const CLOUD_DESKTOP_TITLEBAR_HEIGHT = 46;
export const CLOUD_DESKTOP_MIN_WIDTH = 320;
export const CLOUD_DESKTOP_MIN_HEIGHT = 180;

const BOT_ID = /^[A-Za-z0-9_-]{1,128}$/;

export function isValidCloudDesktopBotId(value) {
  return typeof value === "string" && BOT_ID.test(value);
}

export function parseCloudDesktopUrl(value) {
  if (typeof value !== "string" || !value) return null;
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" || url.username || url.password) return null;
    return url;
  } catch {
    return null;
  }
}

/** Force noVNC to scale the complete remote framebuffer into the embedded
 * viewport. `remote` can leave a larger desktop than the available panel on
 * HiDPI Windows displays, which makes the bottom taskbar scroll out of view. */
export function prepareCloudDesktopUrl(value) {
  const url = parseCloudDesktopUrl(value);
  if (!url) return null;
  url.searchParams.set("resize", "scale");
  return url;
}

export function isAllowedCloudDesktopNavigation(value, allowedOrigins) {
  const url = parseCloudDesktopUrl(value);
  return Boolean(url && allowedOrigins.has(url.origin));
}

function finiteInteger(value) {
  return typeof value === "number" && Number.isFinite(value) ? Math.round(value) : null;
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

export function sanitizeCloudDesktopBounds(bounds, viewport) {
  if (!bounds || !viewport) return null;
  const raw = {
    x: finiteInteger(bounds.x),
    y: finiteInteger(bounds.y),
    width: finiteInteger(bounds.width),
    height: finiteInteger(bounds.height),
  };
  const viewportWidth = finiteInteger(viewport.width);
  const viewportHeight = finiteInteger(viewport.height);
  if (Object.values(raw).some((value) => value === null) || !viewportWidth || !viewportHeight) return null;

  const x = clamp(raw.x, 0, Math.max(0, viewportWidth - 1));
  const y = clamp(
    raw.y,
    CLOUD_DESKTOP_TITLEBAR_HEIGHT,
    Math.max(CLOUD_DESKTOP_TITLEBAR_HEIGHT, viewportHeight - 1),
  );
  const availableWidth = Math.max(1, viewportWidth - x);
  const availableHeight = Math.max(1, viewportHeight - y);
  const minWidth = Math.min(CLOUD_DESKTOP_MIN_WIDTH, availableWidth);
  const minHeight = Math.min(CLOUD_DESKTOP_MIN_HEIGHT, availableHeight);

  return {
    x,
    y,
    width: clamp(raw.width, minWidth, availableWidth),
    height: clamp(raw.height, minHeight, availableHeight),
  };
}

export function sanitizeCloudDesktopError(value, fallback = "云端桌面连接失败，请重新连接") {
  const raw = value instanceof Error ? value.message : typeof value === "string" ? value : "";
  const clean = raw
    .replace(/https?:\/\/[^\s"'<>]+/gi, "[已隐藏链接]")
    .replace(/\b(token|access_token|stream_token|key|secret)=([^\s&]+)/gi, "$1=[已隐藏]")
    .replace(/\b(?:Bearer\s+)?[A-Za-z0-9_-]{32,}\b/g, "[已隐藏凭据]")
    .replace(/[\r\n\t]+/g, " ")
    .replace(/\s{2,}/g, " ")
    .trim()
    .slice(0, 180);
  if (!clean) return fallback;
  return `${fallback}：${clean}`;
}
