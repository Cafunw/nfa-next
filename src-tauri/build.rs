fn main() {
    // requireAdministrator: Windows shows a UAC prompt on every launch
    let win = tauri_build::WindowsAttributes::new().app_manifest(include_str!("app.manifest"));
    tauri_build::try_build(tauri_build::Attributes::new().windows_attributes(win))
        .expect("failed to run tauri-build");
}
