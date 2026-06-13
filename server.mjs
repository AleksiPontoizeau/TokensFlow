import { createReadStream } from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createSnapshotRecorder } from "./lib/snapshot-recorder.js";
import { readSnapshotHistory } from "./lib/snapshot-history.js";
import { createUsageSource } from "./lib/usage-source.js";
import { assertUsagePayload } from "./lib/usage-schema.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const publicDir = path.join(__dirname, "public");
const dataFile = path.join(__dirname, "data", "usage.json");
const snapshotFile = process.env.TOKENSFLOW_HISTORY_FILE
  || process.env.TOKENSFLOW_SNAPSHOT_FILE
  || path.join(os.homedir(), ".tokensflow", "snapshots.jsonl");
const port = Number(process.env.PORT || 3000);
const mimeTypes = new Map([
  [".css", "text/css; charset=utf-8"],
  [".html", "text/html; charset=utf-8"],
  [".js", "text/javascript; charset=utf-8"],
  [".json", "application/json; charset=utf-8"],
  [".svg", "image/svg+xml; charset=utf-8"]
]);

function sendJson(response, statusCode, body) {
  response.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store, no-cache, must-revalidate, proxy-revalidate",
    "Pragma": "no-cache",
    "Expires": "0",
    "Surrogate-Control": "no-store"
  });
  response.end(JSON.stringify(body, null, 2));
}

function readRequestBody(request) {
  return new Promise((resolve, reject) => {
    let body = "";
    request.on("data", (chunk) => {
      body += chunk;
      if (body.length > 1_000_000) {
        reject(new Error("Request body is too large."));
        request.destroy();
      }
    });
    request.on("end", () => resolve(body));
    request.on("error", reject);
  });
}

async function handleUsage(request, response, runtimeConfig = createRuntimeConfig()) {
  const usageSource = createUsageSource(runtimeConfig);

  if (request.method === "GET") {
    const usage = await usageSource.read();
    sendJson(response, 200, {
      ...usage,
      debug: {
        ...(usage.debug || {}),
        history: runtimeConfig.snapshot,
        snapshots: runtimeConfig.snapshot
      }
    });
    return;
  }

  if (request.method === "POST") {
    const body = await readRequestBody(request);
    const usage = JSON.parse(body || "{}");
    assertUsagePayload(usage);
    await usageSource.write(usage);
    sendJson(response, 200, {
      ok: true,
      savedAt: new Date().toISOString()
    });
    return;
  }

  sendJson(response, 405, { error: "Method not allowed." });
}

async function handleSnapshots(request, response, runtimeConfig = createRuntimeConfig()) {
  if (request.method !== "GET") {
    sendJson(response, 405, { error: "Method not allowed." });
    return;
  }

  const history = await readSnapshotHistory({
    filePath: runtimeConfig.snapshot.filePath
  });
  sendJson(response, 200, history);
}

function createRuntimeConfig() {
  const source = process.env.TOKENSFLOW_SOURCE || process.env.TOKENSFLOW_TOOL || "auto";

  return {
    source,
    dataFile,
    snapshot: {
      enabled: (process.env.TOKENSFLOW_HISTORY || process.env.TOKENSFLOW_SNAPSHOTS) !== "0",
      intervalMs: Number(
        process.env.TOKENSFLOW_HISTORY_INTERVAL_MS
          || process.env.TOKENSFLOW_SNAPSHOT_INTERVAL_MS
          || 5 * 60 * 1000
      ),
      filePath: snapshotFile
    },
    codex: {
      cwd: process.env.TOKENSFLOW_CWD || process.cwd(),
      threadId: process.env.TOKENSFLOW_THREAD_ID || "",
      stateDb: process.env.TOKENSFLOW_CODEX_STATE_DB || path.join(os.homedir(), ".codex", "state_5.sqlite"),
      goalsDb: process.env.TOKENSFLOW_CODEX_GOALS_DB || path.join(os.homedir(), ".codex", "goals_1.sqlite"),
      sessionsRoot: process.env.TOKENSFLOW_CODEX_SESSIONS_ROOT || path.join(os.homedir(), ".codex", "sessions"),
      budgetTokens: Number(process.env.TOKENSFLOW_BUDGET_TOKENS || 2_000_000),
      weeklyBudgetTokens: Number(process.env.TOKENSFLOW_WEEKLY_BUDGET_TOKENS || 10_000_000)
    },
    claude: {
      provider: "claude",
      usageFile: process.env.TOKENSFLOW_CLAUDE_USAGE_FILE,
      budgetTokens: Number(process.env.TOKENSFLOW_BUDGET_TOKENS || 2_000_000),
      weeklyBudgetTokens: Number(process.env.TOKENSFLOW_WEEKLY_BUDGET_TOKENS || 10_000_000)
    },
    cursor: {
      provider: "cursor",
      usageFile: process.env.TOKENSFLOW_CURSOR_USAGE_FILE,
      budgetTokens: Number(process.env.TOKENSFLOW_BUDGET_TOKENS || 2_000_000),
      weeklyBudgetTokens: Number(process.env.TOKENSFLOW_WEEKLY_BUDGET_TOKENS || 10_000_000)
    }
  };
}

