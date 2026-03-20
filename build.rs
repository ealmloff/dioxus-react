use std::path::Path;

fn main() {
    // Copy assets next to the output binary so dioxus-asset-resolver's
    // get_asset_root() can find them at runtime.
    let out_dir = std::env::var("OUT_DIR").unwrap();
    let target_dir = Path::new(&out_dir)
        .ancestors()
        .nth(3)
        .expect("OUT_DIR should be nested under target/<profile>/build/<pkg>/out");

    let assets_src = Path::new("assets");
    if assets_src.exists() {
        copy_dir_recursive(assets_src, &target_dir.join("assets"));
    }

    println!("cargo:rerun-if-changed=assets");
}

fn copy_dir_recursive(src: &Path, dst: &Path) {
    std::fs::create_dir_all(dst).unwrap();
    for entry in std::fs::read_dir(src).unwrap() {
        let entry = entry.unwrap();
        let src_path = entry.path();
        let dst_path = dst.join(entry.file_name());
        if src_path.is_dir() {
            copy_dir_recursive(&src_path, &dst_path);
        } else {
            std::fs::copy(&src_path, &dst_path).unwrap();
        }
    }
}
