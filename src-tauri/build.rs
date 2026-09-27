fn main() {
    // Cargo does not track the icon, so regenerating it (`tauri icon`) leaves the old one
    // embedded in the exe until something else forces a relink. Declaring it here means a
    // new icon is picked up on the next build instead of needing `cargo clean -p`.
    println!("cargo:rerun-if-changed=icons/icon.ico");
    // Baked into the binary via `option_env!` in discord_rpc.rs; rebuild when it changes.
    println!("cargo:rerun-if-env-changed=YTM_OFFLINE_DISCORD_CLIENT_ID");

    tauri_build::build()
}
