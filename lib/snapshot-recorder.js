import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";

export const SNAPSHOT_INTERVAL_MS = 5 * 60 * 1000;

export function snapshotRecorderDefaults() {
  return {
    enabled: (process.env.TOKENSFLOW_HISTORY || process.env.TOKENSFLOW_SNAPSHOTS) !== "0",
    intervalMs: Number(
      process.env.TOKENSFLOW_HISTORY_INTERVAL_MS
        || process.env.TOKENSFLOW_SNAPSHOT_INTERVAL_MS
        || SNAPSHOT_INTERVAL_MS
    ),
    filePath: process.env.TOKENSFLOW_HISTORY_FILE
      || process.env.TOKENSFLOW_SNAPSHOT_FILE
      || path.join(os.homedir(), ".tokensflow", "snapshots.jsonl")
  };
}

export function createSnapshotRecorder(usageSource, options = {}) {
  const config = {
    ...snapshotRecorderDefaults(),
    ...options
  };
  let timer = null;
  let lastSnapshotKey = "";

  async function recordOnce() {
    if (!config.enabled) {
      return null;
    }

    const usage = await usageSource.read();
    const snapshotKey = `${usage.quotaMode || ""}:${usage.sourceObservedAt || usage.observedAt || ""}`;
    if (snapshotKey === lastSnapshotKey) {
      return null;
    }

    lastSnapshotKey = snapshotKey;
    const snapshot = buildSnapshot(usage);
    await fs.mkdir(path.dirname(config.filePath), { recursive: true });
    await fs.appendFile(config.filePath, `${JSON.stringify(snapshot)}\n`, "utf8");
    return snapshot;
  }

  function start() {
    if (!config.enabled || timer) {
      return;
    }

    recordOnce().catch((error) => {
      console.warn(`TokensFlow history point skipped: ${error.message}`);
    });
    timer = setInterval(() => {
      recordOnce().catch((error) => {
        console.warn(`TokensFlow history point skipped: ${error.message}`);
      });
    }, config.intervalMs);
    timer.unref?.();
  }

  function stop() {
    if (!timer) {
      return;
    }

    clearInterval(timer);
    timer = null;
  }

  return {
    filePath: config.filePath,
    intervalMs: config.intervalMs,
    recordOnce,
    start,
    stop
  };
}

export function buildSnapshot(usage) {
  return {
    savedAt: new Date().toISOString(),
    source: usage.source || "local",
    quotaMode: usage.quotaMode || "",
    sourceObservedAt: usage.sourceObservedAt || usage.observedAt || "",
    quotaRemainingPercent: usage.quotaRemainingPercent ?? null,
    quotaUsedPercent: usage.quotaUsedPercent ?? null,
    weeklyRemainingPercent: usage.weeklyRemainingPercent ?? null,
    weeklyUsedPercent: usage.weeklyUsedPercent ?? null,
    quotaResetAt: usage.quotaResetAt || "",
    weeklyResetAt: usage.weeklyResetAt || "",
    localTotalTokens: usage.localTotalTokens || 0,
    activity: {
      activeHours: usage.debug?.activeHours || 0,
      parsedEvents: usage.debug?.parsedEvents || 0,
      parsedSessions: usage.debug?.parsedSessions || 0,
      latestEventAt: usage.debug?.latestEventAt || "",
      activityMetric: usage.debug?.activityMetric || ""
    }
  };
}
