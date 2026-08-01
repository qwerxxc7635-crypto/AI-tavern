use std::time::{Duration, Instant};

use ember_secure_http::{
    ApprovedEndpoint, RequestHeader, RequestMethod, SecureHttpTransport, TransportError,
    TransportRequest,
};
use ember_secure_secrets::{CredentialRef, SecretStore, SecretStoreError};
use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};
use time::{OffsetDateTime, format_description::well_known::Rfc3339};
use tokio_util::sync::CancellationToken;
use zeroize::Zeroizing;

const RESPONSE_LIMIT: usize = 4 * 1024 * 1024;

pub const DEEPSEEK_BASE_URL: &str = "https://api.deepseek.com/";
pub const DEEPSEEK_DEFAULT_MODEL: &str = "deepseek-v4-flash";
pub const QWEN_BASE_URL: &str = "https://dashscope.aliyuncs.com/compatible-mode/v1/";
pub const QWEN_DEFAULT_MODEL: &str = "qwen3.7-plus";
pub const OPENROUTER_BASE_URL: &str = "https://openrouter.ai/api/v1/";
pub const OLLAMA_BASE_URL: &str = "http://localhost:11434/v1/";

pub struct OllamaPreset;

impl OllamaPreset {
    pub const KEY: &'static str = "ollama";
    pub const DISPLAY_NAME: &'static str = "Ollama (local)";

    pub fn config() -> Result<OpenAiCompatibleConfig, ProviderError> {
        OpenAiCompatibleConfig::new(OLLAMA_BASE_URL, None)
    }

    #[cfg(test)]
    fn config_for_contract_test(base_url: &str) -> Result<OpenAiCompatibleConfig, ProviderError> {
        OpenAiCompatibleConfig::new(base_url, None)
    }
}

pub struct OpenRouterPreset;

impl OpenRouterPreset {
    pub const KEY: &'static str = "openrouter";
    pub const DISPLAY_NAME: &'static str = "OpenRouter";

    pub fn config(credential_ref: CredentialRef) -> Result<OpenAiCompatibleConfig, ProviderError> {
        OpenAiCompatibleConfig::new(OPENROUTER_BASE_URL, Some(credential_ref))
    }

    pub fn select_free_model(models: &[ModelInfo]) -> Option<&ModelInfo> {
        models
            .iter()
            .find(|model| model.cost_status == ModelCostStatus::Free)
    }

    #[cfg(test)]
    fn config_for_contract_test(base_url: &str) -> Result<OpenAiCompatibleConfig, ProviderError> {
        OpenAiCompatibleConfig::new(base_url, None)
    }
}

pub struct DeepSeekPreset;

impl DeepSeekPreset {
    pub const KEY: &'static str = "deepseek";
    pub const DISPLAY_NAME: &'static str = "DeepSeek";
    pub const MODELS: [PresetModel; 2] = [
        PresetModel {
            name: "deepseek-v4-flash",
            display_name: "DeepSeek V4 Flash",
            json_mode: true,
            reasoning: true,
            context_window_tokens: 1_048_576,
        },
        PresetModel {
            name: "deepseek-v4-pro",
            display_name: "DeepSeek V4 Pro",
            json_mode: true,
            reasoning: true,
            context_window_tokens: 1_048_576,
        },
    ];

    pub fn config(credential_ref: CredentialRef) -> Result<OpenAiCompatibleConfig, ProviderError> {
        OpenAiCompatibleConfig::new(DEEPSEEK_BASE_URL, Some(credential_ref))
    }

    pub fn model(name: &str) -> Option<PresetModel> {
        Self::MODELS
            .iter()
            .copied()
            .find(|model| model.name == name)
    }

