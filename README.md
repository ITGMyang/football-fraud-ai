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

**当前路由**：GPT 走 OpenAI 直连，Claude 和 Gemini 走 APIMart，Qwen 走 OpenRouter。

这个 OpenRouter 账号的 billing region 没有 OpenAI / Anthropic / Google 的访问权限，这三家在 OpenRouter 上返回 403 `violation of provider Terms Of Service`，改 billing address 也没有解除。Qwen 不受影响，留在 OpenRouter 是因为只有它会回传真实成本——APIMart 不回传，而 Qwen 是开赛前的冠军模型，绝大多数预测都走它。

APIMart 实测对四个模型都返回 200，所以任何一条链路出问题都可以把 `MODEL_<NAME>_PROVIDER` 改成 `apimart` 顶上。

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

## 构建产物保留策略

`npm run build:frontend` 构建后会跑 [`scripts/prune-build.js`](scripts/prune-build.js)，**保留最近 3 次构建的 bundle**，而不是只留当前这一次。

原因：内容哈希的意义就是新旧并存。如果每次部署都删掉上一版 bundle，任何拿着旧 HTML 的人——边缘缓存的副本、已经打开的标签页、浏览器前进后退——请求的文件就不存在了，SPA 兜底会返回 HTML，浏览器把 HTML 当 JavaScript 执行，页面直接黑屏。这个失效模式和 CDN 缓存配置无关，**部署前几分钟打开页面的用户照样会中招**。

`public/build/generations.json` 记录保留了哪几代。重复构建同样的源码不会推进代数，否则几次空构建就会把保留的旧版全挤掉。

另外 `wrangler.jsonc` 的 `run_worker_first` 用的是**显式路由列表**而不是 `true`：布尔写法下 HTML 路径不会进 Worker，`/` 和 `/admin` 会被静态资源层直接应答，Worker 设的 `no-store` 响应头根本发不出去。

## GitHub 自动部署

`.github/workflows/deploy-cloudflare.yml` 会在每次 push 到 `main` 后自动执行测试、lint、类型检查、生产依赖审计和前端构建。所有检查通过后，才会部署 Cloudflare Worker。

在 GitHub 仓库的 `Settings` -> `Secrets and variables` -> `Actions` 中添加：

- `CLOUDFLARE_ACCOUNT_ID`：Cloudflare Account ID。
- `CLOUDFLARE_API_TOKEN`：从 Cloudflare 的 `Edit Cloudflare Workers` 模板单独创建，并将账户和域名范围限制到本项目。不要上传本机 Wrangler OAuth 凭证。

配置完成后，可以 push 到 `main` 触发部署，也可以在 GitHub 的 `Actions` -> `Deploy to Cloudflare` 中手动运行。

## 运营后台

登录后访问 `/admin`，管理员账号才能读取数据。旧的 `/analytics`、`/backend`、`/data`、`/history` 已经合并进 `/admin`，访问会 301 跳转过去。

后台分成七个标签页：

- **Overview**：当天 API-Football 配额、模型调用与花费、预测队列、定时任务状态、收入与用户概览。
- **Traffic**：Cloudflare zone 的访问数据——每日独立访客、请求数、页面浏览、流量、拦截威胁，以及按国家/地区的请求分布。需要额外配置，见下。
- **Data Console**：Supabase 里的 API-Football 赛程缓存，可按赛事、球队、赔率状态过滤。点 Inspect 会实时拉一次该场比赛的完整 context，并列出每个 API 端点到底抓到没有。
- **Models**：按天和累计的 token 与花费，区分「服务商回传」和「本地估算」两种成本来源。
- **Predictions**：共享预测池的命中情况、每场比赛的快照与共识、每周模型结算和冠军模型。
- **Accuracy**：赛后结算的准确率，按模型和玩法拆分。
- **Accounts**：用户、套餐权益和订单。

### 访问数据配置

Traffic 标签读 Cloudflare 的 GraphQL Analytics API，需要两个 secret：

```powershell
npx wrangler secret put CLOUDFLARE_ZONE_ID
npx wrangler secret put CLOUDFLARE_ANALYTICS_TOKEN
```

- `CLOUDFLARE_ZONE_ID`：Cloudflare 后台 `futbots.cc` 概览页右下角的 Zone ID。
- `CLOUDFLARE_ANALYTICS_TOKEN`：**新建一个单独的 token**，权限只给 `Zone → Analytics → Read`，范围限定到这一个 zone。不要复用部署用的 `CLOUDFLARE_API_TOKEN`——那个有写权限，没必要让后台读接口拿着它。

没配置时 Traffic 标签会明确显示缺哪个变量，不会静默显示 0。

**这份数据的边界**（界面上也写了）：

