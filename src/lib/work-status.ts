type ComputerActivityState = "checking" | "reusing" | "creating" | "waking" | "initializing" | "ready";

interface WorkBot {
  busy?: boolean;
}

interface WorkMessage {
  kind: string;
  card?: { requestId?: string; answered?: string; dismissed?: boolean; title?: string };
  tool?: { name: string; ok?: boolean };
}

export interface WorkStatus {
  kind: "connecting" | "thinking" | "writing" | "tool" | "computer" | "waiting";
  label: string;
  detail?: string;
}

const COMPUTER_TOOL = /computer|screenshot|click|type_text|press_key|scroll|open_url|browser|desktop/i;

const computerLabels: Record<Exclude<ComputerActivityState, "ready">, string> = {
  checking: "正在检查云端电脑",
  reusing: "正在复用现有云端 Box",
  creating: "正在创建云端 Box",
  waking: "正在唤醒云端 Box",
  initializing: "正在初始化操作工具",
};

export function readableToolName(raw: string): string {
  const bare = raw.replace(/^mcp__[^_]+__/, "").replace(/^computer_/, "").replaceAll("_", " ").trim();
  const known: Record<string, string> = {
    screenshot: "读取屏幕",
    click: "点击界面",
    "type text": "输入文字",
    "press key": "按下按键",
    scroll: "滚动页面",
    "open url": "打开网页",
    bash: "运行命令",
    shell: "运行命令",
    execute: "运行命令",
    "run command": "运行命令",
  };
  return known[bare.toLowerCase()] ?? bare;
}

export function deriveWorkStatus({
  bot,
  messages,
  streaming,
  reasoning,
  computerActivity,
}: {
  bot: WorkBot;
  messages: WorkMessage[];
  streaming?: string;
  reasoning?: string;
  computerActivity?: ComputerActivityState;
}): WorkStatus | null {
  if (!bot.busy) return null;

  const pendingRequest = [...messages]
    .reverse()
    .find((message) => message.kind === "options" && message.card?.requestId && !message.card.answered && !message.card.dismissed);
  if (pendingRequest) {
    return { kind: "waiting", label: "等待你的确认", detail: pendingRequest.card?.title };
  }

  if (computerActivity && computerActivity !== "ready") {
    return { kind: "computer", label: computerLabels[computerActivity], detail: "云端优先策略已启用" };
  }

  const activeTool = [...messages]
    .reverse()
    .find((message) => message.kind === "activity" && message.tool && message.tool.ok === undefined && !message.tool.name.startsWith("error:"));
  if (activeTool?.tool) {
    const computer = COMPUTER_TOOL.test(activeTool.tool.name);
    return {
      kind: computer ? "computer" : "tool",
      label: computer ? "正在操作电脑" : "正在调用工具",
      detail: readableToolName(activeTool.tool.name),
    };
  }

  if (streaming) return { kind: "writing", label: "正在生成回复" };
  if (reasoning) return { kind: "thinking", label: "正在分析任务" };
  return { kind: "connecting", label: "正在连接引擎" };
}

export function computerActivityLabel(state?: ComputerActivityState): string | null {
  if (!state || state === "ready") return null;
  return computerLabels[state];
}

export function actionableRuntimeError(raw: string): { summary: string; hint: string; technical?: string } {
  const message = raw.trim() || "未知错误";
  const lower = message.toLowerCase();
  if (lower.includes("provider instance") && lower.includes("unavailable")) {
    return { summary: "当前 AI 引擎不可用", hint: "请在右上角模型选择器中切换到可用引擎，或到应用设置查看修复命令。", technical: message };
  }
  if (lower.includes("cli not found") || lower.includes("enoent") || lower.includes("spawn_error")) {
    return { summary: "未找到命令行引擎", hint: "请到应用设置 → AI 引擎状态复制安装命令，安装后点击“重新检查”。", technical: message };
  }
  if (lower.includes("not signed in") || lower.includes("auth_required") || lower.includes("login")) {
    return { summary: "引擎尚未登录", hint: "请到应用设置 → AI 引擎状态执行登录命令，然后重新发送任务。", technical: message };
  }
  if (lower.includes("401") || lower.includes("403") || lower.includes("token was rejected") || lower.includes("api key")) {
    return { summary: "密钥或登录凭据无效", hint: "请检查应用设置中的 API 密钥、中转站地址或 Box 令牌。", technical: message };
  }
  if (lower.includes("fetch") || lower.includes("network") || lower.includes("econn") || lower.includes("unreachable")) {
    return { summary: "网络连接失败", hint: "请检查网络、代理和中转站地址，恢复后可直接重试。", technical: message };
  }
  if (lower.includes("box") && (lower.includes("ready") || lower.includes("wake") || lower.includes("provision"))) {
    return { summary: "云端电脑启动失败", hint: "打开计算机面板查看状态；必要时让 Box 休眠后重新唤醒。", technical: message };
  }
  return { summary: message, hint: "可以重试；若仍失败，请保留这条技术信息用于排查。" };
}
