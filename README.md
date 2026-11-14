# AMSTR: Confidential Decentralized Mine Protocol

> **The first MEV-resistant, provably fair on-chain mine protocol on NEAR Protocol, powered by Intel TDX Confidential Hardware Enclaves (Phala Cloud).**

[![NEAR Protocol](https://img.shields.io/badge/NEAR-Testnet-blue?logo=near)](https://testnet.nearblocks.io/address/game.amstr-admin-zxlhcx.testnet)
[![Phala Intel TDX](https://img.shields.io/badge/Phala%20Cloud-Intel%20TDX%20Enclave-purple)](https://cloud.phala.network)
[![DCAP Attestation](https://img.shields.io/badge/DCAP%20Attestation-UpToDate%20(Verified)-brightgreen)](#-hardware-attestation--intel-tdx-verification)
[![Provable Fairness](https://img.shields.io/badge/Provable%20Fairness-100%25%20Cryptographically%20Verified-success)](#-how-to-verify-provable-fairness)
[![Rust Contract Tests](https://img.shields.io/badge/Rust%20Tests-53%2F53%20Passing-brightgreen)](contracts)
[![TypeScript CVM Tests](https://img.shields.io/badge/TypeScript%20CVM%20Tests-32%2F32%20Passing-brightgreen)](cvm)
[![Web Client Tests](https://img.shields.io/badge/Web%20Client%20Tests-14%2F14%20Passing-brightgreen)](web)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

---

## 💡 What is AMSTR? (Explain Like I'm 5)

Imagine playing a **5x5 grid game with 25 tiles** (`#0` to `#24`). In every round, exactly **one tile is the Golden Winning Tile**. You choose which tiles to bet on, and if your pick contains the winning tile, you win the prize pot!

### The Problem With Normal Crypto Games:
On normal blockchains like Ethereum, Solana, or Polygon, **everything in the mempool is public**. 
- 🤖 **Bots and Miners can peek at your bets:** When you send your bet, bots can see exactly which tiles you picked before the block is mined. They can copy your picks, front-run you, or exploit the odds.
- 🕵️ **Operators can cheat:** If a game server generates the random number, the server operator can secretly peek at the outcome or change the winning tile to favor themselves.

### How AMSTR Fixes This Completely:
AMSTR combines **NEAR Protocol** with **Phala Cloud Intel TDX Secure Hardware Enclaves**:

1. 🔒 **Secret Picks (Client-Side Encrypted Bets)**: When you pick tiles, your web browser encrypts your picks locally on your device using TweetNaCl public-key cryptography (X25519 + XSalsa20Poly1305). Nobody in the world — not NEAR miners, not validators, and not even the AMSTR operators — can see what you picked while betting is open.
2. 🛡️ **Hardware Vault (Intel TDX Enclave)**: Your picks are only decrypted inside a tamper-proof hardware chip running in volatile memory *after* betting has permanently closed.
3. 🎲 **Mathematically Unriggable (Provably Fair)**: The winning tile is calculated by combining a secret seed from the secure hardware chip with the unpredictable on-chain block hash from NEAR. It is mathematically impossible for anyone to rig or predict.
4. 💰 **Non-Custodial Escrow & Liveness Timeout Protection**: Player funds are held by the audited NEAR smart contract, never by any centralized custodian. If the hardware enclave ever goes offline, reboots, or fails to settle within the designated deadline, automated on-chain timeout refund protection activates. You can execute a refund call directly from your wallet and reclaim 100% of your deposit with zero protocol fees.

---

## 🎮 How a Round Works (Step-by-Step)

```mermaid
flowchart LR
    A["1. Pick Tiles<br/>(Client-side Encrypted)"] --> B["2. 15-Min Deposit Window<br/>(Pot grows on NEAR)"]
    B --> C["3. Hardware Draw<br/>(Intel TDX unseals & draws)"]
    C --> D["4. Winner Celebration<br/>(14s reveal & claim payouts)"]
```

1. **Step 1: Pick & Stake (15-Minute Window)**
   - Open the web app and connect your NEAR wallet (MyNearWallet, Meteor, Here, etc.).
   - Select between **1 and 25 tiles** on the board.
   - Choose your stake (e.g. `0.1 NEAR`, `0.5 NEAR`, `1.0 NEAR`).
   - Your browser encrypts your picks and submits the transaction to the NEAR smart contract.
2. **Step 2: Betting Closes & Entropy Locks**
   - When the 15-minute deposit window ends (~900 blocks on NEAR), no more bets are accepted.
   - The contract captures the NEAR blockchain's latest block hash (`chain_entropy`).
3. **Step 3: Intel TDX Hardware Decryption & Draw**
   - The Intel TDX Enclave pulls the encrypted bets into secure enclave memory.
   - It reveals the secret seed it pre-committed before the round started.
   - It computes the winning tile:
     $$\text{Winning Tile} = \text{u64\_le}(\text{SHA-256}(\text{seed} \mathbin{\Vert} \text{chain\_entropy})[0..8]) \pmod{25}$$
4. **Step 4: Celebration & Payouts**
   - **Live Draw Celebration**: The winning tile lights up on the board with a glowing gold aura and `🏆 WINNER` badge for 14 seconds!
   - **Winners**: Split the net prize pot and receive bonus **AMSTR NEP-141 tokens**.
   - **Non-Winners**: Can reclaim **100% of their 0.01 NEAR entry storage deposit**.
   - **Zero-Winner Carryover**: If nobody picked the winning tile (or no players entered), 100% of the pot automatically rolls over into the next round!

---

## 🚀 Quick Start: Run Locally in 2 Minutes

### Prerequisites
- [Node.js](https://nodejs.org/) v20+ or v22+
- Git

### 1. Clone & Start the Web Frontend
```bash
# Clone the repository
git clone https://github.com/tutuluuuioj/amstr.git
cd amstr

# Install and start the web frontend
cd web
npm install
npm run dev
```
Open **`http://localhost:5173`** in your browser. You can immediately connect any NEAR Testnet wallet and play!

### 2. (Optional) Run the Autonomous TEE Keeper
If you want to run the autonomous background keeper that unseals bets and rolls rounds:
```bash
cd cvm
npm install
npx tsx src/autonomous-runner.ts
```

---

## 🏛 Live On-Chain Deployments (NEAR Testnet)

All smart contracts are live, verified, and operational on **NEAR Testnet**:

| Contract Role | Account ID | Explorer Link |
|---|---|---|
| **Game Engine** | `game.amstr-admin-zxlhcx.testnet` | [View on NearBlocks](https://testnet.nearblocks.io/address/game.amstr-admin-zxlhcx.testnet) |
| **AMSTR Token (NEP-141)** | `token.amstr-admin-zxlhcx.testnet` | [View on NearBlocks](https://testnet.nearblocks.io/address/token.amstr-admin-zxlhcx.testnet) |
| **Treasury & Buyback** | `treasury.amstr-admin-zxlhcx.testnet` | [View on NearBlocks](https://testnet.nearblocks.io/address/treasury.amstr-admin-zxlhcx.testnet) |
| **AMSTR Staking Pool** | `staking.amstr-admin-zxlhcx.testnet` | [View on NearBlocks](https://testnet.nearblocks.io/address/staking.amstr-admin-zxlhcx.testnet) |
| **Phala Intel TDX CVM** | `10d1a977-f439-4128-8a73-f173594d6e45` | [Live Enclave DCAP Report](https://amstr-keeper.fly.dev/attestation) |
| **Live Web dApp (Fly.io)** | `amstr-web` | [https://amstr-web.fly.dev](https://amstr-web.fly.dev) |
| **Autonomous Keeper & MCP Server (Fly.io)** | `amstr-keeper` | [https://amstr-keeper.fly.dev/health](https://amstr-keeper.fly.dev/health) |

---

## 🤖 AI Agents & MCP: Autonomous Gameplay on NEAR

> **Any AI Agent (Claude, Grok, Cursor, ChatGPT, or Python/TS bots) can now play AMSTR completely autonomously!**

AMSTR includes a native **Model Context Protocol (MCP) Server** running directly alongside the Intel TDX enclave. Your AI agent can read game state, strategize, place confidential hardware-encrypted bets, monitor draws, and claim winnings on NEAR Protocol.

```mermaid
flowchart LR
    Agent["🤖 AI Agent<br/>(Claude / Grok / Bot)"] -->|"MCP JSON-RPC / SSE"| Server["⚡ AMSTR MCP Server<br/>(amstr-keeper.fly.dev)"]
    Server -->|"X25519 Enclave Encryption"| NEAR["⛓️ NEAR Testnet<br/>(game.amstr-admin-zxlhcx)"]
    NEAR -->|"Autonomous Payouts"| Agent
```

### Why Let AI Agents Play AMSTR?
* 🕵️ **100% Confidential**: Even though an AI agent signs the bet, the agent's tile selections are encrypted in-memory before broadcasting. No mempool bot or competitor can front-run your agent.
* 🛡️ **Budget Guardrails**: You can set a strict `maxBetNear` per token (e.g., maximum 0.5 NEAR per bet). The MCP server rejects any agent attempt to wager beyond your budget.
* ⚡ **Zero Human Intervention**: Your agent can monitor trends, place bets on open rounds, wait for settlement, and automatically claim winnings without you lifting a finger.

---

### 🧰 Available Agent MCP Tools

Your AI agent receives 8 standardized tools out of the box:

| Tool Name | What It Does (In Plain English) |
|---|---|
| `amstr_get_active_round` | Checks the live round ID, time remaining, current pot size, jackpot amounts, and active entries. |
| `amstr_bet` | Picks 1 to 25 tiles (0–24) and places an encrypted bet. Automatically unseals with Intel TDX and signs on NEAR. |
| `amstr_get_player_info` | Checks your agent's available NEAR balance, active bets, and automatically discovers any **unclaimed winnings**. |
| `amstr_claim_payout` | Claims winning payouts and jackpot shares from settled rounds directly into your wallet. |
| `amstr_reclaim_storage` | Recovers the refundable `0.01 NEAR` entry storage deposit from non-winning settled rounds. |
| `amstr_verify_fairness` | Mathematically proves that the round's winning tile matched the enclave's pre-committed seed hash and block entropy. |
| `amstr_get_jackpot_status` | Checks reserves for the Shard (1:300), Vein (1:1,000), and Core (1:3,000) Jackpots. |
| `amstr_get_recent_rounds` | Retrieves past winning numbers, pot sizes, and trends so the agent can analyze historical statistics. |

---

### ⚡ 60-Second "Noob-Friendly" Setup Guide

You don't need to be a developer to give your AI agent an AMSTR account:

#### Step 1: Generate an Agent Token in the Web App
1. Go to [https://amstr-web.fly.dev](https://amstr-web.fly.dev) and click the **🤖 AI Agents** tab in the top navigation bar.
2. Select **Dedicated Account** (Recommended: creates a self-contained testnet wallet for your agent).
3. Fund it with a small amount of testnet NEAR (e.g. `0.2 NEAR`) using the 1-click button.
4. Click **Generate Agent Token** and click **Copy Token** (`amstr_mcp_...`).

#### Step 2: Connect Your AI Agent

##### Option A: Connect to Claude Desktop or Cursor
Add this to your `claude_desktop_config.json`:
```json
{
  "mcpServers": {
    "amstr": {
      "command": "npx",
      "args": ["-y", "mcp-remote", "https://amstr-keeper.fly.dev/mcp/sse", "--header", "Authorization: Bearer amstr_mcp_YOUR_TOKEN_HERE"]
    }
  }
}
```

##### Option B: Connect to Grok Bot or Remote MCP Connectors
In Grok Bot or any SSE-compatible MCP interface, add a new connector:
* **Server URL**: `https://amstr-keeper.fly.dev/mcp`
* **Transport**: Server-Sent Events (SSE) or HTTP
* **Bearer Token**: `amstr_mcp_YOUR_TOKEN_HERE`

##### Option C: Direct Curl / HTTP Testing
You can test any tool instantly from your terminal without any software:
```bash
# Check the live round
curl -s -X POST https://amstr-keeper.fly.dev/mcp \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc": "2.0", "id": 1, "method": "tools/call", "params": {"name": "amstr_get_active_round", "arguments": {}}}'
```

#### Step 3: Prompt Your Agent to Play!
Simply say to your AI in chat:
> *"Check the current AMSTR round. If it's open, place a 0.05 NEAR bet on tiles 7, 12, and 18. If we won the previous round, claim our payout!"*

Your AI agent will query the MCP server, encrypt its picks, sign the NEAR transaction, and report the transaction explorer link back to you!

---

---

## 🧮 How to Verify Provable Fairness

Every single round played on AMSTR is 100% verifiable by anyone in the world without trusting our frontend, backend relayer, or server.

### Cryptographic Derivation Formula

The winning tile (an integer from 0 to 24) is derived deterministically from two cryptographic inputs that cannot be influenced by any player, miner, validator, or the game operator:
1. **Enclave Seed ($S$)**: A 32-byte volatile cryptographically secure random seed generated inside the Intel TDX hardware enclave. Its SHA-256 hash ($\text{seed\_commit}$) is committed and locked on-chain at round creation (`open_round`), long before bets are accepted.
2. **Chain Entropy ($E$)**: A 32-byte VRF block hash locked on-chain by the NEAR runtime at the exact block when betting closes (`close_round`).

$$\text{Winning Tile} = \text{u64\_le}(\text{SHA-256}(S \mathbin{\Vert} E)[0..8]) \pmod{25}$$

#### Exact Step-by-Step Verification:
1. **Seed Pre-Commitment Check**: Compute $\text{SHA-256}(\text{base64\_decode}(S))$. Verify it bit-for-bit matches the on-chain `seed_commit` published before the round opened.
2. **Buffer Concatenation**: Concatenate the 32-byte seed $S$ with the 32-byte locked chain entropy $E$ (producing a 64-byte buffer $S \mathbin{\Vert} E$).
3. **Combined Hash**: Compute $H = \text{SHA-256}(S \mathbin{\Vert} E)$ (producing 32 bytes).
4. **Little-Endian 64-bit Integer**: Read the first 8 bytes $H[0..8]$ as an unsigned 64-bit integer in little-endian byte order (`u64_le`).
5. **Modulo 25 Derivation**: Calculate $\text{val} \pmod{25}$. The result is the winning tile number (0 to 24).

---

### Verification Proof Examples

| Round | Revealed Seed (Base64) | On-Chain Commit (Hex) | Chain Entropy (Hex) | $H[0..8]$ (Hex) | u64 Integer | Mod 25 | Contract Tile | Match |
|---|---|---|---|---|---|---|---|---|
| **#92** | `Lfu59G3z3DgwYyhSyst9E0eNzao7uyaEeJSyNyecfUI=` | `6fd6343c62e7154c41...` | `033897649fddb9ea8e...` | `799d90768a6588c8` | `14,449,911,049,787,317,625` | **0** | **0** | ✅ **100% Match** |
| **#123** | `DXOi1/bjFQjtilZjzA5NbIrTJkF4hRoByZWJyj+Z2OE=` | `c99a870830a7534278...` | `40f5340cfa96bea0dd...` | `6c10ef2a233b664a` | `5,361,045,953,923,551,340` | **24** | **24** | ✅ **100% Match** |

---

### Method 1: Independent Python Verification Script (Zero Dependencies)

Run this standalone script in your terminal to verify any settled round against the NEAR blockchain and Intel TDX seed without installing any packages:

```python
import urllib.request, json, base64, hashlib, struct

ROUND_ID = 123  # Change to any round ID to audit

# 1. Fetch on-chain round data from NEAR RPC
args = base64.b64encode(json.dumps({"round_id": ROUND_ID}).encode()).decode()
rpc_payload = {
    "jsonrpc": "2.0", "id": "1", "method": "query",
    "params": {"request_type": "call_function", "finality": "final", "account_id": "game.amstr-admin-zxlhcx.testnet", "method_name": "get_round", "args_base64": args}
}
req = urllib.request.Request("https://test.rpc.fastnear.com", data=json.dumps(rpc_payload).encode(), headers={"Content-Type": "application/json"})
round_data = json.loads(bytes(json.loads(urllib.request.urlopen(req).read().decode())["result"]["result"]).decode())

# 2. Fetch revealed enclave seed from keeper API
req_seed = urllib.request.Request(f"https://amstr-keeper.fly.dev/seed/{ROUND_ID}")
seed_b64 = json.loads(urllib.request.urlopen(req_seed).read().decode())["seed"]
seed_bytes = base64.b64decode(seed_b64)

# 3. Step A: Verify Pre-Commitment
computed_commit = hashlib.sha256(seed_bytes).digest()
on_chain_commit = bytes(round_data["seed_commit"])
assert computed_commit == on_chain_commit, "Commitment mismatch!"
print(f"✅ Seed Pre-Commitment Valid: SHA-256(seed) matches on-chain commit")

# 4. Step B: Derive Winning Tile
entropy_bytes = bytes(round_data["chain_entropy"])
combined_hash = hashlib.sha256(seed_bytes + entropy_bytes).digest()
u64_val = struct.unpack("<Q", combined_hash[:8])[0]
calculated_tile = u64_val % 25

print(f"✅ Derived Tile: {calculated_tile} | Contract Winning Tile: {round_data['winning_tile']}")
assert calculated_tile == round_data["winning_tile"], "Tile mismatch!"
print(f"🎉 Round #{ROUND_ID} is 100% PROVABLY FAIR!")
```

### Method 2: One-Click Verification in the Web App
1. Go to the **Rounds** tab at [https://amstr-web.fly.dev](https://amstr-web.fly.dev).
2. Click **Verify Fairness** (shield icon) next to any settled round.
3. The app fetches the on-chain pre-commitment, reveals the hardware seed, combines it with the block entropy, and verifies the math live in your browser.

### Method 3: Verification via Node.js CLI
```bash
node scripts/verify-fairness.mjs 123
```

---

## 🔐 AI Agent Security Model: Dedicated Implicit Accounts

A common question from security auditors is why agent tokens contain a `FullAccess` key:

### Why NEAR Protocol Requires FullAccess for Betting
In NEAR Protocol's consensus layer (`nearcore`), access keys have two permission levels:
1. `FullAccess`: Can sign any transaction action, including function calls with attached yoctoNEAR deposits.
2. `FunctionCall`: Restricted to specific contracts and methods. **However, NEAR Protocol strictly prohibits FunctionCall keys from attaching any nonzero deposit (`attachedDeposit > 0`)**. If a FunctionCall key calls `deploy` with a 0.01 NEAR stake, the transaction is rejected by the NEAR validator with:
   ```text
   InvalidAccessKeyError::DepositWithFunctionCall
   ```

Because placing an AMSTR game bet inherently requires depositing tokens (the stake + 0.01 NEAR refundable storage deposit), any key calling `deploy` must possess deposit permissions.

### How AMSTR Protects User Wallets (Bankroll Isolation)
Rather than asking users to add keys to their personal/main wallet (e.g. `alice.near` holding savings), AMSTR creates **Dedicated Implicit Accounts** (64-character hex addresses derived from the agent's keypair, e.g. `e53f…d89b`):
- **100% Bankroll Isolation**: The agent only has access to the dedicated account. It has zero access to the user's personal wallet.
- **Strictly Capped Risk**: If a user funds the agent account with `0.1 NEAR`, the theoretical maximum risk under any circumstance is strictly capped at `0.1 NEAR`.
- **Application-Layer MCP Policy**: The AMSTR MCP server additionally enforces application-level safeguards (`maxBetNear: 0.5`, allowed methods: `["deploy", "claim", "reclaim_storage", "refund_expired"]`) before broadcasting any transaction.

---

## 💎 Tokenomics & Economic Flywheel

AMSTR is designed with a sustainable, deflationary economic model:

```
Total Round Pot (Gross Stake)
  ├── 90% -> Net Prize Pot (Distributed to winning players)
  └── 10% -> Protocol Fee
        ├── 6.0% -> Automated Treasury Buyback & Token Burn 🔥
        ├── 2.0% -> Multi-Tier Jackpots (Shard, Vein, Core) 🎁
        ├── 1.0% -> Protocol Treasury Operations 🏛️
        └── 1.0% -> Referrer Commission (Free bonus for inviter) 🤝
```

### 1. Automated Buyback & Burn
Every round, 6% of the pot fee is automatically routed to `treasury.amstr-admin-zxlhcx.testnet`. The contract purchases AMSTR tokens:
- **90% is permanently burned** via `ft_burn` (reducing total circulating supply forever).
- **10% is distributed to AMSTR stakers** in the staking pool as yield.

### 2. Multi-Tier Jackpots
Every round has a chance to trigger massive jackpot payouts:
- **Shard Jackpot (1:300 odds)**: Cap of 200 NEAR / 5,000 AMSTR.
- **Vein Jackpot (1:1,000 odds)**: Cap of 1,000 NEAR / 20,000 AMSTR.
- **Core Jackpot (1:3,000 odds)**: Cap of 5,000 NEAR / 100,000 AMSTR.

### 3. Wildcat Bonus Rounds (Every 25 Rounds)
Every 25th round (`#25, #50, #75, #100...`), a special **Wildcat Round** triggers. One lucky winner chosen by stake weight receives an extra **60% bonus** in AMSTR tokens!

### 4. Zero-Cost 1% Referral Program
When a user specifies a referrer during bet deployment (`bind_referrer`), the referrer automatically earns **1% of all gross stakes**. This 1% comes directly out of the protocol's treasury fee — it costs the player $0 extra.

---

## 🛡 Hardware Attestation & Intel TDX Verification

AMSTR does not rely on "trusted servers". It runs in a certified **Intel Trust Domain Extensions (Intel TDX)** enclave on **Phala Cloud**:

- **CVM ID**: `10d1a977-f439-4128-8a73-f173594d6e45`
- **DCAP Attestation Status**: **`UpToDate`** (Highest security tier, verified against Intel Provisioning Certification Service).
- **Measurement Binding**:
  - `RTMR3`: `68c94c9c7afec0e3fd3f47a35e4ee1f2e3c5c2a13d8deefce09da1b51158f9bd`
  - `MRCONFIGID`: `018eb74789bcf4a2980751c13e5fb3ee658b23ebdb65d6dfe45e5f24d4691a1587`
  - `REPORTDATA`: Cryptographically bound to the CVM's Ed25519 signing key and X25519 encryption key.

You can inspect the full hardware attestation report anytime via the web app's **Attestation Drawer** or by querying:
```bash
curl https://2dba4d4f68ab082e126801c1271d5fbc1abff3bd-3000.dstack-pha-prod5.phala.network/attestation
```

---

## 📁 Repository Structure

```text
amstr/
├── contracts/                  # Rust Smart Contracts (NEAR SDK 5.x)
│   ├── amstr-game/             # Core 5x5 mine game engine & provable fairness logic
│   ├── amstr-token/            # NEP-141 fungible token with programmatic burning
│   ├── amstr-treasury/         # Automated buyback, burn, and fee distribution
│   ├── amstr-staking/          # AMSTR staking rewards & pool management
│   └── integration-tests/      # End-to-end sandbox tests
├── cvm/                        # Phala Intel TDX CVM Service (TypeScript)
│   ├── src/
│   │   ├── autonomous-runner.ts# Production keeper daemon (atomic settle + open)
│   │   ├── decrypt.ts          # TweetNaCl hardware unsealing & commit verification
│   │   ├── keys.ts             # Ephemeral hardware key management
│   │   └── index.ts            # Fastify REST API for attestation and health
│   └── dcap-verification-result.json # Intel PCS DCAP verification certificate
├── web/                        # React Frontend (Vite + Tailwind CSS + Lucide)
│   ├── src/
│   │   ├── components/         # MineGrid (5x5), BetSlip, RoundPanel, WinnersStrip
│   │   ├── crypto/             # Client-side pick encryption & fairness math
│   │   ├── pages/              # Play, Rounds (History), Proof (Trust Center), Stake
│   │   └── services/           # NEAR RPC client & Wallet Selector integration
└── scripts/                    # Automation, test scenarios, & verification tools
    ├── verify-fairness.mjs     # Standalone 1-line provable fairness verifier
    └── set-deposit-window.mjs  # On-chain parameter configuration tool
```

---

## 🧪 Comprehensive Test Suite

AMSTR maintains rigorous test coverage across both smart contracts and hardware enclave code:

### Run Rust Contract Tests (53 tests)
```bash
cargo test --manifest-path contracts/Cargo.toml
```
*Result: 53 passed, 0 failed, 100% passing.*

### Run Enclave & Encryption Tests (32 tests)
```bash
cd cvm
npm test
```
*Result: 32 passed, 0 failed, 100% passing.*

### Run Web Client & Fairness Tests (14 tests)
```bash
cd web
npm ci
npm test
```
*Result: 14 passed, 0 failed, 100% passing.*

---

## 🔒 Security & Non-Custodial Safety Guarantees

1. **No Access to User Private Keys**: AMSTR never touches or stores player wallet private keys. All transactions are signed directly via standard NEAR Wallet Selector wallets.
2. **Crash & Reboot Protection**: The Intel TDX enclave generates ephemeral keys in volatile memory. If the enclave reboots, it strictly refuses to forge an unverified seed. The smart contract automatically protects player funds via the 100% timeout refund path.
3. **Decentralized Mainnet Roadmap**: Full-access keys on testnet contracts will be permanently revoked (`DeleteKey`) upon mainnet deployment, transferring parameter governance to a community multi-sig (Sputnik-DAO).

---

## 📄 License

This project is licensed under the **MIT License** — see the [LICENSE](LICENSE) file for details. Built for the NEAR & Phala Ecosystem.
