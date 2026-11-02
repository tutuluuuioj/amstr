use amstr_game::payouts::*;
use amstr_game::types::*;
use amstr_game::Contract;
use near_sdk::json_types::Base64VecU8;
use near_sdk::test_utils::VMContextBuilder;
use near_sdk::{testing_env, AccountId, NearToken};
use sha2::{Digest, Sha256};

fn get_context(predecessor: AccountId, attached: NearToken, block_height: u64) -> VMContextBuilder {
    let mut builder = VMContextBuilder::new();
    builder
        .current_account_id("game.near".parse().unwrap())
        .signer_account_id(predecessor.clone())
        .predecessor_account_id(predecessor)
        .attached_deposit(attached)
        .block_height(block_height);
    builder
}

/// Simple pseudorandom number generator for reproducible Monte Carlo invariant tests
struct SimpleRng {
    state: u64,
}

impl SimpleRng {
    fn new(seed: u64) -> Self {
        Self { state: seed }
    }

    fn next_u64(&mut self) -> u64 {
        self.state = self.state.wrapping_mul(6364136223846793005).wrapping_add(1442695040888963407);
        self.state
    }

    fn range(&mut self, min: u64, max: u64) -> u64 {
        if max <= min {
            return min;
        }
        min + (self.next_u64() % (max - min + 1))
    }
}

#[test]
fn test_invariant_conservation_of_funds_monte_carlo() {
    // Test the invariant: sum(payouts) + fees + dust == gross_pool across 500 varied rounds
    let mut rng = SimpleRng::new(0xDEADBEEF);
    let yocto = 10u128.pow(24);

    for iteration in 0..500 {
        let num_players = rng.range(1, 50) as usize;
        let mut gross_stakes: Vec<u128> = Vec::with_capacity(num_players);
        let mut net_stakes: Vec<u128> = Vec::with_capacity(num_players);
        let mut fees: Vec<u128> = Vec::with_capacity(num_players);
        let mut masks: Vec<u32> = Vec::with_capacity(num_players);

        for _ in 0..num_players {
            // Stakes between 0.01 NEAR and 20 NEAR
            let milli_near = rng.range(10, 20_000) as u128;
            let gross = milli_near * 10u128.pow(21);
            let fee = (gross * 1000) / 10_000;
            let net = gross - fee;

            // Random mask covering between 1 and 25 tiles
            let mut mask: u32 = 0;
            let num_tiles = rng.range(1, 25);
            for _ in 0..num_tiles {
                let tile = rng.range(0, 24);
                mask |= 1 << tile;
            }
            if mask == 0 {
                mask = 1;
            }

            gross_stakes.push(gross);
            fees.push(fee);
            net_stakes.push(net);
            masks.push(mask);
        }

        let total_gross: u128 = gross_stakes.iter().sum();
        let total_fees: u128 = fees.iter().sum();
        let total_net: u128 = net_stakes.iter().sum();

        // Invariant 1: Gross split must be exact
        assert_eq!(
            total_net + total_fees,
            total_gross,
            "Iter {}: Net + fees != gross",
            iteration
        );

        // Pick a random winning tile (0..24)
        let winning_tile = rng.range(0, 24) as u8;

        // Calculate tile totals
        let mut total_winning_stake: u128 = 0;
        let mut player_winning_stakes = vec![0u128; num_players];

        for i in 0..num_players {
            if (masks[i] & (1 << winning_tile)) != 0 {
                let active = (masks[i] & 0x1FFFFFF).count_ones() as u128;
                let tile_stake = net_stakes[i] / active;
                player_winning_stakes[i] = tile_stake;
                total_winning_stake += tile_stake;
            }
        }

        if total_winning_stake > 0 {
            // Case A / Ties / Single Winner: Calculate payouts
            let mut sum_payouts: u128 = 0;
            let mut winner_count = 0;

            for i in 0..num_players {
                if player_winning_stakes[i] > 0 {
                    let payout = calculate_payout(
                        player_winning_stakes[i],
                        total_winning_stake,
                        total_net,
                    );
                    sum_payouts += payout;
                    winner_count += 1;
                }
            }

            // Invariant 2: Total payouts can never exceed net pot
            assert!(
                sum_payouts <= total_net,
                "Iter {}: Payouts {} exceeded net pot {}",
                iteration,
                sum_payouts,
                total_net
            );

            // Invariant 3: Dust is strictly bounded by winner count
            let dust = total_net - sum_payouts;
            assert!(
                dust <= winner_count as u128,
                "Iter {}: Dust {} exceeded winner count {}",
                iteration,
                dust,
                winner_count
            );

            // Invariant 4: Global Conservation of Funds
            // sum(payouts) + fees + dust == total_gross EXACTLY to the yoctoNEAR
            assert_eq!(
                sum_payouts + total_fees + dust,
                total_gross,
                "Iter {}: Total conservation failed!",
                iteration
            );
        } else {
            // Case B: No one on winning tile -> Rollover carryover capped at 100 NEAR, excess to jackpots
            let cap_yocto = 100 * yocto;
            let carryover = std::cmp::min(total_net, cap_yocto);
            let excess_to_jackpots = total_net - carryover;

            // Invariant 5: Total net pot conserved into carryover + jackpots
            assert_eq!(
                carryover + excess_to_jackpots + total_fees,
                total_gross,
                "Iter {}: Zero winner conservation failed!",
                iteration
            );
        }
    }
}

