import { codexDefaults, readCodexUsage } from "./codex-source.js";

export async function readCodexStatus(options = {}) {
  const usage = await readCodexUsage(codexStatusOptions(options));
  return summarizeCodexUsage(usage, options.now instanceof Date ? options.now : new Date(options.now || Date.now()));
}

export function summarizeCodexUsage(usage, now = new Date()) {
  const percent = quotaRemainingPercent(usage);
  const resetAt = usage?.quotaResetAt || usage?.resetAt || "";
  const resetCountdown = formatResetDuration(resetAt, now);
  const notificationResetCountdown = formatResetDuration(resetAt, now, { alwaysMinutes: true });

  return {
    percent,
    label: percent === null ? "TF?" : `${percent}%`,
    color: statusColor(percent),
    resetAt,
    resetCountdown,
    notificationResetCountdown,
    source: stringValue(usage?.source, "codex-local"),
    freshness: sourceFreshnessLabel(usage?.sourceObservedAt || usage?.observedAt, now),
    quotaMode: stringValue(usage?.quotaMode, ""),
    weeklyPercent: optionalRoundedPercent(usage?.weeklyRemainingPercent),
    todayCostUsd: positiveNumber(usage?.todayCostUsd, 0),
    last24hCostUsd: positiveNumber(usage?.last24hCostUsd, 0)
  };
}

export function formatSwiftBarStatus(summary) {
  const lines = [
    `${summary.label} | color=${summary.color}`,
    "---",
    `Codex quota: ${summary.percent === null ? "unavailable" : `${summary.percent}% left`}`,
    `Resets in: ${summary.resetCountdown}`,
    `Weekly quota: ${summary.weeklyPercent === null ? "--" : `${summary.weeklyPercent}% left`}`,
    `Cost: ${formatUsd(summary.todayCostUsd)} today · ${formatUsd(summary.last24hCostUsd)} last 24h`,
    `Freshness: ${summary.freshness}`,
    `Source: ${swiftBarText(summary.source)}`
  ];

  return `${lines.join("\n")}\n`;
}

export function formatQuotaNotification(summary) {
  if (summary.percent === null) {
    return "";
  }

  return `⚠️ Codex quota: ${summary.percent}% left — resets in ${summary.notificationResetCountdown}`;
}

export function shouldNotifyQuotaDrop(state, percent) {
  if (percent === null || !Number.isFinite(Number(percent))) {
    return false;
  }

  if (percent >= 20) {
    state.below20 = false;
    state.below10 = false;
    return false;
  }

  if (percent >= 10) {
    state.below10 = false;
    if (state.below20) {
      return false;
    }

    state.below20 = true;
    return true;
  }

  if (state.below10) {
    return false;
  }

  state.below20 = true;
  state.below10 = true;
  return true;
}

export function formatResetDuration(value, now = new Date(), options = {}) {
  const target = new Date(value);
  if (!value || Number.isNaN(target.getTime())) {
    return "--";
  }

  const diffMs = target.getTime() - now.getTime();
  if (diffMs <= 0) {
    return options.alwaysMinutes ? "0h 0m" : "now";
  }

  const totalMinutes = Math.ceil(diffMs / 60_000);
  const days = Math.floor(totalMinutes / 1440);
  const hours = Math.floor((totalMinutes % 1440) / 60);
  const minutes = totalMinutes % 60;

  if (days > 0) {
    return hours > 0 ? `${days}d ${hours}h` : `${days}d`;
  }

  if (options.alwaysMinutes) {
    return `${hours}h ${minutes}m`;
  }

  if (hours > 0) {
    return minutes > 0 ? `${hours}h ${minutes}m` : `${hours}h`;
  }

  return `${minutes}m`;
}

export function quotaRemainingPercent(usage) {
  if (!usage || typeof usage !== "object") {
    return null;
  }

  const codexRemaining = optionalRoundedPercent(usage.quotaRemainingPercent);
  if (usage.quotaMode === "codex-rate-limit" && codexRemaining !== null) {
    return codexRemaining;
  }

  if (usage.quotaMode === "quota-unavailable") {
    return null;
  }

  const budget = positiveNumber(usage.budgetTokens, 0);
  const used = positiveNumber(usage.usedTokens, 0);
  if (budget <= 0) {
    return null;
  }

  return clampPercent(Math.round(((budget - used) / budget) * 100));
}

function codexStatusOptions(options) {
  const cwd = options.cwd || process.env.TOKENSFLOW_CWD || process.cwd();
  const defaults = codexDefaults(cwd);

  return {
    ...defaults,
    cwd,
    threadId: options.threadId || process.env.TOKENSFLOW_THREAD_ID || "",
    stateDb: options.stateDb || process.env.TOKENSFLOW_CODEX_STATE_DB || defaults.stateDb,
    goalsDb: options.goalsDb || process.env.TOKENSFLOW_CODEX_GOALS_DB || defaults.goalsDb,
    sessionsRoot: options.sessionsRoot || process.env.TOKENSFLOW_CODEX_SESSIONS_ROOT || defaults.sessionsRoot,
    budgetTokens: Number(options.budgetTokens || process.env.TOKENSFLOW_BUDGET_TOKENS || defaults.budgetTokens),
    weeklyBudgetTokens: Number(
      options.weeklyBudgetTokens || process.env.TOKENSFLOW_WEEKLY_BUDGET_TOKENS || defaults.weeklyBudgetTokens
    ),
    now: options.now
  };
}

function sourceFreshnessLabel(value, now) {
  const observedAt = new Date(value);
  if (!value || Number.isNaN(observedAt.getTime())) {
    return "--";
  }

  const ageMs = now.getTime() - observedAt.getTime();
  if (ageMs < 0) {
    return "just now";
  }

  const minutes = Math.floor(ageMs / 60_000);
  if (minutes < 1) {
    return "just now";
  }

  if (minutes < 60) {
    return `${minutes}m ago`;
  }

  const hours = Math.floor(minutes / 60);
  return `${hours}h ago`;
}

function statusColor(percent) {
  if (percent === null) {
    return "#74839d";
  }

  if (percent > 50) {
    return "#78dcff";
  }

  if (percent >= 20) {
    return "#5fa8ff";
  }

  return "#8b7cff";
}

function formatUsd(value) {
  return `$${positiveNumber(value, 0).toFixed(2)}`;
}

function swiftBarText(value) {
  return String(value || "").replaceAll("|", "/");
}

function optionalRoundedPercent(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) {
    return null;
  }

  return clampPercent(Math.round(number));
}

function clampPercent(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) {
    return 0;
  }

  return Math.max(0, Math.min(100, number));
}

function positiveNumber(value, fallback) {
  const number = Number(value);
  if (!Number.isFinite(number) || number < 0) {
    return fallback;
  }

  return number;
}

function stringValue(value, fallback) {
  if (typeof value !== "string" || value.trim() === "") {
    return fallback;
  }

  return value.trim();
}
