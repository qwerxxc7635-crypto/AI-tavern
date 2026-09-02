use std::{collections::BTreeMap, error::Error, fmt, str::FromStr};

use serde::{Deserialize, Deserializer, Serialize};

#[derive(Debug, Clone, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize)]
#[serde(transparent)]
pub struct DamageChannelId(String);

impl DamageChannelId {
    pub fn new(value: impl Into<String>) -> Result<Self, DamageChannelCatalogError> {
        let value = value.into();
        validate_stable_id(&value, "channelId")?;
        Ok(Self(value))
    }

    #[must_use]
    pub fn as_str(&self) -> &str {
        &self.0
    }
}

impl fmt::Display for DamageChannelId {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str(&self.0)
    }
}

impl FromStr for DamageChannelId {
    type Err = DamageChannelCatalogError;

    fn from_str(value: &str) -> Result<Self, Self::Err> {
        Self::new(value)
    }
}

impl<'de> Deserialize<'de> for DamageChannelId {
    fn deserialize<D>(deserializer: D) -> Result<Self, D::Error>
    where
        D: Deserializer<'de>,
    {
        let value = String::deserialize(deserializer)?;
        Self::new(value).map_err(serde::de::Error::custom)
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct DamageChannelDefinition {
    pub channel_id: DamageChannelId,
    pub semantic_tags: Vec<String>,
    pub presentation_key: String,
}

impl DamageChannelDefinition {
    pub fn new(
        channel_id: impl Into<String>,
        semantic_tags: impl IntoIterator<Item = impl Into<String>>,
        presentation_key: impl Into<String>,
    ) -> Result<Self, DamageChannelCatalogError> {
        let definition = Self {
            channel_id: DamageChannelId::new(channel_id)?,
            semantic_tags: semantic_tags.into_iter().map(Into::into).collect(),
            presentation_key: presentation_key.into(),
        };
        validate_definition(&definition)?;
        Ok(definition)
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DamageChannelCatalog {
    channels: Vec<DamageChannelDefinition>,
    #[serde(skip)]
    by_id: BTreeMap<DamageChannelId, usize>,
}

impl DamageChannelCatalog {
    /// Builds one immutable catalog from code-owned or versioned rules data.
    ///
    /// Definitions are canonicalized by channel ID. There is deliberately no
    /// incremental registration API: changing membership requires constructing
    /// and validating a complete versioned catalog.
    pub fn from_versioned_definitions(
        definitions: impl IntoIterator<Item = DamageChannelDefinition>,
    ) -> Result<Self, DamageChannelCatalogError> {
        let mut channels: Vec<_> = definitions.into_iter().collect();
        for definition in &channels {
            validate_definition(definition)?;
        }
        channels.sort_by(|left, right| left.channel_id.cmp(&right.channel_id));

        let mut by_id = BTreeMap::new();
        for (index, definition) in channels.iter().enumerate() {
            if by_id.insert(definition.channel_id.clone(), index).is_some() {
                return Err(catalog_error(
                    DamageChannelCatalogErrorCode::DuplicateChannelId,
                    definition.channel_id.as_str(),
                ));
            }
        }
        if channels.is_empty() {
            return Err(catalog_error(
                DamageChannelCatalogErrorCode::EmptyCatalog,
                "channels",
            ));
        }

        Ok(Self { channels, by_id })
    }

    /// Canonical v0.4.1 channel identities declared by the four base profiles.
    /// Profile support and primary mitigation are intentionally not represented.
    pub fn v0_4_1() -> Self {
        const CHANNELS: &[&str] = &[
            "arcane",
            "ballistic",
            "electromagnetic",
            "fire",
            "ice",
            "kinetic",
            "lightning",
            "occult",
            "physical",
            "plasma",
            "psychic",
            "qi",
            "radiation",
            "soul",
            "thermal",
        ];

        Self::from_versioned_definitions(CHANNELS.iter().map(|channel_id| {
            DamageChannelDefinition::new(
                *channel_id,
                [format!("damage.{channel_id}")],
                format!("combat.damageChannel.{channel_id}"),
            )
            .expect("built-in damage channel metadata is valid")
        }))
        .expect("built-in damage channel catalog is valid")
    }

    #[must_use]
    pub fn channels(&self) -> &[DamageChannelDefinition] {
        &self.channels
    }

    #[must_use]
    pub fn get(&self, channel_id: &DamageChannelId) -> Option<&DamageChannelDefinition> {
        self.by_id
            .get(channel_id)
            .map(|index| &self.channels[*index])
    }

    #[must_use]
    pub fn contains(&self, channel_id: &DamageChannelId) -> bool {
        self.by_id.contains_key(channel_id)
    }
}

impl<'de> Deserialize<'de> for DamageChannelCatalog {
    fn deserialize<D>(deserializer: D) -> Result<Self, D::Error>
    where
        D: Deserializer<'de>,
    {
        #[derive(Deserialize)]
        #[serde(rename_all = "camelCase", deny_unknown_fields)]
        struct WireCatalog {
            channels: Vec<DamageChannelDefinition>,
        }

        let wire = WireCatalog::deserialize(deserializer)?;
        Self::from_versioned_definitions(wire.channels).map_err(serde::de::Error::custom)
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum DamageChannelCatalogErrorCode {
    EmptyCatalog,
    InvalidChannelId,
    DuplicateChannelId,
    InvalidSemanticTag,
    DuplicateSemanticTag,
    InvalidPresentationKey,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct DamageChannelCatalogError {
    pub code: DamageChannelCatalogErrorCode,
    pub subject: String,
}

impl fmt::Display for DamageChannelCatalogError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(
            formatter,
            "damage channel catalog validation failed for {}: {:?}",
            self.subject, self.code
        )
    }
}

impl Error for DamageChannelCatalogError {}

fn validate_definition(
    definition: &DamageChannelDefinition,
) -> Result<(), DamageChannelCatalogError> {
    validate_stable_id(definition.channel_id.as_str(), "channelId")?;
    if definition.semantic_tags.is_empty() {
        return Err(catalog_error(
            DamageChannelCatalogErrorCode::InvalidSemanticTag,
            definition.channel_id.as_str(),
        ));
    }

    let mut previous: Option<&str> = None;
    for tag in &definition.semantic_tags {
        validate_namespaced_id(tag, DamageChannelCatalogErrorCode::InvalidSemanticTag)?;
        if previous.is_some_and(|value| value >= tag.as_str()) {
            return Err(catalog_error(
                if previous == Some(tag.as_str()) {
                    DamageChannelCatalogErrorCode::DuplicateSemanticTag
                } else {
                    DamageChannelCatalogErrorCode::InvalidSemanticTag
                },
                tag,
            ));
        }
        previous = Some(tag);
    }

    validate_namespaced_id(
        &definition.presentation_key,
        DamageChannelCatalogErrorCode::InvalidPresentationKey,
    )
}

fn validate_stable_id(value: &str, subject: &str) -> Result<(), DamageChannelCatalogError> {
    if value.is_empty()
        || !value.bytes().enumerate().all(|(index, byte)| {
            byte.is_ascii_lowercase()
                || byte.is_ascii_digit() && index > 0
                || byte == b'-' && index > 0 && index + 1 < value.len()
        })
    {
        return Err(catalog_error(
            DamageChannelCatalogErrorCode::InvalidChannelId,
            subject,
        ));
    }
    Ok(())
}

fn validate_namespaced_id(
    value: &str,
    code: DamageChannelCatalogErrorCode,
) -> Result<(), DamageChannelCatalogError> {
    let valid = !value.is_empty()
        && !value.starts_with('.')
        && !value.ends_with('.')
        && value.contains('.')
        && value
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'.' | b'-' | b'_'))
        && !value.contains("..");
    if valid {
        Ok(())
    } else {
        Err(catalog_error(code, value))
    }
}

fn catalog_error(
    code: DamageChannelCatalogErrorCode,
    subject: impl Into<String>,
) -> DamageChannelCatalogError {
    DamageChannelCatalogError {
        code,
        subject: subject.into(),
    }
}

#[cfg(test)]
mod tests {
    use serde_json::{Value, json};

    use super::*;

    fn definition(id: &str) -> DamageChannelDefinition {
        DamageChannelDefinition::new(
            id,
            [format!("damage.{id}")],
            format!("combat.damageChannel.{id}"),
        )
        .unwrap()
    }

    #[test]
    fn stable_id_round_trip_validates_open_string_vocabulary() {
        let channel_id: DamageChannelId = serde_json::from_str("\"void-2\"").unwrap();
        assert_eq!(channel_id.as_str(), "void-2");
        assert_eq!(serde_json::to_string(&channel_id).unwrap(), "\"void-2\"");

        for invalid in ["", "Physical", "two words", "-fire", "fire-", "火"] {
            assert!(DamageChannelId::new(invalid).is_err(), "{invalid}");
        }
    }

    #[test]
    fn catalog_canonicalizes_order_and_lookup_is_deterministic() {
        let catalog = DamageChannelCatalog::from_versioned_definitions([
            definition("thermal"),
            definition("physical"),
            definition("arcane"),
        ])
        .unwrap();

        assert_eq!(
            catalog
                .channels()
                .iter()
                .map(|entry| entry.channel_id.as_str())
                .collect::<Vec<_>>(),
            ["arcane", "physical", "thermal"]
        );
        assert!(catalog.contains(&DamageChannelId::new("physical").unwrap()));
        assert_eq!(
            catalog
                .get(&DamageChannelId::new("thermal").unwrap())
                .unwrap()
                .presentation_key,
            "combat.damageChannel.thermal"
        );
        assert!(
            catalog
                .get(&DamageChannelId::new("unknown").unwrap())
                .is_none()
        );
    }

    #[test]
    fn catalog_serialization_is_canonical_and_has_no_mitigation_fact() {
        let first = DamageChannelCatalog::from_versioned_definitions([
            definition("physical"),
            definition("fire"),
        ])
        .unwrap();
        let second = DamageChannelCatalog::from_versioned_definitions([
            definition("fire"),
            definition("physical"),
        ])
        .unwrap();

        let first_json = serde_json::to_string(&first).unwrap();
        assert_eq!(first_json, serde_json::to_string(&second).unwrap());
        assert!(!first_json.contains("mitigation"));
        assert_eq!(
            serde_json::from_str::<DamageChannelCatalog>(&first_json).unwrap(),
            first
        );
    }

    #[test]
    fn malformed_or_duplicate_catalog_data_is_rejected() {
        let duplicate = json!({
            "channels": [
                {
                    "channelId": "fire",
                    "semanticTags": ["damage.fire"],
                    "presentationKey": "combat.damageChannel.fire"
                },
                {
                    "channelId": "fire",
                    "semanticTags": ["damage.fire"],
                    "presentationKey": "combat.damageChannel.fire"
                }
            ]
        });
        assert!(serde_json::from_value::<DamageChannelCatalog>(duplicate).is_err());

        let unknown_mitigation = json!({
            "channels": [{
                "channelId": "fire",
                "semanticTags": ["damage.fire"],
                "presentationKey": "combat.damageChannel.fire",
                "primaryMitigation": "RESISTANCE"
            }]
        });
        assert!(serde_json::from_value::<DamageChannelCatalog>(unknown_mitigation).is_err());
    }

    #[test]
    fn definition_metadata_is_validated_and_tags_have_canonical_order() {
        assert_eq!(
            DamageChannelDefinition::new(
                "fire",
                ["element.fire", "damage.fire"],
                "combat.damageChannel.fire"
            )
            .unwrap_err()
            .code,
            DamageChannelCatalogErrorCode::InvalidSemanticTag
        );
        assert_eq!(
            DamageChannelDefinition::new(
                "fire",
                ["damage.fire", "damage.fire"],
                "combat.damageChannel.fire"
            )
            .unwrap_err()
            .code,
            DamageChannelCatalogErrorCode::DuplicateSemanticTag
        );
        assert_eq!(
            DamageChannelDefinition::new("fire", ["damage.fire"], "fire")
                .unwrap_err()
                .code,
            DamageChannelCatalogErrorCode::InvalidPresentationKey
        );
    }

    #[test]
    fn built_in_catalog_matches_frozen_base_profile_vocabulary() {
        let catalog = DamageChannelCatalog::v0_4_1();
        assert_eq!(catalog.channels().len(), 15);
        for id in [
            "physical",
            "fire",
            "ice",
            "lightning",
            "arcane",
            "kinetic",
            "thermal",
            "electromagnetic",
            "plasma",
            "radiation",
            "qi",
            "soul",
            "ballistic",
            "psychic",
            "occult",
        ] {
            assert!(catalog.contains(&DamageChannelId::new(id).unwrap()), "{id}");
        }

        let value = serde_json::to_value(catalog).unwrap();
        let entries = value["channels"].as_array().unwrap();
        assert!(entries.iter().all(|entry| {
            entry.as_object().is_some_and(|object| {
                object.keys().collect::<Vec<_>>()
                    == ["channelId", "presentationKey", "semanticTags"]
            })
        }));
        assert_eq!(value.get("primaryMitigation"), None::<&Value>);
    }
}
