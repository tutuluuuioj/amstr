use near_workspaces::types::NearToken;
use serde_json::json;
use sha2::{Digest, Sha256};

fn compute_commit(
    account_id: &str,
    round_id: u64,
    mask: u32,
    salt: &[u8; 32],
) -> [u8; 32] {
    let mut hasher = Sha256::new();
    let acc_bytes = account_id.as_bytes();
    hasher.update(&(acc_bytes.len() as u32).to_le_bytes());
    hasher.update(acc_bytes);
    hasher.update(&round_id.to_le_bytes());
    hasher.update(&mask.to_le_bytes());
    hasher.update(salt);
    hasher.finalize().into()
}

#[tokio::test]
async fn test_near_workspaces_multi_round_simulation() -> Result<(), Box<dyn std::error::Error>> {
    let worker = near_workspaces::sandbox().await?;
    let root = worker.root_account()?;

    // 1. Load WASM binaries
    let game_wasm = std::fs::read("../target/wasm32-unknown-unknown/release/amstr_game.wasm")?;
    let token_wasm = std::fs::read("../target/wasm32-unknown-unknown/release/amstr_token.wasm")?;
    let treasury_wasm = std::fs::read("../target/wasm32-unknown-unknown/release/amstr_treasury.wasm")?;
    let staking_wasm = std::fs::read("../target/wasm32-unknown-unknown/release/amstr_staking.wasm")?;

    // 2. Deploy contracts
    let game_contract = worker.dev_deploy(&game_wasm).await?;
    let token_contract = worker.dev_deploy(&token_wasm).await?;
    let treasury_contract = worker.dev_deploy(&treasury_wasm).await?;
    let staking_contract = worker.dev_deploy(&staking_wasm).await?;

    let owner = root
        .create_subaccount("owner")
        .initial_balance(NearToken::from_near(50))
        .transact()
        .await?
        .into_result()?;
    let alice = root
        .create_subaccount("alice")
        .initial_balance(NearToken::from_near(50))
        .transact()
        .await?
        .into_result()?;
    let bob = root
        .create_subaccount("bob")
        .initial_balance(NearToken::from_near(50))
        .transact()
        .await?
        .into_result()?;

    // 3. Initialize contracts
    println!("Step 1: Init token");
    token_contract
        .call("new")
        .args_json(json!({
            "owner_id": owner.id(),
            "game_contract_id": game_contract.id(),
        }))
        .transact()
        .await?
        .into_result()?;
    println!("Token init ok");

    println!("Step 2: Init treasury");
    treasury_contract
        .call("new")
        .args_json(json!({
            "owner_id": owner.id(),
            "token_id": token_contract.id(),
            "game_id": game_contract.id(),
            "staking_id": staking_contract.id(),
            "oracle_price_yocto": "1000000000000000000000000",
            "dev_withdrawal_cap_bps": 1000,
        }))
        .transact()
        .await?
        .into_result()?;
    println!("Treasury init ok");

    println!("Step 3: Init staking");
    staking_contract
        .call("new")
        .args_json(json!({
            "owner_id": owner.id(),
            "token_id": token_contract.id(),
        }))
        .transact()
        .await?
        .into_result()?;
    println!("Staking init ok");

    println!("Step 4: Init game");
    game_contract
        .call("new")
        .args_json(json!({
            "owner_id": owner.id(),
            "token_id": token_contract.id(),
            "treasury_id": treasury_contract.id(),
            "config": null,
        }))
        .transact()
        .await?
        .into_result()?;
    println!("Game init ok");

    // =========================================================================
    // ROUND 1: Alice & Bob play. Alice wins, claims payout and storage deposit.
    // =========================================================================
    let seed_1 = [11u8; 32];
    let mut hasher = Sha256::new();
    hasher.update(&seed_1);
    let commit_seed_1: [u8; 32] = hasher.finalize().into();
    let seed_commit_b64 = near_sdk::json_types::Base64VecU8(commit_seed_1.to_vec());

    let round_id_val: u64 = owner
        .call(game_contract.id(), "open_round")
        .args_json(json!({
            "seed_commit": seed_commit_b64,
        }))
        .max_gas()
        .transact()
        .await?
        .json()?;

    assert_eq!(round_id_val, 1);

    // Alice deploys 1 NEAR stake + 0.01 NEAR storage deposit on Tile 3
    let mask_alice: u32 = 1 << 3;
    let salt_alice = [1u8; 32];
    let commit_alice = compute_commit(alice.id().as_str(), round_id_val, mask_alice, &salt_alice);

    alice
        .call(game_contract.id(), "deploy")
        .args_json(json!({
            "round_id": round_id_val,
            "ciphertext": near_sdk::json_types::Base64VecU8(vec![1, 2, 3]),
            "commit": near_sdk::json_types::Base64VecU8(commit_alice.to_vec()),
        }))
        .deposit(NearToken::from_millinear(1010)) // 1.01 NEAR
        .max_gas()
        .transact()
        .await?
        .into_result()?;

    // Bob deploys 2 NEAR stake + 0.01 NEAR storage deposit on Tile 7
    let mask_bob: u32 = 1 << 7;
    let salt_bob = [2u8; 32];
    let commit_bob = compute_commit(bob.id().as_str(), round_id_val, mask_bob, &salt_bob);

    bob
        .call(game_contract.id(), "deploy")
        .args_json(json!({
            "round_id": round_id_val,
            "ciphertext": near_sdk::json_types::Base64VecU8(vec![4, 5, 6]),
            "commit": near_sdk::json_types::Base64VecU8(commit_bob.to_vec()),
        }))
        .deposit(NearToken::from_millinear(2010)) // 2.01 NEAR
        .max_gas()
        .transact()
        .await?
        .into_result()?;

    // Fast-forward past 60 blocks deposit window
    worker.fast_forward(70).await?;

    // Close round permissionlessly (e.g. by keeper/user) to lock chain_entropy
    root
        .call(game_contract.id(), "close_round")
        .args_json(json!({
            "round_id": round_id_val,
        }))
        .max_gas()
        .transact()
        .await?
        .into_result()?;

    // Owner/CVM submits reveal batch
    owner
        .call(game_contract.id(), "reveal_batch")
        .args_json(json!({
            "round_id": round_id_val,
            "reveals": [
                {
                    "account": alice.id(),
                    "mask": mask_alice,
                    "salt": near_sdk::json_types::Base64VecU8(salt_alice.to_vec()),
                },
                {
                    "account": bob.id(),
                    "mask": mask_bob,
                    "salt": near_sdk::json_types::Base64VecU8(salt_bob.to_vec()),
                }
            ]
        }))
        .max_gas()
        .transact()
        .await?
        .into_result()?;

    // Settle round 1
    owner
        .call(game_contract.id(), "settle")
        .args_json(json!({
            "round_id": round_id_val,
            "seed": near_sdk::json_types::Base64VecU8(seed_1.to_vec()),
            "sig": near_sdk::json_types::Base64VecU8(vec![0; 64]),
        }))
        .max_gas()
        .transact()
        .await?
        .into_result()?;

    // Verify round is settled
    let round_status: serde_json::Value = game_contract
        .view("get_round")
        .args_json(json!({ "round_id": round_id_val }))
        .await?
        .json()?;
    assert_eq!(round_status["status"], "Settled");

    // Alice claims winnings
    let alice_balance_before = alice.view_account().await?.balance;
    alice
        .call(game_contract.id(), "claim")
        .args_json(json!({
            "round_ids": [round_id_val]
        }))
        .max_gas()
        .transact()
        .await?
        .into_result()?;

    let alice_balance_after = alice.view_account().await?.balance;
    println!(
        "Round 1 settled successfully! Alice balance delta: {}",
        alice_balance_after.as_yoctonear() as i128 - alice_balance_before.as_yoctonear() as i128
    );

    // =========================================================================
    // ROUND 2: Liveness timeout safety -> Refund after unrevealed round expires
    // =========================================================================
    let seed_2 = [22u8; 32];
    let mut h2 = Sha256::new();
    h2.update(&seed_2);
    let commit_seed_2: [u8; 32] = h2.finalize().into();

    let round_2_id: u64 = owner
        .call(game_contract.id(), "open_round")
        .args_json(json!({
            "seed_commit": near_sdk::json_types::Base64VecU8(commit_seed_2.to_vec()),
        }))
        .max_gas()
        .transact()
        .await?
        .json()?;
    assert_eq!(round_2_id, 2);

    // Bob deploys into Round 2
    let mask_b2: u32 = 1 << 12;
    let salt_b2 = [7u8; 32];
    let comm_b2 = compute_commit(bob.id().as_str(), round_2_id, mask_b2, &salt_b2);

    bob
        .call(game_contract.id(), "deploy")
        .args_json(json!({
            "round_id": round_2_id,
            "ciphertext": near_sdk::json_types::Base64VecU8(vec![99]),
            "commit": near_sdk::json_types::Base64VecU8(comm_b2.to_vec()),
        }))
        .deposit(NearToken::from_millinear(1010))
        .max_gas()
        .transact()
        .await?
        .into_result()?;

    let bob_balance_before_refund = bob.view_account().await?.balance;

    // Fast-forward past timeout (600 blocks)
    worker.fast_forward(700).await?;

    // Anyone can call refund_expired to recover user funds
    let refunded_count: u32 = root
        .call(game_contract.id(), "refund_expired")
        .args_json(json!({
            "round_id": round_2_id,
            "limit": 10,
        }))
        .max_gas()
        .transact()
        .await?
        .json()?;

    assert_eq!(refunded_count, 1);

    let round_2_status: serde_json::Value = game_contract
        .view("get_round")
        .args_json(json!({ "round_id": round_2_id }))
        .await?
        .json()?;
    assert_eq!(round_2_status["status"], "Refunded");

    let bob_balance_after_refund = bob.view_account().await?.balance;
    assert!(bob_balance_after_refund > bob_balance_before_refund);
    println!("Round 2 timeout refund succeeded: Bob was fully refunded!");

    Ok(())
}
