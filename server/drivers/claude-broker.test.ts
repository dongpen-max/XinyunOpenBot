import { connect, type Socket } from "node:net";
import { afterEach, describe, expect, it } from "vitest";

import { permissionSocketPath, createPermissionBroker } from "./claude.ts";

function connectSocket(path: string): Promise<Socket> {
  return new Promise((resolve, reject) => {
    let retriesLeft = 20;
    const attempt = () => {
      const conn = connect(path);
      const onConnect = () => {
        conn.removeListener("error", onError);
        resolve(conn);
      };
      const onError = (error: NodeJS.ErrnoException) => {
        conn.removeListener("connect", onConnect);
        conn.destroy();
        if ((error.code === "ENOENT" || error.code === "ECONNREFUSED") && retriesLeft-- > 0) {
          setTimeout(attempt, 25);
          return;
        }
        reject(error);
      };
      conn.once("connect", onConnect);
      conn.once("error", onError);
    };
    attempt();
  });
}

function answerQueue(conn: Socket) {
  const answers: any[] = [];
  const waiters: Array<(answer: any) => void> = [];
  let buf = "";
  conn.on("data", (chunk) => {
    buf += chunk;
    let nl;
    while ((nl = buf.indexOf("\n")) !== -1) {
      const answer = JSON.parse(buf.slice(0, nl));
      buf = buf.slice(nl + 1);
      const waiter = waiters.shift();
      if (waiter) waiter(answer);
      else answers.push(answer);
    }
  });
  return () =>
    new Promise<any>((resolve) => {
      const answer = answers.shift();
      if (answer !== undefined) resolve(answer);
      else waiters.push(resolve);
    });
}

function waitFor(predicate: () => boolean): Promise<void> {
  return new Promise((resolve) => {
    const check = () => (predicate() ? resolve() : setTimeout(check, 5));
    check();
  });
}

describe("Claude permission broker", () => {
  let broker: ReturnType<typeof createPermissionBroker> | undefined;
  const sockets: Socket[] = [];

  afterEach(() => {
    for (const socket of sockets) socket.destroy();
    sockets.length = 0;
    broker?.close();
    broker = undefined;
  });

  it("rejects duplicate asks without replacing the original request", async () => {
    const asks: Array<{ id: string; kind: string }> = [];
    const socketPath = permissionSocketPath(`broker-test-${process.pid}-${Date.now()}`);
    broker = createPermissionBroker({
      socketPath,
      onAsk: (ask) => asks.push(ask),
      onResolve: () => {},
      timeoutMs: 10_000,
    });
    const conn = await connectSocket(socketPath);
    sockets.push(conn);
    const nextAnswer = answerQueue(conn);

    conn.write(JSON.stringify({ t: "ask", id: "duplicate", tool: "Bash", input: { command: "echo one" } }) + "\n");
    await waitFor(() => asks.length === 1);
    conn.write(JSON.stringify({ t: "ask", id: "duplicate", tool: "Bash", input: { command: "echo two" } }) + "\n");

    await expect(nextAnswer()).resolves.toMatchObject({
      id: "duplicate",
      behavior: "deny",
      message: "XinyunOpen Bot: duplicate ask id — skipping this request.",
    });
    expect(asks).toHaveLength(1);
    expect(broker.answer("duplicate", "allow")).toBe(true);
    await expect(nextAnswer()).resolves.toMatchObject({ id: "duplicate", behavior: "allow" });
  });

  it("applies the same collision guard to question asks", async () => {
    const asks: Array<{ id: string; kind: string }> = [];
    const socketPath = permissionSocketPath(`broker-question-${process.pid}-${Date.now()}`);
    broker = createPermissionBroker({
      socketPath,
      onAsk: (ask) => asks.push(ask),
      onResolve: () => {},
      timeoutMs: 10_000,
    });
    const first = await connectSocket(socketPath);
    const second = await connectSocket(socketPath);
    sockets.push(first, second);
    const firstAnswers = answerQueue(first);
    const secondAnswers = answerQueue(second);

    first.write(JSON.stringify({ t: "ask", id: "question-duplicate", kind: "question", tool: "ask_user" }) + "\n");
    await waitFor(() => asks.length === 1);
    second.write(JSON.stringify({ t: "ask", id: "question-duplicate", kind: "question", tool: "ask_user" }) + "\n");

    await expect(secondAnswers()).resolves.toMatchObject({
      id: "question-duplicate",
      behavior: "deny",
      message: "XinyunOpen Bot: duplicate ask id — skipping this request.",
    });
    expect(broker.answer("question-duplicate", "answer", "yes")).toBe(true);
    await expect(firstAnswers()).resolves.toMatchObject({
      id: "question-duplicate",
      behavior: "answer",
      message: "yes",
    });
  });
});
