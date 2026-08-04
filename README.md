# 供应商简历与人员状态日报看板

已确认的外包公司权限隔离与面试官时间看板需求见 [`docs/outsourcing-permissions-and-interviewer-calendar-requirements.md`](docs/outsourcing-permissions-and-interviewer-calendar-requirements.md)。

项目使用 React + TypeScript + Vite 前端、Express + TypeScript 后端、Prisma ORM 和 PostgreSQL。候选人、导入任务、预览行、状态历史与操作日志由后端写入数据库；浏览器不保存数据库凭证，也不再使用 Mock 数据覆盖数据库查询结果。

## 本地启动

要求：Node.js 20+、Docker Desktop（或兼容的 Docker Compose）。

```bash
docker compose up -d postgres
npm install
cp .env.example .env
npm run db:generate
npm run db:migrate -- --name init_recruitment_database
npm run db:seed
npm run dev
```

默认地址：前端 `http://localhost:5173`，后端 `http://localhost:3001`。运行 `npm run db:studio` 可打开 Prisma Studio。

## 登录、角色与供应商隔离

除健康检查、腾讯会议 webhook 和携带一次性随机令牌的候选人自助约面接口外，所有业务 API 均要求 `Authorization: Bearer <token>`。会话令牌只以 SHA-256 哈希保存在 `AuthSession`；密码使用带随机盐的 scrypt 哈希。供应商范围由服务端根据当前会话决定，客户端传入其他 `supplierId`、供应商名称、候选人 ID、导入任务 ID 或 dashboardId 均不能扩大数据范围。

角色分为平台管理员、大部门负责人、内部招聘、视频招聘、音频招聘、供应商管理员、供应商视频专员和供应商音频专员。最终数据范围是“供应商范围 + 业务线范围”的交集；前端菜单仅优化体验，服务端 `buildDataScope` 对列表、详情、修改、导出、会议和看板接口统一强制范围。

Demo 账号密码不写入源码。初始化前在服务端环境设置 `DEMO_ACCOUNT_PASSWORD`，然后执行 `npm run db:seed`。Seed 会创建平台管理员、大部门负责人、视频/音频内部招聘、人瑞管理员与视频/音频专员、德科管理员与视频/音频专员；可登录平台管理员后在“用户管理”中重置各账号密码。

RBAC 迁移位于 `prisma/migrations/20260803010000_add_supplier_rbac`。

## 视频与音频招聘模块

系统仍共用一套登录、PostgreSQL、Express 服务、供应商、Kim 和腾讯会议接入。前端新增：

- `/dashboard`：综合招聘看板。
- `/video/dashboard`、`/video/candidates`、`/video/screening`、`/video/interviews`、`/video/onboarding`、`/video/risks`、`/video/suppliers`。
- `/audio/dashboard`、`/audio/candidates`、`/audio/screening`、`/audio/interviews`、`/audio/onboarding`、`/audio/risks`、`/audio/suppliers`。
- `/candidates`、`/interviews`、`/suppliers`：具备双业务线权限的综合页面。

`BusinessLine` 的 `VIDEO`、`AUDIO` 分别表示视频与音频部门；`UNCLASSIFIED` 仅用于内部待归类数据。`Candidate` 只作为候选人身份主档，供应商、业务线、岗位和招聘状态的权威数据保存在 `CandidateApplication`。同一候选人可以拥有视频和音频两条互不覆盖的应聘记录。

业务线迁移位于 `prisma/migrations/20260803020000_add_business_lines`。迁移会从旧岗位、部门和项目名称识别视频或音频，无法识别的旧记录写为 `UNCLASSIFIED` 并保留待归类标记，不删除旧数据。

创建账号时：平台管理员可选择全部部门角色和供应商；供应商管理员只能创建本公司的供应商视频专员、供应商音频专员或兼容招聘账号。视频专员的 API 范围固定为 `VIDEO`，音频专员固定为 `AUDIO`。

生产首次部署需在后端设置至少 12 位的 `BOOTSTRAP_ADMIN_PASSWORD`。服务启动时仅在不存在平台管理员的情况下创建一次账号，不会在后续重启中覆盖密码。

已有 `.env` 时不要覆盖，只需补充 `.env.example` 中的数据库和导入配置。生产环境必须覆盖 Compose 中的 Demo 密码，并确保 `.env` 不提交到版本库。

## 常用命令

```bash
npm run db:check       # PostgreSQL 连通性
npm run db:generate    # 生成 Prisma Client
npm run db:migrate     # 开发迁移
npm run db:deploy      # 部署已有迁移
npm run db:seed        # 初始化供应商、岗位与演示账号
npm test               # 导入、权限范围与原有提醒测试
npm run test:workflow:smoke          # 运行招聘全链路 API 回归（需已启动服务）
npm run test:feedback-reminder:smoke # 验证 24 小时面评催办幂等性（需 DATABASE_URL）
npm run build          # 前后端类型检查与生产构建
```

## 招聘全链路工作流

迁移 `prisma/migrations/20260804010000_add_recruitment_workflow` 增加了应聘状态事件、岗位面评模板、结构化面评、最终结论、Offer、职级调整、入职确认、接待任务与 Checklist、候选人自助约面邀请和服务端保存的筛选条件。

