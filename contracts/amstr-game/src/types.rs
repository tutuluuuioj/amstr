use near_sdk::json_types::{Base64VecU8, U128};
use near_sdk::{near, AccountId, NearToken, PublicKey};

#[near(serializers = [borsh, json])]
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum RoundStatus {
    Open,
    Revealing,
    Settled,
    Refunded,
}

#[near(serializers = [borsh, json])]
#[derive(Clone, Debug)]
pub struct Round {
    pub round_id: u64,
    pub status: RoundStatus,
    pub open_height: u64,
    pub close_height: u64,
    pub settle_height: Option<u64>,
    pub seed_commit: [u8; 32],
    pub chain_entropy: Option<[u8; 32]>,
    pub winning_tile: Option<u8>,
    pub per_tile_totals: [u128; 25],
    pub total_net: u128,
    pub total_gross: u128,
    pub entry_count: u32,
    pub revealed_count: u32,
    pub refund_cursor: u32,
    // Wildcat bonus
    pub wildcat_winner: Option<AccountId>,
    pub wildcat_amstr: u128,
    // Jackpot hits & awarded amounts
    pub jackpot_shard_hit: bool,
    pub jackpot_vein_hit: bool,
    pub jackpot_core_hit: bool,
    pub jackpot_near_won: u128,
    pub jackpot_amstr_won: u128,
}

#[near(serializers = [borsh, json])]
#[derive(Clone, Debug)]
pub struct Entry {
    pub account_id: AccountId,
    pub gross_stake: u128,
    pub net_stake: u128,
    pub commit: [u8; 32],
    pub ciphertext: Vec<u8>,
    pub mask: Option<u32>,
    pub salt: Option<[u8; 32]>,
    pub is_valid: bool,
    pub claimed: bool,
    pub refunded: bool,
}

#[near(serializers = [borsh, json])]
#[derive(Clone, Debug)]
pub struct RevealItem {
    pub account: AccountId,
    pub mask: u32,
    pub salt: Base64VecU8,
}

#[near(serializers = [borsh, json])]
#[derive(Clone, Debug)]
pub struct Config {
    pub fee_bps: u16,         // 1000 = 10%
    pub buyback_bps: u16,     // 600 = 6%
    pub jackpot_bps: u16,     // 200 = 2%
    pub treasury_bps: u16,    // 200 = 2%
    pub referral_bps: u16,    // 100 = 1%
    pub min_stake: NearToken, // e.g. 0.01 NEAR
    pub max_stake: NearToken, // e.g. 20 NEAR
    pub max_players: u32,     // 200
    pub deposit_window_blocks: u64, // ~60s
    pub refund_timeout_blocks: u64, // ~10m (600 blocks)
    pub carryover_cap: NearToken,   // 100 NEAR
    pub paused: bool,
    pub allow_mock_cvm: bool, // FALSE in production, only true in simulation/unit tests
    pub shard_split_bps: u16, // 3000 = 30%
    pub vein_split_bps: u16,  // 3000 = 30%
    pub core_split_bps: u16,  // 4000 = 40%
}

impl Default for Config {
    fn default() -> Self {
        Self {
            fee_bps: 1000,
            buyback_bps: 600,
            jackpot_bps: 200,
            treasury_bps: 100,
            referral_bps: 100,
            min_stake: NearToken::from_millinear(10), // 0.01 NEAR
            max_stake: NearToken::from_near(20),       // 20 NEAR
            max_players: 200,
            deposit_window_blocks: 60,
            refund_timeout_blocks: 600,
            carryover_cap: NearToken::from_near(100),
            paused: false,
            allow_mock_cvm: false,
            shard_split_bps: 3000, // 30%
            vein_split_bps: 3000,  // 30%
            core_split_bps: 4000,  // 40%
        }
    }
}

#[near(serializers = [borsh, json])]
#[derive(Clone, Debug)]
pub struct CvmKey {
    pub pubkey: PublicKey,
    pub x25519_pub: [u8; 32],
    pub code_hash: String,
    pub registered_at: u64,
}

