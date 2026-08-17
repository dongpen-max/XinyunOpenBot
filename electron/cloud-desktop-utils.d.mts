export const CLOUD_DESKTOP_TITLEBAR_HEIGHT: number;
export const CLOUD_DESKTOP_MIN_WIDTH: number;
export const CLOUD_DESKTOP_MIN_HEIGHT: number;

export function isValidCloudDesktopBotId(value: unknown): value is string;
export function parseCloudDesktopUrl(value: unknown): URL | null;
export function prepareCloudDesktopUrl(value: unknown): URL | null;
export function isAllowedCloudDesktopNavigation(value: unknown, allowedOrigins: ReadonlySet<string>): boolean;
export function sanitizeCloudDesktopBounds(
  bounds: { x: unknown; y: unknown; width: unknown; height: unknown } | null | undefined,
  viewport: { width: unknown; height: unknown } | null | undefined,
): { x: number; y: number; width: number; height: number } | null;
export function sanitizeCloudDesktopError(value: unknown, fallback?: string): string;
