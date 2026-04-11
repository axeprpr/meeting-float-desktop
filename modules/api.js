function joinUrl(baseUrl, path) {
  return `${String(baseUrl || "").replace(/\/+$/, "")}${path}`;
}

function authHeaders(apiKey) {
  return apiKey ? { Authorization: `Bearer ${apiKey}` } : {};
}

async function parseError(response) {
  try {
    const data = await response.json();
    return data.error?.message || data.message || JSON.stringify(data);
  } catch {
    return response.statusText || `HTTP ${response.status}`;
  }
}

function extractContent(payload) {
  const choice = payload?.choices?.[0];
  const content = choice?.message?.content;

  if (typeof content === "string") return content.trim();
  if (Array.isArray(content)) {
    return content
      .map((item) => item?.text || "")
      .join("")
      .trim();
  }
  return "";
}

const MOCK_TRANSCRIPTS = [
  "今天先过一下项目整体进度，客户端联调已经完成，剩下的是部署验证。",
  "语音转写这块需要兼容在线模型和本地网关，两套配置都要支持。",
  "阶段性总结希望更偏行动项，不要只复述发言内容。",
  "纪要里要单独列出决策事项、责任人和预计完成时间。",
  "下周需要安排一次专项评审，把跨平台打包和国产系统适配一起过掉。",
];

let mockTranscriptIndex = 0;

function isMockConfig(config) {
  return String(config?.baseUrl || "").startsWith("mock://");
}

function buildMockSummary(transcriptText) {
  const lines = transcriptText
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .slice(0, 4);

  return [
    "当前议题",
    lines[0] || "围绕会议记录工具的交付推进。",
    "",
    "关键结论",
    "1. 保持轻量桌面形态，优先保证录音、总结、纪要闭环。",
    "2. STT 和 LLM 都使用可配置接口，便于切换模型与部署位置。",
    "",
    "待办事项",
    "1. 补录音链路稳定性验证。",
    "2. 打磨纪要模板与导出格式。",
  ].join("\n");
}

function buildMockMinutes(transcriptText) {
  return [
    "一、会议主题",
    "会议记录小程序方案确认与交付推进",
    "",
    "二、核心结论",
    "1. 采用小型悬浮窗形态，支持托盘和跨平台运行。",
    "2. 语音转文字与大语言模型均通过可配置接口接入。",
    "3. 会议过程要同时支持实时记录、阶段性总结和最终纪要输出。",
    "",
    "三、决策事项",
    "1. 先完成主流程闭环，再补高可靠细节。",
    "2. 后续重点验证录音兼容性和模型网关稳定性。",
    "",
    "四、待办事项",
    "1. 补录音真实链路测试。",
    "2. 补导出模板和历史会话。",
    "",
    "五、会议原文摘录",
    transcriptText || "暂无",
  ].join("\n");
}

export class AiClient {
  async transcribe(blob, config) {
    if (isMockConfig(config)) {
      const text = MOCK_TRANSCRIPTS[mockTranscriptIndex % MOCK_TRANSCRIPTS.length];
      mockTranscriptIndex += 1;
      return text;
    }

    if (!config.baseUrl || !config.model) {
      throw new Error("STT 配置不完整");
    }

    const file = new File([blob], `chunk-${Date.now()}.webm`, {
      type: blob.type || "audio/webm",
    });

    const body = {
      file,
      model: config.model,
    };

    if (config.language) body.language = config.language;

    const response = await fetch(
      joinUrl(config.baseUrl, "/audio/transcriptions"),
      {
        method: "POST",
        headers: authHeaders(config.apiKey),
        body,
      }
    );

    if (!response.ok) {
      throw new Error(await parseError(response));
    }

    const payload = await response.json();
    return (payload.text || "").trim();
  }

  async summarize(transcriptText, config, systemPrompt, summaryPrompt) {
    if (isMockConfig(config)) {
      return buildMockSummary(transcriptText);
    }

    return this.chat(
      [
        { role: "system", content: systemPrompt },
        {
          role: "user",
          content: `${summaryPrompt}\n\n以下是新增会议内容：\n${transcriptText}`,
        },
      ],
      config
    );
  }

  async createMinutes(transcriptText, config, systemPrompt, minutesPrompt) {
    if (isMockConfig(config)) {
      return buildMockMinutes(transcriptText);
    }

    return this.chat(
      [
        { role: "system", content: systemPrompt },
        {
          role: "user",
          content: `${minutesPrompt}\n\n以下是完整会议内容：\n${transcriptText}`,
        },
      ],
      config
    );
  }

  async chat(messages, config) {
    if (!config.baseUrl || !config.model) {
      throw new Error("LLM 配置不完整");
    }

    const response = await fetch(joinUrl(config.baseUrl, "/chat/completions"), {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...authHeaders(config.apiKey),
      },
      body: JSON.stringify({
        model: config.model,
        temperature: 0.2,
        messages,
      }),
    });

    if (!response.ok) {
      throw new Error(await parseError(response));
    }

    const payload = await response.json();
    return extractContent(payload);
  }
}
