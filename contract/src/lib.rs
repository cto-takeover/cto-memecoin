//! CTO: the NEAR testnet memecoin where anyone can take over (spec 1).
//!
//! One contract is both the coin (NEP-141/145/148) and the CEO seat. There are no
//! owner powers: nothing changes the config, upgrades code, mints after `new`, or
//! adds a full-access key. After deploy the account's only key is the current CEO's
//! voice key, a function-call key that can only call `announce`.

pub mod events;
pub mod face;
pub mod lines;
pub mod price;

use near_contract_standards::fungible_token::events::{FtBurn, FtMint, FtTransfer};
use near_contract_standards::fungible_token::metadata::{
    FT_METADATA_SPEC, FungibleTokenMetadata, FungibleTokenMetadataProvider,
};
use near_contract_standards::fungible_token::{
    FungibleToken, FungibleTokenCore, FungibleTokenResolver,
};
use near_contract_standards::storage_management::{
    StorageBalance, StorageBalanceBounds, StorageManagement,
};
use near_sdk::json_types::{U64, U128};
use near_sdk::store::{LookupSet, Vector};
use near_sdk::{
    AccountId, Allowance, BorshStorageKey, Gas, NearToken, PanicOnDefault, Promise, PromiseError,
    PromiseOrValue, PublicKey, env, log, near, require,
};

pub use face::Face;
use price::{Quote, Rules, whole_cto};

/// 1,000,000,000 CTO at launch, in base units (18 decimals).
pub const TOTAL_SUPPLY: u128 = 1_000_000_000 * price::ONE_CTO;
pub const DECIMALS: u8 = 18;
/// Attached to `take_seat`, exactly; funds the new voice key's gas.
pub const TAKE_SEAT_DEPOSIT: NearToken = NearToken::from_millinear(250);
/// Allowance on each voice key.
pub const VOICE_KEY_ALLOWANCE: NearToken = NearToken::from_millinear(250);
/// The only method a voice key may call.
pub const VOICE_KEY_METHOD: &str = "announce";
pub const ANNOUNCEMENTS_KEPT: u32 = 50;
pub const HISTORY_PAGE_MAX: u32 = 50;
const ON_KEY_SWAP_GAS: Gas = Gas::from_tgas(5);
const MAX_DECAY_S: u64 = 10 * 365 * 86_400;

/// Error messages are part of the API: tests and the web app match them exactly.
pub mod errors {
    pub const DEPOSIT: &str = "CTO: attach exactly 0.25 NEAR for the voice key";
    pub const FACE: &str = "CTO: unknown face part";
    pub const KEY_IN_USE: &str = "CTO: that voice key is already in use";
    pub const NOT_VOICE_KEY: &str = "CTO: only the coin's voice key can announce";
    pub const LINE: &str = "CTO: unknown announcement line";
    /// Not named in spec 1; added for the faucet and launch checks.
    pub const FAUCET_CLAIMED: &str = "CTO: faucet already claimed by this account";
    pub const FAUCET_EMPTY: &str = "CTO: the faucet is empty";
    pub const FAUCET_STORAGE: &str = "CTO: attach at least 0.00125 NEAR to register storage";
    pub const FORCE_UNREGISTER: &str = "CTO: force unregister is not supported, tokens only burn in takeovers";
    pub const BAD_CONFIG: &str = "CTO: invalid launch config";
    pub const ALLOCATIONS: &str = "CTO: allocations exceed the total supply";

    /// "CTO: price moved to {price} CTO, above your max {max_price}"
    pub fn price_moved(price: u128, max_price: u128) -> String {
        format!(
            "CTO: price moved to {} CTO, above your max {}",
            super::whole_cto(price),
            super::whole_cto(max_price)
        )
    }

    /// "CTO: price is {price} CTO, you have {balance}"
    pub fn balance_too_low(price: u128, balance: u128) -> String {
        format!(
            "CTO: price is {} CTO, you have {}",
            super::whole_cto(price),
            super::whole_cto(balance)
        )
    }
}

#[derive(BorshStorageKey)]
#[near]
enum StorageKey {
    Token,
    History,
    Announcements,
    Claimed,
}

/// Launch numbers. Set in `new()`; no setter exists.
#[near(serializers = [borsh])]
#[derive(Clone)]
pub struct Config {
    pub name: String,
    pub symbol: String,
    pub opening_price: u128,
    pub decay_delay_s: u64,
    pub decay_length_s: u64,
    pub faucet_amount: u128,
}

#[near(serializers = [borsh])]
#[derive(Clone)]
pub struct Seat {
    pub ceo: AccountId,
    pub paid: u128,
    pub since_ns: u64,
    pub face: Face,
    pub voice_key: PublicKey,
}

