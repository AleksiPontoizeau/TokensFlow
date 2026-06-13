import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { createTokensFlowServer, listenOnAvailablePort } from "../server.mjs";

describe("server local history API", () => {
  it("returns an empty state for a missing local history file", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "tokensflow-server-snapshots-"));
    const server = createTokensFlowServer({
      runtimeConfig: runtimeConfig(path.join(root, "missing.jsonl"))
    });
    const url = await listen(server);

    try {
      const response = await fetch(`${url}/api/history`);
      const body = await response.json();

      assert.equal(response.status, 200);
      assert.equal(body.status, "empty");
      assert.equal(body.snapshots.length, 0);
      assert.equal(body.hourlyBuckets24h.length, 24);
    } finally {
      await close(server);
    }
  });

  it("keeps /api/snapshots as a compatibility alias", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "tokensflow-server-history-alias-"));
    const configuredFile = path.join(root, "configured.jsonl");
    const savedAt = new Date().toISOString();
    await fs.writeFile(configuredFile, `${JSON.stringify(snapshot(savedAt, 77))}\n`);
    const server = createTokensFlowServer({
      runtimeConfig: runtimeConfig(configuredFile)
    });
    const url = await listen(server);

    try {
      const response = await fetch(`${url}/api/snapshots`);
      const body = await response.json();

      assert.equal(response.status, 200);
      assert.equal(body.summary.quotaLatest, 77);
    } finally {
      await close(server);
    }
  });

  it("does not read arbitrary history paths from HTTP query params", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "tokensflow-server-fixed-path-"));
    const configuredFile = path.join(root, "configured.jsonl");
    const otherFile = path.join(root, "other.jsonl");
    const savedAt = new Date().toISOString();
    await fs.writeFile(configuredFile, `${JSON.stringify(snapshot(savedAt, 88))}\n`);
    await fs.writeFile(otherFile, `${JSON.stringify(snapshot(savedAt, 12))}\n`);
    const server = createTokensFlowServer({
      runtimeConfig: runtimeConfig(configuredFile)
    });
    const url = await listen(server);

    try {
      const response = await fetch(`${url}/api/history?file=${encodeURIComponent(otherFile)}`);
      const body = await response.json();

      assert.equal(response.status, 200);
      assert.equal(body.summary.quotaLatest, 88);
    } finally {
      await close(server);
    }
  });
});

describe("listenOnAvailablePort", () => {
  it("falls back to the next port when the requested port is busy", async () => {
    const occupied = http.createServer((_request, response) => response.end("busy"));
    await listenOnAvailablePort(occupied, { port: 0, allowFallback: false });
    const requestedPort = occupied.address().port;
    const server = http.createServer((_request, response) => response.end("ok"));

    try {
      const selectedPort = await listenOnAvailablePort(server, {
        port: requestedPort,
        maxPort: requestedPort + 1
      });

      assert.equal(selectedPort, requestedPort + 1);
    } finally {
      await close(server);
      await close(occupied);
    }
  });
});

function runtimeConfig(snapshotFile) {
  return {
    source: "json",
    dataFile: path.join(os.tmpdir(), "tokensflow-server-unused.json"),
    snapshot: {
      enabled: true,
      intervalMs: 300000,
      filePath: snapshotFile
    }
  };
}

function snapshot(savedAt, quotaRemainingPercent) {
  return {
    savedAt,
    quotaMode: "codex-rate-limit",
    sourceObservedAt: savedAt,
    quotaRemainingPercent,
    quotaUsedPercent: 100 - quotaRemainingPercent,
    weeklyRemainingPercent: 60,
    weeklyUsedPercent: 40
  };
}

function listen(server) {
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      resolve(`http://127.0.0.1:${address.port}`);
    });
  });
}

function close(server) {
  return new Promise((resolve) => {
    if (!server.listening) {
      resolve();
      return;
    }

    server.close(resolve);
  });
}