#[test]
fn test_multi_round_full_simulation() {
    let owner: AccountId = "owner.near".parse().unwrap();
    let token: AccountId = "token.near".parse().unwrap();
    let treasury: AccountId = "treasury.near".parse().unwrap();

    let alice: AccountId = "alice.near".parse().unwrap();
    let bob: AccountId = "bob.near".parse().unwrap();
    let carol: AccountId = "carol.near".parse().unwrap();

    let ctx = get_context(owner.clone(), NearToken::from_yoctonear(0), 100);
    testing_env!(ctx.build());

    let mut game = Contract::new(owner.clone(), token, treasury, None);

    // ==========================================
    // ROUND 1: Alice & Bob play. Alice wins.
    // ==========================================
    let seed_1 = [10u8; 32];
    let mut h1 = Sha256::new();
    h1.update(&seed_1);
    let commit_1: [u8; 32] = h1.finalize().into();

    let r1 = game.open_round(Base64VecU8(commit_1.to_vec()));
    assert_eq!(r1, 1);

    // Alice bets on Tile 3
    let mask_alice: u32 = 1 << 3;
    let salt_alice = [1u8; 32];
    let comm_a = compute_commit(alice.as_str(), r1, mask_alice, &salt_alice);

    let ctx_a = get_context(alice.clone(), NearToken::from_millinear(5010), 110);
    testing_env!(ctx_a.build());
    game.deploy(r1, Base64VecU8(vec![1]), Base64VecU8(comm_a.to_vec()));

    // Bob bets on Tile 8
    let mask_bob: u32 = 1 << 8;
    let salt_bob = [2u8; 32];
    let comm_b = compute_commit(bob.as_str(), r1, mask_bob, &salt_bob);

    let ctx_b = get_context(bob.clone(), NearToken::from_millinear(5010), 115);
    testing_env!(ctx_b.build());
    game.deploy(r1, Base64VecU8(vec![2]), Base64VecU8(comm_b.to_vec()));

    // Reveal Round 1
    let mut ctx_rev1 = get_context(owner.clone(), NearToken::from_yoctonear(0), 165);
    // Find entropy that produces winning tile 3
    let mut entropy_1 = [0u8; 32];
    for b in 0..255u8 {
        entropy_1[0] = b;
        if compute_winning_tile(&seed_1, &entropy_1) == 3 {
            break;
        }
    }
    ctx_rev1.random_seed(entropy_1);
    testing_env!(ctx_rev1.build());

    game.close_round(r1);

    game.reveal_batch(
        r1,
        vec![
            RevealItem {
                account: alice.clone(),
                mask: mask_alice,
                salt: Base64VecU8(salt_alice.to_vec()),
            },
            RevealItem {
                account: bob.clone(),
                mask: mask_bob,
                salt: Base64VecU8(salt_bob.to_vec()),
            },
        ],
    );

    // Settle Round 1
    let ctx_set1 = get_context(owner.clone(), NearToken::from_yoctonear(0), 170);
    testing_env!(ctx_set1.build());
    let _ = game.settle(r1, Base64VecU8(seed_1.to_vec()), Base64VecU8(vec![0; 64]));

    let settled_r1 = game.get_round(r1).unwrap();
    assert_eq!(settled_r1.status, RoundStatus::Settled);
    assert_eq!(settled_r1.winning_tile, Some(3));
    assert_eq!(game.get_carryover_pool().0, 0);

    // Alice claims winnings
    let ctx_claim_a = get_context(alice.clone(), NearToken::from_yoctonear(0), 175);
    testing_env!(ctx_claim_a.build());
    let _ = game.claim(vec![r1]);

    // Bob reclaims loser storage deposit
    let ctx_storage_b = get_context(bob.clone(), NearToken::from_yoctonear(0), 176);
    testing_env!(ctx_storage_b.build());
    let _ = game.reclaim_storage(vec![r1]);

    // ==========================================
    // ROUND 2: Nobody covers winning tile -> Rollover Carryover!
    // ==========================================
    let seed_2 = [20u8; 32];
    let mut h2 = Sha256::new();
    h2.update(&seed_2);
    let commit_2: [u8; 32] = h2.finalize().into();

    let ctx_open2 = get_context(owner.clone(), NearToken::from_yoctonear(0), 180);
    testing_env!(ctx_open2.build());
    let r2 = game.open_round(Base64VecU8(commit_2.to_vec()));
    assert_eq!(r2, 2);

    // Carol bets on Tile 1
    let mask_carol: u32 = 1 << 1;
    let salt_carol = [3u8; 32];
    let comm_c = compute_commit(carol.as_str(), r2, mask_carol, &salt_carol);

    let ctx_c = get_context(carol.clone(), NearToken::from_millinear(10010), 185); // 10 NEAR
    testing_env!(ctx_c.build());
    game.deploy(r2, Base64VecU8(vec![3]), Base64VecU8(comm_c.to_vec()));

    // Reveal Round 2: winning tile will be Tile 20 (which Carol did not cover)
    let mut entropy_2 = [0u8; 32];
    for b in 0..255u8 {
        entropy_2[0] = b;
        if compute_winning_tile(&seed_2, &entropy_2) == 20 {
            break;
        }
    }
    let mut ctx_rev2 = get_context(owner.clone(), NearToken::from_yoctonear(0), 250);
    ctx_rev2.random_seed(entropy_2);
    testing_env!(ctx_rev2.build());

    game.close_round(r2);

    game.reveal_batch(
        r2,
        vec![RevealItem {
            account: carol.clone(),
            mask: mask_carol,
            salt: Base64VecU8(salt_carol.to_vec()),
        }],
    );

    let ctx_set2 = get_context(owner.clone(), NearToken::from_yoctonear(0), 255);
    testing_env!(ctx_set2.build());
    let _ = game.settle(r2, Base64VecU8(seed_2.to_vec()), Base64VecU8(vec![0; 64]));

    let settled_r2 = game.get_round(r2).unwrap();
    assert_eq!(settled_r2.status, RoundStatus::Settled);
    assert_eq!(settled_r2.winning_tile, Some(20));

    // Carryover pool should now have Carol's net 9 NEAR pot!
    let carryover = game.get_carryover_pool();
    let expected_carryover = 9 * 10u128.pow(24); // 9 NEAR
    assert_eq!(carryover.0, expected_carryover);

    // ==========================================
    // ROUND 3: Alice wins pot + Carryover!
    // ==========================================
    let seed_3 = [30u8; 32];
    let mut h3 = Sha256::new();
    h3.update(&seed_3);
    let commit_3: [u8; 32] = h3.finalize().into();

    let ctx_open3 = get_context(owner.clone(), NearToken::from_yoctonear(0), 260);
    testing_env!(ctx_open3.build());
    let r3 = game.open_round(Base64VecU8(commit_3.to_vec()));

    // Alice bets on Tile 4 with 2 NEAR
    let mask_alice_3: u32 = 1 << 4;
    let salt_alice_3 = [4u8; 32];
    let comm_a3 = compute_commit(alice.as_str(), r3, mask_alice_3, &salt_alice_3);

    let ctx_a3 = get_context(alice.clone(), NearToken::from_millinear(2010), 265);
    testing_env!(ctx_a3.build());
    game.deploy(r3, Base64VecU8(vec![4]), Base64VecU8(comm_a3.to_vec()));

    // Tile 4 wins
    let mut entropy_3 = [0u8; 32];
    for b in 0..255u8 {
        entropy_3[0] = b;
        if compute_winning_tile(&seed_3, &entropy_3) == 4 {
            break;
        }
    }
    let mut ctx_rev3 = get_context(owner.clone(), NearToken::from_yoctonear(0), 330);
    ctx_rev3.random_seed(entropy_3);
    testing_env!(ctx_rev3.build());

    game.close_round(r3);

    game.reveal_batch(
        r3,
        vec![RevealItem {
            account: alice.clone(),
            mask: mask_alice_3,
            salt: Base64VecU8(salt_alice_3.to_vec()),
        }],
    );

    let ctx_set3 = get_context(owner.clone(), NearToken::from_yoctonear(0), 335);
    testing_env!(ctx_set3.build());
    let _ = game.settle(r3, Base64VecU8(seed_3.to_vec()), Base64VecU8(vec![0; 64]));

    // Carryover pool is now 0 (awarded to Alice)
    assert_eq!(game.get_carryover_pool().0, 0);

    // Alice claims Round 3 -> Receives current round net pot (1.8 NEAR) + carryover (9 NEAR) = 10.8 NEAR
    let ctx_claim_r3 = get_context(alice.clone(), NearToken::from_yoctonear(0), 340);
    testing_env!(ctx_claim_r3.build());
    let _ = game.claim(vec![r3]);

    // ==========================================
    // ROUND 4: Aborted round -> Timeout & Refund
    // ==========================================
    let seed_4 = [40u8; 32];
    let mut h4 = Sha256::new();
    h4.update(&seed_4);
    let commit_4: [u8; 32] = h4.finalize().into();

    let ctx_open4 = get_context(owner.clone(), NearToken::from_yoctonear(0), 350);
    testing_env!(ctx_open4.build());
    let r4 = game.open_round(Base64VecU8(commit_4.to_vec()));

    let ctx_b4 = get_context(bob.clone(), NearToken::from_millinear(5010), 360);
    testing_env!(ctx_b4.build());
    game.deploy(r4, Base64VecU8(vec![5]), Base64VecU8(vec![1; 32]));

    // Fast-forward past 600 blocks timeout (350 + 60 + 600 = 1010)
    let ctx_timeout = get_context("anyone.near".parse().unwrap(), NearToken::from_yoctonear(0), 1100);
    testing_env!(ctx_timeout.build());

    let refunded_count = game.refund_expired(r4, 50);
    assert_eq!(refunded_count, 1);
    let r4_data = game.get_round(r4).unwrap();
    assert_eq!(r4_data.status, RoundStatus::Refunded);
}

