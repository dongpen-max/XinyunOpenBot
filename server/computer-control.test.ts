import { describe, expect, it } from "vitest";
import { COMPUTER_CONTROL_REFUSAL, ComputerControl, computerControlRefusal } from "./computer-control.ts";

describe("ComputerControl", () => {
  it("takes and releases the wheel without losing an open help request", () => {
    const control = new ComputerControl();
    const asked = control.requestHelp("bot", "请完成登录");
    expect(asked.helpReason).toBe("请完成登录");
    expect(control.take("bot").held).toBe(true);
    expect(control.release("bot")).toMatchObject({ held: false, helpReason: null });
  });

  it("does not let an old request expire a newer one", () => {
    const control = new ComputerControl();
    const first = control.requestHelp("bot", "first");
    control.dismissHelp("bot");
    const second = control.requestHelp("bot", "second");
    expect(control.expireHelp("bot", first.requestId!)).toMatchObject({ helpReason: "second" });
    expect(second.requestId).not.toBe(first.requestId);
  });

  it("rejects server-side computer input throughout a human takeover", () => {
    const control = new ComputerControl();
    expect(computerControlRefusal(control.snapshot("bot"))).toBeNull();
    expect(computerControlRefusal(control.take("bot"))).toBe(COMPUTER_CONTROL_REFUSAL);
    expect(computerControlRefusal(control.release("bot"))).toBeNull();
  });
});
