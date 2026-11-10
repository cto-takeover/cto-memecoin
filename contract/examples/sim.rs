//! 60-day simulation (spec 5). Plays the main coin's rules with the contract's own
//! `price.rs`, so the chart can never disagree with the chain. It shows the mechanic,
//! not a price forecast.
//!
//! ```text
//! cargo run -p cto --example sim -- --scenario busy --out web/public/sim/busy.csv
//! cargo run -p cto --example sim -- --scenario random --seed 42 --out web/public/sim/random.csv
//! cargo run -p cto --example sim -- --out-dir web/public/sim     # all four
//! cargo run -p cto --example sim -- --check                      # used by `npm run verify`
//! ```
//!
//! Model: launch at second 0 with the seat vacant. A takeover on day `d` happens at the
//! start of that day (second `d * 86400`). Each CSV row is the state at the last second
//! of its day. Amounts are whole CTO: `supply` rounds down and `burned_total` is
//! `total - supply`, so the two columns always add up to the total supply exactly
//! (the exact base-unit identity is checked separately).

use std::collections::BTreeMap;
use std::fmt::Write as _;
use std::path::{Path, PathBuf};
use std::process::ExitCode;

use cto::price::{self, ONE_CTO, Quote, Rules};
use near_sdk::serde_json::{self, Value};

const DAY: u64 = 86_400;
const HOUR: u64 = 3_600;
const DAYS: u64 = 60;
const CONSTANTS: &str = include_str!("../../reference/constants.json");

const SCENARIOS: [&str; 4] = ["busy", "quiet", "abandoned", "random"];
const BUSY_DAYS: &[u64] = &[1, 3, 5, 8, 11, 14, 18, 22, 27, 33, 40, 48, 57];
const QUIET_DAYS: &[u64] = &[1, 9, 20, 38];
const ABANDONED_DAYS: &[u64] = &[1, 4, 8];
/// Random scenario: each hour, this chance (in basis points) that someone takes the seat…
const RANDOM_CHANCE_BP: u64 = 200;
/// …if the price is under this many whole CTO.
const RANDOM_PRICE_CAP: u128 = 50_000_000;
const DEFAULT_SEED: u64 = 42;

/// Spec 5 table: (scenario, takeovers, burned by day 60 in whole CTO, allowed drift).
/// Busy drift is the spec's 0.1%; quiet and abandoned are given to 0.01M in the table.
const EXPECTED: &[(&str, usize, u128, Tolerance)] = &[
    ("busy", 13, 30_950_000, Tolerance::Permille(1)),
    ("quiet", 4, 1_660_000, Tolerance::Whole(5_000)),
    ("abandoned", 3, 1_600_000, Tolerance::Whole(5_000)),
];

#[derive(Clone, Copy)]
enum Tolerance {
    Permille(u128),
    Whole(u128),
}

/// Numbers loaded from `reference/constants.json`, never retyped.
struct Launch {
    rules: Rules,
    total_supply: u128,
}

fn launch() -> Result<Launch, String> {
    let c: Value = serde_json::from_str(CONSTANTS).map_err(|e| format!("constants.json: {e}"))?;
    let whole = |v: &Value, name: &str| -> Result<u128, String> {
        v.as_str()
            .and_then(|s| s.parse::<u128>().ok())
            .map(|n| n * ONE_CTO)
            .ok_or(format!("constants.json: {name} is not a whole-CTO string"))
    };
    let int = |v: &Value, name: &str| v.as_u64().ok_or(format!("constants.json: {name} is not an integer"));

    if int(&c["decimals"], "decimals")? != 18 {
        return Err("constants.json: decimals is not 18".into());
    }
    // price.rs carries the ratios as code; make sure they still match the reference.
    let ratio = |key: &str| -> Result<(u128, u128), String> {
        Ok((int(&c[key]["num"], key)? as u128, int(&c[key]["den"], key)? as u128))
    };
    if ratio("takeover_ratio")? != (price::TAKEOVER_NUM, price::TAKEOVER_DEN) {
        return Err("constants.json takeover_ratio differs from price.rs".into());
    }
    if ratio("payout_ratio_of_payment")? != (price::PAYOUT_NUM, price::PAYOUT_DEN) {
        return Err("constants.json payout_ratio_of_payment differs from price.rs".into());
    }
    let main = &c["coins"]["main"];
    Ok(Launch {
        rules: Rules {
            floor: whole(&c["opening_price"], "opening_price")?,
            decay_delay_s: int(&main["decay_delay_s"], "coins.main.decay_delay_s")?,
            decay_length_s: int(&main["decay_length_s"], "coins.main.decay_length_s")?,
        },
        total_supply: whole(&c["total_supply"], "total_supply")?,
    })
}

