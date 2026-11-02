use near_contract_standards::fungible_token::receiver::FungibleTokenReceiver;
use near_sdk::json_types::U128;
use near_sdk::store::LookupMap;
use near_sdk::{
    env, near, AccountId, Gas, NearToken, PanicOnDefault, Promise, PromiseOrValue,
};
use primitive_types::U256;

pub const GAS_FOR_FT_TRANSFER: Gas = Gas::from_tgas(20);
pub const SCALE_FACTOR: u128 = 1_000_000_000_000_000_000_000_000; // 10^24

#[near(serializers = [borsh, json])]
#[derive(Clone, Default)]
pub struct AccountStake {
    pub staked_amount: u128,
    pub reward_per_token_paid: u128,
    pub unclaimed_rewards: u128,
}

#[near(contract_state)]
#[derive(PanicOnDefault)]
pub struct Contract {
    pub owner_id: AccountId,
    pub token_id: AccountId,
    pub total_staked: u128,
    pub reward_per_token_stored: u128,
    pub accounts: LookupMap<AccountId, AccountStake>,
}

#[near]
impl Contract {
    #[init]
    pub fn new(owner_id: AccountId, token_id: AccountId) -> Self {
        assert!(!env::state_exists(), "Already initialized");
        Self {
            owner_id,
            token_id,
            total_staked: 0,
            reward_per_token_stored: 0,
            accounts: LookupMap::new(b"s"),
        }
    }

    pub fn unstake(&mut self, amount: U128) -> Promise {
        let account_id = env::predecessor_account_id();
        let amount_u128: u128 = amount.into();
        assert!(amount_u128 > 0, "Amount must be > 0");

        let mut user_stake = self.internal_update_rewards(&account_id);
        assert!(
            user_stake.staked_amount >= amount_u128,
            "Insufficient staked balance"
        );

        user_stake.staked_amount -= amount_u128;
        self.total_staked -= amount_u128;
        self.accounts.insert(account_id.clone(), user_stake);

        Promise::new(self.token_id.clone()).function_call(
            "ft_transfer".to_string(),
            serde_json::to_vec(&serde_json::json!({
                "receiver_id": account_id,
                "amount": U128(amount_u128),
                "memo": "AMSTR Staking Unstake"
            }))
            .unwrap(),
            NearToken::from_yoctonear(1),
            GAS_FOR_FT_TRANSFER,
        )
    }

    pub fn claim_rewards(&mut self) -> Promise {
        let account_id = env::predecessor_account_id();
        let mut user_stake = self.internal_update_rewards(&account_id);
        let reward = user_stake.unclaimed_rewards;
        assert!(reward > 0, "No rewards to claim");

        user_stake.unclaimed_rewards = 0;
        self.accounts.insert(account_id.clone(), user_stake);

        Promise::new(self.token_id.clone()).function_call(
            "ft_transfer".to_string(),
            serde_json::to_vec(&serde_json::json!({
                "receiver_id": account_id,
                "amount": U128(reward),
                "memo": "AMSTR Staking Reward Claim"
            }))
            .unwrap(),
            NearToken::from_yoctonear(1),
            GAS_FOR_FT_TRANSFER,
        )
    }

    pub fn get_user_info(&self, account_id: AccountId) -> (U128, U128) {
        if let Some(user_stake) = self.accounts.get(&account_id) {
            let pending = self.calculate_pending_rewards(user_stake);
            (
                U128(user_stake.staked_amount),
                U128(user_stake.unclaimed_rewards + pending),
            )
        } else {
            (U128(0), U128(0))
        }
    }

    pub fn get_total_staked(&self) -> U128 {
        U128(self.total_staked)
    }

    fn calculate_pending_rewards(&self, user_stake: &AccountStake) -> u128 {
        if user_stake.staked_amount == 0 {
            0
        } else {
            let diff = self.reward_per_token_stored.saturating_sub(user_stake.reward_per_token_paid);
            let staked_256 = U256::from(user_stake.staked_amount);
            let diff_256 = U256::from(diff);
            let scale_256 = U256::from(SCALE_FACTOR);
            let pending_256 = (staked_256 * diff_256) / scale_256;
            pending_256.as_u128()
        }
    }

    fn internal_update_rewards(&mut self, account_id: &AccountId) -> AccountStake {
        let mut user_stake = self
            .accounts
            .get(account_id)
            .cloned()
            .unwrap_or_default();
        let pending = self.calculate_pending_rewards(&user_stake);
        user_stake.unclaimed_rewards += pending;
        user_stake.reward_per_token_paid = self.reward_per_token_stored;
        user_stake
    }
}