#[near(serializers = [json, borsh])]
#[derive(Clone, Debug, PartialEq)]
pub struct Takeover {
    pub index: u64,
    pub ceo: AccountId,
    pub previous_ceo: Option<AccountId>,
    pub paid: U128,
    pub payout: U128,
    pub burned: U128,
    pub face: Face,
    pub at_ns: U64,
    pub block_height: u64,
}

#[near(serializers = [json, borsh])]
#[derive(Clone, Debug, PartialEq)]
pub struct Announcement {
    pub index: u64,
    pub ceo: AccountId,
    pub line: u8,
    pub text: String,
    pub at_ns: U64,
}

/// `get_seat()`. When vacant: `vacant = true`, the price is the opening price and
/// the face is the launch face.
#[near(serializers = [json])]
#[derive(Debug, PartialEq)]
pub struct SeatView {
    pub vacant: bool,
    pub ceo: Option<AccountId>,
    pub paid: Option<U128>,
    pub current_price: U128,
    /// What the current CEO would get if someone took the seat now.
    pub next_payout: U128,
    /// What would burn if someone took the seat now.
    pub next_burned: U128,
    pub floor: U128,
    pub since_ns: Option<U64>,
    pub face: Face,
    pub face_id: u16,
    pub voice_key: Option<PublicKey>,
    pub seconds_until_decay: u64,
    pub decaying: bool,
}

#[near(serializers = [json])]
pub struct ConfigView {
    pub name: String,
    pub symbol: String,
    pub decimals: u8,
    pub total_supply_at_launch: U128,
    pub opening_price: U128,
    pub decay_delay_s: u64,
    pub decay_length_s: u64,
    pub faucet_amount: U128,
    pub take_seat_deposit: NearToken,
    pub voice_key_allowance: NearToken,
    pub voice_key_method: String,
    pub announcements_kept: u32,
    pub announcement_lines: u32,
    pub history_page_max: u32,
    pub takeover_ratio: String,
    pub payout_ratio: String,
}

#[near(serializers = [json])]
pub struct FaucetStatus {
    pub pool_left: U128,
    pub claimed: bool,
    pub amount: U128,
}

#[near(contract_state)]
#[derive(PanicOnDefault)]
pub struct Contract {
    token: FungibleToken,
    config: Config,
    seat: Option<Seat>,
    history: Vector<Takeover>,
    /// Ring of the newest `ANNOUNCEMENTS_KEPT`; slot = index % 50.
    announcements: Vector<Announcement>,
    announcement_count: u64,
    /// Unclaimed supply. Counted in `ft_total_supply`, held by no account.
    faucet_pool: u128,
    claimed: LookupSet<AccountId>,
}

#[near]
impl Contract {
    /// Mints 1,000,000,000 CTO: `allocations` to the listed accounts (registering
    /// their storage), the rest to the faucet pool. Callable once, by the account
    /// itself (in the deploy transaction).
    #[init]
    #[private]
    #[allow(clippy::too_many_arguments)] // spec 1's signature
    pub fn new(
        name: String,
        symbol: String,
        opening_price: U128,
        decay_delay_s: u64,
        decay_length_s: u64,
        faucet_amount: U128,
        allocations: Vec<(AccountId, U128)>,
    ) -> Self {
        require!(
            opening_price.0 > 0
                && faucet_amount.0 > 0
                && decay_length_s > 0
                && decay_length_s <= MAX_DECAY_S
                && decay_delay_s <= MAX_DECAY_S,
            errors::BAD_CONFIG
        );
        let mut token = FungibleToken::new(StorageKey::Token);
        let mut allocated: u128 = 0;
        for (account_id, amount) in &allocations {
            allocated = allocated.saturating_add(amount.0);
            require!(allocated <= TOTAL_SUPPLY, errors::ALLOCATIONS);
            token.internal_register_account(account_id);
            token.internal_deposit(account_id, amount.0);
            FtMint { owner_id: account_id, amount: *amount, memo: Some("launch allocation") }.emit();
        }
        let faucet_pool = TOTAL_SUPPLY - allocated;
        token.total_supply += faucet_pool;
        FtMint {
            owner_id: &env::current_account_id(),
            amount: U128(faucet_pool),
            memo: Some("faucet pool"),
        }
        .emit();
        Self {
            token,
            config: Config {
                name,
                symbol,
                opening_price: opening_price.0,
                decay_delay_s,
                decay_length_s,
                faucet_amount: faucet_amount.0,
            },
            seat: None,
            history: Vector::new(StorageKey::History),
            announcements: Vector::new(StorageKey::Announcements),
            announcement_count: 0,
            faucet_pool,
            claimed: LookupSet::new(StorageKey::Claimed),
        }
    }

