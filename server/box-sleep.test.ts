import { createServer, type IncomingMessage, type Server } from "node:http";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

type RequestRecord = { method: string; path: string; body: string };

describe("workspace Box sleep", () => {
  let api: Server;
  let sleepBox: typeof import("./box.ts").sleepBox;
  const requests: RequestRecord[] = [];
  let refuseStop = false;

  beforeAll(async () => {
    api = createServer((req: IncomingMessage, res) => {
      const url = new URL(req.url ?? "/", "http://box.test");
      let body = "";
      req.on("data", (chunk) => (body += chunk));
      req.on("end", () => {
        requests.push({ method: req.method ?? "GET", path: url.pathname, body });
        res.setHeader("content-type", "application/json");
        if (url.pathname === "/api/box/v1/boxes" && req.method === "GET") {
          return res.end(JSON.stringify({ ok: true, boxes: [{ id: "sleep-box", name: "xinyun-workspace-primary", state: "ready" }] }));
        }
        if (url.pathname === "/api/box/v1/boxes/sleep-box/commands") {
          return res.end(JSON.stringify({ ok: true, exitCode: 0 }));
        }
        if (url.pathname === "/api/box/v1/boxes/sleep-box/stop") {
          if (refuseStop) {
            res.writeHead(409);
            return res.end(JSON.stringify({ ok: false, message: "snapshot save failed" }));
          }
          res.writeHead(202);
          return res.end(JSON.stringify({ ok: true }));
        }
        if (url.pathname === "/api/box/v1/boxes/sleep-box" && req.method === "GET") {
          return res.end(JSON.stringify({ ok: true, box: { id: "sleep-box", state: "archived" } }));
        }
        res.writeHead(404).end(JSON.stringify({ ok: false, message: "unexpected endpoint" }));
      });
    });
    await new Promise<void>((resolve) => api.listen(0, "127.0.0.1", resolve));
    const port = (api.address() as { port: number }).port;
    vi.stubEnv("OMB_BOX_API", `http://127.0.0.1:${port}/api/box/v1`);
    vi.resetModules();
    ({ sleepBox } = await import("./box.ts"));
  });

  afterAll(async () => {
    vi.unstubAllEnvs();
    await new Promise<void>((resolve) => api.close(() => resolve()));
  });

  it("confirms a normal stop reached an archived state", async () => {
    requests.length = 0;
    refuseStop = false;
    await expect(sleepBox({ box: { token: "box_test" } } as any, "bot-a")).resolves.toEqual({ ok: true, state: "archived" });
    const stop = requests.find((request) => request.path.endsWith("/stop"));
    expect(stop).toMatchObject({ method: "POST", body: "" });
  });

  it("sends the provider force flag only after explicit confirmation", async () => {
    requests.length = 0;
    refuseStop = false;
    await expect(sleepBox({ box: { token: "box_test" } } as any, "bot-a", true)).resolves.toEqual({ ok: true, state: "archived" });
    const stop = requests.find((request) => request.path.endsWith("/stop"));
    expect(JSON.parse(stop?.body ?? "{}")).toEqual({ force: true });
  });

  it("surfaces a snapshot refusal instead of reporting a false stop", async () => {
    requests.length = 0;
    refuseStop = true;
    await expect(sleepBox({ box: { token: "box_test" } } as any, "bot-a")).rejects.toThrow(/snapshot save failed/);
  });
});
