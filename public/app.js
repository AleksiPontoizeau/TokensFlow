import {
  calculateTokenMetrics,
  formatCompactNumber
} from "./metrics.js";

const refreshMs = 2000;
const elements = {
  activityMeta: document.querySelector("#activityMeta"),
  agentsLabel: document.querySelector("#agentsLabel"),
  budgetTokens: document.querySelector("#budgetTokens"),
  burnRate: document.querySelector("#burnRate"),
  burnRateSuffix: document.querySelector("#burnRateSuffix"),
  costLabel: document.querySelector("#costLabel"),
  costSuffix: document.querySelector("#costSuffix"),
  costSummary: document.querySelector("#costSummary"),
  debugPanel: document.querySelector("#debugPanel"),
  historyAxis: document.querySelector("#historyAxis"),
  historyBars: document.querySelector("#historyBars"),
  hoursLeft: document.querySelector("#hoursLeft"),
  hoursLeftSuffix: document.querySelector("#hoursLeftSuffix"),
  inputTokens: document.querySelector("#inputTokens"),
  outputTokens: document.querySelector("#outputTokens"),
  quotaAsciiBar: document.querySelector("#quotaAsciiBar"),
  fiveHourQuotaBlock: document.querySelector("#fiveHourQuotaBlock"),
  quotaResetIn: document.querySelector("#quotaResetIn"),
  quotaResetLabel: document.querySelector("#quotaResetLabel"),
  refreshRate: document.querySelector("#refreshRate"),
  remainingPercent: document.querySelector("#remainingPercent"),
  remainingTokens: document.querySelector("#remainingTokens"),
  resetLabel: document.querySelector("#resetLabel"),
  scoreCaptionSuffix: document.querySelector("#scoreCaptionSuffix"),
  sessionsLabel: document.querySelector("#sessionsLabel"),
  snapshotAxis: document.querySelector("#snapshotAxis"),
  snapshotBars: document.querySelector("#snapshotBars"),
  snapshotEmpty: document.querySelector("#snapshotEmpty"),
  snapshotMeta: document.querySelector("#snapshotMeta"),
  snapshotQuotaLatest: document.querySelector("#snapshotQuotaLatest"),
  snapshotWeeklyLatest: document.querySelector("#snapshotWeeklyLatest"),
  sourceLabel: document.querySelector("#sourceLabel"),
  statusLabel: document.querySelector("#statusLabel"),
  updatedAt: document.querySelector("#updatedAt"),
  usedTokens: document.querySelector("#usedTokens"),
  weeklyAsciiBar: document.querySelector("#weeklyAsciiBar"),
  weeklyPercent: document.querySelector("#weeklyPercent"),
  weeklyPercentSuffix: document.querySelector("#weeklyPercentSuffix"),
  weeklyRemaining: document.querySelector("#weeklyRemaining"),
  weeklyRemainingSuffix: document.querySelector("#weeklyRemainingSuffix"),
  weeklyQuotaBlock: document.querySelector("#weeklyQuotaBlock"),
  weeklyResetIn: document.querySelector("#weeklyResetIn")
};

elements.refreshRate.textContent = `every ${refreshMs / 1000}s`;
let lastUsage = null;
let lastSnapshotHistory = null;

async function fetchUsage() {
  const response = await fetch("/api/usage", {
    cache: "no-store"
  });

  if (!response.ok) {
    throw new Error(`Usage endpoint returned ${response.status}.`);
  }

  return response.json();
}

async function fetchSnapshotHistory() {
  const response = await fetch("/api/history", {
    cache: "no-store"
  });

  if (!response.ok) {
    throw new Error(`History endpoint returned ${response.status}.`);
  }

  return response.json();
}

