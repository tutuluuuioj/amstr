use near_sdk::AccountId;
use primitive_types::U256;
use sha2::{Digest, Sha256};

pub const AMSTR_DECIMALS: u8 = 18;
pub const ONE_AMSTR: u128 = 10u128.pow(AMSTR_DECIMALS as u32);
pub const E_MAX: u128 = 10 * ONE_AMSTR; // 10 AMSTR per round
pub const K_VOLUME_YOCTO: u128 = 50 * 10u128.pow(24); // 50 NEAR in yoctoNEAR
pub const EPOCH_ROUNDS: u64 = 100_000;

/// Safely performs (a * b) / c using 256-bit arithmetic to prevent intermediate overflow
pub fn mul_div_u128(a: u128, b: u128, c: u128) -> u128 {
    if c == 0 || a == 0 || b == 0 {
        return 0;
    }
    let a_256 = U256::from(a);
    let b_256 = U256::from(b);
    let c_256 = U256::from(c);
    let result = (a_256 * b_256) / c_256;
    result.as_u128()
}

/// Computes the winning tile (0..24) using pre-committed seed and chain entropy.
pub fn compute_winning_tile(seed: &[u8; 32], chain_entropy: &[u8; 32]) -> u8 {
    let mut hasher = Sha256::new();
    hasher.update(seed);
    hasher.update(chain_entropy);
    let hash = hasher.finalize();

    let mut num_bytes = [0u8; 8];
    num_bytes.copy_from_slice(&hash[0..8]);
    let val = u64::from_le_bytes(num_bytes);
    (val % 25) as u8
}

/// Rolls jackpot tiers using domain-separated hashes.
pub fn roll_jackpots(seed: &[u8; 32], chain_entropy: &[u8; 32]) -> (bool, bool, bool) {
    let check_roll = |domain: &[u8], odds: u64| -> bool {
        let mut hasher = Sha256::new();
        hasher.update(domain);
        hasher.update(seed);
        hasher.update(chain_entropy);
        let hash = hasher.finalize();
        let mut bytes = [0u8; 8];
        bytes.copy_from_slice(&hash[0..8]);
        (u64::from_le_bytes(bytes) % odds) == 0
    };

    let shard = check_roll(b"shard", 300);
    let vein = check_roll(b"vein", 1_000);
    let core = check_roll(b"core", 3_000);

    (shard, vein, core)
}

/// Selects a single Wildcat winner from candidates on the winning tile,
/// weighted by stake, using the settlement entropy hash.
pub fn choose_wildcat_winner(
    seed: &[u8; 32],
    chain_entropy: &[u8; 32],
    candidates: &[(AccountId, u128)],
) -> Option<AccountId> {
    if candidates.is_empty() {
        return None;
    }
    if candidates.len() == 1 {
        return Some(candidates[0].0.clone());
    }

    let total_stake: u128 = candidates.iter().map(|(_, s)| *s).sum();
    if total_stake == 0 {
        return Some(candidates[0].0.clone());
    }

    let mut hasher = Sha256::new();
    hasher.update(b"wildcat_draw");
    hasher.update(seed);
    hasher.update(chain_entropy);
    let hash = hasher.finalize();

    let mut rand_bytes = [0u8; 16];
    rand_bytes.copy_from_slice(&hash[0..16]);
    let rand_num = u128::from_le_bytes(rand_bytes);
    let target = rand_num % total_stake;

    let mut cumulative: u128 = 0;
    for (acc, stake) in candidates {
        cumulative = cumulative.saturating_add(*stake);
        if target < cumulative {
            return Some(acc.clone());
        }
    }

    Some(candidates.last().unwrap().0.clone())
}

/// Computes token emission: E(V) = E_max * (V / (V + K)) * 0.5^epoch
/// Returns (winners_share, jackpot_share, stash_share).
pub fn calculate_emission(volume_net_yocto: u128, round_id: u64) -> (u128, u128, u128) {
    if volume_net_yocto == 0 {
        return (0, 0, 0);
    }

    let epoch = (round_id / EPOCH_ROUNDS) as u32;
    let halving_factor = if epoch >= 64 {
        0
    } else {
        1u128 << epoch
    };

    if halving_factor == 0 {
        return (0, 0, 0);
    }

    let denominator = volume_net_yocto.saturating_add(K_VOLUME_YOCTO);
    let base_emission = mul_div_u128(E_MAX, volume_net_yocto, denominator);
    let total_emission = base_emission / halving_factor;

    let winners_share = (total_emission * 75) / 100;
    let jackpot_share = (total_emission * 20) / 100;
    let stash_share = total_emission.saturating_sub(winners_share + jackpot_share);

    (winners_share, jackpot_share, stash_share)
}

/// Computes individual payout for a player on the winning tile.
/// payout_i = (stake_on_winning_tile_i / total_on_winning_tile) * total_net_pot
pub fn calculate_payout(
    player_tile_stake: u128,
    total_tile_stake: u128,
    total_net_pot: u128,
) -> u128 {
    mul_div_u128(player_tile_stake, total_net_pot, total_tile_stake)
}

