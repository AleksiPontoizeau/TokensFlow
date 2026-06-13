import { execFile, spawn } from "node:child_process";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import {
  formatQuotaNotification,
  readCodexStatus,
  shouldNotifyQuotaDrop
} from "./status.js";

const execFileAsync = promisify(execFile);
export const TRAY_REFRESH_MS = 60_000;
export const SWIFTBAR_PLUGIN_PATH = path.join(
  os.homedir(),
  "Library",
  "Application Support",
  "SwiftBar",
  "tokensflow.1m.sh"
);

const TOKENFLOW_DIR = path.join(os.homedir(), ".tokensflow");
const TRAY_ICON_PATH = path.join(TOKENFLOW_DIR, "tray-icon.png");
const TRAY_LOG_PATH = path.join(TOKENFLOW_DIR, "tray.log");
const TRAY_ICON_PNG_BASE64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII=";

export async function startTrayWorker(options = {}) {
  const config = {
    cwd: options.cwd || process.env.TOKENSFLOW_CWD || process.cwd(),
    tool: options.tool || process.env.TOKENSFLOW_TOOL || "codex",
    refreshMs: positiveInterval(options.refreshMs || process.env.TOKENSFLOW_TRAY_REFRESH_MS, TRAY_REFRESH_MS)
  };
  const logger = createTrayLogger();

  try {
    await startNativeTray(config, logger);
  } catch (error) {
    await logger(`Native tray unavailable: ${errorMessage(error)}`);
    const pluginPath = await installSwiftBarPlugin(config);
    await logger(`SwiftBar fallback installed: ${pluginPath}`);
    await runHeadlessNotificationLoop(config, logger);
  }
}

export async function installSwiftBarPlugin(options = {}) {
  const pluginPath = options.pluginPath || SWIFTBAR_PLUGIN_PATH;
  await fs.mkdir(path.dirname(pluginPath), { recursive: true });
  await fs.writeFile(pluginPath, swiftBarPluginScript(options), "utf8");
  await fs.chmod(pluginPath, 0o755);
  return pluginPath;
}

async function startNativeTray(config, logger) {
  const SysTray = await loadSysTray();
  const iconPath = await ensureTrayIcon();
  const notificationState = { below20: false, below10: false };
  let summary = await safeReadSummary(config, logger);

  const systray = new SysTray({
    menu: buildTrayMenu(summary, iconPath),
    debug: process.env.TOKENSFLOW_TRAY_DEBUG === "1",
    copyDir: true
  });

  await systray.ready();
  await logger(`Native tray started with ${summary.label}`);
  await maybeNotifyQuota(summary, notificationState, logger);

  async function refreshTray() {
    summary = await safeReadSummary(config, logger);
    await systray.sendAction({
      type: "update-menu",
      menu: buildTrayMenu(summary, iconPath)
    });
    await maybeNotifyQuota(summary, notificationState, logger);
  }

  const timer = setInterval(() => {
    refreshTray().catch((error) => logger(`Tray refresh failed: ${errorMessage(error)}`));
  }, config.refreshMs);

  systray.onClick((action) => {
    const title = action?.item?.title || "";

    if (title === "Refresh now") {
      refreshTray().catch((error) => logger(`Manual refresh failed: ${errorMessage(error)}`));
      return;
    }

    if (title === "Open dashboard") {
      openDashboard(config);
      return;
    }

    if (title === "Install SwiftBar fallback") {
      installSwiftBarPlugin(config)
        .then((pluginPath) => logger(`SwiftBar fallback installed: ${pluginPath}`))
        .catch((error) => logger(`SwiftBar fallback failed: ${errorMessage(error)}`));
      return;
    }

    if (title === "Quit TokensFlow tray") {
      clearInterval(timer);
      systray.kill(false).finally(() => process.exit(0));
    }
  });

  process.on("SIGINT", () => {
    clearInterval(timer);
    systray.kill(false).finally(() => process.exit(0));
  });
  process.on("SIGTERM", () => {
    clearInterval(timer);
    systray.kill(false).finally(() => process.exit(0));
  });
}

async function runHeadlessNotificationLoop(config, logger) {
  const notificationState = { below20: false, below10: false };

  async function refresh() {
    const summary = await safeReadSummary(config, logger);
    await maybeNotifyQuota(summary, notificationState, logger);
  }

  await refresh();
  setInterval(() => {
    refresh().catch((error) => logger(`Headless refresh failed: ${errorMessage(error)}`));
  }, config.refreshMs);

  await new Promise(() => {});
}

async function safeReadSummary(config, logger) {
  try {
    return await readCodexStatus({
      cwd: config.cwd
    });
  } catch (error) {
    await logger(`Status read failed: ${errorMessage(error)}`);
    return {
      percent: null,
      label: "TF?",
      color: "#74839d",
      resetCountdown: "--",
      notificationResetCountdown: "0h 0m",
      source: "codex unavailable",
      freshness: "--",
      weeklyPercent: null,
      todayCostUsd: 0,
      last24hCostUsd: 0
    };
  }
}

async function maybeNotifyQuota(summary, state, logger) {
  if (!shouldNotifyQuotaDrop(state, summary.percent)) {
    return;
  }

  const body = formatQuotaNotification(summary);
  if (!body) {
    return;
  }

  const sent = await sendMacNotification(body);
  await logger(sent ? `Notification sent: ${body}` : `Notification skipped: ${body}`);
}

