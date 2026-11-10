//! Gate A dry run on a local sandbox node: every step of spec 0, gate A.
//! Build first: `cargo near build non-reproducible-wasm`, then `cargo test --test gate_a -- --nocapture`.

use near_api::types::AccessKeyPermission;
use near_api::{AccountId, NearGas, NearToken, NetworkConfig, Signer};
use near_sdk::serde_json::json;
use std::sync::Arc;

const WASM: &str = concat!(env!("CARGO_MANIFEST_DIR"), "/target/near/cto_spike.wasm");

async fn create(sandbox: &near_sandbox::Sandbox, name: &str) -> testresult::TestResult<AccountId> {
    let id: AccountId = name.parse()?;
    sandbox
        .create_account(id.as_str().parse()?)
        .initial_balance(NearToken::from_near(10))
        .send()
        .await?;
    Ok(id)
}

/// A `ping` call signed as the spike account with `signer`.
fn ping(spike: &AccountId, signer: Arc<Signer>) -> near_api::advanced::ExecuteSignedTransaction {
    near_api::Contract(spike.clone())
        .call_function("ping", ())
        .transaction()
        .gas(NearGas::from_tgas(10))
        .with_signer(spike.clone(), signer)
}

/// Pre-signs `tx` and broadcasts it with a raw `send_tx` JSON-RPC call (via curl),
/// returning the node's response unedited. near-api drops the error details.
async fn send_raw(
    tx: near_api::advanced::ExecuteSignedTransaction,
    net: &NetworkConfig,
    rpc: &str,
) -> testresult::TestResult<String> {
    let signed = tx.presign_with(net).await?.transaction.signed().unwrap();
    send_presigned_raw(signed, rpc)
}

fn send_presigned_raw(
    signed: near_api::types::transaction::SignedTransaction,
    rpc: &str,
) -> testresult::TestResult<String> {
    use near_sdk::base64::{Engine, engine::general_purpose::STANDARD};
    let b64 = STANDARD.encode(near_sdk::borsh::to_vec(&signed)?);
    let body = json!({
        "jsonrpc": "2.0", "id": "gate-a", "method": "send_tx",
        "params": { "signed_tx_base64": b64, "wait_until": "FINAL" }
    });
    let out = std::process::Command::new("curl")
        .args(["-s", "-H", "Content-Type: application/json", "-d", &body.to_string(), rpc])
        .output()?;
    Ok(String::from_utf8(out.stdout)?)
}

#[tokio::test]
async fn gate_a_key_swap() -> testresult::TestResult<()> {
    let wasm = std::fs::read(WASM).expect("run `cargo near build non-reproducible-wasm` first");
    let sandbox = near_sandbox::Sandbox::start_sandbox().await?;
    let net = NetworkConfig::from_rpc_url("sandbox", sandbox.rpc_addr.parse()?);
    let genesis = Signer::from_secret_key(
        near_sandbox::config::DEFAULT_GENESIS_ACCOUNT_PRIVATE_KEY.parse()?,
    )?;

    let human = create(&sandbox, "human.sandbox").await?;
    let spike = create(&sandbox, "spike.sandbox").await?;
    let contract = near_api::Contract(spike.clone());

    // 1. Deploy; generate K1 and K2 locally.
    near_api::Contract::deploy(spike.clone())
        .use_code(wasm)
        .with_init_call("new", json!({ "holder": human }))?
        .with_signer(genesis.clone())
        .send_to(&net)
        .await?
        .assert_success();
    let k1 = near_api::signer::generate_secret_key()?;
    let k2 = near_api::signer::generate_secret_key()?;
    let (k1_pub, k2_pub) = (k1.public_key(), k2.public_key());
    let k1_signer = Signer::from_secret_key(k1)?;
    let k2_signer = Signer::from_secret_key(k2)?;

    let swap = |pk: String| {
        contract
            .call_function("swap", json!({ "new_pk": pk }))
            .transaction()
            .gas(NearGas::from_tgas(30))
            .with_signer(human.clone(), genesis.clone())
    };

    // 2. swap(K1) from the human's own account.
    let r = swap(k1_pub.to_string()).send_to(&net).await?.assert_success();
    println!("step 2 swap(K1) logs: {:?}", r.logs());

    let keys = near_api::Account(spike.clone()).list_keys().fetch_from(&net).await?.data;
    let k1_entry = keys.iter().find(|(pk, _)| *pk == k1_pub).expect("K1 on the account");
    match &k1_entry.1.permission {
        AccessKeyPermission::FunctionCall(fc) => {
            println!("K1 permission: {fc:?}");
            assert_eq!(fc.receiver_id, spike.to_string());
            assert_eq!(fc.method_names, vec!["ping".to_string()]);
            assert_eq!(fc.allowance, Some(NearToken::from_millinear(250)));
        }
        p => panic!("K1 should be a function-call key, got {p:?}"),
    }

    // 3. ping signed with K1 succeeds.
    let r = ping(&spike, k1_signer.clone()).send_to(&net).await?.assert_success();
    println!("step 3 ping(K1) logs: {:?}", r.logs());
    assert!(r.logs().contains(&format!("ping by {k1_pub}").as_str()));

    // The ex-CEO's wallet signs before it learns the key is gone: pre-sign a K1 ping now.
    let presigned = ping(&spike, k1_signer.clone())
        .presign_with(&net)
        .await?
        .transaction
        .signed()
        .unwrap();

    // 4. swap(K2).
    let r = swap(k2_pub.to_string()).send_to(&net).await?.assert_success();
    println!("step 4 swap(K2) logs: {:?}", r.logs());
    let keys = near_api::Account(spike.clone()).list_keys().fetch_from(&net).await?.data;
    assert!(!keys.iter().any(|(pk, _)| *pk == k1_pub), "K1 must be deleted");
    assert!(keys.iter().any(|(pk, _)| *pk == k2_pub), "K2 must be added");

    // 5a. The pre-signed K1 tx reaches the node and NEAR rejects it: AccessKeyNotFound.
    let msg = send_presigned_raw(presigned, &sandbox.rpc_addr)?;
    println!("step 5a pre-signed K1 ping -> {msg}");
    assert!(msg.contains("AccessKeyNotFound"), "{msg}");

    // 5b. A fresh K1 send never leaves the client: the nonce lookup fails first.
    let err = ping(&spike, k1_signer.clone()).send_to(&net).await.expect_err("K1 must fail");
    println!("step 5b fresh K1 ping -> {err:?}");

    // 6. ping signed with K2 succeeds.
    let r = ping(&spike, k2_signer.clone()).send_to(&net).await?.assert_success();
    println!("step 6 ping(K2) logs: {:?}", r.logs());
    assert!(r.logs().contains(&format!("ping by {k2_pub}").as_str()));

    // 7. Any other method signed with K2 fails: MethodNameMismatch.
    let tx = contract
        .call_function("set_face", json!({ "face_id": 2626 }))
        .transaction()
        .gas(NearGas::from_tgas(10))
        .with_signer(spike.clone(), k2_signer.clone());
    let msg = send_raw(tx, &net, &sandbox.rpc_addr).await?;
    println!("step 7 set_face with K2 -> {msg}");
    assert!(msg.contains("MethodNameMismatch"), "{msg}");

    Ok(())
}
