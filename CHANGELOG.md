# 改动日志

## 2026-07-27

13 次提交，48 个文件，+3576 / −6318 行。测试 190 → 188 条：删掉 4 个只针对旧界面的测试文件，新增泊松、模型连通性、返回栈、后台等测试。全程绿灯，每次提交都通过 CI 部署到生产。

凌晨两次提交是前端样式收尾（移动端 logo、滚动时的毛玻璃导航栏、Figma 38:402 的 Start Predicting 按钮），下面记录的是白天这一轮。

---

### 前端

**移除 Top Picks 板块** · `0faee30`

结果页把同一批预测展示了两遍——先是几张市场卡片，再是一长串带理由、置信度、风险的 Top Picks 列表。删掉后者，只留五张市场卡（比分 / 大小球 / 亚盘 / 双方进球 / 独赢）。后端返回的字段一个没动，只是不再全部铺在页面上。

**浏览器返回键逐级回退** · `0bf9c6e`

之前整个应用完全没接 History API：页面切换只是 React state，URL 始终是 `/`，历史栈里只有一条记录，所以按返回键等于直接退出应用。两个自带返回按钮也硬编码跳回首页，从「我的预测 → 某场结果」返回时会跳错地方。

现在每次页面/弹层变化都压一条历史记录，`popstate` 时还原。自带返回按钮走同一条 `history.back()`，行为完全一致。弹层的关闭动作是出栈而不是压栈——否则关掉登录框后按返回反而会把它弹回来。登录成功和登出用 `replaceState`，避免返回到已完成的登录页。URL 保持不变，直接访问和刷新的行为没有变化。

**一键预测** · `4150150` `ea54602`

原来点「Start Predicting」要走三步：卡片 → 跳到设置页选模型 → 再点一次 → 确认弹窗。

改成一步：点卡片，卡片当场变成「Analyzing...」转圈，可以继续翻列表，完成后弹出「Prediction ready」，点它看结果。这个流程其实本来就设计好了——卡片的转圈状态、ready 提示都一直在，只是接线接到了「跳转详情页」上。

同时删掉了那个四选一的模型选择器。**它从共享预测池上线那天起就是假的**：`/api/rankings` 只要有 fixtureId 就完全忽略 `body.model`，由 `resolveOptimizedPrediction` 自己按配置决定跑谁。所以点 GPT、点 Claude、点 Qwen，后端跑的都是同一个模型。四个按钮承诺了一个不存在的选择。

**免费预测确认** · `1bb7cf7`

一键化之后，未登录用户点一下就会直接消耗掉唯一的免费预测。补回确认弹窗，但只对没有套餐的用户弹；有套餐的用户仍然一键直达。弹窗从详情页挪到外层 shell，卡片和详情页共用同一道关卡。

---

### 预测质量与成本

**移除 DeepSeek** · `0fc8401`

从模型表、策略别名、后台共享池列、前端模型条、旧控制台按钮里全部摘除。保留了 `deepseek` 的 key 归一化函数，这样历史快照和用量记录不会变成「未知模型」。

**修复 OpenRouter 成本统计** · `2562ca1`

OpenRouter **只有在请求里带 `usage: {include: true}` 时才回传 cost**，而代码从来没带过。加上 `model-cost.js` 里没有 OpenRouter 的价目表，所以 Qwen——早期阶段的冠军模型，也就是绝大多数预测——成本一直记成 0。

修法是让 OpenRouter 自己报价，而不是硬编一张会过期的价目表。APIMart 和 OpenAI 的请求体没动，它们不认这个字段。

**泊松先验层** · `2562ca1`

新增 [`src/poisson.js`](src/poisson.js)，纯代码零 token。用赛季进球记录拟合，输出双方预期进球、胜平负概率、概率最高的 6 个比分、五条大小球线、双方进球概率。

两个实现细节：

- **优先用主客场拆分数据**。球队的主场进球率本身已经包含主场优势，再乘一个通用系数就是重复计算。顺带补上了 `api-football.js` 里被丢弃的主客场拆分字段——原来只保留了赛季总数。只有拆分数据缺失时才回退到「赛季总数 × 主场系数」。
- **截断尾部后重新归一化**。网格算到 8:8，剩余概率摊回去，保证每个市场的概率严格等于 1。

接入方式：作为 `statisticalBaseline` 进 prompt，并加了一条规则——这是先验分布，除非阵容、伤停、盘口变动有理由，否则不要偏离；偏离时必须在 reason 里点名证据。约 300 tokens，相对于本来就在发的全量 catalog 可忽略。baseline 同时存进 ranking，便于赛后对比「模型 vs 纯数学基线」谁更准。

数据不足的比赛返回 `available: false` 加具体原因，预测流程照旧。

---

### 模型路由