#[near]
impl FungibleTokenReceiver for Contract {
    fn ft_on_transfer(
        &mut self,
        sender_id: AccountId,
        amount: U128,
        msg: String,
    ) -> PromiseOrValue<U128> {
        assert_eq!(
            env::predecessor_account_id(),
            self.token_id,
            "Only AMSTR token accepted"
        );
        let amount_u128: u128 = amount.into();

        if msg == "reward" || sender_id == self.owner_id {
            // Reward distribution to all current stakers
            if self.total_staked > 0 {
                let amount_256 = U256::from(amount_u128);
                let scale_256 = U256::from(SCALE_FACTOR);
                let total_staked_256 = U256::from(self.total_staked);
                let added_reward_256 = (amount_256 * scale_256) / total_staked_256;
                self.reward_per_token_stored += added_reward_256.as_u128();
            }
        } else {
            // Staking deposit for sender_id
            let mut user_stake = self.internal_update_rewards(&sender_id);
            user_stake.staked_amount += amount_u128;
            self.total_staked += amount_u128;
            self.accounts.insert(sender_id, user_stake);
        }

        PromiseOrValue::Value(U128(0))
    }
}


#[cfg(test)]
mod tests {
    use super::*;
    use near_sdk::test_utils::VMContextBuilder;
    use near_sdk::testing_env;

    fn get_context(predecessor: AccountId) -> VMContextBuilder {
        let mut builder = VMContextBuilder::new();
        builder
            .current_account_id("staking.near".parse().unwrap())
            .signer_account_id(predecessor.clone())
            .predecessor_account_id(predecessor)
            .attached_deposit(NearToken::from_yoctonear(0));
        builder
    }

    #[test]
    fn test_staking_initialization() {
        let owner: AccountId = "owner.near".parse().unwrap();
        let token: AccountId = "token.near".parse().unwrap();

        let ctx = get_context(owner.clone());
        testing_env!(ctx.build());

        let contract = Contract::new(owner, token);
        assert_eq!(contract.get_total_staked().0, 0);
    }

    #[test]
    fn test_stake_and_reward_distribution_proportional() {
        let owner: AccountId = "owner.near".parse().unwrap();
        let token: AccountId = "token.near".parse().unwrap();
        let alice: AccountId = "alice.near".parse().unwrap();
        let bob: AccountId = "bob.near".parse().unwrap();

        let ctx = get_context(owner.clone());
        testing_env!(ctx.build());
        let mut contract = Contract::new(owner.clone(), token.clone());

        // Alice stakes 100 AMSTR
        let ctx_token = get_context(token.clone());
        testing_env!(ctx_token.build());
        let _ = contract.ft_on_transfer(alice.clone(), U128(100 * 10u128.pow(18)), "stake".to_string());

        // Bob stakes 300 AMSTR
        let _ = contract.ft_on_transfer(bob.clone(), U128(300 * 10u128.pow(18)), "stake".to_string());

        assert_eq!(contract.get_total_staked().0, 400 * 10u128.pow(18));

        let (alice_stake, alice_unclaimed) = contract.get_user_info(alice.clone());
        assert_eq!(alice_stake.0, 100 * 10u128.pow(18));
        assert_eq!(alice_unclaimed.0, 0);

        // Treasury deposits 40 AMSTR rewards
        let _ = contract.ft_on_transfer(owner, U128(40 * 10u128.pow(18)), "reward".to_string());

        // Check Alice's pending reward: 100 / 400 * 40 = 10 AMSTR
        let (_, alice_reward) = contract.get_user_info(alice.clone());
        assert_eq!(alice_reward.0, 10 * 10u128.pow(18));

        // Check Bob's pending reward: 300 / 400 * 40 = 30 AMSTR
        let (_, bob_reward) = contract.get_user_info(bob.clone());
        assert_eq!(bob_reward.0, 30 * 10u128.pow(18));

        // Alice claims rewards
        let ctx_alice = get_context(alice.clone());
        testing_env!(ctx_alice.build());
        let _ = contract.claim_rewards();

        let (_, alice_reward_after) = contract.get_user_info(alice);
        assert_eq!(alice_reward_after.0, 0);
    }

    #[test]
    fn test_unstake() {
        let owner: AccountId = "owner.near".parse().unwrap();
        let token: AccountId = "token.near".parse().unwrap();
        let player: AccountId = "player.near".parse().unwrap();

        let ctx = get_context(owner.clone());
        testing_env!(ctx.build());
        let mut contract = Contract::new(owner, token.clone());

        // Player stakes 50 AMSTR
        let ctx_token = get_context(token);
        testing_env!(ctx_token.build());
        let _ = contract.ft_on_transfer(player.clone(), U128(50 * 10u128.pow(18)), "stake".to_string());

        // Player unstakes 20 AMSTR
        let ctx_player = get_context(player.clone());
        testing_env!(ctx_player.build());
        let _ = contract.unstake(U128(20 * 10u128.pow(18)));

        let (staked, _) = contract.get_user_info(player);
        assert_eq!(staked.0, 30 * 10u128.pow(18));
        assert_eq!(contract.get_total_staked().0, 30 * 10u128.pow(18));
    }

