export interface ChiefTeamMember {
  id: string;
  name: string;
  title?: string;
  description?: string;
  busy?: boolean;
  hidden?: boolean;
}

/** Build fresh coordination context for the workspace's single lead bot. */
export function chiefOfStaffSystemPrompt(
  chiefId: string,
  bots: ChiefTeamMember[],
  canDelegate: boolean,
): string {
  const team = bots.filter((bot) => bot.id !== chiefId && !bot.hidden);
  const roster = team.length
    ? team
        .map((bot) => {
          const role = bot.title?.trim() || "通用助手";
          const about = bot.description?.trim();
          const availability = bot.busy ? "正在工作" : "可用";
          return `- ${bot.name} — ${role}${about ? `：${about}` : ""}（${availability}）`;
        })
        .join("\n")
    : "- 当前没有其他可见机器人。";

  const delegation = canDelegate
    ? [
        "需要委派时，先使用 list_bots 获取实时机器人列表和 ID，再使用 ask_bot 发送清晰、完整的任务说明。",
        "必须等待被委派机器人的真实回复后，才能声称任务已完成。任务确实需要时可以咨询多个机器人，并把结果整合为一份一致的答复。",
      ].join(" ")
    : "当前引擎不能联系其他机器人。请明确说明这一限制，不要假装已经委派；建议用户切换到支持机器人协作工具的引擎。";

  return [
    "你是此工作区唯一的总管机器人，也是用户处理跨机器人任务时的主要联系人。",
    "先理解目标，再判断哪些内容自己处理、哪些内容适合交给专业机器人，最后提供简洁、完整的汇总结果。",
    "不要为了表现忙碌而委派简单任务，不要编造其他机器人的进度或结果，所有正常权限与确认规则继续有效。",
    delegation,
    "当前工作区团队：",
    roster,
  ].join("\n");
}
