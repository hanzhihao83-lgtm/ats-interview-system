export type AiMatchInput = { resume: Record<string, unknown>; job: Record<string, unknown> };

const config = () => ({
  key: process.env.AI_API_KEY?.trim() || "",
  baseUrl: (process.env.AI_BASE_URL?.trim() || "https://api.openai.com/v1").replace(/\/$/, ""),
  model: process.env.AI_MODEL?.trim() || "gpt-4o-mini",
  timeout: Number(process.env.AI_TIMEOUT_MS || 60000),
});

export const aiStatus = () => { const c = config(); return { configured: Boolean(c.key), provider: process.env.AI_PROVIDER || "openai-compatible", model: c.model }; };

const systemPrompt = `你是招聘辅助分析系统，不是最终招聘决策者。只能根据简历和岗位JD中明确存在的信息判断，不得编造经历、技能或学校。不得使用性别、年龄、民族、籍贯、婚姻、照片等敏感属性评分。信息缺失时返回“无法判断”。只输出严格JSON，不要输出Markdown。`;

function normalizeResult(value: unknown, resumeId: string, jobId: string) {
  const raw = (value && typeof value === "object" ? value : {}) as Record<string, unknown>;
  const score = Math.max(0, Math.min(100, Number(raw.overallScore) || 0));
  const dimensions = (raw.dimensionScores && typeof raw.dimensionScores === "object" ? raw.dimensionScores : {}) as Record<string, unknown>;
  const list = (key: string) => Array.isArray(raw[key]) ? raw[key] : [];
  return {
    id: `AI-MATCH-${resumeId}-${jobId}`, resumeId, jobId, overallScore: score,
    dimensionScores: { education: Number(dimensions.education) || 0, major: Number(dimensions.major) || 0, experience: Number(dimensions.experience) || 0, skills: Number(dimensions.skills) || 0, projectExperience: Number(dimensions.projectExperience) || 0, certificates: Number(dimensions.certificates) || 0, location: Number(dimensions.location) || 0, stability: Number(dimensions.stability) || 0 },
    matchedRequirements: list("matchedRequirements"), partiallyMatchedRequirements: list("partiallyMatchedRequirements"), missingRequirements: list("missingRequirements"), riskPoints: list("riskPoints"),
    recommendation: score >= 80 ? "推荐通过" : score >= 60 ? "建议人工复核" : "匹配度较低", summary: String(raw.summary || "AI 已完成岗位匹配分析，请结合证据人工复核。"), interviewQuestions: list("interviewQuestions").map(String), promptVersion: "ai-v1", matchedAt: new Date().toISOString(), confidence: Math.max(0, Math.min(100, Number(raw.confidence) || 60)), source: "AI",
  };
}

export async function matchResumeWithAi(input: AiMatchInput) {
  const c = config(); if (!c.key) throw new Error("AI_NOT_CONFIGURED");
  const controller = new AbortController(); const timer = setTimeout(() => controller.abort(), c.timeout);
  try {
    const anthropic = (process.env.AI_PROVIDER || "").toLowerCase() === "anthropic" || c.baseUrl.includes("anthropic.com");
    const endpoint = anthropic ? `${c.baseUrl}/messages` : `${c.baseUrl}/chat/completions`;
    const headers: Record<string, string> = anthropic ? { "Content-Type": "application/json", "x-api-key": c.key, "anthropic-version": "2023-06-01" } : { "Content-Type": "application/json", Authorization: `Bearer ${c.key}` };
    const body = anthropic ? { model: c.model, max_tokens: 1800, temperature: 0.1, system: systemPrompt, messages: [{ role: "user", content: JSON.stringify(input) }] } : { model: c.model, temperature: 0.1, response_format: { type: "json_object" }, messages: [{ role: "system", content: systemPrompt }, { role: "user", content: JSON.stringify(input) }] };
    const response = await fetch(endpoint, { method: "POST", signal: controller.signal, headers, body: JSON.stringify(body) });
    if (!response.ok) throw new Error(`AI_REQUEST_FAILED_${response.status}`);
    const payload = await response.json() as { choices?: Array<{ message?: { content?: string } }>; content?: Array<{ text?: string }> };
    const content = anthropic ? payload.content?.[0]?.text || "{}" : payload.choices?.[0]?.message?.content || "{}";
    return normalizeResult(JSON.parse(content), String(input.resume.id || "resume"), String(input.job.id || "job"));
  } finally { clearTimeout(timer); }
}