/// Computes commit hash: sha256(account_len_u32_le || account_id_bytes || round_id_u64_le || mask_u32_le || salt_32_bytes)
pub fn compute_commit(
    account_id: &str,
    round_id: u64,
    mask: u32,
    salt: &[u8; 32],
) -> [u8; 32] {
    let mut hasher = Sha256::new();
    let account_bytes = account_id.as_bytes();
    let len = account_bytes.len() as u32;
    hasher.update(&len.to_le_bytes());
    hasher.update(account_bytes);
    hasher.update(&round_id.to_le_bytes());
    hasher.update(&mask.to_le_bytes());
    hasher.update(salt);
    hasher.finalize().into()
}

/// Verify commit hash against expected commit
pub fn verify_commit(
    account_id: &str,
    round_id: u64,
    mask: u32,
    salt: &[u8; 32],
    expected_commit: &[u8; 32],
) -> bool {
    let computed = compute_commit(account_id, round_id, mask, salt);
    &computed == expected_commit
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_worked_example_from_spec() {
        let yocto = 10u128.pow(24);
        let alice_stake = 9 * yocto;
        let bob_stake = (45 * yocto) / 50; // 0.9 NEAR
        let total_winning_stake = alice_stake + bob_stake; // 9.9 NEAR
        let total_net_pot = (315 * yocto) / 10; // 31.5 NEAR

        let alice_payout = calculate_payout(alice_stake, total_winning_stake, total_net_pot);
        let bob_payout = calculate_payout(bob_stake, total_winning_stake, total_net_pot);

        let expected_alice_near = (alice_payout as f64) / (yocto as f64);
        let expected_bob_near = (bob_payout as f64) / (yocto as f64);

        assert!((expected_alice_near - 28.636363).abs() < 0.0001);
        assert!((expected_bob_near - 2.863636).abs() < 0.0001);

        assert!(alice_payout + bob_payout <= total_net_pot);
        let dust = total_net_pot - (alice_payout + bob_payout);
        assert!(dust < 100);
    }

    #[test]
    fn test_emission_formula_half_saturation() {
        let v = K_VOLUME_YOCTO;
        let (winners, jackpots, stash) = calculate_emission(v, 0);
        let total = winners + jackpots + stash;

        let expected_total = 5 * ONE_AMSTR;
        assert_eq!(total, expected_total);
        assert_eq!(winners, (expected_total * 75) / 100);
        assert_eq!(jackpots, (expected_total * 20) / 100);
        assert_eq!(stash, expected_total - winners - jackpots);
    }

    #[test]
    fn test_emission_halving() {
        let v = K_VOLUME_YOCTO;
        let (_, _, _) = calculate_emission(v, 0);
        let (w1, j1, s1) = calculate_emission(v, EPOCH_ROUNDS);
        let total_epoch_1 = w1 + j1 + s1;
        assert_eq!(total_epoch_1, (5 * ONE_AMSTR) / 2);

        let (w2, j2, s2) = calculate_emission(v, EPOCH_ROUNDS * 2);
        let total_epoch_2 = w2 + j2 + s2;
        assert_eq!(total_epoch_2, (5 * ONE_AMSTR) / 4);
    }

    #[test]
    fn test_commit_verification() {
        let account = "alice.near";
        let round_id = 42u64;
        let mask: u32 = 0b00000000_00000000_00000000_10000000;
        let salt = [7u8; 32];

        let commit_hash = compute_commit(account, round_id, mask, &salt);
        println!("Rust commit hex: {}", hex::encode(commit_hash));

        assert!(verify_commit(account, round_id, mask, &salt, &commit_hash));
        assert!(!verify_commit(account, round_id, mask + 1, &salt, &commit_hash));
        assert!(!verify_commit("bob.near", round_id, mask, &salt, &commit_hash));
        assert!(!verify_commit(account, round_id + 1, mask, &salt, &commit_hash));
    }

    #[test]
    fn test_wildcat_selection() {
        let seed = [1u8; 32];
        let entropy = [2u8; 32];
        let candidates = vec![
            ("alice.near".parse().unwrap(), 10u128),
            ("bob.near".parse().unwrap(), 90u128),
        ];

        let winner = choose_wildcat_winner(&seed, &entropy, &candidates);
        assert!(winner.is_some());
        let w = winner.unwrap();
        assert!(w == "alice.near" || w == "bob.near");
    }

    #[test]
    fn test_winning_tile_bounds() {
        let seed = [42u8; 32];
        for i in 0..100u8 {
            let mut entropy = [0u8; 32];
            entropy[0] = i;
            let tile = compute_winning_tile(&seed, &entropy);
            assert!(tile < 25, "Tile must be between 0 and 24");
        }
    }
}
