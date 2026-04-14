export const DEFAULT_CONFIG = {
  meetingTitle: "",
  exportDir: "",
  stt: {
    baseUrl: "ws://f.axe3.cn:22395",
    apiKey: "",
    model: "funasr-2pass",
    language: "zh",
  },
  llm: {
    baseUrl: "",
    apiKey: "",
    model: "gpt-4o-mini",
  },
  chunkSeconds: 20,
  summaryIntervalMinutes: 2.5,
  systemPrompt: "你是一个严谨的会议助手，需要输出清晰、简洁、结构化的中文内容。",
  summaryPrompt:
    "请基于新增会议内容输出阶段性总结，至少包含：当前议题、关键结论、未决事项、后续行动和责任人。",
  minutesPrompt:
    "请将完整会议内容整理成正式会议纪要，至少包含：会议主题、核心结论、决策事项、待办事项、风险与阻塞、下一步安排。",
};

export const MOCK_TRANSCRIPTS = [
  "今天先过一下项目整体进度，客户端联调已经完成，剩下的是部署验证。",
  "语音转写这块需要兼容在线模型和本地网关，两套配置都要支持。",
  "阶段性总结希望更偏行动项，不要只复述发言内容。",
  "纪要里要单独列出决策事项、责任人和预计完成时间。",
  "下周需要安排一次专项评审，把跨平台打包和国产系统适配一起过掉。",
];
