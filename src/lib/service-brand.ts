export interface ServiceBrand {
  monogram: string;
  background: string;
  foreground: string;
}

const SERVICE_BRANDS: Record<string, ServiceBrand> = {
  slack: { monogram: "#", background: "#4A154B", foreground: "#FFFFFF" },
  github: { monogram: "GH", background: "#181717", foreground: "#FFFFFF" },
  gmail: { monogram: "M", background: "#EA4335", foreground: "#FFFFFF" },
  googlecalendar: { monogram: "31", background: "#4285F4", foreground: "#FFFFFF" },
  googlesheets: { monogram: "S", background: "#0F9D58", foreground: "#FFFFFF" },
  googledocs: { monogram: "D", background: "#4285F4", foreground: "#FFFFFF" },
  googledrive: { monogram: "△", background: "#FFFFFF", foreground: "#1A73E8" },
  notion: { monogram: "N", background: "#FFFFFF", foreground: "#111111" },
  linear: { monogram: "L", background: "#5E6AD2", foreground: "#FFFFFF" },
  sentry: { monogram: "S", background: "#362D59", foreground: "#FFFFFF" },
  posthog: { monogram: "PH", background: "#F9BD2B", foreground: "#1D1F27" },
  discord: { monogram: "D", background: "#5865F2", foreground: "#FFFFFF" },
  x: { monogram: "X", background: "#000000", foreground: "#FFFFFF" },
  twitter: { monogram: "X", background: "#000000", foreground: "#FFFFFF" },
  reddit: { monogram: "R", background: "#FF4500", foreground: "#FFFFFF" },
  zapier: { monogram: "✱", background: "#FF4F00", foreground: "#FFFFFF" },
  hubspot: { monogram: "H", background: "#FF7A59", foreground: "#FFFFFF" },
  salesforce: { monogram: "SF", background: "#00A1E0", foreground: "#FFFFFF" },
  jira: { monogram: "J", background: "#0052CC", foreground: "#FFFFFF" },
  asana: { monogram: "A", background: "#F06A6A", foreground: "#FFFFFF" },
  trello: { monogram: "T", background: "#0079BF", foreground: "#FFFFFF" },
  dropbox: { monogram: "DB", background: "#0061FF", foreground: "#FFFFFF" },
  airtable: { monogram: "A", background: "#18BFFF", foreground: "#FFFFFF" },
  figma: { monogram: "F", background: "#A259FF", foreground: "#FFFFFF" },
  stripe: { monogram: "S", background: "#635BFF", foreground: "#FFFFFF" },
};

export function serviceBrand(slug: string, label: string): ServiceBrand {
  const normalized = slug.toLowerCase().replace(/[^a-z0-9]/g, "");
  return SERVICE_BRANDS[normalized] ?? {
    monogram: label.trim().slice(0, 2).toUpperCase() || "?",
    background: "var(--color-raised)",
    foreground: "var(--color-ink-secondary)",
  };
}
