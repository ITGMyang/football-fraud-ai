# 足球诈骗

本地和 Cloudflare 都能运行的足球数据 AI 预测工具。当前版本使用 API-Football 导入赛程、阵容、球员、伤停、统计、赔率和数据预测，再调用多个 AI 模型进行分析。

## 本地运行

```powershell
Copy-Item .env.example .env
# 编辑 .env，填 API_FOOTBALL_KEY 和模型 API Key
npm install
npm start
```

打开 `http://localhost:3888`。

## Cloudflare + Supabase 架构

- 前端和 API 部署到 Cloudflare Workers。
- 数据存到 Supabase Postgres，Worker 使用 `SUPABASE_SECRET_KEY` 或旧版 `SUPABASE_SERVICE_ROLE_KEY` 从服务端访问。
- 登录支持 Google OAuth 和邮箱密码。浏览器只会拿到 `SUPABASE_PUBLISHABLE_KEY`，不会拿到 Supabase secret/service role key。
- OpenRouter key 和 OpenAI key 都作为 Cloudflare secret 保存。GPT 可以走 OpenAI 直连，其他模型继续走 OpenRouter。
- API-Football Key 仅保存在 Worker secret 中，浏览器不会拿到。定时任务每 20 分钟用一次请求抓取当天全部赛程，再按联赛写入 Supabase 缓存。

## Supabase 初始化

在 Supabase SQL Editor 执行：

```sql
-- supabase/migrations/0001_initial.sql
```

这会创建 `markets`、`reports`、`rankings`、`match_contexts` 四张表，并启用 RLS。第一版只给 `service_role` 授权，不开放 `anon` 直接访问。

在 Supabase Dashboard 的 `Auth` -> `Providers` 中启用 Email 和 Google。Google 控制台的 Authorized redirect URI 使用 Supabase Google Provider 页面显示的 `/auth/v1/callback`。然后在 Supabase 的 Redirect URLs 中加入：

```text
http://localhost:3888/auth/callback
http://localhost:3888/auth/reset
https://你的正式域名/auth/callback
https://你的正式域名/auth/reset
```

生产环境设置 `AUTH_SITE_URL=https://futbots.cc`，确保从本地或线上发起 OAuth 都回到正式域名。Telegram 使用 Supabase Custom OIDC Provider：在 @BotFather 的 `Bot Settings` -> `Web Login` 注册 `https://futbots.cc`，然后在 Supabase 创建标识为 `custom:telegram` 的 OIDC Provider，Issuer URL 为 `https://oauth.telegram.org`，Scopes 使用 `openid profile`。配置完成后把 `TELEGRAM_AUTH_ENABLED` 改为 `true` 再部署。

本地 `.env` 及 Cloudflare 都需要 `SUPABASE_PUBLISHABLE_KEY`。旧项目也可以使用 `SUPABASE_ANON_KEY`，但不能将 secret/service role key 填到这两个公开变量中。

## Cloudflare 配置

先准备 Node 22 或更高版本，然后设置 secret：

```powershell
npx wrangler secret put OPENROUTER_API_KEY
npx wrangler secret put OPENAI_API_KEY
npx wrangler secret put API_FOOTBALL_KEY
npx wrangler secret put SUPABASE_URL
npx wrangler secret put SUPABASE_PUBLISHABLE_KEY
npx wrangler secret put SUPABASE_SECRET_KEY
npx wrangler secret put MODEL_GPT
npx wrangler secret put MODEL_GEMINI
npx wrangler secret put MODEL_DEEPSEEK
npx wrangler secret put MODEL_QWEN
```

Supabase 新版后台路径：`Project Settings` -> `API Keys`。新版复制 `Secret keys` 区域的 `sb_secret_...`；旧版切到 `Legacy API Keys`，复制 `service_role`。

校验和部署：

```powershell
npm run cf:check
npm run cf:dry-run
npm run cf:deploy
```

## 测试

```powershell
npm test
```

## 风险说明

模型输出可能幻觉、误读盘口或遗漏伤停赛程信息。所有结果都是非财务建议、非稳赢预测。
