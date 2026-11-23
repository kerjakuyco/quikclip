fn main() {
    println!(
        "cargo:rustc-env=QUIKCLIP_TARGET={}",
        std::env::var("TARGET").unwrap()
    );
    tauri_build::build()
}
