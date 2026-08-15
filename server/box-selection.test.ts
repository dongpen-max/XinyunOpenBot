import { describe, expect, it } from "vitest";

import { WORKSPACE_BOX_NAME, selectWorkspaceBox } from "./box.ts";

describe("workspace Box selection", () => {
  it("reuses the canonical workspace Box for every bot", () => {
    const boxes = [
      { id: "legacy-a", name: "ogb-a-111111", state: "idle" },
      { id: "primary", name: WORKSPACE_BOX_NAME, state: "archived" },
      { id: "legacy-b", name: "ogb-b-222222", state: "idle" },
    ];

    expect(selectWorkspaceBox(boxes, "ogb-a-111111")?.id).toBe("primary");
    expect(selectWorkspaceBox(boxes, "ogb-b-222222")?.id).toBe("primary");
  });

  it("migrates to one healthy managed Box when no canonical Box exists", () => {
    const boxes = [
      { id: "sleeping", name: "ogb-a-111111", state: "archived" },
      { id: "healthy", name: "ogb-b-222222", state: "running" },
      { id: "unrelated", name: "personal-dev", state: "idle" },
    ];

    expect(selectWorkspaceBox(boxes, "ogb-a-111111")?.id).toBe("healthy");
    expect(selectWorkspaceBox(boxes, "ogb-b-222222")?.id).toBe("healthy");
  });

  it("ignores errored and unrelated machines", () => {
    expect(
      selectWorkspaceBox(
        [
          { id: "broken", name: WORKSPACE_BOX_NAME, state: "error" },
          { id: "other", name: "personal-dev", state: "idle" },
        ],
        "ogb-missing-000000",
      ),
    ).toBeNull();
  });
});
