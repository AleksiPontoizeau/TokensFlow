import { execFile } from "node:child_process";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { nextMidnight, nextWeekStart, normalizeUsage } from "./usage-schema.js";

const execFileAsync = promisify(execFile);

export function codexDefaults(cwd = process.cwd()) {
  return {
    cwd,
    stateDb: path.join(os.homedir(), ".codex", "state_5.sqlite"),
    goalsDb: path.join(os.homedir(), ".codex", "goals_1.sqlite"),
    sessionsRoot: path.join(os.homedir(), ".codex", "sessions"),
    budgetTokens: 2_000_000,
    weeklyBudgetTokens: 10_000_000
  };
}

export const CODEX_ACTIVITY_TIMEZONE = "Europe/Paris";

export async function readCodexUsage(options = {}) {
  const config = {
    ...codexDefaults(),
    ...options
  };

  await assertReadable(config.stateDb);
  const thread = await selectThread(config);
  const goal = await selectGoal(config.goalsDb, thread.id);
  const rateLimitSnapshot = await readLatestCodexRateLimit(config.sessionsRoot);
  const activity = await buildCodexActivity24h(config.sessionsRoot, {
    now: new Date(),
    timezone: CODEX_ACTIVITY_TIMEZONE
  });
  const budgetTokens = positiveInteger(goal?.token_budget, positiveInteger(config.budgetTokens, 2_000_000));
  const localUsedTokens = positiveInteger(
    rateLimitSnapshot?.usage?.total_tokens,
    positiveInteger(goal?.tokens_used, positiveInteger(thread.tokens_used, 0))
  );
  const basePayload = {
    inputTokens: positiveInteger(rateLimitSnapshot?.usage?.input_tokens, Math.round(localUsedTokens * 0.68)),
    outputTokens: positiveInteger(rateLimitSnapshot?.usage?.output_tokens, Math.round(localUsedTokens * 0.32)),
    retailCostUsd: 0,
    sessions: Math.max(activity.parsedSessions, 1),
    agentsAverage: Math.max(activity.activeHours, 1),
    resetAt: nextMidnight().toISOString(),
    history: compressHistoryForDisplay(activity.hourlyBuckets24h),
    observedAt: new Date().toISOString(),
    sourceObservedAt: rateLimitSnapshot?.observedAt?.toISOString(),
    debug: {
      ...activity,
      latestRateLimitFile: rateLimitSnapshot?.filePath || "",
      latestRateLimitObservedAt: rateLimitSnapshot?.observedAt?.toISOString() || "",
      burnRateSkippedReason: "Codex quota is a percentage snapshot; local token totals are not used to compute quota runway."
    }
  };

  if (rateLimitSnapshot?.rateLimits?.primary || rateLimitSnapshot?.rateLimits?.secondary) {
    const primary = normalizeLimitWindow(rateLimitSnapshot.rateLimits.primary);
    const secondary = normalizeLimitWindow(rateLimitSnapshot.rateLimits.secondary);
    const quotaUsedPercent = primary?.usedPercent ?? null;
    const weeklyUsedPercent = secondary?.usedPercent ?? null;
    const quotaRemainingPercent = quotaUsedPercent === null ? null : Math.max(100 - quotaUsedPercent, 0);
    const weeklyRemainingPercent = weeklyUsedPercent === null ? null : Math.max(100 - weeklyUsedPercent, 0);

    return normalizeUsage({
      ...basePayload,
      source: `codex-rate-limits · ${rateLimitSnapshot.rateLimits.plan_type || "plan"}`,
      quotaMode: "codex-rate-limit",
      quotaUsedPercent,
      quotaRemainingPercent,
      weeklyUsedPercent,
      weeklyRemainingPercent,
      quotaWindowMinutes: primary?.windowMinutes ?? 300,
      budgetTokens: 100,
      usedTokens: quotaUsedPercent ?? 0,
      localTotalTokens: localUsedTokens,
      burnRatePerHour: 0,
      quotaResetAt: primary?.resetsAt?.toISOString() || nextMidnight().toISOString(),
      weeklyBudgetTokens: 100,
      weeklyUsedTokens: weeklyUsedPercent ?? 0,
      weeklyResetAt: secondary?.resetsAt?.toISOString() || nextWeekStart().toISOString()
    });
  }

  return normalizeUsage({
    ...basePayload,
    source: `codex-local · quota unavailable · ${trimTitle(thread.title)}`,
    quotaMode: "quota-unavailable",
    budgetTokens: 100,
    usedTokens: 0,
    localTotalTokens: localUsedTokens,
    burnRatePerHour: 0,
    quotaResetAt: nextMidnight().toISOString(),
    weeklyBudgetTokens: 100,
    weeklyUsedTokens: 0,
    weeklyResetAt: nextWeekStart().toISOString()
  });
}