async function sendMacNotification(body) {
  if (process.platform !== "darwin") {
    return false;
  }

  try {
    await execFileAsync("osascript", [
      "-e",
      `display notification ${appleScriptString(body)} with title ${appleScriptString("TokensFlow")}`
    ]);
    return true;
  } catch {
    return false;
  }
}

function buildTrayMenu(summary, iconPath) {
  return {
    icon: iconPath,
    isTemplateIcon: process.platform === "darwin",
    title: summary.label,
    tooltip: `TokensFlow · Codex quota ${summary.label}`,
    items: [
      disabledItem(`Codex quota: ${summary.percent === null ? "unavailable" : `${summary.percent}% left`}`),
      disabledItem(`Resets in: ${summary.resetCountdown}`),
      disabledItem(`Weekly quota: ${summary.weeklyPercent === null ? "--" : `${summary.weeklyPercent}% left`}`),
      disabledItem(`Freshness: ${summary.freshness}`),
      separatorItem(),
      enabledItem("Refresh now", "Read local Codex quota again"),
      enabledItem("Open dashboard", "Open the full TokensFlow dashboard"),
      enabledItem("Install SwiftBar fallback", "Write the SwiftBar plugin file"),
      separatorItem(),
      enabledItem("Quit TokensFlow tray", "Stop the menu bar worker")
    ]
  };
}

function disabledItem(title) {
  return {
    title,
    tooltip: title,
    checked: false,
    enabled: false
  };
}

function enabledItem(title, tooltip) {
  return {
    title,
    tooltip,
    checked: false,
    enabled: true
  };
}

function separatorItem() {
  return {
    title: "<SEPARATOR>",
    tooltip: "",
    checked: false,
    enabled: true
  };
}

async function loadSysTray() {
  const module = await import("systray2");
  const SysTray = module.default?.default || module.default || module.SysTray;

  if (typeof SysTray !== "function") {
    throw new Error("systray2 did not expose a SysTray constructor.");
  }

  return SysTray;
}

async function ensureTrayIcon() {
  await fs.mkdir(TOKENFLOW_DIR, { recursive: true });

  try {
    await fs.access(TRAY_ICON_PATH);
  } catch {
    await fs.writeFile(TRAY_ICON_PATH, Buffer.from(TRAY_ICON_PNG_BASE64, "base64"));
  }

  return TRAY_ICON_PATH;
}

function openDashboard(config) {
  const args = [process.argv[1], "--tool", config.tool, "--cwd", config.cwd];
  const child = spawn(process.execPath, args, {
    detached: true,
    stdio: "ignore",
    env: {
      ...process.env,
      TOKENSFLOW_TOOL: config.tool,
      TOKENSFLOW_SOURCE: config.tool,
      TOKENSFLOW_CWD: config.cwd
    }
  });
  child.unref();
}

function swiftBarPluginScript(options = {}) {
  const cwd = options.cwd || process.env.TOKENSFLOW_CWD || process.cwd();
  const tool = options.tool || process.env.TOKENSFLOW_TOOL || "codex";
  const exportedEnv = [
    ["TOKENSFLOW_TOOL", tool],
    ["TOKENSFLOW_SOURCE", tool],
    ["TOKENSFLOW_CWD", cwd],
    ["TOKENSFLOW_THREAD_ID", process.env.TOKENSFLOW_THREAD_ID],
    ["TOKENSFLOW_CODEX_STATE_DB", process.env.TOKENSFLOW_CODEX_STATE_DB],
    ["TOKENSFLOW_CODEX_GOALS_DB", process.env.TOKENSFLOW_CODEX_GOALS_DB],
    ["TOKENSFLOW_CODEX_SESSIONS_ROOT", process.env.TOKENSFLOW_CODEX_SESSIONS_ROOT],
    ["TOKENSFLOW_BUDGET_TOKENS", process.env.TOKENSFLOW_BUDGET_TOKENS],
    ["TOKENSFLOW_WEEKLY_BUDGET_TOKENS", process.env.TOKENSFLOW_WEEKLY_BUDGET_TOKENS]
  ]
    .filter(([, value]) => typeof value === "string" && value !== "")
    .map(([key, value]) => `export ${key}=${shellString(value)}`)
    .join("\n");

  return `#!/bin/zsh
export PATH="/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin:$PATH"
${exportedEnv}

if command -v npx >/dev/null 2>&1; then
  npx --yes tokensflow --status --tool "$TOKENSFLOW_TOOL" --cwd "$TOKENSFLOW_CWD"
else
  echo "TF?"
  echo "---"
  echo "npx not found"
fi
`;
}

function createTrayLogger() {
  return async function log(message) {
    const line = `[${new Date().toISOString()}] ${message}\n`;
    try {
      await fs.mkdir(TOKENFLOW_DIR, { recursive: true });
      await fs.appendFile(TRAY_LOG_PATH, line, "utf8");
    } catch {
      // Logging must never break the tray worker.
    }
  };
}

function appleScriptString(value) {
  return `"${String(value).replaceAll("\\", "\\\\").replaceAll("\"", "\\\"")}"`;
}

function shellString(value) {
  return `'${String(value).replaceAll("'", "'\\''")}'`;
}

function errorMessage(error) {
  return error instanceof Error ? error.message : String(error);
}

function positiveInterval(value, fallback) {
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0) {
    return fallback;
  }

  return number;
}
