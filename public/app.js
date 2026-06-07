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
  debugPanel: document.querySelector("#debugPanel"),
  historyAxis: document.querySelector("#historyAxis"),
  historyBars: document.querySelector("#historyBars"),
  hoursLeft: document.querySelector("#hoursLeft"),
  hoursLeftSuffix: document.querySelector("#hoursLeftSuffix"),
  inputTokens: document.querySelector("#inputTokens"),
  meterFill: document.querySelector("#meterFill"),
  outputTokens: document.querySelector("#outputTokens"),
  quotaResetIn: document.querySelector("#quotaResetIn"),
  quotaResetLabel: document.querySelector("#quotaResetLabel"),
  refreshRate: document.querySelector("#refreshRate"),
  remainingPercent: document.querySelector("#remainingPercent"),
  remainingTokens: document.querySelector("#remainingTokens"),
  resetLabel: document.querySelector("#resetLabel"),
  scoreCaptionSuffix: document.querySelector("#scoreCaptionSuffix"),
  sessionsLabel: document.querySelector("#sessionsLabel"),
  sourceLabel: document.querySelector("#sourceLabel"),
  statusLabel: document.querySelector("#statusLabel"),
  updatedAt: document.querySelector("#updatedAt"),
  usedTokens: document.querySelector("#usedTokens"),
  weeklyPercent: document.querySelector("#weeklyPercent"),
  weeklyPercentSuffix: document.querySelector("#weeklyPercentSuffix"),
  weeklyRemaining: document.querySelector("#weeklyRemaining"),
  weeklyRemainingSuffix: document.querySelector("#weeklyRemainingSuffix")
};

elements.refreshRate.textContent = `every ${refreshMs / 1000}s`;

async function fetchUsage() {
  const response = await fetch("/api/usage", {
    cache: "no-store"
  });

  if (!response.ok) {
    throw new Error(`Usage endpoint returned ${response.status}.`);
  }

  return response.json();
}

function renderUsage(usage) {
  const metrics = calculateTokenMetrics(usage);
  const isCodexQuota = usage.quotaMode === "codex-rate-limit";
  const isQuotaUnavailable = usage.quotaMode === "quota-unavailable";
  const freshness = getFreshnessState(usage);
  const remainingRounded = Math.round(
    isCodexQuota && Number.isFinite(Number(usage.quotaRemainingPercent))
      ? Number(usage.quotaRemainingPercent)
      : metrics.remainingPercent
  );

  elements.remainingPercent.textContent = isQuotaUnavailable ? "--" : String(remainingRounded).padStart(2, "0");
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
  elements.quotaResetIn.textContent = isQuotaUnavailable ? "--" : formatTimeUntil(usage.quotaResetAt || usage.resetAt);
  elements.quotaResetLabel.textContent = isQuotaUnavailable ? "--" : formatReset(usage.quotaResetAt || usage.resetAt);
  elements.statusLabel.textContent = `${freshness.status} snapshot`;
  elements.statusLabel.className = `status-${freshness.status}`;
  elements.meterFill.style.width = isQuotaUnavailable ? "0%" : `${remainingRounded}%`;

  elements.inputTokens.textContent = formatCompactNumber(usage.inputTokens);
  elements.outputTokens.textContent = formatCompactNumber(usage.outputTokens);
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
    elements.weeklyRemaining.textContent = "--";
    elements.weeklyRemainingSuffix.textContent = "left";
    elements.weeklyPercent.textContent = "--";
    elements.weeklyPercentSuffix.textContent = "remaining";
    return;
  }

  if (usage.quotaMode === "codex-rate-limit") {
    const weeklyRemainingPercent = Number(usage.weeklyRemainingPercent);
    const weeklyUsedPercent = Number(usage.weeklyUsedPercent);

    elements.weeklyRemaining.textContent = Number.isFinite(weeklyRemainingPercent)
      ? `${Math.round(weeklyRemainingPercent)}%`
      : "--";
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

  elements.weeklyRemaining.textContent = formatCompactNumber(weeklyRemaining);
  elements.weeklyRemainingSuffix.textContent = "left";
  elements.weeklyPercent.textContent = `${Math.round(weeklyPercent)}%`;
  elements.weeklyPercentSuffix.textContent = "remaining";
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

function fallbackUsage() {
  const now = Date.now();
  const budgetTokens = 1_000_000;
  const drift = Math.floor((Math.sin(now / 12_000) + 1) * 4200);
  const usedTokens = 318_400 + drift;

  return {
    source: "demo-fallback",
    budgetTokens,
    usedTokens,
    inputTokens: Math.round(usedTokens * 0.68),
    outputTokens: Math.round(usedTokens * 0.32),
    retailCostUsd: 42.18,
    burnRatePerHour: 14_800 + Math.round(drift / 4),
    quotaResetAt: new Date(now + 5 * 60 * 60 * 1000).toISOString(),
    weeklyBudgetTokens: 5_000_000,
    weeklyUsedTokens: 1_120_000 + drift,
    weeklyResetAt: new Date(now + 2 * 24 * 60 * 60 * 1000).toISOString(),
    sessions: 9,
    agentsAverage: 2.2,
    resetAt: new Date(now + 8 * 60 * 60 * 1000).toISOString(),
    history: ["00", "03", "06", "09", "12", "15", "18", "21"].map((label, index) => ({
      label,
      usedTokens: 16_000 + Math.round(Math.abs(Math.sin(now / 7000 + index)) * 80_000)
    }))
  };
}

async function tick() {
  try {
    renderUsage(await fetchUsage());
  } catch (error) {
    console.warn(error);
    renderUsage(fallbackUsage());
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
