//! Sandbox story (spec 4, layer 2): real transactions, keys and NEAR errors on a
//! local node. Runs in order; uses `target/near/cto/cto.wasm`, so build first:
//!
//!   (cd contract && cargo near build non-reproducible-wasm) && cargo test -p cto --test sandbox -- --nocapture
//!
//! Spec 4 names near-workspaces; this uses its successors near-sandbox + near-api
//! (what `cargo near new` ships), with the same local sandbox node.

use near_api::types::AccessKeyPermission;
use near_api::types::transaction::SignedTransaction;
use near_api::{AccountId, NearGas, NearToken, NetworkConfig, PublicKey, Signer};
use near_sdk::base64::{Engine, engine::general_purpose::STANDARD};
use near_sdk::serde_json::{Value, json};
use std::sync::Arc;
use testresult::TestResult;

const WASM: &str = concat!(env!("CARGO_MANIFEST_DIR"), "/../target/near/cto/cto.wasm");
const ONE: u128 = 1_000_000_000_000_000_000;
const TOTAL: u128 = 1_000_000_000 * ONE;
const DELAY_S: u64 = 5;
const LENGTH_S: u64 = 10;

fn cto(n: u128) -> String {
    (n * ONE).to_string()
}

/// A 100 Tgas call on the coin (the builder type is not exported by near-api).
macro_rules! call {
    ($w:expr, $method:expr, $args:expr) => {
        near_api::Contract($w.coin.clone()).call_function($method, $args).transaction().gas(NearGas::from_tgas(100))
    };
}

struct World {
    sandbox: near_sandbox::Sandbox,
    net: NetworkConfig,
    genesis: Arc<Signer>,
    coin: AccountId,
}

impl World {
    async fn account(&self, name: &str) -> TestResult<AccountId> {
        let id: AccountId = name.parse()?;
        self.sandbox
            .create_account(id.as_str().parse()?)
            .initial_balance(NearToken::from_near(10))
            .send()
            .await?;
        Ok(id)
    }

    /// A call signed by `who` (every test account uses the genesis key).
    async fn send(&self, who: &AccountId, method: &str, args: Value, deposit: NearToken) -> TestResult<Outcome> {
        let r = call!(self, method, args)
            .deposit(deposit)
            .with_signer(who.clone(), self.genesis.clone())
            .send_to(&self.net)
            .await?;
        Ok(Outcome(r.into_full().expect("final result")))
    }

    /// A call signed by the coin account itself with a voice key.
    async fn as_coin(&self, voice: &Arc<Signer>, method: &str, args: Value) -> TestResult<Outcome> {
        let r = call!(self, method, args)
            .with_signer(self.coin.clone(), voice.clone())
            .send_to(&self.net)
            .await?;
        Ok(Outcome(r.into_full().expect("final result")))
    }

    async fn view(&self, method: &str, args: Value) -> TestResult<Value> {
        Ok(near_api::Contract(self.coin.clone())
            .call_function(method, args)
            .read_only::<Value>()
            .fetch_from(&self.net)
            .await?
            .data)
    }

    async fn balance(&self, who: &AccountId) -> TestResult<u128> {
        Ok(self.view("ft_balance_of", json!({ "account_id": who })).await?.as_str().unwrap().parse()?)
    }

    async fn supply(&self) -> TestResult<u128> {
        Ok(self.view("ft_total_supply", json!({})).await?.as_str().unwrap().parse()?)
    }

    async fn keys(&self) -> TestResult<Vec<(PublicKey, AccessKeyPermission)>> {
        let keys = near_api::Account(self.coin.clone()).list_keys().fetch_from(&self.net).await?.data;
        Ok(keys.into_iter().map(|(pk, k)| (pk, k.permission)).collect())
    }

    /// Signs as the coin with `secret`'s key WITHOUT asking the node for the key's
    /// nonce (a deleted key has none), using a fresh block hash, and broadcasts it
    /// with a raw `send_tx`. Returns NEAR's JSON response unedited. This is how the
    /// relayer and the page must send the ex-CEO's post (see spike/RUN.md).
    async fn send_raw_without_lookup(&self, secret: &near_api::SecretKey, method: &str, args: Value) -> TestResult<Value> {
        let block_hash = near_api::Chain::block_hash().fetch_from(&self.net).await?;
        let signed = call!(self, method, args)
            .with_signer(self.coin.clone(), Signer::from_secret_key(secret.clone())?)
            .presign_offline(secret.public_key(), block_hash, 1_000_000_000_000_000)
            .await?
            .transaction
            .signed()
            .unwrap();
        self.broadcast(signed)
    }