/// splitmix64: tiny, deterministic, no dependency.
struct Rng(u64);

impl Rng {
    fn next(&mut self) -> u64 {
        self.0 = self.0.wrapping_add(0x9E37_79B9_7F4A_7C15);
        let mut z = self.0;
        z = (z ^ (z >> 30)).wrapping_mul(0xBF58_476D_1CE4_E5B9);
        z = (z ^ (z >> 27)).wrapping_mul(0x94D0_49BB_1331_11EB);
        z ^ (z >> 31)
    }
}

enum Plan {
    Days(&'static [u64]),
    Random(Rng),
}

impl Plan {
    fn for_scenario(name: &str, seed: u64) -> Result<Plan, String> {
        Ok(match name {
            "busy" => Plan::Days(BUSY_DAYS),
            "quiet" => Plan::Days(QUIET_DAYS),
            "abandoned" => Plan::Days(ABANDONED_DAYS),
            "random" => Plan::Random(Rng(seed)),
            other => return Err(format!("unknown scenario {other:?}, expected one of {SCENARIOS:?}")),
        })
    }
}

#[derive(Clone, Copy)]
struct Seat {
    paid: u128,
    since_s: u64,
}

struct Takeover {
    at_s: u64,
    previous: Option<Seat>,
    quote: Quote,
}

#[derive(Clone, PartialEq, Eq, Debug)]
struct Row {
    day: u64,
    supply: u128,
    seat_price: u128,
    burned: u128,
    takeovers: usize,
    ceo_days: u64,
    event: &'static str,
}

struct Run {
    rows: Vec<Row>,
    takeovers: Vec<Takeover>,
}

struct Sim<'a> {
    launch: &'a Launch,
    seat: Option<Seat>,
    burned: u128,
    takeovers: Vec<Takeover>,
}

impl Sim<'_> {
    fn idle(&self, t: u64) -> u64 {
        self.seat.map_or(0, |s| t - s.since_s)
    }

    fn price_at(&self, t: u64) -> u128 {
        price::price(&self.launch.rules, self.seat.map(|s| s.paid), self.idle(t))
    }

    fn decaying_at(&self, t: u64) -> bool {
        self.seat.is_some() && self.idle(t) > self.launch.rules.decay_delay_s
    }

    fn take(&mut self, t: u64) {
        let quote = price::quote(&self.launch.rules, self.seat.map(|s| s.paid), self.idle(t));
        self.takeovers.push(Takeover { at_s: t, previous: self.seat, quote });
        self.burned += quote.burned;
        self.seat = Some(Seat { paid: quote.price, since_s: t });
    }
}

fn simulate(launch: &Launch, mut plan: Plan) -> Run {
    let mut sim = Sim { launch, seat: None, burned: 0, takeovers: Vec::new() };
    let mut rows = Vec::with_capacity(DAYS as usize + 1);
    let mut prev: Option<(u128, bool)> = None; // (price, decaying) at the end of the previous day

    for day in 0..=DAYS {
        let start = day * DAY;
        let end = start + DAY - 1;
        let before = sim.takeovers.len();

        match &mut plan {
            Plan::Days(days) => {
                if days.contains(&day) {
                    sim.take(start);
                }
            }
            Plan::Random(rng) => {
                // Every hour after launch: a 2% chance, if the seat costs under the cap.
                let first = if day == 0 { HOUR } else { start };
                for t in (first..start + DAY).step_by(HOUR as usize) {
                    let roll = rng.next() % 10_000;
                    if roll < RANDOM_CHANCE_BP && sim.price_at(t) < RANDOM_PRICE_CAP * ONE_CTO {
                        sim.take(t);
                    }
                }
            }
        }

        let seat_price = sim.price_at(end);
        let decaying = sim.decaying_at(end);
        let took = sim.takeovers.len() > before;
        let event = match prev {
            _ if took => "takeover",
            Some((p, _)) if sim.seat.is_some() && seat_price == launch.rules.floor && p > seat_price => "at_floor",
            Some((_, false)) if decaying => "decay_started",
            _ => "",
        };
        rows.push(Row {
            day,
            supply: launch.total_supply - sim.burned,
            seat_price,
            burned: sim.burned,
            takeovers: sim.takeovers.len(),
            ceo_days: sim.idle(end) / DAY,
            event,
        });
        prev = Some((seat_price, decaying));
    }
    Run { rows, takeovers: sim.takeovers }
}