async function readLatestCodexRateLimit(sessionsRoot) {
  try {
    await assertReadable(sessionsRoot);
    const files = await listJsonlFiles(sessionsRoot);
    const recentFiles = files
      .sort((a, b) => b.mtimeMs - a.mtimeMs)
      .slice(0, 30);
    let best = null;

    for (const file of recentFiles) {
      const text = await fs.readFile(file.path, "utf8");
      const lines = text.split(/\n/);
      for (let index = lines.length - 1; index >= 0; index -= 1) {
        const line = lines[index];
        if (!line.includes("\"rate_limits\"")) {
          continue;
        }

        const event = safeJsonParse(line);
        const payload = event?.payload;
        if (payload?.type !== "token_count" || !payload.rate_limits) {
          continue;
        }

        const timestamp = Date.parse(event.timestamp);
        if (!Number.isFinite(timestamp)) {
          continue;
        }

        if (!best || timestamp > best.timestamp) {
          best = {
            timestamp,
            observedAt: new Date(timestamp),
            filePath: file.path,
            rateLimits: payload.rate_limits,
            usage: payload.info?.total_token_usage || null
          };
        }

        break;
      }
    }

    return best;
  } catch {
    return null;
  }
}

export async function buildCodexActivity24h(sessionsRoot, options = {}) {
  const now = options.now instanceof Date ? options.now : new Date(options.now || Date.now());
  const timezone = options.timezone || CODEX_ACTIVITY_TIMEZONE;
  const windowEnd = now;
  const windowStart = new Date(windowEnd.getTime() - 24 * 60 * 60 * 1000);
  const hourlyBuckets24h = buildLast24HourBuckets(windowEnd, timezone);
  const bucketByKey = new Map(hourlyBuckets24h.map((bucket) => [bucket.key, bucket]));
  let files = [];

  try {
    await assertReadable(sessionsRoot);
    files = await listJsonlFiles(sessionsRoot);
  } catch {
    return {
      scannedFiles: 0,
      scannedFilePaths: [],
      parsedEvents: 0,
      parsedSessions: 0,
      activeHours: 0,
      hourlyBuckets24h,
      timezone,
      windowStart: windowStart.toISOString(),
      windowEnd: windowEnd.toISOString(),
      latestEventAt: "",
      latestEventLocalTime: "--",
      activityMetric: "session events"
    };
  }

  let parsedEvents = 0;
  let tokenEvents = 0;
  let eventFallbacks = 0;
  let latestEventAt = null;
  const parsedSessionPaths = new Set();

  for (const file of files) {
    const text = await fs.readFile(file.path, "utf8");
    for (const line of text.split(/\n/)) {
      if (!line.trim()) {
        continue;
      }

      const event = safeJsonParse(line);
      const timestamp = Date.parse(event?.timestamp);
      if (!Number.isFinite(timestamp) || timestamp < windowStart.getTime() || timestamp > windowEnd.getTime()) {
        continue;
      }

      const payload = event?.payload;
      if (!payload || typeof payload !== "object") {
        continue;
      }

      const activity = extractActivityValue(payload);
      if (activity.totalTokens <= 0) {
        continue;
      }

      const eventDate = new Date(timestamp);
      const key = localDateHourKey(eventDate, timezone);
      const bucket = bucketByKey.get(key);
      if (!bucket) {
        continue;
      }

      parsedEvents += 1;
      parsedSessionPaths.add(file.path);
      bucket.usedTokens += activity.totalTokens;
      bucket.inputTokens += activity.inputTokens;
      bucket.outputTokens += activity.outputTokens;
      bucket.events += 1;

      if (payload.info?.last_token_usage || payload.info?.total_token_usage) {
        tokenEvents += 1;
      } else {
        eventFallbacks += 1;
      }

      if (!latestEventAt || timestamp > latestEventAt.getTime()) {
        latestEventAt = eventDate;
      }
    }
  }

  const activeHours = hourlyBuckets24h.filter((bucket) => bucket.usedTokens > 0 || bucket.events > 0).length;

  return {
    scannedFiles: files.length,
    scannedFilePaths: files.map((file) => file.path),
    parsedEvents,
    parsedSessions: parsedSessionPaths.size,
    activeHours,
    hourlyBuckets24h,
    timezone,
    windowStart: windowStart.toISOString(),
    windowEnd: windowEnd.toISOString(),
    latestEventAt: latestEventAt?.toISOString() || "",
    latestEventLocalTime: latestEventAt ? formatLocalTime(latestEventAt, timezone) : "--",
    activityMetric: activityMetricLabel(tokenEvents, eventFallbacks),
    tokenEvents,
    eventFallbacks
  };
}

