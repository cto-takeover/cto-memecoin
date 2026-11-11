//! Unit tests for the contract (spec 4, layer 1). Real keys, receipts and NEAR's own
//! errors are covered by the sandbox story in `tests/sandbox.rs`.

use super::*;
use near_sdk::base64::{Engine, engine::general_purpose::STANDARD};
use near_sdk::test_utils::{VMContextBuilder, get_logs};
use near_sdk::testing_env;

const ONE: u128 = price::ONE_CTO;
const SEC: u64 = 1_000_000_000;

fn acc(s: &str) -> AccountId {
    s.parse().unwrap()
}
fn coin() -> AccountId {
    acc("cto.testnet")
}
fn key(n: u8) -> PublicKey {
    let mut bytes = vec![0u8];
    bytes.extend([n; 32]);
    PublicKey::try_from(bytes).unwrap()
}
fn face(bg: u8, eyes: u8, mouth: u8, extra: u8) -> Face {
    Face { bg, eyes, mouth, extra }
}

/// Sets the next call's context.
struct Ctx {
    now_s: u64,
}
impl Ctx {
    fn call(&self, who: &str, deposit: NearToken) {
        let mut b = VMContextBuilder::new();
        b.current_account_id(coin())
            .predecessor_account_id(acc(who))
            .signer_account_id(acc(who))
            .attached_deposit(deposit)
            .block_timestamp(1_700_000_000 * SEC + self.now_s * SEC);
        testing_env!(b.build());
    }
    /// A transaction signed by the coin account itself with `pk`.
    fn as_coin(&self, pk: PublicKey) {
        let mut b = VMContextBuilder::new();
        b.current_account_id(coin())
            .predecessor_account_id(coin())
            .signer_account_id(coin())
            .signer_account_pk(pk)
            .block_timestamp(1_700_000_000 * SEC + self.now_s * SEC);
        testing_env!(b.build());
    }
}

/// Main-coin rules (7 + 7 days), ani and budi with 2,000,000 each from the faucet.
fn setup(delay_s: u64, length_s: u64) -> (Contract, Ctx) {
    let ctx = Ctx { now_s: 0 };
    ctx.call("cto.testnet", NearToken::from_near(0));
    let mut c = Contract::new(
        "CTO".into(),
        "CTO".into(),
        U128(1_000_000 * ONE),
        delay_s,
        length_s,
        U128(2_000_000 * ONE),
        vec![],
    );
    for who in ["ani.testnet", "budi.testnet"] {
        ctx.call(who, NearToken::from_micronear(1250));
        c.claim_faucet();
    }
    (c, ctx)
}

const DAY: u64 = 86_400;
fn main_coin() -> (Contract, Ctx) {
    setup(7 * DAY, 7 * DAY)
}

fn take(c: &mut Contract, ctx: &Ctx, who: &str, f: Face, k: u8, max: u128) {
    ctx.call(who, TAKE_SEAT_DEPOSIT);
    let _ = c.take_seat(f, key(k), U128(max));
}

fn bal(c: &Contract, who: &str) -> u128 {
    c.ft_balance_of(acc(who)).0
}

fn assert_invariants(c: &Contract, holders: &[&str]) {
    let burned: u128 = c.get_history(Some(0), Some(50)).iter().map(|t| t.burned.0).sum();
    assert_eq!(c.ft_total_supply().0, TOTAL_SUPPLY - burned, "supply = launch - burned");
    let balances: u128 = holders.iter().map(|h| bal(c, h)).sum();
    assert_eq!(balances + c.faucet_pool, c.ft_total_supply().0, "balances + pool = supply");
    for t in c.get_history(Some(0), Some(50)) {
        assert_eq!(t.payout.0 + t.burned.0, t.paid.0, "payout + burned = price");
    }
}

fn icon_svg(c: &Contract) -> String {
    let icon = c.ft_metadata().icon.unwrap();
    let b64 = icon.strip_prefix("data:image/svg+xml;base64,").unwrap();
    String::from_utf8(STANDARD.decode(b64).unwrap()).unwrap()
}

#[test]
fn launch_state() {
    let (c, _) = main_coin();
    assert_eq!(c.ft_total_supply().0, TOTAL_SUPPLY);
    assert_eq!(c.faucet_pool, TOTAL_SUPPLY - 4_000_000 * ONE);
    let seat = c.get_seat();
    assert!(seat.vacant);
    assert_eq!(seat.current_price.0, 1_000_000 * ONE);
    assert_eq!(seat.face_id, 9);
    assert_eq!(icon_svg(&c), Face::LAUNCH.svg());
    let cfg = c.get_config();
    assert_eq!((cfg.takeover_ratio.as_str(), cfg.payout_ratio.as_str()), ("7/5", "23/28"));
    assert_eq!(cfg.take_seat_deposit, NearToken::from_millinear(250));
}