fn csv(launch: &Launch, run: &Run) -> String {
    let total = launch.total_supply / ONE_CTO;
    let mut out = String::from("day,supply,seat_price,burned_total,takeovers_total,ceo_days,event\n");
    for r in &run.rows {
        let supply = r.supply / ONE_CTO;
        let _ = writeln!(
            out,
            "{},{},{},{},{},{},{}",
            r.day,
            supply,
            r.seat_price / ONE_CTO,
            total - supply,
            r.takeovers,
            r.ceo_days,
            r.event
        );
    }
    out
}

/// The spec 5 invariants, checked independently of how `simulate` got there.
fn check_invariants(launch: &Launch, run: &Run) -> Result<(), String> {
    let rules = &launch.rules;
    let total_whole = launch.total_supply / ONE_CTO;

    // Each takeover: price follows the rule from the previous seat, burn is
    // price - floor(price * 23/28), payout + burned == price.
    let mut burned = 0u128;
    for (i, tk) in run.takeovers.iter().enumerate() {
        let q = tk.quote;
        let expected_price = match tk.previous {
            None => rules.floor,
            Some(s) => price::price(rules, Some(s.paid), tk.at_s - s.since_s),
        };
        if q.price != expected_price {
            return Err(format!("takeover {i}: price {} != {}", q.price, expected_price));
        }
        if let Some(s) = tk.previous
            && tk.at_s - s.since_s <= rules.decay_delay_s
            && q.price != s.paid * 7 / 5
        {
            return Err(format!("takeover {i}: price decayed within the idle window"));
        }
        let expected_burn = match tk.previous {
            None => q.price,
            Some(_) => q.price - q.price * 23 / 28,
        };
        if q.burned != expected_burn || q.payout + q.burned != q.price {
            return Err(format!("takeover {i}: burn {} != price - floor(price*23/28) = {}", q.burned, expected_burn));
        }
        if q.price < rules.floor {
            return Err(format!("takeover {i}: price below the floor"));
        }
        burned += q.burned;
    }
    let last = run.rows.last().ok_or("no rows")?;
    if last.burned != burned || last.supply + burned != launch.total_supply {
        return Err("burned total does not equal the sum of burns".into());
    }

    let lines = csv(launch, run);
    let mut prev_supply = total_whole;
    for (r, line) in run.rows.iter().zip(lines.lines().skip(1)) {
        let cols: Vec<u128> = line.split(',').take(4).map(|c| c.parse().unwrap_or(u128::MAX)).collect();
        let (supply, seat_price, burned_total) = (cols[1], cols[2], cols[3]);
        if supply + burned_total != total_whole || r.supply + r.burned != launch.total_supply {
            return Err(format!("day {}: supply + burned_total != {total_whole}", r.day));
        }
        if supply > prev_supply {
            return Err(format!("day {}: supply rose", r.day));
        }
        if (supply < prev_supply) != (r.event == "takeover") {
            return Err(format!("day {}: supply changed without a takeover, or a takeover burned nothing", r.day));
        }
        if seat_price * ONE_CTO < rules.floor || r.seat_price < rules.floor {
            return Err(format!("day {}: seat price below the floor", r.day));
        }
        prev_supply = supply;
    }

    // Price never decays within D of a takeover, checked at every hour of the run.
    for (i, tk) in run.takeovers.iter().enumerate() {
        let next_at = run.takeovers.get(i + 1).map_or((DAYS + 1) * DAY, |n| n.at_s);
        let window_end = (tk.at_s + rules.decay_delay_s).min(next_at - 1);
        for t in (tk.at_s..=window_end).step_by(HOUR as usize).chain([window_end]) {
            let p = price::price(rules, Some(tk.quote.price), t - tk.at_s);
            if p != tk.quote.price * 7 / 5 {
                return Err(format!("takeover {i}: price moved {}s after it, inside the idle window", t - tk.at_s));
            }
        }
    }
    Ok(())
}

fn check_expected(name: &str, launch: &Launch, run: &Run) -> Result<(), String> {
    let Some(&(_, count, burned, tol)) = EXPECTED.iter().find(|e| e.0 == name) else {
        return Ok(());
    };
    if run.takeovers.len() != count {
        return Err(format!("{name}: {} takeovers, spec says {count}", run.takeovers.len()));
    }
    let got = run.rows.last().map_or(0, |r| r.burned) / ONE_CTO;
    let allowed = match tol {
        Tolerance::Permille(p) => burned * p / 1000,
        Tolerance::Whole(w) => w,
    };
    if got.abs_diff(burned) > allowed {
        return Err(format!("{name}: burned {got} by day {DAYS}, spec says ~{burned} (allowed drift {allowed})"));
    }
    if name == "abandoned" {
        let day22 = &run.rows[22];
        if day22.seat_price != launch.rules.floor || run.rows[21].seat_price == launch.rules.floor {
            return Err("abandoned: price should reach the floor on day 22".into());
        }
    }
    Ok(())
}

