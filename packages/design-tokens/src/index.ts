export const colors = {
  light: {
    background: "#F5F5F2",
    surface: "#FFFFFF",
    elevated: "#EBECE8",
    text: "#151613",
    muted: "#696B65",
    border: "#D9DBD5",
    accent: "#2D7A55",
    accentText: "#FFFFFF",
    danger: "#C64545",
  },
  dark: {
    background: "#090A09",
    surface: "#141513",
    elevated: "#1E201D",
    text: "#F5F6F2",
    muted: "#A7AAA2",
    border: "#30332E",
    accent: "#62C18B",
    accentText: "#07130C",
    danger: "#FF7A7A",
  },
} as const;

export const spacing = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32 } as const;
export const radius = { sm: 8, md: 12, lg: 18, pill: 999 } as const;

export const zhCN = {
  appName: "XinyunOpen Bot",
  pairingTitle: "连接你的电脑",
  pairingHint: "在电脑端生成配对码，然后在这里输入。",
  bots: "机器人",
  groups: "群聊",
  offline: "离线模式",
  reconnecting: "正在重新连接…",
  stop: "停止",
  send: "发送",
} as const;