function serveStatic(request, response) {
  const url = new URL(request.url, `http://${request.headers.host}`);
  const requestedPath = url.pathname === "/" ? "/index.html" : url.pathname;
  const normalizedPath = path.normalize(decodeURIComponent(requestedPath)).replace(/^(\.\.[/\\])+/, "");
  const filePath = path.join(publicDir, normalizedPath);

  if (!filePath.startsWith(publicDir)) {
    sendJson(response, 403, { error: "Forbidden." });
    return;
  }

  const stream = createReadStream(filePath);
  const ext = path.extname(filePath);
  response.writeHead(200, {
    "Content-Type": mimeTypes.get(ext) || "application/octet-stream",
    "Cache-Control": "no-store"
  });
  stream.pipe(response);
  stream.on("error", () => {
    response.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
    response.end("Not found");
  });
}

export function createTokensFlowServer(options = {}) {
  return http.createServer(async (request, response) => {
    const runtimeConfig = options.runtimeConfig || createRuntimeConfig();

    try {
      if (request.url?.startsWith("/api/history") || request.url?.startsWith("/api/snapshots")) {
        await handleSnapshots(request, response, runtimeConfig);
        return;
      }

      if (request.url?.startsWith("/api/usage")) {
        await handleUsage(request, response, runtimeConfig);
        return;
      }

      serveStatic(request, response);
    } catch (error) {
      sendJson(response, 500, {
        error: error instanceof Error ? error.message : "Unknown server error."
      });
    }
  });
}

export function startServer(options = {}) {
  const server = createTokensFlowServer();
  const listenPort = Number(options.port ?? port);
  const runtimeConfig = createRuntimeConfig();
  const usageSource = createUsageSource(runtimeConfig);
  const recorder = createSnapshotRecorder(usageSource, {
    ...runtimeConfig.snapshot,
    ...(options.snapshotRecorder || {})
  });

  server.listen(listenPort, "127.0.0.1", () => {
    console.log(`TokensFlow running at http://127.0.0.1:${listenPort}`);
    console.log(`History: ${recorder.filePath} every ${Math.round(recorder.intervalMs / 60_000)}m`);
    recorder.start();
  });
  server.on("close", () => recorder.stop());

  return server;
}

export async function startServerOnAvailablePort(options = {}) {
  const server = createTokensFlowServer();
  const requestedPort = Number(options.port ?? port);
  const runtimeConfig = createRuntimeConfig();
  const usageSource = createUsageSource(runtimeConfig);
  const recorder = createSnapshotRecorder(usageSource, {
    ...runtimeConfig.snapshot,
    ...(options.snapshotRecorder || {})
  });
  const listenPort = await listenOnAvailablePort(server, {
    port: requestedPort,
    allowFallback: options.allowPortFallback !== false,
    maxPort: Number(options.maxPort || requestedPort + 10)
  });

  if (options.log !== false) {
    console.log(`TokensFlow running at http://127.0.0.1:${listenPort}`);
    console.log(`History: ${recorder.filePath} every ${Math.round(recorder.intervalMs / 60_000)}m`);
  }
  recorder.start();
  server.on("close", () => recorder.stop());

  return {
    server,
    port: listenPort,
    snapshotFile: recorder.filePath,
    snapshotIntervalMs: recorder.intervalMs
  };
}

export function listenOnAvailablePort(server, options = {}) {
  const host = options.host || "127.0.0.1";
  const requestedPort = Number(options.port ?? port);
  const allowFallback = options.allowFallback !== false;
  const maxPort = Number(options.maxPort || requestedPort + 10);

  return new Promise((resolve, reject) => {
    let currentPort = requestedPort;

    function tryListen() {
      const onError = (error) => {
        server.off("listening", onListening);
        if (error?.code === "EADDRINUSE" && allowFallback && currentPort < maxPort) {
          currentPort += 1;
          tryListen();
          return;
        }

        reject(error);
      };

      const onListening = () => {
        server.off("error", onError);
        resolve(currentPort);
      };

      server.once("error", onError);
      server.once("listening", onListening);
      server.listen(currentPort, host);
    }

    tryListen();
  });
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  startServer({ port });
}
