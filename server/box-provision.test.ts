import { createServer, type IncomingMessage, type Server } from "node:http";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

type RequestRecord = { method: string; path: string; headers: IncomingMessage["headers"]; body: string };

describe("workspace Box provisioning cleanup", () => {
  let api: Server;
  let provisionBox: typeof import("./box.ts").provisionBox;
  let replaceAllBoxes: typeof import("./box.ts").replaceAllBoxes;
  let configuredBoxType: typeof import("./box.ts").configuredBoxType;
  let automaticBoxCreationEnabled: typeof import("./box.ts").automaticBoxCreationEnabled;
  let scenario: "rename-failure" | "existing-desktop-failure" | "replace" = "rename-failure";
  let replacementOldDeleted = false;
  const requests: RequestRecord[] = [];

  beforeAll(async () => {
    api = createServer((req, res) => {
      const url = new URL(req.url ?? "/", "http://box.test");
      let body = "";
      req.on("data", (chunk) => (body += chunk));
      req.on("end", () => {
        requests.push({ method: req.method ?? "GET", path: url.pathname, headers: req.headers, body });
        res.setHeader("content-type", "application/json");

        if (url.pathname === "/api/box/v1/boxes" && req.method === "GET") {
          const boxes =
            scenario === "existing-desktop-failure"
              ? [{ id: "existing-box", name: "xinyun-workspace-primary", state: "ready" }]
              : scenario === "replace"
                ? [{ id: "old-box", name: "xinyun-workspace-primary", state: "ready", type: "default" }]
              : [];
          res.writeHead(200).end(JSON.stringify({ ok: true, boxes }));
        } else if (url.pathname === "/api/box/v1/boxes" && req.method === "POST") {
          res.writeHead(201).end(JSON.stringify({ ok: true, box: { id: "new-box", state: "provisioning" } }));
        } else if (url.pathname === "/api/box/v1/boxes/new-box" && req.method === "PATCH") {
          if (scenario === "replace") res.writeHead(200).end(JSON.stringify({ ok: true }));
          else res.writeHead(500).end(JSON.stringify({ ok: false, message: "rename rejected" }));
        } else if (url.pathname === "/api/box/v1/boxes/new-box" && req.method === "GET") {
          res.writeHead(200).end(JSON.stringify({ ok: true, box: { id: "new-box", state: "ready", type: "large" } }));
        } else if (url.pathname === "/api/box/v1/boxes/new-box" && req.method === "DELETE") {
          res.writeHead(202).end(JSON.stringify({ ok: true }));
        } else if (url.pathname === "/api/box/v1/boxes/old-box/stop" && req.method === "POST") {
          res.writeHead(202).end(JSON.stringify({ ok: true }));
        } else if (url.pathname === "/api/box/v1/boxes/old-box" && req.method === "DELETE") {
          replacementOldDeleted = true;
          res.writeHead(202).end(JSON.stringify({ ok: true }));
        } else if (url.pathname === "/api/box/v1/boxes/old-box" && req.method === "GET") {
          if (replacementOldDeleted) res.writeHead(404).end(JSON.stringify({ ok: false }));
          else res.writeHead(200).end(JSON.stringify({ ok: true, box: { id: "old-box", state: "ready" } }));
        } else if (url.pathname === "/api/box/v1/boxes/existing-box" && req.method === "GET") {
          res.writeHead(200).end(
            JSON.stringify({
              ok: true,
              box: { id: "existing-box", name: "xinyun-workspace-primary", state: "ready" },
            }),
          );
        } else if (url.pathname.endsWith("/commands")) {
          res.writeHead(200).end(JSON.stringify({ ok: true, exitCode: 0, stdout: "bootstrapped", stderr: "" }));
        } else if (url.pathname.endsWith("/desktop")) {
          res.writeHead(500).end(JSON.stringify({ ok: false, message: "desktop unavailable" }));
        } else {
          res.writeHead(404).end(JSON.stringify({ ok: false, message: `unexpected ${req.method} ${url.pathname}` }));
        }
      });
    });
    await new Promise<void>((resolve) => api.listen(0, "127.0.0.1", resolve));
    const port = (api.address() as { port: number }).port;
    vi.stubEnv("OMB_BOX_API", `http://127.0.0.1:${port}/api/box/v1`);
    vi.stubEnv("OMB_BOX_TYPE", "large");
    vi.stubEnv("OMB_BOX_DISABLE_AUTO_CREATE", "1");
    vi.resetModules();
    ({ provisionBox, replaceAllBoxes, configuredBoxType, automaticBoxCreationEnabled } = await import("./box.ts"));
  });

  afterAll(async () => {
    vi.unstubAllEnvs();
    await new Promise<void>((resolve) => api.close(() => resolve()));
  });

  it("permanently deletes a newly created Box when naming fails", async () => {
    scenario = "rename-failure";
    requests.length = 0;

    await expect(provisionBox({ box: { token: "box_test" } } as any, "new-bot", "New Bot")).rejects.toThrow(
      /box naming failed: rename rejected/,
    );

    const removal = requests.find((request) => request.method === "DELETE");
    const creation = requests.find((request) => request.method === "POST" && request.path.endsWith("/boxes"));
    expect(JSON.parse(creation?.body ?? "{}")).toMatchObject({ type: "large", noEnv: true });
    expect(removal?.path).toBe("/api/box/v1/boxes/new-box");
    expect(removal?.headers["x-ascii-confirm-delete"]).toBe("new-box");
  });

  it("never deletes a reused workspace Box when desktop setup fails", async () => {
    scenario = "existing-desktop-failure";
    requests.length = 0;

    await expect(
      provisionBox({ box: { token: "box_test" } } as any, "existing-bot", "Existing Bot"),
    ).rejects.toThrow(/desktop link could not be created/);

    expect(requests.some((request) => request.method === "DELETE")).toBe(false);
  });

  it("uses the local large policy and disables automatic creation", () => {
    expect(configuredBoxType({ box: { type: "large" } } as any)).toBe("large");
    expect(automaticBoxCreationEnabled({ box: { autoCreate: false } } as any)).toBe(false);
  });

  it("creates and verifies a large replacement before deleting the old Box", async () => {
    scenario = "replace";
    replacementOldDeleted = false;
    requests.length = 0;

    const result = await replaceAllBoxes({ box: { token: "box_test" } } as any, "Replacement Bot", "replace-all-boxes");

    expect(result).toMatchObject({
      ok: true,
      box: { boxId: "new-box", type: "large", state: "ready" },
      previousCount: 1,
      deletedCount: 1,
      failedDeleteIds: [],
    });
    const creationIndex = requests.findIndex((request) => request.method === "POST" && request.path.endsWith("/boxes"));
    const verificationIndex = requests.findIndex(
      (request) => request.method === "GET" && request.path.endsWith("/boxes/new-box"),
    );
    const deletionIndex = requests.findIndex(
      (request) => request.method === "DELETE" && request.path.endsWith("/boxes/old-box"),
    );
    expect(JSON.parse(requests[creationIndex]?.body ?? "{}")).toMatchObject({ type: "large", noEnv: true });
    expect(creationIndex).toBeGreaterThanOrEqual(0);
    expect(verificationIndex).toBeGreaterThan(creationIndex);
    expect(deletionIndex).toBeGreaterThan(verificationIndex);
  });
});
