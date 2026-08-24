//! Windows desktop entry point.

#![forbid(unsafe_code)]

mod platform_paths;

use std::{
    collections::HashMap,
    sync::Mutex,
    time::{Duration, Instant},
};

use ember_native_bridge::{
    ActiveFactionGenerationCommit, ActiveFactionGenerationRequest, ActiveFactionGenerationSnapshot,
    ActiveFactionSnapshot, AdventureActionSubmit, AdventureArchiveView, AdventureDiceCommit,
    AdventurePlanCommit, AdventureSettlementCommit, AdventureSnapshot, AdventureTurnCommit,
    CampaignArchiveExportResult, CampaignArchiveImportMode, CampaignArchiveInspection,
    CampaignRecoverySnapshot, CampaignStore, CampaignStoreError, CampaignSummary, CapabilitySource,
    CareerPool, CareerPoolGenerationCommit, CharacterCandidateConfirm, CharacterCompletionCommit,
    CharacterCreationSnapshot, CharacterRulesState, CharacterTraitGenerationCommit,
    CredentialAction, CredentialCleanupReason, DialogueSuggestionCommit,
    DialogueSuggestionPreparation, DialogueSuggestionPrepareCommand, DialogueSuggestionSet,
    DirectorBudgetAdmitCommand, DirectorBudgetSnapshot, DynamicLocationGenerationCommit,
    DynamicLocationGenerationRequest, DynamicLocationGenerationSnapshot, DynamicLocationSnapshot,
    DynamicLocationTravelCommand, DynamicQuestCommitCommand, DynamicQuestPreparation,
    DynamicQuestPrepareCommand, FactionActionCommand, ModelCapabilitiesRegistration,
    ModelSettingsSnapshot, ModelSettingsUpdate, NpcDialogueCommit, NpcDialogueSnapshot,
    NpcLodGenerationSnapshot, NpcLodSeedCommand, NpcLodUpgradeCommit, NpcRosterGenerationCommit,
    NpcTimelineBegin, NpcTimelineFail, NpcTimelineOperation, PromptManagerSnapshot,
    PromptPresetActivateCommand, PromptPresetImportCommand, PromptPresetSaveCommand,
    QuestBoardSnapshot, QuestGenerationCommit, QuestGraphEvaluateCommand, QuestGraphReplaceCommand,
    QuestGraphSnapshot, QuestPoolTransitionCommand, RandomnessSettingsSnapshot,
    RandomnessSettingsUpdate, RulesApplyCommand, RulesCommitReceipt, TavernGenerationCommit,
    TavernPopulationFocusCommand, TavernPopulationProjectCommand, TavernPopulationSnapshot,
    TavernSceneCommit, TavernSceneGenerationRequest, TavernScenePrepare, TavernSceneSnapshot,
    TavernSceneStart, TavernSnapshot, UniversalCharacterCreationConfirm,
    UniversalCharacterCreationSave, UniversalCharacterCreationSnapshot,
    UniversalCharacterCreationStart, UniversalCharacterQuickCommit, WorldCreationSnapshot,
    WorldDirectorCommitCommand, WorldDirectorPreparation, WorldDirectorPrepareCommand,
    WorldDirectorRun, WorldGenerationCommit, WorldManualUpdate, model_endpoint_fingerprint,
    model_probe_fingerprint,
};
use ember_platform_services::{AppInstanceLock, FileAppInstanceLock};
use ember_provider_openai_compatible::{
    DEEPSEEK_BASE_URL, DeepSeekPreset, FinishReason, MessageRole, ModelCostStatus,
    NormalizedMessage, NormalizedRequest, OLLAMA_BASE_URL, OPENROUTER_BASE_URL,
    OpenAiCompatibleConfig, OpenAiCompatibleProvider, OpenRouterPreset, ProviderError,
    QWEN_BASE_URL, QwenPreset, ResponseFormat, TokenUsage,
};
use ember_secure_secrets::{CredentialRef, SecretStore, SecureVault};
use serde::{Deserialize, Serialize, ser::SerializeStruct};
use tauri::{Manager, State, ipc::Channel};
use time::OffsetDateTime;
use tokio_util::sync::CancellationToken;
use uuid::Uuid;

const PROBE_RECEIPT_TTL: Duration = Duration::from_secs(15 * 60);
const MAX_PROBE_RECEIPTS: usize = 64;
const MAX_ACTIVE_AI_STREAMS: usize = 32;
const AI_STREAM_CANCEL_TOMBSTONE_TTL: Duration = Duration::from_secs(30);

#[derive(Debug)]
struct CommandError {
    code: &'static str,
    message: &'static str,
}

#[derive(Clone, Copy)]
struct CommandErrorPolicy {
    kind: &'static str,
    retryable: bool,
    fallback_eligible: bool,
    surface: &'static str,
    actions: &'static [&'static str],
}

impl Serialize for CommandError {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: serde::Serializer,
    {
        let policy = command_error_policy(self.code);
        let mut state = serializer.serialize_struct("CommandError", 7)?;
        state.serialize_field("code", self.code)?;
        state.serialize_field("message", self.message)?;
        state.serialize_field("kind", policy.kind)?;
        state.serialize_field("retryable", &policy.retryable)?;
        state.serialize_field("fallbackEligible", &policy.fallback_eligible)?;
        state.serialize_field("surface", policy.surface)?;
        state.serialize_field("actions", policy.actions)?;
        state.end()
    }
}

fn command_error_policy(code: &str) -> CommandErrorPolicy {
    match code {
        "AUTHENTICATION_FAILED"
        | "QUOTA_EXCEEDED"
        | "MODEL_NOT_FOUND"
        | "MODEL_NOT_CONFIGURED"
        | "MODEL_PROFILE_MISSING"
        | "NO_MODEL_CANDIDATE"
        | "MODEL_SELECTION_DRIFT"
        | "CREDENTIAL_INVALID"
        | "CREDENTIAL_UNAVAILABLE"
        | "CREDENTIAL_NOT_FOUND" => {
            error_policy("PROVIDER", false, false, "ERROR_STATE", &["OPEN_SETTINGS"])
        }
        "RATE_LIMITED" | "PROVIDER_UNAVAILABLE" => error_policy(
            "PROVIDER",
            true,
            true,
            "TOAST",
            &["RETRY", "CANCEL", "USE_FALLBACK"],
        ),
        "TIMEOUT" | "NETWORK_FAILED" => error_policy(
            "NETWORK",
            true,
            true,
            "TOAST",
            &["RETRY", "CANCEL", "USE_FALLBACK"],
        ),
        "CANCELLED" => error_policy("GENERATION", true, false, "TOAST", &["RETRY", "CANCEL"]),
        "INVALID_OUTPUT"
        | "FACT_CONFLICT"
        | "PROBE_STALE"
        | "REPETITION_DETECTED"
        | "WORLD_COMMIT_OUTPUT_MISMATCH"
        | "WORLD_COMMIT_ENVELOPE_INVALID" => error_policy(
            "VALIDATION",
            true,
            false,
            "ERROR_STATE",
            &["RETRY", "CANCEL"],
        ),
        "CAMPAIGN_STATE_INVALID" | "UNCONFIRMED_CANDIDATE" | "WORLD_BUSINESS_RULE_INVALID" => {
            error_policy("RULE", false, false, "ERROR_STATE", &["DISMISS"])
        }
        "CONCURRENT_MODIFICATION" | "APP_LOCK_UNAVAILABLE" | "LOCAL_STORAGE_UNAVAILABLE" => {
            error_policy(
                "PERSISTENCE",
                true,
                false,
                "ERROR_STATE",
                &["RETRY", "CANCEL"],
            )
        }
        "CAMPAIGN_NOT_FOUND"
        | "CAMPAIGN_ARCHIVED"
        | "CAMPAIGN_DATA_INVALID"
        | "SAVE_ARCHIVE_INVALID"
        | "SAVE_ARCHIVE_CONFLICT"
        | "SAVE_PATH_INVALID" => {
            error_policy("PERSISTENCE", false, false, "ERROR_STATE", &["DISMISS"])
        }
        "UNKNOWN" => error_policy(
            "GENERATION",
            false,
            false,
            "ERROR_STATE",
            &["OPEN_SETTINGS"],
        ),
        _ => error_policy("GENERATION", false, false, "ERROR_STATE", &["DISMISS"]),
    }
}

