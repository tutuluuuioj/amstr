use near_sdk::json_types::{Base64VecU8, U128};
use near_sdk::store::{IterableSet, LookupMap};
use near_sdk::{
    env, near, AccountId, Gas, NearToken, PanicOnDefault, Promise, PublicKey,
};
use sha2::{Digest, Sha256};

pub mod events;
pub mod payouts;
pub mod types;

use events::*;
use payouts::*;
use types::*;

pub const GAS_FOR_FT_MINT: Gas = Gas::from_tgas(20);
pub const GAS_FOR_FT_TRANSFER: Gas = Gas::from_tgas(20);
pub const GAS_FOR_TREASURY_DEPOSIT: Gas = Gas::from_tgas(20);
pub const STORAGE_DEPOSIT_ENTRY: NearToken = NearToken::from_millinear(10); // 0.01 NEAR for entry storage

#[near(serializers = [borsh])]
pub struct OldConfig {
    pub fee_bps: u16,
    pub buyback_bps: u16,
    pub jackpot_bps: u16,
    pub treasury_bps: u16,
    pub referral_bps: u16,
    pub min_stake: NearToken,
    pub max_stake: NearToken,
    pub max_players: u32,
    pub deposit_window_blocks: u64,
    pub refund_timeout_blocks: u64,
    pub carryover_cap: NearToken,
    pub paused: bool,
    pub allow_mock_cvm: bool,
}

#[near(serializers = [borsh])]
pub struct OldContract {
    pub owner_id: AccountId,
    pub token_id: AccountId,
    pub treasury_id: AccountId,
    pub active_cvm: Option<CvmKey>,
    pub approved_code_hashes: IterableSet<String>,
    pub config: OldConfig,
    pub next_round_id: u64,
    pub rounds: LookupMap<u64, Round>,
    pub entries: LookupMap<(u64, AccountId), Entry>,
    pub round_players: LookupMap<u64, Vec<AccountId>>,
    pub referrals: LookupMap<AccountId, AccountId>,
    pub referral_balances: LookupMap<AccountId, u128>,
    pub carryover_pool: u128,
    pub jackpot_pools: Vec<JackpotPool>,
}

#[near(contract_state)]
#[derive(PanicOnDefault)]
pub struct Contract {
    pub owner_id: AccountId,
    pub token_id: AccountId,
    pub treasury_id: AccountId,
    pub active_cvm: Option<CvmKey>,
    pub approved_code_hashes: IterableSet<String>,
    pub config: Config,

    pub next_round_id: u64,
    pub rounds: LookupMap<u64, Round>,
    pub entries: LookupMap<(u64, AccountId), Entry>,
    pub round_players: LookupMap<u64, Vec<AccountId>>,
    pub referrals: LookupMap<AccountId, AccountId>,
    pub referral_balances: LookupMap<AccountId, u128>,

    // Financial pools
    pub carryover_pool: u128,
    pub jackpot_pools: Vec<JackpotPool>,
}

#[near]
impl Contract {
    #[init]
    pub fn new(
        owner_id: AccountId,
        token_id: AccountId,
        treasury_id: AccountId,
        config: Option<Config>,
    ) -> Self {
        assert!(!env::state_exists(), "Already initialized");
        let conf = config.unwrap_or_default();

        let jackpots = vec![
            JackpotPool {
                near_balance: 0,
                amstr_balance: 0,
                cap_near: 200 * 10u128.pow(24),
                cap_amstr: 5_000 * 10u128.pow(18),
                odds: 300,
            },
            JackpotPool {
                near_balance: 0,
                amstr_balance: 0,
                cap_near: 1_000 * 10u128.pow(24),
                cap_amstr: 20_000 * 10u128.pow(18),
                odds: 1_000,
            },
            JackpotPool {
                near_balance: 0,
                amstr_balance: 0,
                cap_near: 5_000 * 10u128.pow(24),
                cap_amstr: 100_000 * 10u128.pow(18),
                odds: 3_000,
            },
        ];

        Self {
            owner_id,
            token_id,
            treasury_id,
            active_cvm: None,
            approved_code_hashes: IterableSet::new(b"h"),
            config: conf,
            next_round_id: 1,
            rounds: LookupMap::new(b"r"),
            entries: LookupMap::new(b"e"),
            round_players: LookupMap::new(b"p"),
            referrals: LookupMap::new(b"f"),
            referral_balances: LookupMap::new(b"b"),
            carryover_pool: 0,
            jackpot_pools: jackpots,
        }
    }

    // --- CVM KEY & ATTESTATION MANAGEMENT ---

    pub fn approve_code_hash(&mut self, hash: String) {
        self.assert_owner();
        self.approved_code_hashes.insert(hash);
    }

    pub fn revoke_code_hash(&mut self, hash: String) {
        self.assert_owner();
        self.approved_code_hashes.remove(&hash);
    }

    /// Registers active CVM keys on the smart contract (Owner Only).
    ///
    /// Security & Verification Architecture:
    /// 1. **Intel Signature Limitation**: The smart contract does NOT perform on-chain
    ///    ECDSA verification of Intel's Root CA / Quoting Enclave signature (as on-chain
    ///    Intel DCAP verification exceeds practical NEAR gas limits). Because an attacker
    ///    could otherwise submit a synthetic quote with the public RTMR3 hash and their own keys,
    ///    `register_cvm` is strictly restricted to the contract owner (`self.assert_owner()`).
    /// 2. **Owner Off-Chain Verification**: The owner performs off-chain Intel DCAP quote
    ///    verification (checking PCK Collateral and TCB status), then submits the verified keys.
    /// 3. **On-Chain App Measurement Check**: Validates that the app measurement (`code_hash`
    ///    extracted from RTMR3) is present in `approved_code_hashes`.
    /// 4. **Key Binding**: Asserts that the quote's `report_data` binds `sha256(ed25519_pub || x25519_pub)`.
    /// 5. **Mock Ban in Production**: Rejects mock simulation quotes unless `allow_mock_cvm == true`.
    pub fn register_cvm(
        &mut self,
        pubkey: PublicKey,
        x25519_pub: Base64VecU8,
        quote: Base64VecU8,
    ) {
        self.assert_owner();
        assert!(quote.0.len() >= 64, "Invalid TDX quote length");

        let is_mock = quote.0.starts_with(b"AMSTR_MOCK_TDX_");
        if is_mock {
            assert!(
                self.config.allow_mock_cvm,
                "Mock CVM attestation is strictly disabled in production"
            );
        }

        let mut x25519_bytes = [0u8; 32];
        assert_eq!(x25519_pub.0.len(), 32, "Invalid X25519 key length");
        x25519_bytes.copy_from_slice(&x25519_pub.0);

        // Derive expected report_data = sha256(ed25519_raw_pub_32 || x25519_pub_32)
        let pk_bytes = pubkey.as_bytes();
        assert_eq!(pk_bytes[0], 0, "Only ed25519 CVM keys supported");
        let mut report_hasher = Sha256::new();
        report_hasher.update(&pk_bytes[1..33]);
        report_hasher.update(&x25519_bytes);
        let expected_report_data: [u8; 32] = report_hasher.finalize().into();

        let code_hash: String;
        if is_mock {
            assert!(quote.0.len() >= 96, "Invalid mock TDX quote structure");
            let quote_report_data = &quote.0[64..96];
            assert_eq!(
                quote_report_data,
                &expected_report_data[..],
                "TDX quote report_data does not bind registered CVM public keys"
            );
            code_hash = hex::encode(&quote.0[32..64]);
        } else {
            // Hardware Intel TDX Quote (format v4/v5, len >= 632)
            assert!(quote.0.len() >= 632, "Invalid hardware TDX quote length");
            let quote_report_data = &quote.0[568..600];
            assert_eq!(
                quote_report_data,
                &expected_report_data[..],
                "TDX quote report_data does not bind registered CVM public keys"
            );
            // RTMR3 app measurement slot at bytes 520..552 (32 bytes)
            code_hash = hex::encode(&quote.0[520..552]);
        }

        assert!(
            self.approved_code_hashes.contains(&code_hash),
            "CVM code hash not approved"
        );

        let cvm = CvmKey {
            pubkey: pubkey.clone(),
            x25519_pub: x25519_bytes,
            code_hash: code_hash.clone(),
            registered_at: env::block_height(),
        };

        self.active_cvm = Some(cvm);
        emit_event(
            "cvm_registered",
            &CvmRegisteredEvent {
                pubkey: String::from(&pubkey),
                code_hash,
            },
        );
    }

    // --- ROUND LIFECYCLE ---

