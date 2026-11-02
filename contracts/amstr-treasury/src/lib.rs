use near_sdk::json_types::U128;
use near_sdk::{
    env, near, AccountId, Gas, NearToken, PanicOnDefault, Promise,
};
use primitive_types::U256;

pub const TGAS: u64 = 1_000_000_000_000;
pub const GAS_FOR_FT_TRANSFER: Gas = Gas::from_tgas(20);
pub const GAS_FOR_FT_TRANSFER_CALL: Gas = Gas::from_tgas(40);
pub const THIRTY_DAYS_NS: u64 = 30 * 24 * 60 * 60 * 1_000_000_000;
pub const DEFAULT_DEV_WITHDRAWAL_CAP_BPS: u16 = 1000; // 10.00%
pub const MAX_DEV_WITHDRAWAL_CAP_BPS: u16 = 1000; // Max allowed cap is 10%

#[near(contract_state)]
#[derive(PanicOnDefault)]
pub struct Contract {
    owner_id: AccountId,
    token_id: AccountId,
    game_id: AccountId,
    staking_id: AccountId,
    // Testnet simulated oracle price: NEAR per 1 AMSTR (in yoctoNEAR, e.g. 0.05 NEAR = 5e22)
    oracle_price_yocto: u128,
    // Percentage cap on dev withdrawals per 30-day window (1000 = 10.00%)
    dev_withdrawal_cap_bps: u16,
    dev_withdrawn_in_window: NearToken,
    current_window_start: u64,
}

#[near]
impl Contract {
    #[init]
    pub fn new(
        owner_id: AccountId,
        token_id: AccountId,
        game_id: AccountId,
        staking_id: AccountId,
        oracle_price_yocto: U128,
        dev_withdrawal_cap_bps: Option<u16>,
    ) -> Self {
        assert!(!env::state_exists(), "Already initialized");
        let cap_bps = dev_withdrawal_cap_bps.unwrap_or(DEFAULT_DEV_WITHDRAWAL_CAP_BPS);
        assert!(cap_bps <= MAX_DEV_WITHDRAWAL_CAP_BPS, "Percentage cap cannot exceed 10%");
        Self {
            owner_id,
            token_id,
            game_id,
            staking_id,
            oracle_price_yocto: oracle_price_yocto.into(),
            dev_withdrawal_cap_bps: cap_bps,
            dev_withdrawn_in_window: NearToken::from_yoctonear(0),
            current_window_start: env::block_timestamp(),
        }
    }

    #[payable]
    pub fn deposit_funds(&mut self) {
        // Receives fees from game contract
    }

    pub fn set_oracle_price(&mut self, price: U128) {
        self.assert_owner();
        self.oracle_price_yocto = price.into();
    }

    pub fn set_dev_withdrawal_cap_bps(&mut self, cap_bps: u16) {
        self.assert_owner();
        assert!(cap_bps <= MAX_DEV_WITHDRAWAL_CAP_BPS, "Percentage cap cannot exceed 10%");
        self.dev_withdrawal_cap_bps = cap_bps;
    }

    pub fn set_staking_id(&mut self, staking_id: AccountId) {
        self.assert_owner();
        self.staking_id = staking_id;
    }

    pub fn set_game_id(&mut self, game_id: AccountId) {
        self.assert_owner();
        self.game_id = game_id;
    }

    pub fn withdraw_dev(&mut self, recipient: AccountId, amount: NearToken) -> Promise {
        self.assert_owner();
        let now = env::block_timestamp();
        if now >= self.current_window_start + THIRTY_DAYS_NS {
            self.current_window_start = now;
            self.dev_withdrawn_in_window = NearToken::from_yoctonear(0);
        }

        // Dynamically compute 10% maximum window allowance from treasury balance
        let current_balance_yocto = env::account_balance().as_yoctonear();
        let total_window_funds_yocto = current_balance_yocto.saturating_add(self.dev_withdrawn_in_window.as_yoctonear());
        let max_allowed_yocto = (total_window_funds_yocto * (self.dev_withdrawal_cap_bps as u128)) / 10_000;

        let total_after = self
            .dev_withdrawn_in_window
            .saturating_add(amount);
        assert!(
            total_after.as_yoctonear() <= max_allowed_yocto,
            "Exceeds 30-day withdrawal cap (10% of treasury balance)"
        );
        self.dev_withdrawn_in_window = total_after;

        Promise::new(recipient).transfer(amount)
    }

