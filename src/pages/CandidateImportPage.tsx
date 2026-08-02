import { useEffect, useState } from "react";
import {
  Alert,
  Badge,
  Button,
  Card,
  Descriptions,
  Empty,
  Input,
  Select,
  Space,
  Steps,
  Table,
  Tag,
  Typography,
  Upload,
  message,
} from "antd";
import {
  DownloadOutlined,
  LeftOutlined,
  ReloadOutlined,
  UploadOutlined,
} from "@ant-design/icons";
import type { Candidate } from "../types/recruitment";
import { downloadImportTemplate } from "../utils/candidateImport";
import { api } from "../api/backend";

type TaskStatus =
  | "UPLOADED"
  | "PARSING"
  | "WAITING_MAPPING"
  | "WAITING_CONFIRMATION"
  | "IMPORTING"
  | "COMPLETED"
  | "PARTIAL_FAILED"
  | "FAILED";
interface ImportTask {
  id: string;
  originalFileName: string;
  status: TaskStatus;
  totalRows: number;
  validRows: number;
  warningRows: number;
  invalidRows: number;
  duplicateRows: number;
  importedRows: number;
  skippedRows: number;
  failedRows: number;
}
interface ImportRow {
  id: string;
  rowNumber: number;
  name?: string;
  phoneMasked?: string;
  supplierName?: string;
  positionName?: string;
  university?: string;
  validationStatus: "VALID" | "WARNING" | "INVALID";
  errors: string[];
  warnings: string[];
  duplicateLevel: string;
  duplicateReasons: string[];
  handlingAction: string;
  importStatus: string;
  failureReason?: string;
}
interface Preview {
  task: ImportTask;
  summary: {
    total: number;
    valid: number;
    warning: number;
    invalid: number;
    duplicate: number;
  };
  rows: ImportRow[];
  pagination: { page: number; pageSize: number; total: number };
}
interface Props {
  existing?: Candidate[];
  onBack: () => void;
  onImport?: (rows: Candidate[]) => void;
  onComplete?: () => void;
}
const fieldLabels: Record<string, string> = {
  name: "候选人姓名",
  phone: "手机号",
  email: "邮箱",
  supplier: "供应商",
  position: "岗位",
  projectName: "项目",
  university: "大学",
  major: "专业",
  highestEducation: "学历",
  graduationYear: "毕业年份",
  resumeSubmitDate: "简历提交日期",
  currentStatus: "当前状态",
  expectedEntryDate: "预计入职日期",
  actualEntryDate: "实际入职日期",
  leaveDate: "离职日期",
  remark: "备注",
};
const duplicateLabels: Record<string, string> = {
  NONE: "无重复",
  EXACT: "确定重复",
  HIGH_SUSPECT: "高度疑似",
  SAME_NAME_DIFFERENT_PERSON: "同名不同人",
  MANUAL_REVIEW: "人工复核",
};
const validationLabels = { VALID: "通过", WARNING: "警告", INVALID: "失败" };