    // ---------------------------------------------------------------- faucet

    /// Pays `faucet_amount` from the pool, once per account. Registers storage if
    /// needed (attach ≥ 0.00125 NEAR); any excess is refunded.
    #[payable]
    pub fn claim_faucet(&mut self) -> U128 {
        let who = env::predecessor_account_id();
        require!(!self.claimed.contains(&who), errors::FAUCET_CLAIMED);
        let amount = self.config.faucet_amount;
        require!(self.faucet_pool >= amount, errors::FAUCET_EMPTY);

        let mut refund = env::attached_deposit();
        if !self.token.accounts.contains_key(&who) {
            let min = self.token.storage_balance_bounds().min;
            require!(refund >= min, errors::FAUCET_STORAGE);
            refund = refund.saturating_sub(min);
            self.token.internal_register_account(&who);
        }

        self.claimed.insert(who.clone());
        self.faucet_pool -= amount;
        self.token.internal_deposit(&who, amount);
        // The pool was already counted in total supply; this is a transfer, not a mint.
        self.token.total_supply -= amount;
        FtTransfer {
            old_owner_id: &env::current_account_id(),
            new_owner_id: &who,
            amount: U128(amount),
            memo: Some("faucet"),
        }
        .emit();
        events::faucet_claim(&who, amount);

        if !refund.is_zero() {
            let _ = Promise::new(who).transfer(refund);
        }
        U128(amount)
    }

    pub fn faucet_status(&self, account_id: AccountId) -> FaucetStatus {
        FaucetStatus {
            pool_left: U128(self.faucet_pool),
            claimed: self.claimed.contains(&account_id),
            amount: U128(self.config.faucet_amount),
        }
    }

    // ------------------------------------------------------------- the seat

    /// The takeover. Attach exactly 0.25 NEAR. Pays `price` (fails if it is above
    /// `max_price`): the old CEO gets 23/28, the rest burns. Then, in the next
    /// receipt, the old voice key is deleted and `new_ceo_key` is added.
    #[payable]
    pub fn take_seat(&mut self, face: Face, new_ceo_key: PublicKey, max_price: U128) -> Promise {
        require!(env::attached_deposit() == TAKE_SEAT_DEPOSIT, errors::DEPOSIT);
        require!(face.is_valid(), errors::FACE);

        let q = self.quote_now();
        if q.price > max_price.0 {
            env::panic_str(&errors::price_moved(q.price, max_price.0));
        }
        let caller = env::predecessor_account_id();
        let balance = self.token.ft_balance_of(caller.clone()).0;
        if balance < q.price {
            env::panic_str(&errors::balance_too_low(q.price, balance));
        }
        if let Some(seat) = &self.seat {
            require!(seat.voice_key != new_ceo_key, errors::KEY_IN_USE);
        }

        // Money: exactly `price` leaves the caller; payout + burned == price.
        let old = self.seat.take();
        self.token.internal_withdraw(&caller, q.price);
        if let Some(prev) = &old {
            // The old CEO may have unregistered storage since; re-register (the
            // 0.25 NEAR attached covers it) so the takeover can never get stuck.
            if !self.token.accounts.contains_key(&prev.ceo) {
                self.token.internal_register_account(&prev.ceo);
            }
            self.token.internal_deposit(&prev.ceo, q.payout);
        }

        let now = env::block_timestamp();
        let index = self.history.len() as u64;
        self.seat = Some(Seat {
            ceo: caller.clone(),
            paid: q.price,
            since_ns: now,
            face,
            voice_key: new_ceo_key.clone(),
        });
        self.history.push(Takeover {
            index,
            ceo: caller.clone(),
            previous_ceo: old.as_ref().map(|s| s.ceo.clone()),
            paid: U128(q.price),
            payout: U128(q.payout),
            burned: U128(q.burned),
            face,
            at_ns: U64(now),
            block_height: env::block_height(),
        });

        if let Some(prev) = &old {
            FtTransfer {
                old_owner_id: &caller,
                new_owner_id: &prev.ceo,
                amount: U128(q.payout),
                memo: Some("takeover payout"),
            }
            .emit();
        }
        FtBurn { owner_id: &caller, amount: U128(q.burned), memo: Some("takeover burn") }.emit();
        events::seat_taken(
            &caller,
            old.as_ref().map(|s| &s.ceo),
            q.price,
            q.payout,
            q.burned,
            face.id(),
            index,
        );

        // Key swap, one batch on this account. The KEY_IN_USE check above removes the
        // only way it can fail.
        let me = env::current_account_id();
        let mut batch = Promise::new(me.clone());
        if let Some(prev) = old {
            batch = batch.delete_key(prev.voice_key);
        }
        batch
            .add_access_key_allowance(
                new_ceo_key,
                Allowance::limited(VOICE_KEY_ALLOWANCE).unwrap(),
                me,
                VOICE_KEY_METHOD,
            )
            .then(Self::ext(env::current_account_id()).with_static_gas(ON_KEY_SWAP_GAS).on_key_swap(index))
    }

