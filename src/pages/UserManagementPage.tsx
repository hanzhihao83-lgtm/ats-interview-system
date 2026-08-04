import {
  ArrowLeftOutlined,
  EditOutlined,
  PlusOutlined,
  ReloadOutlined,
  SafetyCertificateOutlined,
} from "@ant-design/icons";
import {
  Alert,
  Button,
  Card,
  Checkbox,
  Form,
  Input,
  Layout,
  Modal,
  Select,
  Space,
  Switch,
  Table,
  Tag,
  Typography,
  message,
} from "antd";
import { useCallback, useEffect, useMemo, useState } from "react";
import { api } from "../api/backend";
import {
  isSupplierRole,
  roleLabels,
  useAuth,
  type FeaturePermission,
  type UserBusinessLine,
  type UserRole,
} from "../auth/AuthContext";
import { allPermissions, permissionLabels } from "../auth/permissions";

interface ManagedUser {
  id: string;
  email: string;
  name: string;
  role: UserRole;
  supplierId: string | null;
  supplierName: string | null;
  isSupplierManager: boolean;
  permissions: FeaturePermission[];
  businessLines: UserBusinessLine[];
  kimUserId: string | null;
  status: "ACTIVE" | "INACTIVE";
  lastLoginAt?: string | null;
}

interface SupplierAuthorization {
  id: string;
  name: string;
  code: string;
  permissionCap: FeaturePermission[];
  businessLines: UserBusinessLine[];
}

const navigate = (url: string) => {
  history.pushState({}, "", url);
  window.dispatchEvent(new PopStateEvent("popstate"));
};
const businessLineOptions = [
  { value: "VIDEO", label: "视频" },
  { value: "AUDIO", label: "音频" },
];
const supplierAccountRoles: UserRole[] = ["SUPPLIER_ADMIN", "SUPPLIER_RECRUITER"];
const internalRoles: UserRole[] = [
  "PLATFORM_ADMIN",
  "DEPARTMENT_MANAGER",
  "INTERNAL_RECRUITER",
  "VIDEO_RECRUITER",
  "AUDIO_RECRUITER",
];

