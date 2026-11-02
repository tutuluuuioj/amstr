# AMSTR Phala CVM Service (TEE Confidential Worker)

The AMSTR Phala CVM (Confidential Virtual Machine) service runs inside an Intel TDX hardware-enclave powered by Phala Network and the NEAR Shade Agent architecture. It guarantees hardware-isolated confidential off-chain game state resolution, provable random seed pre-commitment, encrypted pick processing, and tamper-proof settlement for the AMSTR mining protocol.

---

## 🔒 Security Architecture & Guarantees

### 1. Volatile Key Management (Requirement 1)
- On boot, the CVM derives ephemeral `Ed25519` (signing) and `X25519` (Diffie-Hellman box encryption) keypairs strictly in volatile enclave RAM.
- Private keys never touch non-volatile storage, are never logged, and are strictly redacted with `[REDACTED_IN_TEE]` in serialization (`toJSON()` and `toString()`).

### 2. Intel TDX Remote Attestation & App Measurement (Requirement 2)
- **The True Code Hash**: Unlike naive implementations where `code_hash = sha256(quote)` (which changes dynamically every time due to ECDSA signature entropy and timestamps), the AMSTR CVM uses the **deterministic application measurement**: the SHA-256 hash of the Docker Compose manifest (`cvm/docker-compose.yml`), which Phala Cloud / dstack extends into **RTMR3**:
  ```
  App Compose Measurement (RTMR3): fda64d1a00c036088cbe265d36378ccc736f453e6e568d7cfdcdb1f9528ce621
  ```
- **Cryptographic Key Binding**: The TDX quote's 64-byte `report_data` slot strictly binds both in-enclave public keys:
  $$\text{report\_data} = \text{SHA-256}(\text{ed25519\_pub\_raw\_32} \,||\, \text{x25519\_pub\_raw\_32})$$
- **Who Verifies the Attestation?**
  - **On-Chain Verification in `register_cvm`**: The NEAR smart contract extracts the application measurement (`code_hash` from the RTMR3 slot) and verifies that it is present in `approved_code_hashes`. It also verifies that the quote's `report_data` matches `sha256(pubkey || x25519_pub)`.
  - **Intel Root CA & TCB Collateral**: Full cryptographic validation of Intel's PCK certificate chain and Quoting Enclave CRLs is verified off-chain prior to code approval. On-chain Intel DCAP verification is not implemented inside `amstr-game` because Intel certificate chain validation requires megabytes of memory and exceeds NEAR single-transaction gas limits. The contract safely enforces integrity via the owner/governance approved code hash whitelist.
- **Mock Attestation Ban in Production**:
  - The CVM service checks `process.env.NODE_ENV`. If set to `"production"`, it **refuses to run** in simulator mode and throws a fatal security exception if `/dev/tdx_guest` or `/var/run/tappd.sock` is absent.
  - The `amstr-game` contract verifies the quote header: quotes prefixed with `AMSTR_MOCK_TDX_` are strictly rejected unless `config.allow_mock_cvm == true` (which is `false` by default in production). A normal rogue server cannot spoof the CVM.

### 3. Pre-Committed Seed Draw Mechanism (Requirement 3)
- Before opening each round, the CVM generates a cryptographically secure 32-byte seed in volatile RAM and posts its hash `sha256(seed)` on-chain via `open_round(seed_commit)`.
- After the round closes, the CVM reveals `seed` and an Ed25519 detached signature on `(round_id_le_bytes [8B] || seed [32B])`. The contract verifies the seed against the pre-commit and signature.

### 4. Post-Close Decryption & Commit Verification (Requirement 4)
- Players encrypt their pick `(mask, salt)` directly to the CVM's public key using TweetNaCl box (X25519 + XSalsa20Poly1305).
- The CVM only decrypts picks after the deposit window closes and `close_round()` locks the chain entropy.
- For every entry, the CVM computes `derived_commit = sha256(len(account_id) || account_id || round_id || mask || salt)` and compares it against the on-chain commit. If tampered or invalid, `is_valid: false` is reported and the contract refunds the player's net stake minus fee on claim. A mismatched pick is **never revealed**.

### 5. Crash Safety & Idempotent Timeout Recovery (Requirement 5)
- If the CVM crashes or restarts, volatile in-memory seeds are wiped.
- The CVM refuses to forge or reveal an altered seed. If a round cannot be settled, the protocol's permissionless `refund_expired(round_id, limit)` allows players to claim a 100% full refund after the timeout window (10 minutes / 600 blocks).

### 6. Resilient Multi-Provider RPC (Requirement 6)
- Connects to at least two distinct NEAR RPC endpoints.
- Automatically detects HTTP 429 rate limits, HTTP 5xx errors, and JSON-RPC body-level rate limits.
- Performs instant endpoint rotation with exponential backoff and randomized jitter.

---

## 🌐 HTTP REST API Endpoints

| Endpoint | Method | Description |
|---|---|---|
| `/health` | `GET` | Health check, uptime, active contract ID, and hardware TDX status. |
| `/attestation` | `GET` | Serves Intel TDX quote bytes, code hash (RTMR3 compose measurement), public keys, and report data for on-chain/frontend Proof verification. |
| `/keys` | `GET` | Serves `ed25519_pub` and `x25519_pub` for client-side pick encryption. |

---

## 🛠️ Testing & Building

```bash
# Typecheck and build TypeScript
npm run build

# Run comprehensive test suite (30 tests across 6 suites)
npm test

# Run local development daemon
npm run dev
```

## 🐳 Docker & Phala Cloud Deployment

```bash
# Build multi-stage production container
docker build -t amstr-cvm:latest .

# Run with Docker Compose
docker compose up -d
```
