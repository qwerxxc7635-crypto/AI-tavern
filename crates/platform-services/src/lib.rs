//! Cross-platform ports and adapters for desktop-owned filesystem locations.

#![forbid(unsafe_code)]

use std::path::{Path, PathBuf};

/// Platform-owned locations consumed by composition roots and persistence adapters.
///
/// Callers may read these paths but must not infer another platform's directory layout.
pub trait PlatformPaths: Send + Sync {
    fn data_dir(&self) -> &Path;
    fn cache_dir(&self) -> &Path;
    fn log_dir(&self) -> &Path;
    fn temp_dir(&self) -> &Path;
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct PlatformPathRoots {
    data_dir: PathBuf,
    cache_dir: PathBuf,
    log_dir: PathBuf,
    temp_dir: PathBuf,
}

impl PlatformPathRoots {
    pub fn new(
        data_dir: impl Into<PathBuf>,
        cache_dir: impl Into<PathBuf>,
        log_dir: impl Into<PathBuf>,
        temp_dir: impl Into<PathBuf>,
    ) -> Result<Self, PlatformPathError> {
        let roots = Self {
            data_dir: data_dir.into(),
            cache_dir: cache_dir.into(),
            log_dir: log_dir.into(),
            temp_dir: temp_dir.into(),
        };
        roots.validate()?;
        Ok(roots)
    }

    fn validate(&self) -> Result<(), PlatformPathError> {
        for (kind, path) in [
            (PlatformPathKind::Data, &self.data_dir),
            (PlatformPathKind::Cache, &self.cache_dir),
            (PlatformPathKind::Log, &self.log_dir),
            (PlatformPathKind::Temp, &self.temp_dir),
        ] {
            if path.as_os_str().is_empty() {
                return Err(PlatformPathError::Empty(kind));
            }
            if !path.is_absolute() {
                return Err(PlatformPathError::NotAbsolute(kind));
            }
        }
        Ok(())
    }
}

impl PlatformPaths for PlatformPathRoots {
    fn data_dir(&self) -> &Path {
        &self.data_dir
    }

    fn cache_dir(&self) -> &Path {
        &self.cache_dir
    }

    fn log_dir(&self) -> &Path {
        &self.log_dir
    }

    fn temp_dir(&self) -> &Path {
        &self.temp_dir
    }
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct WindowsPlatformPaths(PlatformPathRoots);

impl WindowsPlatformPaths {
    pub fn from_platform_roots(roots: PlatformPathRoots) -> Self {
        Self(roots)
    }
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct MacOsPlatformPaths(PlatformPathRoots);

impl MacOsPlatformPaths {
    pub fn from_platform_roots(roots: PlatformPathRoots) -> Self {
        Self(roots)
    }
}

macro_rules! delegate_platform_paths {
    ($adapter:ty) => {
        impl PlatformPaths for $adapter {
            fn data_dir(&self) -> &Path {
                self.0.data_dir()
            }

            fn cache_dir(&self) -> &Path {
                self.0.cache_dir()
            }

            fn log_dir(&self) -> &Path {
                self.0.log_dir()
            }

            fn temp_dir(&self) -> &Path {
                self.0.temp_dir()
            }
        }
    };
}

delegate_platform_paths!(WindowsPlatformPaths);
delegate_platform_paths!(MacOsPlatformPaths);

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum PlatformPathKind {
    Data,
    Cache,
    Log,
    Temp,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum PlatformPathError {
    Empty(PlatformPathKind),
    NotAbsolute(PlatformPathKind),
}

impl std::fmt::Display for PlatformPathError {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::Empty(kind) => write!(formatter, "{kind:?} directory is empty"),
            Self::NotAbsolute(kind) => write!(formatter, "{kind:?} directory is not absolute"),
        }
    }
}

impl std::error::Error for PlatformPathError {}

#[cfg(test)]
mod tests {
    use super::*;

    fn isolated_roots() -> (tempfile::TempDir, PlatformPathRoots) {
        let directory = tempfile::tempdir().expect("isolated directory should be available");
        let roots = PlatformPathRoots::new(
            directory.path().join("data"),
            directory.path().join("cache"),
            directory.path().join("logs"),
            directory.path().join("temp"),
        )
        .expect("isolated roots should be valid");
        (directory, roots)
    }

    fn assert_contract(paths: &dyn PlatformPaths, root: &Path) {
        assert_eq!(paths.data_dir(), root.join("data"));
        assert_eq!(paths.cache_dir(), root.join("cache"));
        assert_eq!(paths.log_dir(), root.join("logs"));
        assert_eq!(paths.temp_dir(), root.join("temp"));
        assert!(paths.data_dir().is_absolute());
    }

    #[test]
    fn windows_adapter_obeys_platform_paths_contract() {
        let (directory, roots) = isolated_roots();
        let paths = WindowsPlatformPaths::from_platform_roots(roots);
        assert_contract(&paths, directory.path());
    }

    #[test]
    fn macos_adapter_obeys_platform_paths_contract() {
        let (directory, roots) = isolated_roots();
        let paths = MacOsPlatformPaths::from_platform_roots(roots);
        assert_contract(&paths, directory.path());
    }

    #[test]
    fn relative_roots_are_rejected() {
        let error = PlatformPathRoots::new("data", "/cache", "/logs", "/temp")
            .expect_err("relative roots must be rejected");
        assert_eq!(
            error,
            PlatformPathError::NotAbsolute(PlatformPathKind::Data)
        );
    }
}
