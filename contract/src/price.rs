//! Pure price math (spec 1). No `env` calls: the 60-day simulation (spec 5) imports this file.
//!
//! All amounts are base units (18 decimals). Every division rounds down.
//!
//! ```text
//! top    = floor(7 * P / 5)
//! price  = F                                                       if seat vacant
//!        = top                                                     if idle <= D
//!        = max(F, top - floor((top - F) * min(idle - D, L) / L))   otherwise
//! payout = 0                                                       if seat vacant
//!        = floor(23 * price / 28)                                  otherwise
//! burned = price - payout
//! ```

/// Takeover price = last paid × 7/5.
pub const TAKEOVER_NUM: u128 = 7;
pub const TAKEOVER_DEN: u128 = 5;
/// Old CEO payout = 23/28 of what the new CEO pays.
pub const PAYOUT_NUM: u128 = 23;
pub const PAYOUT_DEN: u128 = 28;

/// 10^18 base units per whole CTO.
pub const ONE_CTO: u128 = 1_000_000_000_000_000_000;

/// The launch numbers the math depends on.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Rules {
    /// F: opening price, also the floor.
    pub floor: u128,
    /// D: seconds after a takeover before the price starts to fall.
    pub decay_delay_s: u64,
    /// L: seconds the fall takes to reach the floor. Must be > 0.
    pub decay_length_s: u64,
}

/// What a takeover costs right now and where the money goes.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Quote {
    pub price: u128,
    pub payout: u128,
    pub burned: u128,
}

/// floor(7 * paid / 5).
pub fn top(paid: u128) -> u128 {
    paid.checked_mul(TAKEOVER_NUM).expect("CTO: price overflow") / TAKEOVER_DEN
}

/// Takeover price. `paid` is `None` when the seat is vacant; `idle_s` is whole
/// seconds since the last takeover.
pub fn price(rules: &Rules, paid: Option<u128>, idle_s: u64) -> u128 {
    let Some(paid) = paid else { return rules.floor };
    let top = top(paid);
    if idle_s <= rules.decay_delay_s {
        return top;
    }
    let into_decay = (idle_s - rules.decay_delay_s).min(rules.decay_length_s) as u128;
    let span = top.saturating_sub(rules.floor);
    let drop = span.checked_mul(into_decay).expect("CTO: price overflow") / rules.decay_length_s as u128;
    top.saturating_sub(drop).max(rules.floor)
}

/// Splits a price into the old CEO's payout and the burn.
pub fn split(price: u128, vacant: bool) -> Quote {
    let payout = if vacant {
        0
    } else {
        price.checked_mul(PAYOUT_NUM).expect("CTO: price overflow") / PAYOUT_DEN
    };
    Quote { price, payout, burned: price - payout }
}

/// Price, payout and burn for a takeover now.
pub fn quote(rules: &Rules, paid: Option<u128>, idle_s: u64) -> Quote {
    split(price(rules, paid, idle_s), paid.is_none())
}

/// Seconds left before the price starts to fall (0 once decay has started or the seat is vacant).
pub fn seconds_until_decay(rules: &Rules, paid: Option<u128>, idle_s: u64) -> u64 {
    match paid {
        None => 0,
        Some(_) => rules.decay_delay_s.saturating_sub(idle_s),
    }
}

/// Whole CTO with thousands separators, decimals truncated: 1_400_000 * 10^18 → "1,400,000".
pub fn whole_cto(amount: u128) -> String {
    let digits = (amount / ONE_CTO).to_string();
    let mut out = String::with_capacity(digits.len() + digits.len() / 3);
    for (i, c) in digits.chars().enumerate() {
        if i > 0 && (digits.len() - i).is_multiple_of(3) {
            out.push(',');
        }
        out.push(c);
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    const DAY: u64 = 86_400;
    const F: u128 = 1_000_000 * ONE_CTO;
    const MAIN: Rules = Rules { floor: F, decay_delay_s: 7 * DAY, decay_length_s: 7 * DAY };

    fn cto(n: u128) -> u128 {
        n * ONE_CTO
    }

    fn assert_split(q: Quote) {
        assert_eq!(q.payout + q.burned, q.price);
    }

    #[test]
    fn vacant_seat_costs_the_floor_and_burns_it_all() {
        for idle in [0, DAY, 100 * DAY] {
            let q = quote(&MAIN, None, idle);
            assert_eq!(q, Quote { price: F, payout: 0, burned: F });
        }
    }

    #[test]
    fn story_numbers() {
        let q = quote(&MAIN, Some(cto(1_000_000)), 0);
        assert_eq!(q, Quote { price: cto(1_400_000), payout: cto(1_150_000), burned: cto(250_000) });
        let next = quote(&MAIN, Some(q.price), 7 * DAY);
        assert_eq!(next, Quote { price: cto(1_960_000), payout: cto(1_610_000), burned: cto(350_000) });
    }

    #[test]
    fn half_decayed_after_ten_and_a_half_days() {
        let q = quote(&MAIN, Some(cto(1_000_000)), 7 * DAY + 7 * DAY / 2);
        assert_eq!(q.price, cto(1_200_000));
        assert_eq!(q.payout, cto(1_200_000) * 23 / 28); // 985,714.28… exact in base units
        assert_eq!(q.payout, 985_714_285_714_285_714_285_714);
        assert_split(q);
    }

    #[test]
    fn floor_after_thirty_days() {
        let q = quote(&MAIN, Some(cto(1_000_000)), 30 * DAY);
        assert_eq!(q.price, F);
        assert_eq!(q.payout, 821_428_571_428_571_428_571_428);
        assert_split(q);
    }

    #[test]
    fn decay_boundaries() {
        let p = Some(cto(1_000_000));
        assert_eq!(price(&MAIN, p, 7 * DAY), cto(1_400_000), "still full price at exactly D");
        assert!(price(&MAIN, p, 7 * DAY + 1) < cto(1_400_000), "falls one second after D");
        assert_eq!(price(&MAIN, p, 14 * DAY), F, "floor at exactly D + L");
        assert_eq!(seconds_until_decay(&MAIN, p, DAY), 6 * DAY);
        assert_eq!(seconds_until_decay(&MAIN, p, 8 * DAY), 0);
        assert_eq!(seconds_until_decay(&MAIN, None, 0), 0);
    }

    #[test]
    fn price_never_rises_while_idle_and_never_goes_below_floor() {
        let demo = Rules { floor: F, decay_delay_s: 120, decay_length_s: 180 };
        let mut last = u128::MAX;
        for idle in 0..400 {
            let q = quote(&demo, Some(cto(1_960_000)), idle);
            assert!(q.price <= last && q.price >= F);
            assert_split(q);
            last = q.price;
        }
        assert_eq!(last, F);
    }

    #[test]
    fn split_rounds_down_and_always_adds_up() {
        for price in [1u128, 27, 28, 29, 1_000_000_000_000_000_000_000_000_007] {
            let q = split(price, false);
            assert_eq!(q.payout, price * 23 / 28);
            assert_split(q);
        }
    }

    #[test]
    fn whole_cto_formatting() {
        assert_eq!(whole_cto(0), "0");
        assert_eq!(whole_cto(cto(999)), "999");
        assert_eq!(whole_cto(cto(1_000)), "1,000");
        assert_eq!(whole_cto(cto(1_400_000)), "1,400,000");
        assert_eq!(whole_cto(985_714_285_714_285_714_285_714), "985,714");
        assert_eq!(whole_cto(cto(1_000_000_000)), "1,000,000,000");
    }
}
