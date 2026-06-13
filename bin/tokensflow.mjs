#!/usr/bin/env node
import { execFile, spawn } from "node:child_process";
import path from "node:path";

const requestedPort = Number(process.env.PORT || 3000);
const defaultMacWindowBounds = [0, 0, 1454, 847];
const args = parseArgs(process.argv.slice(2));
const cwd = path.resolve(args.cwd || process.cwd());
const tool = args.tool || normalizeTool(process.env.TOKENSFLOW_TOOL) || "codex";

process.env.TOKENSFLOW_TOOL = tool;
process.env.TOKENSFLOW_SOURCE = tool;
process.env.TOKENSFLOW_CWD = cwd;

if (args.status) {
  const { formatSwiftBarStatus, readCodexStatus } = await import("../lib/status.js");
  const summary = await readCodexStatus({ cwd });
  process.stdout.write(formatSwiftBarStatus(summary));
  process.exit(0);
}

if (args.trayWorker) {
  const { startTrayWorker } = await import("../lib/tray.js");
  await startTrayWorker({ cwd, tool });
}

if (args.tray) {
  await startTrayBackground({ cwd, tool });
  process.exit(0);
}

const { startServerOnAvailablePort } = await import("../server.mjs");
const serverHandle = await startServerOnAvailablePort({
  port: requestedPort,
  allowPortFallback: !process.env.PORT,
  log: false
});
const { server, port } = serverHandle;
const url = `http://127.0.0.1:${port}`;

console.log(`Provider: ${toolLabel(tool)}`);
console.log(`Project: ${cwd}`);
if (port !== requestedPort) {
  console.log(`Port ${requestedPort} was busy; using ${port}.`);
}
console.log(`TokensFlow running at ${url}`);
console.log(`History: ${serverHandle.snapshotFile} every ${Math.round(serverHandle.snapshotIntervalMs / 60_000)}m`);

if (process.env.TOKENSFLOW_OPEN !== "0" && !args.noOpen) {
  openUrl(url);
}

process.on("SIGINT", () => {
  server.close(() => {
    process.exit(0);
  });
});

process.on("SIGTERM", () => {
  server.close(() => {
    process.exit(0);
  });
});

function openUrl(targetUrl) {
  const platform = process.platform;
  if (platform === "darwin") {
    openUrlInMacWindow(targetUrl);
    return;
  }

  const command = platform === "darwin" ? "open" : platform === "win32" ? "cmd" : "xdg-open";
  const args = platform === "win32" ? ["/c", "start", "", targetUrl] : [targetUrl];

  execFile(command, args, (error) => {
    if (error) {
      console.log(`Open TokensFlow: ${targetUrl}`);
    }
  });
}

function openUrlInMacWindow(targetUrl) {
  const bounds = macWindowBounds();
  const script = `
set targetUrl to ${appleScriptString(targetUrl)}
set targetBounds to {${bounds.join(", ")}}
open location targetUrl
delay 0.6
try
  tell application "System Events"
    set frontApp to name of first application process whose frontmost is true
  end tell
  tell application frontApp
    if (count of windows) > 0 then set bounds of front window to targetBounds
  end tell
end try
`;

  execFile("osascript", ["-e", script], (error) => {
    if (error) {
      execFile("open", [targetUrl], (openError) => {
        if (openError) {
          console.log(`Open TokensFlow: ${targetUrl}`);
        }
      });
    }
  });
}

function macWindowBounds() {
  const raw = process.env.TOKENSFLOW_MAC_WINDOW_BOUNDS || "";
  const values = raw.split(",").map((value) => Number(value.trim()));
  if (values.length === 4 && values.every(Number.isFinite)) {
    return values;
  }

  return defaultMacWindowBounds;
}

function appleScriptString(value) {
  return `"${String(value).replaceAll("\\", "\\\\").replaceAll("\"", "\\\"")}"`;
}

async function startTrayBackground({ cwd, tool }) {
  const { SWIFTBAR_PLUGIN_PATH, TRAY_REFRESH_MS } = await import("../lib/tray.js");
  const child = spawn(process.execPath, [
    process.argv[1],
    "--tray-worker",
    "--tool",
    tool,
    "--cwd",
    cwd
  ], {
    detached: true,
    stdio: "ignore",
    env: {
      ...process.env,
      TOKENSFLOW_TOOL: tool,
      TOKENSFLOW_SOURCE: tool,
      TOKENSFLOW_CWD: cwd
    }
  });

  child.unref();
  console.log("TokensFlow tray worker started.");
  console.log(`Provider: ${toolLabel(tool)}`);
  console.log(`Project: ${cwd}`);
  console.log(`Menu bar refresh: every ${Math.round(TRAY_REFRESH_MS / 1000)}s`);
  console.log(`SwiftBar fallback: ${SWIFTBAR_PLUGIN_PATH}`);
}

function parseArgs(argv) {
  const args = {
    cwd: "",
    tool: "",
    noOpen: false,
    status: false,
    tray: false,
    trayWorker: false
  };

  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];

    if (value === ".") {
      args.cwd = process.cwd();
      continue;
    }

    if (value === "--no-open") {
      args.noOpen = true;
      continue;
    }

    if (value === "--status") {
      args.status = true;
      continue;
    }

    if (value === "--tray") {
      args.tray = true;
      continue;
    }

    if (value === "--tray-worker") {
      args.trayWorker = true;
      continue;
    }

    if (value === "--cwd") {
      args.cwd = argv[index + 1] || "";
      index += 1;
      continue;
    }

    if (value.startsWith("--cwd=")) {
      args.cwd = value.slice("--cwd=".length);
      continue;
    }

    if (value === "--tool") {
      args.tool = normalizeTool(argv[index + 1]);
      index += 1;
      continue;
    }

    if (value.startsWith("--tool=")) {
      args.tool = normalizeTool(value.split("=")[1]);
      continue;
    }

    if (!value.startsWith("-") && !args.cwd) {
      args.cwd = value;
    }
  }

  return args;
}

function normalizeTool(value = "") {
  const normalized = value.trim().toLowerCase();
  if (normalized === "codex" || normalized === "json") {
    return normalized;
  }

  return "";
}

function toolLabel(tool) {
  return {
    codex: "Codex",
    json: "JSON"
  }[tool] || tool;
}
