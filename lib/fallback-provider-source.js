import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { normalizeUsage } from "./usage-schema.js";

const providerLabels = {
  claude: "Claude Code",
  cursor: "Cursor"
};

export function providerDefaults(provider) {
  return {
    provider,
    usageFile: path.join(os.homedir(), ".tokensflow", `${provider}-usage.json`),
    budgetTokens: 2_000_000,
    weeklyBudgetTokens: 10_000_000
  };
}

export async function readProviderUsage(options = {}) {
  const defaults = providerDefaults(options.provider || "custom");
  const config = {
    ...defaults,
    ...Object.fromEntries(Object.entries(options).filter(([, value]) => value !== undefined && value !== ""))
  };

  try {
    const raw = await fs.readFile(config.usageFile, "utf8");
    const usage = normalizeUsage(JSON.parse(raw));
    return {
      ...usage,
      source: `${providerLabel(config.provider)} · ${usage.source}`
    };
  } catch {
    return normalizeUsage({
      source: `${providerLabel(config.provider)} · not connected`,
      budgetTokens: config.budgetTokens,
      usedTokens: 0,
      inputTokens: 0,
      outputTokens: 0,
      retailCostUsd: 0,
      burnRatePerHour: 0,
      quotaResetAt: new Date(Date.now() + 5 * 60 * 60 * 1000).toISOString(),
      weeklyBudgetTokens: config.weeklyBudgetTokens,
      weeklyUsedTokens: 0,
      sessions: 0,
      agentsAverage: 0,
      history: []
    });
  }
}

function providerLabel(provider) {
  return providerLabels[provider] || provider;
}
