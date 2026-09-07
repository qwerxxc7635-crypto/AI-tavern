use std::collections::HashSet;

use rusqlite::{Connection, OptionalExtension, TransactionBehavior, params};
use serde::{Deserialize, Serialize};

use crate::{
    CampaignStore, CampaignStoreError, current_timestamp, save_archive::assert_no_secret_text,
    validate_id,
};

const PROMPT_MANAGER_KEY: &str = "prompt_manager_v1";
const PROMPT_PRESET_FORMAT: &str = "EMBER_PROMPT_PRESET";
const MAX_PRESETS: usize = 24;
const MAX_BLOCKS: usize = 8;
const MAX_TASKS: usize = 25;
const AI_TASKS: &[&str] = &[
    "GENERATE_WORLD",
    "REFINE_WORLD",
    "GENERATE_CHARACTER_TRAITS",
    "COMPLETE_CHARACTER_BACKGROUND",
    "GENERATE_QUICK_CHARACTER",
    "EDIT_CHARACTER_DRAFT",
    "GENERATE_CAREER_POOL",
    "GENERATE_ITEMS",
    "GENERATE_NPC_LOD",
    "GENERATE_LOCATIONS",
    "GENERATE_FACTIONS",
    "GENERATE_TAVERN",
    "GENERATE_NPCS",
    "NPC_REPLY",
    "GENERATE_DIALOGUE_SUGGESTIONS",
    "PROPOSE_TAVERN_SCENE_ACTION",
    "GENERATE_QUEST",
    "GENERATE_ADVENTURE_PLAN",
    "GENERATE_ADVENTURE_TURN",
    "RESOLVE_DICE_RESULT",
    "GENERATE_WORLD_EVENT",
    "SUMMARIZE_ADVENTURE",
    "EXTRACT_MEMORIES",
    "CHECK_CONSISTENCY",
    "COMBAT_CONTENT_GENERATION",
];

