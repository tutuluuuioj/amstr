import http from "http";
import { URL } from "url";
import { AmstrMcpEngine, mcpEngine } from "./engine.js";
import { JsonRpcRequest, JsonRpcResponse, McpToolDefinition } from "./types.js";

export const MCP_TOOLS: McpToolDefinition[] = [
  {
    name: "amstr_get_active_round",
    description:
      "Get live details of the currently active AMSTR round on NEAR Testnet, including round ID, status (Open/Drawing/Revealing), pot size, jackpot amounts, time remaining, and entry count.",
    inputSchema: {
      type: "object",
      properties: {},
    },
  },
  {
    name: "amstr_get_round",
    description: "Get historical details and outcomes of any specific AMSTR round by its numeric round ID.",
    inputSchema: {
      type: "object",
      properties: {
        round_id: {
          type: "integer",
          description: "Numeric ID of the round to query (e.g. 255)",
        },
      },
      required: ["round_id"],
    },
  },
  {
    name: "amstr_get_recent_rounds",
    description: "Get recent round history, winning numbers, and prize pots to analyze game trends.",
    inputSchema: {
      type: "object",
      properties: {
        limit: {
          type: "integer",
          description: "Number of past rounds to retrieve (default: 10, max: 25)",
        },
      },
    },
  },
  {
    name: "amstr_get_player_info",
    description:
      "Get player account status, available NEAR balance, active bets in the current round, registered key status, and discover any unclaimed winnings from settled rounds.",
    inputSchema: {
      type: "object",
      properties: {
        account_id: {
          type: "string",
          description: "Optional NEAR account ID to inspect (defaults to the account linked to the MCP token)",
        },
      },
    },
  },
  {
    name: "amstr_bet",
    description:
      "Place a confidential bet / join the current active AMSTR round. Automatically fetches and verifies the Phala TEE CVM key, encrypts tile selection with X25519-XSalsa20-Poly1305, computes the cryptographic SHA-256 commit hash, and signs and submits the on-chain deploy transaction on NEAR Testnet.",
    inputSchema: {
      type: "object",
      properties: {
        tiles: {
          type: "array",
          items: {
            type: "integer",
            minimum: 0,
            maximum: 24,
          },
          description: "Array of chosen tiles (integers from 0 to 24). Example: [10] or [5, 12, 19].",
        },
        stake_near: {
          type: "number",
          description: "Amount of NEAR to stake on the bet (minimum 0.01 NEAR). Example: 0.05",
        },
        round_id: {
          type: "integer",
          description: "Optional target round ID (defaults to current active Open round)",
        },
      },
      required: ["tiles", "stake_near"],
    },
  },
  {
    name: "amstr_claim_payout",
    description:
      "Claim winning payouts and jackpot shares for settled rounds won by the player. Automatically discovers unclaimed wins if round_ids is omitted. Note: Winning pot payouts are distributed net of a 5% staking dividend / treasury retention, plus standard NEAR execution gas (~0.0003 NEAR).",
    inputSchema: {
      type: "object",
      properties: {
        round_ids: {
          type: "array",
          items: { type: "integer" },
          description: "Optional list of round IDs to claim. If omitted or empty, auto-detects and claims all winning rounds.",
        },
      },
    },
  },
  {
    name: "amstr_reclaim_storage",
    description: "Reclaim the 0.01 NEAR entry storage deposit from past settled rounds.",
    inputSchema: {
      type: "object",
      properties: {},
    },
  },
  {
    name: "amstr_verify_fairness",
    description:
      "Independently verify provable fairness for any settled AMSTR round using cryptographic math: verifies that the Phala TEE enclave's revealed seed matches the on-chain pre-commitment hash (SHA-256), and that the combination of seed and locked block entropy derives the exact winning tile.",
    inputSchema: {
      type: "object",
      properties: {
        round_id: {
          type: "integer",
          description: "Numeric ID of the settled round to mathematically verify",
        },
      },
      required: ["round_id"],
    },
  },
  {
    name: "amstr_get_jackpot_status",
    description: "Check current jackpot prize reserves (Shard 1:300, Vein 1:1000, Core 1:3000) and Wildcat 60% bonus countdown.",
    inputSchema: {
      type: "object",
      properties: {},
    },
  },
  {
    name: "amstr_get_crosschain_deposit_address",
    description:
      "Get the agent's deterministic derived deposit address on Base, Ethereum, Arbitrum, or Solana via NEAR Chain Signatures. Allows autonomous agents with EVM or Solana treasuries to fund rounds without holding NEAR.",
    inputSchema: {
      type: "object",
      properties: {
        account_id: {
          type: "string",
          description: "Optional NEAR account ID (defaults to the agent's account)",
        },
        chain: {
          type: "string",
          enum: ["base", "ethereum", "arbitrum", "solana"],
          description: "Target external blockchain for funding (default: 'base')",
        },
      },
    },
  },
  {
    name: "amstr_check_crosschain_deposit",
    description:
      "Check the status and block confirmations of an external cross-chain deposit intent and verify its execution on the AMSTR NEAR game contract.",
    inputSchema: {
      type: "object",
      properties: {
        intent_id: {
          type: "string",
          description: "Unique deposit intent ID",
        },
        tx_hash: {
          type: "string",
          description: "External chain transaction hash (0x...)",
        },
      },
    },
  },
  {
    name: "amstr_claim_crosschain",
    description:
      "Claim and sweep AMSTR game winnings directly to an external EVM/Base address using NEAR Chain Signatures (MPC threshold signing).",
    inputSchema: {
      type: "object",
      properties: {
        recipient_address: {
          type: "string",
          description: "External EVM recipient address (0x...)",
        },
        amount_eth: {
          type: "string",
          description: "Amount to transfer in ETH units (e.g. '0.005')",
        },
        chain: {
          type: "string",
          enum: ["base", "ethereum"],
          description: "Target foreign chain for payout (default: 'base')",
        },
      },
      required: ["recipient_address"],
    },
  },
];

