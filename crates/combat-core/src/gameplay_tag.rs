use std::{collections::BTreeMap, error::Error, fmt, str::FromStr};

use serde::{Deserialize, Deserializer, Serialize};

const MAX_TAG_ID_LENGTH: usize = 128;

#[derive(Debug, Clone, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize)]
#[serde(transparent)]
pub struct GameplayTagId(String);

impl GameplayTagId {
    pub fn new(value: impl Into<String>) -> Result<Self, GameplayTagCatalogError> {
        let value = value.into();
        validate_tag_id(&value)?;
        Ok(Self(value))
    }

    #[must_use]
    pub fn as_str(&self) -> &str {
        &self.0
    }

    #[must_use]
    pub fn namespace_str(&self) -> &str {
        self.0
            .split_once('.')
            .expect("validated gameplay tags always contain a namespace")
            .0
    }
}

impl fmt::Display for GameplayTagId {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str(&self.0)
    }
}

impl FromStr for GameplayTagId {
    type Err = GameplayTagCatalogError;

    fn from_str(value: &str) -> Result<Self, Self::Err> {
        Self::new(value)
    }
}

impl<'de> Deserialize<'de> for GameplayTagId {
    fn deserialize<D>(deserializer: D) -> Result<Self, D::Error>
    where
        D: Deserializer<'de>,
    {
        let value = String::deserialize(deserializer)?;
        Self::new(value).map_err(serde::de::Error::custom)
    }
}

#[derive(Debug, Clone, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize)]
#[serde(transparent)]
pub struct GameplayTagNamespace(String);

impl GameplayTagNamespace {
    pub fn new(value: impl Into<String>) -> Result<Self, GameplayTagCatalogError> {
        let value = value.into();
        validate_segment(&value, GameplayTagCatalogErrorCode::InvalidNamespace)?;
        Ok(Self(value))
    }

    #[must_use]
    pub fn as_str(&self) -> &str {
        &self.0
    }
}

