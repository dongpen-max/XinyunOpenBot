import type { InstanceInfo } from "@/state/store";

export type EngineHealthTone = "success" | "warning" | "danger" | "neutral";

export interface EngineHealth {
  label: string;
  detail: string;
  tone: EngineHealthTone;
  command?: string;
}

type Platform = "darwin" | "win32" | "linux";

export function currentPlatform(): Platform {
  const platform = window.ogb?.platform;
  if (platform === "darwin" || platform === "win32" || platform === "linux") return platform;
  const ua = navigator.userAgent;
  return ua.includes("Mac") ? "darwin" : ua.includes("Win") ? "win32" : "linux";
}

function installCommand(instance: InstanceInfo): string | undefined {
  return instance.install?.command?.[currentPlatform()];
}

function unavailableHealth(instance: InstanceInfo): EngineHealth {
  const reason = instance.snapshot.reason?.trim() ?? "该引擎当前不可用";
  const lower = reason.toLowerCase();
  const command = installCommand(instance);

  if (lower.includes("cli not found") || lower.includes("not found")) {
    return {
      label: "未安装",
      detail: command ? "未检测到命令行引擎。复制安装命令，安装完成后重新检查。" : "未检测到该引擎，请先完成安装。",
      tone: "warning",
      command,
    };
  }
  if (lower.includes("no box token") || lower.includes("no xai api key") || lower.includes("not enabled")) {
    return {
      label: "未配置",
      detail: instance.driverKind === "boxAgent" ? "请在应用设置中添加 Box 令牌。" : "请在应用设置中配置对应的 API 密钥和中转站地址。",
      tone: "warning",
    };
  }
  if (lower.includes("unreachable") || lower.includes("couldn't reach") || lower.includes("failed to fetch")) {
    return {
      label: "连接失败",
      detail: "已找到配置，但暂时无法连接服务。请检查网络、中转站地址或代理后重试。",
      tone: "danger",
    };
  }
  if (lower.includes("unknown driver")) {
    return {
      label: "配置不兼容",
      detail: "当前版本不认识这个驱动。请升级应用，或检查 config.json 中的 driver 名称。",
      tone: "danger",
    };
  }
  return { label: "不可用", detail: reason, tone: "danger", command };
}

export function engineHealth(instance: InstanceInfo): EngineHealth {
  if (instance.snapshot.state !== "available") return unavailableHealth(instance);

  // Codex CLI currently cannot expose its subscription login state. A false
  // value only means no relay credentials were injected, not "logged out".
  const authUnknown = instance.driverKind === "codex" && instance.snapshot.authenticated === false;
  if (instance.snapshot.authenticated === false && !authUnknown && instance.install?.signInCommand) {
    return {
      label: "需要登录",
      detail: "引擎已安装，但尚未检测到登录状态。登录后即可让机器人工作。",
      tone: "warning",
      command: instance.install.signInCommand,
    };
  }

  const version = instance.snapshot.version?.trim();
  if (authUnknown) {
    return {
      label: "已安装",
      detail: version ? `${version} · 登录状态会在首次运行时验证。` : "登录状态会在首次运行时验证。",
      tone: "neutral",
    };
  }
  return {
    label: "可用",
    detail: version ? `${version} · 已准备好接收任务。` : "已准备好接收任务。",
    tone: "success",
  };
}

export function isEngineSelectable(instance: InstanceInfo): boolean {
  const health = engineHealth(instance);
  return instance.snapshot.state === "available" && health.label !== "需要登录";
}