    pub fn open_round(&mut self, seed_commit: Base64VecU8) -> u64 {
        self.assert_cvm_or_owner();
        assert!(!self.config.paused, "Contract is paused");
        assert_eq!(seed_commit.0.len(), 32, "Seed commit must be 32 bytes");

        let mut commit_bytes = [0u8; 32];
        commit_bytes.copy_from_slice(&seed_commit.0);

        let round_id = self.next_round_id;
        self.next_round_id += 1;

        let current_height = env::block_height();
        let close_height = current_height + self.config.deposit_window_blocks;

        let round = Round {
            round_id,
            status: RoundStatus::Open,
            open_height: current_height,
            close_height,
            settle_height: None,
            seed_commit: commit_bytes,
            chain_entropy: None,
            winning_tile: None,
            per_tile_totals: [0u128; 25],
            total_net: 0,
            total_gross: 0,
            entry_count: 0,
            revealed_count: 0,
            refund_cursor: 0,
            wildcat_winner: None,
            wildcat_amstr: 0,
            jackpot_shard_hit: false,
            jackpot_vein_hit: false,
            jackpot_core_hit: false,
            jackpot_near_won: 0,
            jackpot_amstr_won: 0,
        };

        self.rounds.insert(round_id, round);
        self.round_players.insert(round_id, Vec::new());

        emit_event(
            "round_opened",
            &RoundOpenedEvent {
                round_id,
                open_height: current_height,
                close_height,
                seed_commit,
            },
        );

        round_id
    }

    #[payable]
    pub fn deploy(
        &mut self,
        round_id: u64,
        ciphertext: Base64VecU8,
        commit: Base64VecU8,
    ) {
        assert!(!self.config.paused, "Contract is paused");
        let attached = env::attached_deposit();
        assert!(
            attached >= self.config.min_stake.saturating_add(STORAGE_DEPOSIT_ENTRY),
            "Deposit below min stake + storage"
        );
        let gross_stake = attached.saturating_sub(STORAGE_DEPOSIT_ENTRY);
        assert!(
            gross_stake <= self.config.max_stake,
            "Deposit exceeds max stake"
        );
        assert_eq!(commit.0.len(), 32, "Commit must be 32 bytes");

        let round = self.rounds.get_mut(&round_id).expect("Round not found");
        assert_eq!(round.status, RoundStatus::Open, "Round is not open");
        assert!(
            env::block_height() <= round.close_height,
            "Deposit window closed"
        );
        assert!(
            round.entry_count < self.config.max_players,
            "Max players per round reached"
        );

        let account_id = env::predecessor_account_id();
        let key = (round_id, account_id.clone());
        assert!(!self.entries.contains_key(&key), "Already entered round");

        let gross_yocto = gross_stake.as_yoctonear();
        let fee_yocto = (gross_yocto * (self.config.fee_bps as u128)) / 10_000;
        let net_yocto = gross_yocto - fee_yocto;

        // Route 1% referral reward from the treasury fee if user bound a referrer
        if let Some(referrer) = self.referrals.get(&account_id) {
            let ref_reward = (gross_yocto * (self.config.referral_bps as u128)) / 10_000;
            let current_bal = self.referral_balances.get(referrer).copied().unwrap_or(0);
            self.referral_balances.insert(referrer.clone(), current_bal + ref_reward);
        }

        let mut commit_bytes = [0u8; 32];
        commit_bytes.copy_from_slice(&commit.0);

        let entry = Entry {
            account_id: account_id.clone(),
            gross_stake: gross_yocto,
            net_stake: net_yocto,
            commit: commit_bytes,
            ciphertext: ciphertext.0,
            mask: None,
            salt: None,
            is_valid: true,
            claimed: false,
            refunded: false,
        };

        self.entries.insert(key, entry);
        if let Some(players) = self.round_players.get_mut(&round_id) {
            players.push(account_id.clone());
        }

        round.total_gross += gross_yocto;
        round.total_net += net_yocto;
        round.entry_count += 1;

        emit_event(
            "deployed",
            &DeployedEvent {
                round_id,
                account: account_id,
                gross_stake: U128(gross_yocto),
                fee: U128(fee_yocto),
                net_stake: U128(net_yocto),
                commit,
            },
        );
    }

    /// Closes deposit window for a round, locks `chain_entropy` from `env::random_seed()`,
    /// and transitions round status to `Revealing`.
    /// Permissionless: can be called by anyone (keeper, player, relayer, CVM) once `block_height > close_height`.
    pub fn close_round(&mut self, round_id: u64) {
        let round = self.rounds.get_mut(&round_id).expect("Round not found");
        assert_eq!(round.status, RoundStatus::Open, "Round is not open");
        assert!(
            env::block_height() > round.close_height,
            "Deposit window still open"
        );

        round.status = RoundStatus::Revealing;
        let seed_entropy = env::random_seed();
        let mut entropy = [0u8; 32];
        entropy.copy_from_slice(&seed_entropy[..32]);
        round.chain_entropy = Some(entropy);

        emit_event(
            "round_closed",
            &RoundClosedEvent {
                round_id,
                close_height: env::block_height(),
                chain_entropy: Base64VecU8(entropy.to_vec()),
            },
        );
    }

    pub fn reveal_batch(&mut self, round_id: u64, reveals: Vec<RevealItem>) {
        self.assert_cvm_or_owner();
        let round = self.rounds.get_mut(&round_id).expect("Round not found");
        assert_eq!(
            round.status,
            RoundStatus::Revealing,
            "Round must be closed before reveals can be submitted"
        );
        assert!(
            round.chain_entropy.is_some(),
            "Chain entropy must be locked at round close"
        );

        for item in reveals {
            let key = (round_id, item.account.clone());
            if let Some(entry) = self.entries.get_mut(&key) {
                if entry.mask.is_some() {
                    continue;
                }

                assert_eq!(item.salt.0.len(), 32, "Salt must be 32 bytes");
                let mut salt_bytes = [0u8; 32];
                salt_bytes.copy_from_slice(&item.salt.0);

                let is_valid_commit = verify_commit(
                    item.account.as_str(),
                    round_id,
                    item.mask,
                    &salt_bytes,
                    &entry.commit,
                );

                let active_tiles = (item.mask & 0x1FFFFFF).count_ones();

                if is_valid_commit && active_tiles > 0 && active_tiles <= 25 {
                    entry.mask = Some(item.mask);
                    entry.salt = Some(salt_bytes);
                    entry.is_valid = true;

                    let stake_per_tile = entry.net_stake / (active_tiles as u128);
                    for tile in 0..25 {
                        if (item.mask & (1 << tile)) != 0 {
                            round.per_tile_totals[tile] += stake_per_tile;
                        }
                    }
                } else {
                    entry.is_valid = false;
                }

                round.revealed_count += 1;
                emit_event(
                    "revealed",
                    &RevealedEvent {
                        round_id,
                        account: item.account,
                        mask: item.mask,
                        tiles_count: active_tiles,
                    },
                );
            }
        }
    }