export default function UserManagementPage() {
  const { user } = useAuth();
  const [rows, setRows] = useState<ManagedUser[]>([]);
  const [suppliers, setSuppliers] = useState<SupplierAuthorization[]>([]);
  const [loading, setLoading] = useState(false);
  const [editorOpen, setEditorOpen] = useState(false);
  const [editing, setEditing] = useState<ManagedUser | null>(null);
  const [authorizationSupplier, setAuthorizationSupplier] = useState<SupplierAuthorization | null>(null);
  const [form] = Form.useForm();
  const [authorizationForm] = Form.useForm();

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [users, supplierRows] = await Promise.all([
        api<ManagedUser[]>("/api/auth/users"),
        api<SupplierAuthorization[]>("/api/auth/suppliers"),
      ]);
      setRows(users);
      setSuppliers(supplierRows);
    } catch (error) {
      message.error((error as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const selectedSupplierId = Form.useWatch("supplierId", form);
  const selectedRole = Form.useWatch("role", form) as UserRole | undefined;
  const selectedIsSupplierManager = Form.useWatch("isSupplierManager", form) as boolean | undefined;
  const selectedSupplier = useMemo(
    () => suppliers.find((supplier) => supplier.id === (selectedSupplierId || user?.supplierId)),
    [selectedSupplierId, suppliers, user?.supplierId],
  );
  const availablePermissions = selectedSupplier?.permissionCap || allPermissions;
  const availableLines = selectedSupplier?.businessLines || ["VIDEO", "AUDIO"];
  const configurableBusinessAccount = selectedRole !== "PLATFORM_ADMIN" && editing?.role !== "PLATFORM_ADMIN";
  const assignablePermissions = availablePermissions.filter(
    (permission) => permission !== "SUPPLIER_ACCOUNT_MANAGE" || Boolean(selectedIsSupplierManager),
  );

  const openCreate = () => {
    setEditing(null);
    form.resetFields();
    form.setFieldsValue({
      role: user?.role === "PLATFORM_ADMIN" ? "SUPPLIER_RECRUITER" : "SUPPLIER_RECRUITER",
      supplierId: user?.role === "PLATFORM_ADMIN" ? undefined : user?.supplierId,
      isSupplierManager: false,
      permissions: [],
      businessLines: selectedSupplier?.businessLines || user?.businessLines || [],
    });
    setEditorOpen(true);
  };

  const openEdit = (record: ManagedUser) => {
    setEditing(record);
    form.resetFields();
    form.setFieldsValue({
      name: record.name,
      role: record.role,
      supplierId: record.supplierId,
      isSupplierManager: record.isSupplierManager,
      permissions: record.permissions,
      businessLines: record.businessLines,
      kimUserId: record.kimUserId,
      status: record.status,
    });
    setEditorOpen(true);
  };

  const saveUser = async () => {
    const values = await form.validateFields();
    try {
      await api(editing ? `/api/auth/users/${editing.id}` : "/api/auth/users", {
        method: editing ? "PUT" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(values),
      });
      message.success(editing ? "账号权限已更新" : "账号已创建");
      setEditorOpen(false);
      form.resetFields();
      await load();
    } catch (error) {
      message.error((error as Error).message);
    }
  };

  const toggle = async (record: ManagedUser, checked: boolean) => {
    try {
      await api(`/api/auth/users/${record.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: checked ? "ACTIVE" : "INACTIVE" }),
      });
      message.success("账号状态已更新");
      await load();
    } catch (error) {
      message.error((error as Error).message);
    }
  };

  const openAuthorization = (supplier: SupplierAuthorization) => {
    setAuthorizationSupplier(supplier);
    authorizationForm.setFieldsValue({
      permissionCap: supplier.permissionCap,
      businessLines: supplier.businessLines,
    });
  };

  const saveAuthorization = async () => {
    if (!authorizationSupplier) return;
    const values = await authorizationForm.validateFields();
    try {
      await api(`/api/auth/suppliers/${authorizationSupplier.id}/authorization`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(values),
      });
      message.success("公司权限上限已更新，超出上限的账号权限已自动收回");
      setAuthorizationSupplier(null);
      await load();
    } catch (error) {
      message.error((error as Error).message);
    }
  };

  const allowedRoles = user?.role === "PLATFORM_ADMIN"
    ? [...internalRoles, ...supplierAccountRoles]
    : (["SUPPLIER_RECRUITER"] as UserRole[]);
  const creatingSupplierAccount = Boolean(selectedRole && isSupplierRole(selectedRole));

  return (
    <Layout className="auto-dashboard-page">
      <header className="auto-page-header">
        <div>
          <Typography.Title level={2}>账号与权限管理</Typography.Title>
          <Typography.Text type="secondary">
            平台管理员设置公司权限上限；外包公司负责人只能在上限内为本公司账号授权。
          </Typography.Text>
        </div>
        <Space wrap>
          <Button icon={<ArrowLeftOutlined />} onClick={() => navigate("/")}>返回首页</Button>
          <Button icon={<ReloadOutlined />} onClick={() => void load()}>刷新</Button>
          <Button type="primary" icon={<PlusOutlined />} onClick={openCreate}>新增账号</Button>
        </Space>
      </header>
      <main className="auto-page-content">
        {user?.role === "PLATFORM_ADMIN" && (
          <Card title="外包公司权限上限" style={{ marginBottom: 16 }}>
            <Alert
              type="info"
              showIcon
              message="这里是每家公司可分配的最大范围，不代表公司内所有账号自动获得这些权限。"
              style={{ marginBottom: 12 }}
            />
            <Table
              rowKey="id"
              dataSource={suppliers}
              pagination={false}
              columns={[
                { title: "公司", dataIndex: "name" },
                { title: "业务线", render: (_, row) => row.businessLines.map((line) => <Tag key={line}>{line === "VIDEO" ? "视频" : "音频"}</Tag>) },
                { title: "权限上限", render: (_, row) => <Typography.Text>{row.permissionCap.length} 项</Typography.Text> },
                { title: "操作", render: (_, row) => <Button icon={<SafetyCertificateOutlined />} onClick={() => openAuthorization(row)}>设置上限</Button> },
              ]}
            />
          </Card>
        )}
        <Card title={user?.role === "PLATFORM_ADMIN" ? "全部账号" : "本公司账号"}>
          <Table
            rowKey="id"
            loading={loading}
            dataSource={rows}
            pagination={{ pageSize: 20 }}
            scroll={{ x: 1250 }}
            columns={[
              { title: "姓名", dataIndex: "name", fixed: "left" },
              { title: "邮箱", dataIndex: "email" },
              { title: "账号类型", dataIndex: "role", render: (value: UserRole) => <Tag>{roleLabels[value]}</Tag> },
              { title: "外包公司", dataIndex: "supplierName", render: (value) => value || "内部" },
              { title: "负责人", dataIndex: "isSupplierManager", render: (value) => value ? <Tag color="gold">公司负责人</Tag> : "—" },
              { title: "业务线", render: (_, row) => row.businessLines.map((line) => <Tag key={line}>{line === "VIDEO" ? "视频" : "音频"}</Tag>) },
              { title: "功能权限", render: (_, row) => row.permissions.length ? `${row.permissions.length} 项` : "未授权" },
              { title: "最后登录", dataIndex: "lastLoginAt", render: (value) => value ? new Date(value).toLocaleString() : "—" },
              { title: "启用", render: (_, row) => <Switch checked={row.status === "ACTIVE"} disabled={row.id === user?.id || (user?.role !== "PLATFORM_ADMIN" && row.isSupplierManager)} onChange={(value) => void toggle(row, value)} /> },
              { title: "编辑", fixed: "right", render: (_, row) => <Button icon={<EditOutlined />} disabled={(row.id === user?.id && user.role !== "PLATFORM_ADMIN") || (user?.role !== "PLATFORM_ADMIN" && row.isSupplierManager)} onClick={() => openEdit(row)}>权限</Button> },
            ]}
          />
        </Card>
      </main>

      <Modal
        title={editing ? `编辑账号 · ${editing.name}` : "新增账号"}
        open={editorOpen}
        onCancel={() => setEditorOpen(false)}
        onOk={() => void saveUser()}
        okText={editing ? "保存" : "创建"}
        width={760}
        destroyOnClose
      >
        <Form form={form} layout="vertical">
          <Space align="start" wrap style={{ width: "100%" }}>
            <Form.Item name="name" label="姓名" rules={[{ required: true }]}><Input style={{ width: 220 }} /></Form.Item>
            {!editing && <Form.Item name="email" label="邮箱" rules={[{ required: true, type: "email" }]}><Input style={{ width: 260 }} /></Form.Item>}
            <Form.Item name="kimUserId" label="Kim 用户 ID"><Input style={{ width: 220 }} placeholder="可选" /></Form.Item>
          </Space>
          <Space align="start" wrap style={{ width: "100%" }}>
            {!editing && <Form.Item name="password" label="初始密码" rules={[{ required: true, min: 8 }]}><Input.Password style={{ width: 220 }} /></Form.Item>}
            {!editing && <Form.Item name="role" label="账号类型" rules={[{ required: true }]}>
              <Select
                style={{ width: 230 }}
                options={allowedRoles.map((value) => ({ value, label: roleLabels[value] }))}
                onChange={(value: UserRole) => {
                  if (!isSupplierRole(value)) form.setFieldsValue({ supplierId: undefined, isSupplierManager: false });
                  if (value !== "SUPPLIER_ADMIN") form.setFieldValue("isSupplierManager", false);
                }}
              />
            </Form.Item>}
            {editing && <Form.Item name="status" label="账号状态"><Select style={{ width: 150 }} options={[{ value: "ACTIVE", label: "启用" }, { value: "INACTIVE", label: "停用" }]} /></Form.Item>}
          </Space>
          {!editing && user?.role === "PLATFORM_ADMIN" && creatingSupplierAccount && (
            <Form.Item name="supplierId" label="所属外包公司" rules={[{ required: true }]}>
              <Select options={suppliers.map((supplier) => ({ value: supplier.id, label: supplier.name }))} />
            </Form.Item>
          )}
          {user?.role === "PLATFORM_ADMIN" && selectedRole === "SUPPLIER_ADMIN" && (
            <Form.Item name="isSupplierManager" valuePropName="checked">
              <Checkbox>设为外包公司负责人（可管理本公司账号）</Checkbox>
            </Form.Item>
          )}
          {(creatingSupplierAccount || editing?.supplierId) && (
            <Alert
              type="warning"
              showIcon
              message={`当前可授权上限：${availablePermissions.length} 项功能，${availableLines.map((line) => line === "VIDEO" ? "视频" : "音频").join("、") || "未配置业务线"}`}
              style={{ marginBottom: 16 }}
            />
          )}
          {configurableBusinessAccount && <>
            <Form.Item name="businessLines" label="业务线" rules={[{ required: true, type: "array", min: 1 }]}>
              <Checkbox.Group options={businessLineOptions.filter((option) => availableLines.includes(option.value as UserBusinessLine))} />
            </Form.Item>
            <Form.Item name="permissions" label="功能权限">
              <Checkbox.Group style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: 10 }}>
                {assignablePermissions.map((permission) => <Checkbox key={permission} value={permission}>{permissionLabels[permission]}</Checkbox>)}
              </Checkbox.Group>
            </Form.Item>
          </>}
          {editing && <Form.Item name="password" label="重置密码"><Input.Password placeholder="留空则不修改" /></Form.Item>}
        </Form>
      </Modal>

      <Modal
        title={`公司权限上限 · ${authorizationSupplier?.name || ""}`}
        open={Boolean(authorizationSupplier)}
        onCancel={() => setAuthorizationSupplier(null)}
        onOk={() => void saveAuthorization()}
        width={760}
        okText="保存上限"
        destroyOnClose
      >
        <Alert type="warning" showIcon message="收窄权限上限后，本公司账号中超出新上限的权限会立即被收回。" style={{ marginBottom: 16 }} />
        <Form form={authorizationForm} layout="vertical">
          <Form.Item name="businessLines" label="允许使用的业务线" rules={[{ required: true, type: "array", min: 1 }]}>
            <Checkbox.Group options={businessLineOptions} />
          </Form.Item>
          <Form.Item name="permissionCap" label="可分配的功能权限上限">
            <Checkbox.Group style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: 10 }}>
              {allPermissions.map((permission) => <Checkbox key={permission} value={permission}>{permissionLabels[permission]}</Checkbox>)}
            </Checkbox.Group>
          </Form.Item>
        </Form>
      </Modal>
    </Layout>
  );
}
