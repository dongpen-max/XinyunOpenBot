import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const groupView = readFileSync(new URL("../components/GroupView.tsx", import.meta.url), "utf8");
const sidebar = readFileSync(new URL("../components/Sidebar.tsx", import.meta.url), "utf8");
const styles = readFileSync(new URL("../styles.css", import.meta.url), "utf8");

describe("Grok-inspired conversation layout", () => {
  it("keeps group sender avatars in a dedicated 30px message gutter", () => {
    expect(groupView).toContain("function SenderAvatar");
    expect(groupView).toContain('size={30}');
    expect(groupView).toContain('className={cn("group flex w-full items-start gap-2.5"');
    expect(groupView).not.toContain("function ClusterLabel");
  });

  it("collapses the group header to a three-avatar stack with an overflow count", () => {
    expect(groupView).toContain("function GroupHeaderAvatars");
    expect(groupView).toContain("members.slice(0, compact ? 2 : 3)");
    expect(groupView).toContain("+{extra}");
  });

  it("uses a wider bounded conversation rail and restrained press feedback", () => {
    expect(styles).toMatch(/\.conversation-content\s*{[^}]*1120px/s);
    expect(styles).toMatch(/\.ui-pressable:active:not\(:disabled\)[^{]*{[^}]*scale\(0\.985\)/s);
    expect(sidebar.match(/ui-pressable/g)?.length).toBeGreaterThanOrEqual(4);
  });
});
