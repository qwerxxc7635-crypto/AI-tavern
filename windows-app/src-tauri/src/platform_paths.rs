#[cfg(all(not(feature = "e2e-data-root"), target_os = "macos"))]
use ember_platform_services::MacOsPlatformPaths;
#[cfg(all(not(feature = "e2e-data-root"), target_os = "windows"))]
use ember_platform_services::WindowsPlatformPaths;
#[cfg(not(feature = "e2e-data-root"))]
use ember_platform_services::{PlatformPathRoots, PlatformPaths};
use tauri::App;
#[cfg(not(feature = "e2e-data-root"))]
use tauri::Manager;

pub(crate) fn database_path(_app: &App) -> tauri::Result<std::path::PathBuf> {
    #[cfg(feature = "e2e-data-root")]
    {
        let configured = option_env!("EMBER_TAVERN_E2E_DATA_DIR").ok_or_else(|| {
            std::io::Error::new(
                std::io::ErrorKind::InvalidInput,
                "the E2E data root must be configured at compile time",
            )
        })?;
        let root = std::path::PathBuf::from(configured);
        if !root.is_absolute() {
            return Err(std::io::Error::new(
                std::io::ErrorKind::InvalidInput,
                "the E2E data root must be absolute",
            )
            .into());
        }
        Ok(root.join("ember-tavern.sqlite"))
    }

    #[cfg(not(feature = "e2e-data-root"))]
    {
        let resolver = _app.path();
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
}

pub(crate) fn instance_lock_path(database_path: &std::path::Path) -> std::path::PathBuf {
    let mut path = database_path.as_os_str().to_os_string();
    path.push(".instance.lock");
    path.into()
}

#[cfg(all(not(feature = "e2e-data-root"), target_os = "windows"))]
fn current_platform_adapter(roots: PlatformPathRoots) -> Box<dyn PlatformPaths> {
    Box::new(WindowsPlatformPaths::from_platform_roots(roots))
}

#[cfg(all(not(feature = "e2e-data-root"), target_os = "macos"))]
fn current_platform_adapter(roots: PlatformPathRoots) -> Box<dyn PlatformPaths> {
    Box::new(MacOsPlatformPaths::from_platform_roots(roots))
}

#[cfg(all(
    not(feature = "e2e-data-root"),
    not(any(target_os = "windows", target_os = "macos"))
))]
fn current_platform_adapter(_roots: PlatformPathRoots) -> Box<dyn PlatformPaths> {
    compile_error!("Ember Tavern desktop currently supports Windows and macOS only");
}
