#!/usr/bin/env node
import readline from "readline";
import { executeMcpMethod } from "./server.js";
import { JsonRpcRequest, JsonRpcResponse } from "./types.js";

const token = process.env.AMSTR_MCP_TOKEN || "";

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
  terminal: false,
});

rl.on("line", async (line) => {
  const trimmed = line.trim();
  if (!trimmed) return;

  try {
    const req = JSON.parse(trimmed) as JsonRpcRequest;
    const result = await executeMcpMethod(req.method, req.params, token);

    const res: JsonRpcResponse = {
      jsonrpc: "2.0",
      id: req.id || null,
      result,
    };

    process.stdout.write(JSON.stringify(res) + "\n");
  } catch (err: any) {
    const errorRes: JsonRpcResponse = {
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
