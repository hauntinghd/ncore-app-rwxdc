use keyring::Entry;
use std::env;

const SERVICE: &str = "com.nyptid.ncore.release";
const ACCOUNT: &str = "tauri-updater-signing-password";

fn main() {
    let action = env::args().nth(1).unwrap_or_default();
    let entry = Entry::new(SERVICE, ACCOUNT).expect("Windows Credential Manager unavailable");

    match action.as_str() {
        "generate" => {
            let mut bytes = [0_u8; 32];
            getrandom::fill(&mut bytes).expect("Could not generate signing password");
            let password = bytes.iter().map(|byte| format!("{byte:02x}")).collect::<String>();
            entry.set_password(&password).expect("Could not store signing password");
            print!("{password}");
        }
        "get" => {
            let password = entry.get_password().expect("Signing password is unavailable");
            print!("{password}");
        }
        _ => panic!("usage: release_secret <generate|get>"),
    }
}
