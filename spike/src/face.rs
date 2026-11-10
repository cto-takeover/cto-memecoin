//! Face SVGs, ported from reference/faces/faces.py.
//! Differences from faces.py, per spec 1: no inline `style`, `xmlns` added,
//! pattern ids use a fixed suffix (`kw`, `pr`).

const INK: &str = "#111111";
const BG_COLORS: [&str; 8] = ["#FFD60A", "#00EC97", "#7CC6FF", "#FF9EC7", "#FF8A3D", "", "", "#B9A6FF"];
pub const BG_NAMES: [&str; 8] = ["Highlighter", "NEAR green", "Sky", "Bubblegum", "Sunset", "Batik kawung", "Parang stripe", "Lilac"];
pub const EYE_NAMES: [&str; 8] = ["Dots", "Laser", "Shades", "Sleepy", "Wide", "Wink", "Knocked out", "Determined"];
pub const MOUTH_NAMES: [&str; 8] = ["Grin", "Flat", "Oh", "Smirk", "Tongue", "Teeth", "Frown", "Cat"];
pub const EXTRA_NAMES: [&str; 8] = ["None", "CEO tie", "Party hat", "Top hat", "Headband", "Monocle", "Sweat drop", "Peci"];

/// Face id (1..=4096) to parts [bg, eyes, mouth, extra].
pub fn parts_of(id: u16) -> Option<[u8; 4]> {
    if !(1..=4096).contains(&id) {
        return None;
    }
    let n = id - 1;
    Some([(n / 512) as u8, (n / 64 % 8) as u8, (n / 8 % 8) as u8, (n % 8) as u8])
}

#[cfg(test)]
pub fn id_of(p: [u8; 4]) -> u16 {
    p[0] as u16 * 512 + p[1] as u16 * 64 + p[2] as u16 * 8 + p[3] as u16 + 1
}

fn bg(i: u8) -> String {
    match i {
        5 => format!(
            r##"<defs><pattern id="kw" width="40" height="40" patternUnits="userSpaceOnUse"><rect width="40" height="40" fill="#F3D9A4"></rect><ellipse cx="20" cy="9" rx="6" ry="9" fill="none" stroke="{INK}" stroke-width="2"></ellipse><ellipse cx="20" cy="31" rx="6" ry="9" fill="none" stroke="{INK}" stroke-width="2"></ellipse><ellipse cx="9" cy="20" rx="9" ry="6" fill="none" stroke="{INK}" stroke-width="2"></ellipse><ellipse cx="31" cy="20" rx="9" ry="6" fill="none" stroke="{INK}" stroke-width="2"></ellipse><circle cx="20" cy="20" r="2.5" fill="{INK}"></circle></pattern></defs><rect x="4" y="4" width="192" height="192" rx="24" fill="url(#kw)" stroke="{INK}" stroke-width="6"></rect>"##
        ),
        6 => format!(
            r##"<defs><pattern id="pr" width="28" height="28" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><rect width="28" height="28" fill="#FF8A3D"></rect><rect width="12" height="28" fill="#FFF6E0"></rect><rect x="12" width="3" height="28" fill="{INK}"></rect></pattern></defs><rect x="4" y="4" width="192" height="192" rx="24" fill="url(#pr)" stroke="{INK}" stroke-width="6"></rect>"##
        ),
        _ => format!(
            r##"<rect x="4" y="4" width="192" height="192" rx="24" fill="{}" stroke="{INK}" stroke-width="6"></rect>"##,
            BG_COLORS[i as usize]
        ),
    }
}