function renderUsage(usage) {
  const metrics = calculateTokenMetrics(usage);
  const isCodexQuota = usage.quotaMode === "codex-rate-limit";
  const isQuotaUnavailable = usage.quotaMode === "quota-unavailable";
  const freshness = getFreshnessState(usage);
  const remainingRounded = clampPercent(Math.round(
    isCodexQuota && Number.isFinite(Number(usage.quotaRemainingPercent))
      ? Number(usage.quotaRemainingPercent)
      : metrics.remainingPercent
  ));
  const quotaPercent = isQuotaUnavailable ? null : remainingRounded;
  const weeklyPercent = isQuotaUnavailable ? null : getWeeklyRemainingPercent(usage);

  renderQuotaAnchor({
    block: elements.fiveHourQuotaBlock,
    number: elements.remainingPercent,
    asciiBar: elements.quotaAsciiBar,
    reset: elements.quotaResetIn,
    percent: quotaPercent,
    resetAt: usage.quotaResetAt || usage.resetAt
  });
  renderQuotaAnchor({
    block: elements.weeklyQuotaBlock,
    number: elements.weeklyRemaining,
    asciiBar: elements.weeklyAsciiBar,
    reset: elements.weeklyResetIn,
    percent: weeklyPercent,
    resetAt: usage.weeklyResetAt
  });
  elements.remainingTokens.textContent = isQuotaUnavailable
    ? "quota"
    : isCodexQuota
    ? `${remainingRounded}%`
    : formatCompactNumber(metrics.remainingTokens);
  elements.scoreCaptionSuffix.textContent = isQuotaUnavailable ? "not" : isCodexQuota ? "left in" : "left of";
  elements.budgetTokens.textContent = isQuotaUnavailable
    ? "connected"
    : isCodexQuota
    ? "5h quota"
    : formatCompactNumber(metrics.budgetTokens);
  elements.usedTokens.textContent = formatCompactNumber(usage.localTotalTokens || metrics.usedTokens);
  if (isQuotaUnavailable) {
    elements.burnRate.textContent = "Last observed:";
    elements.burnRateSuffix.textContent = "--";
    elements.hoursLeft.textContent = "Status:";
    elements.hoursLeftSuffix.textContent = "offline";
  } else if (isCodexQuota) {
    elements.burnRate.textContent = "Last observed:";
    elements.burnRateSuffix.textContent = freshness.label;
    elements.hoursLeft.textContent = "Status:";
    elements.hoursLeftSuffix.textContent = freshness.status;
  } else {
    elements.burnRate.textContent = "Last observed:";
    elements.burnRateSuffix.textContent = freshness.label;
    elements.hoursLeft.textContent = "Status:";
    elements.hoursLeftSuffix.textContent = freshness.status;
  }
  elements.quotaResetLabel.textContent = isQuotaUnavailable ? "--" : formatReset(usage.quotaResetAt || usage.resetAt);
  elements.statusLabel.textContent = `${freshness.status} local file`;
  elements.statusLabel.className = `status-${freshness.status}`;

  elements.inputTokens.textContent = formatCompactNumber(usage.inputTokens);
  elements.outputTokens.textContent = formatCompactNumber(usage.outputTokens);
  elements.costSummary.textContent = `${formatUsd(usage.todayCostUsd)} today · ${formatUsd(usage.last24hCostUsd)} last 24h`;
  if (Number(usage.retailCostUsd) > 0) {
    elements.costLabel.textContent = `$${Number(usage.retailCostUsd).toFixed(2)}`;
    elements.costSuffix.textContent = "at retail";
  } else {
    elements.costLabel.textContent = "from";
    elements.costSuffix.textContent = "Codex session logs";
  }
  elements.sessionsLabel.textContent = String(usage.sessions ?? 0);
  elements.agentsLabel.textContent = Number(usage.agentsAverage || 0).toFixed(1);
  renderWeeklyQuota(usage);
  elements.resetLabel.textContent = "";
  elements.sourceLabel.textContent = usage.source || "local";
  elements.updatedAt.textContent = "not official OpenAI";

  renderHistory(usage.history || []);
  renderActivityMetadata(usage.debug || {});
  renderDebugPanel(usage, freshness);
}

function renderWeeklyQuota(usage) {
  if (usage.quotaMode === "quota-unavailable") {
    elements.weeklyRemainingSuffix.textContent = "left";
    elements.weeklyPercent.textContent = "--";
    elements.weeklyPercentSuffix.textContent = "remaining";
    return;
  }

  if (usage.quotaMode === "codex-rate-limit") {
    const weeklyRemainingPercent = Number(usage.weeklyRemainingPercent);
    const weeklyUsedPercent = Number(usage.weeklyUsedPercent);

    elements.weeklyRemainingSuffix.textContent = "left";
    elements.weeklyPercent.textContent = Number.isFinite(weeklyUsedPercent)
      ? `${Math.round(weeklyUsedPercent)}%`
      : "--";
    elements.weeklyPercentSuffix.textContent = "used";
    return;
  }

  const weeklyBudget = Math.max(Number(usage.weeklyBudgetTokens) || 0, 0);
  const weeklyUsed = Math.max(Number(usage.weeklyUsedTokens) || 0, 0);
  const weeklyRemaining = Math.max(weeklyBudget - weeklyUsed, 0);
  const weeklyPercent = weeklyBudget === 0 ? 0 : Math.max((weeklyRemaining / weeklyBudget) * 100, 0);

  elements.weeklyRemainingSuffix.textContent = "left";
  elements.weeklyPercent.textContent = `${Math.round(weeklyPercent)}%`;
  elements.weeklyPercentSuffix.textContent = "remaining";
}

