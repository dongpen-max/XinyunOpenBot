import { describe, expect, it } from "vitest";

import {
  addGroupMember,
  canRemoveGroupMember,
  removeGroupMember,
} from "./group-membership";

describe("group membership editing", () => {
  it("adds a new member once while preserving member order", () => {
    expect(addGroupMember(["a", "b"], "c")).toEqual(["a", "b", "c"]);
    expect(addGroupMember(["a", "b"], "b")).toEqual(["a", "b"]);
  });

  it("normalizes duplicate member ids", () => {
    expect(addGroupMember(["a", "a", "b"], "c")).toEqual(["a", "b", "c"]);
    expect(removeGroupMember(["a", "a", "b"], "a")).toEqual(["b"]);
  });

  it("removes an existing member when another member remains", () => {
    expect(canRemoveGroupMember(["a", "b"], "a")).toBe(true);
    expect(removeGroupMember(["a", "b"], "a")).toEqual(["b"]);
  });

  it("never removes the final member", () => {
    expect(canRemoveGroupMember(["a"], "a")).toBe(false);
    expect(removeGroupMember(["a"], "a")).toEqual(["a"]);
  });
});
