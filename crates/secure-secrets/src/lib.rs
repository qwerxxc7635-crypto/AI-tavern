//! Opaque model credentials backed by the operating-system secure store.
//!
//! The only serializable value is [`CredentialRef`]. Secret bytes can be used by
//! trusted Rust provider code through [`SecretStore::with_secret`], but are never
//! returned through a platform command.

use std::{fmt, str::FromStr};

use uuid::Uuid;
use zeroize::{Zeroize, Zeroizing};

const SERVICE_NAME: &str = "com.embertavern.model-provider";
const REFERENCE_PREFIX: &str = "credential:v1:";
const MAX_SECRET_BYTES: usize = 2_048;

#[derive(Clone, PartialEq, Eq, Hash)]
pub struct CredentialRef(String);

impl CredentialRef {
    pub fn generate() -> Self {
        Self(format!("{REFERENCE_PREFIX}{}", Uuid::new_v4()))
    }

    pub fn expose_reference(&self) -> &str {
        &self.0
    }
}

impl FromStr for CredentialRef {
    type Err = SecretStoreError;

    fn from_str(value: &str) -> Result<Self, Self::Err> {
        let Some(uuid) = value.strip_prefix(REFERENCE_PREFIX) else {
            return Err(SecretStoreError::InvalidReference);
        };
        Uuid::parse_str(uuid).map_err(|_| SecretStoreError::InvalidReference)?;
        Ok(Self(value.to_owned()))
    }
}

impl fmt::Debug for CredentialRef {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str("CredentialRef(<opaque>)")
    }
}

impl fmt::Display for CredentialRef {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str(&self.0)
    }
}

#[derive(Clone, Copy, Debug, Default)]
pub struct SecretStore;

impl SecretStore {
    pub fn save(&self, secret: String) -> Result<CredentialRef, SecretStoreError> {
        let secret = Zeroizing::new(secret);
        self.save_inner(secret.as_bytes())
    }

    fn save_inner(&self, secret: &[u8]) -> Result<CredentialRef, SecretStoreError> {
        if secret.is_empty() || secret.len() > MAX_SECRET_BYTES || secret.contains(&0) {
            return Err(SecretStoreError::InvalidSecret);
        }
        let reference = CredentialRef::generate();
        platform::set(&reference, secret)?;
        Ok(reference)
    }

    pub fn exists(&self, reference: &CredentialRef) -> Result<bool, SecretStoreError> {
        match platform::get(reference) {
            Ok(mut secret) => {
                secret.zeroize();
                Ok(true)
            }
            Err(SecretStoreError::NotFound) => Ok(false),
            Err(error) => Err(error),
        }
    }

    pub fn delete(&self, reference: &CredentialRef) -> Result<(), SecretStoreError> {
        match platform::delete(reference) {
            Ok(()) | Err(SecretStoreError::NotFound) => Ok(()),
            Err(error) => Err(error),
        }
    }

    pub fn with_secret<T>(
        &self,
        reference: &CredentialRef,
        use_secret: impl FnOnce(&[u8]) -> T,
    ) -> Result<T, SecretStoreError> {
        let secret = Zeroizing::new(platform::get(reference)?);
        Ok(use_secret(secret.as_slice()))
    }

    pub fn health_check(&self) -> Result<(), SecretStoreError> {
        platform::health_check()
    }
}

pub trait SecureVault {
    fn save(&self, secret: String) -> Result<CredentialRef, SecretStoreError>;
    fn exists(&self, reference: &CredentialRef) -> Result<bool, SecretStoreError>;
    fn delete(&self, reference: &CredentialRef) -> Result<(), SecretStoreError>;
    fn health_check(&self) -> Result<(), SecretStoreError>;
}

impl SecureVault for SecretStore {
    fn save(&self, secret: String) -> Result<CredentialRef, SecretStoreError> {
        SecretStore::save(self, secret)
    }

    fn exists(&self, reference: &CredentialRef) -> Result<bool, SecretStoreError> {
        SecretStore::exists(self, reference)
    }

    fn delete(&self, reference: &CredentialRef) -> Result<(), SecretStoreError> {
        SecretStore::delete(self, reference)
    }

    fn health_check(&self) -> Result<(), SecretStoreError> {
        SecretStore::health_check(self)
    }
}

#[cfg(target_os = "windows")]
mod platform {
    use std::{collections::HashMap, sync::OnceLock};

    use keyring_core::{Entry, Error as KeyringError};

    use super::{CredentialRef, SERVICE_NAME, SecretStoreError};

    static INITIALIZED: OnceLock<Result<(), SecretStoreError>> = OnceLock::new();

    pub fn set(reference: &CredentialRef, secret: &[u8]) -> Result<(), SecretStoreError> {
        entry(reference)?.set_secret(secret).map_err(map_error)
    }

    pub fn get(reference: &CredentialRef) -> Result<Vec<u8>, SecretStoreError> {
        entry(reference)?.get_secret().map_err(map_error)
    }

    pub fn delete(reference: &CredentialRef) -> Result<(), SecretStoreError> {
        entry(reference)?.delete_credential().map_err(map_error)
    }

    pub fn health_check() -> Result<(), SecretStoreError> {
        initialize()
    }

    fn entry(reference: &CredentialRef) -> Result<Entry, SecretStoreError> {
        initialize()?;
        let modifiers = HashMap::from([("persistence", "Local")]);
        Entry::new_with_modifiers(SERVICE_NAME, reference.expose_reference(), &modifiers)
            .map_err(map_error)
    }