    fn broadcast(&self, signed: SignedTransaction) -> TestResult<Value> {
        let body = json!({
            "jsonrpc": "2.0", "id": "sandbox", "method": "send_tx",
            "params": { "signed_tx_base64": STANDARD.encode(near_sdk::borsh::to_vec(&signed)?), "wait_until": "FINAL" }
        });
        let out = std::process::Command::new("curl")
            .args(["-s", "-H", "Content-Type: application/json", "-d", &body.to_string(), &self.sandbox.rpc_addr])
            .output()?;
        Ok(near_sdk::serde_json::from_slice(&out.stdout)?)
    }
}

struct Outcome(near_api::types::transaction::result::ExecutionFinalResult);

impl Outcome {
    fn ok(self) -> Self {
        let dbg = format!("{:?}", self.0.receipt_failures());
        assert!(self.0.is_success(), "expected success: {dbg}");
        self
    }
    fn logs(&self) -> Vec<String> {
        self.0.logs().into_iter().map(String::from).collect()
    }
    fn json(self) -> Value {
        self.ok().0.into_result().unwrap().json().unwrap()
    }
    /// The contract panicked with exactly `msg`.
    fn panics_with(self, msg: &str) {
        assert!(!self.0.is_success(), "expected failure with {msg:?}");
        let dbg = format!("{:?}", self.0);
        assert!(dbg.contains(&format!("Smart contract panicked: {msg}")), "expected {msg:?} in {dbg}");
    }
}

fn face(bg: u8, eyes: u8, mouth: u8, extra: u8) -> Value {
    json!({ "bg": bg, "eyes": eyes, "mouth": mouth, "extra": extra })
}

fn quarter() -> NearToken {
    NearToken::from_millinear(250)
}

fn icon_svg(meta: &Value) -> String {
    let b64 = meta["icon"].as_str().unwrap().strip_prefix("data:image/svg+xml;base64,").unwrap();
    String::from_utf8(STANDARD.decode(b64).unwrap()).unwrap()
}

fn error_path(resp: &Value) -> String {
    // e.g. {"TxExecutionError":{"InvalidTxError":{"InvalidAccessKeyError":{"AccessKeyNotFound":{…}}}}}
    let mut path = vec![];
    let mut v = &resp["error"]["data"];
    // Descend through single-key objects; stop at the error's own fields.
    while let Some((k, next)) = v.as_object().filter(|o| o.len() == 1).and_then(|o| o.iter().next()) {
        if !next.is_object() {
            break;
        }
        path.push(k.clone());
        v = next;
    }
    path.join(".")
}