#[test]
fn launch_allocations_and_pool() {
    let ctx = Ctx { now_s: 0 };
    ctx.call("demo-cto.testnet", NearToken::from_near(0));
    let c = Contract::new(
        "CTO DEMO".into(),
        "CTOD".into(),
        U128(1_000_000 * ONE),
        120,
        180,
        U128(2_000_000 * ONE),
        vec![(acc("ani.testnet"), U128(200_000_000 * ONE)), (acc("budi.testnet"), U128(200_000_000 * ONE))],
    );
    assert_eq!(bal(&c, "ani.testnet"), 200_000_000 * ONE);
    assert_eq!(c.faucet_pool, 600_000_000 * ONE);
    assert_eq!(c.ft_total_supply().0, TOTAL_SUPPLY);
    assert_invariants(&c, &["ani.testnet", "budi.testnet"]);
}

#[test]
#[should_panic(expected = "CTO: allocations exceed the total supply")]
fn allocations_over_supply() {
    Ctx { now_s: 0 }.call("cto.testnet", NearToken::from_near(0));
    Contract::new(
        "CTO".into(),
        "CTO".into(),
        U128(ONE),
        1,
        1,
        U128(ONE),
        vec![(acc("ani.testnet"), U128(TOTAL_SUPPLY)), (acc("budi.testnet"), U128(1))],
    );
}

#[test]
fn story_ani_then_budi() {
    let (mut c, mut ctx) = main_coin();
    let ani = face(5, 1, 0, 1);
    let budi = face(1, 2, 3, 7);

    take(&mut c, &ctx, "ani.testnet", ani, 1, 1_000_000 * ONE);
    assert_eq!(bal(&c, "ani.testnet"), 1_000_000 * ONE);
    assert_eq!(c.ft_total_supply().0, TOTAL_SUPPLY - 1_000_000 * ONE, "vacant takeover burns it all");
    assert_eq!(c.get_seat().current_price.0, 1_400_000 * ONE);
    assert_eq!(c.get_seat().face_id, 2626);
    assert_eq!(icon_svg(&c), ani.svg());

    ctx.now_s = 60;
    take(&mut c, &ctx, "budi.testnet", budi, 2, 1_400_000 * ONE);
    assert_eq!(bal(&c, "ani.testnet"), 2_150_000 * ONE, "ani gets 1,150,000");
    assert_eq!(bal(&c, "budi.testnet"), 600_000 * ONE);
    assert_eq!(c.ft_total_supply().0, TOTAL_SUPPLY - 1_250_000 * ONE);
    assert_eq!(c.total_burned().0, 1_250_000 * ONE);
    assert_eq!(c.get_seat().current_price.0, 1_960_000 * ONE);
    assert_eq!(icon_svg(&c), budi.svg());
    assert_eq!(icon_svg(&c), c.face_svg(budi));

    let h = c.get_history(None, None);
    assert_eq!(h.len(), 2);
    assert_eq!((h[0].ceo.as_str(), h[0].previous_ceo.as_ref().unwrap().as_str()), ("budi.testnet", "ani.testnet"));
    assert_eq!((h[0].paid.0, h[0].payout.0, h[0].burned.0), (1_400_000 * ONE, 1_150_000 * ONE, 250_000 * ONE));
    assert_eq!(h[1].previous_ceo, None);
    assert_invariants(&c, &["ani.testnet", "budi.testnet"]);
}

