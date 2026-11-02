# AMSTR Smart Contracts (Phase 1 — 100% Complete)

Decentralized settlement, token emission, buyback treasury, and staking contracts for the AMSTR mining game on NEAR Protocol (Rust `near-sdk 5.30.0`).

---

## 1. Workspace Packages Overview

| Package | WASM Binary | Size | Unit & Invariant Tests | Description |
| :--- | :--- | :--- | :---: | :--- |
| `amstr-game` | `amstr_game.wasm` | 628 KB | 20 tests | Parimutuel round engine, commit-reveal, ed25519 CVM verification, 256-bit safe math, Wildcat 60% selection, Shard/Vein/Core jackpots, 1% referrals, invalid pick refunds, storage reclaims, 500-round Monte Carlo invariants, 200-player stress invariants, timeout refunds, and multi-round lifecycle simulations. |
| `amstr-token` | `amstr_token.wasm` | 296 KB | 6 tests | NEP-141 Fungible Token with restricted game minting, `ft_burn`, NEP-145 storage, and lifetime 2,000,000 AMSTR hard cap (burned tokens do not replenish cap). |
| `amstr-treasury` | `amstr_treasury.wasm` | 251 KB | 5 tests | Buyback vault collecting 6% fee share, simulated oracle, 90% burn / 10% staking yield split, `fund_jackpot()`, and 30-day rate-limited dev withdrawals. |
| `amstr-staking` | `amstr_staking.wasm` | 262 KB | 5 tests | Zero lock-up staking contract using an $O(1)$ global reward-per-token accumulator (`SCALE_FACTOR = 10^24`) for proportional distribution of buyback yield. |

---

## 2. Commit Byte Layout Specification

To prevent delimiter collisions and ambiguity across different programming languages and client SDKs, the commit hash is computed using a length-prefixed encoding:

$$\text{commit} = \text{SHA-256}(\text{len}(\text{account\_id})_{\text{u32-le}} \,||\, \text{account\_id}_{\text{utf8}} \,||\, \text{round\_id}_{\text{u64-le}} \,||\, \text{mask}_{\text{u32-le}} \,||\, \text{salt}_{\text{32-bytes}})$$

### Byte Layout Table

| Field | Type | Encoding | Size (Bytes) | Description |
| :--- | :--- | :--- | :---: | :--- |
| `account_len` | `u32` | Little-Endian unsigned integer | 4 | Byte length of UTF-8 encoded `account_id` string |
| `account_id` | `String` | UTF-8 bytes | $L$ | NEAR account identifier (e.g., `alice.near`) |
| `round_id` | `u64` | Little-Endian unsigned integer | 8 | Target round ID |
| `mask` | `u32` | Little-Endian bitmask | 4 | 25-bit tile selection mask ($0 \le \text{tile} < 25$) |
| `salt` | `[u8; 32]` | Raw byte array | 32 | Cryptographically secure 256-bit random salt |

**Total Pre-Image Size:** $4 + L + 8 + 4 + 32 = (48 + L)\text{ bytes}$.

### Frontend TypeScript Implementation

```typescript
import { sha256 } from "@noble/hashes/sha256";

export function computeCommit(
  accountId: string,
  roundId: bigint,
  mask: number,
  salt: Uint8Array // length 32
): Uint8Array {
  const accountBytes = new TextEncoder().encode(accountId);
  const buffer = new ArrayBuffer(4 + accountBytes.length + 8 + 4 + 32);
  const view = new DataView(buffer);

  let offset = 0;

  // 1. Account ID length prefix (u32 LE)
  view.setUint32(offset, accountBytes.length, true);
  offset += 4;

  // 2. Account ID UTF-8 bytes
  new Uint8Array(buffer, offset, accountBytes.length).set(accountBytes);
  offset += accountBytes.length;

  // 3. Round ID (u64 LE)
  view.setBigUint64(offset, roundId, true);
  offset += 8;

  // 4. Tile mask (u32 LE)
  view.setUint32(offset, mask, true);
  offset += 4;

  // 5. Salt (32 bytes)
  new Uint8Array(buffer, offset, 32).set(salt);

  return sha256(new Uint8Array(buffer));
}
```

---

## 3. Treasury Withdrawal Power & Dynamic 10% Rate-Limiting

The `amstr-treasury` contract enforces strict percentage-based rate-limiting on developer and operational withdrawals to protect community and protocol funds against key compromise or malicious drain.

