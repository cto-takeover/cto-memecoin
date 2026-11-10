//! CTO spike (spec 0). Throwaway: proves the two NEAR tricks CTO depends on.
//!
//! Gate A: the contract swaps a function-call key on its own account in one batch
//!         (DeleteKey old, AddKey new limited to `ping`).
//! Gate B: `ft_metadata().icon` is built on chain from a stored face number,
//!         and `set_face` changes it.
//!
//! Spike only: `swap` and `set_face` are open to anyone. The real contract (spec 1)
//! has no such methods.

mod face;

use near_contract_standards::fungible_token::events::FtMint;
use near_contract_standards::fungible_token::metadata::{
    FT_METADATA_SPEC, FungibleTokenMetadata, FungibleTokenMetadataProvider,
};
use near_contract_standards::fungible_token::{
    FungibleToken, FungibleTokenCore, FungibleTokenResolver,
};
use near_contract_standards::storage_management::{
    StorageBalance, StorageBalanceBounds, StorageManagement,
};
use near_sdk::json_types::U128;
use near_sdk::{
    AccountId, Allowance, NearToken, PanicOnDefault, Promise, PromiseOrValue, PublicKey, env, log,
    near, require,
};

/// 1,000,000 spike tokens, 18 decimals.
const SUPPLY: u128 = 1_000_000 * 10u128.pow(18);
/// Voice key allowance, same as CTO: 0.25 NEAR.
const KEY_ALLOWANCE: NearToken = NearToken::from_millinear(250);
/// The only method the swapped key may call.
const KEY_METHOD: &str = "ping";
/// Launch face [0, 0, 1, 0].
const LAUNCH_FACE: u16 = 9;

#[near(contract_state)]
#[derive(PanicOnDefault)]
pub struct Spike {
    token: FungibleToken,
    voice_key: Option<PublicKey>,
    face: u16,
}

#[near(serializers = [json])]
pub struct FaceView {
    pub id: u16,
    pub parts: [u8; 4],
}

#[near]
impl Spike {
    /// Mints the whole spike supply to `holder` (the human's wallet account).
    #[init]
    pub fn new(holder: AccountId) -> Self {
        let mut token = FungibleToken::new(b"t".to_vec());
        token.internal_register_account(&holder);
        token.internal_deposit(&holder, SUPPLY);
        FtMint {
            owner_id: &holder,
            amount: U128(SUPPLY),
            memo: Some("spike launch"),
        }
        .emit();
        Self { token, voice_key: None, face: LAUNCH_FACE }
    }

    /// Gate A. One batch on this account: delete the stored key (if any), then add
    /// `new_pk` as a function-call key (receiver = this account, method `ping`,
    /// allowance 0.25 NEAR). Stores `new_pk`.
    pub fn swap(&mut self, new_pk: PublicKey) -> Promise {
        let me = env::current_account_id();
        let mut batch = Promise::new(me.clone());
        if let Some(old) = self.voice_key.take() {
            log!("swap: deleting {}", old);
            batch = batch.delete_key(old);
        }
        log!("swap: adding {} (ping only, 0.25 NEAR allowance)", new_pk);
        self.voice_key = Some(new_pk.clone());
        batch.add_access_key_allowance(
            new_pk,
            Allowance::limited(KEY_ALLOWANCE).unwrap(),
            me,
            KEY_METHOD,
        )
    }

    /// Gate A. Only this account may call (i.e. a transaction signed by one of its
    /// own keys). Logs which key signed.
    pub fn ping(&self) {
        require!(
            env::predecessor_account_id() == env::current_account_id(),
            "SPIKE: only the spike account itself can ping"
        );
        log!("ping by {}", env::signer_account_pk());
    }

    pub fn get_voice_key(&self) -> Option<PublicKey> {
        self.voice_key.clone()
    }

    /// Gate B. Spike only: anyone may change the face. `face_id` is 1..=4096.
    pub fn set_face(&mut self, face_id: u16) {
        require!(face::parts_of(face_id).is_some(), "SPIKE: face id must be 1-4096");
        log!("face {} -> {}", self.face, face_id);
        self.face = face_id;
    }