export default function CandidateImportPage({ onBack, onComplete }: Props) {
  const [step, setStep] = useState(0),
    [busy, setBusy] = useState(false),
    [taskId, setTaskId] = useState(""),
    [fileName, setFileName] = useState(""),
    [sheets, setSheets] = useState<string[]>([]),
    [sheetName, setSheetName] = useState(""),
    [headers, setHeaders] = useState<string[]>([]),
    [mapping, setMapping] = useState<Record<string, string>>({}),
    [preview, setPreview] = useState<Preview>(),
    [page, setPage] = useState(1),
    [validationStatus, setValidationStatus] = useState<string>(),
    [duplicateLevel, setDuplicateLevel] = useState<string>(),
    [keyword, setKeyword] = useState(""),
    [history, setHistory] = useState<ImportTask[]>([]);
  const [msg, holder] = message.useMessage();
  const loadHistory = () =>
    api<{ rows: ImportTask[] }>("/api/imports/candidates?page=1&pageSize=10")
      .then((data) => setHistory(data.rows))
      .catch(() => undefined);
  useEffect(() => {
    void loadHistory();
  }, []);
  const loadPreview = async (nextPage = page) => {
    if (!taskId) return;
    const params = new URLSearchParams({
      page: String(nextPage),
      pageSize: "20",
    });
    if (validationStatus) params.set("validationStatus", validationStatus);
    if (duplicateLevel) params.set("duplicateLevel", duplicateLevel);
    if (keyword) params.set("keyword", keyword);
    setBusy(true);
    try {
      setPreview(
        await api<Preview>(
          `/api/imports/candidates/${taskId}/preview?${params}`,
        ),
      );
      setPage(nextPage);
    } catch (error) {
      msg.error((error as Error).message);
    } finally {
      setBusy(false);
    }
  };
  useEffect(() => {
    if (step === 3 && taskId) void loadPreview(1);
  }, [step, taskId, validationStatus, duplicateLevel]);
  const applyParsed = (data: {
    headers?: string[];
    mapping?: Record<string, string>;
    sheets?: string[];
    requiresSelection?: boolean;
  }) => {
    setSheets(data.sheets || sheets);
    if (data.requiresSelection) {
      setStep(1);
      return;
    }
    setHeaders(data.headers || []);
    setMapping(data.mapping || {});
    setStep(2);
  };
  const upload = async (file: File) => {
    if (!/\.(xlsx|xls|csv)$/i.test(file.name)) {
      msg.error("仅支持 .xlsx、.xls 或 .csv 文件");
      return;
    }
    setBusy(true);
    try {
      const form = new FormData();
      form.append("file", file);
      form.append("uploadedBy", "招聘专员");
      const uploaded = await api<{
        taskId: string;
        fileName: string;
        duplicateFile?: { taskNo: string };
      }>("/api/imports/candidates/upload", { method: "POST", body: form });
      setTaskId(uploaded.taskId);
      setFileName(uploaded.fileName);
      if (uploaded.duplicateFile)
        msg.warning(
          `相同文件曾以任务 ${uploaded.duplicateFile.taskNo} 上传，本次将创建新任务供复核`,
        );
      const parsed = await api<any>(
        `/api/imports/candidates/${uploaded.taskId}/parse`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: "{}",
        },
      );
      applyParsed(parsed);
      msg.success("文件已安全上传并由后端解析");
    } catch (error) {
      msg.error((error as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const selectSheet = async () => {
    if (!sheetName) return msg.warning("请选择工作表");
    setBusy(true);
    try {
      applyParsed(
        await api<any>(`/api/imports/candidates/${taskId}/select-sheet`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ sheetName }),
        }),
      );
    } catch (error) {
      msg.error((error as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const saveMapping = async () => {
    if (!["name", "supplier", "position"].every((key) => mapping[key]))
      return msg.error("姓名、供应商和岗位必须映射");
    if (new Set(Object.values(mapping)).size !== Object.values(mapping).length)
      return msg.error("同一 Excel 列不能映射多个系统字段");
    setBusy(true);
    try {
      await api(`/api/imports/candidates/${taskId}/mapping`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mapping }),
      });
      setStep(3);
      await loadPreview(1);
    } catch (error) {
      msg.error((error as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const changeAction = async (row: ImportRow, handlingAction: string) => {
    try {
      await api(`/api/imports/candidates/${taskId}/rows/${row.rowNumber}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ handlingAction, operator: "招聘专员" }),
      });
      await loadPreview();
    } catch (error) {
      msg.error((error as Error).message);
    }
  };
  const confirm = async () => {
    setBusy(true);
    try {
      const result = await api<ImportTask>(
        `/api/imports/candidates/${taskId}/confirm`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ operator: "招聘专员", allowWarnings: true }),
        },
      );
      setPreview((old) => (old ? { ...old, task: result } : old));
      setStep(5);
      await loadHistory();
      onComplete?.();
      msg.success(
        `导入完成：成功 ${result.importedRows} 行，跳过 ${result.skippedRows} 行`,
      );
    } catch (error) {
      msg.error((error as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const reset = () => {
    setStep(0);
    setTaskId("");
    setFileName("");
    setSheets([]);
    setSheetName("");
    setHeaders([]);
    setMapping({});
    setPreview(undefined);
  };
  const cleanupFile = async (id: string) => {
    try {
      await api(`/api/imports/candidates/${id}/file`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ operator: "招聘专员" }),
      });
      msg.success("临时文件已清理，数据库导入记录仍保留");
      await loadHistory();
    } catch (error) {
      msg.error((error as Error).message);
    }
  };
  const columns = [
    { title: "行", dataIndex: "rowNumber", width: 65 },
    { title: "姓名", dataIndex: "name" },
    {
      title: "手机号",
      dataIndex: "phoneMasked",
      render: (v?: string) => v || "—",
    },
    { title: "供应商", dataIndex: "supplierName" },
    { title: "岗位", dataIndex: "positionName" },
    {
      title: "校验",
      render: (_: unknown, row: ImportRow) => (
        <Tag
          color={
            row.validationStatus === "INVALID"
              ? "red"
              : row.validationStatus === "WARNING"
                ? "orange"
                : "green"
          }
        >
          {validationLabels[row.validationStatus]}
        </Tag>
      ),
    },
    {
      title: "重复风险",
      render: (_: unknown, row: ImportRow) => (
        <Tag
          color={
            row.duplicateLevel === "EXACT"
              ? "red"
              : row.duplicateLevel === "NONE"
                ? "default"
                : "orange"
          }
        >
          {duplicateLabels[row.duplicateLevel] || row.duplicateLevel}
        </Tag>
      ),
    },
    {
      title: "处理方式",
      width: 145,
      render: (_: unknown, row: ImportRow) => (
        <Select
          size="small"
          value={row.handlingAction}
          disabled={row.validationStatus === "INVALID"}
          options={["CREATE", "SKIP", "UPDATE", "MERGE", "MANUAL_REVIEW"].map(
            (value) => ({
              value,
              label: (
                {
                  CREATE: "创建",
                  SKIP: "跳过",
                  UPDATE: "更新",
                  MERGE: "合并",
                  MANUAL_REVIEW: "人工复核",
                } as Record<string, string>
              )[value],
            }),
          )}
          onChange={(value) => void changeAction(row, value)}
        />
      ),
    },
    {
      title: "问题",
      width: 280,
      render: (_: unknown, row: ImportRow) =>
        [
          ...(row.errors || []),
          ...(row.warnings || []),
          ...(row.duplicateReasons || []),
        ].join("；") || "—",
    },
  ];
  return (
    <div className="content import-page">
      {holder}
      <Space className="screening-header" wrap>
        <Button icon={<LeftOutlined />} onClick={onBack}>
          返回候选人看板
        </Button>
        <div>
          <Typography.Title level={3} style={{ margin: 0 }}>
            Excel 数据导入
          </Typography.Title>
          <Typography.Text type="secondary">
            文件由服务端解析、校验和查重，确认后写入 PostgreSQL。
          </Typography.Text>
        </div>
        <Button
          icon={<DownloadOutlined />}
          onClick={() => downloadImportTemplate(true)}
        >
          下载示例模板
        </Button>
      </Space>
      <Steps
        current={step}
        items={[
          { title: "上传文件" },
          { title: "选择工作表" },
          { title: "字段映射" },
          { title: "校验与预览" },
          { title: "确认导入" },
          { title: "导入结果" },
        ]}
      />
      {step === 0 && (
        <>
          <Card className="import-upload-card">
            <Upload.Dragger
              accept=".xlsx,.xls,.csv"
              showUploadList={false}
              disabled={busy}
              beforeUpload={(file) => {
                void upload(file as unknown as File);
                return false;
              }}
            >
              <p>
                <UploadOutlined style={{ fontSize: 36, color: "#1677ff" }} />
              </p>
              <p>点击或拖拽 Excel / CSV 文件到这里</p>
              <p className="muted">
                最大 15MB、最多 5000 行；原文件保存在非公开目录
              </p>
            </Upload.Dragger>
          </Card>
          <Card
            title="最近导入历史"
            extra={
              <Button
                icon={<ReloadOutlined />}
                onClick={() => void loadHistory()}
              >
                刷新
              </Button>
            }
          >
            <Table
              size="small"
              rowKey="id"
              pagination={false}
              dataSource={history}
              columns={[
                { title: "文件", dataIndex: "originalFileName" },
                { title: "总行数", dataIndex: "totalRows" },
                { title: "成功", dataIndex: "importedRows" },
                { title: "失败", dataIndex: "failedRows" },
                {
                  title: "状态",
                  dataIndex: "status",
                  render: (value) => <Tag>{value}</Tag>,
                },
                {
                  title: "操作",
                  render: (_v, task: ImportTask) => (
                    <Space>
                      <Button
                        size="small"
                        onClick={() => {
                          setTaskId(task.id);
                          setFileName(task.originalFileName);
                          if (task.status === "WAITING_CONFIRMATION")
                            setStep(3);
                          else if (
                            ["COMPLETED", "PARTIAL_FAILED"].includes(
                              task.status,
                            )
                          ) {
                            setPreview({
                              task,
                              summary: {
                                total: task.totalRows,
                                valid: task.validRows,
                                warning: task.warningRows,
                                invalid: task.invalidRows,
                                duplicate: task.duplicateRows,
                              },
                              rows: [],
                              pagination: {
                                page: 1,
                                pageSize: 20,
                                total: task.totalRows,
                              },
                            });
                            setStep(5);
                          } else msg.info("请重新上传原文件继续该任务");
                        }}
                      >
                        继续/查看
                      </Button>
                      <Button
                        size="small"
                        danger
                        onClick={() => void cleanupFile(task.id)}
                      >
                        清理文件
                      </Button>
                    </Space>
                  ),
                },
              ]}
            />
          </Card>
        </>
      )}
      {step === 1 && (
        <Card title="选择包含候选人的工作表">
          <Descriptions
            bordered
            items={[
              { key: "file", label: "文件", children: fileName },
              {
                key: "sheet",
                label: "工作表",
                children: (
                  <Select
                    value={sheetName || undefined}
                    placeholder="请选择"
                    style={{ width: 280 }}
                    options={sheets.map((value) => ({ value, label: value }))}
                    onChange={setSheetName}
                  />
                ),
              },
            ]}
          />
          <Button
            type="primary"
            loading={busy}
            onClick={() => void selectSheet()}
            style={{ marginTop: 16 }}
          >
            解析所选工作表
          </Button>
        </Card>
      )}
      {step === 2 && (
        <Card
          title="字段映射"
          extra={
            <Button
              type="primary"
              loading={busy}
              onClick={() => void saveMapping()}
            >
              保存并校验
            </Button>
          }
        >
          <Alert
            type="info"
            showIcon
            message="姓名、供应商、岗位为必填；未识别列可以忽略。"
          />
          <Table
            size="small"
            pagination={false}
            rowKey="field"
            dataSource={Object.keys(fieldLabels).map((field) => ({ field }))}
            columns={[
              {
                title: "系统字段",
                dataIndex: "field",
                render: (field: string) =>
                  `${fieldLabels[field]}${["name", "supplier", "position"].includes(field) ? " *" : ""}`,
              },
              {
                title: "Excel 列",
                render: (_v, row: { field: string }) => (
                  <Select
                    allowClear
                    value={mapping[row.field]}
                    style={{ width: 280 }}
                    options={headers.map((value) => ({ value, label: value }))}
                    onChange={(value) =>
                      setMapping((old) => {
                        const next = { ...old };
                        if (value) next[row.field] = value;
                        else delete next[row.field];
                        return next;
                      })
                    }
                  />
                ),
              },
            ]}
          />
        </Card>
      )}
      {step === 3 && (
        <Card
          title="数据库校验与预览"
          extra={
            <Space>
              <Badge count={preview?.summary.invalid || 0} />
              <Button onClick={() => setStep(2)}>调整映射</Button>
              <Button
                type="primary"
                disabled={
                  !preview ||
                  preview.summary.valid + preview.summary.warning === 0
                }
                onClick={() => setStep(4)}
              >
                进入确认
              </Button>
            </Space>
          }
        >
          <Space wrap style={{ marginBottom: 16 }}>
            <Input.Search
              placeholder="姓名、供应商或岗位"
              value={keyword}
              onChange={(event) => setKeyword(event.target.value)}
              onSearch={() => void loadPreview(1)}
              style={{ width: 240 }}
            />
            <Select
              allowClear
              placeholder="校验状态"
              value={validationStatus}
              options={["VALID", "WARNING", "INVALID"].map((value) => ({
                value,
                label: validationLabels[value as keyof typeof validationLabels],
              }))}
              onChange={setValidationStatus}
            />
            <Select
              allowClear
              placeholder="重复风险"
              value={duplicateLevel}
              options={Object.entries(duplicateLabels).map(
                ([value, label]) => ({ value, label }),
              )}
              onChange={setDuplicateLevel}
            />
          </Space>
          <Alert
            type={preview?.summary.invalid ? "warning" : "success"}
            showIcon
            message={`共 ${preview?.summary.total || 0} 行：通过 ${preview?.summary.valid || 0}，警告 ${preview?.summary.warning || 0}，失败 ${preview?.summary.invalid || 0}，重复风险 ${preview?.summary.duplicate || 0}`}
          />
          <Table
            loading={busy}
            rowKey="id"
            columns={columns}
            dataSource={preview?.rows}
            scroll={{ x: 1300 }}
            pagination={{
              current: page,
              pageSize: 20,
              total: preview?.pagination.total,
              showSizeChanger: false,
              onChange: (value) => void loadPreview(value),
            }}
          />
        </Card>
      )}
      {step === 4 && (
        <Card title="确认写入 PostgreSQL">
          <Alert
            type="warning"
            showIcon
            message="INVALID 行不会导入；WARNING 行将按当前选择导入；SKIP 与人工复核行不会写入候选人表。"
          />
          <Descriptions
            bordered
            column={2}
            items={[
              { key: "file", label: "文件", children: fileName },
              {
                key: "total",
                label: "总行数",
                children: preview?.summary.total,
              },
              {
                key: "valid",
                label: "可导入",
                children:
                  (preview?.summary.valid || 0) +
                  (preview?.summary.warning || 0),
              },
              {
                key: "invalid",
                label: "失败",
                children: preview?.summary.invalid,
              },
            ]}
          />
          <Space style={{ marginTop: 16 }}>
            <Button onClick={() => setStep(3)}>返回预览</Button>
            <Button
              type="primary"
              danger
              loading={busy}
              onClick={() => void confirm()}
            >
              确认导入
            </Button>
          </Space>
        </Card>
      )}
      {step === 5 && (
        <Card title="导入结果">
          <Empty
            description={`成功 ${preview?.task.importedRows || 0} 行，跳过 ${preview?.task.skippedRows || 0} 行，失败 ${preview?.task.failedRows || 0} 行`}
          />
          <Space>
            <Button type="primary" onClick={onBack}>
              返回候选人列表
            </Button>
            <Button onClick={reset}>继续导入</Button>
            {taskId && (
              <Button href={`/api/imports/candidates/${taskId}/errors/export`}>
                下载失败明细
              </Button>
            )}
          </Space>
        </Card>
      )}
    </div>
  );
}
