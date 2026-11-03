#!/usr/bin/env node
/**
 * AMSTR Model Context Protocol (MCP) Stdio Bridge
 *
 * Usage with Claude Desktop / Cursor / Windsurf:
 * {
 *   "mcpServers": {
 *     "amstr": {
 *       "command": "node",
 *       "args": ["/path/to/scripts/amstr-mcp.mjs"],
 *       "env": {
 *         "AMSTR_MCP_TOKEN": "amstr_mcp_...",
 *         "AMSTR_SERVER_URL": "https://amstr-keeper.fly.dev"
 *       }
 *     }
 *   }
 * }
 */

import readline from "readline";

const SERVER_URL = (process.env.AMSTR_SERVER_URL || "https://amstr-keeper.fly.dev").replace(/\/+$/, "");
const TOKEN = process.env.AMSTR_MCP_TOKEN || "";

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
  terminal: false,
});

rl.on("line", async (line) => {
  const trimmed = line.trim();
  if (!trimmed) return;

  try {
    const rpcReq = JSON.parse(trimmed);

    const res = await fetch(`${SERVER_URL}/mcp`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(TOKEN ? { Authorization: `Bearer ${TOKEN}` } : {}),
      },
      body: JSON.stringify(rpcReq),
    });

    const data = await res.json();
    process.stdout.write(JSON.stringify(data) + "\n");
  } catch (err) {
    const errorRes = {
      jsonrpc: "2.0",
      id: null,
      error: {
        code: -32603,
        message: err.message || String(err),
      },
    };
    process.stdout.write(JSON.stringify(errorRes) + "\n");
  }
});
