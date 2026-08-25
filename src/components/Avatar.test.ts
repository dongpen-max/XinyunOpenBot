import { describe, expect, it } from "vitest";
import { MASCOT_SHAPES, mascotShape, mascotUsesEyesOnly, PROVIDER_AVATAR_OPTIONS, isProviderAvatar, resolveAvatarShape } from "./Avatar";

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

  it("ships the Grok-inspired eight-shape basic robot set", () => {
    const base = MASCOT_SHAPES.filter(({ category }) => category === "base");

    expect(base).toHaveLength(8);
    expect(base.map(({ label }) => label)).toEqual([
      "圆润",
      "圆球",
      "方块",
      "胶囊",
      "三角",
      "晶核",
      "云团",
      "水滴",
    ]);
    expect(base.every(({ id }) => mascotUsesEyesOnly(id))).toBe(true);
    expect(base.every(({ shape }) => shape.body.includes("{{GRADIENT}}"))).toBe(true);
  });

  it("keeps animal faces unchanged and maps retired base ids", () => {
    const animals = MASCOT_SHAPES.filter(({ category }) => category === "animal");

    expect(animals.every(({ id }) => !mascotUsesEyesOnly(id))).toBe(true);
    expect(mascotShape("blob").name).toBe("drop");
    expect(mascotShape("diamond").name).toBe("crystal");
    expect(mascotShape("shield").name).toBe("crystal");
  });

  it("offers local vector marks for the major AI providers", () => {
    expect(PROVIDER_AVATAR_OPTIONS.length).toBeGreaterThanOrEqual(18);
    expect(new Set(PROVIDER_AVATAR_OPTIONS.map(({ id }) => id)).size).toBe(PROVIDER_AVATAR_OPTIONS.length);
    expect(PROVIDER_AVATAR_OPTIONS.every(({ id }) => isProviderAvatar(id))).toBe(true);
    expect(isProviderAvatar("cursor")).toBe(false);
  });

  it("keeps model and mascot avatar selections independent", () => {
    expect(resolveAvatarShape({ avatarKind: "mascot", mascotShape: "drop", modelAvatar: "model-kimi" })).toBe("drop");
    expect(resolveAvatarShape({ avatarKind: "model", mascotShape: "drop", modelAvatar: "model-kimi" })).toBe("model-kimi");
    expect(resolveAvatarShape({ mascotShape: "model-grok" })).toBe("model-grok");
  });
});