    /// Logs whether the key swap for a takeover went through.
    #[private]
    pub fn on_key_swap(&mut self, #[callback_result] result: Result<(), PromiseError>, takeover_index: u64) {
        match result {
            Ok(()) => log!("key swap for takeover {}: ok", takeover_index),
            Err(_) => log!("key swap for takeover {}: FAILED", takeover_index),
        }
    }

    /// Posts one of the 24 fixed lines. Only a transaction signed by this account
    /// with the current voice key gets here; an old key is refused by NEAR itself
    /// (`AccessKeyNotFound`) before this code runs.
    pub fn announce(&mut self, line: u8) -> Announcement {
        let seat = self.seat.as_ref().filter(|s| {
            env::predecessor_account_id() == env::current_account_id()
                && s.voice_key == env::signer_account_pk()
        });
        let Some(seat) = seat else { env::panic_str(errors::NOT_VOICE_KEY) };
        let ceo = seat.ceo.clone();
        let text = lines::render(
            line,
            &lines::Slots {
                next_price: &whole_cto(self.quote_now().price),
                burned: &whole_cto(self.total_burned().0),
                ceo: ceo.as_str(),
            },
        )
        .unwrap_or_else(|| env::panic_str(errors::LINE));

        let index = self.announcement_count;
        let post = Announcement { index, ceo, line, text, at_ns: U64(env::block_timestamp()) };
        if self.announcements.len() < ANNOUNCEMENTS_KEPT {
            self.announcements.push(post.clone());
        } else {
            self.announcements.set((index % ANNOUNCEMENTS_KEPT as u64) as u32, post.clone());
        }
        self.announcement_count += 1;
        events::announcement(&post.ceo, index, line, &post.text);
        post
    }

    // ----------------------------------------------------------------- views

    pub fn get_seat(&self) -> SeatView {
        let rules = self.rules();
        let paid = self.seat.as_ref().map(|s| s.paid);
        let idle = self.idle_s();
        let q = price::quote(&rules, paid, idle);
        let face = self.current_face();
        SeatView {
            vacant: self.seat.is_none(),
            ceo: self.seat.as_ref().map(|s| s.ceo.clone()),
            paid: paid.map(U128),
            current_price: U128(q.price),
            next_payout: U128(q.payout),
            next_burned: U128(q.burned),
            floor: U128(rules.floor),
            since_ns: self.seat.as_ref().map(|s| U64(s.since_ns)),
            face,
            face_id: face.id(),
            voice_key: self.seat.as_ref().map(|s| s.voice_key.clone()),
            seconds_until_decay: price::seconds_until_decay(&rules, paid, idle),
            decaying: paid.is_some() && idle > rules.decay_delay_s,
        }
    }

    pub fn get_config(&self) -> ConfigView {
        let c = &self.config;
        ConfigView {
            name: c.name.clone(),
            symbol: c.symbol.clone(),
            decimals: DECIMALS,
            total_supply_at_launch: U128(TOTAL_SUPPLY),
            opening_price: U128(c.opening_price),
            decay_delay_s: c.decay_delay_s,
            decay_length_s: c.decay_length_s,
            faucet_amount: U128(c.faucet_amount),
            take_seat_deposit: TAKE_SEAT_DEPOSIT,
            voice_key_allowance: VOICE_KEY_ALLOWANCE,
            voice_key_method: VOICE_KEY_METHOD.to_string(),
            announcements_kept: ANNOUNCEMENTS_KEPT,
            announcement_lines: lines::LINES.len() as u32,
            history_page_max: HISTORY_PAGE_MAX,
            takeover_ratio: format!("{}/{}", price::TAKEOVER_NUM, price::TAKEOVER_DEN),
            payout_ratio: format!("{}/{}", price::PAYOUT_NUM, price::PAYOUT_DEN),
        }
    }