function activityMetricLabel(tokenEvents, eventFallbacks) {
  if (tokenEvents > 0 && eventFallbacks > 0) {
    return "parsed tokens + session events";
  }

  if (tokenEvents > 0) {
    return "parsed tokens";
  }

  return "session events";
}

function buildLast24HourBuckets(now, timezone) {
  const buckets = [];

  for (let offset = 23; offset >= 0; offset -= 1) {
    const date = new Date(now.getTime() - offset * 60 * 60 * 1000);
    buckets.push({
      key: localDateHourKey(date, timezone),
      label: localHourLabel(date, timezone),
      usedTokens: 0,
      inputTokens: 0,
      outputTokens: 0,
      events: 0
    });
  }

  return buckets;
}

function extractActivityValue(payload) {
  const lastUsage = payload.info?.last_token_usage;
  const totalUsage = payload.info?.total_token_usage;
  const lastTokens = tokenUsageDetails(lastUsage);
  if (lastTokens.totalTokens > 0) {
    return lastTokens;
  }

  const totalTokens = tokenUsageDetails(totalUsage);
  if (totalTokens.totalTokens > 0) {
    return totalTokens;
  }

  return {
    totalTokens: 1,
    inputTokens: 0,
    outputTokens: 0
  };
}

function tokenUsageDetails(usage) {
  if (!usage || typeof usage !== "object") {
    return {
      totalTokens: 0,
      inputTokens: 0,
      outputTokens: 0
    };
  }

  const inputTokens = positiveInteger(usage.input_tokens, 0);
  const outputTokens = positiveInteger(usage.output_tokens, 0);
  const explicitTotal = positiveInteger(usage.total_tokens, 0);
  if (explicitTotal > 0) {
    return {
      totalTokens: explicitTotal,
      inputTokens,
      outputTokens
    };
  }

  return {
    totalTokens: inputTokens + outputTokens + positiveInteger(usage.reasoning_output_tokens, 0),
    inputTokens,
    outputTokens
  };
}

function compressHistoryForDisplay(hourlyBuckets24h) {
  const displayLabels = new Set(["00", "03", "06", "09", "12", "15", "18", "21"]);
  const selected = hourlyBuckets24h.filter((bucket) => displayLabels.has(bucket.label));
  const source = selected.length > 0 ? selected : hourlyBuckets24h;

  return source.map((bucket) => ({
    label: bucket.label,
    usedTokens: bucket.usedTokens,
    inputTokens: bucket.inputTokens,
    outputTokens: bucket.outputTokens,
    events: bucket.events
  }));
}