- **独立访客只有按天的粒度**，没有按国家的。国家维度统计的是**请求数**，不是访客数——Cloudflare 这个数据集就是这样。
- 累加每日访客会把隔天回访的人重复计一次，所以界面上把它标成「访问数」而不是「人数」，并另外给出「单日访客峰值」。
- **没有国家以下的粒度**（城市、省份）。标准套餐的 zone analytics 不提供。
- 如果 GraphQL 因为套餐或 token 权限报错，界面会把 Cloudflare 的原始错误原文显示出来，不会当成"没有流量"。

想要城市/地区级别的数据，得换个思路：Worker 在每个请求上都能读到 `request.cf.country` / `city` / `region` / `colo`，自己记录进 Supabase 就有了，而且能按路径细分。这条没做，需要的话说一声。

## 预测数据层

一次预测按顺序用三个来源，前两个零成本：

**① 统计基线**（[`src/poisson.js`](src/poisson.js)，纯代码，0 token）

用赛季进球记录拟合 Dixon-Coles 模型，输出预期进球、胜平负、比分分布、大小球、双方进球。带低比分修正（rho = −0.13）——独立泊松会低估 0-0 和 1-1、高估 1-0 和 0-1，因为低比分比赛里两队进球并不独立。

**② 盘口共识**（[`src/market-odds.js`](src/market-odds.js)，纯代码，0 token）

读 API-Football 已经返回的 1X2 / 亚盘 / 大小球赔率，**去掉水位**再跨博彩公司取平均。赔率倒数不是概率——5% 水位的盘口直接换算会得到"所有结果加起来 105%"。去水用等比例法，Shin 方法对失衡盘口更准但需要迭代和先验假设，这份数据撑不起来。

盘口在 prompt 里**排在统计基线之上**：它定价了模型看不到的信息。模型与市场的偏离度会被算出来并存进结果，赛后可以对两个参照分别打分。

四分之一盘（如 +1.25）按原样保留，不在这里拆分——拆分会改变"打赢盘口"的定义，那属于结算逻辑。

**③ 缺口补全**（[`src/team-news.js`](src/team-news.js)，xAI 实时搜索，**只补 API-Football 没抓到的字段**）

API-Football 对覆盖好的联赛数据齐全，对有些联赛大片缺失。实测一场欧联资格赛：`injuries: empty`，而搜索找到了 6 名缺阵球员。

按 `fetchStatus` 逐字段判断缺口，**所有缺口合并成一次调用**，成本不随缺口数量增长：

| 字段 | 缺失时 | 说明 |
|---|---|---|
| `injuries` | ✅ 搜 | 伤停、停赛、存疑球员 |
| `lineups` | ✅ 搜，**但只在开赛前 90 分钟内** | 更早去搜只会搜到猜测 |
| `standings` | ✅ 搜 | 排名、近况、赛季目标（战意依据） |
| `fixtureStatistics` / `playerStatistics` / `events` | ❌ 不搜 | 赛后数据，赛前不存在 |
| `topScorers` / `squads` / `coaches` | ❌ 不搜 | 信号弱 |
| **`teamStatistics`** | ❌ **永不搜** | 见下 |

```
全部字段齐全  →  跳过，成本 $0
有任意缺口    →  搜一次，约 $0.012
```

**为什么 `teamStatistics` 永远不补**：它是唯一喂进数学模型的字段，泊松层的 λ 完全来自它的进球数。其它字段搜来的是文字证据，进 prompt 后模型自己权衡，错了顶多是一条噪音；而一个搜错的进球数会算出**看起来正常、实际错误**的 λ，比分分布、大小球、胜平负全部被静默污染，下游没有任何东西会发现。

缺失时泊松层会诚实返回 `available: false` 并说明原因——**错的基线比没有基线更糟**。prompt 里也明确要求搜索不得返回进球数和赛季统计。

搜索结果**没有引用就丢弃**：无出处的球员伤停说法和猜测没有区别。prompt 里明确标注它是未经核实的信息，且不得覆盖盘口。

搜索失败、超时、未配置都不会影响预测——照常出结果，只是少一份输入。

### 相关配置

```powershell
npx wrangler secret put XAI_API_KEY
```

不设 `XAI_API_KEY` 就是关闭。想保留 key 但暂时停用，设 `TEAM_NEWS_SEARCH_ENABLED=false`。模型默认 `grok-4.3`，可用 `XAI_MODEL` 覆盖。

**注意**：xAI 的 `search_parameters`（Live Search）已废弃，返回 410，必须用 Agent Tools API（`/v1/responses` + `tools:[{type:"x_search"}]`）。经 OpenRouter 转发时 `x_search` 拿不到，只能直连 xAI。

## 测试

```powershell
npm test
```

## 风险说明

模型输出可能幻觉、误读盘口或遗漏伤停赛程信息。所有结果都是非财务建议、非稳赢预测。
