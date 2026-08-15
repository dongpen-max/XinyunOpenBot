import { describe, expect, it } from "vitest";
import { MASCOT_SHAPES, mascotShape } from "./Avatar";

describe("mascot shape catalogue", () => {
  it("contains unique and resolvable shape ids", () => {
    const ids = MASCOT_SHAPES.map(({ id }) => id);

    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) expect(mascotShape(id).name).toBe(id);
  });

  it("ships a distinct animal collection compatible with the gradient engine", () => {
    const animals = MASCOT_SHAPES.filter(({ category }) => category === "animal");

    expect(animals).toHaveLength(8);
    for (const { shape } of animals) {
      expect(shape.body).toContain("{{GRADIENT}}");
      expect(shape.clip.trim().length).toBeGreaterThan(20);
      expect(shape.anchor.scale).toBeGreaterThan(0.45);
      expect(shape.anchor.scale).toBeLessThan(0.75);
    }
  });
});