function renderQuotaAnchor({ block, number, asciiBar, reset, percent, resetAt }) {
  const tone = quotaTone(percent);
  block.dataset.tone = tone;
  number.textContent = percent === null ? "--" : String(Math.round(percent)).padStart(2, "0");
  asciiBar.textContent = asciiProgressBar(percent);
  reset.textContent = percent === null ? "reset unavailable" : `resets in ${formatTimeUntil(resetAt)}`;
}

function formatUsd(value) {
  const amount = Number(value);
  if (!Number.isFinite(amount) || amount < 0) {
    return "$0.00";
  }

  return `$${amount.toFixed(2)}`;
}

function getWeeklyRemainingPercent(usage) {
  if (usage.quotaMode === "codex-rate-limit") {
    const remaining = Number(usage.weeklyRemainingPercent);
    return Number.isFinite(remaining) ? clampPercent(Math.round(remaining)) : null;
  }

  const weeklyBudget = Math.max(Number(usage.weeklyBudgetTokens) || 0, 0);
  const weeklyUsed = Math.max(Number(usage.weeklyUsedTokens) || 0, 0);
  if (weeklyBudget <= 0) {
    return null;
  }

  return clampPercent(Math.round(((weeklyBudget - weeklyUsed) / weeklyBudget) * 100));
}

function asciiProgressBar(percent, width = 16) {
  if (percent === null || !Number.isFinite(Number(percent))) {
    return `${"░".repeat(width)} --%`;
  }

  const clamped = clampPercent(percent);
  const filled = Math.round((clamped / 100) * width);
  return `${"█".repeat(filled)}${"░".repeat(width - filled)} ${String(Math.round(clamped)).padStart(2, " ")}%`;
}

function quotaTone(percent) {
  if (percent === null || !Number.isFinite(Number(percent))) {
    return "offline";
  }

  if (percent > 50) {
    return "green";
  }

  if (percent >= 20) {
    return "yellow";
  }

  return "red";
}

function clampPercent(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) {
    return 0;
  }

  return Math.max(0, Math.min(100, number));
}

function renderHistory(history) {
  const max = Math.max(...history.map((item) => Number(item.usedTokens) || 0), 1);
  elements.historyBars.innerHTML = "";
  elements.historyAxis.innerHTML = "";

  history.forEach((item) => {
    const bar = document.createElement("span");
    const height = Math.max(((Number(item.usedTokens) || 0) / max) * 100, 8);
    bar.style.height = `${height}%`;
    bar.title = [
      `hour: ${item.label}:00`,
      `input tokens: ${formatCompactNumber(item.inputTokens || item.usedTokens || 0)}`,
      `output tokens: ${formatCompactNumber(item.outputTokens || 0)}`,
      `events: ${item.events || 0}`
    ].join("\n");
    elements.historyBars.append(bar);

    const label = document.createElement("span");
    label.textContent = item.label;
    elements.historyAxis.append(label);
  });
}

function renderActivityMetadata(debug) {
  const metadata = [
    "Last 24h",
    debug.timezone || "--",
    `${debug.activeHours ?? 0} active hours`
  ];
  elements.activityMeta.textContent = metadata.join(" · ");
}

function renderDebugPanel(usage, freshness) {
  const debug = usage.debug || {};
  const latestRateLimitFile = debug.latestRateLimitFile
    ? shortenPath(debug.latestRateLimitFile)
    : "--";
  const hourlyBuckets = Array.isArray(debug.hourlyBuckets24h)
    ? debug.hourlyBuckets24h
      .map((bucket) => `${bucket.label}:${formatCompactNumber(bucket.usedTokens || 0)}${bucket.events ? `/${bucket.events}e` : ""}`)
      .join(" ")
    : "--";

  elements.debugPanel.textContent = [
    `files scanned: ${debug.scannedFiles ?? 0}`,
    `sessions parsed: ${debug.parsedSessions ?? 0}`,
    `events parsed: ${debug.parsedEvents ?? 0}`,
    `latest rate_limits file: ${latestRateLimitFile}`,
    `latest observedAt: ${debug.latestRateLimitObservedAt || usage.sourceObservedAt || "--"}`,
    `last Codex event: ${freshness.label}`,
    `timezone: ${debug.timezone || "--"}`,
    `window start: ${debug.windowStart || "--"}`,
    `window end: ${debug.windowEnd || "--"}`,
    `activity metric: ${debug.activityMetric || "--"}`,
    `hourly buckets: ${hourlyBuckets}`,
    `burn rate skipped reason: ${debug.burnRateSkippedReason || "--"}`
  ].join("\n");
  appendSnapshotDebug(lastSnapshotHistory);
}

