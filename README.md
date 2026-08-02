# 供应商简历与人员状态日报看板

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

已有 `.env` 时不要覆盖，只需补充 `.env.example` 中的数据库和导入配置。生产环境必须覆盖 Compose 中的 Demo 密码，并确保 `.env` 不提交到版本库。

## 常用命令

```bash
npm run db:check       # PostgreSQL 连通性
npm run db:generate    # 生成 Prisma Client
npm run db:migrate     # 开发迁移
npm run db:deploy      # 部署已有迁移
npm run db:seed        # 初始化供应商和岗位
npm test               # 导入核心规则与原有提醒测试
npm run build          # 前后端类型检查与生产构建
```

## Excel 导入流程

文件通过 multipart 上传到服务端非公开目录，服务端校验扩展名、MIME 和大小，随机重命名并计算 SHA-256。用户选择工作表和字段映射后，服务端最多解析 5000 行，统一清洗日期、手机号、邮箱、姓名和状态别名，再进行格式校验、批次内查重和数据库查重。预览按页存储并查询 `CandidateImportRow`。确认接口以任务状态更新作为幂等锁，按配置批量处理并写入候选人、状态事件和操作日志。

接口默认仅返回脱敏手机号与邮箱；原 Excel 二进制不会写入 PostgreSQL，数据库只记录受控的相对存储文件名、哈希和元数据。

## 上传 Excel 自动生成招聘看板

首页点击“文件生成看板”，或直接打开 `http://localhost:5173/auto-dashboard/upload`。选择不超过 15MB 的 `.xlsx`、`.xls` 或 `.csv` 文件后，服务端会读取最多 10000 行，忽略空白、说明和 `info` 工作表，自动识别多行表头、视频/音频面试、供应商分组行、供应商汇总以及左右并列的待入职名单。流程不包含字段映射、导入预览或人工确认。

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
