#!/usr/bin/env node
import { execFile } from "node:child_process";
import path from "node:path";
import readline from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";

const port = Number(process.env.PORT || 3000);
const url = `http://127.0.0.1:${port}`;
const args = parseArgs(process.argv.slice(2));
const cwd = path.resolve(args.cwd || process.cwd());
const tool = args.tool || process.env.TOKENSFLOW_TOOL || await chooseTool();

process.env.TOKENSFLOW_TOOL = tool;
process.env.TOKENSFLOW_SOURCE = tool;
process.env.TOKENSFLOW_CWD = cwd;

const { startServer } = await import("../server.mjs");
const server = startServer({ port });

console.log(`Provider: ${toolLabel(tool)}`);
console.log(`Project: ${cwd}`);

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
  const command = platform === "darwin" ? "open" : platform === "win32" ? "cmd" : "xdg-open";
  const args = platform === "win32" ? ["/c", "start", "", targetUrl] : [targetUrl];

  execFile(command, args, (error) => {
    if (error) {
      console.log(`Open TokensFlow: ${targetUrl}`);
    }
  });
}

async function chooseTool() {
  if (!input.isTTY) {
    return "codex";
  }

  const rl = readline.createInterface({ input, output });
  const choices = [
    ["1", "codex", "Codex"],
    ["2", "claude", "Claude Code"],
    ["3", "cursor", "Cursor"]
  ];

  console.log("TokensFlow provider");
  for (const [number, , label] of choices) {
    console.log(`  ${number}. ${label}`);
  }

  const answer = await rl.question("Choose a token source [1]: ");
  rl.close();

  const normalized = answer.trim().toLowerCase();
  const match = choices.find(([number, value, label]) =>
    normalized === number || normalized === value || normalized === label.toLowerCase()
  );

  return match?.[1] || "codex";
}

function parseArgs(argv) {
  const args = {
    cwd: "",
    tool: "",
    noOpen: false
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

    if (value === "--tool" || value === "--provider") {
      args.tool = normalizeTool(argv[index + 1]);
      index += 1;
      continue;
    }

    if (value.startsWith("--tool=") || value.startsWith("--provider=")) {
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
  if (normalized === "claude-code" || normalized === "claude_code") {
    return "claude";
  }

  if (normalized === "codex" || normalized === "claude" || normalized === "cursor" || normalized === "json") {
    return normalized;
  }

  return "";
}

function toolLabel(tool) {
  return {
    codex: "Codex",
    claude: "Claude Code",
    cursor: "Cursor",
    json: "JSON"
  }[tool] || tool;
}