#[test]
fn takeover_events() {
    let (mut c, ctx) = main_coin();
    take(&mut c, &ctx, "ani.testnet", face(5, 1, 0, 1), 1, 1_000_000 * ONE);
    let logs = get_logs();
    assert!(!logs.iter().any(|l| l.contains("\"ft_transfer\"")), "no payout event when vacant");
    assert!(logs.iter().any(|l| l.contains("\"ft_burn\"") && l.contains("takeover burn")));

    take(&mut c, &ctx, "budi.testnet", face(1, 2, 3, 7), 2, 1_400_000 * ONE);
    let logs = get_logs();
    let payout = logs.iter().find(|l| l.contains("\"ft_transfer\"")).unwrap();
    assert!(payout.contains("\"old_owner_id\":\"budi.testnet\"") && payout.contains("\"new_owner_id\":\"ani.testnet\""));
    assert!(payout.contains("\"amount\":\"1150000000000000000000000\"") && payout.contains("takeover payout"));
    let seat = logs.iter().find(|l| l.contains("\"seat_taken\"")).unwrap();
    let json: near_sdk::serde_json::Value =
        near_sdk::serde_json::from_str(seat.strip_prefix("EVENT_JSON:").unwrap()).unwrap();
    assert_eq!(json["standard"], "cto");
    assert_eq!(json["version"], "1.0.0");
    let d = &json["data"][0];
    assert_eq!(d["ceo"], "budi.testnet");
    assert_eq!(d["previous_ceo"], "ani.testnet");
    assert_eq!(d["price"], "1400000000000000000000000");
    assert_eq!(d["payout"], "1150000000000000000000000");
    assert_eq!(d["burned"], "250000000000000000000000");
    assert_eq!(d["face_id"], 672);
    assert_eq!(d["takeover_index"], 1);
}

#[test]
fn decay_on_chain() {
    let (mut c, mut ctx) = main_coin();
    take(&mut c, &ctx, "ani.testnet", face(0, 0, 0, 0), 1, 1_000_000 * ONE);
    ctx.now_s = 7 * DAY;
    ctx.call("x.testnet", NearToken::from_near(0));
    let s = c.get_seat();
    assert_eq!((s.current_price.0, s.decaying, s.seconds_until_decay), (1_400_000 * ONE, false, 0));
    ctx.now_s = 7 * DAY + 7 * DAY / 2;
    ctx.call("x.testnet", NearToken::from_near(0));
    let s = c.get_seat();
    assert_eq!((s.current_price.0, s.decaying), (1_200_000 * ONE, true));
    ctx.now_s = 30 * DAY;
    ctx.call("x.testnet", NearToken::from_near(0));
    assert_eq!(c.get_seat().current_price.0, 1_000_000 * ONE);
    ctx.now_s = DAY;
    ctx.call("x.testnet", NearToken::from_near(0));
    assert_eq!(c.get_seat().seconds_until_decay, 6 * DAY);
}

#[test]
fn decayed_takeover_pays_23_28() {
    let (mut c, mut ctx) = main_coin();
    take(&mut c, &ctx, "ani.testnet", face(0, 0, 0, 0), 1, 1_000_000 * ONE);
    ctx.now_s = 7 * DAY + 7 * DAY / 2;
    take(&mut c, &ctx, "budi.testnet", face(1, 1, 1, 1), 2, 1_200_000 * ONE);
    let t = &c.get_history(None, Some(1))[0];
    assert_eq!(t.voice_key, key(2), "history keeps the key each takeover installed");
    assert_eq!(c.get_history(Some(1), Some(1))[0].voice_key, key(1));
    assert_eq!(t.paid.0, 1_200_000 * ONE);
    assert_eq!(t.payout.0, 1_200_000 * ONE * 23 / 28);
    assert_invariants(&c, &["ani.testnet", "budi.testnet"]);
}

// ------------------------------------------------------------- error messages

#[test]
#[should_panic(expected = "CTO: attach exactly 0.25 NEAR for the voice key")]
fn err_deposit() {
    let (mut c, ctx) = main_coin();
    ctx.call("ani.testnet", NearToken::from_millinear(249));
    let _ = c.take_seat(face(0, 0, 0, 0), key(1), U128(1_000_000 * ONE));
}

#[test]
#[should_panic(expected = "CTO: unknown face part")]
fn err_face() {
    let (mut c, ctx) = main_coin();
    take(&mut c, &ctx, "ani.testnet", face(0, 8, 0, 0), 1, 1_000_000 * ONE);
}

#[test]
#[should_panic(expected = "CTO: price moved to 1,400,000 CTO, above your max 1,000,000")]
fn err_price_moved() {
    let (mut c, ctx) = main_coin();
    take(&mut c, &ctx, "ani.testnet", face(0, 0, 0, 0), 1, 1_000_000 * ONE);
    take(&mut c, &ctx, "budi.testnet", face(0, 0, 0, 0), 2, 1_000_000 * ONE);
}

#[test]
#[should_panic(expected = "CTO: price is 1,000,000 CTO, you have 0")]
fn err_balance_unregistered() {
    let (mut c, ctx) = main_coin();
    take(&mut c, &ctx, "carol.testnet", face(0, 0, 0, 0), 3, 1_000_000 * ONE);
}