    /// Takeovers newest first. `from_index` counts back from the newest (0 = newest);
    /// `limit` is capped at 50.
    pub fn get_history(&self, from_index: Option<u32>, limit: Option<u32>) -> Vec<Takeover> {
        let len = self.history.len();
        let skip = from_index.unwrap_or(0).min(len);
        let limit = limit.unwrap_or(HISTORY_PAGE_MAX).min(HISTORY_PAGE_MAX);
        (0..(len - skip).min(limit)).map(|i| self.history[len - 1 - skip - i].clone()).collect()
    }

    /// Newest posts first, at most 50.
    pub fn get_announcements(&self, limit: Option<u32>) -> Vec<Announcement> {
        let kept = (self.announcement_count.min(ANNOUNCEMENTS_KEPT as u64)) as u32;
        let limit = limit.unwrap_or(ANNOUNCEMENTS_KEPT).min(kept);
        (0..limit as u64)
            .map(|i| {
                let index = self.announcement_count - 1 - i;
                self.announcements[(index % ANNOUNCEMENTS_KEPT as u64) as u32].clone()
            })
            .collect()
    }

    /// The 24 line templates, so the page and relayer never keep their own copy.
    pub fn get_lines(&self) -> Vec<String> {
        lines::LINES.iter().map(|l| l.to_string()).collect()
    }

    /// The SVG for any face; previews match the chain byte for byte.
    pub fn face_svg(&self, face: Face) -> String {
        require!(face.is_valid(), errors::FACE);
        face.svg()
    }

    pub fn total_burned(&self) -> U128 {
        U128(TOTAL_SUPPLY - self.token.total_supply)
    }

    // --------------------------------------------------------------- helpers

    fn rules(&self) -> Rules {
        Rules {
            floor: self.config.opening_price,
            decay_delay_s: self.config.decay_delay_s,
            decay_length_s: self.config.decay_length_s,
        }
    }

    fn idle_s(&self) -> u64 {
        self.seat
            .as_ref()
            .map(|s| env::block_timestamp().saturating_sub(s.since_ns) / 1_000_000_000)
            .unwrap_or(0)
    }

    fn quote_now(&self) -> Quote {
        price::quote(&self.rules(), self.seat.as_ref().map(|s| s.paid), self.idle_s())
    }

    fn current_face(&self) -> Face {
        self.seat.as_ref().map(|s| s.face).unwrap_or(Face::LAUNCH)
    }
}

// --------------------------------------------------------- NEP-141 / 145 / 148

#[near]
impl FungibleTokenMetadataProvider for Contract {
    /// `icon` is the live face.
    fn ft_metadata(&self) -> FungibleTokenMetadata {
        FungibleTokenMetadata {
            spec: FT_METADATA_SPEC.to_string(),
            name: self.config.name.clone(),
            symbol: self.config.symbol.clone(),
            icon: Some(self.current_face().icon()),
            reference: None,
            reference_hash: None,
            decimals: DECIMALS,
        }
    }
}

#[near]
impl FungibleTokenCore for Contract {
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
impl FungibleTokenResolver for Contract {
    /// Standard resolve. Tokens the standard would burn (refund to a sender who
    /// unregistered meanwhile) go back to the faucet pool instead, so supply only
    /// ever falls through takeovers.
    #[private]
    fn ft_resolve_transfer(&mut self, sender_id: AccountId, receiver_id: AccountId, amount: U128) -> U128 {
        let (used, burned) = self.token.internal_ft_resolve_transfer(&sender_id, receiver_id, amount);
        if burned > 0 {
            self.token.total_supply += burned;
            self.faucet_pool += burned;
            log!("{} unclaimed refund returned to the faucet pool", burned);
        }
        used.into()
    }
}

#[near]
impl StorageManagement for Contract {
    #[payable]
    fn storage_deposit(&mut self, account_id: Option<AccountId>, registration_only: Option<bool>) -> StorageBalance {
        self.token.storage_deposit(account_id, registration_only)
    }

    #[payable]
    fn storage_withdraw(&mut self, amount: Option<NearToken>) -> StorageBalance {
        self.token.storage_withdraw(amount)
    }

    /// Only with a zero balance: `force` would burn tokens outside a takeover.
    #[payable]
    fn storage_unregister(&mut self, force: Option<bool>) -> bool {
        require!(!force.unwrap_or(false), errors::FORCE_UNREGISTER);
        self.token.internal_storage_unregister(Some(false)).is_some()
    }

    fn storage_balance_bounds(&self) -> StorageBalanceBounds {
        self.token.storage_balance_bounds()
    }

    fn storage_balance_of(&self, account_id: AccountId) -> Option<StorageBalance> {
        self.token.storage_balance_of(account_id)
    }
}

#[cfg(test)]
mod tests;
