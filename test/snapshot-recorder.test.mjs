import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { createSnapshotRecorder } from "../lib/snapshot-recorder.js";

describe("createSnapshotRecorder", () => {
  it("writes one JSONL snapshot and skips duplicate source events", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "tokensflow-snapshots-"));
    const filePath = path.join(root, "snapshots.jsonl");
    const usageSource = {
      async read() {
        return {
          source: "codex-rate-limits · plus",
          quotaMode: "codex-rate-limit",
          sourceObservedAt: "2026-06-07T13:00:00.000Z",
          quotaRemainingPercent: 96,
          quotaUsedPercent: 4,
          weeklyRemainingPercent: 75,
          weeklyUsedPercent: 25,
          quotaResetAt: "2026-06-07T17:41:49.000Z",
          weeklyResetAt: "2026-06-12T19:35:38.000Z",
          localTotalTokens: 1234,
          debug: {
            activeHours: 4,
            parsedEvents: 10,
            parsedSessions: 2,
            latestEventAt: "2026-06-07T13:00:00.000Z",
            activityMetric: "parsed tokens"
          }
        };
      }
    };

    const recorder = createSnapshotRecorder(usageSource, {
      enabled: true,
      filePath,
      intervalMs: 1000
    });

    const first = await recorder.recordOnce();
    const second = await recorder.recordOnce();
    const lines = (await fs.readFile(filePath, "utf8")).trim().split(/\n/);

    assert.ok(first);
    assert.equal(second, null);
    assert.equal(lines.length, 1);
    assert.equal(JSON.parse(lines[0]).quotaRemainingPercent, 96);
  });
});
