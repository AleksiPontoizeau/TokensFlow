import { readCodexUsage } from "./codex-source.js";
import { readProviderUsage } from "./fallback-provider-source.js";
import { readJsonUsage, writeJsonUsage } from "./json-source.js";

export function createUsageSource(options) {
  const source = options.source || "auto";

  return {
    async read() {
      if (source === "json") {
        return readJsonUsage(options.dataFile);
      }

      if (source === "codex") {
        return readCodexUsage(options.codex);
      }

      if (source === "claude" || source === "cursor") {
        return readProviderUsage(options[source]);
      }

      try {
        return await readCodexUsage(options.codex);
      } catch (error) {
        const usage = await readJsonUsage(options.dataFile);
        return {
          ...usage,
          source: `${usage.source} · codex unavailable`
        };
      }
    },

    async write(usage) {
      await writeJsonUsage(options.dataFile, usage);
    }
  };
}
