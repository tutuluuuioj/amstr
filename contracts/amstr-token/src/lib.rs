use near_contract_standards::fungible_token::metadata::{
    FungibleTokenMetadata, FungibleTokenMetadataProvider, FT_METADATA_SPEC,
};
use near_contract_standards::fungible_token::FungibleToken;
use near_contract_standards::storage_management::{
    StorageBalance, StorageBalanceBounds, StorageManagement,
};
use near_sdk::json_types::U128;
use near_sdk::{
    env, log, near, AccountId, PanicOnDefault, PromiseOrValue,
};

pub const AMSTR_DECIMALS: u8 = 18;
pub const ONE_AMSTR: u128 = 10u128.pow(AMSTR_DECIMALS as u32);
pub const HARD_CAP: u128 = 2_000_000 * ONE_AMSTR;

#[near(contract_state)]
#[derive(PanicOnDefault)]
pub struct Contract {
    token: FungibleToken,
    owner_id: AccountId,
    game_contract_id: AccountId,
    total_minted_lifetime: u128,
}

#[near]
impl Contract {
    #[init]
    pub fn new(owner_id: AccountId, game_contract_id: AccountId) -> Self {
        assert!(!env::state_exists(), "Already initialized");
        Self {
            token: FungibleToken::new(b"a"),
            owner_id,
            game_contract_id,
            total_minted_lifetime: 0,
        }
    }

    pub fn set_game_contract(&mut self, game_contract_id: AccountId) {
        self.assert_owner();
        self.game_contract_id = game_contract_id;
    }

    pub fn mint(&mut self, to: AccountId, amount: U128) {
        assert_eq!(
            env::predecessor_account_id(),
            self.game_contract_id,
            "Only game contract can mint"
        );
        let amount_u128: u128 = amount.into();
        assert!(
            self.total_minted_lifetime + amount_u128 <= HARD_CAP,
            "Exceeds lifetime hard cap of 2,000,000 AMSTR"
        );

        self.total_minted_lifetime += amount_u128;
        // Internal register if needed
        if !self.token.accounts.contains_key(&to) {
            self.token.internal_register_account(&to);
        }
        self.token.internal_deposit(&to, amount_u128);
    }

    #[payable]
    pub fn ft_burn(&mut self, amount: U128) {
        let account_id = env::predecessor_account_id();
        let amount_u128: u128 = amount.into();
        self.token.internal_withdraw(&account_id, amount_u128);
    }

    pub fn get_total_minted_lifetime(&self) -> U128 {
        U128(self.total_minted_lifetime)
    }

    pub fn get_hard_cap(&self) -> U128 {
        U128(HARD_CAP)
    }

    fn assert_owner(&self) {
        assert_eq!(
            env::predecessor_account_id(),
            self.owner_id,
            "Owner only"
        );
    }
}

#[near]
impl near_contract_standards::fungible_token::core::FungibleTokenCore for Contract {
    #[payable]
    fn ft_transfer(&mut self, receiver_id: AccountId, amount: U128, memo: Option<String>) {
        self.token.ft_transfer(receiver_id, amount, memo);
    }

    #[payable]
    fn ft_transfer_call(
        &mut self,
        receiver_id: AccountId,
        amount: U128,
        memo: Option<String>,
        msg: String,
    ) -> PromiseOrValue<U128> {
        self.token.ft_transfer_call(receiver_id, amount, memo, msg)
    }

    fn ft_total_supply(&self) -> U128 {
        self.token.ft_total_supply()
    }

    fn ft_balance_of(&self, account_id: AccountId) -> U128 {
        self.token.ft_balance_of(account_id)
    }
}

#[near]
impl near_contract_standards::fungible_token::resolver::FungibleTokenResolver for Contract {
    fn ft_resolve_transfer(
        &mut self,
        sender_id: AccountId,
        receiver_id: AccountId,
        amount: U128,
    ) -> U128 {
        let (used_amount, burned_amount) =
            self.token
                .internal_ft_resolve_transfer(&sender_id, receiver_id, amount.into());
        if burned_amount > 0 {
            log!("Burned {} tokens from unresolved transfer", burned_amount);
        }
        used_amount.into()
    }
}

