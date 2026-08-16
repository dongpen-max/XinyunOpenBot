export interface PushNotifier {
  notifyTaskCompleted(tokens: string[], payload: { workspaceId: string; threadId?: string }): Promise<void>;
}

export class ExpoPushNotifier implements PushNotifier {
  async notifyTaskCompleted(tokens: string[], payload: { workspaceId: string; threadId?: string }): Promise<void> {
    if (!tokens.length) return;
    await fetch("https://exp.host/--/api/v2/push/send", {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json", "accept-encoding": "gzip, deflate" },
      body: JSON.stringify(tokens.map((to) => ({ to, sound: "default", title: "XinyunOpen Bot", body: "机器人任务已完成", data: payload }))),
      signal: AbortSignal.timeout(8_000),
    }).then((response) => { if (!response.ok) throw new Error(`Expo Push returned ${response.status}`); });
  }
}
