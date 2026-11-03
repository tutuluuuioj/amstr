import { KeyPair } from "near-api-js";
import { CONFIG } from "../config";

export interface GeneratedMcpToken {
  token: string;
  accountId: string;
  publicKey: string;
  privateKey?: string;
  label: string;
  createdAt: number;
  serverUrl: string;
  sseUrl: string;
  isRegisteredOnServer: boolean;
}

const STORAGE_KEY = "amstr_agent_mcp_tokens_v1";

export function loadSavedMcpTokens(): GeneratedMcpToken[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

export function saveMcpTokens(tokens: GeneratedMcpToken[]): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(tokens));
  } catch (e) {
    console.warn("Could not save MCP tokens to localStorage:", e);
  }
}

export async function generateAgentMcpToken(params: {
  accountId: string;
  existingPrivateKey?: string;
  label?: string;
  maxBetNear?: number;
}): Promise<GeneratedMcpToken> {
  const keeperUrl = (CONFIG as any).KEEPER_URL || "https://amstr-keeper.fly.dev";

  let keyPair: KeyPair;
  let privateKeyStr: string | undefined = params.existingPrivateKey;
  let publicKeyStr: string;

  if (privateKeyStr) {
    try {
      keyPair = KeyPair.fromString(privateKeyStr as any);
      publicKeyStr = keyPair.getPublicKey().toString();
    } catch {
      keyPair = KeyPair.fromRandom("ed25519");
      publicKeyStr = keyPair.getPublicKey().toString();
      privateKeyStr = keyPair.toString();
    }
  } else {
    keyPair = KeyPair.fromRandom("ed25519");
    publicKeyStr = keyPair.getPublicKey().toString();
    privateKeyStr = keyPair.toString();
  }

  const payload = {
    v: 1,
    type: "amstr_agent_token",
    accountId: params.accountId,
    privateKey: privateKeyStr,
    contractId: CONFIG.CONTRACT_ID,
    network: CONFIG.NETWORK_ID,
    label: params.label || `Agent-${params.accountId.split(".")[0]}`,
    createdAt: Date.now(),
    maxBetNear: params.maxBetNear,
    allowedMethods: ["deploy", "claim", "reclaim_storage", "refund_expired"],
  };

  const b64 = btoa(JSON.stringify(payload)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  const token = `amstr_mcp_${b64}`;

  let isRegistered = false;
  try {
    const res = await fetch(`${keeperUrl}/mcp/token`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        accountId: params.accountId,
        privateKey: privateKeyStr,
        label: payload.label,
        maxBetNear: params.maxBetNear,
      }),
    });
    if (res.ok) {
      isRegistered = true;
    }
  } catch (e) {
    console.warn("Could not register token on keeper server (will still work via bearer payload):", e);
  }

  const result: GeneratedMcpToken = {
    token,
    accountId: params.accountId,
    publicKey: publicKeyStr,
    privateKey: privateKeyStr,
    label: payload.label,
    createdAt: payload.createdAt,
    serverUrl: `${keeperUrl}/mcp`,
    sseUrl: `${keeperUrl}/mcp/sse`,
    isRegisteredOnServer: isRegistered,
  };

  const all = loadSavedMcpTokens();
  all.unshift(result);
  saveMcpTokens(all.slice(0, 10)); // keep 10 most recent

  return result;
}

export async function testMcpTool(
  toolName: string,
  args: Record<string, any> = {},
  token?: string
): Promise<any> {
  const keeperUrl = (CONFIG as any).KEEPER_URL || "https://amstr-keeper.fly.dev";
  const res = await fetch(`${keeperUrl}/mcp`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: "test-" + Date.now(),
      method: "tools/call",
      params: {
        name: toolName,
        arguments: args,
      },
    }),
  });

  const json = await res.json();
  if (json.error) {
    throw new Error(json.error.message || JSON.stringify(json.error));
  }

  const rawText = json.result?.content?.[0]?.text;
  try {
    return JSON.parse(rawText);
  } catch {
    return rawText;
  }
}
