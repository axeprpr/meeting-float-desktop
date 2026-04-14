import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { _electron as electron } from "playwright";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, "..");
const outputDir = path.join(rootDir, "output", "playwright");
await fs.mkdir(outputDir, { recursive: true });

const sttUrl = process.env.MEETING_STT_URL || "ws://f.axe3.cn:22395";
const llmBaseUrl = process.env.MEETING_LLM_BASE_URL;
const llmApiKey = process.env.MEETING_LLM_API_KEY;
const llmModel = process.env.MEETING_LLM_MODEL || "MiniMax-M2.5";

if (!llmBaseUrl || !llmApiKey) {
  throw new Error("MEETING_LLM_BASE_URL and MEETING_LLM_API_KEY are required");
}

function buildFakeSession() {
  const now = new Date();
  return {
    id: `qa-${Date.now()}`,
    title: "QA Smoke Session",
    status: "completed",
    startedAt: now.toISOString(),
    startedAtLabel: now.toLocaleString(),
    endedAt: new Date(now.getTime() + 60_000).toISOString(),
    endedAtLabel: new Date(now.getTime() + 60_000).toLocaleString(),
    transcript: [
      { timeLabel: now.toLocaleTimeString(), text: "The Electron app launched successfully." },
      { timeLabel: now.toLocaleTimeString(), text: "Settings persistence and history checks are running." },
    ],
    summaries: [
      {
        timeLabel: now.toLocaleTimeString(),
        content: "QA summary\n1. Launch works\n2. Settings can be persisted\n3. History can render",
      },
    ],
    minutes: "QA minutes\n- Launch successful\n- Settings persisted\n- History row rendered\n",
    errors: [],
  };
}

const electronApp = await electron.launch({
  args: ["."],
  cwd: rootDir,
});

const appWindow = await electronApp.firstWindow();
const pageErrors = [];

appWindow.on("pageerror", (error) => {
  pageErrors.push(`pageerror: ${error.message}`);
});

appWindow.on("console", (message) => {
  if (message.type() === "error") {
    pageErrors.push(`console:${message.text()}`);
  }
});

await electronApp.evaluate(async ({ BrowserWindow }) => {
  const win = BrowserWindow.getAllWindows()[0];
  win.setSize(1280, 900);
  win.show();
});

await appWindow.waitForLoadState("domcontentloaded");
await appWindow.waitForFunction(() => Boolean(window.meetingDesktop), null, { timeout: 15000 });
await appWindow.screenshot({ path: path.join(outputDir, "electron-main.png") });

const bootstrapBefore = await appWindow.evaluate(() => window.meetingDesktop.getBootstrap());

const nextConfig = {
  ...bootstrapBefore.config,
  stt: {
    ...bootstrapBefore.config.stt,
    baseUrl: process.env.MEETING_STT_URL || "ws://f.axe3.cn:22395",
    model: bootstrapBefore.config.stt.model || "funasr-2pass",
    language: "zh",
  },
  llm: {
    ...bootstrapBefore.config.llm,
    baseUrl: process.env.MEETING_LLM_BASE_URL,
    apiKey: process.env.MEETING_LLM_API_KEY,
    model: process.env.MEETING_LLM_MODEL || "MiniMax-M2.5",
  },
};

await appWindow.evaluate(async (config) => {
  await window.meetingDesktop.saveConfig(config);
}, nextConfig);

const fakeSession = buildFakeSession();
await appWindow.evaluate(async (session) => {
  await window.meetingDesktop.saveSession(session);
}, fakeSession);

await appWindow.reload({ waitUntil: "domcontentloaded" });

const desktopNavButtons = appWindow.locator("aside button");
const mobileNavButtons = appWindow.locator("[class*='lg:hidden'] button");
const desktopNavCount = await desktopNavButtons.count();
const mobileNavCount = await mobileNavButtons.count();
const navButtons = desktopNavCount >= 3 ? desktopNavButtons : mobileNavButtons;
const navCount = desktopNavCount >= 3 ? desktopNavCount : mobileNavCount;

if (navCount < 3) {
  throw new Error(
    `expected at least 3 navigation buttons, got desktop=${desktopNavCount}, mobile=${mobileNavCount}`
  );
}

await navButtons.nth(2).click();

const inputs = appWindow.locator("input");
await inputs.first().waitFor({ state: "visible", timeout: 15000 });
const values = await inputs.evaluateAll((nodes) => nodes.map((node) => node.value));

if (!values.includes(sttUrl)) {
  throw new Error("settings view did not show the saved STT URL");
}

if (!values.includes(llmBaseUrl)) {
  throw new Error("settings view did not show the saved LLM base URL");
}

if (!values.includes(llmModel)) {
  throw new Error("settings view did not show the saved LLM model");
}

await navButtons.nth(1).click();
const rowCount = await appWindow.locator("tbody tr").count();
if (rowCount < 1) {
  throw new Error("history table did not render any rows");
}

const historyTexts = await appWindow.locator("tbody").textContent();
if (!String(historyTexts).includes("QA Smoke Session")) {
  throw new Error("saved QA session was not visible in history");
}

await appWindow.evaluate(async (session) => {
  await window.meetingDesktop.openMinutesWindow({
    title: session.title,
    minutes: session.minutes,
    startedAtLabel: session.startedAtLabel,
    endedAtLabel: session.endedAtLabel,
  });
}, fakeSession);

const windows = electronApp.windows();
if (windows.length < 2) {
  await appWindow.waitForTimeout(1500);
}

const allWindows = electronApp.windows();
if (allWindows.length < 2) {
  throw new Error("minutes window did not open");
}

const minutesWindow = allWindows[1];
await minutesWindow.waitForLoadState("domcontentloaded");
await minutesWindow.screenshot({ path: path.join(outputDir, "electron-minutes.png") });
const minutesText = await minutesWindow.textContent("body");

if (!String(minutesText).includes("QA minutes")) {
  throw new Error("minutes window did not render expected content");
}

const report = {
  timestamp: new Date().toISOString(),
  title: await appWindow.title(),
  savedConfig: {
    sttUrl,
    llmBaseUrl,
    llmModel,
  },
  navigation: {
    desktopNavCount,
    mobileNavCount,
    activeNavCount: navCount,
  },
  historyRowCount: rowCount,
  minutesWindowOpened: true,
  pageErrors,
  notes: [
    "UI smoke test passed for launch, settings persistence, history rendering, and minutes window.",
    "This test does not verify real microphone capture or live transcript generation.",
  ],
};

await fs.writeFile(
  path.join(outputDir, "electron-e2e-report.json"),
  JSON.stringify(report, null, 2),
  "utf8"
);

console.log(JSON.stringify(report, null, 2));

await electronApp.close();
