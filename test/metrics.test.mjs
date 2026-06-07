import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  calculateTokenMetrics,
  formatCompactNumber,
  formatHours,
  getFlowStatus
} from "../public/metrics.js";
import {
  assertUsagePayload,
  nextMidnight,
  nextWeekStart,
  normalizeUsage
} from "../lib/usage-schema.js";

describe("calculateTokenMetrics", () => {
  it("calculates remaining tokens and percentages", () => {
    const metrics = calculateTokenMetrics({
      budgetTokens: 1000,
      usedTokens: 350,
      burnRatePerHour: 50
    });

    assert.equal(metrics.remainingTokens, 650);
    assert.equal(metrics.remainingPercent, 65);
    assert.equal(metrics.usedPercent, 35);
    assert.equal(metrics.hoursLeft, 13);
  });

  it("clamps used tokens to the available budget", () => {
    const metrics = calculateTokenMetrics({
      budgetTokens: 1000,
      usedTokens: 2000,
      burnRatePerHour: 20
    });

    assert.equal(metrics.remainingTokens, 0);
    assert.equal(metrics.usedTokens, 2000);
    assert.equal(metrics.usedPercent, 100);
  });
});

describe("format helpers", () => {
  it("formats compact token counts", () => {
    assert.equal(formatCompactNumber(999), "999");
    assert.equal(formatCompactNumber(1200), "1.2K");
    assert.equal(formatCompactNumber(2_000_000), "2M");
  });

  it("formats runway hours", () => {
    assert.equal(formatHours(12), "12h");
    assert.equal(formatHours(48), "2d");
    assert.equal(formatHours(Infinity), "∞");
  });

  it("labels flow status by remaining percentage", () => {
    assert.equal(getFlowStatus(80), "quota healthy");
    assert.equal(getFlowStatus(45), "watch quota");
    assert.equal(getFlowStatus(12), "low quota");
  });
});

describe("usage schema", () => {
  it("normalizes partial payloads into the UI contract", () => {
    const usage = normalizeUsage(
      {
        source: "codex-local",
        budgetTokens: "2000000",
        usedTokens: "1466080"
      },
      new Date("2026-06-06T12:34:00.000Z")
    );

    assert.equal(usage.source, "codex-local");
    assert.equal(usage.budgetTokens, 2_000_000);
    assert.equal(usage.usedTokens, 1_466_080);
    assert.equal(usage.inputTokens, 1_026_256);
    assert.equal(usage.outputTokens, 439_824);
    assert.equal(usage.weeklyBudgetTokens, 10_000_000);
    assert.equal(usage.weeklyUsedTokens, 1_466_080);
    assert.equal(new Date(usage.resetAt).getHours(), 0);
    assert.equal(new Date(usage.resetAt).getMinutes(), 0);
  });

  it("rejects invalid ingested payloads", () => {
    assert.throws(() => assertUsagePayload({ usedTokens: 10 }), /budgetTokens/);
    assert.throws(() => assertUsagePayload({ budgetTokens: 10, usedTokens: -1 }), /usedTokens/);
  });

  it("calculates the next reset boundary", () => {
    const now = new Date("2026-06-06T12:34:00.000Z");
    const reset = nextMidnight(now);

    assert.ok(reset > now);
    assert.equal(reset.getHours(), 0);
    assert.equal(reset.getMinutes(), 0);
    assert.equal(reset.getSeconds(), 0);
  });

  it("calculates the next weekly reset boundary", () => {
    const reset = nextWeekStart(new Date("2026-06-03T12:34:00.000Z"));

    assert.equal(reset.getDay(), 1);
    assert.equal(reset.getHours(), 0);
    assert.equal(reset.getMinutes(), 0);
  });
});
