import { secp256k1 } from "@noble/curves/secp256k1";
import { sha3_256, keccak_256 } from "@noble/hashes/sha3";
import { sha256 } from "@noble/hashes/sha256";
import nacl from "tweetnacl";
import { utils } from "near-api-js";

export const MPC_TESTNET_CONTRACT = "v1.signer-prod.testnet";
export const MPC_TESTNET_ROOT_KEY_HEX =
  "04a8bb8176747682aab5c681d4ef375ca537023b2b287d8b5f9d89505277a5a291538ef3680882d8fb793a62a5fdb4c6974c7cd8f9eb0b9cbbf659314c30347000";

const EPSILON_DERIVATION_PREFIX = "near-mpc-recovery v0.1.0 epsilon derivation:";

export interface DerivedForeignAccounts {
  accountId: string;
  ethereum: string;
  base: string;
  arbitrum: string;
  solana: string;
}

export function computeDerivationTweak(accountId: string, path: string): Uint8Array {
  const derivationString = `${EPSILON_DERIVATION_PREFIX}${accountId},${path}`;
  return sha3_256(new TextEncoder().encode(derivationString));
}

export function deriveChildSecp256k1PublicKey(
  accountId: string,
  path: string,
  rootPubHex = MPC_TESTNET_ROOT_KEY_HEX
): string {
  const rootPoint = secp256k1.ProjectivePoint.fromHex(rootPubHex);
  const tweakBytes = computeDerivationTweak(accountId, path);
  // Scalar modulo curve order for strict mathematical defense-in-depth
  const scalar = BigInt("0x" + Buffer.from(tweakBytes).toString("hex")) % secp256k1.CURVE.n;

  const tweakPoint = secp256k1.ProjectivePoint.BASE.multiply(scalar);
  const childPoint = rootPoint.add(tweakPoint);
  return Buffer.from(childPoint.toRawBytes(false)).toString("hex");
}

export function deriveEthAddress(
  accountId: string,
  path = "ethereum-1",
  rootPubHex = MPC_TESTNET_ROOT_KEY_HEX
): string {
  const childPubHex = deriveChildSecp256k1PublicKey(accountId, path, rootPubHex);
  const pubBytes = Buffer.from(childPubHex.slice(2), "hex");
  const hash = keccak_256(pubBytes);
  const ethAddr = Buffer.from(hash.slice(-20)).toString("hex");
  return `0x${ethAddr}`;
}

export function deriveBaseAddress(
  accountId: string,
  path = "base-1",
  rootPubHex = MPC_TESTNET_ROOT_KEY_HEX
): string {
  return deriveEthAddress(accountId, path, rootPubHex);
}

export function deriveArbitrumAddress(
  accountId: string,
  path = "arbitrum-1",
  rootPubHex = MPC_TESTNET_ROOT_KEY_HEX
): string {
  return deriveEthAddress(accountId, path, rootPubHex);
}

export function deriveSolanaAddress(accountId: string, path = "solana-1"): string {
  const seedString = `amstr-solana-derivation:${accountId},${path}`;
  const seedBytes = sha256(new TextEncoder().encode(seedString));
  const keyPair = nacl.sign.keyPair.fromSeed(seedBytes);
  return utils.serialize.base_encode(keyPair.publicKey);
}

export function getDerivedForeignAccounts(accountId: string): DerivedForeignAccounts {
  return {
    accountId,
    ethereum: deriveEthAddress(accountId, "ethereum-1"),
    base: deriveBaseAddress(accountId, "base-1"),
    arbitrum: deriveArbitrumAddress(accountId, "arbitrum-1"),
    solana: deriveSolanaAddress(accountId, "solana-1"),
  };
}

export interface MpcSignature {
  big_r: {
    affine_point: string;
  };
  s: {
    scalar: string;
  };
  recovery_id: number;
}

export class NearChainSignaturesClient {
  private networkId: string;
  private nodeUrl: string;

  constructor(
    networkId = "testnet",
    nodeUrl = process.env.NEAR_RPC_URL || "https://near-testnet.drpc.org"
  ) {
    this.networkId = networkId;
    this.nodeUrl = nodeUrl;
  }

  public async requestSignature(
    signerAccount: any,
    payload32Bytes: Uint8Array,
    path = "base-1",
    keyVersion = 0
  ): Promise<MpcSignature> {
    if (payload32Bytes.length !== 32) {
      throw new Error(`Payload must be exactly 32 bytes, got ${payload32Bytes.length}`);
    }

    const payloadArray = Array.from(payload32Bytes);

    const res = await signerAccount.functionCall({
      contractId: MPC_TESTNET_CONTRACT,
      methodName: "sign",
      args: {
        request: {
          payload: payloadArray,
          path,
          key_version: keyVersion,
        },
      },
      gas: 250000000000000n,
      attachedDeposit: 1n,
    });

    const decoded = JSON.parse(
      Buffer.from(res.status?.SuccessValue || "e30=", "base64").toString("utf8")
    );

    return decoded as MpcSignature;
  }

  /**
   * Request Ed25519 signature from NEAR MPC v1.signer-prod.testnet (domain_id: 1)
   * Suitable for Solana, Aptos, Sui native transactions.
   */
  public async requestEd25519Signature(
    signerAccount: any,
    payload32Bytes: Uint8Array,
    path = "solana-1",
    keyVersion = 0
  ): Promise<Uint8Array> {
    if (payload32Bytes.length !== 32) {
      throw new Error(`Payload must be exactly 32 bytes, got ${payload32Bytes.length}`);
    }

    const payloadHex = Buffer.from(payload32Bytes).toString("hex");

    const res = await signerAccount.functionCall({
      contractId: MPC_TESTNET_CONTRACT,
      methodName: "sign",
      args: {
        request: {
          path,
          payload_v2: {
            Eddsa: payloadHex,
          },
          domain_id: 1,
        },
      },
      gas: 250000000000000n,
      attachedDeposit: 1n,
    });

    const decoded = JSON.parse(
      Buffer.from(res.status?.SuccessValue || "e30=", "base64").toString("utf8")
    );

    if (Array.isArray(decoded?.signature)) {
      return new Uint8Array(decoded.signature);
    }
    if (typeof decoded?.signature === "string") {
      return new Uint8Array(Buffer.from(decoded.signature.replace("0x", ""), "hex"));
    }
    throw new Error("Invalid Ed25519 signature returned from MPC");
  }
}
