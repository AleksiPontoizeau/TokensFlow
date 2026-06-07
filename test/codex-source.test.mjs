import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { buildCodexActivity24h } from "../lib/codex-source.js";

describe("buildCodexActivity24h", () => {
  it("buckets Codex activity at 03:00 and 15:00 Europe/Paris", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "tokensflow-codex-logs-"));
    const sessionDir = path.join(root, "2026", "06", "07");
    await fs.mkdir(sessionDir, { recursive: true });

    await fs.writeFile(
      path.join(sessionDir, "rollout-0300.jsonl"),
      `${JSON.stringify(tokenCountEvent("2026-06-07T01:00:00.000Z", 300))}\n`
    );
    await fs.writeFile(
      path.join(sessionDir, "rollout-1500.jsonl"),
      `${JSON.stringify(tokenCountEvent("2026-06-07T13:00:00.000Z", 1500))}\n`
    );

    const activity = await buildCodexActivity24h(root, {
      now: new Date("2026-06-07T14:00:00.000Z"),
      timezone: "Europe/Paris"
    });

    const three = activity.hourlyBuckets24h.find((bucket) => bucket.label === "03");
    const fifteen = activity.hourlyBuckets24h.find((bucket) => bucket.label === "15");

    assert.equal(activity.timezone, "Europe/Paris");
    assert.equal(activity.scannedFiles, 2);
    assert.equal(activity.parsedEvents, 2);
    assert.equal(activity.parsedSessions, 2);
    assert.equal(activity.activityMetric, "parsed tokens");
    assert.ok(three?.usedTokens > 0);
    assert.ok(fifteen?.usedTokens > 0);
  });
});

function tokenCountEvent(timestamp, totalTokens) {
  return {
    timestamp,
    type: "event_msg",
    payload: {
      type: "token_count",
      info: {
        last_token_usage: {
          input_tokens: Math.round(totalTokens * 0.7),
          output_tokens: Math.round(totalTokens * 0.3),
          total_tokens: totalTokens
        }
      },
      rate_limits: null
    }
  };
}
