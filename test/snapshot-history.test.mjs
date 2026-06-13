import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { readSnapshotHistory } from "../lib/snapshot-history.js";

describe("readSnapshotHistory", () => {
  it("returns an empty timeline when the snapshot file is missing", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "tokensflow-history-missing-"));
    const history = await readSnapshotHistory({
      filePath: path.join(root, "missing.jsonl"),
      now: new Date("2026-06-08T12:00:00.000Z")
    });

    assert.equal(history.status, "empty");
    assert.equal(history.snapshots.length, 0);
    assert.equal(history.hourlyBuckets24h.length, 24);
    assert.equal(history.debug.malformedLines, 0);
  });

  it("skips malformed JSONL lines and aggregates 5h plus weekly quota buckets", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "tokensflow-history-"));
    const filePath = path.join(root, "snapshots.jsonl");
    await fs.writeFile(
      filePath,
      [
        JSON.stringify(snapshot("2026-06-08T10:10:00.000Z", 80, 70)),
        "{broken json",
        JSON.stringify(snapshot("2026-06-08T10:50:00.000Z", 75, 69)),
        JSON.stringify(snapshot("2026-06-06T10:00:00.000Z", 90, 90)),
        ""
      ].join("\n")
    );

    const history = await readSnapshotHistory({
      filePath,
      now: new Date("2026-06-08T12:00:00.000Z")
    });
    const activeBucket = history.hourlyBuckets24h.find((bucket) => bucket.count === 2);

    assert.equal(history.status, "ready");
    assert.equal(history.summary.count, 2);
    assert.equal(history.summary.quotaLatest, 75);
    assert.equal(history.summary.weeklyLatest, 69);
    assert.equal(history.debug.malformedLines, 1);
    assert.equal(history.debug.oldLines, 1);
    assert.equal(activeBucket?.quotaRemainingPercent, 75);
    assert.equal(activeBucket?.weeklyRemainingPercent, 69);
  });
});

function snapshot(savedAt, quotaRemainingPercent, weeklyRemainingPercent) {
  return {
    savedAt,
    source: "codex local file · plus",
    quotaMode: "codex-rate-limit",
    sourceObservedAt: savedAt,
    quotaRemainingPercent,
    quotaUsedPercent: 100 - quotaRemainingPercent,
    weeklyRemainingPercent,
    weeklyUsedPercent: 100 - weeklyRemainingPercent,
    quotaResetAt: "2026-06-08T17:41:49.000Z",
    weeklyResetAt: "2026-06-12T19:35:38.000Z",
    localTotalTokens: 1000,
    activity: {
      activeHours: 2,
      parsedEvents: 10,
      parsedSessions: 1,
      latestEventAt: savedAt,
      activityMetric: "parsed tokens"
    }
  };
}