- **Authorized Caller:** Contract Owner only (`assert_owner`).
- **Dynamic 10% Withdrawal Cap:** Capped at **10.00%** (`1000` basis points) of total treasury funds per rolling 30-day window (`dev_withdrawal_cap_bps`).
- **Hard Ceiling on Governance:** `set_dev_withdrawal_cap_bps(bps)` enforces `assert!(bps <= 1000)`: even the contract owner cannot set the rate-limit cap higher than 10%.
- **30-Day Window Mechanics:**
  - Time tracking is based on NEAR block timestamp (`env::block_timestamp()` in nanoseconds).
  - 30-day duration: $30 \times 24 \times 3600 \times 10^9\text{ ns} = 2,592,000,000,000,000\text{ ns}$.
  - If `block_timestamp >= current_window_start + THIRTY_DAYS_NS`, the window resets:
    - `withdrawn_in_current_window = 0`
    - `current_window_start = block_timestamp`
  - Max allowance in the current window is dynamically computed:
    $$\text{max\_allowed} = \frac{(\text{balance} + \text{withdrawn\_in\_window}) \times \text{dev\_withdrawal\_cap\_bps}}{10,000}$$
  - Any call to `withdraw_dev(recipient, amount)` that causes `withdrawn_in_window + amount > max_allowed` will panic immediately with:
    `"Exceeds 30-day withdrawal cap (10% of treasury balance)"`.

---

## 4. Contract Admin & Owner Method Inventory

### 1. `amstr-game`
| Method | Access | Parameters | Description |
| :--- | :---: | :--- | :--- |
| `pause()` | Owner | None | Halts player deposits (`deploy`) and round openings. |
| `unpause()` | Owner | None | Resumes normal game operations. |
| `set_config(config)` | Owner | `config: Config` | Updates fee bps, buyback bps, jackpot bps, min/max stake, carryover cap, and timeouts. |
| `approve_code_hash(code_hash)`| Owner | `code_hash: String` | Approves a Phala TDX enclave build digest (the deterministic Docker compose / RTMR3 app measurement) for CVM key registration. |
| `revoke_code_hash(code_hash)` | Owner | `code_hash: String` | Revokes an enclave build digest. |
| `register_cvm(...)` | Owner or Approved CVM | `pubkey, x25519_pub, quote` | Registers active ed25519 and X25519 keys for the autonomous CVM agent. Verifies that the quote's `report_data` cryptographically binds the keys, and that the app measurement (`code_hash` from RTMR3 slot) is in `approved_code_hashes`. Mock quotes are strictly rejected unless `allow_mock_cvm == true`. |
| `open_round(seed_commit)` | Owner or CVM | `seed_commit: Base64VecU8` | Initializes next round with committed 32-byte seed hash. |
| `close_round(round_id)` | **Permissionless** (Anyone) | `round_id: u64` | Closes deposit window, captures `env::random_seed()` as `chain_entropy`, transitions round to `Revealing`. Fully decouples randomness timing from CVM reveals. |
| `reveal_batch(round_id, reveals)` | Owner or CVM | `round_id: u64, reveals: Vec<RevealItem>` | Submits decrypted player choices. Requires round to be closed; cannot modify or influence `chain_entropy`. |
| `settle(round_id, seed, sig)` | Owner or CVM | `round_id, seed, sig` | Settles round, verifies ed25519 signature on `(round_id \|\| seed)`, distributes payouts. |

### 2. `amstr-token`
| Method | Access | Parameters | Description |
| :--- | :---: | :--- | :--- |
| `set_game_contract(game_id)` | Owner | `game_id: AccountId` | Designates the active game engine contract authorized to call `mint()`. |
| `mint(account_id, amount)` | Game Only | `account_id, amount` | Mints newly emitted AMSTR tokens up to lifetime 2M cap. |
| `ft_burn(amount)` | Holder | `amount: U128` | Burns tokens held by caller (lifetime minted counter remains unchanged). |

### 3. `amstr-treasury`
| Method | Access | Parameters | Description |
| :--- | :---: | :--- | :--- |
| `set_oracle_price(price)` | Owner | `price_yocto_near_per_amstr: U128` | Updates AMSTR/NEAR valuation for testnet buyback execution. |
| `set_dev_withdrawal_cap_bps(bps)` | Owner | `cap_bps: u16` | Modifies 30-day percentage withdrawal cap (strictly $\le 10\%$). |
| `set_staking_id(staking_id)` | Owner | `staking_id: AccountId` | Updates staking contract address. |
| `set_game_id(game_id)` | Owner | `game_id: AccountId` | Updates game contract address. |
| `withdraw_dev(recipient, amount)` | Owner | `recipient, amount` | Withdraws NEAR subject to the dynamic 10% rolling cap. |
| `run_buyback(near_amount)` | Owner | `near_amount: NearToken` | Executes token buyback (90% burned, 10% sent to staking contract). |
| `fund_jackpot(amount)` | Owner | `amount: NearToken` | Seeds jackpot pools with NEAR. |

### 4. `amstr-staking`
- **Permissionless Architecture:** Contains **zero** admin backdoor methods.
- Staking is initiated purely via NEP-141 `ft_on_transfer` with `msg = "stake"`.
- Yield rewards are injected via NEP-141 `ft_on_transfer` with `msg = "reward"`.
- Any user can call `unstake(amount)` or `claim_rewards()` at any time without locks or fees.

---