fn eyes(i: u8) -> String {
    let s = format!(r##"stroke="{INK}" stroke-width="6" stroke-linecap="round" fill="none""##);
    match i {
        0 => format!(r##"<circle cx="78" cy="98" r="8" fill="{INK}"></circle><circle cx="122" cy="98" r="8" fill="{INK}"></circle>"##),
        1 => format!(r##"<path d="M78 98 L196 84" stroke="#D7141A" stroke-width="7"></path><path d="M122 98 L196 108" stroke="#D7141A" stroke-width="7"></path><circle cx="78" cy="98" r="10" fill="#D7141A" stroke="{INK}" stroke-width="4"></circle><circle cx="122" cy="98" r="10" fill="#D7141A" stroke="{INK}" stroke-width="4"></circle>"##),
        2 => format!(r##"<path d="M56 88 H144 V100 Q144 114 128 114 H114 Q104 114 104 102 H96 Q96 114 86 114 H72 Q56 114 56 100 Z" fill="{INK}"></path><path d="M66 94 H80" stroke="#FFFFFF" stroke-width="3"></path>"##),
        3 => format!(r##"<path d="M66 100 Q78 92 90 100" {s}></path><path d="M110 100 Q122 92 134 100" {s}></path>"##),
        4 => format!(r##"<circle cx="78" cy="96" r="15" fill="#FFFFFF" stroke="{INK}" stroke-width="5"></circle><circle cx="122" cy="96" r="15" fill="#FFFFFF" stroke="{INK}" stroke-width="5"></circle><circle cx="82" cy="98" r="6" fill="{INK}"></circle><circle cx="126" cy="98" r="6" fill="{INK}"></circle>"##),
        5 => format!(r##"<circle cx="78" cy="98" r="8" fill="{INK}"></circle><path d="M110 98 H134" {s}></path>"##),
        6 => format!(r##"<path d="M70 90 L86 106 M86 90 L70 106" {s}></path><path d="M114 90 L130 106 M130 90 L114 106" {s}></path>"##),
        _ => format!(r##"<path d="M64 82 L90 90" {s}></path><path d="M136 82 L110 90" {s}></path><circle cx="78" cy="100" r="7" fill="{INK}"></circle><circle cx="122" cy="100" r="7" fill="{INK}"></circle>"##),
    }
}

fn mouth(i: u8) -> String {
    let s = format!(r##"stroke="{INK}" stroke-width="6" stroke-linecap="round" fill="none""##);
    match i {
        0 => format!(r##"<path d="M72 128 Q100 156 128 128" {s}></path>"##),
        1 => format!(r##"<path d="M78 136 H122" {s}></path>"##),
        2 => format!(r##"<ellipse cx="100" cy="138" rx="10" ry="13" fill="{INK}"></ellipse>"##),
        3 => format!(r##"<path d="M80 138 Q106 146 124 126" {s}></path>"##),
        4 => format!(r##"<path d="M74 128 Q100 152 126 128 Z" fill="{INK}"></path><path d="M92 138 Q100 160 110 138" fill="#FF6B8B" stroke="{INK}" stroke-width="4"></path>"##),
        5 => format!(r##"<rect x="74" y="124" width="52" height="22" rx="8" fill="#FFFFFF" stroke="{INK}" stroke-width="5"></rect><path d="M87 124 V146 M100 124 V146 M113 124 V146" stroke="{INK}" stroke-width="3"></path>"##),
        6 => format!(r##"<path d="M76 144 Q100 122 124 144" {s}></path>"##),
        _ => format!(r##"<path d="M80 132 Q90 144 100 132 Q110 144 120 132" {s}></path>"##),
    }
}

fn extra(i: u8) -> String {
    match i {
        1 => format!(r##"<path d="M92 172 L108 172 L114 196 L100 200 L86 196 Z" fill="#D7141A" stroke="{INK}" stroke-width="4"></path><path d="M90 164 H110 L106 174 H94 Z" fill="#D7141A" stroke="{INK}" stroke-width="4"></path>"##),
        2 => format!(r##"<path d="M100 8 L124 52 H76 Z" fill="#FFD60A" stroke="{INK}" stroke-width="5"></path><circle cx="100" cy="10" r="7" fill="#D7141A" stroke="{INK}" stroke-width="4"></circle><path d="M86 40 L94 30 M106 40 L114 30" stroke="#D7141A" stroke-width="4"></path>"##),
        3 => format!(r##"<rect x="70" y="12" width="60" height="38" rx="4" fill="{INK}"></rect><rect x="54" y="46" width="92" height="10" rx="4" fill="{INK}"></rect><rect x="70" y="36" width="60" height="7" fill="#D7141A"></rect>"##),
        4 => r##"<path d="M34 76 Q100 52 166 76" stroke="#D7141A" stroke-width="12" fill="none"></path><path d="M164 72 L186 62 M164 76 L186 86" stroke="#D7141A" stroke-width="6" stroke-linecap="round"></path>"##.to_string(),
        5 => r##"<circle cx="122" cy="96" r="20" fill="none" stroke="#C9A227" stroke-width="5"></circle><path d="M140 106 Q150 140 142 170" stroke="#C9A227" stroke-width="3" fill="none"></path>"##.to_string(),
        6 => format!(r##"<path d="M150 62 Q160 78 150 86 Q140 78 150 62 Z" fill="#7CC6FF" stroke="{INK}" stroke-width="4"></path>"##),
        7 => format!(r##"<path d="M58 54 Q60 24 100 24 Q140 24 142 54 Z" fill="{INK}"></path><path d="M64 46 H136" stroke="#3A3A3A" stroke-width="3"></path>"##),
        _ => String::new(),
    }
}

/// Full SVG for parts [bg, eyes, mouth, extra], each 0..=7.
pub fn svg(p: [u8; 4]) -> String {
    let [b, e, m, x] = p;
    let label = format!(
        "Coin face: {}, {} eyes, {} mouth, {}",
        BG_NAMES[b as usize], EYE_NAMES[e as usize], MOUTH_NAMES[m as usize], EXTRA_NAMES[x as usize]
    );
    let head = format!(r##"<circle cx="100" cy="108" r="66" fill="#FFF6E0" stroke="{INK}" stroke-width="6"></circle>"##);
    format!(
        r##"<svg viewBox="0 0 200 200" width="200" height="200" role="img" aria-label="{label}" xmlns="http://www.w3.org/2000/svg">{}{head}{}{}{}</svg>"##,
        bg(b),
        mouth(m),
        eyes(e),
        extra(x)
    )
}

pub fn icon_data_uri(p: [u8; 4]) -> String {
    use near_sdk::base64::{Engine, engine::general_purpose::STANDARD};
    format!("data:image/svg+xml;base64,{}", STANDARD.encode(svg(p)))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn sample(name: &str, suffix: &str) -> String {
        let path = format!("{}/../reference/faces/{name}", env!("CARGO_MANIFEST_DIR"));
        let s = std::fs::read_to_string(path).unwrap();
        let s = s.trim_end().to_string();
        if suffix.is_empty() { s } else { s.replace(&format!("kw{suffix}"), "kw").replace(&format!("pr{suffix}"), "pr") }
    }

    #[test]
    fn ids_round_trip() {
        for id in 1..=4096u16 {
            assert_eq!(id_of(parts_of(id).unwrap()), id);
        }
        assert_eq!(parts_of(0), None);
        assert_eq!(parts_of(4097), None);
        assert_eq!(id_of([0, 0, 1, 0]), 9);
        assert_eq!(id_of([5, 1, 0, 1]), 2626);
        assert_eq!(id_of([1, 2, 3, 7]), 672);
    }

    #[test]
    fn matches_reference_samples() {
        assert_eq!(svg([0, 0, 1, 0]), sample("launch-9.svg", ""));
        assert_eq!(svg([5, 1, 0, 1]), sample("ani-2626.svg", "ani"));
        assert_eq!(svg([1, 2, 3, 7]), sample("budi-672.svg", "budi"));
    }

    #[test]
    fn largest_face_size() {
        let max = (1..=4096u16).map(|id| svg(parts_of(id).unwrap()).len()).max().unwrap();
        assert!(max <= 1800, "largest face {max} bytes");
    }
}

#[cfg(test)]
mod all_faces {
    /// Compares every face with faces.py output. Run with
    /// FACES_TXT=<file, one svg per line in id order> cargo test -- --ignored
    #[test]
    #[ignore]
    fn matches_faces_py() {
        let path = std::env::var("FACES_TXT").expect("set FACES_TXT");
        let text = std::fs::read_to_string(path).unwrap();
        for (i, line) in text.lines().enumerate() {
            let id = i as u16 + 1;
            assert_eq!(super::svg(super::parts_of(id).unwrap()), line, "face {id}");
        }
        assert_eq!(text.lines().count(), 4096);
    }
}