impl<'de> Deserialize<'de> for GameplayTagNamespace {
    fn deserialize<D>(deserializer: D) -> Result<Self, D::Error>
    where
        D: Deserializer<'de>,
    {
        let value = String::deserialize(deserializer)?;
        Self::new(value).map_err(serde::de::Error::custom)
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct StaticGameplayTagDefinition {
    pub tag_id: &'static str,
    pub namespace: &'static str,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct GameplayTagDefinition {
    pub tag_id: GameplayTagId,
    pub namespace: GameplayTagNamespace,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GameplayTagCatalog {
    tags: Vec<GameplayTagDefinition>,
    #[serde(skip)]
    by_id: BTreeMap<GameplayTagId, usize>,
}

impl GameplayTagCatalog {
    /// Builds an immutable catalog from code-owned static definitions. There is
    /// intentionally no incremental registration or runtime handler API.
    pub fn from_static(
        definitions: &'static [StaticGameplayTagDefinition],
    ) -> Result<Self, GameplayTagCatalogError> {
        let tags = definitions
            .iter()
            .map(|definition| {
                let definition = GameplayTagDefinition {
                    tag_id: GameplayTagId::new(definition.tag_id)?,
                    namespace: GameplayTagNamespace::new(definition.namespace)?,
                };
                validate_definition(&definition)?;
                Ok(definition)
            })
            .collect::<Result<Vec<_>, GameplayTagCatalogError>>()?;
        build_catalog(tags)
    }

    #[must_use]
    pub fn v0_4_1() -> Self {
        const TAGS: &[StaticGameplayTagDefinition] = &[
            tag("Ability.Attack", "Ability"),
            tag("Ability.Control", "Ability"),
            tag("Ability.Defensive", "Ability"),
            tag("Ability.Heal", "Ability"),
            tag("Ability.Spell", "Ability"),
            tag("Character.Human", "Character"),
            tag("Character.Mechanical", "Character"),
            tag("Character.Undead", "Character"),
            tag("Damage.Physical", "Damage"),
            tag("Damage.Soul", "Damage"),
            tag("Element.Fire", "Element"),
            tag("Element.Lightning", "Element"),
            tag("Status.Burning", "Status"),
            tag("Status.Poisoned", "Status"),
            tag("Status.Stunned", "Status"),
        ];
        Self::from_static(TAGS).expect("built-in gameplay tag catalog is valid")
    }

    #[must_use]
    pub fn tags(&self) -> &[GameplayTagDefinition] {
        &self.tags
    }

    #[must_use]
    pub fn get(&self, tag_id: &GameplayTagId) -> Option<&GameplayTagDefinition> {
        self.by_id.get(tag_id).map(|index| &self.tags[*index])
    }

    #[must_use]
    pub fn contains(&self, tag_id: &GameplayTagId) -> bool {
        self.by_id.contains_key(tag_id)
    }

    pub fn require_all_known(
        &self,
        tag_ids: &[GameplayTagId],
    ) -> Result<(), GameplayTagCatalogError> {
        let mut previous: Option<&GameplayTagId> = None;
        for tag_id in tag_ids {
            if !self.contains(tag_id) {
                return Err(catalog_error(
                    GameplayTagCatalogErrorCode::UnknownTagId,
                    tag_id.as_str(),
                ));
            }
            if previous.is_some_and(|value| value >= tag_id) {
                return Err(catalog_error(
                    GameplayTagCatalogErrorCode::NonCanonicalTagOrder,
                    tag_id.as_str(),
                ));
            }
            previous = Some(tag_id);
        }
        Ok(())
    }
}

impl<'de> Deserialize<'de> for GameplayTagCatalog {
    fn deserialize<D>(deserializer: D) -> Result<Self, D::Error>
    where
        D: Deserializer<'de>,
    {
        #[derive(Deserialize)]
        #[serde(rename_all = "camelCase", deny_unknown_fields)]
        struct WireCatalog {
            tags: Vec<GameplayTagDefinition>,
        }

        let wire = WireCatalog::deserialize(deserializer)?;
        build_catalog(wire.tags).map_err(serde::de::Error::custom)
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum GameplayTagCatalogErrorCode {
    EmptyCatalog,
    InvalidTagId,
    InvalidNamespace,
    NamespaceMismatch,
    DuplicateTagId,
    UnknownTagId,
    NonCanonicalTagOrder,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct GameplayTagCatalogError {
    pub code: GameplayTagCatalogErrorCode,
    pub subject: String,
}

impl fmt::Display for GameplayTagCatalogError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(
            formatter,
            "gameplay tag catalog validation failed for {}: {:?}",
            self.subject, self.code
        )
    }
}

impl Error for GameplayTagCatalogError {}

const fn tag(tag_id: &'static str, namespace: &'static str) -> StaticGameplayTagDefinition {
    StaticGameplayTagDefinition { tag_id, namespace }
}

fn build_catalog(
    mut tags: Vec<GameplayTagDefinition>,
) -> Result<GameplayTagCatalog, GameplayTagCatalogError> {
    if tags.is_empty() {
        return Err(catalog_error(
            GameplayTagCatalogErrorCode::EmptyCatalog,
            "tags",
        ));
    }
    for definition in &tags {
        validate_definition(definition)?;
    }
    tags.sort_by(|left, right| left.tag_id.cmp(&right.tag_id));
    let mut by_id = BTreeMap::new();
    for (index, definition) in tags.iter().enumerate() {
        if by_id.insert(definition.tag_id.clone(), index).is_some() {
            return Err(catalog_error(
                GameplayTagCatalogErrorCode::DuplicateTagId,
                definition.tag_id.as_str(),
            ));
        }
    }
    Ok(GameplayTagCatalog { tags, by_id })
}

fn validate_definition(definition: &GameplayTagDefinition) -> Result<(), GameplayTagCatalogError> {
    validate_tag_id(definition.tag_id.as_str())?;
    validate_segment(
        definition.namespace.as_str(),
        GameplayTagCatalogErrorCode::InvalidNamespace,
    )?;
    if definition.tag_id.namespace_str() != definition.namespace.as_str() {
        return Err(catalog_error(
            GameplayTagCatalogErrorCode::NamespaceMismatch,
            definition.tag_id.as_str(),
        ));
    }
    Ok(())
}

fn validate_tag_id(value: &str) -> Result<(), GameplayTagCatalogError> {
    if value.len() > MAX_TAG_ID_LENGTH {
        return Err(catalog_error(
            GameplayTagCatalogErrorCode::InvalidTagId,
            value,
        ));
    }
    let segments: Vec<_> = value.split('.').collect();
    if segments.len() < 2
        || segments.iter().any(|segment| {
            validate_segment(segment, GameplayTagCatalogErrorCode::InvalidTagId).is_err()
        })
    {
        return Err(catalog_error(
            GameplayTagCatalogErrorCode::InvalidTagId,
            value,
        ));
    }
    Ok(())
}

fn validate_segment(
    value: &str,
    code: GameplayTagCatalogErrorCode,
) -> Result<(), GameplayTagCatalogError> {
    let mut bytes = value.bytes();
    if !bytes.next().is_some_and(|byte| byte.is_ascii_alphabetic())
        || !bytes.all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'_' | b'-'))
    {
        return Err(catalog_error(code, value));
    }
    Ok(())
}

fn catalog_error(
    code: GameplayTagCatalogErrorCode,
    subject: impl Into<String>,
) -> GameplayTagCatalogError {
    GameplayTagCatalogError {
        code,
        subject: subject.into(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const CUSTOM: &[StaticGameplayTagDefinition] = &[
        tag("Status.Stunned", "Status"),
        tag("Ability.Attack", "Ability"),
        tag("Damage.Physical", "Damage"),
    ];
    const CUSTOM_REORDERED: &[StaticGameplayTagDefinition] = &[
        tag("Damage.Physical", "Damage"),
        tag("Status.Stunned", "Status"),
        tag("Ability.Attack", "Ability"),
    ];

    #[test]
    fn stable_ids_round_trip_and_preserve_namespace() {
        let id = GameplayTagId::new("Status.Control.Hard").unwrap();
        assert_eq!(id.as_str(), "Status.Control.Hard");
        assert_eq!(id.namespace_str(), "Status");
        assert_eq!(
            serde_json::from_str::<GameplayTagId>(&serde_json::to_string(&id).unwrap()).unwrap(),
            id
        );
    }

    #[test]
    fn static_catalog_canonicalizes_input_and_serialization() {
        let catalog = GameplayTagCatalog::from_static(CUSTOM).unwrap();
        assert_eq!(
            catalog
                .tags()
                .iter()
                .map(|value| value.tag_id.as_str())
                .collect::<Vec<_>>(),
            vec!["Ability.Attack", "Damage.Physical", "Status.Stunned"]
        );
        let encoded = serde_json::to_string(&catalog).unwrap();
        assert_eq!(
            serde_json::from_str::<GameplayTagCatalog>(&encoded).unwrap(),
            catalog
        );
        assert_eq!(
            encoded,
            serde_json::to_string(&GameplayTagCatalog::from_static(CUSTOM_REORDERED).unwrap())
                .unwrap()
        );
    }

    #[test]
    fn built_in_catalog_is_the_frozen_public_rule_vocabulary() {
        let catalog = GameplayTagCatalog::v0_4_1();
        assert_eq!(catalog.tags().len(), 15);
        assert!(catalog.contains(&GameplayTagId::new("Character.Mechanical").unwrap()));
        assert!(catalog.contains(&GameplayTagId::new("Status.Burning").unwrap()));
    }

    #[test]
    fn rejects_malformed_ids_namespace_mismatch_duplicates_and_empty_catalog() {
        for value in [
            "Status",
            ".Stunned",
            "Status.",
            "Status..Stunned",
            "9Status.Stunned",
            "Status.Stun ned",
        ] {
            assert_eq!(
                GameplayTagId::new(value).unwrap_err().code,
                GameplayTagCatalogErrorCode::InvalidTagId
            );
        }
        const MISMATCH: &[StaticGameplayTagDefinition] = &[tag("Status.Stunned", "Ability")];
        assert_eq!(
            GameplayTagCatalog::from_static(MISMATCH).unwrap_err().code,
            GameplayTagCatalogErrorCode::NamespaceMismatch
        );
        const DUPLICATE: &[StaticGameplayTagDefinition] = &[
            tag("Status.Stunned", "Status"),
            tag("Status.Stunned", "Status"),
        ];
        assert_eq!(
            GameplayTagCatalog::from_static(DUPLICATE).unwrap_err().code,
            GameplayTagCatalogErrorCode::DuplicateTagId
        );
        assert_eq!(
            GameplayTagCatalog::from_static(&[]).unwrap_err().code,
            GameplayTagCatalogErrorCode::EmptyCatalog
        );
    }

    #[test]
    fn consumers_must_supply_known_canonical_tag_sets() {
        let catalog = GameplayTagCatalog::from_static(CUSTOM).unwrap();
        let known = vec![
            GameplayTagId::new("Ability.Attack").unwrap(),
            GameplayTagId::new("Status.Stunned").unwrap(),
        ];
        catalog.require_all_known(&known).unwrap();
        let unknown = vec![GameplayTagId::new("Status.Unknown").unwrap()];
        assert_eq!(
            catalog.require_all_known(&unknown).unwrap_err().code,
            GameplayTagCatalogErrorCode::UnknownTagId
        );
        let reversed = vec![
            GameplayTagId::new("Status.Stunned").unwrap(),
            GameplayTagId::new("Ability.Attack").unwrap(),
        ];
        assert_eq!(
            catalog.require_all_known(&reversed).unwrap_err().code,
            GameplayTagCatalogErrorCode::NonCanonicalTagOrder
        );
    }

    #[test]
    fn wire_shape_cannot_carry_execution_logic_or_dynamic_handlers() {
        let encoded =
            serde_json::to_string(&GameplayTagCatalog::from_static(CUSTOM).unwrap()).unwrap();
        let mut value: serde_json::Value = serde_json::from_str(&encoded).unwrap();
        value["tags"][0]["handler"] = serde_json::json!("execute()");
        assert!(serde_json::from_value::<GameplayTagCatalog>(value).is_err());
        assert!(!encoded.contains("aiExposure"));
        assert!(!encoded.contains("handler"));
        assert!(!encoded.contains("logic"));
    }
}
