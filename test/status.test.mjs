import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  formatQuotaNotification,
  formatSwiftBarStatus,
  shouldNotifyQuotaDrop,
  summarizeCodexUsage
} from "../lib/status.js";

describe("Codex status formatting", () => {
  it("formats SwiftBar output with quota, reset, and cost", () => {
    const summary = summarizeCodexUsage(mockUsage(), new Date("2026-06-07T10:00:00.000Z"));
    const output = formatSwiftBarStatus(summary);

    assert.equal(summary.percent, 88);
    assert.equal(summary.resetCountdown, "4h 38m");
    assert.match(output, /^88% \| color=#78dcff/);
    assert.match(output, /Codex quota: 88% left/);
    assert.match(output, /Cost: \$0.42 today · \$1.17 last 24h/);
  });

  it("formats the low quota notification body", () => {
    const usage = {
      ...mockUsage(),
      quotaRemainingPercent: 9
    };
    const summary = summarizeCodexUsage(usage, new Date("2026-06-07T10:00:00.000Z"));

    assert.equal(formatQuotaNotification(summary), "⚠️ Codex quota: 9% left — resets in 4h 38m");
  });

  it("notifies once below 20 and once again below 10, then resets after recovery", () => {
    const state = { below20: false, below10: false };

    assert.equal(shouldNotifyQuotaDrop(state, 25), false);
    assert.equal(shouldNotifyQuotaDrop(state, 19), true);
    assert.equal(shouldNotifyQuotaDrop(state, 18), false);
    assert.equal(shouldNotifyQuotaDrop(state, 9), true);
    assert.equal(shouldNotifyQuotaDrop(state, 8), false);
    assert.equal(shouldNotifyQuotaDrop(state, 22), false);
    assert.equal(shouldNotifyQuotaDrop(state, 19), true);
  });
});

function mockUsage() {
  return {
    source: "codex local file · plus",
    quotaMode: "codex-rate-limit",
    quotaRemainingPercent: 88,
    weeklyRemainingPercent: 65,
    quotaResetAt: "2026-06-07T14:38:00.000Z",
    sourceObservedAt: "2026-06-07T09:58:00.000Z",
    todayCostUsd: 0.42,
    last24hCostUsd: 1.17
  };
}
