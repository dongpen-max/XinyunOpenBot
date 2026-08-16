export const DOMESTIC_MODEL_PROVIDERS = [
  {
    id: "deepseek",
    label: "DeepSeek",
    description: "DeepSeek V4 系列与兼容模型",
    url: "https://api.deepseek.com/v1",
  },
  {
    id: "zhipu",
    label: "智谱 GLM",
    description: "GLM-5 系列与智谱开放平台模型",
    url: "https://open.bigmodel.cn/api/paas/v4",
  },
  {
    id: "dashscope",
    label: "通义千问",
    description: "阿里云百炼 OpenAI 兼容接口",
    url: "https://dashscope.aliyuncs.com/compatible-mode/v1",
  },
  {
    id: "moonshot",
    label: "Kimi API",
    description: "Moonshot 开放平台模型",
    url: "https://api.moonshot.cn/v1",
  },
] as const;

export type DomesticModelProviderId = (typeof DOMESTIC_MODEL_PROVIDERS)[number]["id"];
