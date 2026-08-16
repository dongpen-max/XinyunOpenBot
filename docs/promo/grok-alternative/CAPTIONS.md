# XinyunOpen Bot 宣传图解说与发布文案

项目地址：`https://github.com/dongpen-max/XinyunOpenBot`

## 推荐定位

> XinyunOpen Bot：面向中国用户、默认简体中文、支持多模型与多机器人的开源 Grok Bot 平替方案。

建议使用“平替方案”而不是“官方替代品”。XinyunOpen Bot 是独立开源项目，并非 xAI 官方产品。

## 逐图解说

### 00-cover.png — 主封面

**标题：** 开源的 Grok Bot 平替

**解说：**
XinyunOpen Bot 把 Grok、ChatGPT、Claude、Codex 和国产模型放进同一个中文桌面工作台。它不只负责聊天，还能让机器人操作本机或云端电脑、执行任务，并和其他机器人协作。

### 01-chief-agent.png — 总管机器人

**标题：** 一个机器人负责沟通，其他机器人负责干活

**解说：**
设置一个“总管机器人”作为主要联系人。总管会通过 `list_bots` 查看工作区中的机器人，再用 `ask_bot` 分配子任务，最后把多个机器人的结果统一汇总。

### 02-xinyun-grok.png — Grok 接入

**标题：** Grok 4.6 / 4.5，可接中转站并使用电脑工具

**解说：**
通过 OpenAI 兼容 API 接入 Grok 模型，支持模型目录自动发现和热切换。相比只提供聊天窗口的方案，XinyunOpen Bot 还保留电脑操作、工具调用和多机器人协作能力。

### 03-reasoning-levels.png — 五档思考强度

**标题：** 简单问题快速回答，复杂任务拉满思考

**解说：**
输入栏提供极低、低、中、高、最大五档思考强度。最低档会自动选择同厂商的下一级模型以降低消耗，最大档则用于复杂分析和工程任务。

### 04-per-bot-voice.png — 每机器人独立声音

**标题：** 群聊里的每个机器人，都有自己的音色

**解说：**
可以为每个机器人独立设置音色、语速和音量。多个机器人一起语音回复时，不看屏幕也能听出是谁在说话。

### 05-realtime-voice.png — 实时语音聊天

**标题：** 不是回复完成后念稿，而是边生成边开口

**解说：**
支持 STT、TTS、麦克风抢断和流式语音播放。模型生成文本的同时即可开始语音回答，用户开口后还能中断当前播报，交互更接近真实通话。

### 06-group-chat.png — 多机器人群聊

**标题：** 把不同模型、不同角色拉进同一个群聊

**解说：**
使用 `@机器人名称` 指定响应者，也可以让多个机器人依次回答。每个成员可以拥有不同模型、角色设定、形象和声音。

### 07-domestic-models.png — 国产模型

**标题：** DeepSeek、GLM、通义千问、Kimi 直接接入

**解说：**
应用内置四个国产模型兼容 API 预设。填写 API Key 后即可保存并热重载，无需手工修改配置文件。

## 社媒短文案

我做了一个面向中国用户的开源 Grok Bot 平替：**XinyunOpen Bot**。

它不是单纯套壳聊天框，而是一个能真正执行任务的多机器人桌面工作台：

- 支持 Grok、ChatGPT、Claude、Codex，以及 DeepSeek、GLM、通义千问、Kimi
- 多机器人群聊，可设置一个总管机器人分配和汇总任务
- 支持本机与云端电脑操作
- 五档思考强度，最低档自动降级模型
- 实时语音聊天，模型边生成边开口
- 每个机器人可以拥有独立音色、语速和形象
- 默认简体中文，MIT 开源

项目地址：`https://github.com/dongpen-max/XinyunOpenBot`

欢迎体验、提 Issue、贡献代码，也欢迎 Star 支持。

## 公众号 / 知乎长文开头

现在很多 AI Bot 产品的体验都很强，但对于中国用户来说，经常会遇到界面语言、模型接入、网络环境、数据目录和二次开发方面的限制。

因此我基于 OpenMausBot 开发了 **XinyunOpen Bot**：一个默认简体中文、支持多模型、多机器人、语音聊天和电脑操作的开源桌面应用。它的目标不是再做一个聊天窗口，而是提供一套本地可控、可以持续扩展的 Grok Bot 平替方案。

在 XinyunOpen Bot 中，可以接入 Grok 4.6 / 4.5、ChatGPT、Claude、Codex，也可以直接配置 DeepSeek、智谱 GLM、通义千问和 Kimi。不同机器人可以使用不同模型、角色、形象和声音，还可以由“总管机器人”把任务分发给其他机器人并统一汇总。

## 推荐标题

1. 我做了一个开源的 Grok Bot 平替：支持多模型、语音和电脑操作
2. 不只是聊天框：这个开源 AI Bot 能让多个机器人一起干活
3. XinyunOpen Bot：默认中文、支持国产模型的 Grok Bot 平替方案
4. 给 Grok Bot 做了一个开源平替，还加入了多机器人群聊和实时语音
5. 一个本地可控的 AI 工作台：Grok、Claude、ChatGPT 和国产模型都能用

## 推荐发布顺序

1. `00-cover.png`
2. `02-xinyun-grok.png`
3. `01-chief-agent.png`
4. `06-group-chat.png`
5. `05-realtime-voice.png`
6. `04-per-bot-voice.png`
7. `03-reasoning-levels.png`
8. `07-domestic-models.png`

竖版平台首图使用：`cover-portrait-1080x1350.png`