**几轮试错，最终结论** · `1bb7cf7` `83df4ef` `0d9a597` `0fdac4a`

目标是全部迁到 OpenRouter，统一成本回传、少管两把 key。实测结果：

| 模型 | OpenRouter |
|---|---|
| `qwen/qwen3.7-max` | ✅ 200 |
| `openai/gpt-5.5` | ❌ 403 |
| `anthropic/claude-opus-4.8` | ❌ 403 |
| `google/gemini-3.1-pro-preview` | ❌ 403 |

用不存在的 model id 对照测试返回的是 **400 `is not a valid model ID`**，而这三个是 **403 `violation of provider Terms Of Service`**——说明 slug 全对，是地域拦截。OpenRouter 后台的提示证实了这一点：billing address 所在地区没有 OpenAI / Anthropic / Google 的访问权限。**改 billing address 后重测，403 依旧。**

中途曾把全部四个切到 APIMart（实测都能跑），但那样 GPT 和 Qwen 会失去成本数据——APIMart 不回传 cost，本地价目表里也没有这两个的单价。而 Qwen 是冠军模型，等于最大的开销变成黑洞。

**最终配置**：GPT → OpenAI 直连，Claude / Gemini → APIMart，Qwen → OpenRouter（唯一能回传真实成本的一条）。

配套改动：

- provider 不再从 model id 推断，只从 `MODEL_<NAME>_PROVIDER` 读——静默切换到别的服务商，正是调用失败时没人会想到去查的东西
- 模型 id 从 secret 移到 `wrangler.jsonc` 的 vars（**Cloudflare 的 secret 会覆盖同名 var，旧 secret 要删掉**）
- 新增 `OPENROUTER_PROVIDER_IGNORE` / `OPENROUTER_PROVIDER_ORDER`，用于绕开拒绝特定地域的上游服务商
- 新增管理员专用的模型连通性检查（后台 → 模型 → 开始检查），从 Worker 里逐个 ping。**本地结果不代表生产**：Cloudflare 是用自己的网络出站的

---

### 运营后台

**用 React 重写并合并** · `dcadc4e`

旧的 `/admin` 跑在 3168 行的原生 JS shell 上，同一个文件还扛着公开赛程页、`/backend` 数据控制台、`/analytics`、`/history`——前两个早就被新前端取代了。

重写成第二个 React shell，与主应用共用构建管线、依赖和 API client（Vite 双入口，React 和 Supabase 提到共享 chunk，admin 自己的 JS 只有 44KB）。数据控制台折进来当一个标签页，赛程缓存和解释它的看板终于在同一个登录后面。

六个标签替代原来的八个 + 独立控制台：总览、数据控制台、模型、预测、准确率、账号。`/analytics`、`/backend`、`/data`、`/history` 全部 301 跳转到 `/admin`。

删 shell 就要删它的接口——既然没有任何地方能再写入 markets，这些路由永远不可能成功，一并删除：`/api/sample`、`/api/import/text`、`/api/import/chrome`、`/api/markets` 读写、`/api/predict/:id`（这个只能返回 "Market not found"）。Supabase UMD 副本和它的 postinstall 步骤也跟着删了。

保留了「端点覆盖」这个设计：点开某场比赛会明确列出 fixtures / lineups / injuries / odds 每个端点到底抓到没有。数据稀薄的比赛不能伪装成正常的。

**中英文切换** · `4150150`

所有文案集中到 [`adminCopy.ts`](frontend/src/adminCopy.ts) 一张表，右上角 EN / 中文 切换，存 localStorage，首次访问按浏览器语言判断。加了测试确保每条文案都有中英两版、组件里不留硬编码文案。

**两张表的精简** · `0fdac4a`

- **共享预测池**：原来固定四列（GPT / Claude / Gemini / Qwen），绝大多数格子是「—」。某个模型压根没被请求过不是信息，而且它把真正重要的 `failed` 淹没了。改成一列 chips 只列实际跑过的模型，失败标红并附提示，另加独立的阶段列（early / live）——之前得从 chips 颜色里猜。
- **已结算预测**：同一场比赛、同一模型、同一终场比分重复四行，只有玩法不同。改成按比赛分组，组头带命中率并按全中 / 部分 / 全错变色，玩法收在下面。

---

### 已知待办

- `src/` 里的模块级死代码：`predictMarket`、`parser.js`、`dongqiudi*.js` 三个文件、`domain.js` 的相关辅助函数
- APIMart 对 `gpt-5.5` 和 `qwen3.7-max` 的单价未知，若这两条链路改走 APIMart，后台会标成 `unpriced`
- 是否收缩到五大联赛 + 欧冠欧联（建议收缩：小联赛 lineup / injuries / odds 覆盖率低，模型等于裸猜，还照样烧全额 token，同时拖垮准确率指标）