    pub fn settle(&mut self, round_id: u64, seed: Base64VecU8, sig: Base64VecU8) -> Option<Promise> {
        self.assert_cvm_or_owner();
        assert_eq!(seed.0.len(), 32, "Seed must be 32 bytes");
        let mut seed_bytes = [0u8; 32];
        seed_bytes.copy_from_slice(&seed.0);

        // Ed25519 signature verification on (round_id || seed) per spec (Page 3)
        if let Some(cvm) = &self.active_cvm {
            if env::predecessor_account_id() != self.owner_id {
                assert_eq!(sig.0.len(), 64, "Signature must be 64 bytes");
                let mut sig_bytes = [0u8; 64];
                sig_bytes.copy_from_slice(&sig.0);

                let mut msg = Vec::new();
                msg.extend_from_slice(&round_id.to_le_bytes());
                msg.extend_from_slice(&seed_bytes);

                let pk_bytes = cvm.pubkey.as_bytes();
                assert_eq!(pk_bytes[0], 0, "Only ed25519 CVM keys supported");
                let mut ed_pk = [0u8; 32];
                ed_pk.copy_from_slice(&pk_bytes[1..33]);

                assert!(
                    env::ed25519_verify(&sig_bytes, &msg, &ed_pk),
                    "Invalid CVM signature on settle"
                );
            }
        }

        let round = self.rounds.get_mut(&round_id).expect("Round not found");
        assert_eq!(round.status, RoundStatus::Revealing, "Round not in revealing state");
        assert_eq!(
            round.revealed_count, round.entry_count,
            "Not all players revealed"
        );

        let mut hasher = Sha256::new();
        hasher.update(&seed_bytes);
        let derived_commit = hasher.finalize();
        assert_eq!(
            derived_commit.as_slice(),
            &round.seed_commit,
            "Seed does not match pre-committed hash"
        );

        let entropy = round.chain_entropy.expect("Entropy missing");
        let winning_tile = compute_winning_tile(&seed_bytes, &entropy);
        let (shard, vein, core) = roll_jackpots(&seed_bytes, &entropy);

        round.winning_tile = Some(winning_tile);
        round.jackpot_shard_hit = shard;
        round.jackpot_vein_hit = vein;
        round.jackpot_core_hit = core;
        round.settle_height = Some(env::block_height());
        round.status = RoundStatus::Settled;

        let total_winning_stake = round.per_tile_totals[winning_tile as usize];
        let round_deposit_net = round.total_net;
        let total_pot = round_deposit_net + self.carryover_pool;

        let (winners_amstr, jackpot_amstr, stash_amstr) =
            calculate_emission(round.total_net, round_id);

        let mut promise: Option<Promise> = None;

        // Wildcat round handling (1 in 25 rounds): 60% of AMSTR to single weighted winner
        let is_wildcat = round_id % 25 == 0;
        let mut wildcat_winner_opt: Option<AccountId> = None;
        let mut wildcat_amstr_amount: u128 = 0;

        let mut jackpot_near_awarded: u128 = 0;
        let mut jackpot_amstr_awarded: u128 = 0;

        if total_winning_stake > 0 {
            round.total_net = total_pot;
            self.carryover_pool = 0;

            if is_wildcat && winners_amstr > 0 {
                let mut candidates = Vec::new();
                if let Some(players) = self.round_players.get(&round_id) {
                    for p in players {
                        if let Some(entry) = self.entries.get(&(round_id, p.clone())) {
                            if entry.is_valid {
                                if let Some(mask) = entry.mask {
                                    if (mask & (1 << winning_tile)) != 0 {
                                        let active = (mask & 0x1FFFFFF).count_ones() as u128;
                                        let tile_stake = entry.net_stake / active;
                                        if tile_stake > 0 {
                                            candidates.push((p.clone(), tile_stake));
                                        }
                                    }
                                }
                            }
                        }
                    }
                }
                candidates.sort_by(|a, b| b.1.cmp(&a.1));
                if candidates.len() > 100 {
                    candidates.truncate(100);
                }

                if let Some(winner) = choose_wildcat_winner(&seed_bytes, &entropy, &candidates) {
                    wildcat_winner_opt = Some(winner);
                    wildcat_amstr_amount = (winners_amstr * 60) / 100;
                }
            }

            // Award jackpot hit pools to winning players
            if shard {
                let p = &mut self.jackpot_pools[0];
                let n = std::cmp::min(p.near_balance, p.cap_near);
                let a = std::cmp::min(p.amstr_balance, p.cap_amstr);
                p.near_balance -= n;
                p.amstr_balance -= a;
                jackpot_near_awarded += n;
                jackpot_amstr_awarded += a;
            }
            if vein {
                let p = &mut self.jackpot_pools[1];
                let n = std::cmp::min(p.near_balance, p.cap_near);
                let a = std::cmp::min(p.amstr_balance, p.cap_amstr);
                p.near_balance -= n;
                p.amstr_balance -= a;
                jackpot_near_awarded += n;
                jackpot_amstr_awarded += a;
            }
            if core {
                let p = &mut self.jackpot_pools[2];
                let n = std::cmp::min(p.near_balance, p.cap_near);
                let a = std::cmp::min(p.amstr_balance, p.cap_amstr);
                p.near_balance -= n;
                p.amstr_balance -= a;
                jackpot_near_awarded += n;
                jackpot_amstr_awarded += a;
            }

            let total_amstr_to_mint = winners_amstr + jackpot_amstr_awarded;
            if total_amstr_to_mint > 0 {
                let mint_call = Promise::new(self.token_id.clone()).function_call(
                    "mint".to_string(),
                    serde_json::to_vec(&serde_json::json!({
                        "to": env::current_account_id(),
                        "amount": U128(total_amstr_to_mint)
                    }))
                    .unwrap(),
                    NearToken::from_yoctonear(0),
                    GAS_FOR_FT_MINT,
                );
                promise = Some(mint_call);
            }
        } else {
            let cap_yocto = self.config.carryover_cap.as_yoctonear();
            if total_pot > cap_yocto {
                self.carryover_pool = cap_yocto;
                let overflow = total_pot - cap_yocto;
                add_near_to_jackpot_pools(
                    &mut self.jackpot_pools,
                    &mut self.carryover_pool,
                    &self.config,
                    overflow,
                );
            } else {
                self.carryover_pool = total_pot;
            }

            self.jackpot_pools[0].amstr_balance += jackpot_amstr + (winners_amstr * 70) / 100;
            self.jackpot_pools[1].amstr_balance += stash_amstr + (winners_amstr * 30) / 100;
        }

        round.wildcat_winner = wildcat_winner_opt;
        round.wildcat_amstr = wildcat_amstr_amount;
        round.jackpot_near_won = jackpot_near_awarded;
        round.jackpot_amstr_won = jackpot_amstr_awarded;

        // Sum referral rewards attributable to this round (1% from treasury's 2% share)
        let mut total_referral_fee = 0u128;
        if let Some(players) = self.round_players.get(&round_id) {
            for p in players {
                if self.referrals.contains_key(p) {
                    if let Some(entry) = self.entries.get(&(round_id, p.clone())) {
                        let ref_reward = (entry.gross_stake * (self.config.referral_bps as u128)) / 10_000;
                        total_referral_fee += ref_reward;
                    }
                }
            }
        }

        let total_fees = round.total_gross.saturating_sub(round_deposit_net);
        let buyback_fee = (total_fees * (self.config.buyback_bps as u128))
            / (self.config.fee_bps as u128);
        let jackpot_fee = (total_fees * (self.config.jackpot_bps as u128))
            / (self.config.fee_bps as u128);
        // Treasury fee is reduced by total_referral_fee so total splits strictly equal total_fees
        let treasury_fee = total_fees.saturating_sub(buyback_fee + jackpot_fee + total_referral_fee);

        add_near_to_jackpot_pools(
            &mut self.jackpot_pools,
            &mut self.carryover_pool,
            &self.config,
            jackpot_fee,
        );

        if buyback_fee + treasury_fee > 0 {
            let deposit_call = Promise::new(self.treasury_id.clone()).function_call(
                "deposit_funds".to_string(),
                vec![],
                NearToken::from_yoctonear(buyback_fee + treasury_fee),
                GAS_FOR_TREASURY_DEPOSIT,
            );
            promise = match promise {
                Some(p) => Some(p.then(deposit_call)),
                None => Some(deposit_call),
            };
        }

        // Ciphertext pruning: delete ciphertexts from storage to free state space per spec (Page 8)
        if let Some(players) = self.round_players.get(&round_id) {
            for p in players {
                if let Some(entry) = self.entries.get_mut(&(round_id, p.clone())) {
                    entry.ciphertext.clear();
                }
            }
        }

        emit_event(
            "round_settled",
            &RoundSettledEvent {
                round_id,
                winning_tile,
                seed,
                chain_entropy: Base64VecU8(entropy.to_vec()),
                total_pot: U128(total_pot),
                wildcat_winner: round.wildcat_winner.clone(),
                jackpot_shard: shard,
                jackpot_vein: vein,
                jackpot_core: core,
            },
        );

        promise
    }

    // --- CLAIM & PAYOUTS ---

    pub fn claim(&mut self, round_ids: Vec<u64>) -> Promise {
        let account_id = env::predecessor_account_id();
        let mut total_near_payout: u128 = 0;
        let mut total_amstr_payout: u128 = 0;
        let mut storage_refund_yocto: u128 = 0;

        for round_id in round_ids {
            let round = self.rounds.get(&round_id).expect("Round not found");
            assert_eq!(round.status, RoundStatus::Settled, "Round not settled");
            let winning_tile = round.winning_tile.expect("Winning tile not set");

            let key = (round_id, account_id.clone());
            if let Some(entry) = self.entries.get_mut(&key) {
                if entry.claimed {
                    continue;
                }

                // If ciphertext failed to decrypt, refund net stake minus fee (Page 3)
                if !entry.is_valid {
                    total_near_payout += entry.net_stake;
                    storage_refund_yocto += STORAGE_DEPOSIT_ENTRY.as_yoctonear();
                    entry.claimed = true;
                    continue;
                }

                if let Some(mask) = entry.mask {
                    if (mask & (1 << winning_tile)) != 0 {
                        let active_tiles = (mask & 0x1FFFFFF).count_ones() as u128;
                        let player_tile_stake = entry.net_stake / active_tiles;
                        let total_winning_stake = round.per_tile_totals[winning_tile as usize];

                        let mut near_payout = calculate_payout(
                            player_tile_stake,
                            total_winning_stake,
                            round.total_net,
                        );

                        // Emission & Wildcat AMSTR calculation
                        let (winners_amstr, _, _) =
                            calculate_emission(round.total_net, round_id);
                        let pro_rata_amstr = winners_amstr.saturating_sub(round.wildcat_amstr);
                        let mut amstr_payout = calculate_payout(
                            player_tile_stake,
                            total_winning_stake,
                            pro_rata_amstr,
                        );

                        // If player is the chosen Wildcat winner, add the 60% bonus
                        if let Some(w) = &round.wildcat_winner {
                            if *w == account_id {
                                amstr_payout += round.wildcat_amstr;
                            }
                        }

                        // Pro-rata jackpot bonus payouts
                        if round.jackpot_near_won > 0 {
                            near_payout += calculate_payout(
                                player_tile_stake,
                                total_winning_stake,
                                round.jackpot_near_won,
                            );
                        }
                        if round.jackpot_amstr_won > 0 {
                            amstr_payout += calculate_payout(
                                player_tile_stake,
                                total_winning_stake,
                                round.jackpot_amstr_won,
                            );
                        }

                        total_near_payout += near_payout;
                        total_amstr_payout += amstr_payout;

                        emit_event(
                            "claimed",
                            &ClaimedEvent {
                                round_id,
                                account: account_id.clone(),
                                near_payout: U128(near_payout),
                                amstr_payout: U128(amstr_payout),
                            },
                        );
                    }
                }

                entry.claimed = true;
                storage_refund_yocto += STORAGE_DEPOSIT_ENTRY.as_yoctonear();
            }
        }

        assert!(
            total_near_payout > 0 || storage_refund_yocto > 0,
            "No pending claims"
        );

        let payout_amount = NearToken::from_yoctonear(total_near_payout + storage_refund_yocto);
        let near_promise = Promise::new(account_id.clone()).transfer(payout_amount);

        if total_amstr_payout > 0 {
            near_promise.then(
                Promise::new(self.token_id.clone()).function_call(
                    "ft_transfer".to_string(),
                    serde_json::to_vec(&serde_json::json!({
                        "receiver_id": account_id,
                        "amount": U128(total_amstr_payout),
                        "memo": "AMSTR Mine Payout"
                    }))
                    .unwrap(),
                    NearToken::from_yoctonear(1),
                    GAS_FOR_FT_TRANSFER,
                ),
            )
        } else {
            near_promise
        }
    }

