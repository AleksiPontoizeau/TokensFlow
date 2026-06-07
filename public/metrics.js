export function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

export function calculateTokenMetrics(usage) {
  const budgetTokens = Math.max(Number(usage.budgetTokens) || 0, 0);
  const usedTokens = Math.max(Number(usage.usedTokens) || 0, 0);
  const remainingTokens = Math.max(budgetTokens - usedTokens, 0);
  const remainingPercent = budgetTokens === 0 ? 0 : (remainingTokens / budgetTokens) * 100;
  const usedPercent = budgetTokens === 0 ? 0 : clamp((usedTokens / budgetTokens) * 100, 0, 100);
  const burnRatePerHour = Math.max(Number(usage.burnRatePerHour) || 0, 0);
  const hoursLeft = burnRatePerHour === 0 ? Infinity : remainingTokens / burnRatePerHour;

  return {
    budgetTokens,
    usedTokens,
    remainingTokens,
    remainingPercent,
    usedPercent,
    burnRatePerHour,
    hoursLeft,
    status: getFlowStatus(remainingPercent)
  };
}

export function getFlowStatus(remainingPercent) {
  if (remainingPercent >= 65) {
    return "quota healthy";
  }

  if (remainingPercent >= 30) {
    return "watch quota";
  }

  return "low quota";
}

export function formatCompactNumber(value) {
  const number = Number(value) || 0;

  if (Math.abs(number) >= 1_000_000) {
    return `${trimNumber(number / 1_000_000)}M`;
  }

  if (Math.abs(number) >= 1_000) {
    return `${trimNumber(number / 1_000)}K`;
  }

  return String(Math.round(number));
}

export function formatHours(value) {
  if (!Number.isFinite(value)) {
    return "∞";
  }

  if (value >= 24) {
    return `${trimNumber(value / 24)}d`;
  }

  return `${trimNumber(value)}h`;
}

function trimNumber(value) {
  return Number.isInteger(value) ? String(value) : value.toFixed(1);
}
