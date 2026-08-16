export const DOMESTIC_PROVIDER_PRESETS = {
    deepseek: {
        instanceId: "deepseek",
        displayName: "DeepSeek",
        defaultUrl: "https://api.deepseek.com/v1",
        apiKeyEnv: "DEEPSEEK_API_KEY",
        models: {
            default: "deepseek-v4-flash",
            options: [
                { id: "deepseek-v4-flash", label: "DeepSeek V4 Flash" },
                { id: "deepseek-v4-pro", label: "DeepSeek V4 Pro" },
            ],
        },
        reasoningEffort: true,
    },
    zhipu: {
        instanceId: "zhipu",
        displayName: "智谱 GLM",
        defaultUrl: "https://open.bigmodel.cn/api/paas/v4",
        apiKeyEnv: "ZHIPU_API_KEY",
        models: {
            default: "glm-5.2",
            options: [{ id: "glm-5.2", label: "GLM-5.2" }],
        },
        reasoningEffort: true,
    },
    dashscope: {
        instanceId: "dashscope",
        displayName: "通义千问",
        defaultUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1",
        apiKeyEnv: "DASHSCOPE_API_KEY",
        models: {
            default: "qwen-plus",
            options: [
                { id: "qwen-plus", label: "Qwen Plus" },
                { id: "qwen-max", label: "Qwen Max" },
            ],
        },
        reasoningEffort: false,
    },
    moonshot: {
        instanceId: "moonshot",
        displayName: "Kimi API",
        defaultUrl: "https://api.moonshot.cn/v1",
        apiKeyEnv: "MOONSHOT_API_KEY",
        models: {
            default: "kimi-k3",
            options: [{ id: "kimi-k3", label: "Kimi K3" }],
        },
        reasoningEffort: false,
    },
};
export const DOMESTIC_PROVIDER_IDS = Object.keys(DOMESTIC_PROVIDER_PRESETS);
export function isDomesticProviderId(value) {
    return DOMESTIC_PROVIDER_IDS.includes(value);
}
