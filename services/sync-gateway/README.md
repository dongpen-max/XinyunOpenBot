# Sync Gateway

独立的 Node.js 24 + TypeScript 同步服务，默认使用 SQLite，测试可使用内存适配器。

```bash
pnpm --filter @xinyun/sync-gateway dev
curl http://127.0.0.1:8788/health
```

接口：`POST /v1/pairings`、`POST /v1/pairings/claim`、`GET /v1/snapshot`、`POST /v1/commands`、`POST /v1/devices/push-token`、`DELETE /v1/devices/:deviceId`、`GET /health`、`WS /v1/sync`。

配置见 `.env.example`。数据库使用 WAL；设备令牌只存 SHA-256 摘要。Gateway 不接收 Provider API Key。