#[test]
#[should_panic(expected = "CTO: price is 1,960,000 CTO, you have 600,000")]
fn err_balance_low() {
    let (mut c, ctx) = main_coin();
    take(&mut c, &ctx, "ani.testnet", face(0, 0, 0, 0), 1, 1_000_000 * ONE);
    take(&mut c, &ctx, "budi.testnet", face(0, 0, 0, 0), 2, 1_400_000 * ONE);
    take(&mut c, &ctx, "budi.testnet", face(0, 0, 0, 0), 3, 2_000_000 * ONE);
}

#[test]
#[should_panic(expected = "CTO: that voice key is already in use")]
fn err_key_in_use() {
    let (mut c, ctx) = main_coin();
    take(&mut c, &ctx, "ani.testnet", face(0, 0, 0, 0), 1, 1_000_000 * ONE);
    take(&mut c, &ctx, "budi.testnet", face(0, 0, 0, 0), 1, 1_400_000 * ONE);
}

#[test]
#[should_panic(expected = "CTO: only the coin's voice key can announce")]
fn err_announce_vacant() {
    let (mut c, ctx) = main_coin();
    ctx.as_coin(key(1));
    c.announce(0);
}

#[test]
#[should_panic(expected = "CTO: only the coin's voice key can announce")]
fn err_announce_other_account() {
    let (mut c, ctx) = main_coin();
    take(&mut c, &ctx, "ani.testnet", face(0, 0, 0, 0), 1, 1_000_000 * ONE);
    ctx.call("ani.testnet", NearToken::from_near(0)); // ani's own account, not the coin
    c.announce(0);
}

#[test]
#[should_panic(expected = "CTO: only the coin's voice key can announce")]
fn err_announce_old_key() {
    let (mut c, ctx) = main_coin();
    take(&mut c, &ctx, "ani.testnet", face(0, 0, 0, 0), 1, 1_000_000 * ONE);
    take(&mut c, &ctx, "budi.testnet", face(0, 0, 0, 0), 2, 1_400_000 * ONE);
    ctx.as_coin(key(1));
    c.announce(0);
}

#[test]
#[should_panic(expected = "CTO: unknown announcement line")]
fn err_announce_line() {
    let (mut c, ctx) = main_coin();
    take(&mut c, &ctx, "ani.testnet", face(0, 0, 0, 0), 1, 1_000_000 * ONE);
    ctx.as_coin(key(1));
    c.announce(24);
}

#[test]
#[should_panic(expected = "CTO: faucet already claimed by this account")]
fn err_faucet_twice() {
    let (mut c, ctx) = main_coin();
    ctx.call("ani.testnet", NearToken::from_near(0));
    c.claim_faucet();
}

#[test]
#[should_panic(expected = "CTO: attach at least 0.00125 NEAR to register storage")]
fn err_faucet_storage() {
    let (mut c, ctx) = main_coin();
    ctx.call("carol.testnet", NearToken::from_micronear(1249));
    c.claim_faucet();
}

#[test]
#[should_panic(expected = "CTO: the faucet is empty")]
fn err_faucet_empty() {
    let ctx = Ctx { now_s: 0 };
    ctx.call("cto.testnet", NearToken::from_near(0));
    let mut c = Contract::new(
        "CTO".into(),
        "CTO".into(),
        U128(ONE),
        1,
        1,
        U128(ONE),
        vec![(acc("ani.testnet"), U128(TOTAL_SUPPLY - ONE / 2))],
    );
    ctx.call("budi.testnet", NearToken::from_micronear(1250));
    c.claim_faucet();
}

#[test]
#[should_panic(expected = "CTO: force unregister is not supported, tokens only burn in takeovers")]
fn err_force_unregister() {
    let (mut c, ctx) = main_coin();
    ctx.call("ani.testnet", NearToken::from_yoctonear(1));
    c.storage_unregister(Some(true));
}

#[test]
#[should_panic(expected = "CTO: invalid launch config")]
fn err_bad_config() {
    Ctx { now_s: 0 }.call("cto.testnet", NearToken::from_near(0));
    Contract::new("CTO".into(), "CTO".into(), U128(ONE), 1, 0, U128(ONE), vec![]);
}

// --------------------------------------------------------------- announcements

