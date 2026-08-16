import { resolve } from "node:path";
import { createGatewayServer } from "./server.ts";
import { SqliteGatewayStorage } from "./sqlite-storage.ts";

const port = Number(process.env.PORT ?? 8788);
const host = process.env.HOST ?? "0.0.0.0";
const database = process.env.SYNC_DATABASE_PATH ?? resolve(".data/sync-gateway.sqlite");
const gateway = createGatewayServer({ host, port, publicUrl: process.env.SYNC_PUBLIC_URL, storage: new SqliteGatewayStorage(database) });

await gateway.listen();
console.log(`XinyunOpen Bot Sync Gateway listening on http://${host}:${port}`);

for (const signal of ["SIGINT", "SIGTERM"] as const) process.once(signal, () => void gateway.close().finally(() => process.exit(0)));