#[near]
impl StorageManagement for Contract {
    #[payable]
    fn storage_deposit(
        &mut self,
        account_id: Option<AccountId>,
        registration_only: Option<bool>,
    ) -> StorageBalance {
        self.token.storage_deposit(account_id, registration_only)
    }

    #[payable]
    fn storage_withdraw(&mut self, amount: Option<near_sdk::NearToken>) -> StorageBalance {
        self.token.storage_withdraw(amount)
    }

    #[payable]
    fn storage_unregister(&mut self, force: Option<bool>) -> bool {
        #[allow(unused_variables)]
        if let Some((account_id, balance)) = self.token.internal_storage_unregister(force) {
            true
        } else {
            false
        }
    }

    fn storage_balance_bounds(&self) -> StorageBalanceBounds {
        self.token.storage_balance_bounds()
    }

    fn storage_balance_of(&self, account_id: AccountId) -> Option<StorageBalance> {
        self.token.storage_balance_of(account_id)
    }
}

#[near]
impl FungibleTokenMetadataProvider for Contract {
    fn ft_metadata(&self) -> FungibleTokenMetadata {
        FungibleTokenMetadata {
            spec: FT_METADATA_SPEC.to_string(),
            name: "AMSTR Token".to_string(),
            symbol: "AMSTR".to_string(),
            icon: None,
            reference: None,
            reference_hash: None,
            decimals: AMSTR_DECIMALS,
        }
    }
}


#[cfg(test)]
mod tests {
    use super::*;
    use near_contract_standards::fungible_token::core::FungibleTokenCore;
    use near_sdk::test_utils::VMContextBuilder;
    use near_sdk::{testing_env, NearToken};

    fn get_context(predecessor: AccountId, attached: NearToken) -> VMContextBuilder {
        let mut builder = VMContextBuilder::new();
        builder
            .current_account_id("token.near".parse().unwrap())
            .signer_account_id(predecessor.clone())
            .predecessor_account_id(predecessor)
            .attached_deposit(attached);
        builder
    }

    #[test]
    fn test_token_initialization_and_metadata() {
        let owner: AccountId = "owner.near".parse().unwrap();
        let game: AccountId = "game.near".parse().unwrap();
        let ctx = get_context(owner.clone(), NearToken::from_yoctonear(0));
        testing_env!(ctx.build());

        let contract = Contract::new(owner, game);
        assert_eq!(contract.get_total_minted_lifetime().0, 0);
        assert_eq!(contract.get_hard_cap().0, HARD_CAP);

        let metadata = contract.ft_metadata();
        assert_eq!(metadata.symbol, "AMSTR");
        assert_eq!(metadata.decimals, AMSTR_DECIMALS);
    }

    #[test]
    fn test_mint_by_game_contract_and_hard_cap() {
        let owner: AccountId = "owner.near".parse().unwrap();
        let game: AccountId = "game.near".parse().unwrap();
        let player: AccountId = "player.near".parse().unwrap();

        let ctx = get_context(owner.clone(), NearToken::from_yoctonear(0));
        testing_env!(ctx.build());
        let mut contract = Contract::new(owner, game.clone());

        // Mint from game contract
        let ctx_game = get_context(game.clone(), NearToken::from_yoctonear(0));
        testing_env!(ctx_game.build());

        let mint_amount = 1_000 * ONE_AMSTR;
        contract.mint(player.clone(), U128(mint_amount));

        assert_eq!(contract.ft_balance_of(player.clone()).0, mint_amount);
        assert_eq!(contract.get_total_minted_lifetime().0, mint_amount);
        assert_eq!(contract.ft_total_supply().0, mint_amount);
    }