    pub fn reclaim_storage(&mut self, round_ids: Vec<u64>) -> Promise {
        let account_id = env::predecessor_account_id();
        let mut total_reclaimed_yocto: u128 = 0;

        for round_id in round_ids {
            let round = self.rounds.get(&round_id).expect("Round not found");
            assert!(
                round.status == RoundStatus::Settled || round.status == RoundStatus::Refunded,
                "Round not finished"
            );

            let key = (round_id, account_id.clone());
            if let Some(entry) = self.entries.get_mut(&key) {
                if !entry.claimed && !entry.refunded {
                    entry.claimed = true;
                    total_reclaimed_yocto += STORAGE_DEPOSIT_ENTRY.as_yoctonear();
                }
            }
        }

        assert!(total_reclaimed_yocto > 0, "No storage to reclaim");
        Promise::new(account_id).transfer(NearToken::from_yoctonear(total_reclaimed_yocto))
    }

    // --- TIMEOUT REFUND (LIVENESS SAFETY) ---

    pub fn refund_expired(&mut self, round_id: u64, limit: u32) -> u32 {
        let round = self.rounds.get_mut(&round_id).expect("Round not found");
        assert_ne!(round.status, RoundStatus::Settled, "Round already settled");
        assert!(
            env::block_height() > round.close_height + self.config.refund_timeout_blocks,
            "Timeout not reached"
        );

        round.status = RoundStatus::Refunded;
        let players = self
            .round_players
            .get(&round_id)
            .cloned()
            .unwrap_or_default();

        let start = round.refund_cursor as usize;
        let end = std::cmp::min(start + (limit as usize), players.len());
        let mut refunded_count = 0;

        for i in start..end {
            let player_id = &players[i];
            let key = (round_id, player_id.clone());
            if let Some(entry) = self.entries.get_mut(&key) {
                if !entry.refunded {
                    entry.refunded = true;
                    let full_refund = NearToken::from_yoctonear(
                        entry.gross_stake + STORAGE_DEPOSIT_ENTRY.as_yoctonear(),
                    );
                    let _ = Promise::new(player_id.clone()).transfer(full_refund);

                    emit_event(
                        "refunded",
                        &RefundedEvent {
                            round_id,
                            account: player_id.clone(),
                            gross_refund: U128(entry.gross_stake),
                        },
                    );
                    refunded_count += 1;
                }
            }
        }

        round.refund_cursor = end as u32;
        refunded_count
    }

    // --- REFERRALS ---

    pub fn bind_referrer(&mut self, referrer: AccountId) {
        let account = env::predecessor_account_id();
        assert_ne!(account, referrer, "Cannot refer self");
        assert!(!self.referrals.contains_key(&account), "Referrer already set");
        self.referrals.insert(account, referrer);
    }

    pub fn claim_referral_rewards(&mut self) -> Promise {
        let account = env::predecessor_account_id();
        let balance = self.referral_balances.get(&account).copied().unwrap_or(0);
        assert!(balance > 0, "No referral rewards to claim");

        self.referral_balances.insert(account.clone(), 0);
        Promise::new(account).transfer(NearToken::from_yoctonear(balance))
    }

    pub fn get_referral_balance(&self, account_id: AccountId) -> U128 {
        U128(self.referral_balances.get(&account_id).copied().unwrap_or(0))
    }

    // --- ADMIN & VIEWS ---

    pub fn pause(&mut self) {
        self.assert_owner();
        self.config.paused = true;
    }

    pub fn unpause(&mut self) {
        self.assert_owner();
        self.config.paused = false;
    }

    pub fn set_config(&mut self, config: Config) {
        self.assert_owner();
        assert!(
            config.refund_timeout_blocks >= 600,
            "refund_timeout_blocks cannot be less than 600 blocks (~10 mins)"
        );
        assert!(
            config.deposit_window_blocks >= 10,
            "deposit_window_blocks cannot be less than 10 blocks"
        );
        assert!(
            config.fee_bps <= 2000,
            "fee_bps cannot exceed 2000 (20%)"
        );
        assert!(
            config.buyback_bps + config.jackpot_bps + config.treasury_bps + config.referral_bps <= config.fee_bps,
            "Fee splits exceed total fee"
        );
        assert_eq!(
            config.shard_split_bps + config.vein_split_bps + config.core_split_bps,
            10_000,
            "Jackpot split percentages must sum to 10,000 (100%)"
        );
        self.config = config;
    }

    #[allow(dead_code)]
    pub(crate) fn add_near_to_jackpots(&mut self, amount: u128) {
        add_near_to_jackpot_pools(
            &mut self.jackpot_pools,
            &mut self.carryover_pool,
            &self.config,
            amount,
        );
    }

    #[init(ignore_state)]
    pub fn migrate() -> Self {
        let caller = env::predecessor_account_id();
        if let Some(old) = env::state_read::<OldContract>() {
            assert_eq!(caller, old.owner_id, "Owner only");
            let new_config = Config {
                fee_bps: old.config.fee_bps,
                buyback_bps: old.config.buyback_bps,
                jackpot_bps: old.config.jackpot_bps,
                treasury_bps: old.config.treasury_bps,
                referral_bps: old.config.referral_bps,
                min_stake: old.config.min_stake,
                max_stake: old.config.max_stake,
                max_players: old.config.max_players,
                deposit_window_blocks: old.config.deposit_window_blocks,
                refund_timeout_blocks: old.config.refund_timeout_blocks,
                carryover_cap: old.config.carryover_cap,
                paused: old.config.paused,
                allow_mock_cvm: old.config.allow_mock_cvm,
                shard_split_bps: 3000,
                vein_split_bps: 3000,
                core_split_bps: 4000,
            };

            Self {
                owner_id: old.owner_id,
                token_id: old.token_id,
                treasury_id: old.treasury_id,
                active_cvm: old.active_cvm,
                approved_code_hashes: old.approved_code_hashes,
                config: new_config,
                next_round_id: old.next_round_id,
                rounds: old.rounds,
                entries: old.entries,
                round_players: old.round_players,
                referrals: old.referrals,
                referral_balances: old.referral_balances,
                carryover_pool: old.carryover_pool,
                jackpot_pools: old.jackpot_pools,
            }
        } else if let Some(current) = env::state_read::<Contract>() {
            assert_eq!(caller, current.owner_id, "Owner only");
            current
        } else {
            env::panic_str("Failed to read state for migration");
        }
    }

    pub fn get_round(&self, round_id: u64) -> Option<RoundView> {
        self.rounds.get(&round_id).cloned().map(Into::into)
    }

    pub fn get_entry(&self, round_id: u64, account_id: AccountId) -> Option<EntryView> {
        self.entries.get(&(round_id, account_id)).cloned().map(Into::into)
    }

    pub fn get_config(&self) -> Config {
        self.config.clone()
    }

    pub fn get_cvm(&self) -> Option<CvmKey> {
        self.active_cvm.clone()
    }

    pub fn get_jackpot_pools(&self) -> Vec<JackpotPoolView> {
        self.jackpot_pools.iter().cloned().map(Into::into).collect()
    }

    pub fn get_carryover_pool(&self) -> U128 {
        U128(self.carryover_pool)
    }

    pub fn get_next_round_id(&self) -> u64 {
        self.next_round_id
    }

    pub fn get_active_round(&self) -> Option<RoundView> {
        if self.next_round_id <= 1 {
            None
        } else {
            self.rounds.get(&(self.next_round_id - 1)).cloned().map(Into::into)
        }
    }

