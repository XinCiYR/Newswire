# 项目代码审查与迭代建议

审查日期：2026-10-16。范围：本地仓库的前后端源码、测试、构建脚本和部署配置。
后续四项性能/采集/自动验证迭代已实现，见 `ITERATION_NOTES.md`；下文保留初次审查时的发现与建议，部分待办现已完成。
本轮没有访问线上数据库、触发线上采集或发布代码。所有自动化验证使用临时测试数据库。

## 1. 项目结构与数据流

项目是单体部署的英文新闻聚合站：React SPA + Express API + 可切换的 SQLite/PostgreSQL。
当前默认 10 个 RSS/Atom 新闻源、7 个分类；不采集文章全文，只展示摘要并链接原文。

| 目录/文件 | 职责与关键入口 |
| --- | --- |
| `server/src/index.js` | 启动迁移、空库新闻源初始化、HTTP 服务和定时采集 |
| `server/src/app.js` | Express 中间件、API 路由、静态资源、SPA 回退、错误处理 |
| `server/src/config.js` | 环境变量、密钥校验、采集/保留策略、精选权重、管理员配置 |
| `server/src/db/` | 双数据库适配、建表和增量列迁移、默认数据、过期清理 |
| `server/src/models/` | 用户、新闻、来源、收藏和历史的参数化 SQL |
| `server/src/auth/` | scrypt 密码、JWT、权限中间件、刷新令牌会话 |
| `server/src/routes/` | 认证、新闻/搜索、每日精选、收藏、历史、来源、cron、更新日志 API |
| `server/src/scraper/` | 10 个默认源、RSS 解析、分类、采集任务、进程内调度和防重入 |
| `server/src/services/daily.js` | 新鲜度、来源权重、跨源覆盖打分与分类配额、精选缓存 |
| `client/src/App.jsx` | 页面路由与公共页脚 |
| `client/src/api.js`、`auth.jsx`、`hooks.js` | 请求/自动刷新、认证状态、列表加载和请求竞态控制 |
| `client/src/pages/` | 首页、分类、搜索、文章、精选、收藏、历史、认证、更新日志 |
| `client/src/components/`、`styles.css` | 卡片、导航、筛选、分页、收藏、主题和响应式样式 |
| `client/scripts/` | 构建 HTML 入口生成与产物冒烟测试 |
| `server/test/`、`client/test/` | 接口、配置、限流、认证并发、组件回归测试 |
| `Dockerfile`、`docker-compose.yml`、`render.yaml`、`railway.json` | 容器/平台部署 |

采集链路：定时器/带密钥的 cron → 并行拉 RSS → 清洗标题摘要/日期/URL → 关键词分类 → URL/标题指纹查重 → 写新闻 → 保留策略清理 → 写采集健康状态。

阅读链路：React → `/api/*` → 路由/权限 → models → 数据库。新闻列表支持分类、来源、时间、分页与热度；搜索分别使用 SQLite FTS5 与 PostgreSQL 全文检索表达式。

主要表：`users`、`sources`、`articles`、`favorites`、`history`、`app_meta`；本轮增加 `refresh_tokens`，SQLite 另有 `articles_fts`。

## 2. 已直接修复的问题

### 高优先级

| 问题与影响 | 修复 | 修改位置 |
| --- | --- | --- |
| 时间筛选在每次渲染时重新执行 `Date.now()`，参数不断变化，可形成持续请求 | 首页/分类页使用 `useMemo` 保持筛选参数稳定 | `client/src/pages/HomePage.jsx`、`CategoryPage.jsx` |
| 普通注册用户可添加任意采集地址、修改公共分类；添加内网 feed 可让服务器请求内网 | 新增管理员权限，只允许 `ADMIN_USER_IDS` 中的现有账户执行；前端同步隐藏普通用户分类编辑入口 | `server/src/auth/middleware.js`、`config.js`、`models/users.js`、`routes/sources.js`、`routes/articles.js`、`client/src/pages/ArticlePage.jsx` |
| refresh 接口只是重新签名，旧刷新令牌继续有效，同秒还可能得到相同令牌；登出后的访问令牌仍可用 | 添加随机 `jti`、刷新令牌摘要表，以原子更新实现单次轮换；访问令牌校验用户版本，登出即时撤销 | `server/src/auth/jwt.js`、新增 `auth/sessions.js`、`db/schema.js`、`routes/auth.js`、`auth/middleware.js` |
| 多请求同时收到 401 会各自刷新；延迟刷新可覆盖退出登录后的本地状态 | 合并同一会话的刷新请求，检查刷新完成时会话是否仍匹配，临时刷新故障保留会话并返回可重试错误 | `client/src/api.js`、`auth.jsx` |
| 每日精选直接返回共享缓存对象，附加用户收藏标记会污染缓存；匿名/并发请求可拿到别人的收藏状态 | 返回每次请求独立的对象副本；新闻新增、改分类和清理后使缓存失效 | `server/src/services/daily.js`、`models/articles.js`、`db/cleanup.js` |
| 生产环境缺失密钥时静默使用公开的开发密钥，可伪造 JWT 或调用 cron | 生产启动校验密钥长度/占位值和 JWT 密钥分离；Compose 要求明确提供密钥 | `server/src/config.js`、`docker-compose.yml` |
| Docker 使用 Node 20，但服务无条件导入 `node:sqlite`，即便配置 PostgreSQL 也会启动失败；未打包更新日志 | 构建和运行统一 Node 24；打包更新日志到不受数据库卷覆盖的代码目录 | `Dockerfile`、`server/src/routes/meta.js`、各 `package.json`、`render.yaml` |

