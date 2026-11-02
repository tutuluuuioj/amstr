import { describe, it } from "node:test";
import assert from "node:assert";
import http from "node:http";
import { ResilientRpcClient } from "./rpc.js";

describe("Phase 2 Requirement 6: Resilient RPC Failover and Rate Limit Handling", () => {
  it("strictly enforces at least two RPC endpoints upon initialization", () => {
    assert.throws(() => {
      new ResilientRpcClient({ endpoints: ["https://single-rpc.testnet.near.org"] });
    }, /ResilientRpcClient requires at least 2 distinct RPC endpoints/);
  });

  it("successfully rotates to backup endpoint on HTTP 429 rate limit", async () => {
    let server1Calls = 0;
    let server2Calls = 0;

    // Mock Server 1: Returns 429 Too Many Requests
    const server1 = http.createServer((req, res) => {
      server1Calls++;
      res.writeHead(429, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Rate limit exceeded" }));
    });

    // Mock Server 2: Returns valid NEAR RPC response
    const server2 = http.createServer((req, res) => {
      server2Calls++;
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(
        JSON.stringify({
          jsonrpc: "2.0",
          id: "dontcare",
          result: {
            sync_info: {
              latest_block_height: 1234567,
            },
          },
        })
      );
    });

    await new Promise<void>((resolve) => server1.listen(0, resolve));
    await new Promise<void>((resolve) => server2.listen(0, resolve));

    const port1 = (server1.address() as any).port;
    const port2 = (server2.address() as any).port;

    const client = new ResilientRpcClient({
      endpoints: [`http://127.0.0.1:${port1}`, `http://127.0.0.1:${port2}`],
      maxRetries: 3,
      baseBackoffMs: 20,
    });

    try {
      const height = await client.getBlockHeight();
      assert.strictEqual(height, 1234567n);
      assert.ok(server1Calls >= 1, "Server 1 should have been called first and returned 429");
      assert.ok(server2Calls >= 1, "Server 2 should have been called via failover");
    } finally {
      server1.close();
      server2.close();
    }
  });

  it("handles JSON-RPC body level rate limits by rotating endpoints", async () => {
    let server1Calls = 0;
    let server2Calls = 0;

    // Mock Server 1: Returns 200 OK but with JSON-RPC body rate limit
    const server1 = http.createServer((req, res) => {
      server1Calls++;
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(
        JSON.stringify({
          jsonrpc: "2.0",
          id: "dontcare",
          error: {
            code: -32000,
            message: "Server error: Too many requests. Rate limit.",
          },
        })
      );
    });

    // Mock Server 2: Returns valid response
    const server2 = http.createServer((req, res) => {
      server2Calls++;
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(
        JSON.stringify({
          jsonrpc: "2.0",
          id: "dontcare",
          result: {
            result: Array.from(Buffer.from(JSON.stringify({ round_id: 1, status: "Open" }))),
          },
        })
      );
    });

    await new Promise<void>((resolve) => server1.listen(0, resolve));
    await new Promise<void>((resolve) => server2.listen(0, resolve));

    const port1 = (server1.address() as any).port;
    const port2 = (server2.address() as any).port;

    const client = new ResilientRpcClient({
      endpoints: [`http://127.0.0.1:${port1}`, `http://127.0.0.1:${port2}`],
      maxRetries: 3,
      baseBackoffMs: 20,
    });

    try {
      const round = await client.viewFunction<any>("amstr-game.testnet", "get_round", {
        round_id: 1,
      });
      assert.strictEqual(round.round_id, 1);
      assert.strictEqual(round.status, "Open");
      assert.ok(server1Calls >= 1);
      assert.ok(server2Calls >= 1);
    } finally {
      server1.close();
      server2.close();
    }
  });
});