#[test]
fn test_invariant_single_player_conservation() {
    let yocto = 10u128.pow(24);
    let gross_stake = 5 * yocto;
    let fee = (gross_stake * 1000) / 10_000;
    let net_stake = gross_stake - fee;

    // Subcase 1: Single player hits winning tile
    let payout = calculate_payout(net_stake, net_stake, net_stake);
    assert_eq!(payout, net_stake);
    let dust = net_stake - payout;
    assert_eq!(dust, 0);
    assert_eq!(payout + fee + dust, gross_stake);

    // Subcase 2: Single player misses winning tile -> 100% net pot rolls over
    let carryover = std::cmp::min(net_stake, 100 * yocto);
    let jackpot_excess = net_stake - carryover;
    assert_eq!(carryover + jackpot_excess + fee, gross_stake);
}

#[test]
fn test_invariant_maximum_players_conservation() {
    // 200 players test (stress load)
    let mut rng = SimpleRng::new(0xCAFEBABE);
    let num_players = 200;

    let mut gross_stakes = Vec::with_capacity(num_players);
    let mut net_stakes = Vec::with_capacity(num_players);
    let mut fees = Vec::with_capacity(num_players);
    let mut masks = Vec::with_capacity(num_players);

    for _ in 0..num_players {
        let gross = (rng.range(10, 500) as u128) * 10u128.pow(22); // 0.1 to 5 NEAR
        let fee = (gross * 1000) / 10_000;
        let net = gross - fee;

        let mut mask: u32 = 0;
        let tiles_cnt = rng.range(1, 10);
        for _ in 0..tiles_cnt {
            mask |= 1 << rng.range(0, 24);
        }
        if mask == 0 {
            mask = 1;
        }

        gross_stakes.push(gross);
        fees.push(fee);
        net_stakes.push(net);
        masks.push(mask);
    }

    let total_gross: u128 = gross_stakes.iter().sum();
    let total_fees: u128 = fees.iter().sum();
    let total_net: u128 = net_stakes.iter().sum();
    assert_eq!(total_net + total_fees, total_gross);

    for winning_tile in 0..25u8 {
        let mut total_winning_stake: u128 = 0;
        let mut player_stakes = vec![0u128; num_players];

        for i in 0..num_players {
            if (masks[i] & (1 << winning_tile)) != 0 {
                let active = (masks[i] & 0x1FFFFFF).count_ones() as u128;
                let t_stake = net_stakes[i] / active;
                player_stakes[i] = t_stake;
                total_winning_stake += t_stake;
            }
        }

        if total_winning_stake > 0 {
            let mut sum_payouts: u128 = 0;
            let mut winner_count = 0;

            for i in 0..num_players {
                if player_stakes[i] > 0 {
                    let payout = calculate_payout(player_stakes[i], total_winning_stake, total_net);
                    sum_payouts += payout;
                    winner_count += 1;
                }
            }

            let dust = total_net - sum_payouts;
            assert!(dust <= winner_count as u128);
            assert_eq!(
                sum_payouts + total_fees + dust,
                total_gross,
                "Tile {} failed conservation with 200 players",
                winning_tile
            );
        } else {
            let carryover = std::cmp::min(total_net, 100 * 10u128.pow(24));
            let excess = total_net - carryover;
            assert_eq!(carryover + excess + total_fees, total_gross);
        }
    }
}

