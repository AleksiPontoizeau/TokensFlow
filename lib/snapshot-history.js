import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";

const DEFAULT_WINDOW_HOURS = 24;

export function snapshotHistoryDefaults() {
  return {
    filePath: process.env.TOKENSFLOW_SNAPSHOT_FILE
      || path.join(os.homedir(), ".tokensflow", "snapshots.jsonl"),
    windowHours: DEFAULT_WINDOW_HOURS
  };
}

export async function readSnapshotHistory(options = {}) {
  const config = {
    ...snapshotHistoryDefaults(),
    ...options
  };
  const windowHours = positiveInteger(config.windowHours, DEFAULT_WINDOW_HOURS);
  const now = config.now instanceof Date ? config.now : new Date(config.now || Date.now());
  const windowStart = new Date(now.getTime() - windowHours * 60 * 60 * 1000);
  const result = emptyHistory(config.filePath, windowHours, windowStart, now);

  let text = "";
  try {
    text = await fs.readFile(config.filePath, "utf8");
  } catch (error) {
    if (error?.code === "ENOENT") {
      return {
        ...result,
        status: "empty",
        message: "No local snapshots recorded yet."
      };
    }

    return {
      ...result,
      status: "error",
      message: `Cannot read local snapshots: ${error?.code || "read error"}.`
    };
  }

  const snapshots = [];
  let malformedLines = 0;
  let oldLines = 0;

  for (const line of text.split(/\n/)) {
    if (!line.trim()) {
      continue;
    }

    const parsed = safeJsonParse(line);
    if (!parsed) {
      malformedLines += 1;
      continue;
    }

    const snapshot = normalizeSnapshot(parsed);
    if (!snapshot) {
      malformedLines += 1;
      continue;
    }

    if (snapshot.savedAtDate < windowStart || snapshot.savedAtDate > now) {
      oldLines += 1;
      continue;
    }

    snapshots.push(snapshot);
  }

  snapshots.sort((a, b) => a.savedAtDate - b.savedAtDate);

  return {
    ...result,
    status: snapshots.length > 0 ? "ready" : "empty",
    message: snapshots.length > 0 ? "Local snapshot history loaded." : "No snapshots in the last 24h.",
    snapshots: snapshots.map(stripRuntimeDates),
    hourlyBuckets24h: buildHourlyBuckets(snapshots, windowStart, now),
    summary: summarizeSnapshots(snapshots),
    debug: {
      ...result.debug,
      malformedLines,
      oldLines,
      parsedSnapshots: snapshots.length
    }
  };
}

export function summarizeSnapshots(snapshots) {
  if (!Array.isArray(snapshots) || snapshots.length === 0) {
    return {
      count: 0,
      firstSavedAt: "",
      latestSavedAt: "",
      quotaMin: null,
      quotaMax: null,
      quotaLatest: null,
      weeklyMin: null,
      weeklyMax: null,
      weeklyLatest: null
    };
  }

  const quotaValues = snapshots
    .map((snapshot) => snapshot.quotaRemainingPercent)
    .filter(Number.isFinite);
  const weeklyValues = snapshots
    .map((snapshot) => snapshot.weeklyRemainingPercent)
    .filter(Number.isFinite);
  const latest = snapshots[snapshots.length - 1];

  return {
    count: snapshots.length,
    firstSavedAt: snapshots[0].savedAt,
    latestSavedAt: latest.savedAt,
    quotaMin: minOrNull(quotaValues),
    quotaMax: maxOrNull(quotaValues),
    quotaLatest: finiteOrNull(latest.quotaRemainingPercent),
    weeklyMin: minOrNull(weeklyValues),
    weeklyMax: maxOrNull(weeklyValues),
    weeklyLatest: finiteOrNull(latest.weeklyRemainingPercent)
  };
}

function emptyHistory(filePath, windowHours, windowStart, now) {
  return {
    status: "empty",
    message: "",
    windowHours,
    windowStart: windowStart.toISOString(),
    windowEnd: now.toISOString(),
    snapshots: [],
    hourlyBuckets24h: buildHourlyBuckets([], windowStart, now),
    summary: summarizeSnapshots([]),
    debug: {
      filePath,
      malformedLines: 0,
      oldLines: 0,
      parsedSnapshots: 0
    }
  };
}