#[near(serializers = [borsh, json])]
#[derive(Clone, Debug)]
pub struct JackpotPool {
    pub near_balance: u128,
    pub amstr_balance: u128,
    pub cap_near: u128,
    pub cap_amstr: u128,
    pub odds: u32,
}

#[near(serializers = [json])]
#[derive(Clone, Debug)]
pub struct RoundView {
    pub round_id: u64,
    pub status: RoundStatus,
    pub open_height: u64,
    pub close_height: u64,
    pub settle_height: Option<u64>,
    pub seed_commit: [u8; 32],
    pub chain_entropy: Option<[u8; 32]>,
    pub winning_tile: Option<u8>,
    pub per_tile_totals: Vec<U128>,
    pub total_net: U128,
    pub total_gross: U128,
    pub entry_count: u32,
    pub revealed_count: u32,
    pub refund_cursor: u32,
    pub wildcat_winner: Option<AccountId>,
    pub wildcat_amstr: U128,
    pub jackpot_shard_hit: bool,
    pub jackpot_vein_hit: bool,
    pub jackpot_core_hit: bool,
    pub jackpot_near_won: U128,
    pub jackpot_amstr_won: U128,
}

impl From<Round> for RoundView {
    fn from(r: Round) -> Self {
        Self {
            round_id: r.round_id,
            status: r.status,
            open_height: r.open_height,
            close_height: r.close_height,
            settle_height: r.settle_height,
            seed_commit: r.seed_commit,
            chain_entropy: r.chain_entropy,
            winning_tile: r.winning_tile,
            per_tile_totals: r.per_tile_totals.iter().copied().map(U128).collect(),
            total_net: U128(r.total_net),
            total_gross: U128(r.total_gross),
            entry_count: r.entry_count,
            revealed_count: r.revealed_count,
            refund_cursor: r.refund_cursor,
            wildcat_winner: r.wildcat_winner,
            wildcat_amstr: U128(r.wildcat_amstr),
            jackpot_shard_hit: r.jackpot_shard_hit,
            jackpot_vein_hit: r.jackpot_vein_hit,
            jackpot_core_hit: r.jackpot_core_hit,
            jackpot_near_won: U128(r.jackpot_near_won),
            jackpot_amstr_won: U128(r.jackpot_amstr_won),
        }
    }
}

#[near(serializers = [json])]
#[derive(Clone, Debug)]
pub struct EntryView {
    pub account_id: AccountId,
    pub gross_stake: U128,
    pub net_stake: U128,
    pub commit: [u8; 32],
    pub ciphertext: Vec<u8>,
    pub mask: Option<u32>,
    pub salt: Option<[u8; 32]>,
    pub is_valid: bool,
    pub claimed: bool,
    pub refunded: bool,
}

impl From<Entry> for EntryView {
    fn from(e: Entry) -> Self {
        Self {
            account_id: e.account_id,
            gross_stake: U128(e.gross_stake),
            net_stake: U128(e.net_stake),
            commit: e.commit,
            ciphertext: e.ciphertext,
            mask: e.mask,
            salt: e.salt,
            is_valid: e.is_valid,
            claimed: e.claimed,
            refunded: e.refunded,
        }
    }
}

#[near(serializers = [json])]
#[derive(Clone, Debug)]
pub struct JackpotPoolView {
    pub near_balance: U128,
    pub amstr_balance: U128,
    pub cap_near: U128,
    pub cap_amstr: U128,
    pub odds: u32,
}

impl From<JackpotPool> for JackpotPoolView {
    fn from(j: JackpotPool) -> Self {
        Self {
            near_balance: U128(j.near_balance),
            amstr_balance: U128(j.amstr_balance),
            cap_near: U128(j.cap_near),
            cap_amstr: U128(j.cap_amstr),
            odds: j.odds,
        }
    }
}
