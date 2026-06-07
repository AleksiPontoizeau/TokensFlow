export const defaultUsage = {
  source: "demo-json",
  budgetTokens: 1_000_000,
  usedTokens: 318_400,
  inputTokens: 217_900,
  outputTokens: 100_500,
  retailCostUsd: 42.18,
  burnRatePerHour: 14_800,
  quotaResetAt: "2026-06-07T00:00:00+02:00",
  weeklyBudgetTokens: 5_000_000,
  weeklyUsedTokens: 1_120_000,
  weeklyResetAt: "2026-06-08T00:00:00+02:00",
  sessions: 9,
  agentsAverage: 2.2,
  resetAt: "2026-06-07T00:00:00+02:00",
  history: [
    { label: "00", usedTokens: 16_000 },
    { label: "03", usedTokens: 9_000 },
    { label: "06", usedTokens: 46_000 },
    { label: "09", usedTokens: 32_000 },
    { label: "12", usedTokens: 72_000 },
    { label: "15", usedTokens: 51_000 },
    { label: "18", usedTokens: 90_000 },
    { label: "21", usedTokens: 66_400 }
  ]
};

export function normalizeUsage(input, now = new Date()) {
  const usage = input && typeof input === "object" ? input : {};
  const budgetTokens = positiveInteger(usage.budgetTokens, defaultUsage.budgetTokens);
  const usedTokens = positiveInteger(usage.usedTokens, 0);
  const inputTokens = positiveInteger(usage.inputTokens, Math.round(usedTokens * 0.7));
  const outputTokens = positiveInteger(usage.outputTokens, Math.max(usedTokens - inputTokens, 0));
  const burnRatePerHour = positiveInteger(usage.burnRatePerHour, 0);
  const resetAt = validDateString(usage.resetAt) || nextMidnight(now).toISOString();
  const quotaResetAt = validDateString(usage.quotaResetAt) || resetAt;
  const weeklyBudgetTokens = positiveInteger(
    usage.weeklyBudgetTokens,
    Math.max(budgetTokens * 5, defaultUsage.weeklyBudgetTokens)
  );
  const weeklyUsedTokens = positiveInteger(usage.weeklyUsedTokens, usedTokens);

  return {
    source: stringValue(usage.source, "local"),
    quotaMode: stringValue(usage.quotaMode, ""),
    quotaUsedPercent: optionalPercent(usage.quotaUsedPercent),
    quotaRemainingPercent: optionalPercent(usage.quotaRemainingPercent),
    weeklyUsedPercent: optionalPercent(usage.weeklyUsedPercent),
    weeklyRemainingPercent: optionalPercent(usage.weeklyRemainingPercent),
    quotaWindowMinutes: positiveInteger(usage.quotaWindowMinutes, 0),
    localTotalTokens: positiveInteger(usage.localTotalTokens, 0),
    budgetTokens,
    usedTokens,
    inputTokens,
    outputTokens,
    retailCostUsd: positiveNumber(usage.retailCostUsd, 0),
    burnRatePerHour,
    quotaResetAt,
    weeklyBudgetTokens,
    weeklyUsedTokens,
    weeklyResetAt: validDateString(usage.weeklyResetAt) || nextWeekStart(now).toISOString(),
    sessions: positiveInteger(usage.sessions, 1),
    agentsAverage: positiveNumber(usage.agentsAverage, 1),
    resetAt,
    observedAt: validDateString(usage.observedAt) || now.toISOString(),
    sourceObservedAt: validDateString(usage.sourceObservedAt) || validDateString(usage.observedAt) || now.toISOString(),
    history: normalizeHistory(usage.history),
    debug: normalizeDebug(usage.debug)
  };
}

export function assertUsagePayload(input) {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new Error("Usage payload must be a JSON object.");
  }

  if (!Number.isFinite(Number(input.budgetTokens)) || Number(input.budgetTokens) <= 0) {
    throw new Error("Usage payload requires a positive budgetTokens number.");
  }

  if (!Number.isFinite(Number(input.usedTokens)) || Number(input.usedTokens) < 0) {
    throw new Error("Usage payload requires a non-negative usedTokens number.");
  }
}

export function nextMidnight(now = new Date()) {
  const next = new Date(now);
  next.setHours(24, 0, 0, 0);
  return next;
}

export function nextWeekStart(now = new Date()) {
  const next = new Date(now);
  const day = next.getDay();
  const daysUntilMonday = day === 0 ? 1 : 8 - day;
  next.setDate(next.getDate() + daysUntilMonday);
  next.setHours(0, 0, 0, 0);
  return next;
}

function normalizeHistory(history) {
  if (!Array.isArray(history)) {
    return [];
  }

  return history
    .slice(0, 24)
    .map((item, index) => ({
      label: stringValue(item?.label, String(index).padStart(2, "0")).slice(0, 8),
      usedTokens: positiveInteger(item?.usedTokens, 0),
      inputTokens: positiveInteger(item?.inputTokens, 0),
      outputTokens: positiveInteger(item?.outputTokens, 0),
      events: positiveInteger(item?.events, 0)
    }));
}

function normalizeDebug(debug) {
  if (!debug || typeof debug !== "object" || Array.isArray(debug)) {
    return {};
  }

  return {
    scannedFiles: positiveInteger(debug.scannedFiles, 0),
    scannedFilePaths: normalizeStringArray(debug.scannedFilePaths),
    parsedEvents: positiveInteger(debug.parsedEvents, 0),
    parsedSessions: positiveInteger(debug.parsedSessions, 0),
    activeHours: positiveInteger(debug.activeHours, 0),
    hourlyBuckets24h: normalizeHistory(debug.hourlyBuckets24h),
    timezone: stringValue(debug.timezone, ""),
    windowStart: validDateString(debug.windowStart) || "",
    windowEnd: validDateString(debug.windowEnd) || "",
    latestEventAt: validDateString(debug.latestEventAt) || "",
    latestEventLocalTime: stringValue(debug.latestEventLocalTime, "--"),
    activityMetric: stringValue(debug.activityMetric, ""),
    latestRateLimitFile: stringValue(debug.latestRateLimitFile, ""),
    latestRateLimitObservedAt: validDateString(debug.latestRateLimitObservedAt) || "",
    burnRateSkippedReason: stringValue(debug.burnRateSkippedReason, ""),
    tokenEvents: positiveInteger(debug.tokenEvents, 0),
    eventFallbacks: positiveInteger(debug.eventFallbacks, 0)
  };
}

function normalizeStringArray(value) {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .filter((item) => typeof item === "string" && item.trim() !== "")
    .slice(0, 500)
    .map((item) => item.trim());
}

function positiveInteger(value, fallback) {
  const number = Number(value);
  if (!Number.isFinite(number) || number < 0) {
    return fallback;
  }

  return Math.round(number);
}

function positiveNumber(value, fallback) {
  const number = Number(value);
  if (!Number.isFinite(number) || number < 0) {
    return fallback;
  }

  return number;
}

function optionalPercent(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) {
    return null;
  }

  return Math.min(Math.max(number, 0), 100);
}

function stringValue(value, fallback) {
  if (typeof value !== "string" || value.trim() === "") {
    return fallback;
  }

  return value.trim();
}

function validDateString(value) {
  if (typeof value !== "string") {
    return null;
  }

  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}
