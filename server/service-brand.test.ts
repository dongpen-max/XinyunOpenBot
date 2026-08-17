import { describe, expect, it } from "vitest";
import { serviceBrand } from "../src/lib/service-brand.ts";

describe("serviceBrand", () => {
  it.each([
    ["slack", "#"],
    ["github", "GH"],
    ["gmail", "M"],
    ["google_calendar", "31"],
    ["google-sheets", "S"],
    ["notion", "N"],
  ])("provides a visible local fallback for %s", (slug, monogram) => {
    const brand = serviceBrand(slug, "Service");
    expect(brand.monogram).toBe(monogram);
    expect(brand.background).toBeTruthy();
    expect(brand.foreground).toBeTruthy();
  });

  it("uses a deterministic label fallback for unknown catalog entries", () => {
    expect(serviceBrand("future-tool", "Future Tool").monogram).toBe("FU");
  });
});
