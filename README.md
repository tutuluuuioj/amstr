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
    A["1. Pick Tiles<br/>(Client-side Encrypted)"] --> B["2. 5-Min Deposit Window<br/>(Pot grows on NEAR)"]
    B --> C["3. Hardware Draw<br/>(Intel TDX unseals & draws)"]
    C --> D["4. Winner Celebration<br/>(14s reveal & claim payouts)"]
```

1. **Step 1: Pick & Stake (5-Minute Window)**
   - Open the web app and connect your NEAR wallet (MyNearWallet, Meteor, Here, etc.).
   - Select between **1 and 25 tiles** on the board.
   - Choose your stake (e.g. `0.1 NEAR`, `0.5 NEAR`, `1.0 NEAR`).
   - Your browser encrypts your picks and submits the transaction to the NEAR smart contract.
2. **Step 2: Betting Closes & Entropy Locks**
   - When the 5-minute deposit window ends (~300 blocks on NEAR), no more bets are accepted.
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

Every single round played on AMSTR is 100% verifiable by anyone in the world without trusting our frontend or server.

### Method 1: One-Click Verification in the Web App
1. Go to the **Rounds** tab in the web app.
2. Click **Verify Fairness** next to any settled round.
3. The app fetches the on-chain pre-commitment, reveals the hardware seed, combines it with the block entropy, and verifies the math live in your browser.

### Method 2: Verification via Terminal CLI
Run the standalone verification script with zero dependencies:
```bash
# Verify any round (e.g. Round 2, Round 191, Round 196)
node scripts/verify-fairness.mjs 2
```

#### What the Verification Proves:
```text
==================================================
   AMSTR Provable Fairness Verification: Round 2
==================================================
[1/3] Fetching on-chain state from game.amstr-admin-zxlhcx.testnet...
  Status: Settled | Winning Tile: 22

[2/3] Retrieving revealed seed and block entropy from 'round_settled' event...
  - Revealed Seed : PzJSSdIth8OFKrltm2TkBbSMbW8tksPMMzKY+sn8PXE=
  - Chain Entropy : at6Zb7h4sDB8otGIOepUC6rmc3/tIf1Azzk5FHtlj4A=

[3/3] Executing Cryptographic Proof...
  A) Seed Pre-Commitment Check:
     SHA-256(Revealed Seed) == On-Chain Pre-Commitment? -> ✅ VALID
  B) Winning Tile Calculation:
     u64_le(SHA-256(seed || entropy)[0..8]) % 25 == 22? -> ✅ PROVABLY FAIR

==================================================
  🎉 Cryptographic Fairness Proof: 100% VERIFIED!
==================================================
```

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
