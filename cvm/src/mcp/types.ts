export interface McpTokenPayload {
  v: number;
  type: "amstr_agent_token";
  accountId: string;
  privateKey?: string;
  contractId: string;
  network: "testnet" | "mainnet";
  label?: string;
  createdAt: number;
  maxBetNear?: number;
  allowedMethods?: string[];
}

export interface StoredAgentSession {
  tokenId: string;
  accountId: string;
  privateKey?: string;
  label?: string;
  createdAt: number;
  lastUsedAt?: number;
  totalBetsPlaced?: number;
  totalNearWagered?: string;
}

export interface McpToolDefinition {
  name: string;
  description: string;
  inputSchema: {
    type: "object";
    properties: Record<string, any>;
    required?: string[];
  };
}

export interface JsonRpcRequest {
  jsonrpc: "2.0";
  id?: string | number | null;
  method: string;
  params?: any;
}

export interface JsonRpcResponse {
  jsonrpc: "2.0";
  id: string | number | null;
  result?: any;
  error?: {
    code: number;
    message: string;
    data?: any;
  };
}