- 应聘状态只能通过白名单动作流转；直接修改应聘状态、面试结果或入职日期会被拒绝，状态事件与操作日志使用登录账号或候选人自助预约身份留痕。
- 招聘人员可直接排期，也可生成 72 小时有效的一次性链接，让候选人在 `/candidate/interview-booking/{token}` 自助选择三个候选时段。提交时使用 PostgreSQL advisory lock 再次检查面试官日历，并自动生成腾讯会议记录。
- 面评按岗位模板维度进行 1–5 分结构化评分；所有有效轮次提交完整面评后才能生成最终结论。面试结束 24 小时未提交会生成幂等催办记录。
- 面试通过后必须依次经过 Offer 待发起、已发出、候选人确认/拒绝/失效状态；候选人确认接受后才能回写入职日期。
- 入职确认会自动创建并指派接待任务，四项必填 Checklist 全部完成并回执后，应聘记录才进入“培训中”。
- AI 简历筛选结果与个人筛选条件均保存到 PostgreSQL，AI 结果只作辅助，不会自动淘汰候选人。

Excel 依赖已升级到 SheetJS `0.20.3`，消除了旧版 `xlsx 0.18.5` 的原型污染与 ReDoS 审计告警。

## Excel 导入流程

文件通过 multipart 上传到服务端非公开目录，服务端校验扩展名、MIME 和大小，随机重命名并计算 SHA-256。用户选择工作表和字段映射后，服务端最多解析 5000 行，统一清洗日期、手机号、邮箱、姓名和状态别名，再进行格式校验、批次内查重和数据库查重。预览按页存储并查询 `CandidateImportRow`。确认接口以任务状态更新作为幂等锁，按配置批量处理并写入候选人、状态事件和操作日志。

接口默认仅返回脱敏手机号与邮箱；原 Excel 二进制不会写入 PostgreSQL，数据库只记录受控的相对存储文件名、哈希和元数据。

## 上传 Excel 自动生成招聘看板

首页点击“文件生成看板”，或直接打开 `http://localhost:5173/auto-dashboard/upload`。选择不超过 15MB 的 `.xlsx`、`.xls` 或 `.csv` 文件后，服务端会读取最多 10000 行，忽略空白、说明和 `info` 工作表，自动识别多行表头、视频/音频面试、供应商分组行、供应商汇总以及左右并列的待入职名单。流程不包含字段映射、导入预览或人工确认。

上传前可选择视频部门、音频部门或综合文件。视频/音频专员由后端强制业务线且不显示选择器；供应商管理员只能选择视频或音频；内部账号可选择综合文件。综合文件按工作表名称和岗位关键词识别，音频、ASR、语音、转写归入 `AUDIO`，视频、Caption、GSB/SBS 归入 `VIDEO`，无法识别的数据保留为 `UNCLASSIFIED`。

AI 简历筛选从 `CandidateApplication.businessLine` 选择视频或音频规则，结果写入 `AIResumeScreeningResult`，仅作辅助而不会自动淘汰。面试从应聘记录继承候选人、供应商和业务线；Kim 日志与腾讯会议记录均绑定 `applicationId`、`interviewId`、`supplierId` 和 `businessLine`。

处理完成后会跳转到 `/dashboards/{dashboardId}`。看板及候选人明细保存在 PostgreSQL，刷新页面或重启服务后仍可访问。原始文件使用随机文件名保存在非公开的 `uploads/auto-dashboards` 目录；API 不返回服务器文件路径。

自动看板主要接口：

```text
POST /api/auto-dashboard/upload
GET  /api/auto-dashboard/tasks/:datasetId/status
GET  /api/auto-dashboard/:dashboardId
GET  /api/auto-dashboard/:dashboardId/{overview|funnel|suppliers|business-comparison|levels|interview-results|entry-status|interviews|candidates}
```

新增迁移已提交到 `prisma/migrations/20260802010000_add_auto_dashboard`。数据库启动和迁移命令：

```bash
docker compose up -d postgres
npm run db:generate
npm run db:deploy
```

解析规则测试可单独运行：`npm run test:auto-dashboard`。

## Demo 限制

- 本地必须自行安装并启动 Docker Desktop；如果已有 PostgreSQL，也可直接设置 `DATABASE_URL`。
- 腾讯会议与 Kim 仍依赖各自服务端环境变量，未配置时使用原有降级行为。
- 当前导入确认在应用进程内以数据库任务状态实现幂等；多实例高并发生产部署建议再增加 PostgreSQL advisory lock 或队列消费者。
- 前端生产包仍有体积告警，可后续对 ECharts、Ant Design 和 Excel 模块做路由级懒加载。
- Demo 的上传处理在单个 HTTP 请求内同步完成；前端展示阶段进度，生产环境处理超大文件时可改为任务队列和真正的后台进度推送。
- Excel 公式不会在服务端执行；仅能读取文件中已保存的公式缓存结果。未在 Excel 中重新计算并保存的公式可能没有可读结果。