    #[test]
    #[should_panic(expected = "Only game contract can mint")]
    fn test_unauthorized_mint_panics() {
        let owner: AccountId = "owner.near".parse().unwrap();
        let game: AccountId = "game.near".parse().unwrap();
        let hacker: AccountId = "hacker.near".parse().unwrap();

        let ctx = get_context(owner.clone(), NearToken::from_yoctonear(0));
        testing_env!(ctx.build());
        let mut contract = Contract::new(owner, game);

        let ctx_hacker = get_context(hacker.clone(), NearToken::from_yoctonear(0));
        testing_env!(ctx_hacker.build());

        contract.mint(hacker, U128(1_000));
    }

    #[test]
    #[should_panic(expected = "Exceeds lifetime hard cap of 2,000,000 AMSTR")]
    fn test_mint_exceeds_hard_cap_panics() {
        let owner: AccountId = "owner.near".parse().unwrap();
        let game: AccountId = "game.near".parse().unwrap();
        let player: AccountId = "player.near".parse().unwrap();

        let ctx = get_context(owner.clone(), NearToken::from_yoctonear(0));
        testing_env!(ctx.build());
        let mut contract = Contract::new(owner, game.clone());

        let ctx_game = get_context(game, NearToken::from_yoctonear(0));
        testing_env!(ctx_game.build());

        // Attempt to mint beyond 2,000,000 AMSTR
        let over_cap = HARD_CAP + 1;
        contract.mint(player, U128(over_cap));
    }

    #[test]
    fn test_ft_burn() {
        let owner: AccountId = "owner.near".parse().unwrap();
        let game: AccountId = "game.near".parse().unwrap();
        let holder: AccountId = "holder.near".parse().unwrap();

        let ctx = get_context(owner.clone(), NearToken::from_yoctonear(0));
        testing_env!(ctx.build());
        let mut contract = Contract::new(owner, game.clone());

        // Mint to holder
        let ctx_game = get_context(game, NearToken::from_yoctonear(0));
        testing_env!(ctx_game.build());
        contract.mint(holder.clone(), U128(100 * ONE_AMSTR));

        // Holder burns 40 AMSTR
        let ctx_holder = get_context(holder.clone(), NearToken::from_yoctonear(0));
        testing_env!(ctx_holder.build());
        contract.ft_burn(U128(40 * ONE_AMSTR));

        assert_eq!(contract.ft_balance_of(holder).0, 60 * ONE_AMSTR);
        assert_eq!(contract.ft_total_supply().0, 60 * ONE_AMSTR);
    }

    #[test]
    #[should_panic(expected = "Exceeds lifetime hard cap of 2,000,000 AMSTR")]
    fn test_burned_tokens_do_not_free_up_room_under_hard_cap() {
        let owner: AccountId = "owner.near".parse().unwrap();
        let game: AccountId = "game.near".parse().unwrap();
        let player: AccountId = "player.near".parse().unwrap();

        let ctx = get_context(owner.clone(), NearToken::from_yoctonear(0));
        testing_env!(ctx.build());
        let mut contract = Contract::new(owner, game.clone());

        let ctx_game = get_context(game.clone(), NearToken::from_yoctonear(0));
        testing_env!(ctx_game.build());

        // 1. Mint 1,800,000 AMSTR (out of 2,000,000 max)
        contract.mint(player.clone(), U128(1_800_000 * ONE_AMSTR));
        assert_eq!(contract.get_total_minted_lifetime().0, 1_800_000 * ONE_AMSTR);

        // 2. Holder burns 500,000 AMSTR -> circulating supply drops to 1,300,000 AMSTR
        let ctx_player = get_context(player.clone(), NearToken::from_yoctonear(0));
        testing_env!(ctx_player.build());
        contract.ft_burn(U128(500_000 * ONE_AMSTR));
        assert_eq!(contract.ft_total_supply().0, 1_300_000 * ONE_AMSTR);

        // 3. Game attempts to mint 300,000 AMSTR.
        // Even though current supply is only 1.3M, lifetime minted would be 1.8M + 0.3M = 2.1M > 2.0M.
        // Must panic and refuse to mint!
        let ctx_game2 = get_context(game, NearToken::from_yoctonear(0));
        testing_env!(ctx_game2.build());
        contract.mint(player, U128(300_000 * ONE_AMSTR));
    }
}