fn workspace_root() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR")).parent().expect("contract/ has a parent").to_path_buf()
}

fn check(seed: u64) -> Result<(), String> {
    let launch = launch()?;
    let dir = workspace_root().join("web/public/sim");
    let mut summary = BTreeMap::new();
    for name in SCENARIOS {
        let run = simulate(&launch, Plan::for_scenario(name, seed)?);
        check_invariants(&launch, &run).map_err(|e| format!("{name}: {e}"))?;
        check_expected(name, &launch, &run)?;
        let file = dir.join(format!("{name}.csv"));
        let on_disk = std::fs::read_to_string(&file)
            .map_err(|e| format!("{name}: cannot read {}: {e} (run with --out-dir web/public/sim)", file.display()))?;
        if on_disk != csv(&launch, &run) {
            return Err(format!("{name}: {} is stale, regenerate it with --out-dir web/public/sim", file.display()));
        }
        // Same whole-CTO figures as the CSV's last row.
        let supply = run.rows.last().expect("rows").supply / ONE_CTO * ONE_CTO;
        summary.insert(name, (run.takeovers.len(), launch.total_supply - supply, supply));
    }
    for name in SCENARIOS {
        let (n, burned, supply) = summary[name];
        println!(
            "  {name:<9} {n:>2} takeovers · burned {:>10} · supply on day {DAYS} {:>13}",
            price::whole_cto(burned),
            price::whole_cto(supply)
        );
    }
    println!("sim check: ok (4 scenarios, invariants hold, CSVs match price.rs)");
    Ok(())
}

fn write(path: &Path, body: &str) -> Result<(), String> {
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).map_err(|e| format!("{}: {e}", parent.display()))?;
    }
    std::fs::write(path, body).map_err(|e| format!("{}: {e}", path.display()))
}

fn generate(name: &str, seed: u64, out: Option<&Path>) -> Result<(), String> {
    let launch = launch()?;
    let run = simulate(&launch, Plan::for_scenario(name, seed)?);
    check_invariants(&launch, &run).map_err(|e| format!("{name}: {e}"))?;
    let body = csv(&launch, &run);
    match out {
        Some(path) => {
            write(path, &body)?;
            eprintln!("wrote {} ({} takeovers)", path.display(), run.takeovers.len());
        }
        None => print!("{body}"),
    }
    Ok(())
}

const USAGE: &str = "usage: sim [--scenario busy|quiet|abandoned|random] [--seed N] [--out FILE]
       sim --out-dir DIR     write all four CSVs
       sim --check           check all four scenarios and the committed CSVs";

fn main() -> ExitCode {
    let mut args = std::env::args().skip(1);
    let (mut scenario, mut seed, mut out, mut out_dir, mut check_mode) =
        (String::from("busy"), DEFAULT_SEED, None, None, false);
    while let Some(a) = args.next() {
        let mut value = |flag: &str| args.next().ok_or(format!("{flag} needs a value"));
        let parsed: Result<(), String> = match a.as_str() {
            "--scenario" => value("--scenario").map(|v| scenario = v),
            "--seed" => value("--seed").and_then(|v| v.parse().map(|n| seed = n).map_err(|e| format!("--seed: {e}"))),
            "--out" => value("--out").map(|v| out = Some(PathBuf::from(v))),
            "--out-dir" => value("--out-dir").map(|v| out_dir = Some(PathBuf::from(v))),
            "--check" => {
                check_mode = true;
                Ok(())
            }
            "-h" | "--help" => {
                println!("{USAGE}");
                return ExitCode::SUCCESS;
            }
            other => Err(format!("unknown argument {other:?}\n{USAGE}")),
        };
        if let Err(e) = parsed {
            eprintln!("{e}");
            return ExitCode::from(2);
        }
    }

    let result = if check_mode {
        check(seed)
    } else if let Some(dir) = out_dir {
        SCENARIOS.iter().try_for_each(|name| generate(name, seed, Some(&dir.join(format!("{name}.csv")))))
    } else {
        generate(&scenario, seed, out.as_deref())
    };
    match result {
        Ok(()) => ExitCode::SUCCESS,
        Err(e) => {
            eprintln!("sim: FAIL {e}");
            ExitCode::FAILURE
        }
    }
}