    pub fn get_round_players(&self, round_id: u64) -> Vec<AccountId> {
        self.round_players.get(&round_id).cloned().unwrap_or_default()
    }

    pub fn get_round_entries(&self, round_id: u64) -> Vec<EntryView> {
        let players = self.round_players.get(&round_id).cloned().unwrap_or_default();
        players
            .into_iter()
            .filter_map(|account_id| self.entries.get(&(round_id, account_id)).cloned().map(Into::into))
            .collect()
    }

    // --- INTERNAL HELPERS ---

    fn assert_owner(&self) {
        assert_eq!(env::predecessor_account_id(), self.owner_id, "Owner only");
    }

    fn assert_cvm_or_owner(&self) {
        let caller = env::predecessor_account_id();
        let signer_pk = env::signer_account_pk();

        if caller == self.owner_id {
            return;
        }

        if let Some(cvm) = &self.active_cvm {
            assert_eq!(signer_pk, cvm.pubkey, "Signer does not match active CVM key");
        } else {
            env::panic_str("No active CVM registered");
        }
    }
}

pub(crate) fn add_near_to_jackpot_pools(
    pools: &mut [JackpotPool],
    carryover_pool: &mut u128,
    config: &Config,
    amount: u128,
) {
    if amount == 0 || pools.len() < 3 {
        return;
    }

    let shard_share = (amount * (config.shard_split_bps as u128)) / 10_000;
    let vein_share = (amount * (config.vein_split_bps as u128)) / 10_000;
    let core_share = amount.saturating_sub(shard_share + vein_share);

    // Tier 0: Shard
    let shard_cap = pools[0].cap_near;
    let new_shard = pools[0].near_balance + shard_share;
    let (shard_bal, shard_overflow) = if new_shard > shard_cap {
        (shard_cap, new_shard - shard_cap)
    } else {
        (new_shard, 0)
    };
    pools[0].near_balance = shard_bal;

    // Tier 1: Vein (receives vein_share + shard_overflow)
    let vein_cap = pools[1].cap_near;
    let new_vein = pools[1].near_balance + vein_share + shard_overflow;
    let (vein_bal, vein_overflow) = if new_vein > vein_cap {
        (vein_cap, new_vein - vein_cap)
    } else {
        (new_vein, 0)
    };
    pools[1].near_balance = vein_bal;

    // Tier 2: Core (receives core_share + vein_overflow)
    let core_cap = pools[2].cap_near;
    let new_core = pools[2].near_balance + core_share + vein_overflow;
    let (core_bal, core_overflow) = if new_core > core_cap {
        (core_cap, new_core - core_cap)
    } else {
        (new_core, 0)
    };
    pools[2].near_balance = core_bal;

    // Any excess beyond Core cap cascades back to carryover pool
    if core_overflow > 0 {
        *carryover_pool += core_overflow;
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use near_sdk::test_utils::VMContextBuilder;
    use near_sdk::testing_env;

    fn get_context(predecessor: AccountId, attached: NearToken) -> VMContextBuilder {
        let mut builder = VMContextBuilder::new();
        builder
            .current_account_id("game.near".parse().unwrap())
            .signer_account_id(predecessor.clone())
            .predecessor_account_id(predecessor)
            .attached_deposit(attached)
            .block_height(100);
        builder
    }

    fn make_mock_tdx_quote(code_hash: &[u8; 32], ed_pk_raw: &[u8; 32], x25519_bytes: &[u8; 32]) -> Vec<u8> {
        let mut quote = vec![0u8; 128];
        quote[..32].copy_from_slice(b"AMSTR_MOCK_TDX_SIMULATION_QUOTE\0");
        quote[32..64].copy_from_slice(code_hash);
        let mut hasher = Sha256::new();
        hasher.update(ed_pk_raw);
        hasher.update(x25519_bytes);
        let report_data: [u8; 32] = hasher.finalize().into();
        quote[64..96].copy_from_slice(&report_data);
        quote
    }

    #[test]
    fn test_full_round_lifecycle() {
        let owner: AccountId = "owner.near".parse().unwrap();
        let token: AccountId = "token.near".parse().unwrap();
        let treasury: AccountId = "treasury.near".parse().unwrap();
        let player_alice: AccountId = "alice.near".parse().unwrap();
        let player_bob: AccountId = "bob.near".parse().unwrap();

        let ctx = get_context(owner.clone(), NearToken::from_yoctonear(0));
        testing_env!(ctx.build());

        let mut contract = Contract::new(owner.clone(), token, treasury, None);

        // 1. Owner opens round
        let seed = [99u8; 32];
        let mut seed_hasher = Sha256::new();
        seed_hasher.update(&seed);
        let seed_commit: [u8; 32] = seed_hasher.finalize().into();

        let round_id = contract.open_round(Base64VecU8(seed_commit.to_vec()));
        assert_eq!(round_id, 1);

        let round = contract.get_round(1).unwrap();
        assert_eq!(round.status, RoundStatus::Open);
        assert_eq!(round.close_height, 160);

        // 2. Alice deposits 1.01 NEAR (1 NEAR stake + 0.01 NEAR storage)
        let mask_alice: u32 = 0b00000000_00000000_00000000_00000001; // tile 0
        let salt_alice = [1u8; 32];
        let commit_alice = compute_commit(player_alice.as_str(), round_id, mask_alice, &salt_alice);

        let mut ctx_alice = get_context(player_alice.clone(), NearToken::from_millinear(1010));
        ctx_alice.block_height(110);
        testing_env!(ctx_alice.build());

        contract.deploy(
            round_id,
            Base64VecU8(vec![1, 2, 3]),
            Base64VecU8(commit_alice.to_vec()),
        );

        // 3. Bob deposits 2.01 NEAR (2 NEAR stake + 0.01 NEAR storage)
        let mask_bob: u32 = 0b00000000_00000000_00000000_00000010; // tile 1
        let salt_bob = [2u8; 32];
        let commit_bob = compute_commit(player_bob.as_str(), round_id, mask_bob, &salt_bob);

        let mut ctx_bob = get_context(player_bob.clone(), NearToken::from_millinear(2010));
        ctx_bob.block_height(120);
        testing_env!(ctx_bob.build());

        contract.deploy(
            round_id,
            Base64VecU8(vec![4, 5, 6]),
            Base64VecU8(commit_bob.to_vec()),
        );

        let round_after_deploy = contract.get_round(1).unwrap();
        assert_eq!(round_after_deploy.entry_count, 2);
        assert_eq!(round_after_deploy.total_gross.0, 3 * 10u128.pow(24));
        assert_eq!(round_after_deploy.total_net.0, (27 * 10u128.pow(24)) / 10);

        // 4. Reveal batch after close (block 165 > 160)
        let mut ctx_reveal = get_context(owner.clone(), NearToken::from_yoctonear(0));
        ctx_reveal.block_height(165);
        ctx_reveal.random_seed([55u8; 32]);
        testing_env!(ctx_reveal.build());

        // Close round to lock chain_entropy before reveal
        contract.close_round(round_id);

        let reveals = vec![
            RevealItem {
                account: player_alice.clone(),
                mask: mask_alice,
                salt: Base64VecU8(salt_alice.to_vec()),
            },
            RevealItem {
                account: player_bob.clone(),
                mask: mask_bob,
                salt: Base64VecU8(salt_bob.to_vec()),
            },
        ];

        contract.reveal_batch(round_id, reveals);
        let round_after_reveal = contract.get_round(1).unwrap();
        assert_eq!(round_after_reveal.status, RoundStatus::Revealing);
        assert_eq!(round_after_reveal.revealed_count, 2);
        assert!(round_after_reveal.chain_entropy.is_some());

        // 5. Settle round
        let dummy_sig = [0u8; 64];
        let mut ctx_settle = get_context(owner.clone(), NearToken::from_yoctonear(0));
        ctx_settle.block_height(170);
        testing_env!(ctx_settle.build());

        let _ = contract.settle(
            round_id,
            Base64VecU8(seed.to_vec()),
            Base64VecU8(dummy_sig.to_vec()),
        );

        let settled_round = contract.get_round(1).unwrap();
        assert_eq!(settled_round.status, RoundStatus::Settled);
        assert!(settled_round.winning_tile.is_some());

        // Verify ciphertexts were pruned to free storage per spec
        let entry_alice = contract.get_entry(round_id, player_alice).unwrap();
        assert!(entry_alice.ciphertext.is_empty());
    }

    #[test]
    fn test_referral_reward_flow() {
        let owner: AccountId = "owner.near".parse().unwrap();
        let token: AccountId = "token.near".parse().unwrap();
        let treasury: AccountId = "treasury.near".parse().unwrap();
        let referrer: AccountId = "referrer.near".parse().unwrap();
        let player: AccountId = "player.near".parse().unwrap();

        let ctx = get_context(owner.clone(), NearToken::from_yoctonear(0));
        testing_env!(ctx.build());
        let mut contract = Contract::new(owner.clone(), token, treasury, None);

        // Player binds referrer
        let ctx_bind = get_context(player.clone(), NearToken::from_yoctonear(0));
        testing_env!(ctx_bind.build());
        contract.bind_referrer(referrer.clone());

        // Open round
        let ctx_open = get_context(owner.clone(), NearToken::from_yoctonear(0));
        testing_env!(ctx_open.build());
        let seed = [1u8; 32];
        let mut seed_hasher = Sha256::new();
        seed_hasher.update(&seed);
        let seed_commit: [u8; 32] = seed_hasher.finalize().into();
        let round_id = contract.open_round(Base64VecU8(seed_commit.to_vec()));

        // Player deposits 10 NEAR stake
        let mask = 1u32;
        let salt = [2u8; 32];
        let commit = compute_commit(player.as_str(), round_id, mask, &salt);

        let mut ctx_deploy = get_context(player.clone(), NearToken::from_millinear(10010)); // 10 NEAR + 0.01 NEAR
        ctx_deploy.block_height(105);
        testing_env!(ctx_deploy.build());

        contract.deploy(
            round_id,
            Base64VecU8(vec![9]),
            Base64VecU8(commit.to_vec()),
        );

        // 1% of 10 NEAR gross stake = 0.1 NEAR should be credited to referrer
        let ref_bal = contract.get_referral_balance(referrer.clone());
        let expected_ref_yocto = (10 * 10u128.pow(24)) / 100; // 0.1 NEAR
        assert_eq!(ref_bal.0, expected_ref_yocto);

        // Referrer claims rewards
        let ctx_claim_ref = get_context(referrer.clone(), NearToken::from_yoctonear(0));
        testing_env!(ctx_claim_ref.build());
        let _ = contract.claim_referral_rewards();
        assert_eq!(contract.get_referral_balance(referrer).0, 0);
    }

    #[test]
    fn test_invalid_pick_refund_minus_fee() {
        let owner: AccountId = "owner.near".parse().unwrap();
        let token: AccountId = "token.near".parse().unwrap();
        let treasury: AccountId = "treasury.near".parse().unwrap();
        let player: AccountId = "player.near".parse().unwrap();

        let ctx = get_context(owner.clone(), NearToken::from_yoctonear(0));
        testing_env!(ctx.build());
        let mut contract = Contract::new(owner.clone(), token, treasury, None);

        let seed = [2u8; 32];
        let mut seed_hasher = Sha256::new();
        seed_hasher.update(&seed);
        let seed_commit: [u8; 32] = seed_hasher.finalize().into();
        let round_id = contract.open_round(Base64VecU8(seed_commit.to_vec()));

        // Player deposits with commit A
        let commit = [8u8; 32];
        let mut ctx_deploy = get_context(player.clone(), NearToken::from_millinear(1010)); // 1 NEAR + 0.01 NEAR
        ctx_deploy.block_height(105);
        testing_env!(ctx_deploy.build());
        contract.deploy(round_id, Base64VecU8(vec![1]), Base64VecU8(commit.to_vec()));

        // CVM reveals with invalid salt/mask (simulating failed decryption)
        let mut ctx_reveal = get_context(owner.clone(), NearToken::from_yoctonear(0));
        ctx_reveal.block_height(165);
        ctx_reveal.random_seed([99u8; 32]);
        testing_env!(ctx_reveal.build());

        contract.close_round(round_id);

        let invalid_reveal = vec![RevealItem {
            account: player.clone(),
            mask: 1,
            salt: Base64VecU8(vec![0; 32]), // wrong salt
        }];
        contract.reveal_batch(round_id, invalid_reveal);

        let entry = contract.get_entry(round_id, player.clone()).unwrap();
        assert!(!entry.is_valid); // Marked invalid

        // Settle round
        let _ = contract.settle(round_id, Base64VecU8(seed.to_vec()), Base64VecU8(vec![0; 64]));

        // Player calls claim -> gets net stake refunded minus fee + storage deposit
        let ctx_claim = get_context(player.clone(), NearToken::from_yoctonear(0));
        testing_env!(ctx_claim.build());
        let _ = contract.claim(vec![round_id]);

        let entry_after = contract.get_entry(round_id, player).unwrap();
        assert!(entry_after.claimed);
    }

    #[test]
    fn test_timeout_and_refund() {
        let owner: AccountId = "owner.near".parse().unwrap();
        let token: AccountId = "token.near".parse().unwrap();
        let treasury: AccountId = "treasury.near".parse().unwrap();
        let player_alice: AccountId = "alice.near".parse().unwrap();

        let ctx = get_context(owner.clone(), NearToken::from_yoctonear(0));
        testing_env!(ctx.build());

        let mut contract = Contract::new(owner.clone(), token, treasury, None);

        let seed_commit = [11u8; 32];
        let round_id = contract.open_round(Base64VecU8(seed_commit.to_vec()));

        let mask = 1u32;
        let salt = [3u8; 32];
        let commit = compute_commit(player_alice.as_str(), round_id, mask, &salt);

        let mut ctx_alice = get_context(player_alice.clone(), NearToken::from_millinear(1010));
        ctx_alice.block_height(105);
        testing_env!(ctx_alice.build());

        contract.deploy(
            round_id,
            Base64VecU8(vec![1]),
            Base64VecU8(commit.to_vec()),
        );

        let mut ctx_refund = get_context("anyone.near".parse().unwrap(), NearToken::from_yoctonear(0));
        ctx_refund.block_height(800);
        testing_env!(ctx_refund.build());

        let refunded = contract.refund_expired(round_id, 10);
        assert_eq!(refunded, 1);

        let round = contract.get_round(round_id).unwrap();
        assert_eq!(round.status, RoundStatus::Refunded);

        let entry = contract.get_entry(round_id, player_alice).unwrap();
        assert!(entry.refunded);
    }

    #[test]
    #[should_panic(expected = "Owner only")]
    fn test_cvm_registration_rejects_non_owner() {
        let owner: AccountId = "owner.near".parse().unwrap();
        let token: AccountId = "token.near".parse().unwrap();
        let treasury: AccountId = "treasury.near".parse().unwrap();
        let attacker: AccountId = "attacker.near".parse().unwrap();

        let ctx = get_context(owner.clone(), NearToken::from_yoctonear(0));
        testing_env!(ctx.build());
        let mut contract = Contract::new(owner, token, treasury, None);

        let ctx_attacker = get_context(attacker, NearToken::from_yoctonear(0));
        testing_env!(ctx_attacker.build());

        let fake_pk: PublicKey = "ed25519:6E8jdmv7o2936guyF13NL1ek5j9iP342s386xZYWgn1B".parse().unwrap();
        contract.register_cvm(
            fake_pk,
            Base64VecU8(vec![1u8; 32]),
            Base64VecU8(vec![2u8; 64]),
        );
    }

    #[test]
    #[should_panic(expected = "CVM code hash not approved")]
    fn test_cvm_registration_rejects_unapproved_code_hash() {
        let owner: AccountId = "owner.near".parse().unwrap();
        let token: AccountId = "token.near".parse().unwrap();
        let treasury: AccountId = "treasury.near".parse().unwrap();

        let ctx = get_context(owner.clone(), NearToken::from_yoctonear(0));
        testing_env!(ctx.build());
        let mut contract = Contract::new(
            owner,
            token,
            treasury,
            Some(Config {
                allow_mock_cvm: true,
                ..Default::default()
            }),
        );

        let fake_pk: PublicKey = "ed25519:6E8jdmv7o2936guyF13NL1ek5j9iP342s386xZYWgn1B".parse().unwrap();
        let pk_bytes = fake_pk.as_bytes();
        let mut ed_raw = [0u8; 32];
        ed_raw.copy_from_slice(&pk_bytes[1..33]);
        let x25519_bytes = [1u8; 32];
        let unapproved_code_hash = [99u8; 32];
        let quote = make_mock_tdx_quote(&unapproved_code_hash, &ed_raw, &x25519_bytes);

        // Owner attempts to register CVM with unapproved code hash
        contract.register_cvm(
            fake_pk,
            Base64VecU8(x25519_bytes.to_vec()),
            Base64VecU8(quote),
        );
    }

    #[test]
    #[should_panic(expected = "Mock CVM attestation is strictly disabled in production")]
    fn test_mock_cvm_rejected_in_production_mode() {
        let owner: AccountId = "owner.near".parse().unwrap();
        let token: AccountId = "token.near".parse().unwrap();
        let treasury: AccountId = "treasury.near".parse().unwrap();

        let ctx = get_context(owner.clone(), NearToken::from_yoctonear(0));
        testing_env!(ctx.build());
        // Default config has allow_mock_cvm = false (Production Mode)
        let mut contract = Contract::new(owner, token, treasury, None);

        let fake_pk: PublicKey = "ed25519:6E8jdmv7o2936guyF13NL1ek5j9iP342s386xZYWgn1B".parse().unwrap();
        let pk_bytes = fake_pk.as_bytes();
        let mut ed_raw = [0u8; 32];
        ed_raw.copy_from_slice(&pk_bytes[1..33]);
        let x25519_bytes = [1u8; 32];
        let quote = make_mock_tdx_quote(&[1u8; 32], &ed_raw, &x25519_bytes);

        // Calling with mock quote in production config panics
        contract.register_cvm(
            fake_pk,
            Base64VecU8(x25519_bytes.to_vec()),
            Base64VecU8(quote),
        );
    }

    #[test]
    #[should_panic(expected = "TDX quote report_data does not bind registered CVM public keys")]
    fn test_cvm_registration_rejects_unbound_keys() {
        let owner: AccountId = "owner.near".parse().unwrap();
        let token: AccountId = "token.near".parse().unwrap();
        let treasury: AccountId = "treasury.near".parse().unwrap();

        let ctx = get_context(owner.clone(), NearToken::from_yoctonear(0));
        testing_env!(ctx.build());
        let mut contract = Contract::new(
            owner,
            token,
            treasury,
            Some(Config {
                allow_mock_cvm: true,
                ..Default::default()
            }),
        );

        let cvm_pk: PublicKey = "ed25519:6E8jdmv7o2936guyF13NL1ek5j9iP342s386xZYWgn1B".parse().unwrap();
        // Quote binds different report data than cvm_pk
        let wrong_ed_raw = [99u8; 32];
        let x25519_bytes = [1u8; 32];
        let quote = make_mock_tdx_quote(&[1u8; 32], &wrong_ed_raw, &x25519_bytes);

        contract.register_cvm(
            cvm_pk,
            Base64VecU8(x25519_bytes.to_vec()),
            Base64VecU8(quote),
        );
    }

    #[test]
    #[should_panic(expected = "Signer does not match active CVM key")]
    fn test_reveal_batch_rejects_unauthorized_signer() {
        let owner: AccountId = "owner.near".parse().unwrap();
        let token: AccountId = "token.near".parse().unwrap();
        let treasury: AccountId = "treasury.near".parse().unwrap();
        let _cvm_operator: AccountId = "cvm_operator.near".parse().unwrap();
        let attacker: AccountId = "attacker.near".parse().unwrap();

        let ctx = get_context(owner.clone(), NearToken::from_yoctonear(0));
        testing_env!(ctx.build());
        let mut contract = Contract::new(
            owner.clone(),
            token,
            treasury,
            Some(Config {
                allow_mock_cvm: true,
                ..Default::default()
            }),
        );

        let cvm_pk: PublicKey = "ed25519:6E8jdmv7o2936guyF13NL1ek5j9iP342s386xZYWgn1B".parse().unwrap();
        let pk_bytes = cvm_pk.as_bytes();
        let mut ed_raw = [0u8; 32];
        ed_raw.copy_from_slice(&pk_bytes[1..33]);
        let x25519_bytes = [7u8; 32];
        let code_hash = [42u8; 32];
        let quote = make_mock_tdx_quote(&code_hash, &ed_raw, &x25519_bytes);

        // Owner approves the code hash (the app measurement!)
        contract.approve_code_hash(hex::encode(code_hash));

        // Owner registers the CVM key
        contract.register_cvm(
            cvm_pk.clone(),
            Base64VecU8(x25519_bytes.to_vec()),
            Base64VecU8(quote),
        );

        // Open a round
        let round_id = contract.open_round(Base64VecU8(vec![0u8; 32]));

        // Close round at block 165
        let mut ctx_close = get_context(owner.clone(), NearToken::from_yoctonear(0));
        ctx_close.block_height(165);
        testing_env!(ctx_close.build());
        contract.close_round(round_id);

        // Attacker attempts to call reveal_batch with different signer public key
        let mut ctx_attacker = get_context(attacker, NearToken::from_yoctonear(0));
        let attacker_pk: PublicKey = "ed25519:GxaHA19qMwjhFmxv1CV4a5UcgqE9vU2vBPvHQwg1KWNP".parse().unwrap();
        ctx_attacker.signer_account_pk(attacker_pk);
        ctx_attacker.block_height(200);
        testing_env!(ctx_attacker.build());

        contract.reveal_batch(round_id, vec![]);
    }

    #[test]
    #[should_panic(expected = "No active CVM registered")]
    fn test_unauthorized_caller_rejected_when_no_cvm_registered() {
        let owner: AccountId = "owner.near".parse().unwrap();
        let token: AccountId = "token.near".parse().unwrap();
        let treasury: AccountId = "treasury.near".parse().unwrap();
        let attacker: AccountId = "attacker.near".parse().unwrap();

        let ctx = get_context(owner.clone(), NearToken::from_yoctonear(0));
        testing_env!(ctx.build());
        let mut contract = Contract::new(owner.clone(), token, treasury, None);

        let round_id = contract.open_round(Base64VecU8(vec![0u8; 32]));

        // Close round at block 165
        let mut ctx_close = get_context(owner.clone(), NearToken::from_yoctonear(0));
        ctx_close.block_height(165);
        testing_env!(ctx_close.build());
        contract.close_round(round_id);

        let mut ctx_attacker = get_context(attacker, NearToken::from_yoctonear(0));
        ctx_attacker.block_height(200);
        testing_env!(ctx_attacker.build());

        contract.reveal_batch(round_id, vec![]);
    }

    #[test]
    #[should_panic(expected = "Deposit window still open")]
    fn test_close_round_before_close_height_panics() {
        let owner: AccountId = "owner.near".parse().unwrap();
        let token: AccountId = "token.near".parse().unwrap();
        let treasury: AccountId = "treasury.near".parse().unwrap();

        let ctx = get_context(owner.clone(), NearToken::from_yoctonear(0));
        testing_env!(ctx.build());
        let mut contract = Contract::new(owner, token, treasury, None);

        let round_id = contract.open_round(Base64VecU8(vec![0u8; 32]));

        // Attempting to close round at block 150 (<= 160) panics
        let mut ctx_early = get_context("anyone.near".parse().unwrap(), NearToken::from_yoctonear(0));
        ctx_early.block_height(150);
        testing_env!(ctx_early.build());
        contract.close_round(round_id);
    }

    #[test]
    #[should_panic(expected = "Round must be closed before reveals can be submitted")]
    fn test_reveal_batch_before_close_round_panics() {
        let owner: AccountId = "owner.near".parse().unwrap();
        let token: AccountId = "token.near".parse().unwrap();
        let treasury: AccountId = "treasury.near".parse().unwrap();

        let ctx = get_context(owner.clone(), NearToken::from_yoctonear(0));
        testing_env!(ctx.build());
        let mut contract = Contract::new(owner.clone(), token, treasury, None);

        let round_id = contract.open_round(Base64VecU8(vec![0u8; 32]));

        // Owner/CVM attempts to call reveal_batch at block 165 without calling close_round first
        let mut ctx_reveal = get_context(owner, NearToken::from_yoctonear(0));
        ctx_reveal.block_height(165);
        testing_env!(ctx_reveal.build());

        contract.reveal_batch(round_id, vec![]);
    }

    #[test]
    fn test_chain_entropy_fixed_at_round_close_not_at_reveal() {
        let owner: AccountId = "owner.near".parse().unwrap();
        let token: AccountId = "token.near".parse().unwrap();
        let treasury: AccountId = "treasury.near".parse().unwrap();

        let ctx = get_context(owner.clone(), NearToken::from_yoctonear(0));
        testing_env!(ctx.build());
        let mut contract = Contract::new(owner.clone(), token, treasury, None);

        let round_id = contract.open_round(Base64VecU8(vec![0u8; 32]));

        // 1. Close round at block 165 with entropy E1
        let entropy_1 = [77u8; 32];
        let mut ctx_close = get_context("anyone.near".parse().unwrap(), NearToken::from_yoctonear(0));
        ctx_close.block_height(165);
        ctx_close.random_seed(entropy_1);
        testing_env!(ctx_close.build());

        contract.close_round(round_id);

        let round_after_close = contract.get_round(round_id).unwrap();
        assert_eq!(round_after_close.status, RoundStatus::Revealing);
        assert_eq!(round_after_close.chain_entropy, Some(entropy_1));

        // 2. CVM calls reveal_batch at a later block 170 with different block seed E2
        let entropy_2 = [88u8; 32];
        let mut ctx_reveal = get_context(owner, NearToken::from_yoctonear(0));
        ctx_reveal.block_height(170);
        ctx_reveal.random_seed(entropy_2);
        testing_env!(ctx_reveal.build());

        contract.reveal_batch(round_id, vec![]);

        let round_after_reveal = contract.get_round(round_id).unwrap();
        // Verified: chain_entropy remains strictly entropy_1; CVM cannot alter or choose entropy
        assert_eq!(round_after_reveal.chain_entropy, Some(entropy_1));
        assert_ne!(round_after_reveal.chain_entropy, Some(entropy_2));
    }

    #[test]
    fn test_set_config_valid_update_succeeds() {
        let owner: AccountId = "owner.near".parse().unwrap();
        let token: AccountId = "token.near".parse().unwrap();
        let treasury: AccountId = "treasury.near".parse().unwrap();

        let ctx = get_context(owner.clone(), NearToken::from_yoctonear(0));
        testing_env!(ctx.build());
        let mut contract = Contract::new(owner.clone(), token, treasury, None);

        let mut new_config = contract.get_config();
        new_config.deposit_window_blocks = 120;
        new_config.refund_timeout_blocks = 1200;
        new_config.fee_bps = 1500;
        new_config.buyback_bps = 800;
        new_config.jackpot_bps = 300;
        new_config.treasury_bps = 300;
        new_config.referral_bps = 100;

        contract.set_config(new_config.clone());
        let updated = contract.get_config();
        assert_eq!(updated.deposit_window_blocks, 120);
        assert_eq!(updated.refund_timeout_blocks, 1200);
        assert_eq!(updated.fee_bps, 1500);
    }

    #[test]
    #[should_panic(expected = "Owner only")]
    fn test_set_config_non_owner_panics() {
        let owner: AccountId = "owner.near".parse().unwrap();
        let token: AccountId = "token.near".parse().unwrap();
        let treasury: AccountId = "treasury.near".parse().unwrap();

        let ctx = get_context(owner.clone(), NearToken::from_yoctonear(0));
        testing_env!(ctx.build());
        let mut contract = Contract::new(owner, token, treasury, None);

        // Attacker attempts set_config
        let ctx_attacker = get_context("attacker.near".parse().unwrap(), NearToken::from_yoctonear(0));
        testing_env!(ctx_attacker.build());
        contract.set_config(Config::default());
    }

    #[test]
    #[should_panic(expected = "refund_timeout_blocks cannot be less than 600 blocks")]
    fn test_set_config_refund_timeout_below_minimum_panics() {
        let owner: AccountId = "owner.near".parse().unwrap();
        let token: AccountId = "token.near".parse().unwrap();
        let treasury: AccountId = "treasury.near".parse().unwrap();

        let ctx = get_context(owner.clone(), NearToken::from_yoctonear(0));
        testing_env!(ctx.build());
        let mut contract = Contract::new(owner, token, treasury, None);

        let mut bad_config = contract.get_config();
        bad_config.refund_timeout_blocks = 599; // Less than 600 blocks
        contract.set_config(bad_config);
    }

    #[test]
    #[should_panic(expected = "deposit_window_blocks cannot be less than 10 blocks")]
    fn test_set_config_deposit_window_below_minimum_panics() {
        let owner: AccountId = "owner.near".parse().unwrap();
        let token: AccountId = "token.near".parse().unwrap();
        let treasury: AccountId = "treasury.near".parse().unwrap();

        let ctx = get_context(owner.clone(), NearToken::from_yoctonear(0));
        testing_env!(ctx.build());
        let mut contract = Contract::new(owner, token, treasury, None);

        let mut bad_config = contract.get_config();
        bad_config.deposit_window_blocks = 9; // Less than 10 blocks
        contract.set_config(bad_config);
    }

    #[test]
    #[should_panic(expected = "fee_bps cannot exceed 2000 (20%)")]
    fn test_set_config_fee_above_maximum_panics() {
        let owner: AccountId = "owner.near".parse().unwrap();
        let token: AccountId = "token.near".parse().unwrap();
        let treasury: AccountId = "treasury.near".parse().unwrap();

        let ctx = get_context(owner.clone(), NearToken::from_yoctonear(0));
        testing_env!(ctx.build());
        let mut contract = Contract::new(owner, token, treasury, None);

        let mut bad_config = contract.get_config();
        bad_config.fee_bps = 2001; // Over 20%
        contract.set_config(bad_config);
    }

    #[test]
    #[should_panic(expected = "Fee splits exceed total fee")]
    fn test_set_config_fee_splits_exceeding_total_panics() {
        let owner: AccountId = "owner.near".parse().unwrap();
        let token: AccountId = "token.near".parse().unwrap();
        let treasury: AccountId = "treasury.near".parse().unwrap();

        let ctx = get_context(owner.clone(), NearToken::from_yoctonear(0));
        testing_env!(ctx.build());
        let mut contract = Contract::new(owner, token, treasury, None);

        let mut bad_config = contract.get_config();
        bad_config.fee_bps = 1000;
        bad_config.buyback_bps = 600;
        bad_config.jackpot_bps = 200;
        bad_config.treasury_bps = 200;
        bad_config.referral_bps = 100; // Sum = 1100 > 1000
        contract.set_config(bad_config);
    }

    #[test]
    fn test_jackpot_split_simultaneous_and_configurable() {
        let owner: AccountId = "owner.near".parse().unwrap();
        let token: AccountId = "token.near".parse().unwrap();
        let treasury: AccountId = "treasury.near".parse().unwrap();

        let ctx = get_context(owner.clone(), NearToken::from_yoctonear(0));
        testing_env!(ctx.build());
        let mut contract = Contract::new(owner.clone(), token, treasury, None);

        // Verify default splits: 30% Shard, 30% Vein, 40% Core
        let conf = contract.get_config();
        assert_eq!(conf.shard_split_bps, 3000);
        assert_eq!(conf.vein_split_bps, 3000);
        assert_eq!(conf.core_split_bps, 4000);

        // Add 10 NEAR (10 * 10^24 yoctoNEAR) to jackpots
        let ten_near = 10 * 10u128.pow(24);
        contract.add_near_to_jackpots(ten_near);

        let pools = contract.get_jackpot_pools();
        assert_eq!(pools[0].near_balance.0, 3 * 10u128.pow(24)); // 30% = 3 NEAR
        assert_eq!(pools[1].near_balance.0, 3 * 10u128.pow(24)); // 30% = 3 NEAR
        assert_eq!(pools[2].near_balance.0, 4 * 10u128.pow(24)); // 40% = 4 NEAR

        // Reconfigure via set_config to 20% / 30% / 50%
        let mut reconfigured = contract.get_config();
        reconfigured.shard_split_bps = 2000;
        reconfigured.vein_split_bps = 3000;
        reconfigured.core_split_bps = 5000;
        contract.set_config(reconfigured);

        // Add another 10 NEAR
        contract.add_near_to_jackpots(ten_near);
        let pools2 = contract.get_jackpot_pools();
        assert_eq!(pools2[0].near_balance.0, 5 * 10u128.pow(24)); // 3 + 2 = 5 NEAR
        assert_eq!(pools2[1].near_balance.0, 6 * 10u128.pow(24)); // 3 + 3 = 6 NEAR
        assert_eq!(pools2[2].near_balance.0, 9 * 10u128.pow(24)); // 4 + 5 = 9 NEAR
    }

    #[test]
    #[should_panic(expected = "Jackpot split percentages must sum to 10,000 (100%)")]
    fn test_set_config_invalid_jackpot_splits_panics() {
        let owner: AccountId = "owner.near".parse().unwrap();
        let token: AccountId = "token.near".parse().unwrap();
        let treasury: AccountId = "treasury.near".parse().unwrap();

        let ctx = get_context(owner.clone(), NearToken::from_yoctonear(0));
        testing_env!(ctx.build());
        let mut contract = Contract::new(owner, token, treasury, None);

        let mut bad_config = contract.get_config();
        bad_config.shard_split_bps = 3000;
        bad_config.vein_split_bps = 3000;
        bad_config.core_split_bps = 3000; // Sum = 9000 != 10000
        contract.set_config(bad_config);
    }

    #[test]
    fn test_jackpot_overflow_cascades_to_next_tier() {
        let owner: AccountId = "owner.near".parse().unwrap();
        let token: AccountId = "token.near".parse().unwrap();
        let treasury: AccountId = "treasury.near".parse().unwrap();

        let ctx = get_context(owner.clone(), NearToken::from_yoctonear(0));
        testing_env!(ctx.build());
        let mut contract = Contract::new(owner, token, treasury, None);

        // Set Shard balance to 195 NEAR (cap is 200 NEAR)
        contract.jackpot_pools[0].near_balance = 195 * 10u128.pow(24);
        contract.jackpot_pools[1].near_balance = 0;
        contract.jackpot_pools[2].near_balance = 0;

        // Deposit 20 NEAR. Splits: Shard (30%) = 6 NEAR, Vein (30%) = 6 NEAR, Core (40%) = 8 NEAR
        // Shard gets 195 + 6 = 201 NEAR -> caps at 200 NEAR, 1 NEAR overflows into Vein!
        let twenty_near = 20 * 10u128.pow(24);
        contract.add_near_to_jackpots(twenty_near);

        let pools = contract.get_jackpot_pools();
        assert_eq!(pools[0].near_balance.0, 200 * 10u128.pow(24)); // Capped at 200 NEAR
        assert_eq!(pools[1].near_balance.0, 7 * 10u128.pow(24));   // 6 NEAR share + 1 NEAR overflow from Shard
        assert_eq!(pools[2].near_balance.0, 8 * 10u128.pow(24));   // 8 NEAR share
    }
}
