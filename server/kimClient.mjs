import crypto from "node:crypto";

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const requestId = () => crypto.randomUUID();
export function kimConfig(env = process.env) {
  return { mode: env.KIM_SEND_MODE || "webhook", webhookUrl: env.KIM_WEBHOOK_URL || "", groupWebhookUrl: env.KIM_RECRUITMENT_GROUP_WEBHOOK_URL || "", timeoutMs: Number(env.KIM_TIMEOUT_MS || 8000) };
}
export function createKimClient(env = process.env) {
  const config = kimConfig(env);
  return { configured: Boolean(config.webhookUrl || config.groupWebhookUrl), async sendMessage(target, message, options = {}) {
    const id = requestId();
    const url = target.webhookUrl || config.groupWebhookUrl || config.webhookUrl;
    if (!url) return { success: false, requestId: id, message: "Kim机器人尚未配置", sentAt: new Date().toISOString(), retryable: false, code: "KIM_NOT_CONFIGURED" };
    const body = JSON.stringify({ msg_type: message.type === "markdown" ? "markdown" : "text", content: message.type === "markdown" ? { title: message.title || "面试提醒", text: message.content } : { text: message.content } });
    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        const controller = new AbortController(); const timer = setTimeout(() => controller.abort(), options.timeoutMs || config.timeoutMs);
        const response = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body, signal: controller.signal }); clearTimeout(timer);
        if (response.ok) return { success: true, requestId: id, message: "发送成功", sentAt: new Date().toISOString(), retryable: false };
        if (response.status >= 400 && response.status < 500) return { success: false, requestId: id, message: "Kim接口拒绝请求", sentAt: new Date().toISOString(), retryable: false, code: response.status };
      } catch (error) { if (attempt === 2) return { success: false, requestId: id, message: error?.name === "AbortError" ? "Kim发送超时" : "Kim网络错误", sentAt: new Date().toISOString(), retryable: true, code: error?.name === "AbortError" ? "KIM_SEND_TIMEOUT" : "KIM_NETWORK_ERROR" }; }
      await sleep(250 * (attempt + 1));
    }
    return { success: false, requestId: id, message: "Kim发送失败", sentAt: new Date().toISOString(), retryable: true, code: "KIM_SEND_REJECTED" };
  } };
}
