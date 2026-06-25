# 足球诈骗

本地和 Cloudflare 都能运行的足球公开数据 AI 预测工具。当前版本使用懂球帝公开比赛页导入数据，通过 OpenRouter 调用多模型，结果只做概率分析和复盘，不做自动下注，也不承诺盈利。

## 本地运行

```powershell
Copy-Item .env.example .env
# 编辑 .env，填 OPENROUTER_API_KEY
npm install
npm start
```

打开 `http://localhost:3888`。

## Cloudflare + Supabase 架构

- 前端和 API 部署到 Cloudflare Workers。
- 数据存到 Supabase Postgres，Worker 使用 `SUPABASE_SERVICE_ROLE_KEY` 从服务端访问。
- 浏览器不会拿到 Supabase service role key。
- OpenRouter key 也作为 Cloudflare secret 保存。

## Supabase 初始化

在 Supabase SQL Editor 执行：

```sql
-- supabase/migrations/0001_initial.sql
```

这会创建 `markets`、`reports`、`rankings`、`match_contexts` 四张表，并启用 RLS。第一版只给 `service_role` 授权，不开放 `anon` 直接访问。

## Cloudflare 配置

先准备 Node 22 或更高版本，然后设置 secret：

```powershell
npx wrangler secret put OPENROUTER_API_KEY
npx wrangler secret put SUPABASE_URL
npx wrangler secret put SUPABASE_SERVICE_ROLE_KEY
npx wrangler secret put MODEL_GPT
npx wrangler secret put MODEL_GEMINI
npx wrangler secret put MODEL_DEEPSEEK
npx wrangler secret put MODEL_QWEN
```

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