// Active SSE sessions: sessionId -> response stream
const sseSessions = new Map<string, http.ServerResponse>();

export async function executeMcpMethod(
  method: string,
  params: any,
  tokenHeader?: string
): Promise<any> {
  switch (method) {
    case "initialize":
      return {
        protocolVersion: "2024-11-05",
        capabilities: {
          tools: {},
        },
        serverInfo: {
          name: "amstr-mcp-server",
          version: "1.0.0",
          description: "AMSTR Model Context Protocol Server for Autonomous AI Agents on NEAR Protocol",
        },
      };

    case "notifications/initialized":
      return {};

    case "ping":
      return {};

    case "tools/list":
      return {
        tools: MCP_TOOLS,
      };

    case "tools/call": {
      const toolName = params?.name;
      const args = params?.arguments || {};
      const token = tokenHeader ? mcpEngine.parseToken(tokenHeader) : null;

      let result: any;

      switch (toolName) {
        case "amstr_get_active_round":
          result = await mcpEngine.getActiveRound();
          break;

        case "amstr_get_round":
          if (args.round_id === undefined) throw new Error("Missing required argument: round_id");
          result = await mcpEngine.getRound(args.round_id);
          break;

        case "amstr_get_recent_rounds":
          result = await mcpEngine.getRecentRounds(args.limit);
          break;

        case "amstr_get_player_info":
          if (!token) throw new Error("Authentication required: provide an AMSTR MCP token in Bearer header or ?token=");
          result = await mcpEngine.getPlayerInfo(token, args.account_id);
          break;

        case "amstr_bet":
        case "amstr_join_round":
          if (!token) throw new Error("Authentication required: provide an AMSTR MCP token with signing permission to place bets.");
          result = await mcpEngine.placeBet(token, args.tiles, args.stake_near, args.round_id);
          break;

        case "amstr_claim_payout":
          if (!token) throw new Error("Authentication required: provide an AMSTR MCP token to claim payouts.");
          result = await mcpEngine.claimPayout(token, args.round_ids);
          break;

        case "amstr_reclaim_storage":
          if (!token) throw new Error("Authentication required: provide an AMSTR MCP token to reclaim storage.");
          result = await mcpEngine.reclaimStorage(token);
          break;

        case "amstr_verify_fairness":
          if (args.round_id === undefined) throw new Error("Missing required argument: round_id");
          result = await mcpEngine.verifyFairness(args.round_id);
          break;

        case "amstr_get_jackpot_status":
          result = await mcpEngine.getJackpotStatus();
          break;

        case "amstr_get_crosschain_deposit_address":
          result = await mcpEngine.getCrossChainDepositAddress(token, args.account_id, args.chain);
          break;

        case "amstr_check_crosschain_deposit":
          result = await mcpEngine.checkCrossChainDeposit(args.intent_id, args.tx_hash);
          break;

        case "amstr_claim_crosschain":
          if (!token) throw new Error("Authentication required: provide an AMSTR MCP token to claim cross-chain payouts.");
          if (!args.recipient_address) throw new Error("Missing required argument: recipient_address");
          result = await mcpEngine.claimCrossChainPayout(token, args.recipient_address, args.amount_eth, args.chain);
          break;

        default:
          throw new Error(`Unknown tool: ${toolName}`);
      }

      return {
        content: [
          {
            type: "text",
            text: typeof result === "string" ? result : JSON.stringify(result, null, 2),
          },
        ],
      };
    }

    default:
      throw new Error(`Method not supported: ${method}`);
  }
}