export function buildHourlyBuckets(snapshots, windowStart, windowEnd) {
  const buckets = [];

  for (let index = 0; index < 24; index += 1) {
    const bucketStart = new Date(windowStart.getTime() + index * 60 * 60 * 1000);
    const bucketEnd = new Date(bucketStart.getTime() + 60 * 60 * 1000);
    buckets.push({
      label: String(bucketStart.getHours()).padStart(2, "0"),
      start: bucketStart.toISOString(),
      end: bucketEnd > windowEnd ? windowEnd.toISOString() : bucketEnd.toISOString(),
      quotaRemainingPercent: null,
      weeklyRemainingPercent: null,
      count: 0
    });
  }

  for (const snapshot of snapshots) {
    const index = Math.floor((snapshot.savedAtDate.getTime() - windowStart.getTime()) / (60 * 60 * 1000));
    const bucket = buckets[index];
    if (!bucket) {
      continue;
    }

    bucket.count += 1;
    if (Number.isFinite(snapshot.quotaRemainingPercent)) {
      bucket.quotaRemainingPercent = snapshot.quotaRemainingPercent;
    }

    if (Number.isFinite(snapshot.weeklyRemainingPercent)) {
      bucket.weeklyRemainingPercent = snapshot.weeklyRemainingPercent;
    }
  }

  return buckets;
}

function normalizeSnapshot(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }

  const savedAtDate = validDate(value.savedAt);
  if (!savedAtDate) {
    return null;
  }

  return {
    savedAt: savedAtDate.toISOString(),
    savedAtDate,
    source: stringValue(value.source, "local"),
    quotaMode: stringValue(value.quotaMode, ""),
    sourceObservedAt: validDate(value.sourceObservedAt)?.toISOString() || "",
    quotaRemainingPercent: optionalPercent(value.quotaRemainingPercent),
    quotaUsedPercent: optionalPercent(value.quotaUsedPercent),
    weeklyRemainingPercent: optionalPercent(value.weeklyRemainingPercent),
    weeklyUsedPercent: optionalPercent(value.weeklyUsedPercent),
    quotaResetAt: validDate(value.quotaResetAt)?.toISOString() || "",
    weeklyResetAt: validDate(value.weeklyResetAt)?.toISOString() || "",
    localTotalTokens: positiveInteger(value.localTotalTokens, 0),
    activity: normalizeActivity(value.activity)
  };
}

function normalizeActivity(activity) {
  if (!activity || typeof activity !== "object" || Array.isArray(activity)) {
    return {
      activeHours: 0,
      parsedEvents: 0,
      parsedSessions: 0,
      latestEventAt: "",
      activityMetric: ""
    };
  }

  return {
    activeHours: positiveInteger(activity.activeHours, 0),
    parsedEvents: positiveInteger(activity.parsedEvents, 0),
    parsedSessions: positiveInteger(activity.parsedSessions, 0),
    latestEventAt: validDate(activity.latestEventAt)?.toISOString() || "",
    activityMetric: stringValue(activity.activityMetric, "")
  };
}

function stripRuntimeDates(snapshot) {
  const { savedAtDate, ...publicSnapshot } = snapshot;
  return publicSnapshot;
}

function safeJsonParse(line) {
  try {
    return JSON.parse(line);
  } catch {
    return null;
  }
}

function validDate(value) {
  if (typeof value !== "string" || value.trim() === "") {
    return null;
  }

  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function optionalPercent(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) {
    return null;
  }

  return Math.min(Math.max(number, 0), 100);
}

function positiveInteger(value, fallback) {
  const number = Number(value);
  if (!Number.isFinite(number) || number < 0) {
    return fallback;
  }

  return Math.round(number);
}

function stringValue(value, fallback) {
  if (typeof value !== "string" || value.trim() === "") {
    return fallback;
  }

  return value.trim();
}

function finiteOrNull(value) {
  return Number.isFinite(value) ? value : null;
}

function minOrNull(values) {
  return values.length > 0 ? Math.min(...values) : null;
}

function maxOrNull(values) {
  return values.length > 0 ? Math.max(...values) : null;
}
