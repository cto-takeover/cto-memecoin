//! NEP-297 events, standard `cto`, version `1.0.0` (spec 1). `data` is a one-element
//! array, like NEP-141's events.

use near_sdk::json_types::U128;
use near_sdk::serde_json::{Value, json};
use near_sdk::{AccountId, log};

pub const STANDARD: &str = "cto";
pub const VERSION: &str = "1.0.0";

fn emit(event: &str, data: Value) {
    log!(
        "EVENT_JSON:{}",
        json!({ "standard": STANDARD, "version": VERSION, "event": event, "data": [data] })
    );
}

#[allow(clippy::too_many_arguments)]
pub fn seat_taken(
    ceo: &AccountId,
    previous_ceo: Option<&AccountId>,
    price: u128,
    payout: u128,
    burned: u128,
    face_id: u16,
    takeover_index: u64,
) {
    emit(
        "seat_taken",
        json!({
            "ceo": ceo,
            "previous_ceo": previous_ceo,
            "price": U128(price),
            "payout": U128(payout),
            "burned": U128(burned),
            "face_id": face_id,
            "takeover_index": takeover_index,
        }),
    );
}

pub fn announcement(ceo: &AccountId, index: u64, line: u8, text: &str) {
    emit("announcement", json!({ "ceo": ceo, "index": index, "line": line, "text": text }));
}

pub fn faucet_claim(account_id: &AccountId, amount: u128) {
    emit("faucet_claim", json!({ "account_id": account_id, "amount": U128(amount) }));
}