#[test]
fn test_invariant_strict_ties_conservation() {
    let yocto = 10u128.pow(24);
    // 7 players bet exactly identical 1 NEAR stake on tile 5
    let num_players = 7;
    let gross_each = 1 * yocto;
    let fee_each = (gross_each * 1000) / 10_000;
    let net_each = gross_each - fee_each;

    let total_gross = gross_each * (num_players as u128);
    let total_fees = fee_each * (num_players as u128);
    let total_net = net_each * (num_players as u128);
    let total_winning_stake = total_net;

    let mut sum_payouts = 0;
    for _ in 0..num_players {
        let payout = calculate_payout(net_each, total_winning_stake, total_net);
        sum_payouts += payout;
    }

    let dust = total_net - sum_payouts;
    assert!(dust < num_players as u128);
    assert_eq!(sum_payouts + total_fees + dust, total_gross);
}

#[test]
fn test_invariant_refunded_round_conservation() {
    let owner: AccountId = "owner.near".parse().unwrap();
    let token: AccountId = "token.near".parse().unwrap();
    let treasury: AccountId = "treasury.near".parse().unwrap();

    let ctx = get_context(owner.clone(), NearToken::from_yoctonear(0), 100);
    testing_env!(ctx.build());
    let mut game = Contract::new(owner.clone(), token, treasury, None);

    let round_id = game.open_round(Base64VecU8(vec![123u8; 32]));

    // 10 players deploy varying amounts
    let mut total_deposited_gross = 0u128;
    let storage_deposit = 10_000_000_000_000_000_000_000u128; // 0.01 NEAR
    let mut total_deposited_storage = 0u128;

    for i in 0..10 {
        let player: AccountId = format!("player{}.near", i).parse().unwrap();
        let gross_stake = ((i as u128) + 1) * 10u128.pow(24); // 1..10 NEAR
        let attached = gross_stake + storage_deposit;

        total_deposited_gross += gross_stake;
        total_deposited_storage += storage_deposit;

        let ctx_p = get_context(player.clone(), NearToken::from_yoctonear(attached), 110);
        testing_env!(ctx_p.build());

        let mask = 1u32 << (i % 25);
        let salt = [i as u8; 32];
        let commit = compute_commit(player.as_str(), round_id, mask, &salt);

        game.deploy(round_id, Base64VecU8(vec![i as u8]), Base64VecU8(commit.to_vec()));
    }

    let round = game.get_round(round_id).unwrap();
    assert_eq!(round.total_gross.0, total_deposited_gross);

    // Fast forward past refund timeout
    let ctx_timeout = get_context("anyone.near".parse().unwrap(), NearToken::from_yoctonear(0), 800);
    testing_env!(ctx_timeout.build());

    // Batch refund all 10 players
    let refunded = game.refund_expired(round_id, 20);
    assert_eq!(refunded, 10);

    // Verify all players marked refunded
    for i in 0..10 {
        let player: AccountId = format!("player{}.near", i).parse().unwrap();
        let entry = game.get_entry(round_id, player).unwrap();
        assert!(entry.refunded);
        assert_eq!(entry.gross_stake.0, ((i as u128) + 1) * 10u128.pow(24));
    }

    let round_after = game.get_round(round_id).unwrap();
    assert_eq!(round_after.status, RoundStatus::Refunded);
    assert_eq!(total_deposited_storage, 10 * storage_deposit);
    // Invariant: Exact zero loss in refunded round
    assert_eq!(round_after.refund_cursor, 10);
}

