import type { Bot, Group, GroupDefaultResponder } from "@/state/store";

/** Be defensive around rooms loaded while an older server is still running,
 * and around a lead removed by another client before the group patch arrives. */
export function effectiveDefaultResponder(group: Group, members: Bot[]): GroupDefaultResponder {
  const value = group.defaultResponder;
  if (value?.kind === "everyone" || value?.kind === "mentions") return value;
  if (value?.kind === "member" && members.some((member) => member.id === value.botId)) return value;
  return members[0] ? { kind: "member", botId: members[0].id } : { kind: "mentions" };
}

export function defaultResponderName(group: Group, members: Bot[]): string | null {
  const value = effectiveDefaultResponder(group, members);
  if (value.kind !== "member") return null;
  return members.find((member) => member.id === value.botId)?.name ?? null;
}

export function groupResponseHint(group: Group, members: Bot[]): string {
  if (group.dm) return "在这里回复以继续机器人之间的对话。";
  const value = effectiveDefaultResponder(group, members);
  if (value.kind === "everyone") return "默认由所有机器人响应；也可以 @提及指定机器人。";
  if (value.kind === "mentions") return "使用 @提及机器人后，它才会参与对话。";
  const name = defaultResponderName(group, members) ?? "主机器人";
  return `默认由 ${name} 响应；@提及其他机器人可以临时切换。`;
}

export function groupComposerHint(group: Group, members: Bot[]): string {
  if (group.dm) return "继续机器人对话";
  const value = effectiveDefaultResponder(group, members);
  if (value.kind === "everyone") return "所有机器人都会响应";
  if (value.kind === "mentions") return "使用 @提及机器人";
  return `默认由 ${defaultResponderName(group, members) ?? "主机器人"} 响应`;
}
