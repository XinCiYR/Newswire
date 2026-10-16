# 新闻聚合站：性能、采集质量与自动验证迭代

日期：2026-10-16。本轮基于前次审查继续修改本地代码，没有提交、推送、部署或连接业务数据库。

## 已实现的四项改进

| 项目 | 具体结果 | 主要修改位置 |
| --- | --- | --- |
| 收藏批量查询 | 新闻列表、搜索、精选、相关文章、历史按页一次查询收藏；匿名请求不查询；复制对象避免缓存污染；收藏页复用 total，省去重复 COUNT | `server/src/models/favorites.js`，`routes/articles.js`、`history.js`、`favorites.js` |
| 数据库索引 | 指纹/发布时间索引、来源/发布时间/ID 组合索引，PostgreSQL 额外添加全文搜索 GIN 表达式索引；查询与索引共用同一表达式 | `server/src/db/schema.js`、新增 `db/search.js`、`models/articles.js` |
| PostgreSQL/Docker 自动验证 | 相同集成套件可使用 SQLite 或真实 PostgreSQL；PG 每个测试进程创建随机临时 schema，结束后清理；新增 GitHub Actions：SQLite/前端、PG 16/18、Docker 双数据库启动与持久性 | `.github/workflows/verify.yml`、`server/test/helpers/database.js`、`server/scripts/test-postgres.mjs`、`scripts/docker-smoke.mjs` |
| 采集和分类 | 实际并发池、HTTP 流式/解压后字节限制、完整请求超时、条件请求/304；只有入库成功才保存验证器，写入失败进入错误摘要；英文词/短语完整匹配、常见复数、Unicode/连字符规范化，保留中文规则 | `server/src/scraper/fetch.js`、`worker.js`、`classify.js`、新增 `utils/concurrency.js`、`models/sources.js`、`config.js`、`db/migrate.js` |

PostgreSQL GIN 用于全文搜索的依据见 [PostgreSQL 官方说明](https://www.postgresql.org/docs/current/textsearch-indexes.html)。
新增 PG 索引采用 `CREATE INDEX CONCURRENTLY`，在事务外执行；自动列迁移限定 `current_schema()`，避免同名表位于其他 schema 时误判列已存在。

## 配置和迁移

```dotenv
SCRAPE_CONCURRENCY=4
SCRAPE_TIMEOUT_MS=20000
SCRAPE_MAX_RESPONSE_BYTES=2097152
```

并发取值限制在 1–16；非法整数回退默认值。响应上限按流读取的字节计算，同时检查 Content-Length，包括 gzip 解压后的内容。
每个源独立处理超限、HTTP 错误、超时和 XML 错误，继续采集其他源。

启动自动新增 `sources.etag`、`sources.last_modified` 和索引。现有新闻不会批量重分类，也不删除业务数据。
新入库新闻使用新分类规则；原来人工修正的分类不受影响。

第一次部署时 PG 索引构建可能增加启动时长和磁盘/CPU 使用；应观察迁移日志和数据库活动。
这些索引是性能优化，不改变查询返回格式。验证器在迁移后第一次采集成功时开始填充，后续未变化的源返回 304，避免重新下载和解析。

## 自动化验证入口

本地 SQLite/前端回归：

```powershell
npm test
npm --prefix client run smoke:test
```

独立 PostgreSQL 测试库：

```powershell
$env:TEST_DATABASE_URL = 'postgres://test_user:test_password@127.0.0.1:5432/newswire_test'
npm run test:postgres
Remove-Item Env:TEST_DATABASE_URL
```

仅使用 `TEST_DATABASE_URL`，不回退到业务 `DATABASE_URL`。测试账户需要在专用测试库中创建/删除 schema 和索引的权限。
每个测试进程有独立 schema；结束时仅删除本次生成的 schema。

Docker 引擎可用时：

```powershell
npm run test:docker
```

脚本自动构建临时镜像并启动测试 PostgreSQL、SQLite/PG 两种应用容器；检查健康接口、默认源、更新日志、SPA/静态 JS、注册、收藏、历史、令牌刷新、全文搜索，以及应用重启后收藏仍存在。
容器、网络、卷和镜像使用随机专用名称；`finally` 中仅清理本轮测试资源。
脚本不调用外部 RSS，也不需要已有业务密钥。

GitHub Actions 在 push、pull_request 或手动 workflow_dispatch 时运行三个 job：

1. `sqlite-and-client`：后端与客户端回归、构建后 DOM 冒烟。
2. `postgres`：PostgreSQL 16 和 18 真实服务，运行同一套后端测试和 GIN 查询计划检查。
3. `docker`：Linux runner 构建并执行上述 SQLite/PG 两种容器验证。

工作流动作版本按 [checkout](https://github.com/actions/checkout) 与 [setup-node](https://github.com/actions/setup-node) 官方用法配置，运行 Node 24；检出后不保留 Git 凭据。

## 本机已完成的验证

- `npm test`：后端 26 项、前端 5 项，共 31/31 通过。
- `npm --prefix client run smoke:test`：前端构建与临时 API 的 DOM 冒烟通过；46 个后端/测试/脚本 JS 文件语法检查和 `git diff --check` 通过。
- 100 条新闻列表与搜索：断言每个接口仅 1 次收藏查询；精选/相关/历史同样各 1 次，匿名 0 次。
- SQLite `EXPLAIN QUERY PLAN` 确认来源与指纹索引被使用；迁移可重复执行。
- 本地 HTTP fixture 实测 RSS/Atom、ETag/Last-Modified/304、Content-Length 超限、分块超限、gzip 解压超限、头部/正文超时、HTTP/XML 错误。
- 6 个本地测试源，并发设置为 2，实测最大同时请求数为 2，全部入库。
- 模拟真实数据库写入约束错误：错误进入摘要、验证器不保存，下一次能够完整重试。
- 分类 fixture 覆盖七个分类、复数、中文、Unicode 短语；`rain`、`chair`、`happy` 等词不再误触发 AI/AR/app 子串规则。

本机未安装 Docker，也未提供专用 PostgreSQL 服务；已执行这两个入口并确认缺失前置条件会明确失败，不会假报通过。
因此 **PG 16/18 与容器运行结果仍待 CI 执行确认**；不能把工作流已添加等同于线上或 CI 已通过。

## 本轮尚未覆盖的边界

- 分类仍是规则模型，fixture 通过不代表真实新闻总体准确率已测量；后续需人工标注样本。
- 保留现有跨源标题去重策略、事件相似度算法与进程内任务锁。
- 没有新增逐跳 DNS/重定向的内网地址检查；管理员仍应只添加可信源。
- 未做线上压测，不宣称具体延迟提升倍数；本轮可证明的是收藏查询次数从逐条变成按页，以及采集资源上限生效。
