//! Windows desktop entry point.

#![forbid(unsafe_code)]

mod platform_paths;

use ember_native_bridge::{
    AdventureActionSubmit, AdventureArchiveView, AdventureDiceCommit, AdventurePlanCommit,
    AdventureSettlementCommit, AdventureSnapshot, AdventureTurnCommit, CampaignArchiveExportResult,
    CampaignArchiveImportMode, CampaignArchiveInspection, CampaignRecoverySnapshot, CampaignStore,
    CampaignStoreError, CampaignSummary, CharacterCompletionCommit, CharacterCreationSnapshot,
    CharacterTraitGenerationCommit, ModelSettingsSnapshot, ModelSettingsUpdate, NpcDialogueCommit,
    NpcDialogueSnapshot, NpcRosterGenerationCommit, QuestBoardSnapshot, QuestGenerationCommit,
    TavernGenerationCommit, TavernSnapshot, WorldCreationSnapshot, WorldGenerationCommit,
    WorldManualUpdate,
};
use ember_provider_openai_compatible::{
    CustomCompatibleConfig, DeepSeekPreset, ModelCostStatus, OllamaPreset, OpenAiCompatibleConfig,
    OpenAiCompatibleProvider, OpenRouterPreset, ProviderError, QwenPreset,
};
use ember_secure_secrets::{CredentialRef, SecretStore};
use serde::{Deserialize, Serialize};
use tauri::{Manager, State};
use time::{OffsetDateTime, format_description::well_known::Rfc3339};
use tokio_util::sync::CancellationToken;

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct CommandError {
    code: &'static str,
    message: &'static str,
}

impl From<CampaignStoreError> for CommandError {
    fn from(error: CampaignStoreError) -> Self {
        match error {
            CampaignStoreError::NotFound => Self {
                code: "CAMPAIGN_NOT_FOUND",
                message: "找不到该存档。",
            },
            CampaignStoreError::AlreadyArchived => Self {
                code: "CAMPAIGN_ARCHIVED",
                message: "该存档已经归档。",
            },
            CampaignStoreError::InvalidState => Self {
                code: "CAMPAIGN_STATE_INVALID",
                message: "当前存档阶段不允许执行该操作。",
            },
            CampaignStoreError::InvalidData | CampaignStoreError::IncompatibleSchema => Self {
                code: "CAMPAIGN_DATA_INVALID",
                message: "本地存档数据无法读取。",
            },
            CampaignStoreError::ArchiveInvalid => Self {
                code: "SAVE_ARCHIVE_INVALID",
                message: "存档文件损坏、格式不兼容或未通过安全校验。",
            },
            CampaignStoreError::ArchiveConflict => Self {
                code: "SAVE_ARCHIVE_CONFLICT",
                message: "导入方式与本地同名存档不一致，请刷新后重试。",
            },
            CampaignStoreError::ArchivePathInvalid => Self {
                code: "SAVE_PATH_INVALID",
                message: "请选择有效的.emtavern文件位置。",
            },
            CampaignStoreError::InvalidSystemTime
            | CampaignStoreError::Database(_)
            | CampaignStoreError::Io(_) => Self {
                code: "LOCAL_STORAGE_UNAVAILABLE",
                message: "暂时无法访问本地存档。",
            },
        }
    }
}

