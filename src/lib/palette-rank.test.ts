import { describe, expect, it } from "vitest";
import { rankByName } from "./palette-rank";

describe("rankByName", () => {
  it("ranks prefix matches before substring matches", () => {
    const items = [{ name: "Big Momo" }, { name: "Momo" }, { name: "Lemon Momo" }];
    expect(rankByName(items, "mo").map((item) => item.name)).toEqual(["Momo", "Big Momo", "Lemon Momo"]);
  });

  it("matches case-insensitively and preserves order within tiers", () => {
    const items = [{ name: "MOSS" }, { name: "quiet moss" }, { name: "Other" }];
    expect(rankByName(items, "Moss").map((item) => item.name)).toEqual(["MOSS", "quiet moss"]);
  });
});