`node:sqlite` 的版本要求参考 [Node.js 官方文档](https://nodejs.org/api/sqlite.html)；本轮统一使用已在本地验证的 Node 24.x。

### 其他确定性错误及相关完善

| 问题与修复 | 修改位置 |
| --- | --- |
| SQLite 搜索忽略 `since`；纯标点搜索生成非法 MATCH；PG 分支重复同一时间条件。现已修复 | `server/src/models/articles.js` |
| 负数 `limit` 在 SQLite 可绕过分页上限，在 PostgreSQL 会报错。统一校验分页/来源/时间参数，限制搜索长度 | 新增 `server/src/utils/query.js`、`routes/articles.js`、`favorites.js`、`history.js` |
| auth 与 cron 限流器共享 Map，互相消耗次数，过期 IP 记录长期不释放。改为独立计数和过期清理；增加代理跳数配置 | `server/src/middleware/rateLimit.js`、`app.js`、`config.js` |
| RSS/来源 URL 未限定协议。统一只接受无嵌入凭据的 HTTP(S) 地址，避免危险链接进入页面 | 新增 `server/src/utils/url.js`、`scraper/fetch.js`、`routes/sources.js` |
| 清理时再次检查收藏保护，避免“先选中待删文章，后新增收藏”的窗口；只删除已不存在文章的 FTS 条目 | `server/src/db/cleanup.js` |
| 收藏按钮不响应新初始值和账户切换；列表/详情/精选未在用户变化后重新加载。已同步处理 | `client/src/components/FavoriteButton.jsx`、`hooks.js`、`pages/ArticlePage.jsx`、`DailyPage.jsx` |
| 搜索翻页后改关键词沿用原偏移量。偏移量改由 URL 管理，新的搜索 URL 自动从第一页开始 | `client/src/pages/SearchPage.jsx` |
| 跨源覆盖匹配计入常见词和原来源自身。过滤停用词并排除原来源 | `server/src/models/articles.js`、`services/daily.js` |
| SPA 深层 URL 的 HTML 没有明确禁止缓存。统一 `no-store` 策略 | `server/src/app.js` |
| 默认 `npm test` 在当前环境不能识别 `test/`，客户端 package 与 lock 的构建依赖声明不一致。修正脚本、依赖声明与锁文件 | 根/前后端 `package.json`、前后端 `package-lock.json` |
| Docker 构建上下文会包含本地依赖、环境文件、数据库。新增忽略规则 | 新增 `.dockerignore` |
| 构建冒烟脚本靠目录中的第一个 JS 定位入口、写死 4000 端口。改读构建 HTML 入口并支持临时端口；新增隔离测试启动器 | `client/scripts/smoke.mjs`、新增 `smoke-test.mjs` |
| 更新操作文档、配置示例和交接提示 | `.env.example`、`README.md`、`DEPLOYMENT.md`、`HANDOFF.md`、本报告 |

说明：管理员仍须只添加可信新闻源。本轮关闭了普通用户通过添加来源触发服务器任意请求的入口；尚未实现 DNS/重定向逐跳内网地址检查和出口网络隔离。

## 3. 验证结果与范围

- 初始直接运行既有集成文件：5/5 通过，但默认 `npm test` 入口失败。
- 修复后 `npm test`：后端 12 项、前端 5 项，共 17/17 通过。
- 覆盖：注册/登录/收藏/历史原流程、普通用户管理越权、管理员身份、令牌并发轮换/重放/登出、精选用户状态隔离、搜索时间条件/标点/分页边界、收藏文章保留、限流器隔离、生产密钥校验、前端并发刷新/退出竞态、首页/分类时间筛选请求次数。
- `npm --prefix client run smoke:test`：esbuild 产物构建成功；对临时 API 服务进行 jsdom 渲染，文章卡片、分类计数、标题和渐变卡片均通过。
- 本轮构建 JS 约 203.6 KB（minify 后、gzip 前）；没有进行线上压力测试。
- 测试结束关闭并删除本轮临时数据库；没有修改现有 `server/data/news.sqlite`。
- 当前环境没有 Docker/PostgreSQL 可执行服务，未实际构建容器或执行 PostgreSQL 集成测试；部署配置和 PG SQL 分支属于静态审查。jsdom 不等同真实浏览器视觉/布局验收。

## 4. 部署此版本时的实际变化

1. 使用 Node 24.x；生产环境设置三个不同用途的随机密钥，每个至少 32 字符，JWT 两个密钥必须不同。
2. 首次启动会自动添加 `refresh_tokens` 表及索引，不删除已有用户、新闻、收藏和历史；旧令牌会话需要重新登录一次。
3. 管理权限默认关闭。登录已有、确认由自己控制的账户，从 `/api/auth/me` 获取 ID，然后设置 `ADMIN_USER_IDS`，例如 `4,12`。不能按未创建账户的猜测 ID 授权。
4. `TRUST_PROXY` 与实际反向代理跳数一致：直接本地访问通常为 0，当前 Render 配置提供 1。
5. 代码只在本地修改和验证；尚未提交、推送或部署。

## 5. 迭代建议（按收益与风险排序）

### P1：下一轮优先做

1. **消除收藏 N+1 查询。** 登录用户读取 100 条新闻会再触发最多 100 次 `isFavorited`，在远程 PostgreSQL 上浪费往返；精选/历史/相关文章也存在同样模式。用一个批量 `IN` 查询或 JOIN/EXISTS 返回收藏状态，再测 SQL 次数和 p95 延迟。
2. **补关键索引并测执行计划。** PostgreSQL 搜索当前每次计算 `to_tsvector`，缺少匹配表达式的 GIN 索引；指纹查重和按来源保留也没有针对性索引。优先评估 GIN、`articles(fingerprint)`、`articles(source_id,published_at DESC,id DESC)`，通过 `EXPLAIN ANALYZE` 决定，避免直接引入 Redis 掩盖慢查询。
3. **补真实 PostgreSQL 与部署 CI。** 自动运行 SQLite/PG 两套集成、客户端测试/构建、Docker 启动及更新日志接口检查。当前生产使用 PG，而原测试只覆盖 SQLite，是最明显的验证缺口。
4. **提高采集可控性。** 当前 `Promise.all(sources.map(...))` 实际没有并发上限；源增加后应限制同时请求数量，增加响应体大小上限、ETag/Last-Modified 条件请求、重定向/DNS 内网防护。数据库/写入错误应进入总 `summary.errors`，避免健康状态漏报。
5. **修正分类与事件匹配质量。** 分类器使用 `includes` 子串，`ai` 可能命中普通单词的一部分；英文词/短语按词边界匹配，建立人工标注样本和分类准确率。跨源“同一事件”目前只凭两个标题词，建议实体/时间窗口/相似度阈值并展示可追溯证据。
6. **保证历史和去重在并发下的一致性。** 历史当前 DELETE + INSERT 没有用户/文章唯一约束；采集防重入仅限单进程，横向扩容或 CLI 同时运行仍可能竞争。后续做历史唯一约束和 UPSERT、数据库级任务锁与并发安全入库。

### P2：性能和体验提升

1. **路由懒加载与字体子集。** 当前所有页面打进约 204 KB 的单个 JS，字体导入含多个语言子集。先限制为实际需要的英文 latin 字体，再按路由拆包；构建入口应使用 esbuild metafile，而不是扫描 mtime 选最新文件。以真实网络下的 LCP/INP 和首屏字节量验收。
2. **稳定翻页与收藏分页。** 相同发布时间的列表缺少唯一 ID 次序；深 OFFSET 随数据量增加会变慢。改为时间/ID 双排序，必要时用游标分页；收藏页当前只请求 200 条，多出的收藏无法查看。
3. **认证状态与收藏同步。** 增加跨标签页的刷新协调（BroadcastChannel/Web Locks 等）与收藏变更广播；本轮只合并同一 JS 页面内的并发刷新。评估刷新令牌迁移到 HttpOnly Cookie，并配套 CSRF/Origin 策略。
4. **每日精选控制计算和时间语义。** 当前最多 400 个候选两两比较，约 O(n²)；按关键词倒排索引聚合候选，合并并发重算。明确精选以 UTC、站点时区还是用户时区计算，避免前端“今天”与接口日期不一致。
5. **SEO 与可访问性。** 客户端写 meta 对不执行 JS 的分享抓取器作用有限，可预渲染/服务端生成文章 meta。下拉选项应支持焦点、方向键、Enter 和读屏；补手机宽度与真实浏览器自动化检查。
6. **可观测性与恢复能力。** 数据库备份/恢复演练优先于功能扩展；增加结构化日志、数据库 readiness、采集延迟/失败率告警。浏览量需要访问频率控制和去重，否则热榜容易被脚本或重复浏览操纵。

### P3：业务功能扩展

在核心查询、采集质量和部署保障稳定后，再考虑管理员来源面板、个性化订阅、摘要邮件、OAuth、RSS 输出、PWA 和多语言。
其中来源面板应配合明确的源启停/同步流程：当前启动只给空表初始化；修改默认源常量不会自动同步已有数据库。