function localDateHourKey(date, timezone) {
  const parts = dateTimeParts(date, timezone);
  return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}`;
}

function localHourLabel(date, timezone) {
  return dateTimeParts(date, timezone).hour;
}

function formatLocalTime(date, timezone) {
  const parts = dateTimeParts(date, timezone);
  return `${parts.hour}:${parts.minute}`;
}

function dateTimeParts(date, timezone) {
  const formatter = new Intl.DateTimeFormat("en-GB", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false
  });
  const parts = Object.fromEntries(formatter.formatToParts(date).map((part) => [part.type, part.value]));
  return {
    year: parts.year,
    month: parts.month,
    day: parts.day,
    hour: parts.hour === "24" ? "00" : parts.hour,
    minute: parts.minute
  };
}

async function listJsonlFiles(root) {
  const entries = await fs.readdir(root, { withFileTypes: true });
  const files = [];

  for (const entry of entries) {
    const entryPath = path.join(root, entry.name);
    if (entry.isDirectory()) {
      files.push(...await listJsonlFiles(entryPath));
      continue;
    }

    if (!entry.name.endsWith(".jsonl")) {
      continue;
    }

    const stat = await fs.stat(entryPath);
    files.push({ path: entryPath, mtimeMs: stat.mtimeMs });
  }

  return files;
}

function normalizeLimitWindow(limit) {
  if (!limit || typeof limit !== "object") {
    return null;
  }

  const usedPercent = Number(limit.used_percent);
  const resetSeconds = Number(limit.resets_at);
  return {
    usedPercent: Number.isFinite(usedPercent) ? Math.min(Math.max(usedPercent, 0), 100) : null,
    windowMinutes: positiveInteger(limit.window_minutes, 0),
    resetsAt: Number.isFinite(resetSeconds) ? new Date(resetSeconds * 1000) : null
  };
}

function safeJsonParse(line) {
  try {
    return JSON.parse(line);
  } catch {
    return null;
  }
}

async function selectThread(config) {
  const where = config.threadId
    ? `id = ${sqlString(config.threadId)}`
    : `cwd = ${sqlString(config.cwd)}`;
  const rows = await sqliteJson(
    config.stateDb,
    `select id,title,cwd,tokens_used,created_at,updated_at,model
     from threads
     where ${where}
     order by updated_at desc
     limit 1`
  );

  if (!rows[0]) {
    throw new Error(`No Codex thread found for ${config.threadId || config.cwd}.`);
  }

  return rows[0];
}

async function selectGoal(goalsDb, threadId) {
  try {
    await assertReadable(goalsDb);
    const rows = await sqliteJson(
      goalsDb,
      `select token_budget,tokens_used,status
       from thread_goals
       where thread_id = ${sqlString(threadId)}
       limit 1`
    );
    return rows[0] || null;
  } catch {
    return null;
  }
}

async function selectRecentThreads(config) {
  const thirtyDaysAgo = Math.floor(Date.now() / 1000) - 30 * 24 * 60 * 60;
  return sqliteJson(
    config.stateDb,
    `select id,title,tokens_used,created_at,updated_at,model
     from threads
     where cwd = ${sqlString(config.cwd)}
       and updated_at >= ${thirtyDaysAgo}
     order by updated_at asc
     limit 200`
  );
}

async function sqliteJson(dbPath, sql) {
  const { stdout } = await execFileAsync("sqlite3", ["-json", dbPath, sql], {
    maxBuffer: 2 * 1024 * 1024
  });
  const text = stdout.trim();
  return text ? JSON.parse(text) : [];
}

async function assertReadable(filePath) {
  await fs.access(filePath);
}

function buildHourlyHistory(threads, now) {
  const labels = ["00", "03", "06", "09", "12", "15", "18", "21"];
  const buckets = new Map(labels.map((label) => [label, 0]));
  const today = new Date(now);
  today.setHours(0, 0, 0, 0);

  for (const thread of threads) {
    const updatedAt = secondsToDate(thread.updated_at);
    if (updatedAt < today) {
      continue;
    }

    const bucketHour = Math.floor(updatedAt.getHours() / 3) * 3;
    const label = String(bucketHour).padStart(2, "0");
    buckets.set(label, (buckets.get(label) || 0) + positiveInteger(thread.tokens_used, 0));
  }

  return labels.map((label) => ({
    label,
    usedTokens: buckets.get(label) || 0
  }));
}

function estimateAgentAverage(threads) {
  if (threads.length <= 1) {
    return 1;
  }

  const activeDayCount = new Set(
    threads.map((thread) => secondsToDate(thread.updated_at).toISOString().slice(0, 10))
  ).size || 1;
  return Math.max(1, Number((threads.length / activeDayCount).toFixed(1)));
}

function calculateWeeklyUsedTokens(threads, now) {
  const weekStart = startOfWeek(now);
  return threads.reduce((total, thread) => {
    const updatedAt = secondsToDate(thread.updated_at);
    if (updatedAt < weekStart) {
      return total;
    }

    return total + positiveInteger(thread.tokens_used, 0);
  }, 0);
}

function startOfWeek(now) {
  const date = new Date(now);
  const day = date.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  date.setDate(date.getDate() + diff);
  date.setHours(0, 0, 0, 0);
  return date;
}

function secondsToDate(value) {
  return new Date(positiveInteger(value, Math.floor(Date.now() / 1000)) * 1000);
}

function trimTitle(title) {
  if (typeof title !== "string" || title.trim() === "") {
    return "untitled";
  }

  return title.trim().replace(/\s+/g, " ").slice(0, 42);
}

function sqlString(value) {
  return `'${String(value).replaceAll("'", "''")}'`;
}

function positiveInteger(value, fallback) {
  const number = Number(value);
  if (!Number.isFinite(number) || number < 0) {
    return fallback;
  }

  return Math.round(number);
}