    #[test]
    #[should_panic(expected = "Insufficient staked balance")]
    fn test_unstake_exceeding_balance_panics() {
        let owner: AccountId = "owner.near".parse().unwrap();
        let token: AccountId = "token.near".parse().unwrap();
        let player: AccountId = "player.near".parse().unwrap();

        let ctx = get_context(owner.clone());
        testing_env!(ctx.build());
        let mut contract = Contract::new(owner, token.clone());

        let ctx_token = get_context(token);
        testing_env!(ctx_token.build());
        let _ = contract.ft_on_transfer(player.clone(), U128(10 * 10u128.pow(18)), "stake".to_string());

        let ctx_player = get_context(player);
        testing_env!(ctx_player.build());
        let _ = contract.unstake(U128(20 * 10u128.pow(18)));
    }

    #[test]
    fn test_complex_interleaved_stakers_and_rewards() {
        let owner: AccountId = "owner.near".parse().unwrap();
        let token: AccountId = "token.near".parse().unwrap();
        let alice: AccountId = "alice.near".parse().unwrap();
        let bob: AccountId = "bob.near".parse().unwrap();
        let carol: AccountId = "carol.near".parse().unwrap();

        let ctx = get_context(owner.clone());
        testing_env!(ctx.build());
        let mut contract = Contract::new(owner.clone(), token.clone());

        let amstr = 10u128.pow(18);

        // T0: Alice stakes 100 AMSTR
        let ctx_token = get_context(token.clone());
        testing_env!(ctx_token.build());
        let _ = contract.ft_on_transfer(alice.clone(), U128(100 * amstr), "stake".to_string());

        // T1: Reward 1 of 10 AMSTR (100% to Alice)
        let _ = contract.ft_on_transfer(owner.clone(), U128(10 * amstr), "reward".to_string());

        // T2: Bob stakes 300 AMSTR (Total staked: 400 AMSTR, Alice 100, Bob 300)
        let _ = contract.ft_on_transfer(bob.clone(), U128(300 * amstr), "stake".to_string());

        // T3: Reward 2 of 40 AMSTR (Alice gets 10, Bob gets 30)
        let _ = contract.ft_on_transfer(owner.clone(), U128(40 * amstr), "reward".to_string());

        // T4: Alice unstakes 50 AMSTR (Alice staked: 50, Bob staked: 300, Total: 350)
        let ctx_alice = get_context(alice.clone());
        testing_env!(ctx_alice.build());
        let _ = contract.unstake(U128(50 * amstr));

        // T5: Carol stakes 150 AMSTR (Alice: 50, Bob: 300, Carol: 150, Total: 500)
        let ctx_token2 = get_context(token);
        testing_env!(ctx_token2.build());
        let _ = contract.ft_on_transfer(carol.clone(), U128(150 * amstr), "stake".to_string());

        // T6: Reward 3 of 50 AMSTR (Alice gets 5, Bob gets 30, Carol gets 15)
        let _ = contract.ft_on_transfer(owner, U128(50 * amstr), "reward".to_string());

        // Verify pending rewards before claim:
        // Alice: 10 (R1) + 10 (R2) + 5 (R3) = 25 AMSTR
        let (_, alice_reward) = contract.get_user_info(alice.clone());
        assert_eq!(alice_reward.0, 25 * amstr);

        // Bob: 30 (R2) + 30 (R3) = 60 AMSTR
        let (_, bob_reward) = contract.get_user_info(bob.clone());
        assert_eq!(bob_reward.0, 60 * amstr);

        // Carol: 15 (R3) = 15 AMSTR
        let (_, carol_reward) = contract.get_user_info(carol.clone());
        assert_eq!(carol_reward.0, 15 * amstr);

        // Total rewards distributed = 10 + 40 + 50 = 100 AMSTR
        // Total rewards pending = 25 + 60 + 15 = 100 AMSTR exact!
        assert_eq!(alice_reward.0 + bob_reward.0 + carol_reward.0, 100 * amstr);

        // All stakers claim rewards
        let ctx_alice_claim = get_context(alice.clone());
        testing_env!(ctx_alice_claim.build());
        let _ = contract.claim_rewards();

        let ctx_bob_claim = get_context(bob.clone());
        testing_env!(ctx_bob_claim.build());
        let _ = contract.claim_rewards();

        let ctx_carol_claim = get_context(carol.clone());
        testing_env!(ctx_carol_claim.build());
        let _ = contract.claim_rewards();

        // All unclaimed rewards are now 0
        assert_eq!(contract.get_user_info(alice).1 .0, 0);
        assert_eq!(contract.get_user_info(bob).1 .0, 0);
        assert_eq!(contract.get_user_info(carol).1 .0, 0);
    }
}