    // Run buyback:
    // On testnet: sells AMSTR to vault or simulates buyback.
    // 90% is burned, 10% goes to stakers.
    pub fn run_buyback(&mut self, near_to_spend: NearToken) -> Promise {
        assert!(
            env::predecessor_account_id() == self.owner_id
                || env::predecessor_account_id() == self.game_id,
            "Only owner or game keeper can call buyback"
        );
        assert!(
            env::account_balance() >= near_to_spend,
            "Insufficient balance"
        );
        assert!(self.oracle_price_yocto > 0, "Oracle price not set");

        // Calculate AMSTR equivalent: (near_yocto * 10^18) / oracle_price using 256-bit math
        let near_yocto_256 = U256::from(near_to_spend.as_yoctonear());
        let factor_256 = U256::from(10u128.pow(18));
        let oracle_256 = U256::from(self.oracle_price_yocto);
        let amstr_amount_256 = (near_yocto_256 * factor_256) / oracle_256;
        let amstr_amount = amstr_amount_256.as_u128();

        let burn_amount = (amstr_amount * 90) / 100;
        let stakers_amount = amstr_amount - burn_amount;

        // If staking contract is registered, transfer 10% to staking contract
        let promise = Promise::new(self.token_id.clone()).function_call(
            "ft_burn".to_string(),
            serde_json::to_vec(&serde_json::json!({
                "amount": U128(burn_amount)
            }))
            .unwrap(),
            NearToken::from_yoctonear(1),
            GAS_FOR_FT_TRANSFER,
        );

        if stakers_amount > 0 && !self.staking_id.as_str().is_empty() {
            promise.then(
                Promise::new(self.token_id.clone()).function_call(
                    "ft_transfer_call".to_string(),
                    serde_json::to_vec(&serde_json::json!({
                        "receiver_id": self.staking_id,
                        "amount": U128(stakers_amount),
                        "memo": "Treasury buyback 10% yield",
                        "msg": "reward"
                    }))
                    .unwrap(),
                    NearToken::from_yoctonear(1),
                    GAS_FOR_FT_TRANSFER_CALL,
                ),
            )
        } else {
            promise
        }
    }

    /// Explicitly funds jackpot pools on the game contract per spec (Page 8)
    pub fn fund_jackpot(&mut self, amount: NearToken) -> Promise {
        self.assert_owner();
        assert!(env::account_balance() >= amount, "Insufficient treasury balance");
        Promise::new(self.game_id.clone()).transfer(amount)
    }

    pub fn get_treasury_info(&self) -> (NearToken, U128, u16, NearToken) {
        (
            env::account_balance(),
            U128(self.oracle_price_yocto),
            self.dev_withdrawal_cap_bps,
            self.dev_withdrawn_in_window,
        )
    }

    pub fn get_dev_withdrawal_allowance(&self) -> (U128, U128) {
        let current_balance_yocto = env::account_balance().as_yoctonear();
        let total_window_funds_yocto = current_balance_yocto.saturating_add(self.dev_withdrawn_in_window.as_yoctonear());
        let max_allowed_yocto = (total_window_funds_yocto * (self.dev_withdrawal_cap_bps as u128)) / 10_000;
        (
            U128(self.dev_withdrawn_in_window.as_yoctonear()),
            U128(max_allowed_yocto),
        )
    }

    fn assert_owner(&self) {
        assert_eq!(env::predecessor_account_id(), self.owner_id, "Owner only");
    }
}


#[cfg(test)]
mod tests {
    use super::*;
    use near_sdk::test_utils::VMContextBuilder;
    use near_sdk::testing_env;

    fn get_context(predecessor: AccountId, account_balance: NearToken) -> VMContextBuilder {
        let mut builder = VMContextBuilder::new();
        builder
            .current_account_id("treasury.near".parse().unwrap())
            .signer_account_id(predecessor.clone())
            .predecessor_account_id(predecessor)
            .account_balance(account_balance)
            .block_timestamp(1_000_000_000_000_000_000); // 1s in ns
        builder
    }

    #[test]
    fn test_treasury_initialization() {
        let owner: AccountId = "owner.near".parse().unwrap();
        let token: AccountId = "token.near".parse().unwrap();
        let game: AccountId = "game.near".parse().unwrap();
        let staking: AccountId = "staking.near".parse().unwrap();

        let ctx = get_context(owner.clone(), NearToken::from_near(100));
        testing_env!(ctx.build());

        let oracle_price = 5 * 10u128.pow(22); // 0.05 NEAR per AMSTR
        let contract = Contract::new(owner, token, game, staking, U128(oracle_price), None);

        let (balance, price, dev_cap_bps, withdrawn) = contract.get_treasury_info();
        assert_eq!(balance, NearToken::from_near(100));
        assert_eq!(price.0, oracle_price);
        assert_eq!(dev_cap_bps, 1000); // 10%
        assert_eq!(withdrawn, NearToken::from_yoctonear(0));
    }