#[tokio::test]
async fn story() -> TestResult<()> {
    let wasm = std::fs::read(WASM).expect("build first: (cd contract && cargo near build non-reproducible-wasm)");
    let sandbox = near_sandbox::Sandbox::start_sandbox().await?;
    let net = NetworkConfig::from_rpc_url("sandbox", sandbox.rpc_addr.parse()?);
    let genesis_sk: near_api::SecretKey = near_sandbox::config::DEFAULT_GENESIS_ACCOUNT_PRIVATE_KEY.parse()?;
    let genesis = Signer::from_secret_key(genesis_sk.clone())?;
    let mut w = World { sandbox, net, genesis: genesis.clone(), coin: "x.sandbox".parse()? };
    w.coin = w.account("cto.sandbox").await?;
    let ani = w.account("ani.sandbox").await?;
    let budi = w.account("budi.sandbox").await?;
    let carol = w.account("carol.sandbox").await?;

    // 1. Deploy (5 s + 10 s decay); delete the deployer's full-access key.
    near_api::Contract::deploy(w.coin.clone())
        .use_code(wasm)
        .with_init_call(
            "new",
            json!({
                "name": "CTO", "symbol": "CTO", "opening_price": cto(1_000_000),
                "decay_delay_s": DELAY_S, "decay_length_s": LENGTH_S,
                "faucet_amount": cto(2_000_000), "allocations": [],
            }),
        )?
        .with_signer(genesis.clone())
        .send_to(&w.net)
        .await?
        .assert_success();
    near_api::Account(w.coin.clone())
        .delete_key(genesis_sk.public_key())
        .with_signer(genesis.clone())
        .send_to(&w.net)
        .await?
        .assert_success();
    assert!(w.keys().await?.is_empty(), "no keys at all before the first takeover");
    println!("1. deployed; full-access keys: 0");

    // 2. ani and budi claim the faucet.
    for who in [&ani, &budi] {
        w.send(who, "claim_faucet", json!({}), NearToken::from_micronear(1250)).await?.ok();
        assert_eq!(w.balance(who).await?, 2_000_000 * ONE);
    }
    println!("2. ani and budi: 2,000,000 each");

    // 3. ani takes the vacant seat.
    let ani_voice = near_api::signer::generate_secret_key()?;
    let ani_signer = Signer::from_secret_key(ani_voice.clone())?;
    let r = w
        .send(&ani, "take_seat", json!({ "face": face(5, 1, 0, 1), "new_ceo_key": ani_voice.public_key(), "max_price": cto(1_000_000) }), quarter())
        .await?
        .ok();
    assert!(r.logs().iter().any(|l| l.contains("key swap for takeover 0: ok")), "{:?}", r.logs());
    assert_eq!(w.supply().await?, TOTAL - 1_000_000 * ONE);
    let keys = w.keys().await?;
    assert_eq!(keys.len(), 1, "exactly one key on the coin");
    match &keys[0] {
        (pk, AccessKeyPermission::FunctionCall(fc)) => {
            assert_eq!(*pk, ani_voice.public_key());
            assert_eq!(fc.method_names, vec!["announce".to_string()]);
            assert_eq!(fc.receiver_id, w.coin.to_string());
            assert_eq!(fc.allowance, Some(quarter()));
        }
        other => panic!("expected a function-call key, got {other:?}"),
    }
    println!("3. ani is CEO; supply -1,000,000; one key: announce only, 0.25 NEAR");

    // 4. ani's voice key posts line 1.
    let post = w.as_coin(&ani_signer, "announce", json!({ "line": 1 })).await?.json();
    assert_eq!(post["text"], "The face is mine until someone pays 1,400,000 CTO.");
    println!("4. ani posts: {}", post["text"]);

    // 5. budi takes over at 1,400,000.
    let budi_voice = near_api::signer::generate_secret_key()?;
    let budi_signer = Signer::from_secret_key(budi_voice.clone())?;
    let r = w
        .send(&budi, "take_seat", json!({ "face": face(1, 2, 3, 7), "new_ceo_key": budi_voice.public_key(), "max_price": cto(1_400_000) }), quarter())
        .await?
        .ok();
    assert!(r.logs().iter().any(|l| l.contains("\"seat_taken\"") && l.contains("\"face_id\":672")));
    let last = &w.view("get_history", json!({ "from_index": 0, "limit": 1 })).await?[0];
    assert_eq!(last["paid"], cto(1_400_000), "budi paid full price (sandbox slower than {DELAY_S} s?)");
    assert_eq!(w.balance(&ani).await?, 2_150_000 * ONE, "ani +1,150,000");
    assert_eq!(w.balance(&budi).await?, 600_000 * ONE);
    assert_eq!(w.supply().await?, TOTAL - 1_250_000 * ONE, "supply -250,000");
    let meta = w.view("ft_metadata", json!({})).await?;
    assert_eq!(icon_svg(&meta), w.view("face_svg", json!({ "face": face(1, 2, 3, 7) })).await?.as_str().unwrap());
    println!("5. budi is CEO; ani +1,150,000; supply -250,000; icon = budi's face");

    // 8 (early, while the price is still above the floor). carol's max is stale.
    w.send(&carol, "take_seat", json!({ "face": face(0, 0, 0, 0), "new_ceo_key": ani_voice.public_key(), "max_price": cto(1_000_000) }), quarter())
        .await?
        .panics_with("CTO: price moved to 1,960,000 CTO, above your max 1,000,000");
    println!("8. carol: price moved message");

    // 6. ani's old key: NEAR itself refuses the transaction.
    let resp = w.send_raw_without_lookup(&ani_voice, "announce", json!({ "line": 3 })).await?;
    assert_eq!(error_path(&resp), "TxExecutionError.InvalidTxError.InvalidAccessKeyError.AccessKeyNotFound", "{resp}");
    println!("6. ani's old key -> {}", resp["error"]["data"]);

    // 7. budi's key can only call announce.
    let resp = w.send_raw_without_lookup(&budi_voice, "ft_transfer", json!({ "receiver_id": ani, "amount": "1" })).await?;
    assert_eq!(error_path(&resp), "TxExecutionError.InvalidTxError.InvalidAccessKeyError.MethodNameMismatch", "{resp}");
    println!("7. budi's key on ft_transfer -> {}", resp["error"]["data"]);
    let post = w.as_coin(&budi_signer, "announce", json!({ "line": 6 })).await?.json();
    assert_eq!(post["text"], "1,250,000 CTO burned so far. Supply only goes down.");

    // 9. Past 15 s of block time the price is back at the floor.
    w.sandbox.fast_forward(100).await?;
    let seat = w.view("get_seat", json!({})).await?;
    assert_eq!(seat["current_price"], cto(1_000_000), "{seat}");
    assert_eq!(seat["decaying"], true);
    println!("9. after fast-forward: price {} (floor)", seat["current_price"]);

    // 10. Every error message in spec 1, matched exactly.
    let take = |who: &AccountId, f: Value, key: &PublicKey, max: u128, dep: NearToken| {
        let args = json!({ "face": f, "new_ceo_key": key, "max_price": cto(max) });
        let (w, who) = (&w, who.clone());
        async move { w.send(&who, "take_seat", args, dep).await }
    };
    let fresh = near_api::signer::generate_secret_key()?.public_key();
    take(&carol, face(0, 0, 0, 0), &fresh, 1_000_000, NearToken::from_millinear(100)).await?
        .panics_with("CTO: attach exactly 0.25 NEAR for the voice key");
    take(&ani, face(8, 0, 0, 0), &fresh, 1_000_000, quarter()).await?.panics_with("CTO: unknown face part");
    take(&carol, face(0, 0, 0, 0), &fresh, 1_000_000, quarter()).await?
        .panics_with("CTO: price is 1,000,000 CTO, you have 0");
    take(&ani, face(0, 0, 0, 0), &budi_voice.public_key(), 1_000_000, quarter()).await?
        .panics_with("CTO: that voice key is already in use");
    w.send(&ani, "announce", json!({ "line": 0 }), NearToken::from_near(0)).await?
        .panics_with("CTO: only the coin's voice key can announce");
    w.as_coin(&budi_signer, "announce", json!({ "line": 24 })).await?.panics_with("CTO: unknown announcement line");
    w.send(&ani, "claim_faucet", json!({}), NearToken::from_near(0)).await?
        .panics_with("CTO: faucet already claimed by this account");
    w.send(&carol, "claim_faucet", json!({}), NearToken::from_near(0)).await?
        .panics_with("CTO: attach at least 0.00125 NEAR to register storage");
    w.send(&ani, "storage_unregister", json!({ "force": true }), NearToken::from_yoctonear(1)).await?
        .panics_with("CTO: force unregister is not supported, tokens only burn in takeovers");
    println!("10. every error message matched");

    // Invariants.
    let history = w.view("get_history", json!({})).await?;
    let burned: u128 = history.as_array().unwrap().iter().map(|t| t["burned"].as_str().unwrap().parse::<u128>().unwrap()).sum();
    let supply = w.supply().await?;
    assert_eq!(supply, TOTAL - burned, "supply = launch - burned");
    let pool: u128 = w.view("faucet_status", json!({ "account_id": carol })).await?["pool_left"].as_str().unwrap().parse()?;
    let balances = w.balance(&ani).await? + w.balance(&budi).await? + w.balance(&carol).await?;
    assert_eq!(balances + pool, supply, "balances + pool = supply");
    let keys = w.keys().await?;
    assert_eq!(keys.len(), 1);
    assert!(keys.iter().all(|(_, p)| !matches!(p, AccessKeyPermission::FullAccess)), "zero full-access keys");
    assert_eq!(keys[0].0, budi_voice.public_key());
    println!("invariants hold; the coin's only key is budi's voice key");
    Ok(())
}