    #[cfg(test)]
    fn config_for_contract_test(base_url: &str) -> Result<OpenAiCompatibleConfig, ProviderError> {
        OpenAiCompatibleConfig::new(base_url, None)
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct PresetModel {
    pub name: &'static str,
    pub display_name: &'static str,
    pub json_mode: bool,
    pub reasoning: bool,
    pub context_window_tokens: u64,
}

pub struct QwenPreset;

impl QwenPreset {
    pub const KEY: &'static str = "qwen";
    pub const DISPLAY_NAME: &'static str = "Qwen / Alibaba Cloud Model Studio";
    pub const MODELS: [PresetModel; 3] = [
        PresetModel {
            name: "qwen3.7-plus",
            display_name: "Qwen 3.7 Plus",
            json_mode: true,
            reasoning: true,
            context_window_tokens: 1_048_576,
        },
        PresetModel {
            name: "qwen3.7-max",
            display_name: "Qwen 3.7 Max",
            json_mode: true,
            reasoning: true,
            context_window_tokens: 1_048_576,
        },
        PresetModel {
            name: "qwen3.7-flash",
            display_name: "Qwen 3.7 Flash",
            json_mode: true,
            reasoning: true,
            context_window_tokens: 1_048_576,
        },
    ];

    pub fn config(credential_ref: CredentialRef) -> Result<OpenAiCompatibleConfig, ProviderError> {
        OpenAiCompatibleConfig::new(QWEN_BASE_URL, Some(credential_ref))
    }

    pub fn model(name: &str) -> Option<PresetModel> {
        Self::MODELS
            .iter()
            .copied()
            .find(|model| model.name == name)
    }

    #[cfg(test)]
    fn config_for_contract_test(base_url: &str) -> Result<OpenAiCompatibleConfig, ProviderError> {
        OpenAiCompatibleConfig::new(base_url, None)
    }
}

#[derive(Clone, Debug)]
pub struct OpenAiCompatibleConfig {
    endpoint: ApprovedEndpoint,
    credential_ref: Option<CredentialRef>,
}

impl OpenAiCompatibleConfig {
    pub fn new(
        base_url: &str,
        credential_ref: Option<CredentialRef>,
    ) -> Result<Self, ProviderError> {
        Ok(Self {
            endpoint: ApprovedEndpoint::parse(base_url).map_err(map_transport_error)?,
            credential_ref,
        })
    }
}

#[derive(Clone)]
pub struct OpenAiCompatibleProvider {
    transport: SecureHttpTransport,
    secrets: SecretStore,
}

impl OpenAiCompatibleProvider {
    pub fn new() -> Result<Self, ProviderError> {
        Ok(Self {
            transport: SecureHttpTransport::new().map_err(map_transport_error)?,
            secrets: SecretStore,
        })
    }

    pub async fn list_models(
        &self,
        config: &OpenAiCompatibleConfig,
        cancellation: CancellationToken,
    ) -> Result<Vec<ModelInfo>, ProviderError> {
        let request = self.request(
            config,
            RequestMethod::Get,
            "models",
            Vec::new(),
            Duration::from_secs(15),
        )?;
        let response = self
            .transport
            .send(&config.endpoint, request, cancellation)
            .await
            .map_err(map_transport_error)?;
        let payload: ModelsResponse =
            serde_json::from_slice(&response.body).map_err(|_| ProviderError::InvalidResponse)?;
        if payload.data.is_empty() || payload.data.iter().any(|model| model.id.trim().is_empty()) {
            return Err(ProviderError::InvalidResponse);
        }
        Ok(payload
            .data
            .into_iter()
            .map(|model| {
                let cost_status = model.cost_status();
                ModelInfo {
                    display_name: model
                        .name
                        .filter(|name| !name.trim().is_empty())
                        .unwrap_or_else(|| model.id.clone()),
                    name: model.id,
                    owned_by: model.owned_by,
                    cost_status,
                    context_window_tokens: model.context_length,
                }
            })
            .collect())
    }

    pub async fn test_connection(
        &self,
        config: &OpenAiCompatibleConfig,
        cancellation: CancellationToken,
    ) -> ConnectionTestResult {
        let started = Instant::now();
        match self.list_models(config, cancellation).await {
            Ok(_) => ConnectionTestResult::Success {
                latency_ms: elapsed_millis(started),
            },
            Err(error) => ConnectionTestResult::Failure {
                latency_ms: elapsed_millis(started),
                code: error.code(),
                message: error.to_string(),
            },
        }
    }

    pub async fn generate(
        &self,
        config: &OpenAiCompatibleConfig,
        request: &NormalizedRequest,
        cancellation: CancellationToken,
    ) -> Result<NormalizedResponse, ProviderError> {
        validate_normalized_request(request)?;
        let response_format = match &request.response_format {
            ResponseFormat::Text => None,
            ResponseFormat::JsonObject => Some(ApiResponseFormat {
                kind: "json_object",
            }),
            ResponseFormat::JsonSchema => return Err(ProviderError::Unsupported),
        };
        let body = serde_json::to_vec(&ChatRequest {
            model: &request.model_name,
            messages: request
                .messages
                .iter()
                .map(|message| ApiMessage {
                    role: message.role.as_api_role(),
                    content: &message.content,
                })
                .collect(),
            response_format,
            temperature: request.temperature,
            max_tokens: request.max_output_tokens,
        })
        .map_err(|_| ProviderError::InvalidRequest)?;
        let transport_request = self.request(
            config,
            RequestMethod::Post,
            "chat/completions",
            body,
            request.timeout,
        )?;
        let response = self
            .transport
            .send(&config.endpoint, transport_request, cancellation)
            .await
            .map_err(map_transport_error)?;
        let payload: ChatResponse =
            serde_json::from_slice(&response.body).map_err(|_| ProviderError::InvalidResponse)?;
        let choice = payload
            .choices
            .into_iter()
            .next()
            .ok_or(ProviderError::InvalidResponse)?;
        if choice.message.content.is_empty() || payload.model.trim().is_empty() {
            return Err(ProviderError::InvalidResponse);
        }
        Ok(NormalizedResponse {
            request_id: request.request_id.clone(),
            provider_request_id: non_empty(payload.id),
            model_name: payload.model,
            content: choice.message.content,
            finish_reason: normalize_finish_reason(choice.finish_reason.as_deref()),
            usage: payload.usage.map_or_else(TokenUsage::unknown, Into::into),
            received_at: OffsetDateTime::now_utc()
                .format(&Rfc3339)
                .map_err(|_| ProviderError::InvalidResponse)?,
        })
    }

    fn request(
        &self,
        config: &OpenAiCompatibleConfig,
        method: RequestMethod,
        relative_path: &str,
        body: Vec<u8>,
        timeout: Duration,
    ) -> Result<TransportRequest, ProviderError> {
        let mut headers = vec![
            RequestHeader::sensitive("accept", "application/json").map_err(map_transport_error)?,
        ];
        if method == RequestMethod::Post {
            headers.push(
                RequestHeader::sensitive("content-type", "application/json")
                    .map_err(map_transport_error)?,
            );
        }
        if let Some(reference) = &config.credential_ref {
            let authorization = self.secrets.with_secret(reference, |secret| {
                let secret = std::str::from_utf8(secret).map_err(|_| ProviderError::Credential)?;
                Ok::<_, ProviderError>(Zeroizing::new(format!("Bearer {secret}")))
            })??;
            headers.push(
                RequestHeader::sensitive("authorization", authorization.as_str())
                    .map_err(map_transport_error)?,
            );
        }
        Ok(TransportRequest {
            method,
            relative_path: relative_path.to_owned(),
            headers,
            body,
            timeout,
            max_response_bytes: RESPONSE_LIMIT,
        })
    }
}

impl Default for OpenAiCompatibleProvider {
    fn default() -> Self {
        Self::new().expect("default provider transport must initialize")
    }
}

fn elapsed_millis(started: Instant) -> u64 {
    u64::try_from(started.elapsed().as_millis()).unwrap_or(u64::MAX)
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct ModelInfo {
    pub name: String,
    pub display_name: String,
    pub owned_by: Option<String>,
    pub cost_status: ModelCostStatus,
    pub context_window_tokens: Option<u64>,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum ModelCostStatus {
    Free,
    Paid,
    Unknown,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum MessageRole {
    System,
    User,
    Assistant,
}

impl MessageRole {
    fn as_api_role(self) -> &'static str {
        match self {
            Self::System => "system",
            Self::User => "user",
            Self::Assistant => "assistant",
        }
    }
}

#[derive(Clone, Debug, PartialEq)]
pub struct NormalizedMessage {
    pub role: MessageRole,
    pub content: String,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum ResponseFormat {
    Text,
    JsonObject,
    JsonSchema,
}

#[derive(Clone, Debug, PartialEq)]
pub struct NormalizedRequest {
    pub request_id: String,
    pub model_name: String,
    pub messages: Vec<NormalizedMessage>,
    pub response_format: ResponseFormat,
    pub temperature: f64,
    pub max_output_tokens: u32,
    pub timeout: Duration,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct NormalizedResponse {
    pub request_id: String,
    pub provider_request_id: Option<String>,
    pub model_name: String,
    pub content: String,
    pub finish_reason: FinishReason,
    pub usage: TokenUsage,
    pub received_at: String,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum FinishReason {
    Stop,
    Length,
    ContentFilter,
    ToolCall,
    Error,
    Unknown,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct TokenUsage {
    pub input_tokens: Option<u64>,
    pub output_tokens: Option<u64>,
    pub total_tokens: Option<u64>,
}

impl TokenUsage {
    fn unknown() -> Self {
        Self {
            input_tokens: None,
            output_tokens: None,
            total_tokens: None,
        }
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum ConnectionErrorCode {
    Authentication,
    Network,
    RateLimited,
    Timeout,
    Unsupported,
    Unknown,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum ConnectionTestResult {
    Success {
        latency_ms: u64,
    },
    Failure {
        latency_ms: u64,
        code: ConnectionErrorCode,
        message: String,
    },
}

#[derive(Clone, Copy, Debug, thiserror::Error, PartialEq, Eq)]
pub enum ProviderError {
    #[error("provider configuration is invalid")]
    InvalidConfig,
    #[error("provider request is invalid")]
    InvalidRequest,
    #[error("provider response is invalid")]
    InvalidResponse,
    #[error("provider authentication failed")]
    Authentication,
    #[error("provider request was rate limited")]
    RateLimited,
    #[error("provider request timed out")]
    Timeout,
    #[error("provider request was cancelled")]
    Cancelled,
    #[error("provider network request failed")]
    Network,
    #[error("provider service failed")]
    Service,
    #[error("provider capability is unsupported")]
    Unsupported,
    #[error("provider credential is unavailable")]
    Credential,
}

impl ProviderError {
    fn code(self) -> ConnectionErrorCode {
        match self {
            Self::Authentication | Self::Credential => ConnectionErrorCode::Authentication,
            Self::RateLimited => ConnectionErrorCode::RateLimited,
            Self::Timeout => ConnectionErrorCode::Timeout,
            Self::Network => ConnectionErrorCode::Network,
            Self::Unsupported => ConnectionErrorCode::Unsupported,
            _ => ConnectionErrorCode::Unknown,
        }
    }
}

fn validate_normalized_request(request: &NormalizedRequest) -> Result<(), ProviderError> {
    if request.request_id.trim().is_empty()
        || request.model_name.trim().is_empty()
        || request.messages.is_empty()
        || request
            .messages
            .iter()
            .any(|message| message.content.trim().is_empty())
        || !request.temperature.is_finite()
        || !(0.0..=2.0).contains(&request.temperature)
        || request.max_output_tokens == 0
    {
        return Err(ProviderError::InvalidRequest);
    }
    Ok(())
}

fn map_transport_error(error: TransportError) -> ProviderError {
    match error {
        TransportError::InvalidEndpoint | TransportError::DisallowedEndpoint => {
            ProviderError::InvalidConfig
        }
        TransportError::InvalidRequest => ProviderError::InvalidRequest,
        TransportError::ResponseTooLarge => ProviderError::InvalidResponse,
        TransportError::Timeout => ProviderError::Timeout,
        TransportError::Cancelled => ProviderError::Cancelled,
        TransportError::Authentication => ProviderError::Authentication,
        TransportError::RateLimited => ProviderError::RateLimited,
        TransportError::Tls | TransportError::Network => ProviderError::Network,
        TransportError::Client(400 | 404 | 422) => ProviderError::InvalidRequest,
        TransportError::Configuration
        | TransportError::Client(_)
        | TransportError::Server(_)
        | TransportError::Stream => ProviderError::Service,
    }
}

impl From<SecretStoreError> for ProviderError {
    fn from(_: SecretStoreError) -> Self {
        Self::Credential
    }
}

fn normalize_finish_reason(value: Option<&str>) -> FinishReason {
    match value {
        Some("stop") => FinishReason::Stop,
        Some("length") => FinishReason::Length,
        Some("content_filter") => FinishReason::ContentFilter,
        Some("tool_calls" | "function_call") => FinishReason::ToolCall,
        Some("error") => FinishReason::Error,
        _ => FinishReason::Unknown,
    }
}

fn non_empty(value: String) -> Option<String> {
    (!value.trim().is_empty()).then_some(value)
}

#[derive(Serialize)]
struct ChatRequest<'a> {
    model: &'a str,
    messages: Vec<ApiMessage<'a>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    response_format: Option<ApiResponseFormat>,
    temperature: f64,
    max_tokens: u32,
}

#[derive(Serialize)]
struct ApiMessage<'a> {
    role: &'static str,
    content: &'a str,
}

#[derive(Serialize)]
struct ApiResponseFormat {
    #[serde(rename = "type")]
    kind: &'static str,
}

#[derive(Deserialize)]
struct ModelsResponse {
    data: Vec<ApiModel>,
}

#[derive(Deserialize)]
struct ApiModel {
    id: String,
    name: Option<String>,
    owned_by: Option<String>,
    context_length: Option<u64>,
    pricing: Option<Map<String, Value>>,
}

impl ApiModel {
    fn cost_status(&self) -> ModelCostStatus {
        let Some(pricing) = &self.pricing else {
            return ModelCostStatus::Unknown;
        };
        if !pricing.contains_key("prompt") || !pricing.contains_key("completion") {
            return ModelCostStatus::Unknown;
        }
        let prices = pricing
            .values()
            .map(parse_price)
            .collect::<Option<Vec<_>>>();
        let Some(prices) = prices else {
            return ModelCostStatus::Unknown;
        };
        if prices.iter().all(|price| *price == 0.0) {
            ModelCostStatus::Free
        } else {
            ModelCostStatus::Paid
        }
    }
}

fn parse_price(value: &Value) -> Option<f64> {
    value
        .as_str()?
        .parse::<f64>()
        .ok()
        .filter(|price| price.is_finite() && *price >= 0.0)
}

#[derive(Deserialize)]
struct ChatResponse {
    id: String,
    model: String,
    choices: Vec<ApiChoice>,
    usage: Option<ApiUsage>,
}

#[derive(Deserialize)]
struct ApiChoice {
    message: ApiResponseMessage,
    finish_reason: Option<String>,
}

#[derive(Deserialize)]
struct ApiResponseMessage {
    content: String,
}

#[derive(Deserialize)]
struct ApiUsage {
    prompt_tokens: Option<u64>,
    completion_tokens: Option<u64>,
    total_tokens: Option<u64>,
}

impl From<ApiUsage> for TokenUsage {
    fn from(value: ApiUsage) -> Self {
        Self {
            input_tokens: value.prompt_tokens,
            output_tokens: value.completion_tokens,
            total_tokens: value.total_tokens,
        }
    }
}

#[cfg(test)]
mod tests;