    #[test]
    fn test_dev_withdrawal_cap_and_reset() {
        let owner: AccountId = "owner.near".parse().unwrap();
        let token: AccountId = "token.near".parse().unwrap();
        let game: AccountId = "game.near".parse().unwrap();
        let staking: AccountId = "staking.near".parse().unwrap();

        let ctx = get_context(owner.clone(), NearToken::from_near(100));
        testing_env!(ctx.build());

        let mut contract = Contract::new(owner.clone(), token, game, staking, U128(10u128.pow(23)), Some(1000));

        // 10% of 100 NEAR = 10 NEAR cap
        // Withdraw 7 NEAR (under cap)
        let _ = contract.withdraw_dev("dev.near".parse().unwrap(), NearToken::from_near(7));
        let (_, _, _, withdrawn) = contract.get_treasury_info();
        assert_eq!(withdrawn, NearToken::from_near(7));

        // Withdraw 3 NEAR (hits exact 10% cap of 10 NEAR)
        let _ = contract.withdraw_dev("dev.near".parse().unwrap(), NearToken::from_near(3));
        let (_, _, _, withdrawn2) = contract.get_treasury_info();
        assert_eq!(withdrawn2, NearToken::from_near(10));

        // Advance timestamp past 30 days
        let mut ctx_advanced = get_context(owner, NearToken::from_near(90));
        ctx_advanced.block_timestamp(1_000_000_000_000_000_000 + THIRTY_DAYS_NS + 100);
        testing_env!(ctx_advanced.build());

        // 10% of 90 NEAR = 9 NEAR cap
        // Should allow another withdrawal since 30-day window reset
        let _ = contract.withdraw_dev("dev.near".parse().unwrap(), NearToken::from_near(8));
        let (_, _, _, withdrawn3) = contract.get_treasury_info();
        assert_eq!(withdrawn3, NearToken::from_near(8));
    }

    #[test]
    #[should_panic(expected = "Exceeds 30-day withdrawal cap (10% of treasury balance)")]
    fn test_dev_withdrawal_exceeding_cap_panics() {
        let owner: AccountId = "owner.near".parse().unwrap();
        let token: AccountId = "token.near".parse().unwrap();
        let game: AccountId = "game.near".parse().unwrap();
        let staking: AccountId = "staking.near".parse().unwrap();

        let ctx = get_context(owner.clone(), NearToken::from_near(100));
        testing_env!(ctx.build());

        let mut contract = Contract::new(owner, token, game, staking, U128(10u128.pow(23)), None);

        // Balance is 100 NEAR -> 10% cap is 10 NEAR. Attempt to withdraw 11 NEAR panics.
        let _ = contract.withdraw_dev("dev.near".parse().unwrap(), NearToken::from_near(11));
    }

    #[test]
    #[should_panic(expected = "Percentage cap cannot exceed 10%")]
    fn test_owner_cannot_set_cap_above_10_percent_panics() {
        let owner: AccountId = "owner.near".parse().unwrap();
        let token: AccountId = "token.near".parse().unwrap();
        let game: AccountId = "game.near".parse().unwrap();
        let staking: AccountId = "staking.near".parse().unwrap();

        let ctx = get_context(owner.clone(), NearToken::from_near(100));
        testing_env!(ctx.build());

        let mut contract = Contract::new(owner, token, game, staking, U128(10u128.pow(23)), None);
        contract.set_dev_withdrawal_cap_bps(2000); // 20% > 10% maximum -> panics
    }

    #[test]
    fn test_buyback_execution() {
        let owner: AccountId = "owner.near".parse().unwrap();
        let token: AccountId = "token.near".parse().unwrap();
        let game: AccountId = "game.near".parse().unwrap();
        let staking: AccountId = "staking.near".parse().unwrap();

        let ctx = get_context(owner.clone(), NearToken::from_near(50));
        testing_env!(ctx.build());

        let oracle_price = 10u128.pow(23); // 0.1 NEAR per AMSTR
        let mut contract = Contract::new(
            owner,
            token,
            game,
            staking,
            U128(oracle_price),
            None,
        );

        // Run buyback of 10 NEAR
        let _ = contract.run_buyback(NearToken::from_near(10));
    }

    #[test]
    #[should_panic(expected = "Only owner or game keeper can call buyback")]
    fn test_unauthorized_buyback_panics() {
        let owner: AccountId = "owner.near".parse().unwrap();
        let token: AccountId = "token.near".parse().unwrap();
        let game: AccountId = "game.near".parse().unwrap();
        let staking: AccountId = "staking.near".parse().unwrap();
        let hacker: AccountId = "hacker.near".parse().unwrap();

        let ctx = get_context(owner.clone(), NearToken::from_near(50));
        testing_env!(ctx.build());

        let mut contract = Contract::new(
            owner,
            token,
            game,
            staking,
            U128(10u128.pow(23)),
            None,
        );

        let ctx_hacker = get_context(hacker, NearToken::from_near(50));
        testing_env!(ctx_hacker.build());

        let _ = contract.run_buyback(NearToken::from_near(10));
    }
}
