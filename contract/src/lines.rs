//! The 24 fixed announcement lines (spec 1), from `reference/announcement-lines.json`.
//! There is no free text anywhere in the contract: the CEO picks a line number, and
//! the slots are filled from chain state.

pub const LINES: [&str; 24] = [
    "gm. New management is in.",
    "The face is mine until someone pays {next_price} CTO.",
    "Next takeover costs {next_price} CTO.",
    "Wait, I'm still the CEO!",
    "Fired, but paid. See you at the next takeover.",
    "No admin keys. Read the contract.",
    "{burned} CTO burned so far. Supply only goes down.",
    "Board meeting cancelled. The CEO is busy being the face.",
    "Press release: the coin has a new look.",
    "Hostile takeovers welcome. Bring {next_price} CTO.",
    "The previous CEO has left the building. With a bonus.",
    "Quarterly results: more burned, fewer coins.",
    "This is the coin speaking. Signed, {ceo}.",
    "Rumours of my firing are premature.",
    "Juragan baru! New boss in town.",
    "Lengser keprabon: I step down when you pay.",
    "Strategy update: keep the face, keep the seat.",
    "Dear holders: the seat is open to anyone.",
    "Breaking: the CEO approves this message.",
    "The price starts dropping after 7 quiet days.",
    "Thank you to the last CEO for their service.",
    "Read the receipts before you take the seat.",
    "Corporate memo: smile, you are on chain.",
    "There can only be one CEO.",
];

/// Slot values, already formatted (whole CTO with commas; account id).
pub struct Slots<'a> {
    pub next_price: &'a str,
    pub burned: &'a str,
    pub ceo: &'a str,
}

/// The line's text with `{next_price}`, `{burned}` and `{ceo}` filled. `None` if `line` > 23.
pub fn render(line: u8, slots: &Slots) -> Option<String> {
    let template = LINES.get(line as usize)?;
    Some(
        template
            .replace("{next_price}", slots.next_price)
            .replace("{burned}", slots.burned)
            .replace("{ceo}", slots.ceo),
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    const SLOTS: Slots = Slots { next_price: "1,400,000", burned: "1,250,000", ceo: "ani-cto.testnet" };

    #[test]
    fn same_lines_as_reference() {
        let path = concat!(env!("CARGO_MANIFEST_DIR"), "/../reference/announcement-lines.json");
        let json: near_sdk::serde_json::Value =
            near_sdk::serde_json::from_str(&std::fs::read_to_string(path).unwrap()).unwrap();
        let reference: Vec<&str> = json["lines"].as_array().unwrap().iter().map(|l| l.as_str().unwrap()).collect();
        assert_eq!(reference, LINES.to_vec());
    }

    #[test]
    fn every_line_renders_without_leftover_slots() {
        for line in 0..24u8 {
            let text = render(line, &SLOTS).unwrap();
            assert!(!text.contains('{') && !text.contains('}'), "line {line}: {text}");
        }
    }

    #[test]
    fn slots_are_filled() {
        assert_eq!(render(1, &SLOTS).unwrap(), "The face is mine until someone pays 1,400,000 CTO.");
        assert_eq!(render(6, &SLOTS).unwrap(), "1,250,000 CTO burned so far. Supply only goes down.");
        assert_eq!(render(9, &SLOTS).unwrap(), "Hostile takeovers welcome. Bring 1,400,000 CTO.");
        assert_eq!(render(12, &SLOTS).unwrap(), "This is the coin speaking. Signed, ani-cto.testnet.");
        assert_eq!(render(0, &SLOTS).unwrap(), "gm. New management is in.");
    }

    #[test]
    fn unknown_line() {
        assert_eq!(render(24, &SLOTS), None);
        assert_eq!(render(255, &SLOTS), None);
    }
}