    fn initialize() -> Result<(), SecretStoreError> {
        *INITIALIZED.get_or_init(|| {
            let store = windows_native_keyring_store::Store::new().map_err(map_error)?;
            keyring_core::set_default_store(store);
            Ok(())
        })
    }

    fn map_error(error: KeyringError) -> SecretStoreError {
        match error {
            KeyringError::NoEntry => SecretStoreError::NotFound,
            KeyringError::NoDefaultStore
            | KeyringError::NoStorageAccess(_)
            | KeyringError::PlatformFailure(_) => SecretStoreError::Unavailable,
            _ => SecretStoreError::OperationFailed,
        }
    }
}

#[cfg(target_os = "macos")]
mod platform {
    use std::sync::OnceLock;

    use keyring_core::{Entry, Error as KeyringError};

    use super::{CredentialRef, SERVICE_NAME, SecretStoreError};

    static INITIALIZED: OnceLock<Result<(), SecretStoreError>> = OnceLock::new();

    pub fn set(reference: &CredentialRef, secret: &[u8]) -> Result<(), SecretStoreError> {
        entry(reference)?.set_secret(secret).map_err(map_error)
    }

    pub fn get(reference: &CredentialRef) -> Result<Vec<u8>, SecretStoreError> {
        entry(reference)?.get_secret().map_err(map_error)
    }

    pub fn delete(reference: &CredentialRef) -> Result<(), SecretStoreError> {
        entry(reference)?.delete_credential().map_err(map_error)
    }

    pub fn health_check() -> Result<(), SecretStoreError> {
        initialize()
    }

    fn entry(reference: &CredentialRef) -> Result<Entry, SecretStoreError> {
        initialize()?;
        Entry::new(SERVICE_NAME, reference.expose_reference()).map_err(map_error)
    }

    fn initialize() -> Result<(), SecretStoreError> {
        *INITIALIZED.get_or_init(|| {
            let store = apple_native_keyring_store::keychain::Store::new().map_err(map_error)?;
            keyring_core::set_default_store(store);
            Ok(())
        })
    }

    fn map_error(error: KeyringError) -> SecretStoreError {
        match error {
            KeyringError::NoEntry => SecretStoreError::NotFound,
            KeyringError::NoDefaultStore
            | KeyringError::NoStorageAccess(_)
            | KeyringError::PlatformFailure(_) => SecretStoreError::Unavailable,
            _ => SecretStoreError::OperationFailed,
        }
    }
}

#[cfg(not(any(target_os = "windows", target_os = "macos")))]
mod platform {
    use super::{CredentialRef, SecretStoreError};

    pub fn set(_: &CredentialRef, _: &[u8]) -> Result<(), SecretStoreError> {
        Err(SecretStoreError::Unavailable)
    }

    pub fn get(_: &CredentialRef) -> Result<Vec<u8>, SecretStoreError> {
        Err(SecretStoreError::Unavailable)
    }

    pub fn delete(_: &CredentialRef) -> Result<(), SecretStoreError> {
        Err(SecretStoreError::Unavailable)
    }

    pub fn health_check() -> Result<(), SecretStoreError> {
        Err(SecretStoreError::Unavailable)
    }
}

#[derive(Clone, Copy, Debug, thiserror::Error, PartialEq, Eq)]
pub enum SecretStoreError {
    #[error("credential reference is invalid")]
    InvalidReference,
    #[error("credential value is invalid")]
    InvalidSecret,
    #[error("credential was not found")]
    NotFound,
    #[error("secure credential store is unavailable")]
    Unavailable,
    #[error("secure credential operation failed")]
    OperationFailed,
}

#[cfg(test)]
mod tests {
    use super::*;

    struct Cleanup {
        store: SecretStore,
        reference: CredentialRef,
    }

    impl Drop for Cleanup {
        fn drop(&mut self) {
            let _ = self.store.delete(&self.reference);
        }
    }

    #[test]
    fn reference_parser_rejects_untrusted_values() {
        assert_eq!(
            "other:v1:00000000-0000-0000-0000-000000000000".parse::<CredentialRef>(),
            Err(SecretStoreError::InvalidReference)
        );
        assert_eq!(
            format!("{:?}", CredentialRef::generate()),
            "CredentialRef(<opaque>)"
        );
    }

    #[test]
    fn rejects_empty_oversized_and_null_containing_values() {
        let store = SecretStore;
        assert_eq!(
            store.save(String::new()),
            Err(SecretStoreError::InvalidSecret)
        );
        assert_eq!(
            store.save("x".repeat(MAX_SECRET_BYTES + 1)),
            Err(SecretStoreError::InvalidSecret)
        );
        assert_eq!(
            store.save(String::from("before\0after")),
            Err(SecretStoreError::InvalidSecret)
        );
    }

    #[test]
    fn operating_system_store_round_trip_and_idempotent_delete() {
        let store = SecretStore;
        store.health_check().unwrap();
        let runtime_secret = format!("runtime-{}", Uuid::new_v4());
        let expected = Zeroizing::new(runtime_secret.as_bytes().to_vec());
        let reference = store.save(runtime_secret).unwrap();
        let cleanup = Cleanup {
            store,
            reference: reference.clone(),
        };

        assert!(store.exists(&reference).unwrap());
        let matches = store
            .with_secret(&reference, |stored| stored == expected.as_slice())
            .unwrap();
        assert!(matches);
        store.delete(&reference).unwrap();
        assert!(!store.exists(&reference).unwrap());
        store.delete(&reference).unwrap();

        drop(cleanup);
    }
}
