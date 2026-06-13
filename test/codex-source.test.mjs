import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { buildCodexActivity24h, readCodexUsage } from "../lib/codex-source.js";
import { createUsageSource } from "../lib/usage-source.js";

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
    assert.equal(Number(activity.todayCostUsd.toFixed(5)), 0.01188);
    assert.equal(Number(activity.last24hCostUsd.toFixed(5)), 0.01188);
    assert.ok(three?.usedTokens > 0);
    assert.ok(fifteen?.usedTokens > 0);
  });

  it("estimates cost from total tokens when input/output split is unavailable", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "tokensflow-codex-cost-fallback-"));
    const sessionDir = path.join(root, "2026", "06", "07");
    await fs.mkdir(sessionDir, { recursive: true });

    await fs.writeFile(
      path.join(sessionDir, "rollout-total-only.jsonl"),
      `${JSON.stringify(totalOnlyTokenCountEvent("2026-06-07T10:00:00.000Z", 1000))}\n`
    );

    const activity = await buildCodexActivity24h(root, {
      now: new Date("2026-06-07T14:00:00.000Z"),
      timezone: "Europe/Paris"
    });

    assert.equal(activity.parsedEvents, 1);
    assert.equal(Number(activity.todayCostUsd.toFixed(4)), 0.0042);
    assert.equal(Number(activity.last24hCostUsd.toFixed(4)), 0.0042);
  });
});

describe("readCodexUsage", () => {
  it("uses global Codex rate_limits even when no project thread exists", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "tokensflow-codex-rate-limits-"));
    const sessionDir = path.join(root, "2026", "06", "07");
    await fs.mkdir(sessionDir, { recursive: true });

    await fs.writeFile(
      path.join(sessionDir, "rollout-rate-limit.jsonl"),
      `${JSON.stringify(rateLimitEvent("2026-06-07T13:00:00.000Z"))}\n`
    );

    const usage = await readCodexUsage({
      cwd: "/tmp/no-codex-thread-here",
      stateDb: path.join(root, "missing-state.sqlite"),
      goalsDb: path.join(root, "missing-goals.sqlite"),
      sessionsRoot: root,
      now: new Date("2026-06-07T14:00:00.000Z")
    });

    assert.equal(usage.quotaMode, "codex-rate-limit");
    assert.equal(usage.source, "codex local file · plus");
    assert.equal(usage.quotaUsedPercent, 70);
    assert.equal(usage.quotaRemainingPercent, 30);
    assert.equal(usage.weeklyUsedPercent, 35);
    assert.equal(usage.weeklyRemainingPercent, 65);
    assert.equal(usage.localTotalTokens, 123456);
    assert.equal(Number(usage.todayCostUsd.toFixed(5)), 0.65184);
    assert.equal(Number(usage.last24hCostUsd.toFixed(5)), 0.65184);
    assert.match(usage.debug.latestRateLimitFile, /rollout-rate-limit\.jsonl$/);
  });
});

describe("createUsageSource", () => {
  it("does not return demo fallback for explicit Codex mode", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "tokensflow-explicit-codex-"));
    const usageSource = createUsageSource({
      source: "codex",
      codex: {
        cwd: root,
        stateDb: path.join(root, "missing-state.sqlite"),
        goalsDb: path.join(root, "missing-goals.sqlite"),
        sessionsRoot: path.join(root, "missing-sessions")
      }
    });

    const usage = await usageSource.read();

    assert.equal(usage.quotaMode, "quota-unavailable");
    assert.notEqual(usage.source, "demo-fallback");
    assert.match(usage.source, /codex-local/);
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

function totalOnlyTokenCountEvent(timestamp, totalTokens) {
  return {
    timestamp,
    type: "event_msg",
    payload: {
      type: "token_count",
      info: {
        last_token_usage: {
          total_tokens: totalTokens
        }
      },
      rate_limits: null
    }
  };
}

function rateLimitEvent(timestamp) {
  return {
    timestamp,
    type: "event_msg",
    payload: {
      type: "token_count",
      info: {
        total_token_usage: {
          input_tokens: 100000,
          output_tokens: 23456,
          total_tokens: 123456
        }
      },
      rate_limits: {
        plan_type: "plus",
        primary: {
          used_percent: 70,
          window_minutes: 300,
          resets_at: 1780846860
        },
        secondary: {
          used_percent: 35,
          window_minutes: 10080,
          resets_at: 1781292938
        }
      }
    }
  };
}