export async function handleMcpHttp(req: http.IncomingMessage, res: http.ServerResponse): Promise<boolean> {
  const parsedUrl = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`);
  const pathname = parsedUrl.pathname;

  // Set CORS headers for all MCP endpoints
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");

  if (req.method === "OPTIONS") {
    res.writeHead(204);
    res.end();
    return true;
  }

  // 1. GET /mcp/tools -> Quick JSON inspection
  if (req.method === "GET" && pathname === "/mcp/tools") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ status: "ok", count: MCP_TOOLS.length, tools: MCP_TOOLS }, null, 2));
    return true;
  }

  // 2. POST /mcp/token -> Generate new MCP token for user/agent
  if (req.method === "POST" && pathname === "/mcp/token") {
    let body = "";
    req.on("data", (chunk) => (body += chunk));
    req.on("end", () => {
      try {
        const json = JSON.parse(body || "{}");
        if (!json.accountId) {
          res.writeHead(400, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: "Missing required field: accountId" }));
          return;
        }

        const created = mcpEngine.createToken(
          json.accountId,
          json.privateKey,
          json.label,
          json.maxBetNear,
          Boolean(json.serverVaulted)
        );

        const host = req.headers.host || "amstr-keeper.fly.dev";
        const proto = (req.headers["x-forwarded-proto"] as string) || "https";

        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(
          JSON.stringify({
            status: "ok",
            token: created.token,
            payload: created.payload,
            serverUrl: `${proto}://${host}/mcp`,
            sseUrl: `${proto}://${host}/mcp/sse`,
          })
        );
      } catch (err: any) {
        res.writeHead(500, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: err.message || String(err) }));
      }
    });
    return true;
  }

  // Revoke token endpoint
  if (req.method === "POST" && (pathname === "/mcp/token/revoke" || pathname === "/mcp/revoke")) {
    let body = "";
    req.on("data", (chunk) => (body += chunk));
    req.on("end", () => {
      try {
        const json = JSON.parse(body || "{}");
        const tokenToRevoke = json.token || parsedUrl.searchParams.get("token") || (req.headers.authorization as string) || "";
        if (!tokenToRevoke) {
          res.writeHead(400, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: "Missing required field: token" }));
          return;
        }
        const revoked = mcpEngine.revokeToken(tokenToRevoke);
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ status: "ok", revoked }));
      } catch (err: any) {
        res.writeHead(500, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: err.message || String(err) }));
      }
    });
    return true;
  }

  // Extract auth token from header or URL parameter
  const tokenParam = parsedUrl.searchParams.get("token") || (req.headers.authorization as string) || "";

  const isSseRequest =
    pathname === "/mcp/sse" ||
    pathname === "/sse" ||
    ((pathname === "/mcp" || pathname === "/mcp/") &&
      (req.headers.accept?.includes("text/event-stream") || parsedUrl.searchParams.get("transport") === "sse"));

  // 3. GET -> Server-Sent Events stream for official MCP clients & Grok Bot connector
  if (req.method === "GET" && isSseRequest) {
    const sessionId = Math.random().toString(36).substring(2, 15);
    res.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
      "Access-Control-Allow-Origin": "*",
    });

    sseSessions.set(sessionId, res);

    // Send endpoint notification with absolute post URL (required by Grok Bot and strict MCP clients)
    const host = req.headers.host || "amstr-keeper.fly.dev";
    const proto = (req.headers["x-forwarded-proto"] as string) || "https";
    const postUrl = `${proto}://${host}/mcp/message?sessionId=${sessionId}`;
    res.write(`event: endpoint\ndata: ${postUrl}\n\n`);

    req.on("close", () => {
      sseSessions.delete(sessionId);
    });

    return true;
  }

  // 3b. GET /mcp -> Discovery probe for MCP connectors (e.g. Grok Bot checking if server is alive)
  if (req.method === "GET" && (pathname === "/mcp" || pathname === "/mcp/")) {
    const host = req.headers.host || "amstr-keeper.fly.dev";
    const proto = (req.headers["x-forwarded-proto"] as string) || "https";
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(
      JSON.stringify(
        {
          status: "active",
          name: "amstr-mcp-server",
          version: "1.0.0",
          protocolVersion: "2024-11-05",
          transport: ["sse", "http-jsonrpc"],
          endpoints: {
            sse: `${proto}://${host}/mcp/sse`,
            jsonrpc: `${proto}://${host}/mcp`,
            tools: `${proto}://${host}/mcp/tools`,
          },
          toolsCount: MCP_TOOLS.length,
          instructions:
            "Connect using SSE at /mcp/sse (or /mcp with Accept: text/event-stream), or POST JSON-RPC 2.0 to /mcp.",
        },
        null,
        2
      )
    );
    return true;
  }

  // 4. POST /mcp/message?sessionId=... -> Handle messages from SSE client
  if (req.method === "POST" && pathname === "/mcp/message") {
    const sessionId = parsedUrl.searchParams.get("sessionId");
    const sseRes = sessionId ? sseSessions.get(sessionId) : null;

    let body = "";
    req.on("data", (chunk) => (body += chunk));
    req.on("end", async () => {
      try {
        const rpcReq = JSON.parse(body) as JsonRpcRequest;
        const result = await executeMcpMethod(rpcReq.method, rpcReq.params, tokenParam);

        const rpcRes: JsonRpcResponse = {
          jsonrpc: "2.0",
          id: rpcReq.id || null,
          result,
        };

        if (sseRes && !sseRes.writableEnded) {
          sseRes.write(`event: message\ndata: ${JSON.stringify(rpcRes)}\n\n`);
        }

        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify(rpcRes));
      } catch (err: any) {
        const errorRes: JsonRpcResponse = {
          jsonrpc: "2.0",
          id: null,
          error: {
            code: -32603,
            message: err.message || String(err),
          },
        };
        if (sseRes && !sseRes.writableEnded) {
          sseRes.write(`event: message\ndata: ${JSON.stringify(errorRes)}\n\n`);
        }
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify(errorRes));
      }
    });

    return true;
  }

  // 5. POST /mcp -> Direct stateless JSON-RPC 2.0 endpoint (curl / HTTP clients / modern agent frameworks)
  if (req.method === "POST" && (pathname === "/mcp" || pathname === "/mcp/")) {
    let body = "";
    req.on("data", (chunk) => (body += chunk));
    req.on("end", async () => {
      try {
        const rpcReq = JSON.parse(body) as JsonRpcRequest;
        const result = await executeMcpMethod(rpcReq.method, rpcReq.params, tokenParam);

        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(
          JSON.stringify({
            jsonrpc: "2.0",
            id: rpcReq.id || null,
            result,
          })
        );
      } catch (err: any) {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(
          JSON.stringify({
            jsonrpc: "2.0",
            id: null,
            error: {
              code: -32603,
              message: err.message || String(err),
            },
          })
        );
      }
    });

    return true;
  }

  return false;
}