#[derive(Clone, Debug, Deserialize, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PromptUserBlock {
    pub id: String,
    pub name: String,
    pub content: String,
    pub enabled: bool,
    pub tasks: Vec<String>,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PromptPreset {
    pub id: String,
    pub name: String,
    pub version: u64,
    pub blocks: Vec<PromptUserBlock>,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PromptManagerSnapshot {
    pub schema_version: u64,
    pub revision: u64,
    pub active_preset_id: Option<String>,
    pub presets: Vec<PromptPreset>,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PromptPresetSaveCommand {
    pub expected_manager_revision: u64,
    pub expected_preset_version: Option<u64>,
    pub preset_id: String,
    pub name: String,
    pub blocks: Vec<PromptUserBlock>,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PromptPresetActivateCommand {
    pub expected_manager_revision: u64,
    pub preset_id: Option<String>,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PromptPresetImportCommand {
    pub expected_manager_revision: u64,
    pub target_preset_id: String,
    pub bundle_json: String,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct PromptPresetBundle {
    format: String,
    format_version: u64,
    preset: PromptPreset,
}

impl CampaignStore {
    pub fn prompt_manager(&self) -> Result<PromptManagerSnapshot, CampaignStoreError> {
        load_settings(&self.connect()?)
    }

    pub fn save_prompt_preset(
        &self,
        command: PromptPresetSaveCommand,
    ) -> Result<PromptManagerSnapshot, CampaignStoreError> {
        validate_id(&command.preset_id)?;
        validate_name(&command.name)?;
        validate_blocks(&command.blocks)?;
        let mut connection = self.connect()?;
        let transaction = connection.transaction_with_behavior(TransactionBehavior::Immediate)?;
        let mut snapshot = load_settings(&transaction)?;
        validate_revision(snapshot.revision, command.expected_manager_revision)?;
        let existing = snapshot
            .presets
            .iter()
            .position(|preset| preset.id == command.preset_id);
        let version = match existing {
            Some(index) => {
                let current = &snapshot.presets[index];
                if command.expected_preset_version != Some(current.version) {
                    return Err(CampaignStoreError::ConcurrentModification);
                }
                current
                    .version
                    .checked_add(1)
                    .ok_or(CampaignStoreError::InvalidData)?
            }
            None => {
                if command.expected_preset_version.is_some()
                    || snapshot.presets.len() >= MAX_PRESETS
                {
                    return Err(CampaignStoreError::InvalidData);
                }
                1
            }
        };
        let preset = PromptPreset {
            id: command.preset_id,
            name: command.name,
            version,
            blocks: command.blocks,
        };
        match existing {
            Some(index) => snapshot.presets[index] = preset,
            None => snapshot.presets.push(preset),
        }
        snapshot.revision = next_revision(snapshot.revision)?;
        save_settings(&transaction, &snapshot)?;
        transaction.commit()?;
        Ok(snapshot)
    }

    pub fn activate_prompt_preset(
        &self,
        command: PromptPresetActivateCommand,
    ) -> Result<PromptManagerSnapshot, CampaignStoreError> {
        let mut connection = self.connect()?;
        let transaction = connection.transaction_with_behavior(TransactionBehavior::Immediate)?;
        let mut snapshot = load_settings(&transaction)?;
        validate_revision(snapshot.revision, command.expected_manager_revision)?;
        if let Some(id) = &command.preset_id {
            validate_id(id)?;
            if !snapshot.presets.iter().any(|preset| &preset.id == id) {
                return Err(CampaignStoreError::NotFound);
            }
        }
        if snapshot.active_preset_id == command.preset_id {
            transaction.commit()?;
            return Ok(snapshot);
        }
        snapshot.active_preset_id = command.preset_id;
        snapshot.revision = next_revision(snapshot.revision)?;
        save_settings(&transaction, &snapshot)?;
        transaction.commit()?;
        Ok(snapshot)
    }

    pub fn import_prompt_preset(
        &self,
        command: PromptPresetImportCommand,
    ) -> Result<PromptManagerSnapshot, CampaignStoreError> {
        validate_id(&command.target_preset_id)?;
        if command.bundle_json.len() > 64 * 1024 {
            return Err(CampaignStoreError::InvalidData);
        }
        ensure_no_secret(&command.bundle_json)?;
        let bundle: PromptPresetBundle = serde_json::from_str(&command.bundle_json)
            .map_err(|_| CampaignStoreError::InvalidData)?;
        if bundle.format != PROMPT_PRESET_FORMAT || bundle.format_version != 1 {
            return Err(CampaignStoreError::InvalidData);
        }
        validate_preset(&bundle.preset)?;
        let mut connection = self.connect()?;
        let transaction = connection.transaction_with_behavior(TransactionBehavior::Immediate)?;
        let mut snapshot = load_settings(&transaction)?;
        validate_revision(snapshot.revision, command.expected_manager_revision)?;
        if snapshot.presets.len() >= MAX_PRESETS
            || snapshot
                .presets
                .iter()
                .any(|preset| preset.id == command.target_preset_id)
        {
            return Err(CampaignStoreError::InvalidData);
        }
        snapshot.presets.push(PromptPreset {
            id: command.target_preset_id,
            name: bundle.preset.name,
            version: bundle.preset.version,
            blocks: bundle.preset.blocks,
        });
        snapshot.revision = next_revision(snapshot.revision)?;
        save_settings(&transaction, &snapshot)?;
        transaction.commit()?;
        Ok(snapshot)
    }

    pub fn export_prompt_preset(&self, preset_id: &str) -> Result<String, CampaignStoreError> {
        validate_id(preset_id)?;
        let snapshot = self.prompt_manager()?;
        let preset = snapshot
            .presets
            .into_iter()
            .find(|preset| preset.id == preset_id)
            .ok_or(CampaignStoreError::NotFound)?;
        let bundle = PromptPresetBundle {
            format: PROMPT_PRESET_FORMAT.to_owned(),
            format_version: 1,
            preset,
        };
        let encoded =
            serde_json::to_string_pretty(&bundle).map_err(|_| CampaignStoreError::InvalidData)?;
        ensure_no_secret(&encoded)?;
        Ok(encoded)
    }

    pub fn reset_prompt_manager(
        &self,
        expected_revision: Option<u64>,
    ) -> Result<PromptManagerSnapshot, CampaignStoreError> {
        let mut connection = self.connect()?;
        let transaction = connection.transaction_with_behavior(TransactionBehavior::Immediate)?;
        match load_settings(&transaction) {
            Ok(snapshot) => {
                if expected_revision != Some(snapshot.revision) {
                    return Err(CampaignStoreError::ConcurrentModification);
                }
            }
            Err(CampaignStoreError::InvalidData) => {
                if expected_revision.is_some() {
                    return Err(CampaignStoreError::ConcurrentModification);
                }
            }
            Err(error) => return Err(error),
        }
        transaction.execute(
            "DELETE FROM app_settings WHERE key=?1",
            [PROMPT_MANAGER_KEY],
        )?;
        transaction.commit()?;
        Ok(default_snapshot())
    }
}

fn load_settings(connection: &Connection) -> Result<PromptManagerSnapshot, CampaignStoreError> {
    let stored = connection
        .query_row(
            "SELECT value_json FROM app_settings WHERE key=?1",
            [PROMPT_MANAGER_KEY],
            |row| row.get::<_, String>(0),
        )
        .optional()?;
    let snapshot = match stored {
        Some(raw) => serde_json::from_str(&raw).map_err(|_| CampaignStoreError::InvalidData)?,
        None => default_snapshot(),
    };
    validate_snapshot(&snapshot)?;
    Ok(snapshot)
}

fn default_snapshot() -> PromptManagerSnapshot {
    PromptManagerSnapshot {
        schema_version: 1,
        revision: 0,
        active_preset_id: None,
        presets: Vec::new(),
    }
}

fn save_settings(
    connection: &Connection,
    snapshot: &PromptManagerSnapshot,
) -> Result<(), CampaignStoreError> {
    validate_snapshot(snapshot)?;
    let value = serde_json::to_string(snapshot).map_err(|_| CampaignStoreError::InvalidData)?;
    ensure_no_secret(&value)?;
    connection.execute(
        "INSERT INTO app_settings(key,value_json,updated_at) VALUES(?1,?2,?3)
         ON CONFLICT(key) DO UPDATE SET value_json=excluded.value_json,updated_at=excluded.updated_at",
        params![PROMPT_MANAGER_KEY, value, current_timestamp()?],
    )?;
    Ok(())
}

fn validate_snapshot(snapshot: &PromptManagerSnapshot) -> Result<(), CampaignStoreError> {
    if snapshot.schema_version != 1 || snapshot.presets.len() > MAX_PRESETS {
        return Err(CampaignStoreError::InvalidData);
    }
    let mut ids = HashSet::new();
    for preset in &snapshot.presets {
        validate_preset(preset)?;
        if !ids.insert(&preset.id) {
            return Err(CampaignStoreError::InvalidData);
        }
    }
    if snapshot
        .active_preset_id
        .as_ref()
        .is_some_and(|id| !ids.contains(id))
    {
        return Err(CampaignStoreError::InvalidData);
    }
    Ok(())
}

fn validate_preset(preset: &PromptPreset) -> Result<(), CampaignStoreError> {
    validate_id(&preset.id)?;
    validate_name(&preset.name)?;
    if preset.version == 0 {
        return Err(CampaignStoreError::InvalidData);
    }
    validate_blocks(&preset.blocks)
}

fn validate_blocks(blocks: &[PromptUserBlock]) -> Result<(), CampaignStoreError> {
    if blocks.len() > MAX_BLOCKS {
        return Err(CampaignStoreError::InvalidData);
    }
    let mut ids = HashSet::new();
    for block in blocks {
        validate_id(&block.id)?;
        validate_name(&block.name)?;
        validate_content(&block.content)?;
        if !ids.insert(&block.id) || block.tasks.len() > MAX_TASKS {
            return Err(CampaignStoreError::InvalidData);
        }
        let mut tasks = HashSet::new();
        for task in &block.tasks {
            if !AI_TASKS.contains(&task.as_str()) || !tasks.insert(task) {
                return Err(CampaignStoreError::InvalidData);
            }
        }
    }
    Ok(())
}

fn validate_name(value: &str) -> Result<(), CampaignStoreError> {
    validate_bounded(value, 80)
}

fn validate_content(value: &str) -> Result<(), CampaignStoreError> {
    validate_bounded(value, 4_000)?;
    ensure_no_secret(value)
}

fn ensure_no_secret(value: &str) -> Result<(), CampaignStoreError> {
    assert_no_secret_text(value).map_err(|_| CampaignStoreError::InvalidData)
}

fn validate_bounded(value: &str, max: usize) -> Result<(), CampaignStoreError> {
    if value.trim() != value
        || value.is_empty()
        || value.chars().count() > max
        || value.contains('\0')
    {
        return Err(CampaignStoreError::InvalidData);
    }
    Ok(())
}

fn validate_revision(current: u64, expected: u64) -> Result<(), CampaignStoreError> {
    if current != expected {
        return Err(CampaignStoreError::ConcurrentModification);
    }
    Ok(())
}

fn next_revision(current: u64) -> Result<u64, CampaignStoreError> {
    current
        .checked_add(1)
        .ok_or(CampaignStoreError::InvalidData)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn versions_orders_activates_exports_imports_and_resets_presets() {
        let directory = tempfile::tempdir().expect("tempdir");
        let path = directory.path().join("prompt-manager.sqlite");
        let store = CampaignStore::open(&path).expect("store");
        assert_eq!(store.prompt_manager().expect("default").revision, 0);
        let created = store
            .save_prompt_preset(save_command(0, None, "preset-one"))
            .expect("create");
        assert_eq!(created.presets[0].version, 1);
        assert_eq!(created.presets[0].blocks[0].name, "Tone first");
        assert_eq!(created.presets[0].blocks[1].name, "Dialogue second");
        let active = store
            .activate_prompt_preset(PromptPresetActivateCommand {
                expected_manager_revision: 1,
                preset_id: Some("preset-one".to_owned()),
            })
            .expect("activate");
        assert_eq!(active.revision, 2);
        let updated = store
            .save_prompt_preset(save_command(2, Some(1), "preset-one"))
            .expect("update");
        assert_eq!(updated.presets[0].version, 2);
        let bundle = store.export_prompt_preset("preset-one").expect("export");
        assert!(!bundle.to_lowercase().contains("core rule"));
        let imported = store
            .import_prompt_preset(PromptPresetImportCommand {
                expected_manager_revision: 3,
                target_preset_id: "preset-imported".to_owned(),
                bundle_json: bundle,
            })
            .expect("import");
        assert_eq!(imported.presets[1].version, 2);
        let reset = store
            .activate_prompt_preset(PromptPresetActivateCommand {
                expected_manager_revision: 4,
                preset_id: None,
            })
            .expect("reset");
        assert_eq!(reset.active_preset_id, None);
        drop(store);
        assert_eq!(
            CampaignStore::open(path)
                .expect("reopen")
                .prompt_manager()
                .expect("reload"),
            reset
        );
    }

    #[test]
    fn rejects_stale_invalid_and_secret_settings_without_replacing_baseline() {
        let directory = tempfile::tempdir().expect("tempdir");
        let store =
            CampaignStore::open(directory.path().join("prompt-invalid.sqlite")).expect("store");
        let baseline = store
            .save_prompt_preset(save_command(0, None, "preset-safe"))
            .expect("baseline");
        let mut stale = save_command(0, Some(1), "preset-safe");
        stale.blocks[0].content = "Changed".to_owned();
        assert!(matches!(
            store.save_prompt_preset(stale),
            Err(CampaignStoreError::ConcurrentModification)
        ));
        let mut secret = save_command(1, Some(1), "preset-safe");
        secret.blocks[0].content = "api_key=sk-secretvalue123".to_owned();
        assert!(matches!(
            store.save_prompt_preset(secret),
            Err(CampaignStoreError::InvalidData)
        ));
        assert!(matches!(
            store.import_prompt_preset(PromptPresetImportCommand {
                expected_manager_revision: 1,
                target_preset_id: "preset-import".to_owned(),
                bundle_json: r#"{"format":"EMBER_PROMPT_PRESET","formatVersion":2,"preset":{}}"#
                    .to_owned(),
            }),
            Err(CampaignStoreError::InvalidData)
        ));
        assert_eq!(store.prompt_manager().expect("unchanged"), baseline);
    }

    #[test]
    fn recovers_a_malformed_snapshot_without_allowing_revisionless_valid_reset() {
        let directory = tempfile::tempdir().expect("tempdir");
        let store =
            CampaignStore::open(directory.path().join("prompt-recovery.sqlite")).expect("store");
        store
            .save_prompt_preset(save_command(0, None, "preset-safe"))
            .expect("baseline");
        assert!(matches!(
            store.reset_prompt_manager(None),
            Err(CampaignStoreError::ConcurrentModification)
        ));
        store
            .connect()
            .expect("connection")
            .execute(
                "UPDATE app_settings SET value_json='{}' WHERE key=?1",
                [PROMPT_MANAGER_KEY],
            )
            .expect("corrupt fixture");
        assert!(matches!(
            store.prompt_manager(),
            Err(CampaignStoreError::InvalidData)
        ));
        assert_eq!(
            store.reset_prompt_manager(None).expect("recover"),
            default_snapshot()
        );
        assert_eq!(store.prompt_manager().expect("default"), default_snapshot());
    }

    fn save_command(
        expected_manager_revision: u64,
        expected_preset_version: Option<u64>,
        preset_id: &str,
    ) -> PromptPresetSaveCommand {
        PromptPresetSaveCommand {
            expected_manager_revision,
            expected_preset_version,
            preset_id: preset_id.to_owned(),
            name: "Candlelit mystery".to_owned(),
            blocks: vec![
                PromptUserBlock {
                    id: "tone".to_owned(),
                    name: "Tone first".to_owned(),
                    content: "Use restrained, sensory prose.".to_owned(),
                    enabled: true,
                    tasks: Vec::new(),
                },
                PromptUserBlock {
                    id: "dialogue".to_owned(),
                    name: "Dialogue second".to_owned(),
                    content: "Keep dialogue concise.".to_owned(),
                    enabled: true,
                    tasks: vec!["NPC_REPLY".to_owned()],
                },
            ],
        }
    }
}