function renderSnapshotHistory(history) {
  const buckets = Array.isArray(history.hourlyBuckets24h) ? history.hourlyBuckets24h : [];
  const summary = history.summary || {};
  const hasSnapshots = history.status === "ready" && buckets.some((bucket) => bucket.count > 0);

  elements.snapshotBars.innerHTML = "";
  elements.snapshotAxis.innerHTML = "";
  elements.snapshotEmpty.hidden = hasSnapshots;
  elements.snapshotEmpty.textContent = history.message || "No local history yet. Keep TokensFlow running and this timeline will fill itself.";
  elements.snapshotMeta.textContent = snapshotMetaLabel(history);
  elements.snapshotQuotaLatest.textContent = percentLabel(summary.quotaLatest);
  elements.snapshotWeeklyLatest.textContent = percentLabel(summary.weeklyLatest);
  appendSnapshotDebug(history);

  const renderBuckets = buckets.length > 0 ? buckets : emptySnapshotBuckets();
  renderBuckets.forEach((bucket) => {
    const column = document.createElement("span");
    column.className = "snapshot-column";
    column.title = [
      `hour: ${bucket.label}:00`,
      `5h quota: ${percentLabel(bucket.quotaRemainingPercent)}`,
      `weekly quota: ${percentLabel(bucket.weeklyRemainingPercent)}`,
      `history points: ${bucket.count || 0}`
    ].join("\n");

    const quota = document.createElement("span");
    quota.className = "snapshot-quota";
    quota.style.height = `${barHeight(bucket.quotaRemainingPercent)}%`;

    const weekly = document.createElement("span");
    weekly.className = "snapshot-weekly";
    weekly.style.height = `${barHeight(bucket.weeklyRemainingPercent)}%`;

    column.append(quota, weekly);
    elements.snapshotBars.append(column);
  });

  renderBuckets
    .filter((_, index) => index % 4 === 0)
    .forEach((bucket) => {
      const label = document.createElement("span");
      label.textContent = bucket.label;
      elements.snapshotAxis.append(label);
    });
}

function renderSnapshotError(error) {
  if (lastSnapshotHistory) {
    renderSnapshotHistory({
      ...lastSnapshotHistory,
      message: `History API error. Showing last loaded history.`
    });
    return;
  }

  renderSnapshotHistory({
    status: "error",
    message: error?.message || "History API error.",
    hourlyBuckets24h: emptySnapshotBuckets(),
    summary: {},
    debug: {}
  });
}

function formatReset(value) {
  if (!value) {
    return "--";
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "--";
  }

  return new Intl.DateTimeFormat("en-US", {
    hour: "2-digit",
    minute: "2-digit",
    month: "short",
    day: "numeric",
    hour12: false
  }).format(date);
}

function formatTimeUntil(value) {
  if (!value) {
    return "--";
  }

  const target = new Date(value);
  if (Number.isNaN(target.getTime())) {
    return "--";
  }

  const diffMs = target.getTime() - Date.now();
  if (diffMs <= 0) {
    return "now";
  }

  const totalMinutes = Math.ceil(diffMs / 60_000);
  const days = Math.floor(totalMinutes / 1440);
  const hours = Math.floor((totalMinutes % 1440) / 60);
  const minutes = totalMinutes % 60;

  if (days > 0) {
    return hours > 0 ? `${days}d ${hours}h` : `${days}d`;
  }

  if (hours > 0) {
    return minutes > 0 ? `${hours}h ${minutes}m` : `${hours}h`;
  }

  return `${minutes}m`;
}

function formatSourceFreshness(value) {
  const sourceDate = new Date(value);
  if (Number.isNaN(sourceDate.getTime())) {
    return "--";
  }

  const ageMs = Date.now() - sourceDate.getTime();
  if (ageMs < 0) {
    return "just now";
  }

  const ageSeconds = Math.floor(ageMs / 1000);
  if (ageSeconds < 60) {
    return `${ageSeconds}s ago`;
  }

  const ageMinutes = Math.floor(ageSeconds / 60);
  if (ageMinutes < 60) {
    return `${ageMinutes}m ago`;
  }

  const ageHours = Math.floor(ageMinutes / 60);
  return `${ageHours}h ago`;
}

