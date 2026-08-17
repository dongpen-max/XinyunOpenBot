// Keep protocol logs useful for debugging without persisting live credentials.

const SECRET_KEY_PARTS = [
  "token",
  "secret",
  "password",
  "passwd",
  "apikey",
  "api_key",
  "authorization",
  "auth_token",
];

function isSecretName(name: string): boolean {
  const lower = name.toLowerCase();
  if (SECRET_KEY_PARTS.some((part) => lower.includes(part))) return true;
  return /(^|[_.-])keys?$/.test(lower);
}

const mask = (value: string) => `«redacted ${value.length} chars»`;

/**
 * Deep-copy protocol data while masking credential values. Supports ordinary
 * object env maps and the ACP wire form (`env: [{ name, value }]`).
 */
export function redactSecrets(input: unknown, depth = 0): unknown {
  if (depth > 12 || input === null || typeof input !== "object") return input;

  if (Array.isArray(input)) {
    return input.map((item) => {
      if (
        item !== null &&
        typeof item === "object" &&
        !Array.isArray(item) &&
        typeof (item as { name?: unknown }).name === "string" &&
        typeof (item as { value?: unknown }).value === "string"
      ) {
        const entry = item as { name: string; value: string };
        return isSecretName(entry.name) ? { ...entry, value: mask(entry.value) } : entry;
      }
      return redactSecrets(item, depth + 1);
    });
  }

  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(input as Record<string, unknown>)) {
    if (typeof value === "string" && isSecretName(key)) {
      out[key] = mask(value);
    } else {
      out[key] = redactSecrets(value, depth + 1);
    }
  }
  return out;
}