### Attestation Verification & Shade Agent Architecture
1. **Deterministic App Measurement**:
   The smart contract does not use non-deterministic whole-quote hashing (`sha256(quote)` changes on every quote generation). Instead, it verifies the **application measurement** (the deterministic Docker Compose hash of the CVM build, stored in the RTMR3 slot of the Intel TDX report).
2. **On-Chain Key Binding**:
   The contract parses the TDX quote's `report_data` slot and verifies that it cryptographically binds both ephemeral in-enclave public keys: `sha256(ed25519_pub || x25519_pub)`.
3. **Intel DCAP Off-Chain Boundary**:
   The smart contract enforces the measurement whitelist and key binding. Full Intel PCK certificate chain and Quoting Enclave CRL validation is audited off-chain prior to code hash approval, as full Intel Root CA verification on-chain exceeds single-transaction gas limits on NEAR.
4. **Mock Quote Ban in Production**:
   Quotes bearing the `AMSTR_MOCK_TDX_` simulation header are rejected by `register_cvm` unless `config.allow_mock_cvm == true` (which is `false` by default in production). Normal servers cannot register as a CVM.

---

## 5. Test Suite Summary (42 Tests Total)

Run the entire test suite across all 4 contracts:
```bash
cd contracts
cargo test
```

### Verified Test Cases:
- **`amstr-game` (16 unit tests + 6 invariant & simulation tests = 22 tests):**
  - Parimutuel proportional payout math and yocto-rounding conservation.
  - Token emission halving and saturating curve $E(V)$.
  - Commit verification with length prefix.
  - Stake-weighted Wildcat single winner selection.
  - Shard, Vein, Core jackpot trigger probability and caps.
  - CVM code hash whitelist enforcement.
  - Unauthorized caller & invalid signer public key rejection.
  - **Randomness Timing Immutability**: `close_round` locks `chain_entropy` upon deposit window closure; `reveal_batch` rejects calls before round close and cannot alter `chain_entropy`.
  - 10-minute timeout recovery and batched player refunds.
  - 500-round randomized Monte Carlo funds conservation.
  - Single-player win and single-player rollover invariant.
  - 200-player maximum capacity invariant under arbitrary masks.
  - Exact tie splits conservation.
  - Refunded rounds zero-loss conservation.
  - 4-round full state machine simulation.
- **`amstr-token` (6 tests):**
  - NEP-141 metadata & NEP-145 storage deposits.
  - Mint restricted strictly to authorized game contract.
  - 2,000,000 AMSTR lifetime hard cap enforcement.
  - Proof that burning circulating tokens does not free room under hard cap.
- **`amstr-treasury` (6 tests):**
  - 6% game fee deposit vaulting.
  - 90% burn and 10% staking yield buyback execution.
  - Dynamic 10% treasury balance rate-limited dev withdrawals.
  - Attempting to withdraw $> 10\%$ panics.
  - Owner cannot raise cap above 10% (`test_owner_cannot_set_cap_above_10_percent_panics`).
  - Window expiration and cap reset.
- **`amstr-staking` (5 tests):**
  - Proportional zero lock-up staking rewards.
  - Complex multi-staker interleaved stake/unstake/reward sequences.
  - Zero-sum invariant across staker claim balances.
- **`integration-tests` (1 near-workspaces sandbox test):**
  - Live NEAR sandbox multi-contract deployment and multi-round lifecycle test.
cargo test
```

### Verified Test Cases:
- **`amstr-game` (14 unit tests + 6 invariant & simulation tests = 20 tests):**
  - Parimutuel proportional payout math and yocto-rounding conservation.
  - Token emission halving and saturating curve $E(V)$.
  - Commit verification with length prefix.
  - Stake-weighted Wildcat single winner selection.
  - Shard, Vein, Core jackpot trigger probability and caps.
  - CVM code hash whitelist enforcement.
  - Unauthorized caller & invalid signer public key rejection.
  - Chain entropy immutability after round closing.
  - 10-minute timeout recovery and batched player refunds.
  - 500-round randomized Monte Carlo funds conservation.
  - Single-player win and single-player rollover invariant.
  - 200-player maximum capacity invariant under arbitrary masks.
  - Exact tie splits conservation.
  - Refunded rounds zero-loss conservation.
  - 4-round full state machine simulation.
- **`amstr-token` (6 tests):**
  - NEP-141 metadata & NEP-145 storage deposits.
  - Mint restricted strictly to authorized game contract.
  - 2,000,000 AMSTR lifetime hard cap enforcement.
  - Proof that burning circulating tokens does not free room under hard cap.
- **`amstr-treasury` (5 tests):**
  - 6% game fee deposit vaulting.
  - 90% burn and 10% staking yield buyback execution.
  - 30-day dev withdrawal rolling cap enforcement.
  - Window expiration and cap reset.
- **`amstr-staking` (5 tests):**
  - Proportional zero lock-up staking rewards.
  - Complex multi-staker interleaved stake/unstake/reward sequences.
  - Zero-sum invariant across staker claim balances.
