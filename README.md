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
npx wrangler secret put APIMART_API_KEY
npx wrangler secret put API_FOOTBALL_KEY
npx wrangler secret put SUPABASE_URL
npx wrangler secret put SUPABASE_PUBLISHABLE_KEY
npx wrangler secret put SUPABASE_SECRET_KEY
```

模型 id 和 provider 现在都写在 `wrangler.jsonc` 的 `vars` 里，不再是 secret。**Cloudflare 的 secret 会覆盖同名 var**，所以如果之前设过模型 secret，要先删掉：

```powershell
npx wrangler secret delete MODEL_GPT
npx wrangler secret delete MODEL_CLAUDE
npx wrangler secret delete MODEL_GEMINI
npx wrangler secret delete MODEL_QWEN
```

## 模型路由

模型默认走 OpenRouter，设 `MODEL_<NAME>_PROVIDER` 为 `openai` 或 `apimart` 可以让某个模型改走直连。

**当前四个模型全部走 APIMart**。原因：这个 OpenRouter 账号的 billing region 没有 OpenAI / Anthropic / Google 的访问权限，这三家在 OpenRouter 上返回 403 `violation of provider Terms Of Service`。这是账号层面的限制，换出口 IP 或改 billing address 都没有解除。APIMart 对四个模型都返回 200。

成本统计的现状：`src/model-cost.js` 里 APIMart 只配了 `claude-opus-4-8` 和 `gemini-3.1-pro-preview` 的单价，**`gpt-5.5` 和 `qwen3.7-max` 没有单价**，后台会把它们标成 `unpriced`。补上这两行单价，成本就完整了。

区分错误的办法：模型 id 写错返回 **400 `is not a valid model ID`**，地域被拒返回 **403**。

改完配置后验证，两个办法：

```powershell
npm run test:models
```

本地跑，测的是你本机的出口。或者登录 `/admin` -> `Models` -> `Run check`，从 Worker 里测——生产环境以这个为准。两者都是每个模型发一次 16~32 token 的请求，成本可忽略。

如果只是某个上游服务商拒绝你的地域（而不是整个账号受限），这两个变量可以绕开，填 OpenRouter 的 provider slug，逗号分隔：

```powershell
npx wrangler secret put OPENROUTER_PROVIDER_IGNORE   # 跳过这些服务商
npx wrangler secret put OPENROUTER_PROVIDER_ORDER    # 优先用这些服务商
```

两个都不填时不会向 OpenRouter 发送 provider 字段，保持它自己的默认路由。

Supabase 新版后台路径：`Project Settings` -> `API Keys`。新版复制 `Secret keys` 区域的 `sb_secret_...`；旧版切到 `Legacy API Keys`，复制 `service_role`。

校验和部署：

```powershell
npm run cf:check
npm run cf:dry-run
npm run cf:deploy
```

## GitHub 自动部署

`.github/workflows/deploy-cloudflare.yml` 会在每次 push 到 `main` 后自动执行测试、lint、类型检查、生产依赖审计和前端构建。所有检查通过后，才会部署 Cloudflare Worker。

在 GitHub 仓库的 `Settings` -> `Secrets and variables` -> `Actions` 中添加：

- `CLOUDFLARE_ACCOUNT_ID`：Cloudflare Account ID。
- `CLOUDFLARE_API_TOKEN`：从 Cloudflare 的 `Edit Cloudflare Workers` 模板单独创建，并将账户和域名范围限制到本项目。不要上传本机 Wrangler OAuth 凭证。

配置完成后，可以 push 到 `main` 触发部署，也可以在 GitHub 的 `Actions` -> `Deploy to Cloudflare` 中手动运行。

## 运营后台

登录后访问 `/admin`，管理员账号才能读取数据。旧的 `/analytics`、`/backend`、`/data`、`/history` 已经合并进 `/admin`，访问会 301 跳转过去。

后台分成六个标签页：

- **Overview**：当天 API-Football 配额、模型调用与花费、预测队列、定时任务状态、收入与用户概览。
- **Data Console**：Supabase 里的 API-Football 赛程缓存，可按赛事、球队、赔率状态过滤。点 Inspect 会实时拉一次该场比赛的完整 context，并列出每个 API 端点到底抓到没有。
- **Models**：按天和累计的 token 与花费，区分「服务商回传」和「本地估算」两种成本来源。
- **Predictions**：共享预测池的命中情况、每场比赛的快照与共识、每周模型结算和冠军模型。
- **Accuracy**：赛后结算的准确率，按模型和玩法拆分。
- **Accounts**：用户、套餐权益和订单。

## 测试

```powershell
npm test
```

## 风险说明

模型输出可能幻觉、误读盘口或遗漏伤停赛程信息。所有结果都是非财务建议、非稳赢预测。
