#[cfg(target_os = "macos")]
use ember_platform_services::MacOsPlatformPaths;
#[cfg(target_os = "windows")]
use ember_platform_services::WindowsPlatformPaths;
use ember_platform_services::{PlatformPathRoots, PlatformPaths};
use tauri::{App, Manager};

pub(crate) fn database_path(app: &App) -> tauri::Result<std::path::PathBuf> {
    let resolver = app.path();
    let roots = PlatformPathRoots::new(
        resolver.app_data_dir()?,
        resolver.app_cache_dir()?,
        resolver.app_log_dir()?,
        resolver.temp_dir()?,
    )
    .map_err(|error| tauri::Error::Anyhow(error.into()))?;

    let paths = current_platform_adapter(roots);
    Ok(paths.data_dir().join("ember-tavern.sqlite"))
}

pub(crate) fn instance_lock_path(database_path: &std::path::Path) -> std::path::PathBuf {
    let mut path = database_path.as_os_str().to_os_string();
    path.push(".instance.lock");
    path.into()
}

#[cfg(target_os = "windows")]
fn current_platform_adapter(roots: PlatformPathRoots) -> Box<dyn PlatformPaths> {
    Box::new(WindowsPlatformPaths::from_platform_roots(roots))
}

#[cfg(target_os = "macos")]
fn current_platform_adapter(roots: PlatformPathRoots) -> Box<dyn PlatformPaths> {
    Box::new(MacOsPlatformPaths::from_platform_roots(roots))
}

#[cfg(not(any(target_os = "windows", target_os = "macos")))]
fn current_platform_adapter(_roots: PlatformPathRoots) -> Box<dyn PlatformPaths> {
    compile_error!("Ember Tavern desktop currently supports Windows and macOS only");
}
