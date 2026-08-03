import { LockOutlined, MailOutlined, SafetyCertificateOutlined } from "@ant-design/icons";
import { Alert, Button, Card, Form, Input, Space, Typography, message } from "antd";
import { useState } from "react";
import { useAuth } from "../auth/AuthContext";

export default function LoginPage() {
  const { login } = useAuth(); const [busy, setBusy] = useState(false);
  const submit = async (values: { email: string; password: string }) => { setBusy(true); try { await login(values.email, values.password); message.success("登录成功"); } catch (error) { message.error((error as Error).message); } finally { setBusy(false); } };
  return <main className="login-page"><Card className="login-card"><Space direction="vertical" size={6} className="login-title"><SafetyCertificateOutlined /><Typography.Title level={2}>招聘管理平台</Typography.Title><Typography.Text type="secondary">账号权限与供应商数据隔离</Typography.Text></Space><Form layout="vertical" onFinish={submit} requiredMark={false}><Form.Item label="登录邮箱" name="email" rules={[{ required: true, type: "email", message: "请输入有效邮箱" }]}><Input size="large" prefix={<MailOutlined />} autoComplete="username" /></Form.Item><Form.Item label="密码" name="password" rules={[{ required: true, min: 8, message: "请输入至少 8 位密码" }]}><Input.Password size="large" prefix={<LockOutlined />} autoComplete="current-password" /></Form.Item><Button block type="primary" size="large" htmlType="submit" loading={busy}>登录</Button></Form><Alert className="demo-account-tip" type="info" showIcon message="平台管理员" description="admin@recruitment.local（密码由部署环境安全配置）" /></Card></main>;
}