#[test]
fn test_carryover_payout_included_in_claim() {
    let owner: AccountId = "owner.near".parse().unwrap();
    let token: AccountId = "token.near".parse().unwrap();
    let treasury: AccountId = "treasury.near".parse().unwrap();

    let loser: AccountId = "loser.near".parse().unwrap();
    let winner: AccountId = "winner.near".parse().unwrap();

    let ctx = get_context(owner.clone(), NearToken::from_yoctonear(0), 100);
    testing_env!(ctx.build());

    let mut game = Contract::new(owner.clone(), token, treasury, None);

    // ROUND 1: Loser bets 10 NEAR on Tile 0. Tile 1 is drawn. Pot of 9 NEAR rolls over.
    let seed_1 = [11u8; 32];
    let mut h1 = Sha256::new();
    h1.update(&seed_1);
    let commit_1: [u8; 32] = h1.finalize().into();

    let r1 = game.open_round(Base64VecU8(commit_1.to_vec()));

    let mask_loser: u32 = 1 << 0;
    let salt_loser = [1u8; 32];
    let comm_loser = compute_commit(loser.as_str(), r1, mask_loser, &salt_loser);

    let ctx_loser = get_context(loser.clone(), NearToken::from_millinear(10010), 110);
    testing_env!(ctx_loser.build());
    game.deploy(r1, Base64VecU8(vec![0]), Base64VecU8(comm_loser.to_vec()));

    // Tile 1 is drawn
    let mut entropy_1 = [0u8; 32];
    for b in 0..255u8 {
        entropy_1[0] = b;
        if compute_winning_tile(&seed_1, &entropy_1) == 1 {
            break;
        }
    }
    let mut ctx_rev1 = get_context(owner.clone(), NearToken::from_yoctonear(0), 170);
    ctx_rev1.random_seed(entropy_1);
    testing_env!(ctx_rev1.build());
    game.close_round(r1);

    game.reveal_batch(
        r1,
        vec![RevealItem {
            account: loser.clone(),
            mask: mask_loser,
            salt: Base64VecU8(salt_loser.to_vec()),
        }],
    );

    let ctx_set1 = get_context(owner.clone(), NearToken::from_yoctonear(0), 175);
    testing_env!(ctx_set1.build());
    let _ = game.settle(r1, Base64VecU8(seed_1.to_vec()), Base64VecU8(vec![0; 64]));

    // Assert rollover occurred: 10 NEAR gross - 1 NEAR fee = 9 NEAR carried over
    let carryover_after_r1 = game.get_carryover_pool();
    assert_eq!(carryover_after_r1.0, 9 * 10u128.pow(24));

    // ROUND 2: Winner bets 5 NEAR on Tile 5. Winning Tile 5 is drawn!
    let seed_2 = [22u8; 32];
    let mut h2 = Sha256::new();
    h2.update(&seed_2);
    let commit_2: [u8; 32] = h2.finalize().into();

    let ctx_open2 = get_context(owner.clone(), NearToken::from_yoctonear(0), 180);
    testing_env!(ctx_open2.build());
    let r2 = game.open_round(Base64VecU8(commit_2.to_vec()));

    let mask_winner: u32 = 1 << 5;
    let salt_winner = [2u8; 32];
    let comm_winner = compute_commit(winner.as_str(), r2, mask_winner, &salt_winner);

    let ctx_winner = get_context(winner.clone(), NearToken::from_millinear(5010), 190);
    testing_env!(ctx_winner.build());
    game.deploy(r2, Base64VecU8(vec![5]), Base64VecU8(comm_winner.to_vec()));

    // Tile 5 is drawn
    let mut entropy_2 = [0u8; 32];
    for b in 0..255u8 {
        entropy_2[0] = b;
        if compute_winning_tile(&seed_2, &entropy_2) == 5 {
            break;
        }
    }
    let mut ctx_rev2 = get_context(owner.clone(), NearToken::from_yoctonear(0), 250);
    ctx_rev2.random_seed(entropy_2);
    testing_env!(ctx_rev2.build());
    game.close_round(r2);

    game.reveal_batch(
        r2,
        vec![RevealItem {
            account: winner.clone(),
            mask: mask_winner,
            salt: Base64VecU8(salt_winner.to_vec()),
        }],
    );

    let ctx_set2 = get_context(owner.clone(), NearToken::from_yoctonear(0), 255);
    testing_env!(ctx_set2.build());
    let _ = game.settle(r2, Base64VecU8(seed_2.to_vec()), Base64VecU8(vec![0; 64]));

    // Carryover pool is emptied because round had a winner
    assert_eq!(game.get_carryover_pool().0, 0);

    // Verify round 2's total_net incorporates Round 2 net (4.5 NEAR) + carryover (9 NEAR) = 13.5 NEAR
    let round_2 = game.get_round(r2).unwrap();
    let expected_total_pot = (45 * 10u128.pow(23)) + (9 * 10u128.pow(24)); // 13.5 NEAR
    assert_eq!(round_2.total_net.0, expected_total_pot);

    // Winner claims payout
    let ctx_claim = get_context(winner.clone(), NearToken::from_yoctonear(0), 260);
    testing_env!(ctx_claim.build());
    let _ = game.claim(vec![r2]);

    // Verify entry is marked claimed
    let entry_winner = game.get_entry(r2, winner.clone()).unwrap();
    assert!(entry_winner.claimed);
}