    pub fn get_face(&self) -> FaceView {
        FaceView { id: self.face, parts: face::parts_of(self.face).unwrap() }
    }

    /// SVG for any face id, for comparing with the icon.
    pub fn face_svg(&self, face_id: u16) -> String {
        face::svg(face::parts_of(face_id).expect("SPIKE: face id must be 1-4096"))
    }
}

#[near]
impl FungibleTokenMetadataProvider for Spike {
    fn ft_metadata(&self) -> FungibleTokenMetadata {
        FungibleTokenMetadata {
            spec: FT_METADATA_SPEC.to_string(),
            name: "CTO Spike".to_string(),
            symbol: "CTOSPIKE".to_string(),
            icon: Some(face::icon_data_uri(face::parts_of(self.face).unwrap())),
            reference: None,
            reference_hash: None,
            decimals: 18,
        }
    }
}

#[near]
impl FungibleTokenCore for Spike {
    #[payable]
    fn ft_transfer(&mut self, receiver_id: AccountId, amount: U128, memo: Option<String>) {
        self.token.ft_transfer(receiver_id, amount, memo)
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
impl FungibleTokenResolver for Spike {
    #[private]
    fn ft_resolve_transfer(
        &mut self,
        sender_id: AccountId,
        receiver_id: AccountId,
        amount: U128,
    ) -> U128 {
        let (used, _burned) = self.token.internal_ft_resolve_transfer(&sender_id, receiver_id, amount);
        used.into()
    }
}

#[near]
impl StorageManagement for Spike {
    #[payable]
    fn storage_deposit(
        &mut self,
        account_id: Option<AccountId>,
        registration_only: Option<bool>,
    ) -> StorageBalance {
        self.token.storage_deposit(account_id, registration_only)
    }

    #[payable]
    fn storage_withdraw(&mut self, amount: Option<NearToken>) -> StorageBalance {
        self.token.storage_withdraw(amount)
    }

    #[payable]
    fn storage_unregister(&mut self, force: Option<bool>) -> bool {
        self.token.internal_storage_unregister(force).is_some()
    }

    fn storage_balance_bounds(&self) -> StorageBalanceBounds {
        self.token.storage_balance_bounds()
    }

    fn storage_balance_of(&self, account_id: AccountId) -> Option<StorageBalance> {
        self.token.storage_balance_of(account_id)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use near_sdk::base64::{Engine, engine::general_purpose::STANDARD};
    use near_sdk::test_utils::{VMContextBuilder, accounts};
    use near_sdk::testing_env;

    fn ctx(predecessor: AccountId) {
        let mut b = VMContextBuilder::new();
        b.current_account_id(accounts(0)).predecessor_account_id(predecessor);
        testing_env!(b.build());
    }

    #[test]
    fn icon_follows_face() {
        ctx(accounts(1));
        let mut c = Spike::new(accounts(1));
        assert_eq!(c.ft_balance_of(accounts(1)).0, SUPPLY);
        let decode = |c: &Spike| {
            let icon = c.ft_metadata().icon.unwrap();
            let b64 = icon.strip_prefix("data:image/svg+xml;base64,").unwrap();
            String::from_utf8(STANDARD.decode(b64).unwrap()).unwrap()
        };
        assert_eq!(decode(&c), c.face_svg(9));
        c.set_face(2626);
        assert_eq!(c.get_face().parts, [5, 1, 0, 1]);
        assert_eq!(decode(&c), c.face_svg(2626));
    }

    #[test]
    #[should_panic(expected = "SPIKE: face id must be 1-4096")]
    fn rejects_bad_face() {
        ctx(accounts(1));
        Spike::new(accounts(1)).set_face(4097);
    }

    #[test]
    #[should_panic(expected = "SPIKE: only the spike account itself can ping")]
    fn ping_from_outside_fails() {
        ctx(accounts(1));
        Spike::new(accounts(1)).ping();
    }
}
