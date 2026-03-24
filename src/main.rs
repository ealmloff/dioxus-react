mod native_bridge;

use wry_driver::run_wry_app;

fn main() {
    if let Err(error) = run_wry_app() {
        eprintln!("app startup failed: {error}");
        std::process::exit(1);
    }
}
