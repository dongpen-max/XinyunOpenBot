import { describe, expect, it } from "vitest";

import { chiefOfStaffSystemPrompt } from "./chief-of-staff.ts";

describe("chiefOfStaffSystemPrompt", () => {
  const bots = [
    { id: "chief", name: "Atlas", title: "运营" },
    { id: "writer", name: "Quill", title: "写作", description: "撰写简洁文案" },
    { id: "coder", name: "Patch", title: "工程", busy: true },
    { id: "hidden", name: "Secret", hidden: true },
  ];

  it("describes visible teammates, roles, and availability", () => {
    const prompt = chiefOfStaffSystemPrompt("chief", bots, true);

    expect(prompt).toContain("唯一的总管机器人");
    expect(prompt).toContain("Quill — 写作：撰写简洁文案（可用）");
    expect(prompt).toContain("Patch — 工程（正在工作）");
    expect(prompt).not.toContain("Secret");
    expect(prompt).not.toContain("Atlas —");
    expect(prompt).toContain("ask_bot");
  });

  it("does not promise delegation when the engine lacks agent tools", () => {
    const prompt = chiefOfStaffSystemPrompt("chief", bots, false);

    expect(prompt).toContain("不能联系其他机器人");
    expect(prompt).not.toContain("使用 ask_bot");
  });
});