impl From<ProviderError> for CommandError {
    fn from(error: ProviderError) -> Self {
        match error {
            ProviderError::QuotaExceeded => Self {
                code: "QUOTA_EXCEEDED",
                message: "模型额度已用尽，请检查额度或更换模型。",
            },
            ProviderError::Authentication | ProviderError::Credential => Self {
                code: "AUTHENTICATION_FAILED",
                message: "模型服务认证失败，请检查API Key。",
            },
            ProviderError::RateLimited => Self {
                code: "RATE_LIMITED",
                message: "模型服务请求过于频繁，请稍后重试。",
            },
            ProviderError::Timeout => Self {
                code: "TIMEOUT",
                message: "模型服务响应超时，请重试。",
            },
            ProviderError::ModelNotFound => Self {
                code: "MODEL_NOT_FOUND",
                message: "当前模型不存在或已下线，请重新选择模型。",
            },
            ProviderError::InvalidResponse => Self {
                code: "INVALID_OUTPUT",
                message: "模型返回内容无法验证，本地存档未修改。",
            },
            ProviderError::Network => Self {
                code: "NETWORK_FAILED",
                message: "无法连接模型服务，请检查网络和服务状态。",
            },
            _ => Self {
                code: "PROVIDER_UNAVAILABLE",
                message: "模型服务暂时不可用，请检查配置和服务状态。",
            },
        }
    }
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct ProviderProbeInput {
    preset_key: String,
    base_url: Option<String>,
    credential_ref: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct ProviderProbeModel {
    name: String,
    display_name: String,
    capabilities: ProbeCapabilities,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct ProbeCapabilities {
    text: bool,
    streaming: bool,
    system_messages: bool,
    json_mode: bool,
    json_schema: bool,
    tool_calling: bool,
    reasoning: bool,
    context_window_tokens: Option<u64>,
    cost_status: &'static str,
    checked_at: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct ProviderProbeResult {
    models: Vec<ProviderProbeModel>,
}

#[tauri::command]
fn model_settings_get(
    store: State<'_, CampaignStore>,
) -> Result<ModelSettingsSnapshot, CommandError> {
    store.model_settings().map_err(Into::into)
}

#[tauri::command]
fn model_settings_save(
    command: ModelSettingsUpdate,
    store: State<'_, CampaignStore>,
) -> Result<ModelSettingsSnapshot, CommandError> {
    if let Some(value) = command.credential_ref.as_deref() {
        let reference = value.parse::<CredentialRef>().map_err(|_| CommandError {
            code: "CREDENTIAL_INVALID",
            message: "密钥引用无效，请重新输入API Key。",
        })?;
        if !SecretStore.exists(&reference).map_err(|_| CommandError {
            code: "CREDENTIAL_UNAVAILABLE",
            message: "无法访问系统凭据库，请稍后重试。",
        })? {
            return Err(CommandError {
                code: "CREDENTIAL_NOT_FOUND",
                message: "找不到已保存的API Key，请重新输入。",
            });
        }
    }
    store.save_model_settings(command).map_err(Into::into)
}

#[tauri::command]
fn model_settings_forget_credential(
    profile_id: String,
    store: State<'_, CampaignStore>,
) -> Result<ModelSettingsSnapshot, CommandError> {
    let (snapshot, credential_ref) = store.forget_model_credential(&profile_id)?;
    if let Some(value) = credential_ref {
        let reference = value.parse::<CredentialRef>().map_err(|_| CommandError {
            code: "CREDENTIAL_INVALID",
            message: "密钥引用无效；模型配置已停止使用该凭据，请在Windows凭据管理器中检查残留项。",
        })?;
        SecretStore.delete(&reference).map_err(|_| CommandError {
            code: "CREDENTIAL_UNAVAILABLE",
            message: "模型配置已停止使用该凭据，但系统凭据删除失败，请在Windows凭据管理器中手工清理。",
        })?;
    }
    Ok(snapshot)
}

#[tauri::command]
async fn provider_probe(input: ProviderProbeInput) -> Result<ProviderProbeResult, CommandError> {
    let credential = input
        .credential_ref
        .map(|value| value.parse::<CredentialRef>())
        .transpose()
        .map_err(|_| ProviderError::InvalidConfig)?;
    let config: OpenAiCompatibleConfig = match input.preset_key.as_str() {
        "deepseek" => DeepSeekPreset::config(credential.ok_or(ProviderError::InvalidConfig)?)?,
        "qwen" => QwenPreset::config(credential.ok_or(ProviderError::InvalidConfig)?)?,
        "openrouter" => OpenRouterPreset::config(credential.ok_or(ProviderError::InvalidConfig)?)?,
        "ollama" => OllamaPreset::config()?,
        "custom" => {
            let custom = CustomCompatibleConfig::new(
                input
                    .base_url
                    .as_deref()
                    .ok_or(ProviderError::InvalidConfig)?,
                "probe-model",
                credential,
                Vec::new(),
            )?;
            custom.provider_config().clone()
        }
        _ => return Err(ProviderError::InvalidConfig.into()),
    };
    let checked_at = OffsetDateTime::now_utc()
        .format(&Rfc3339)
        .map_err(|_| ProviderError::InvalidResponse)?;
    let preset_key = input.preset_key;
    let models = OpenAiCompatibleProvider::new()?
        .list_models(&config, CancellationToken::new())
        .await?
        .into_iter()
        .map(|model| {
            let json_mode = match preset_key.as_str() {
                "deepseek" | "qwen" | "ollama" => true,
                "openrouter" => model.supports_json_mode.unwrap_or(false),
                _ => false,
            };
            ProviderProbeModel {
                name: model.name,
                display_name: model.display_name,
                capabilities: ProbeCapabilities {
                    text: true,
                    streaming: false,
                    system_messages: true,
                    json_mode,
                    json_schema: false,
                    tool_calling: false,
                    reasoning: matches!(preset_key.as_str(), "deepseek" | "qwen"),
                    context_window_tokens: model.context_window_tokens,
                    cost_status: match model.cost_status {
                        ModelCostStatus::Free => "FREE",
                        ModelCostStatus::Paid => "PAID",
                        ModelCostStatus::Unknown => "UNKNOWN",
                    },
                    checked_at: checked_at.clone(),
                },
            }
        })
        .collect();
    Ok(ProviderProbeResult { models })
}

#[tauri::command]
fn campaign_list(store: State<'_, CampaignStore>) -> Result<Vec<CampaignSummary>, CommandError> {
    store.list().map_err(Into::into)
}

#[tauri::command]
fn campaign_create(store: State<'_, CampaignStore>) -> Result<CampaignSummary, CommandError> {
    store.create_campaign().map_err(Into::into)
}

#[tauri::command]
fn campaign_continue(
    id: String,
    store: State<'_, CampaignStore>,
) -> Result<CampaignSummary, CommandError> {
    store.continue_campaign(&id).map_err(Into::into)
}

#[tauri::command]
fn campaign_archive(id: String, store: State<'_, CampaignStore>) -> Result<(), CommandError> {
    store.archive_campaign(&id).map_err(Into::into)
}

#[tauri::command]
fn campaign_delete(id: String, store: State<'_, CampaignStore>) -> Result<(), CommandError> {
    store.delete_campaign(&id).map_err(Into::into)
}

#[tauri::command]
fn campaign_recovery_get(
    id: String,
    store: State<'_, CampaignStore>,
) -> Result<CampaignRecoverySnapshot, CommandError> {
    store.campaign_recovery(&id).map_err(Into::into)
}

#[tauri::command]
fn campaign_recovery_restore(
    id: String,
    store: State<'_, CampaignStore>,
) -> Result<CampaignSummary, CommandError> {
    store
        .restore_campaign_after_failure(&id)
        .map_err(Into::into)
}

#[tauri::command]
async fn save_archive_inspect(
    path: String,
    store: State<'_, CampaignStore>,
) -> Result<CampaignArchiveInspection, CommandError> {
    let store = store.inner().clone();
    tauri::async_runtime::spawn_blocking(move || store.inspect_campaign_archive(path))
        .await
        .map_err(|_| archive_worker_error())?
        .map_err(Into::into)
}

#[tauri::command]
async fn save_archive_export(
    id: String,
    path: String,
    store: State<'_, CampaignStore>,
) -> Result<CampaignArchiveExportResult, CommandError> {
    let store = store.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        store.export_campaign_archive(&id, path, env!("CARGO_PKG_VERSION"))
    })
    .await
    .map_err(|_| archive_worker_error())?
    .map_err(Into::into)
}

#[tauri::command]
async fn save_archive_import(
    path: String,
    mode: CampaignArchiveImportMode,
    store: State<'_, CampaignStore>,
) -> Result<CampaignSummary, CommandError> {
    let store = store.inner().clone();
    tauri::async_runtime::spawn_blocking(move || store.import_campaign_archive(path, mode))
        .await
        .map_err(|_| archive_worker_error())?
        .map_err(Into::into)
}

fn archive_worker_error() -> CommandError {
    CommandError {
        code: "LOCAL_STORAGE_UNAVAILABLE",
        message: "存档文件处理进程意外中止，请重试。",
    }
}

#[tauri::command]
fn world_creation_get(
    id: String,
    store: State<'_, CampaignStore>,
) -> Result<WorldCreationSnapshot, CommandError> {
    store.world_creation_snapshot(&id).map_err(Into::into)
}

#[tauri::command]
fn world_generation_commit(
    command: WorldGenerationCommit,
    store: State<'_, CampaignStore>,
) -> Result<WorldCreationSnapshot, CommandError> {
    store.commit_world_generation(command).map_err(Into::into)
}

#[tauri::command]
fn world_draft_update(
    command: WorldManualUpdate,
    store: State<'_, CampaignStore>,
) -> Result<WorldCreationSnapshot, CommandError> {
    store.update_world_draft(command).map_err(Into::into)
}

#[tauri::command]
fn world_confirm(
    id: String,
    store: State<'_, CampaignStore>,
) -> Result<WorldCreationSnapshot, CommandError> {
    store.confirm_world(&id).map_err(Into::into)
}

#[tauri::command]
fn character_creation_get(
    id: String,
    store: State<'_, CampaignStore>,
) -> Result<CharacterCreationSnapshot, CommandError> {
    store.character_creation_snapshot(&id).map_err(Into::into)
}

#[tauri::command]
fn character_traits_commit(
    command: CharacterTraitGenerationCommit,
    store: State<'_, CampaignStore>,
) -> Result<CharacterCreationSnapshot, CommandError> {
    store.commit_character_traits(command).map_err(Into::into)
}

#[tauri::command]
fn character_completion_commit(
    command: CharacterCompletionCommit,
    store: State<'_, CampaignStore>,
) -> Result<CharacterCreationSnapshot, CommandError> {
    store
        .commit_character_completion(command)
        .map_err(Into::into)
}

#[tauri::command]
fn tavern_get(id: String, store: State<'_, CampaignStore>) -> Result<TavernSnapshot, CommandError> {
    store.tavern_snapshot(&id).map_err(Into::into)
}

#[tauri::command]
fn tavern_generation_commit(
    command: TavernGenerationCommit,
    store: State<'_, CampaignStore>,
) -> Result<TavernSnapshot, CommandError> {
    store.commit_tavern_generation(command).map_err(Into::into)
}

#[tauri::command]
fn tavern_npcs_commit(
    command: NpcRosterGenerationCommit,
    store: State<'_, CampaignStore>,
) -> Result<TavernSnapshot, CommandError> {
    store
        .commit_npc_roster_generation(command)
        .map_err(Into::into)
}

#[tauri::command]
fn npc_dialogue_get(
    campaign_id: String,
    npc_id: String,
    store: State<'_, CampaignStore>,
) -> Result<NpcDialogueSnapshot, CommandError> {
    store
        .npc_dialogue_snapshot(&campaign_id, &npc_id)
        .map_err(Into::into)
}

#[tauri::command]
fn npc_dialogue_commit(
    command: NpcDialogueCommit,
    store: State<'_, CampaignStore>,
) -> Result<NpcDialogueSnapshot, CommandError> {
    store.commit_npc_dialogue(command).map_err(Into::into)
}

#[tauri::command]
fn quest_board_get(
    campaign_id: String,
    store: State<'_, CampaignStore>,
) -> Result<QuestBoardSnapshot, CommandError> {
    store.quest_board_snapshot(&campaign_id).map_err(Into::into)
}

#[tauri::command]
fn quest_generation_commit(
    command: QuestGenerationCommit,
    store: State<'_, CampaignStore>,
) -> Result<QuestBoardSnapshot, CommandError> {
    store.commit_quest_generation(command).map_err(Into::into)
}

#[tauri::command]
fn quest_accept(
    campaign_id: String,
    quest_id: String,
    store: State<'_, CampaignStore>,
) -> Result<QuestBoardSnapshot, CommandError> {
    store
        .accept_quest(&campaign_id, &quest_id)
        .map_err(Into::into)
}

#[tauri::command]
fn adventure_get(
    campaign_id: String,
    quest_id: Option<String>,
    store: State<'_, CampaignStore>,
) -> Result<AdventureSnapshot, CommandError> {
    store
        .adventure_snapshot(&campaign_id, quest_id.as_deref())
        .map_err(Into::into)
}

#[tauri::command]
fn adventure_plan_commit(
    command: AdventurePlanCommit,
    store: State<'_, CampaignStore>,
) -> Result<AdventureSnapshot, CommandError> {
    store.commit_adventure_plan(command).map_err(Into::into)
}

#[tauri::command]
fn adventure_start(
    campaign_id: String,
    adventure_id: String,
    store: State<'_, CampaignStore>,
) -> Result<AdventureSnapshot, CommandError> {
    store
        .start_adventure(&campaign_id, &adventure_id)
        .map_err(Into::into)
}

#[tauri::command]
fn adventure_action_submit(
    command: AdventureActionSubmit,
    store: State<'_, CampaignStore>,
) -> Result<AdventureSnapshot, CommandError> {
    store.submit_adventure_action(command).map_err(Into::into)
}

#[tauri::command]
fn adventure_turn_commit(
    command: AdventureTurnCommit,
    store: State<'_, CampaignStore>,
) -> Result<AdventureSnapshot, CommandError> {
    store.commit_adventure_turn(command).map_err(Into::into)
}

#[tauri::command]
fn adventure_roll(
    campaign_id: String,
    adventure_id: String,
    store: State<'_, CampaignStore>,
) -> Result<AdventureSnapshot, CommandError> {
    store
        .roll_adventure_check(&campaign_id, &adventure_id)
        .map_err(Into::into)
}

#[tauri::command]
fn adventure_dice_commit(
    command: AdventureDiceCommit,
    store: State<'_, CampaignStore>,
) -> Result<AdventureSnapshot, CommandError> {
    store.commit_adventure_dice(command).map_err(Into::into)
}

#[tauri::command]
fn adventure_settlement_commit(
    command: AdventureSettlementCommit,
    store: State<'_, CampaignStore>,
) -> Result<AdventureArchiveView, CommandError> {
    store
        .commit_adventure_settlement(command)
        .map_err(Into::into)
}

#[tauri::command]
fn adventure_archives_get(
    campaign_id: String,
    store: State<'_, CampaignStore>,
) -> Result<Vec<AdventureArchiveView>, CommandError> {
    store
        .list_adventure_archives(&campaign_id)
        .map_err(Into::into)
}

#[tauri::command]
fn secret_save(secret: String) -> Result<String, String> {
    SecretStore
        .save(secret)
        .map(|reference| reference.to_string())
        .map_err(|error| error.to_string())
}

#[tauri::command]
fn secret_exists(credential_ref: String) -> Result<bool, String> {
    let reference = credential_ref
        .parse::<CredentialRef>()
        .map_err(|error| error.to_string())?;
    SecretStore
        .exists(&reference)
        .map_err(|error| error.to_string())
}

#[tauri::command]
fn secret_delete(credential_ref: String) -> Result<(), String> {
    let reference = credential_ref
        .parse::<CredentialRef>()
        .map_err(|error| error.to_string())?;
    SecretStore
        .delete(&reference)
        .map_err(|error| error.to_string())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .setup(|app| {
            let database_path = platform_paths::database_path(app)?;
            app.manage(CampaignStore::open(database_path)?);
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            campaign_list,
            campaign_create,
            campaign_continue,
            campaign_archive,
            campaign_delete,
            campaign_recovery_get,
            campaign_recovery_restore,
            save_archive_inspect,
            save_archive_export,
            save_archive_import,
            world_creation_get,
            world_generation_commit,
            world_draft_update,
            world_confirm,
            character_creation_get,
            character_traits_commit,
            character_completion_commit,
            tavern_get,
            tavern_generation_commit,
            tavern_npcs_commit,
            npc_dialogue_get,
            npc_dialogue_commit,
            quest_board_get,
            quest_generation_commit,
            quest_accept,
            adventure_get,
            adventure_plan_commit,
            adventure_start,
            adventure_action_submit,
            adventure_turn_commit,
            adventure_roll,
            adventure_dice_commit,
            adventure_settlement_commit,
            adventure_archives_get,
            secret_save,
            secret_exists,
            secret_delete,
            model_settings_get,
            model_settings_save,
            model_settings_forget_credential,
            provider_probe
        ])
        .run(tauri::generate_context!())
        .expect("failed to run Ember Tavern");
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn provider_command_errors_keep_actionable_standard_codes() {
        for (source, expected) in [
            (ProviderError::QuotaExceeded, "QUOTA_EXCEEDED"),
            (ProviderError::Authentication, "AUTHENTICATION_FAILED"),
            (ProviderError::RateLimited, "RATE_LIMITED"),
            (ProviderError::Timeout, "TIMEOUT"),
            (ProviderError::ModelNotFound, "MODEL_NOT_FOUND"),
            (ProviderError::InvalidResponse, "INVALID_OUTPUT"),
            (ProviderError::Network, "NETWORK_FAILED"),
        ] {
            let command_error = CommandError::from(source);
            assert_eq!(command_error.code, expected);
            assert!(!command_error.message.is_empty());
        }
    }
}