function shortenPath(filePath) {
  if (typeof filePath !== "string" || filePath.trim() === "") {
    return "--";
  }

  const marker = ".codex/sessions/";
  const index = filePath.indexOf(marker);
  return index >= 0 ? filePath.slice(index + marker.length) : filePath;
}

function getFreshnessState(usage) {
  if (usage.quotaMode === "quota-unavailable") {
    return {
      ageSeconds: Infinity,
      label: "--",
      status: "offline"
    };
  }

  const sourceDate = new Date(usage.sourceObservedAt || usage.observedAt);
  if (Number.isNaN(sourceDate.getTime())) {
    return {
      ageSeconds: Infinity,
      label: "--",
      status: "offline"
    };
  }

  const ageSeconds = Math.max(Math.floor((Date.now() - sourceDate.getTime()) / 1000), 0);
  let status = "old";
  if (ageSeconds < 120) {
    status = "recent";
  } else if (ageSeconds < 30 * 60) {
    status = "idle";
  }

  return {
    ageSeconds,
    label: formatSourceFreshness(sourceDate.toISOString()),
    status
  };
}

function offlineUsage(error) {
  return {
    source: "codex unavailable",
    quotaMode: "quota-unavailable",
    budgetTokens: 100,
    usedTokens: 0,
    inputTokens: 0,
    outputTokens: 0,
    retailCostUsd: 0,
    burnRatePerHour: 0,
    sessions: 0,
    agentsAverage: 0,
    history: [],
    debug: {
      burnRateSkippedReason: error?.message || "Usage API is unavailable."
    }
  };
}

async function tick() {
  try {
    const usage = await fetchUsage();
    lastUsage = usage;
    renderUsage(usage);
  } catch (error) {
    console.warn(error);
    if (lastUsage) {
      renderUsage({
        ...lastUsage,
        source: `${lastUsage.source || "local"} · api error`
      });
      elements.statusLabel.textContent = "offline local file";
      elements.statusLabel.className = "status-offline";
    } else {
      renderUsage(offlineUsage(error));
    }
  }

  try {
    const snapshotHistory = await fetchSnapshotHistory();
    lastSnapshotHistory = snapshotHistory;
    renderSnapshotHistory(snapshotHistory);
  } catch (error) {
    console.warn(error);
    renderSnapshotError(error);
  }
}

tick();
setInterval(tick, refreshMs);

if ("serviceWorker" in navigator) {
  navigator.serviceWorker.getRegistrations()
    .then((registrations) => Promise.all(registrations.map((registration) => registration.unregister())))
    .catch((error) => {
      console.warn(error);
    });
}

if ("caches" in window) {
  caches.keys()
    .then((keys) => Promise.all(keys.map((key) => caches.delete(key))))
    .catch((error) => {
      console.warn(error);
    });
}

function snapshotMetaLabel(history) {
  if (history.status === "ready") {
    return `${history.summary?.count || 0} points · last 24h`;
  }

  if (history.status === "error") {
    return "history file unavailable";
  }

  return "no history yet";
}

function percentLabel(value) {
  return Number.isFinite(Number(value)) ? `${Math.round(Number(value))}%` : "--";
}

function barHeight(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) {
    return 2;
  }

  return Math.max(Math.min(number, 100), 2);
}

function emptySnapshotBuckets() {
  return Array.from({ length: 24 }, (_, index) => ({
    label: String(index).padStart(2, "0"),
    quotaRemainingPercent: null,
    weeklyRemainingPercent: null,
    count: 0
  }));
}

function appendSnapshotDebug(history) {
  if (!history) {
    return;
  }

  const debug = history.debug || {};
  const lines = [
    "",
    "local history:",
    `status: ${history.status || "--"}`,
    `message: ${history.message || "--"}`,
    `file: ${debug.filePath || "--"}`,
    `parsed history points: ${debug.parsedSnapshots ?? 0}`,
    `malformed lines: ${debug.malformedLines ?? 0}`,
    `old lines: ${debug.oldLines ?? 0}`
  ];
  const base = elements.debugPanel.textContent.split("\n\nlocal history:")[0];
  elements.debugPanel.textContent = `${base}${lines.join("\n")}`;
}