#[test]
fn announce_fills_slots_from_chain() {
    let (mut c, ctx) = main_coin();
    take(&mut c, &ctx, "ani.testnet", face(5, 1, 0, 1), 1, 1_000_000 * ONE);
    ctx.as_coin(key(1));
    let a = c.announce(1);
    assert_eq!(a.text, "The face is mine until someone pays 1,400,000 CTO.");
    assert_eq!(c.announce(6).text, "1,000,000 CTO burned so far. Supply only goes down.");
    assert_eq!(c.announce(12).text, "This is the coin speaking. Signed, ani.testnet.");
    let logs = get_logs();
    assert!(logs.iter().any(|l| l.contains("\"announcement\"") && l.contains("\"line\":12")));
}

#[test]
fn announcements_keep_newest_50() {
    let (mut c, ctx) = main_coin();
    take(&mut c, &ctx, "ani.testnet", face(0, 0, 0, 0), 1, 1_000_000 * ONE);
    ctx.as_coin(key(1));
    for i in 0..60u64 {
        c.announce((i % 24) as u8);
    }
    let posts = c.get_announcements(None);
    assert_eq!(posts.len(), 50);
    assert_eq!(posts[0].index, 59);
    assert_eq!(posts[49].index, 10);
    assert_eq!(posts[0].line, (59 % 24) as u8);
    assert_eq!(c.get_announcements(Some(3)).iter().map(|p| p.index).collect::<Vec<_>>(), vec![59, 58, 57]);
}

#[test]
fn history_pages_newest_first() {
    let (mut c, mut ctx) = main_coin();
    // ani and budi alternate on a cheap coin until 5 takeovers
    take(&mut c, &ctx, "ani.testnet", face(0, 0, 0, 0), 10, u128::MAX);
    for i in 1..5u8 {
        ctx.now_s += 30 * DAY; // back at the floor each time
        let who = if i % 2 == 1 { "budi.testnet" } else { "ani.testnet" };
        take(&mut c, &ctx, who, face(0, 0, 0, i), 10 + i, u128::MAX);
    }
    let all = c.get_history(None, None);
    assert_eq!(all.iter().map(|t| t.index).collect::<Vec<_>>(), vec![4, 3, 2, 1, 0]);
    assert_eq!(c.get_history(Some(1), Some(2)).iter().map(|t| t.index).collect::<Vec<_>>(), vec![3, 2]);
    assert!(c.get_history(Some(9), None).is_empty());
    assert_eq!(c.get_history(None, Some(500)).len(), 5);
    assert_invariants(&c, &["ani.testnet", "budi.testnet"]);
}

// ---------------------------------------------------------------------- faucet

#[test]
fn faucet_registers_and_tracks() {
    let (mut c, ctx) = main_coin();
    assert!(!c.faucet_status(acc("carol.testnet")).claimed);
    ctx.call("carol.testnet", NearToken::from_millinear(10));
    assert_eq!(c.claim_faucet().0, 2_000_000 * ONE);
    assert_eq!(bal(&c, "carol.testnet"), 2_000_000 * ONE);
    let s = c.faucet_status(acc("carol.testnet"));
    assert!(s.claimed);
    assert_eq!(s.pool_left.0, TOTAL_SUPPLY - 6_000_000 * ONE);
    assert_eq!(c.ft_total_supply().0, TOTAL_SUPPLY, "claims move supply, never mint");
    assert_invariants(&c, &["ani.testnet", "budi.testnet", "carol.testnet"]);
}

#[test]
fn old_ceo_who_unregistered_still_gets_paid() {
    let (mut c, ctx) = main_coin();
    take(&mut c, &ctx, "ani.testnet", face(0, 0, 0, 0), 1, 1_000_000 * ONE);
    // ani moves the rest away and unregisters
    ctx.call("ani.testnet", NearToken::from_yoctonear(1));
    c.ft_transfer(acc("budi.testnet"), U128(1_000_000 * ONE), None);
    assert!(c.storage_unregister(None));
    take(&mut c, &ctx, "budi.testnet", face(0, 0, 0, 1), 2, 1_400_000 * ONE);
    assert_eq!(bal(&c, "ani.testnet"), 1_150_000 * ONE);
    assert_invariants(&c, &["ani.testnet", "budi.testnet"]);
}

#[test]
fn view_face_svg_matches_face() {
    let (c, _) = main_coin();
    assert_eq!(c.face_svg(face(1, 2, 3, 7)), face(1, 2, 3, 7).svg());
    assert_eq!(c.get_lines().len(), 24);
}
