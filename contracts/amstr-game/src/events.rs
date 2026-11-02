use near_sdk::json_types::{Base64VecU8, U128};
use near_sdk::{env, AccountId};
use serde::Serialize;

#[derive(Serialize)]
#[serde(crate = "near_sdk::serde")]
struct Nep297Event<'a, T: Serialize> {
    standard: &'static str,
    version: &'static str,
    event: &'static str,
    data: &'a [T],
}

pub fn emit_event<T: Serialize>(event_name: &'static str, data: &T) {
    let event = Nep297Event {
        standard: "amstr",
        version: "1.0.0",
        event: event_name,
        data: std::slice::from_ref(data),
    };
    if let Ok(json) = serde_json::to_string(&event) {
        env::log_str(&format!("EVENT_JSON:{}", json));
    }
}

#[derive(Serialize)]
#[serde(crate = "near_sdk::serde")]
pub struct RoundOpenedEvent {
    pub round_id: u64,
    pub open_height: u64,
    pub close_height: u64,
    pub seed_commit: Base64VecU8,
}

#[derive(Serialize)]
#[serde(crate = "near_sdk::serde")]
pub struct RoundClosedEvent {
    pub round_id: u64,
    pub close_height: u64,
    pub chain_entropy: Base64VecU8,
}

#[derive(Serialize)]
#[serde(crate = "near_sdk::serde")]
pub struct DeployedEvent {
    pub round_id: u64,
    pub account: AccountId,
    pub gross_stake: U128,
    pub fee: U128,
    pub net_stake: U128,
    pub commit: Base64VecU8,
}

#[derive(Serialize)]
#[serde(crate = "near_sdk::serde")]
pub struct RevealedEvent {
    pub round_id: u64,
    pub account: AccountId,
    pub mask: u32,
    pub tiles_count: u32,
}

#[derive(Serialize)]
#[serde(crate = "near_sdk::serde")]
pub struct RoundSettledEvent {
    pub round_id: u64,
    pub winning_tile: u8,
    pub seed: Base64VecU8,
    pub chain_entropy: Base64VecU8,
    pub total_pot: U128,
    pub wildcat_winner: Option<AccountId>,
    pub jackpot_shard: bool,
    pub jackpot_vein: bool,
    pub jackpot_core: bool,
}

#[derive(Serialize)]
#[serde(crate = "near_sdk::serde")]
pub struct ClaimedEvent {
    pub round_id: u64,
    pub account: AccountId,
    pub near_payout: U128,
    pub amstr_payout: U128,
}

#[derive(Serialize)]
#[serde(crate = "near_sdk::serde")]
pub struct RefundedEvent {
    pub round_id: u64,
    pub account: AccountId,
    pub gross_refund: U128,
}

#[derive(Serialize)]
#[serde(crate = "near_sdk::serde")]
pub struct CvmRegisteredEvent {
    pub pubkey: String,
    pub code_hash: String,
}