const fn error_policy(
    kind: &'static str,
    retryable: bool,
    fallback_eligible: bool,
    surface: &'static str,
    actions: &'static [&'static str],
) -> CommandErrorPolicy {
    CommandErrorPolicy {
        kind,
        retryable,
        fallback_eligible,
        surface,
        actions,
    }
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
            CampaignStoreError::FactConflict => Self {
                code: "FACT_CONFLICT",
                message: "生成内容与当前世界事实冲突，可用相同意图进行技术重试。",
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
            CampaignStoreError::UnconfirmedCandidate => Self {
                code: "UNCONFIRMED_CANDIDATE",
                message: "请先确认当前AI候选，再导出存档。",
            },
            CampaignStoreError::ConcurrentModification => Self {
                code: "CONCURRENT_MODIFICATION",
                message: "本地存档在备份后发生变化，本次操作已取消，请刷新后重试。",
            },
            CampaignStoreError::AppLock(_) => Self {
                code: "APP_LOCK_UNAVAILABLE",
                message: "另一个操作或应用实例正在使用本地存档，请稍后重试。",
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
            ProviderError::Cancelled => Self {
                code: "CANCELLED",
                message: "生成已取消，本地存档未修改。",
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

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
struct ProviderProbeModel {
    name: String,
    display_name: String,
    capabilities: ModelCapabilitiesRegistration,
    capability_source: CapabilitySource,
    probe_fingerprint: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct ProviderProbeResult {
    receipt_id: String,
    normalized_base_url: String,
    endpoint_fingerprint: String,
    models: Vec<ProviderProbeModel>,
}

#[derive(Clone)]
struct StoredProbe {
    preset_key: String,
    normalized_base_url: String,
    endpoint_fingerprint: String,
    models: Vec<ProviderProbeModel>,
    created_at: Instant,
}

#[derive(Default)]
struct ProviderProbeRegistry(Mutex<HashMap<String, StoredProbe>>);

impl ProviderProbeRegistry {
    fn insert(&self, probe: StoredProbe) -> Result<String, CommandError> {
        let mut entries = self.0.lock().map_err(|_| probe_stale())?;
        entries.retain(|_, value| value.created_at.elapsed() <= PROBE_RECEIPT_TTL);
        if entries.len() >= MAX_PROBE_RECEIPTS
            && let Some(oldest) = entries
                .iter()
                .min_by_key(|(_, value)| value.created_at)
                .map(|(key, _)| key.clone())
        {
            entries.remove(&oldest);
        }
        let receipt_id = Uuid::new_v4().to_string();
        entries.insert(receipt_id.clone(), probe);
        Ok(receipt_id)
    }

    fn validate(&self, update: &ModelSettingsUpdate) -> Result<(), CommandError> {
        let mut entries = self.0.lock().map_err(|_| probe_stale())?;
        entries.retain(|_, value| value.created_at.elapsed() <= PROBE_RECEIPT_TTL);
        let probe = entries
            .get(&update.probe_receipt_id)
            .ok_or_else(probe_stale)?;
        let base_url = update.base_url.as_deref().ok_or_else(probe_stale)?;
        let model_matches = probe.models.iter().any(|model| {
            model.name == update.model_name
                && model.display_name == update.model_display_name
                && model.capabilities == update.capabilities
                && model.capability_source == update.capability_source
                && model.probe_fingerprint == update.probe_fingerprint
        });
        if probe.preset_key != update.preset_key
            || probe.normalized_base_url != base_url
            || probe.endpoint_fingerprint != update.endpoint_fingerprint
            || !model_matches
        {
            return Err(probe_stale());
        }
        Ok(())
    }
}

fn probe_stale() -> CommandError {
    CommandError {
        code: "PROBE_STALE",
        message: "连接测试结果已失效，请重新测试后保存。",
    }
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
enum RuntimeMessageRole {
    System,
    User,
    Assistant,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct RuntimeMessage {
    role: RuntimeMessageRole,
    content: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
enum RuntimeResponseFormatKind {
    Text,
    JsonObject,
    JsonSchema,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct RuntimeResponseFormat {
    kind: RuntimeResponseFormatKind,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct RuntimeGenerateRequest {
    selected_profile_id: String,
    request_id: String,
    task: String,
    prompt_version: u64,
    model_name: String,
    messages: Vec<RuntimeMessage>,
    response_format: RuntimeResponseFormat,
    temperature: f64,
    max_output_tokens: u32,
    timeout_ms: u64,
    cache_prefix_hash: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct RuntimeTokenUsage {
    input_tokens: Option<u64>,
    output_tokens: Option<u64>,
    total_tokens: Option<u64>,
    prompt_cache_hit_tokens: Option<u64>,
    prompt_cache_miss_tokens: Option<u64>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct RuntimeGenerateResponse {
    request_id: String,
    provider_request_id: Option<String>,
    model_name: String,
    content: String,
    finish_reason: &'static str,
    usage: RuntimeTokenUsage,
    received_at: String,
    selected_profile_id: String,
    selected_provider_id: String,
    selected_preset_key: String,
    selected_provider_display_name: String,
    cache_metric_recorded: Option<bool>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct RuntimeStreamEvent {
    request_id: String,
    sequence: u64,
    content: String,
}

struct RegisteredAiStream {
    cancellation: CancellationToken,
    registered: bool,
    created_at: Instant,
}

#[derive(Default)]
struct AiStreamRegistry(Mutex<HashMap<String, RegisteredAiStream>>);

impl AiStreamRegistry {
    fn register(&self, request_id: &str) -> Result<CancellationToken, CommandError> {
        if !valid_stream_request_id(request_id) {
            return Err(ProviderError::InvalidRequest.into());
        }
        let mut streams = self.0.lock().map_err(|_| CommandError {
            code: "PROVIDER_UNAVAILABLE",
            message: "模型流式通道暂时不可用，请重试。",
        })?;
        streams.retain(|_, value| {
            value.registered || value.created_at.elapsed() <= AI_STREAM_CANCEL_TOMBSTONE_TTL
        });
        if let Some(existing) = streams.get(request_id) {
            if !existing.registered {
                streams.remove(request_id);
                return Err(ProviderError::Cancelled.into());
            }
            return Err(CommandError {
                code: "PROVIDER_UNAVAILABLE",
                message: "相同的流式生成任务正在执行，请稍后重试。",
            });
        }
        if streams.len() >= MAX_ACTIVE_AI_STREAMS {
            return Err(CommandError {
                code: "PROVIDER_UNAVAILABLE",
                message: "当前流式生成任务过多，请稍后重试。",
            });
        }
        let cancellation = CancellationToken::new();
        streams.insert(
            request_id.to_owned(),
            RegisteredAiStream {
                cancellation: cancellation.clone(),
                registered: true,
                created_at: Instant::now(),
            },
        );
        Ok(cancellation)
    }

    fn cancel(&self, request_id: &str) -> Result<bool, CommandError> {
        if !valid_stream_request_id(request_id) {
            return Err(ProviderError::InvalidRequest.into());
        }
        let mut streams = self.0.lock().map_err(|_| CommandError {
            code: "PROVIDER_UNAVAILABLE",
            message: "模型流式通道暂时不可用，请重试。",
        })?;
        streams.retain(|_, value| {
            value.registered || value.created_at.elapsed() <= AI_STREAM_CANCEL_TOMBSTONE_TTL
        });
        if let Some(stream) = streams.get(request_id) {
            stream.cancellation.cancel();
        } else {
            if streams.len() >= MAX_ACTIVE_AI_STREAMS {
                return Err(CommandError {
                    code: "PROVIDER_UNAVAILABLE",
                    message: "当前流式生成任务过多，请稍后重试。",
                });
            }
            let cancellation = CancellationToken::new();
            cancellation.cancel();
            streams.insert(
                request_id.to_owned(),
                RegisteredAiStream {
                    cancellation,
                    registered: false,
                    created_at: Instant::now(),
                },
            );
        }
        Ok(true)
    }

    fn remove(&self, request_id: &str) {
        if let Ok(mut streams) = self.0.lock() {
            streams.remove(request_id);
        }
    }
}

fn valid_stream_request_id(request_id: &str) -> bool {
    !request_id.is_empty()
        && request_id.len() <= 256
        && request_id
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || b":._-".contains(&byte))
}

#[tauri::command]
async fn ai_generate(
    request: RuntimeGenerateRequest,
    store: State<'_, CampaignStore>,
) -> Result<RuntimeGenerateResponse, CommandError> {
    execute_ai_generate(request, store.inner()).await
}

async fn execute_ai_generate(
    request: RuntimeGenerateRequest,
    store: &CampaignStore,
) -> Result<RuntimeGenerateResponse, CommandError> {
    execute_ai_generate_inner(request, store, CancellationToken::new(), false, |_| Ok(())).await
}

#[tauri::command]
async fn ai_generate_stream(
    request: RuntimeGenerateRequest,
    on_event: Channel<RuntimeStreamEvent>,
    store: State<'_, CampaignStore>,
    streams: State<'_, AiStreamRegistry>,
) -> Result<RuntimeGenerateResponse, CommandError> {
    let request_id = request.request_id.clone();
    let cancellation = streams.register(&request_id)?;
    let mut sequence = 0_u64;
    let result = execute_ai_generate_inner(request, store.inner(), cancellation, true, |content| {
        sequence = sequence
            .checked_add(1)
            .ok_or(ProviderError::InvalidResponse)?;
        on_event
            .send(RuntimeStreamEvent {
                request_id: request_id.clone(),
                sequence,
                content: content.to_owned(),
            })
            .map_err(|_| ProviderError::Cancelled)
    })
    .await;
    streams.remove(&request_id);
    result
}

#[tauri::command]
fn ai_stream_cancel(
    request_id: String,
    streams: State<'_, AiStreamRegistry>,
) -> Result<bool, CommandError> {
    streams.cancel(&request_id)
}

async fn execute_ai_generate_inner<F>(
    request: RuntimeGenerateRequest,
    store: &CampaignStore,
    cancellation: CancellationToken,
    streaming: bool,
    mut on_delta: F,
) -> Result<RuntimeGenerateResponse, CommandError>
where
    F: FnMut(&str) -> Result<(), ProviderError>,
{
    let runtime = store
        .model_runtime_config(&request.selected_profile_id)
        .map_err(|error| match error {
            CampaignStoreError::NotFound => CommandError {
                code: "MODEL_NOT_CONFIGURED",
                message: "请先在模型设置中测试并保存默认模型。",
            },
            other => other.into(),
        })?;
    if request.model_name != runtime.model_name {
        return Err(CommandError {
            code: "MODEL_SELECTION_DRIFT",
            message: "模型设置已发生变化，请按当前设置重新生成。",
        });
    }
    if request.task.trim().is_empty()
        || request.prompt_version == 0
        || !is_sha256_hex(&request.cache_prefix_hash)
    {
        return Err(ProviderError::InvalidRequest.into());
    }
    let credential = runtime
        .credential_ref
        .as_deref()
        .map(str::parse::<CredentialRef>)
        .transpose()
        .map_err(|_| ProviderError::InvalidConfig)?;
    let config = runtime_provider_config(&runtime.preset_key, &runtime.base_url, credential)?;
    let metric_task = request.task.clone();
    let cache_prefix_hash = request.cache_prefix_hash.clone();
    let normalized = NormalizedRequest {
        request_id: request.request_id,
        model_name: request.model_name,
        messages: request
            .messages
            .into_iter()
            .map(|message| NormalizedMessage {
                role: match message.role {
                    RuntimeMessageRole::System => MessageRole::System,
                    RuntimeMessageRole::User => MessageRole::User,
                    RuntimeMessageRole::Assistant => MessageRole::Assistant,
                },
                content: message.content,
            })
            .collect(),
        response_format: match request.response_format.kind {
            RuntimeResponseFormatKind::Text => ResponseFormat::Text,
            RuntimeResponseFormatKind::JsonObject => ResponseFormat::JsonObject,
            RuntimeResponseFormatKind::JsonSchema => ResponseFormat::JsonSchema,
        },
        temperature: request.temperature,
        max_output_tokens: request.max_output_tokens,
        timeout: Duration::from_millis(request.timeout_ms),
    };
    let provider = OpenAiCompatibleProvider::new()?;
    let response = if streaming {
        provider
            .generate_stream(&config, &normalized, cancellation, &mut on_delta)
            .await?
    } else {
        provider
            .generate(&config, &normalized, cancellation)
            .await?
    };
    let cache_metric_recorded = record_cache_metric_best_effort(
        store,
        &runtime.preset_key,
        &metric_task,
        response.usage.prompt_cache_hit_tokens,
        response.usage.prompt_cache_miss_tokens,
        &cache_prefix_hash,
        &response.received_at,
    );
    Ok(RuntimeGenerateResponse {
        request_id: response.request_id,
        provider_request_id: response.provider_request_id,
        model_name: response.model_name,
        content: response.content,
        finish_reason: finish_reason_name(response.finish_reason),
        usage: runtime_usage(response.usage),
        received_at: response.received_at,
        selected_profile_id: runtime.profile_id,
        selected_provider_id: runtime.provider_id,
        selected_preset_key: runtime.preset_key,
        selected_provider_display_name: runtime.provider_display_name,
        cache_metric_recorded,
    })
}

fn record_cache_metric_best_effort(
    store: &CampaignStore,
    preset_key: &str,
    task: &str,
    hit: Option<u64>,
    miss: Option<u64>,
    prefix_hash: &str,
    recorded_at: &str,
) -> Option<bool> {
    if preset_key != "deepseek" {
        return None;
    }
    let (Some(hit), Some(miss)) = (hit, miss) else {
        return None;
    };
    Some(
        store
            .record_deepseek_cache_metric(task, hit, miss, prefix_hash, recorded_at)
            .is_ok(),
    )
}

fn runtime_provider_config(
    preset_key: &str,
    base_url: &str,
    credential: Option<CredentialRef>,
) -> Result<OpenAiCompatibleConfig, ProviderError> {
    match preset_key {
        "deepseek" => DeepSeekPreset::config(credential.ok_or(ProviderError::InvalidConfig)?),
        "qwen" => QwenPreset::config(credential.ok_or(ProviderError::InvalidConfig)?),
        "openrouter" => OpenRouterPreset::config(credential.ok_or(ProviderError::InvalidConfig)?),
        "ollama" => OpenAiCompatibleConfig::new(base_url, None),
        "custom" => OpenAiCompatibleConfig::new(base_url, credential),
        _ => Err(ProviderError::InvalidConfig),
    }
}

fn is_sha256_hex(value: &str) -> bool {
    value.len() == 64 && value.bytes().all(|byte| byte.is_ascii_hexdigit())
}

fn finish_reason_name(reason: FinishReason) -> &'static str {
    match reason {
        FinishReason::Stop => "STOP",
        FinishReason::Length => "LENGTH",
        FinishReason::ContentFilter => "CONTENT_FILTER",
        FinishReason::ToolCall => "TOOL_CALL",
        FinishReason::Error => "ERROR",
        FinishReason::Unknown => "UNKNOWN",
    }
}

fn runtime_usage(usage: TokenUsage) -> RuntimeTokenUsage {
    RuntimeTokenUsage {
        input_tokens: usage.input_tokens,
        output_tokens: usage.output_tokens,
        total_tokens: usage.total_tokens,
        prompt_cache_hit_tokens: usage.prompt_cache_hit_tokens,
        prompt_cache_miss_tokens: usage.prompt_cache_miss_tokens,
    }
}

#[tauri::command]
fn model_settings_get(
    store: State<'_, CampaignStore>,
) -> Result<ModelSettingsSnapshot, CommandError> {
    retry_pending_credential_cleanup(&store, &SecretStore)?;
    store.model_settings().map_err(Into::into)
}

#[tauri::command]
fn model_settings_save(
    command: ModelSettingsUpdate,
    store: State<'_, CampaignStore>,
    probes: State<'_, ProviderProbeRegistry>,
) -> Result<ModelSettingsSnapshot, CommandError> {
    probes.validate(&command)?;
    if command.credential_action == CredentialAction::Replace
        && let Some(value) = command.credential_ref.as_deref()
    {
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
    store.save_model_settings(command)?;
    retry_pending_credential_cleanup(&store, &SecretStore)?;
    store.model_settings().map_err(Into::into)
}

#[tauri::command]
fn model_settings_forget_credential(
    profile_id: String,
    store: State<'_, CampaignStore>,
) -> Result<ModelSettingsSnapshot, CommandError> {
    store.forget_model_credential(&profile_id)?;
    retry_pending_credential_cleanup(&store, &SecretStore)?;
    store.model_settings().map_err(Into::into)
}

#[tauri::command]
fn randomness_settings_get(
    store: State<'_, CampaignStore>,
) -> Result<RandomnessSettingsSnapshot, CommandError> {
    store.randomness_settings().map_err(Into::into)
}

#[tauri::command]
fn randomness_settings_save(
    command: RandomnessSettingsUpdate,
    store: State<'_, CampaignStore>,
) -> Result<RandomnessSettingsSnapshot, CommandError> {
    store.save_randomness_settings(command).map_err(Into::into)
}

#[tauri::command]
fn prompt_manager_get(
    store: State<'_, CampaignStore>,
) -> Result<PromptManagerSnapshot, CommandError> {
    store.prompt_manager().map_err(Into::into)
}

#[tauri::command]
fn prompt_preset_save(
    command: PromptPresetSaveCommand,
    store: State<'_, CampaignStore>,
) -> Result<PromptManagerSnapshot, CommandError> {
    store.save_prompt_preset(command).map_err(Into::into)
}

#[tauri::command]
fn prompt_preset_activate(
    command: PromptPresetActivateCommand,
    store: State<'_, CampaignStore>,
) -> Result<PromptManagerSnapshot, CommandError> {
    store.activate_prompt_preset(command).map_err(Into::into)
}

#[tauri::command]
fn prompt_preset_import(
    command: PromptPresetImportCommand,
    store: State<'_, CampaignStore>,
) -> Result<PromptManagerSnapshot, CommandError> {
    store.import_prompt_preset(command).map_err(Into::into)
}

#[tauri::command]
fn prompt_preset_export(
    preset_id: String,
    store: State<'_, CampaignStore>,
) -> Result<String, CommandError> {
    store.export_prompt_preset(&preset_id).map_err(Into::into)
}

#[tauri::command]
fn prompt_manager_reset(
    expected_revision: Option<u64>,
    store: State<'_, CampaignStore>,
) -> Result<PromptManagerSnapshot, CommandError> {
    store
        .reset_prompt_manager(expected_revision)
        .map_err(Into::into)
}

fn retry_pending_credential_cleanup(
    store: &CampaignStore,
    vault: &impl SecureVault,
) -> Result<(), CampaignStoreError> {
    for pending in store.pending_credential_cleanups()? {
        // Old databases, restored backups or a previously interrupted settings
        // flow may contain a stale cleanup row for a credential that is active
        // again. The SQLite reference is authoritative: never delete a secret
        // that a provider configuration still owns.
        if store.discard_cleanup_if_credential_active(&pending.credential_ref)? {
            continue;
        }
        let reference = pending
            .credential_ref
            .parse::<CredentialRef>()
            .map_err(|_| CampaignStoreError::InvalidData)?;
        if vault.delete(&reference).is_ok() {
            store.complete_credential_cleanup(&pending.credential_ref)?;
        } else {
            store.record_credential_cleanup_failure(&pending.credential_ref)?;
        }
    }
    Ok(())
}

#[tauri::command]
async fn provider_probe(
    input: ProviderProbeInput,
    probes: State<'_, ProviderProbeRegistry>,
) -> Result<ProviderProbeResult, CommandError> {
    let credential = input
        .credential_ref
        .map(|value| value.parse::<CredentialRef>())
        .transpose()
        .map_err(|_| ProviderError::InvalidConfig)?;
    let normalized_base_url = normalize_probe_url(&input.preset_key, input.base_url.as_deref())?;
    let config: OpenAiCompatibleConfig = match input.preset_key.as_str() {
        "deepseek" => DeepSeekPreset::config(credential.ok_or(ProviderError::InvalidConfig)?)?,
        "qwen" => QwenPreset::config(credential.ok_or(ProviderError::InvalidConfig)?)?,
        "openrouter" => OpenRouterPreset::config(credential.ok_or(ProviderError::InvalidConfig)?)?,
        "ollama" => OpenAiCompatibleConfig::new(&normalized_base_url, None)?,
        "custom" => OpenAiCompatibleConfig::new(&normalized_base_url, credential)?,
        _ => return Err(ProviderError::InvalidConfig.into()),
    };
    let checked_at = canonical_probe_timestamp(OffsetDateTime::now_utc());
    let preset_key = input.preset_key;
    let endpoint_fingerprint = model_endpoint_fingerprint(&preset_key, &normalized_base_url);
    let models = OpenAiCompatibleProvider::new()?
        .list_models(&config, CancellationToken::new())
        .await?
        .into_iter()
        .map(|model| {
            let preset = match preset_key.as_str() {
                "deepseek" => DeepSeekPreset::model(&model.name),
                "qwen" => QwenPreset::model(&model.name),
                _ => None,
            };
            let capability_source = if preset.is_some() {
                CapabilitySource::PresetMetadata
            } else if preset_key == "openrouter"
                && (model.supports_json_mode.is_some()
                    || model.context_window_tokens.is_some()
                    || model.cost_status != ModelCostStatus::Unknown)
            {
                CapabilitySource::ProviderResponse
            } else {
                CapabilitySource::Unknown
            };
            let capabilities = ModelCapabilitiesRegistration {
                text: true,
                streaming: matches!(
                    preset_key.as_str(),
                    "deepseek" | "qwen" | "openrouter" | "ollama"
                ),
                system_messages: true,
                json_mode: preset
                    .map(|value| value.json_mode)
                    .or(model.supports_json_mode)
                    .unwrap_or(false),
                json_schema: false,
                tool_calling: false,
                reasoning: preset.is_some_and(|value| value.reasoning),
                context_window_tokens: preset
                    .map(|value| value.context_window_tokens)
                    .or(model.context_window_tokens),
                cost_status: match model.cost_status {
                    ModelCostStatus::Free => "FREE".to_owned(),
                    ModelCostStatus::Paid => "PAID".to_owned(),
                    ModelCostStatus::Unknown => "UNKNOWN".to_owned(),
                },
                checked_at: checked_at.clone(),
            };
            let probe_fingerprint = model_probe_fingerprint(
                &endpoint_fingerprint,
                &model.name,
                capability_source,
                &capabilities,
            )?;
            let display_name =
                preset_display_name(&preset_key, &model.name).unwrap_or(model.display_name);
            Ok(ProviderProbeModel {
                name: model.name,
                display_name,
                capabilities,
                capability_source,
                probe_fingerprint,
            })
        })
        .collect::<Result<Vec<_>, CampaignStoreError>>()?;
    let receipt_id = probes.insert(StoredProbe {
        preset_key,
        normalized_base_url: normalized_base_url.clone(),
        endpoint_fingerprint: endpoint_fingerprint.clone(),
        models: models.clone(),
        created_at: Instant::now(),
    })?;
    Ok(ProviderProbeResult {
        receipt_id,
        normalized_base_url,
        endpoint_fingerprint,
        models,
    })
}

fn preset_display_name(preset_key: &str, model_name: &str) -> Option<String> {
    match preset_key {
        "deepseek" => DeepSeekPreset::model(model_name),
        "qwen" => QwenPreset::model(model_name),
        _ => None,
    }
    .map(|model| model.display_name.to_owned())
}

fn normalize_probe_url(preset_key: &str, supplied: Option<&str>) -> Result<String, ProviderError> {
    let canonical = match preset_key {
        "deepseek" => Some(DEEPSEEK_BASE_URL),
        "qwen" => Some(QWEN_BASE_URL),
        "openrouter" => Some(OPENROUTER_BASE_URL),
        "ollama" => None,
        "custom" => None,
        _ => return Err(ProviderError::InvalidConfig),
    };
    if let Some(canonical) = canonical {
        if supplied.is_some_and(|value| normalize_url(value) != canonical) {
            return Err(ProviderError::InvalidConfig);
        }
        return Ok(canonical.to_owned());
    }
    let supplied = supplied.or((preset_key == "ollama").then_some(OLLAMA_BASE_URL));
    let normalized = normalize_url(supplied.ok_or(ProviderError::InvalidConfig)?);
    OpenAiCompatibleConfig::new(&normalized, None)?;
    Ok(normalized)
}

fn normalize_url(value: &str) -> String {
    if value.ends_with('/') {
        value.to_owned()
    } else {
        format!("{value}/")
    }
}

fn canonical_probe_timestamp(value: OffsetDateTime) -> String {
    format!(
        "{:04}-{:02}-{:02}T{:02}:{:02}:{:02}.{:03}Z",
        value.year(),
        value.month() as u8,
        value.day(),
        value.hour(),
        value.minute(),
        value.second(),
        value.millisecond(),
    )
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
fn rules_state_get(
    player_character_id: String,
    store: State<'_, CampaignStore>,
) -> Result<CharacterRulesState, CommandError> {
    store
        .character_rules_state(&player_character_id)
        .map_err(Into::into)
}

#[tauri::command]
fn rules_apply(
    command: RulesApplyCommand,
    store: State<'_, CampaignStore>,
) -> Result<RulesCommitReceipt, CommandError> {
    store.apply_rules_command(command).map_err(Into::into)
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
    let task_name = match command.task {
        ember_native_bridge::WorldGenerationTask::GenerateWorld => "GENERATE_WORLD",
        ember_native_bridge::WorldGenerationTask::RefineWorld => "REFINE_WORLD",
    };
    let expected_world = serde_json::to_value(&command.world).map_err(|_| CommandError {
        code: "WORLD_COMMIT_OUTPUT_MISMATCH",
        message: "世界候选无法转换为可提交的数据。",
    })?;
    let output_world = if task_name == "GENERATE_WORLD" {
        Some(&command.validated_output)
    } else {
        command
            .validated_output
            .as_object()
            .and_then(|output| output.get("world"))
    };
    if output_world != Some(&expected_world) {
        return Err(CommandError {
            code: "WORLD_COMMIT_OUTPUT_MISMATCH",
            message: "世界候选与已验证模型输出不一致。",
        });
    }
    if command
        .request
        .as_object()
        .and_then(|request| request.get("task"))
        .and_then(serde_json::Value::as_str)
        != Some(task_name)
        || !command.input.is_object()
    {
        return Err(CommandError {
            code: "WORLD_COMMIT_ENVELOPE_INVALID",
            message: "世界生成请求与提交任务不一致。",
        });
    }
    store
        .commit_world_generation(command)
        .map_err(|error| match error {
            CampaignStoreError::InvalidData => CommandError {
                code: "WORLD_BUSINESS_RULE_INVALID",
                message: "世界候选没有通过本地业务规则。",
            },
            other => other.into(),
        })
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
fn character_candidate_confirm(
    command: CharacterCandidateConfirm,
    store: State<'_, CampaignStore>,
) -> Result<CharacterCreationSnapshot, CommandError> {
    store
        .confirm_character_candidate(command)
        .map_err(Into::into)
}

#[tauri::command]
fn universal_character_creation_get(
    id: String,
    store: State<'_, CampaignStore>,
) -> Result<UniversalCharacterCreationSnapshot, CommandError> {
    store
        .universal_character_creation_snapshot(&id)
        .map_err(Into::into)
}

#[tauri::command]
fn career_pool_generation_commit(
    command: CareerPoolGenerationCommit,
    store: State<'_, CampaignStore>,
) -> Result<CareerPool, CommandError> {
    store
        .commit_career_pool_generation(command)
        .map_err(Into::into)
}

#[tauri::command]
fn npc_lod_seed(
    command: NpcLodSeedCommand,
    store: State<'_, CampaignStore>,
) -> Result<NpcLodGenerationSnapshot, CommandError> {
    store.create_npc_lod_seed(command).map_err(Into::into)
}

#[tauri::command]
fn npc_lod_get(
    campaign_id: String,
    npc_id: String,
    store: State<'_, CampaignStore>,
) -> Result<NpcLodGenerationSnapshot, CommandError> {
    store
        .npc_lod_generation_snapshot(&campaign_id, &npc_id)
        .map_err(Into::into)
}

#[tauri::command]
fn npc_lod_upgrade_commit(
    command: NpcLodUpgradeCommit,
    store: State<'_, CampaignStore>,
) -> Result<NpcLodGenerationSnapshot, CommandError> {
    store.commit_npc_lod_upgrade(command).map_err(Into::into)
}

#[tauri::command]
fn dynamic_locations_get(
    campaign_id: String,
    store: State<'_, CampaignStore>,
) -> Result<DynamicLocationSnapshot, CommandError> {
    store
        .dynamic_location_snapshot(&campaign_id)
        .map_err(Into::into)
}

#[tauri::command]
fn dynamic_locations_generation_get(
    command: DynamicLocationGenerationRequest,
    store: State<'_, CampaignStore>,
) -> Result<DynamicLocationGenerationSnapshot, CommandError> {
    store
        .dynamic_location_generation_snapshot(command)
        .map_err(Into::into)
}

#[tauri::command]
fn dynamic_locations_generation_commit(
    command: DynamicLocationGenerationCommit,
    store: State<'_, CampaignStore>,
) -> Result<DynamicLocationSnapshot, CommandError> {
    store
        .commit_dynamic_location_generation(command)
        .map_err(Into::into)
}

#[tauri::command]
fn dynamic_locations_travel(
    command: DynamicLocationTravelCommand,
    store: State<'_, CampaignStore>,
) -> Result<DynamicLocationSnapshot, CommandError> {
    store.travel_dynamic_location(command).map_err(Into::into)
}

#[tauri::command]
fn active_factions_get(
    campaign_id: String,
    store: State<'_, CampaignStore>,
) -> Result<ActiveFactionSnapshot, CommandError> {
    store
        .active_faction_snapshot(&campaign_id)
        .map_err(Into::into)
}

#[tauri::command]
fn active_factions_generation_get(
    command: ActiveFactionGenerationRequest,
    store: State<'_, CampaignStore>,
) -> Result<ActiveFactionGenerationSnapshot, CommandError> {
    store
        .active_faction_generation_snapshot(command)
        .map_err(Into::into)
}

#[tauri::command]
fn active_factions_generation_commit(
    command: ActiveFactionGenerationCommit,
    store: State<'_, CampaignStore>,
) -> Result<ActiveFactionSnapshot, CommandError> {
    store
        .commit_active_faction_generation(command)
        .map_err(Into::into)
}

#[tauri::command]
fn active_factions_action_apply(
    command: FactionActionCommand,
    store: State<'_, CampaignStore>,
) -> Result<ActiveFactionSnapshot, CommandError> {
    store.apply_faction_action(command).map_err(Into::into)
}

#[tauri::command]
fn tavern_population_get(
    campaign_id: String,
    store: State<'_, CampaignStore>,
) -> Result<TavernPopulationSnapshot, CommandError> {
    store
        .tavern_population_snapshot(&campaign_id)
        .map_err(Into::into)
}

#[tauri::command]
fn tavern_population_project(
    command: TavernPopulationProjectCommand,
    store: State<'_, CampaignStore>,
) -> Result<TavernPopulationSnapshot, CommandError> {
    store.project_tavern_population(command).map_err(Into::into)
}

#[tauri::command]
fn tavern_population_focus(
    command: TavernPopulationFocusCommand,
    store: State<'_, CampaignStore>,
) -> Result<TavernPopulationSnapshot, CommandError> {
    store.focus_tavern_population(command).map_err(Into::into)
}

#[tauri::command]
fn tavern_scene_get(
    campaign_id: String,
    scene_id: String,
    store: State<'_, CampaignStore>,
) -> Result<TavernSceneSnapshot, CommandError> {
    store
        .tavern_scene_snapshot(&campaign_id, &scene_id)
        .map_err(Into::into)
}

#[tauri::command]
fn tavern_scene_start(
    command: TavernSceneStart,
    store: State<'_, CampaignStore>,
) -> Result<TavernSceneSnapshot, CommandError> {
    store.start_tavern_scene(command).map_err(Into::into)
}

#[tauri::command]
fn tavern_scene_turn_prepare(
    command: TavernScenePrepare,
    store: State<'_, CampaignStore>,
) -> Result<TavernSceneGenerationRequest, CommandError> {
    store.prepare_tavern_scene_turn(command).map_err(Into::into)
}

#[tauri::command]
fn tavern_scene_turn_commit(
    command: TavernSceneCommit,
    store: State<'_, CampaignStore>,
) -> Result<TavernSceneSnapshot, CommandError> {
    store.commit_tavern_scene_turn(command).map_err(Into::into)
}

#[tauri::command]
fn npc_timeline_get(
    campaign_id: String,
    scope_kind: String,
    scope_id: String,
    store: State<'_, CampaignStore>,
) -> Result<Option<NpcTimelineOperation>, CommandError> {
    store
        .latest_npc_timeline(&campaign_id, &scope_kind, &scope_id)
        .map_err(Into::into)
}

#[tauri::command]
fn npc_timeline_begin(
    command: NpcTimelineBegin,
    store: State<'_, CampaignStore>,
) -> Result<NpcTimelineOperation, CommandError> {
    store
        .begin_npc_timeline_attempt(command)
        .map_err(Into::into)
}

#[tauri::command]
fn npc_timeline_fail(
    command: NpcTimelineFail,
    store: State<'_, CampaignStore>,
) -> Result<NpcTimelineOperation, CommandError> {
    store.fail_npc_timeline_attempt(command).map_err(Into::into)
}

#[tauri::command]
fn universal_character_creation_start(
    command: UniversalCharacterCreationStart,
    store: State<'_, CampaignStore>,
) -> Result<UniversalCharacterCreationSnapshot, CommandError> {
    store
        .start_universal_character_creation(command)
        .map_err(Into::into)
}

#[tauri::command]
fn universal_character_creation_save(
    command: UniversalCharacterCreationSave,
    store: State<'_, CampaignStore>,
) -> Result<UniversalCharacterCreationSnapshot, CommandError> {
    store
        .save_universal_character_creation(command)
        .map_err(Into::into)
}

#[tauri::command]
fn universal_character_quick_commit(
    command: UniversalCharacterQuickCommit,
    store: State<'_, CampaignStore>,
) -> Result<UniversalCharacterCreationSnapshot, CommandError> {
    store
        .commit_universal_quick_character(command)
        .map_err(Into::into)
}

#[tauri::command]
fn universal_character_creation_confirm(
    command: UniversalCharacterCreationConfirm,
    store: State<'_, CampaignStore>,
) -> Result<UniversalCharacterCreationSnapshot, CommandError> {
    store
        .confirm_universal_character_creation(command)
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
fn dialogue_suggestions_prepare(
    command: DialogueSuggestionPrepareCommand,
    store: State<'_, CampaignStore>,
) -> Result<DialogueSuggestionPreparation, CommandError> {
    store
        .prepare_dialogue_suggestions(command)
        .map_err(Into::into)
}

#[tauri::command]
fn dialogue_suggestions_commit(
    command: DialogueSuggestionCommit,
    store: State<'_, CampaignStore>,
) -> Result<DialogueSuggestionSet, CommandError> {
    store
        .commit_dialogue_suggestions(command)
        .map_err(Into::into)
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
fn dynamic_quest_prepare(
    command: DynamicQuestPrepareCommand,
    store: State<'_, CampaignStore>,
) -> Result<DynamicQuestPreparation, CommandError> {
    store.prepare_dynamic_quest(command).map_err(Into::into)
}

#[tauri::command]
fn dynamic_quest_commit(
    command: DynamicQuestCommitCommand,
    store: State<'_, CampaignStore>,
) -> Result<QuestBoardSnapshot, CommandError> {
    store.commit_dynamic_quest(command).map_err(Into::into)
}

#[tauri::command]
fn world_director_prepare(
    command: WorldDirectorPrepareCommand,
    store: State<'_, CampaignStore>,
) -> Result<WorldDirectorPreparation, CommandError> {
    store.prepare_world_director(command).map_err(Into::into)
}

#[tauri::command]
fn world_director_commit(
    command: WorldDirectorCommitCommand,
    store: State<'_, CampaignStore>,
) -> Result<WorldDirectorRun, CommandError> {
    store.commit_world_director(command).map_err(Into::into)
}

#[tauri::command]
fn world_director_history(
    campaign_id: String,
    limit: usize,
    store: State<'_, CampaignStore>,
) -> Result<Vec<WorldDirectorRun>, CommandError> {
    store
        .world_director_history(&campaign_id, limit)
        .map_err(Into::into)
}

#[tauri::command]
fn director_budget_admit(
    command: DirectorBudgetAdmitCommand,
    store: State<'_, CampaignStore>,
) -> Result<DirectorBudgetSnapshot, CommandError> {
    store.admit_director_budget(command).map_err(Into::into)
}

#[tauri::command]
fn director_budget_get(
    campaign_id: String,
    store: State<'_, CampaignStore>,
) -> Result<Option<DirectorBudgetSnapshot>, CommandError> {
    store
        .director_budget_snapshot(&campaign_id)
        .map_err(Into::into)
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
fn quest_pool_transition(
    command: QuestPoolTransitionCommand,
    store: State<'_, CampaignStore>,
) -> Result<QuestBoardSnapshot, CommandError> {
    store.transition_quest_pool(command).map_err(Into::into)
}

#[tauri::command]
fn quest_graph_get(
    campaign_id: String,
    store: State<'_, CampaignStore>,
) -> Result<QuestGraphSnapshot, CommandError> {
    store
        .quest_board_snapshot(&campaign_id)
        .map(|snapshot| snapshot.graph)
        .map_err(Into::into)
}

#[tauri::command]
fn quest_graph_replace(
    command: QuestGraphReplaceCommand,
    store: State<'_, CampaignStore>,
) -> Result<QuestGraphSnapshot, CommandError> {
    store.replace_quest_graph(command).map_err(Into::into)
}

#[tauri::command]
fn quest_graph_evaluate(
    command: QuestGraphEvaluateCommand,
    store: State<'_, CampaignStore>,
) -> Result<QuestGraphSnapshot, CommandError> {
    store.evaluate_quest_graph(command).map_err(Into::into)
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
fn secret_save(secret: String, store: State<'_, CampaignStore>) -> Result<String, String> {
    let reference = SecretStore
        .save(secret)
        .map_err(|error| error.to_string())?;
    if let Err(error) = store.enqueue_credential_cleanup(
        reference.expose_reference(),
        CredentialCleanupReason::Rollback,
    ) {
        let _ = SecretStore.delete(&reference);
        return Err(error.to_string());
    }
    Ok(reference.to_string())
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
fn secret_delete(credential_ref: String, store: State<'_, CampaignStore>) -> Result<(), String> {
    let reference = credential_ref
        .parse::<CredentialRef>()
        .map_err(|error| error.to_string())?;
    if let Err(error) = SecretStore.delete(&reference) {
        store
            .enqueue_credential_cleanup(
                reference.expose_reference(),
                CredentialCleanupReason::Transient,
            )
            .map_err(|queue_error| queue_error.to_string())?;
        return Err(error.to_string());
    }
    store
        .complete_credential_cleanup(reference.expose_reference())
        .map_err(|error| error.to_string())
}

#[tauri::command]
fn secret_health() -> Result<(), String> {
    SecretStore
        .health_check()
        .map_err(|error| error.to_string())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .setup(|app| {
            let database_path = platform_paths::database_path(app)?;
            let instance_lock =
                FileAppInstanceLock::new(platform_paths::instance_lock_path(&database_path))?;
            let instance_guard = instance_lock.try_acquire()?;
            let store = CampaignStore::open(database_path)?;
            retry_pending_credential_cleanup(&store, &SecretStore)?;
            app.manage(instance_guard);
            app.manage(store);
            app.manage(ProviderProbeRegistry::default());
            app.manage(AiStreamRegistry::default());
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
            rules_state_get,
            rules_apply,
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
            character_candidate_confirm,
            universal_character_creation_get,
            career_pool_generation_commit,
            npc_lod_seed,
            npc_lod_get,
            npc_lod_upgrade_commit,
            dynamic_locations_get,
            dynamic_locations_generation_get,
            dynamic_locations_generation_commit,
            dynamic_locations_travel,
            active_factions_get,
            active_factions_generation_get,
            active_factions_generation_commit,
            active_factions_action_apply,
            tavern_population_get,
            tavern_population_project,
            tavern_population_focus,
            tavern_scene_get,
            tavern_scene_start,
            tavern_scene_turn_prepare,
            tavern_scene_turn_commit,
            npc_timeline_get,
            npc_timeline_begin,
            npc_timeline_fail,
            universal_character_creation_start,
            universal_character_creation_save,
            universal_character_quick_commit,
            universal_character_creation_confirm,
            tavern_get,
            tavern_generation_commit,
            tavern_npcs_commit,
            npc_dialogue_get,
            npc_dialogue_commit,
            dialogue_suggestions_prepare,
            dialogue_suggestions_commit,
            quest_board_get,
            quest_generation_commit,
            dynamic_quest_prepare,
            dynamic_quest_commit,
            world_director_prepare,
            world_director_commit,
            world_director_history,
            director_budget_admit,
            director_budget_get,
            quest_accept,
            quest_pool_transition,
            quest_graph_get,
            quest_graph_replace,
            quest_graph_evaluate,
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
            secret_health,
            model_settings_get,
            model_settings_save,
            model_settings_forget_credential,
            ai_generate,
            ai_generate_stream,
            ai_stream_cancel,
            randomness_settings_get,
            randomness_settings_save,
            prompt_manager_get,
            prompt_preset_save,
            prompt_preset_activate,
            prompt_preset_import,
            prompt_preset_export,
            prompt_manager_reset,
            provider_probe
        ])
        .run(tauri::generate_context!())
        .expect("failed to run Ember Tavern");
}

#[cfg(test)]
mod tests {
    use super::*;
    use ember_secure_secrets::SecretStoreError;
    use std::io::{Read, Write};
    use std::net::TcpListener;
    use time::format_description::well_known::Rfc3339;

    #[test]
    fn cache_telemetry_failure_is_observable_but_does_not_replace_generation() {
        let directory = tempfile::tempdir().unwrap();
        let store = CampaignStore::open(directory.path().join("telemetry.sqlite")).unwrap();
        assert_eq!(
            record_cache_metric_best_effort(
                &store,
                "deepseek",
                "UNKNOWN_TASK",
                Some(1),
                Some(1),
                &"a".repeat(64),
                "2026-08-12T00:00:00Z",
            ),
            Some(false)
        );
    }

    struct DeleteVault {
        fail: bool,
    }

    struct RealCredentialCleanup(CredentialRef);

    impl Drop for RealCredentialCleanup {
        fn drop(&mut self) {
            let _ = SecretStore.delete(&self.0);
        }
    }

    impl SecureVault for DeleteVault {
        fn save(&self, _: String) -> Result<CredentialRef, SecretStoreError> {
            Err(SecretStoreError::Unavailable)
        }

        fn exists(&self, _: &CredentialRef) -> Result<bool, SecretStoreError> {
            Err(SecretStoreError::Unavailable)
        }

        fn delete(&self, _: &CredentialRef) -> Result<(), SecretStoreError> {
            if self.fail {
                Err(SecretStoreError::Unavailable)
            } else {
                Ok(())
            }
        }

        fn health_check(&self) -> Result<(), SecretStoreError> {
            Ok(())
        }
    }

    #[test]
    fn provider_command_errors_keep_actionable_standard_codes() {
        for (source, expected) in [
            (ProviderError::QuotaExceeded, "QUOTA_EXCEEDED"),
            (ProviderError::Authentication, "AUTHENTICATION_FAILED"),
            (ProviderError::RateLimited, "RATE_LIMITED"),
            (ProviderError::Timeout, "TIMEOUT"),
            (ProviderError::Cancelled, "CANCELLED"),
            (ProviderError::ModelNotFound, "MODEL_NOT_FOUND"),
            (ProviderError::InvalidResponse, "INVALID_OUTPUT"),
            (ProviderError::Network, "NETWORK_FAILED"),
        ] {
            let command_error = CommandError::from(source);
            assert_eq!(command_error.code, expected);
            assert!(!command_error.message.is_empty());
        }
    }

    #[test]
    fn stream_registry_handles_active_and_pre_dispatch_cancellation() {
        let registry = AiStreamRegistry::default();
        let active = registry.register("stream-active").unwrap();
        assert!(!active.is_cancelled());
        assert!(registry.cancel("stream-active").unwrap());
        assert!(active.is_cancelled());
        registry.remove("stream-active");

        assert!(registry.cancel("stream-race").unwrap());
        let error = registry.register("stream-race").unwrap_err();
        assert_eq!(error.code, "CANCELLED");
        assert!(registry.register("stream-race").is_ok());
    }

    #[test]
    fn command_errors_serialize_the_six_kind_policy_without_unsafe_fallbacks() {
        #[derive(Deserialize)]
        #[serde(rename_all = "camelCase")]
        struct ErrorFixture {
            code: String,
            kind: String,
            retryable: bool,
            fallback_eligible: bool,
            surface: String,
            actions: Vec<String>,
        }
        let fixtures: Vec<ErrorFixture> = serde_json::from_str(include_str!(
            "../../../packages/ai-core/src/application-error-contract.fixture.json"
        ))
        .unwrap();
        assert_eq!(fixtures.len(), 6);
        for fixture in fixtures {
            let policy = command_error_policy(&fixture.code);
            assert_eq!(policy.kind, fixture.kind);
            assert_eq!(policy.retryable, fixture.retryable);
            assert_eq!(policy.fallback_eligible, fixture.fallback_eligible);
            assert_eq!(policy.surface, fixture.surface);
            assert_eq!(policy.actions, fixture.actions);
        }

        let serialized = serde_json::to_value(CommandError {
            code: "NETWORK_FAILED",
            message: "安全错误说明",
        })
        .unwrap();
        assert_eq!(serialized["kind"], "NETWORK");
        assert_eq!(serialized["actions"][2], "USE_FALLBACK");

        for code in [
            "AUTHENTICATION_FAILED",
            "QUOTA_EXCEEDED",
            "INVALID_OUTPUT",
            "WORLD_BUSINESS_RULE_INVALID",
            "LOCAL_STORAGE_UNAVAILABLE",
        ] {
            assert!(!command_error_policy(code).fallback_eligible);
        }
    }

    #[test]
    fn concurrent_destructive_write_has_a_retryable_command_error() {
        let error = CommandError::from(CampaignStoreError::ConcurrentModification);
        assert_eq!(error.code, "CONCURRENT_MODIFICATION");
        assert!(error.message.contains("取消"));
    }

    #[test]
    fn fixed_presets_reject_endpoint_substitution() {
        assert_eq!(
            normalize_probe_url("deepseek", Some(DEEPSEEK_BASE_URL)).unwrap(),
            DEEPSEEK_BASE_URL
        );
        assert!(normalize_probe_url("deepseek", Some("https://attacker.invalid/v1/")).is_err());
    }

    #[test]
    fn preset_probe_uses_the_same_canonical_display_name_as_the_settings_ui() {
        assert_eq!(
            preset_display_name("deepseek", "deepseek-v4-flash").as_deref(),
            Some("DeepSeek-V4-Flash-0731")
        );
        assert_eq!(
            preset_display_name("qwen", "qwen3.7-plus").as_deref(),
            Some("Qwen 3.7 Plus")
        );
        assert_eq!(preset_display_name("custom", "custom-model"), None);
    }

    #[test]
    fn probe_timestamp_matches_the_frontend_canonical_iso_contract() {
        let timestamp = OffsetDateTime::parse("2026-08-12T10:01:28.700286Z", &Rfc3339).unwrap();

        assert_eq!(
            canonical_probe_timestamp(timestamp),
            "2026-08-12T10:01:28.700Z"
        );
    }

    #[tokio::test]
    async fn native_generation_uses_saved_default_model_and_rejects_model_drift() {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let base_url = format!("http://{}/v1/", listener.local_addr().unwrap());
        let server = std::thread::spawn(move || {
            let (mut socket, _) = listener.accept().unwrap();
            let mut request = Vec::new();
            let mut buffer = [0_u8; 4096];
            let header_end = loop {
                let read = socket.read(&mut buffer).unwrap();
                assert_ne!(read, 0);
                request.extend_from_slice(&buffer[..read]);
                if let Some(position) = request.windows(4).position(|part| part == b"\r\n\r\n") {
                    break position + 4;
                }
            };
            let content_length = String::from_utf8_lossy(&request[..header_end])
                .lines()
                .find_map(|line| {
                    line.strip_prefix("content-length: ")
                        .or_else(|| line.strip_prefix("Content-Length: "))
                })
                .and_then(|value| value.trim().parse::<usize>().ok())
                .unwrap();
            while request.len() - header_end < content_length {
                let read = socket.read(&mut buffer).unwrap();
                assert_ne!(read, 0);
                request.extend_from_slice(&buffer[..read]);
            }
            let request_text = String::from_utf8_lossy(&request[header_end..]);
            assert!(request_text.contains("runtime-model"));
            let body = serde_json::json!({
                "id": "native-runtime-request",
                "model": "runtime-model",
                "choices": [{
                    "message": { "content": "{\"status\":\"ok\"}" },
                    "finish_reason": "stop"
                }],
                "usage": { "prompt_tokens": 10, "completion_tokens": 4, "total_tokens": 14 }
            })
            .to_string();
            let response = format!(
                "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",
                body.len()
            );
            socket.write_all(response.as_bytes()).unwrap();
        });
        let directory = tempfile::tempdir().unwrap();
        let store = CampaignStore::open(directory.path().join("native-runtime.sqlite")).unwrap();
        let capabilities = ModelCapabilitiesRegistration {
            text: true,
            streaming: false,
            system_messages: true,
            json_mode: true,
            json_schema: false,
            tool_calling: false,
            reasoning: false,
            context_window_tokens: Some(8192),
            cost_status: "UNKNOWN".to_owned(),
            checked_at: "2026-08-12T00:00:00Z".to_owned(),
        };
        let endpoint = model_endpoint_fingerprint("custom", &base_url);
        let probe = model_probe_fingerprint(
            &endpoint,
            "runtime-model",
            CapabilitySource::Unknown,
            &capabilities,
        )
        .unwrap();
        let saved = store
            .save_model_settings(ModelSettingsUpdate {
                preset_key: "custom".to_owned(),
                provider_display_name: "Runtime provider".to_owned(),
                base_url: Some(base_url),
                endpoint_fingerprint: endpoint,
                credential_ref: None,
                credential_action: CredentialAction::Keep,
                model_name: "runtime-model".to_owned(),
                model_display_name: "Runtime Model".to_owned(),
                capabilities,
                capability_source: CapabilitySource::Unknown,
                probe_fingerprint: probe,
                probe_receipt_id: Uuid::new_v4().to_string(),
                use_as_default: true,
                use_as_fallback: false,
            })
            .unwrap();
        let profile_id = saved.default_model_profile_id.clone().unwrap();
        let request = runtime_test_request(&profile_id, "runtime-model");
        let response = execute_ai_generate(request, &store).await.unwrap();
        assert_eq!(response.model_name, "runtime-model");
        assert_eq!(response.selected_profile_id, profile_id);
        assert_eq!(response.selected_preset_key, "custom");
        server.join().unwrap();

        let error = execute_ai_generate(runtime_test_request(&profile_id, "forged-model"), &store)
            .await
            .unwrap_err();
        assert_eq!(error.code, "MODEL_SELECTION_DRIFT");
    }

    #[tokio::test]
    async fn credential_survives_the_full_game_generation_chain_cleanup_and_reopen() {
        const TASKS: &[&str] = &[
            "GENERATE_WORLD",
            "COMPLETE_CHARACTER_BACKGROUND",
            "GENERATE_NPCS",
            "NPC_REPLY",
            "GENERATE_QUEST",
            "GENERATE_ADVENTURE_PLAN",
            "GENERATE_ADVENTURE_TURN",
            "RESOLVE_DICE_RESULT",
            "SUMMARIZE_ADVENTURE",
        ];

        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let base_url = format!("http://{}/v1/", listener.local_addr().unwrap());
        let runtime_secret = format!("runtime-{}", Uuid::new_v4());
        let expected_secret = runtime_secret.clone();
        let server = std::thread::spawn(move || {
            for index in 0..TASKS.len() {
                let (mut socket, _) = listener.accept().unwrap();
                let mut request = Vec::new();
                let mut buffer = [0_u8; 4096];
                let header_end = loop {
                    let read = socket.read(&mut buffer).unwrap();
                    assert_ne!(read, 0);
                    request.extend_from_slice(&buffer[..read]);
                    if let Some(position) = request.windows(4).position(|part| part == b"\r\n\r\n")
                    {
                        break position + 4;
                    }
                };
                let headers = String::from_utf8_lossy(&request[..header_end]);
                let normalized_headers = headers.to_ascii_lowercase();
                assert!(normalized_headers.contains(&format!(
                    "authorization: bearer {}",
                    expected_secret.to_ascii_lowercase()
                )));
                let content_length = headers
                    .lines()
                    .find_map(|line| {
                        line.to_ascii_lowercase()
                            .strip_prefix("content-length: ")
                            .and_then(|value| value.trim().parse::<usize>().ok())
                    })
                    .unwrap();
                while request.len() - header_end < content_length {
                    let read = socket.read(&mut buffer).unwrap();
                    assert_ne!(read, 0);
                    request.extend_from_slice(&buffer[..read]);
                }
                let body = serde_json::json!({
                    "id": format!("credential-lifecycle-{index}"),
                    "model": "lifecycle-model",
                    "choices": [{
                        "message": { "content": "{\"status\":\"ok\"}" },
                        "finish_reason": "stop"
                    }],
                    "usage": { "prompt_tokens": 10, "completion_tokens": 4, "total_tokens": 14 }
                })
                .to_string();
                let response = format!(
                    "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",
                    body.len()
                );
                socket.write_all(response.as_bytes()).unwrap();
            }
        });

        let directory = tempfile::tempdir().unwrap();
        let database_path = directory.path().join("credential-game-lifecycle.sqlite");
        let reference = SecretStore.save(runtime_secret).unwrap();
        let cleanup = RealCredentialCleanup(reference.clone());
        let mut store = CampaignStore::open(&database_path).unwrap();
        store
            .enqueue_credential_cleanup(
                reference.expose_reference(),
                CredentialCleanupReason::Rollback,
            )
            .unwrap();
        let capabilities = ModelCapabilitiesRegistration {
            text: true,
            streaming: false,
            system_messages: true,
            json_mode: true,
            json_schema: false,
            tool_calling: false,
            reasoning: false,
            context_window_tokens: Some(8192),
            cost_status: "UNKNOWN".to_owned(),
            checked_at: "2026-08-13T00:00:00Z".to_owned(),
        };
        let endpoint = model_endpoint_fingerprint("custom", &base_url);
        let probe = model_probe_fingerprint(
            &endpoint,
            "lifecycle-model",
            CapabilitySource::Unknown,
            &capabilities,
        )
        .unwrap();
        let saved = store
            .save_model_settings(ModelSettingsUpdate {
                preset_key: "custom".to_owned(),
                provider_display_name: "Credential lifecycle provider".to_owned(),
                base_url: Some(base_url),
                endpoint_fingerprint: endpoint,
                credential_ref: Some(reference.to_string()),
                credential_action: CredentialAction::Replace,
                model_name: "lifecycle-model".to_owned(),
                model_display_name: "Lifecycle Model".to_owned(),
                capabilities,
                capability_source: CapabilitySource::Unknown,
                probe_fingerprint: probe,
                probe_receipt_id: Uuid::new_v4().to_string(),
                use_as_default: true,
                use_as_fallback: false,
            })
            .unwrap();
        let profile_id = saved.default_model_profile_id.unwrap();
        assert!(store.pending_credential_cleanups().unwrap().is_empty());

        for (index, task) in TASKS.iter().enumerate() {
            if index == 3 {
                // Simulate a stale cleanup row left by an older build or restore.
                store
                    .enqueue_credential_cleanup(
                        reference.expose_reference(),
                        CredentialCleanupReason::Transient,
                    )
                    .unwrap();
                retry_pending_credential_cleanup(&store, &SecretStore).unwrap();
                assert!(store.pending_credential_cleanups().unwrap().is_empty());
                assert!(SecretStore.exists(&reference).unwrap());
            }
            if index == 5 {
                drop(store);
                store = CampaignStore::open(&database_path).unwrap();
                retry_pending_credential_cleanup(&store, &SecretStore).unwrap();
            }
            let mut request = runtime_test_request(&profile_id, "lifecycle-model");
            request.request_id = format!("credential-lifecycle-{index}");
            request.task = (*task).to_owned();
            let response = execute_ai_generate(request, &store).await.unwrap();
            assert_eq!(response.selected_profile_id, profile_id);
            assert!(SecretStore.exists(&reference).unwrap());
            assert_eq!(
                store
                    .default_model_runtime_config()
                    .unwrap()
                    .credential_ref
                    .as_deref(),
                Some(reference.expose_reference())
            );
        }
        server.join().unwrap();
        drop(store);

        let reopened = CampaignStore::open(database_path).unwrap();
        retry_pending_credential_cleanup(&reopened, &SecretStore).unwrap();
        assert!(reopened.model_settings().unwrap().profiles[0].has_credential);
        assert!(SecretStore.exists(&reference).unwrap());
        drop(reopened);
        drop(cleanup);
        assert!(!SecretStore.exists(&reference).unwrap());
    }

    #[tokio::test]
    #[ignore = "requires an explicitly authorized DeepSeek API key in an environment variable"]
    async fn real_deepseek_runtime_verifies_selection_cache_and_reopen() {
        let secret = std::env::var("EMBER_TAVERN_DEEPSEEK_API_KEY")
            .expect("EMBER_TAVERN_DEEPSEEK_API_KEY is required for the ignored real-provider test");
        let reference = SecretStore.save(secret).unwrap();
        let cleanup = RealCredentialCleanup(reference.clone());
        let provider = OpenAiCompatibleProvider::new().unwrap();
        let config = DeepSeekPreset::config(reference.clone()).unwrap();
        let models = provider
            .list_models(&config, CancellationToken::new())
            .await
            .unwrap();
        assert!(models.iter().any(|model| model.name == "deepseek-v4-flash"));

        let directory = tempfile::tempdir().unwrap();
        let database_path = directory.path().join("real-deepseek.sqlite");
        let store = CampaignStore::open(&database_path).unwrap();
        let capabilities = ModelCapabilitiesRegistration {
            text: true,
            streaming: false,
            system_messages: true,
            json_mode: true,
            json_schema: false,
            tool_calling: false,
            reasoning: true,
            context_window_tokens: Some(1_048_576),
            cost_status: "PAID".to_owned(),
            checked_at: OffsetDateTime::now_utc().format(&Rfc3339).unwrap(),
        };
        let endpoint = model_endpoint_fingerprint("deepseek", DEEPSEEK_BASE_URL);
        let probe = model_probe_fingerprint(
            &endpoint,
            "deepseek-v4-flash",
            CapabilitySource::PresetMetadata,
            &capabilities,
        )
        .unwrap();
        let saved = store
            .save_model_settings(ModelSettingsUpdate {
                preset_key: "deepseek".to_owned(),
                provider_display_name: "DeepSeek real verification".to_owned(),
                base_url: Some(DEEPSEEK_BASE_URL.to_owned()),
                endpoint_fingerprint: endpoint,
                credential_ref: Some(reference.to_string()),
                credential_action: CredentialAction::Replace,
                model_name: "deepseek-v4-flash".to_owned(),
                model_display_name: "DeepSeek-V4-Flash-0731".to_owned(),
                capabilities,
                capability_source: CapabilitySource::PresetMetadata,
                probe_fingerprint: probe,
                probe_receipt_id: Uuid::new_v4().to_string(),
                use_as_default: true,
                use_as_fallback: false,
            })
            .unwrap();
        let profile_id = saved.default_model_profile_id.unwrap();
        let stable_system = [
            "你是 Ember Tavern 的 NPC 演员。只输出一个 JSON 对象，不得使用 Markdown。",
            "保持角色一致，不改写本地游戏状态，不泄露隐藏事实，不索取或复述任何凭据。",
            "JSON 必须且只能包含 reply、mood、suggestedTopics、memoryCandidate、relationshipProposal。",
            "reply、mood、suggestedTopics 与 memoryCandidate 使用自然简体中文。relationshipProposal 使用空对象。",
            "角色：岚灯酒馆的守门人苏槿，谨慎、诚实、熟悉潮汐与旧灯塔，但不知道密室内发生的事。",
        ]
        .join("\n");
        let first = execute_ai_generate(
            real_runtime_request(
                &profile_id,
                "我想先查看灯塔门上的潮痕。",
                &stable_system,
                "one",
            ),
            &store,
        )
        .await
        .unwrap();
        std::thread::sleep(Duration::from_secs(2));
        let second = execute_ai_generate(
            real_runtime_request(
                &profile_id,
                "我改为询问昨夜是谁守门。",
                &stable_system,
                "two",
            ),
            &store,
        )
        .await
        .unwrap();
        for response in [&first, &second] {
            let output: serde_json::Value = serde_json::from_str(&response.content).unwrap();
            assert!(
                output["reply"]
                    .as_str()
                    .is_some_and(|value| !value.is_empty())
            );
            assert!(output["suggestedTopics"].as_array().is_some());
            assert_eq!(response.model_name, "deepseek-v4-flash");
            assert_eq!(response.selected_profile_id, profile_id);
        }
        assert_ne!(first.content, second.content);
        let metrics = store.deepseek_cache_metrics().unwrap();
        assert_eq!(metrics.len(), 2);
        assert_eq!(metrics[0].prefix_hash, metrics[1].prefix_hash);
        assert!(metrics[1].prompt_cache_hit_tokens > 0);
        let safe_metrics = metrics
            .iter()
            .map(|metric| {
                (
                    metric.prompt_cache_hit_tokens,
                    metric.prompt_cache_miss_tokens,
                    metric.hit_ratio,
                )
            })
            .collect::<Vec<_>>();
        eprintln!("real DeepSeek cache metrics: {safe_metrics:?}");
        drop(store);

        let reopened = CampaignStore::open(database_path).unwrap();
        let runtime = reopened.default_model_runtime_config().unwrap();
        assert_eq!(runtime.model_name, "deepseek-v4-flash");
        assert_eq!(reopened.deepseek_cache_metrics().unwrap().len(), 2);
        drop(cleanup);
        assert!(!SecretStore.exists(&reference).unwrap());
    }

    fn real_runtime_request(
        profile_id: &str,
        player_input: &str,
        stable_system: &str,
        suffix: &str,
    ) -> RuntimeGenerateRequest {
        RuntimeGenerateRequest {
            selected_profile_id: profile_id.to_owned(),
            request_id: format!("real-deepseek-{suffix}"),
            task: "NPC_REPLY".to_owned(),
            prompt_version: 3,
            model_name: "deepseek-v4-flash".to_owned(),
            messages: vec![
                RuntimeMessage {
                    role: RuntimeMessageRole::System,
                    content: stable_system.to_owned(),
                },
                RuntimeMessage {
                    role: RuntimeMessageRole::User,
                    content: format!("玩家输入：{player_input}"),
                },
            ],
            response_format: RuntimeResponseFormat {
                kind: RuntimeResponseFormatKind::JsonObject,
            },
            temperature: 0.5,
            max_output_tokens: 512,
            timeout_ms: 60_000,
            cache_prefix_hash: "c".repeat(64),
        }
    }

    fn runtime_test_request(profile_id: &str, model_name: &str) -> RuntimeGenerateRequest {
        RuntimeGenerateRequest {
            selected_profile_id: profile_id.to_owned(),
            request_id: "runtime-request".to_owned(),
            task: "NPC_REPLY".to_owned(),
            prompt_version: 1,
            model_name: model_name.to_owned(),
            messages: vec![RuntimeMessage {
                role: RuntimeMessageRole::User,
                content: "Return JSON.".to_owned(),
            }],
            response_format: RuntimeResponseFormat {
                kind: RuntimeResponseFormatKind::JsonObject,
            },
            temperature: 0.5,
            max_output_tokens: 256,
            timeout_ms: 5_000,
            cache_prefix_hash: "a".repeat(64),
        }
    }

    #[test]
    fn probe_receipt_is_bound_to_endpoint_model_and_capabilities() {
        let registry = ProviderProbeRegistry::default();
        let endpoint = model_endpoint_fingerprint("custom", "http://127.0.0.1:11434/v1/");
        let capabilities = ModelCapabilitiesRegistration {
            text: true,
            streaming: false,
            system_messages: false,
            json_mode: false,
            json_schema: false,
            tool_calling: false,
            reasoning: false,
            context_window_tokens: Some(8192),
            cost_status: "UNKNOWN".to_owned(),
            checked_at: "2026-08-08T00:00:00Z".to_owned(),
        };
        let probe_fingerprint = model_probe_fingerprint(
            &endpoint,
            "local-model",
            CapabilitySource::Unknown,
            &capabilities,
        )
        .unwrap();
        let model = ProviderProbeModel {
            name: "local-model".to_owned(),
            display_name: "Local Model".to_owned(),
            capabilities: capabilities.clone(),
            capability_source: CapabilitySource::Unknown,
            probe_fingerprint: probe_fingerprint.clone(),
        };
        let receipt_id = registry
            .insert(StoredProbe {
                preset_key: "custom".to_owned(),
                normalized_base_url: "http://127.0.0.1:11434/v1/".to_owned(),
                endpoint_fingerprint: endpoint.clone(),
                models: vec![model],
                created_at: Instant::now(),
            })
            .unwrap();
        let mut update = ModelSettingsUpdate {
            preset_key: "custom".to_owned(),
            provider_display_name: "Local".to_owned(),
            base_url: Some("http://127.0.0.1:11434/v1/".to_owned()),
            endpoint_fingerprint: endpoint,
            credential_ref: None,
            credential_action: CredentialAction::Keep,
            model_name: "local-model".to_owned(),
            model_display_name: "Local Model".to_owned(),
            capabilities,
            capability_source: CapabilitySource::Unknown,
            probe_fingerprint,
            probe_receipt_id: receipt_id,
            use_as_default: false,
            use_as_fallback: false,
        };
        registry.validate(&update).unwrap();
        update.model_name = "forged-model".to_owned();
        assert_eq!(registry.validate(&update).unwrap_err().code, "PROBE_STALE");
    }

    #[test]
    fn failed_cleanup_is_retained_for_restart_retry() {
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().join("cleanup-retry.sqlite");
        let reference = CredentialRef::generate();
        let store = CampaignStore::open(&path).unwrap();
        store
            .enqueue_credential_cleanup(
                reference.expose_reference(),
                CredentialCleanupReason::Transient,
            )
            .unwrap();

        retry_pending_credential_cleanup(&store, &DeleteVault { fail: true }).unwrap();
        assert_eq!(store.pending_credential_cleanups().unwrap()[0].attempts, 1);
        drop(store);

        let reopened = CampaignStore::open(path).unwrap();
        retry_pending_credential_cleanup(&reopened, &DeleteVault { fail: false }).unwrap();
        assert!(reopened.pending_credential_cleanups().unwrap().is_empty());
    }
}
