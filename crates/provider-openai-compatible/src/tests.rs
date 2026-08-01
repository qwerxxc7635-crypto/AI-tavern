use std::{sync::Arc, time::Duration};

use ember_secure_secrets::SecretStore;
use serde_json::Value;
use tokio::{
    io::{AsyncReadExt, AsyncWriteExt},
    net::TcpListener,
    sync::Mutex,
};
use tokio_util::sync::CancellationToken;
use uuid::Uuid;
use zeroize::Zeroize;

use super::*;

#[derive(Clone, Debug)]
struct CapturedRequest {
    head: Vec<u8>,
    body: Vec<u8>,
}

#[cfg(target_os = "windows")]
struct CredentialCleanup {
    store: SecretStore,
    reference: CredentialRef,
}

#[cfg(target_os = "windows")]
impl Drop for CredentialCleanup {
    fn drop(&mut self) {
        let _ = self.store.delete(&self.reference);
    }
}

async fn server<B: Into<String> + Send + 'static>(
    responses: Vec<(u16, B)>,
) -> (String, Arc<Mutex<Vec<CapturedRequest>>>) {
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let address = listener.local_addr().unwrap();
    let captured = Arc::new(Mutex::new(Vec::new()));
    let server_captured = Arc::clone(&captured);
    tokio::spawn(async move {
        for (status, response_body) in responses {
            let response_body = response_body.into();
            let (mut socket, _) = listener.accept().await.unwrap();
            let request = read_request(&mut socket).await;
            server_captured.lock().await.push(request);
            let reason = if status == 200 { "OK" } else { "Error" };
            let response = format!(
                "HTTP/1.1 {status} {reason}\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{response_body}",
                response_body.len()
            );
            socket.write_all(response.as_bytes()).await.unwrap();
        }
    });
    (format!("http://{address}/v1/"), captured)
}

async fn read_request(socket: &mut tokio::net::TcpStream) -> CapturedRequest {
    let mut bytes = Vec::new();
    let mut buffer = [0_u8; 1024];
    let header_end = loop {
        let read = socket.read(&mut buffer).await.unwrap();
        assert_ne!(read, 0);
        bytes.extend_from_slice(&buffer[..read]);
        if let Some(position) = bytes.windows(4).position(|window| window == b"\r\n\r\n") {
            break position + 4;
        }
    };
    let content_length = String::from_utf8_lossy(&bytes[..header_end])
        .lines()
        .find_map(|line| {
            line.strip_prefix("content-length: ")
                .or_else(|| line.strip_prefix("Content-Length: "))
        })
        .and_then(|value| value.trim().parse::<usize>().ok())
        .unwrap_or(0);
    while bytes.len() - header_end < content_length {
        let read = socket.read(&mut buffer).await.unwrap();
        assert_ne!(read, 0);
        bytes.extend_from_slice(&buffer[..read]);
    }
    CapturedRequest {
        head: bytes[..header_end].to_vec(),
        body: bytes[header_end..header_end + content_length].to_vec(),
    }
}

fn normalized(response_format: ResponseFormat) -> NormalizedRequest {
    NormalizedRequest {
        request_id: "request-contract".to_owned(),
        model_name: "ember-model".to_owned(),
        messages: vec![
            NormalizedMessage {
                role: MessageRole::System,
                content: "Return concise output.".to_owned(),
            },
            NormalizedMessage {
                role: MessageRole::User,
                content: "Create a coastal region.".to_owned(),
            },
        ],
        response_format,
        temperature: 0.7,
        max_output_tokens: 512,
        timeout: Duration::from_secs(5),
    }
}

#[cfg(target_os = "windows")]
#[tokio::test]
async fn contract_generates_text_with_an_os_stored_credential() {
    let response = r#"{"id":"provider-1","model":"ember-model","choices":[{"message":{"content":"A quiet coast."},"finish_reason":"stop"}],"usage":{"prompt_tokens":9,"completion_tokens":4,"total_tokens":13}}"#;
    let (base_url, captured) = server(vec![(200, response)]).await;
    let store = SecretStore;
    let runtime_secret = format!("runtime-{}", Uuid::new_v4());
    let reference = store.save(runtime_secret).unwrap();
    let cleanup = CredentialCleanup {
        store,
        reference: reference.clone(),
    };
    let config = OpenAiCompatibleConfig::new(&base_url, Some(reference.clone())).unwrap();

    let result = OpenAiCompatibleProvider::new()
        .unwrap()
        .generate(
            &config,
            &normalized(ResponseFormat::Text),
            CancellationToken::new(),
        )
        .await
        .unwrap();
    assert_eq!(result.request_id, "request-contract");
    assert_eq!(result.content, "A quiet coast.");
    assert_eq!(result.finish_reason, FinishReason::Stop);
    assert_eq!(result.usage.input_tokens, Some(9));

    let mut requests = captured.lock().await;
    let head = String::from_utf8_lossy(&requests[0].head);
    assert!(head.starts_with("POST /v1/chat/completions HTTP/1.1"));
    assert!(head.contains("authorization: Bearer "));
    let body: Value = serde_json::from_slice(&requests[0].body).unwrap();
    assert_eq!(body["messages"][0]["role"], "system");
    assert!(body.get("response_format").is_none());
    requests[0].head.zeroize();
    drop(requests);
    store.delete(&reference).unwrap();
    drop(cleanup);
}

#[tokio::test]
async fn contract_lists_models_tests_connection_and_sends_json_mode() {
    let models = r#"{"data":[{"id":"ember-model","owned_by":"local"}]}"#;
    let completion = r#"{"id":"provider-json","model":"ember-model","choices":[{"message":{"content":"{\"name\":\"Ember Coast\"}"},"finish_reason":"length"}]}"#;
    let (base_url, captured) = server(vec![(200, models), (200, models), (200, completion)]).await;
    let config = OpenAiCompatibleConfig::new(&base_url, None).unwrap();
    let provider = OpenAiCompatibleProvider::new().unwrap();

    let listed = provider
        .list_models(&config, CancellationToken::new())
        .await
        .unwrap();
    assert_eq!(listed[0].name, "ember-model");
    assert!(matches!(
        provider
            .test_connection(&config, CancellationToken::new())
            .await,
        ConnectionTestResult::Success { .. }
    ));
    let generated = provider
        .generate(
            &config,
            &normalized(ResponseFormat::JsonObject),
            CancellationToken::new(),
        )
        .await
        .unwrap();
    assert_eq!(generated.content, r#"{"name":"Ember Coast"}"#);
    assert_eq!(generated.finish_reason, FinishReason::Length);
    assert_eq!(generated.usage, TokenUsage::unknown());

    let requests = captured.lock().await;
    assert!(String::from_utf8_lossy(&requests[0].head).starts_with("GET /v1/models "));
    let body: Value = serde_json::from_slice(&requests[2].body).unwrap();
    assert_eq!(body["response_format"]["type"], "json_object");
}

#[tokio::test]
async fn contract_normalizes_http_and_schema_errors() {
    let (base_url, _) = server(vec![
        (401, "{}"),
        (402, "{}"),
        (429, "{}"),
        (404, "{}"),
        (500, "{}"),
    ])
    .await;
    let config = OpenAiCompatibleConfig::new(&base_url, None).unwrap();
    let provider = OpenAiCompatibleProvider::new().unwrap();
    for expected in [
        ProviderError::Authentication,
        ProviderError::QuotaExceeded,
        ProviderError::RateLimited,
        ProviderError::ModelNotFound,
        ProviderError::Service,
    ] {
        let result = provider
            .list_models(&config, CancellationToken::new())
            .await;
        assert_eq!(result, Err(expected));
    }
    assert_eq!(
        provider
            .generate(
                &config,
                &normalized(ResponseFormat::JsonSchema),
                CancellationToken::new(),
            )
            .await,
        Err(ProviderError::Unsupported)
    );
}

#[tokio::test]
async fn contract_rejects_invalid_responses_and_reports_connection_codes() {
    let (base_url, _) = server(vec![(200, "not-json"), (429, "{}")]).await;
    let config = OpenAiCompatibleConfig::new(&base_url, None).unwrap();
    let provider = OpenAiCompatibleProvider::new().unwrap();
    assert_eq!(
        provider
            .list_models(&config, CancellationToken::new())
            .await,
        Err(ProviderError::InvalidResponse)
    );
    assert!(matches!(
        provider
            .test_connection(&config, CancellationToken::new())
            .await,
        ConnectionTestResult::Failure {
            code: ConnectionErrorCode::RateLimited,
            ..
        }
    ));
    assert!(matches!(
        OpenAiCompatibleConfig::new("http://example.com/v1/", None),
        Err(ProviderError::InvalidConfig)
    ));
}

#[test]
fn maps_every_transport_failure_without_exposing_raw_details() {
    assert_eq!(
        map_transport_error(TransportError::Timeout),
        ProviderError::Timeout
    );
    assert_eq!(
        map_transport_error(TransportError::Cancelled),
        ProviderError::Cancelled
    );
    assert_eq!(
        map_transport_error(TransportError::Network),
        ProviderError::Network
    );
    assert_eq!(
        map_transport_error(TransportError::Client(400)),
        ProviderError::InvalidRequest
    );
    assert_eq!(
        map_transport_error(TransportError::ResponseTooLarge),
        ProviderError::InvalidResponse
    );
    assert_eq!(
        map_transport_error(TransportError::Server(503)),
        ProviderError::Service
    );
}

#[tokio::test]
async fn deepseek_preset_lists_current_models_and_generates_a_world_locally() {
    assert_eq!(DeepSeekPreset::KEY, "deepseek");
    assert_eq!(DEEPSEEK_BASE_URL, "https://api.deepseek.com/");
    assert_eq!(DEEPSEEK_DEFAULT_MODEL, "deepseek-v4-flash");
    assert_eq!(
        DeepSeekPreset::model("deepseek-v4-pro"),
        Some(PresetModel {
            name: "deepseek-v4-pro",
            display_name: "DeepSeek V4 Pro",
            json_mode: true,
            reasoning: true,
            context_window_tokens: 1_048_576,
        })
    );
    assert!(DeepSeekPreset::model("deepseek-chat").is_none());

    let models = r#"{"data":[{"id":"deepseek-v4-flash","owned_by":"deepseek"},{"id":"deepseek-v4-pro","owned_by":"deepseek"}]}"#
        .to_owned();
    let world_content = serde_json::json!({
        "name": "潮痕群岛",
        "currentRegion": "灰帆港",
        "summary": "被季风与古代航标连接的群岛。",
        "coreConflict": "失控潮汐正在吞没航路。",
        "technologyLevel": "航海时代早期",
        "powerRules": ["潮汐魔法必须借助刻印施展。"],
        "factions": [{
            "name": "引潮会",
            "description": "维护群岛航标的领航者。",
            "goals": ["重启灰帆港主航标。"]
        }],
        "locations": [{
            "name": "灰帆港",
            "description": "建在玄武岩海湾中的港城。",
            "parentName": null,
            "factionNames": ["引潮会"]
        }],
        "narrativeStyle": "克制的航海奇幻与悬疑。",
        "forbiddenElements": [],
        "tavernReason": "船员在此等待潮窗与护航。",
        "storyHooks": ["主航标每逢退潮便熄灭。"]
    });
    let world = serde_json::json!({
        "id": "world-generation",
        "model": "deepseek-v4-flash",
        "choices": [{
            "message": { "content": world_content.to_string() },
            "finish_reason": "stop"
        }]
    })
    .to_string();
    let (base_url, captured) = server(vec![(200, models), (200, world)]).await;
    let config = DeepSeekPreset::config_for_contract_test(&base_url).unwrap();
    let provider = OpenAiCompatibleProvider::new().unwrap();
    let listed = provider
        .list_models(&config, CancellationToken::new())
        .await
        .unwrap();
    assert_eq!(
        listed
            .iter()
            .map(|model| model.name.as_str())
            .collect::<Vec<_>>(),
        vec!["deepseek-v4-flash", "deepseek-v4-pro"]
    );

    let mut request = normalized(ResponseFormat::JsonObject);
    request.model_name = DEEPSEEK_DEFAULT_MODEL.to_owned();
    request.messages[1].content = "生成一个中文奇幻海岛世界。".to_owned();
    let response = provider
        .generate(&config, &request, CancellationToken::new())
        .await
        .unwrap();
    let generated_world: Value = serde_json::from_str(&response.content).unwrap();
    assert_eq!(generated_world["name"], "潮痕群岛");
    assert_eq!(generated_world["currentRegion"], "灰帆港");
    assert_eq!(generated_world["factions"].as_array().unwrap().len(), 1);
    assert_eq!(generated_world["locations"].as_array().unwrap().len(), 1);
    assert_eq!(generated_world["storyHooks"].as_array().unwrap().len(), 1);

    let requests = captured.lock().await;
    let body: Value = serde_json::from_slice(&requests[1].body).unwrap();
    assert_eq!(body["model"], DEEPSEEK_DEFAULT_MODEL);
    assert_eq!(body["response_format"]["type"], "json_object");
}

#[tokio::test]
async fn qwen_preset_handles_chinese_npc_dialogue_and_a_structured_quest_locally() {
    assert_eq!(QwenPreset::KEY, "qwen");
    assert_eq!(
        QWEN_BASE_URL,
        "https://dashscope.aliyuncs.com/compatible-mode/v1/"
    );
    assert_eq!(QWEN_DEFAULT_MODEL, "qwen3.7-plus");
    assert_eq!(QwenPreset::MODELS.len(), 3);
    assert!(QwenPreset::model("qwen-plus").is_none());
    assert!(QwenPreset::MODELS.iter().all(|model| {
        model.json_mode && model.reasoning && model.context_window_tokens == 1_048_576
    }));

    let dialogue = serde_json::json!({
        "id": "npc-dialogue",
        "model": "qwen3.7-plus",
        "choices": [{
            "message": { "content": "潮声不对。若你真要下地窖，就别碰那盏发热的灯。" },
            "finish_reason": "stop"
        }]
    })
    .to_string();
    let quest_content = serde_json::json!({
        "content": {
            "title": "熄灭的潮灯",
            "summary": "查明港口潮灯为何在夜间熄灭。",
            "objective": "在下一次涨潮前重启主航标。",
            "failureCost": "灰帆港将失去安全航路。"
        },
        "risk": "MODERATE",
        "recommendedAttributes": ["knowledge", "agility"],
        "expectedTurns": { "min": 8, "max": 12 },
        "rewardTier": "NOTABLE",
        "relatedNpcIds": [],
        "relatedFactIds": []
    });
    let quest = serde_json::json!({
        "id": "structured-quest",
        "model": "qwen3.7-plus",
        "choices": [{
            "message": { "content": quest_content.to_string() },
            "finish_reason": "stop"
        }]
    })
    .to_string();
    let (base_url, captured) = server(vec![(200, dialogue), (200, quest)]).await;
    let config = QwenPreset::config_for_contract_test(&base_url).unwrap();
    let provider = OpenAiCompatibleProvider::new().unwrap();

    let mut dialogue_request = normalized(ResponseFormat::Text);
    dialogue_request.model_name = QWEN_DEFAULT_MODEL.to_owned();
    dialogue_request.messages[1].content = "问老板地窖里发生了什么。".to_owned();
    let dialogue_response = provider
        .generate(&config, &dialogue_request, CancellationToken::new())
        .await
        .unwrap();
    assert!(dialogue_response.content.contains("地窖"));
    assert!(dialogue_response.content.contains("潮声"));

    let mut quest_request = normalized(ResponseFormat::JsonObject);
    quest_request.model_name = QWEN_DEFAULT_MODEL.to_owned();
    quest_request.messages[1].content = "生成一项8至12回合的中文酒馆任务。".to_owned();
    let quest_response = provider
        .generate(&config, &quest_request, CancellationToken::new())
        .await
        .unwrap();
    let structured_quest: Value = serde_json::from_str(&quest_response.content).unwrap();
    assert_eq!(structured_quest["content"]["title"], "熄灭的潮灯");
    assert_eq!(structured_quest["expectedTurns"]["min"], 8);
    assert_eq!(structured_quest["expectedTurns"]["max"], 12);
    assert_eq!(
        structured_quest["recommendedAttributes"]
            .as_array()
            .unwrap()
            .len(),
        2
    );

    let requests = captured.lock().await;
    let dialogue_body: Value = serde_json::from_slice(&requests[0].body).unwrap();
    let quest_body: Value = serde_json::from_slice(&requests[1].body).unwrap();
    assert!(dialogue_body.get("response_format").is_none());
    assert_eq!(quest_body["response_format"]["type"], "json_object");
    assert_eq!(quest_body["model"], QWEN_DEFAULT_MODEL);
}

#[tokio::test]
async fn openrouter_discovers_a_free_model_and_generates_an_adventure_turn_locally() {
    assert_eq!(OpenRouterPreset::KEY, "openrouter");
    assert_eq!(OPENROUTER_BASE_URL, "https://openrouter.ai/api/v1/");

    let models = serde_json::json!({
        "data": [
            {
                "id": "vendor/paid-story-model",
                "name": "Paid Story Model",
                "context_length": 131072,
                "pricing": {
                    "prompt": "0",
                    "completion": "0",
                    "web_search": "0.01"
                }
            },
            {
                "id": "community/story-model:free",
                "name": "Community Story Model (free)",
                "context_length": 32768,
                "supported_parameters": ["response_format"],
                "pricing": { "prompt": "0", "completion": "0", "request": "0" }
            },
            {
                "id": "vendor/unknown-price",
                "pricing": { "prompt": "not-a-price", "completion": "0" }
            }
        ]
    })
    .to_string();
    let turn_content = serde_json::json!({
        "sceneText": "Cold surf floods the beacon stair while the lens pulses overhead.",
        "speakerNpcIds": [],
        "suggestedActions": [
            { "text": "Brace the sea gate." },
            { "text": "Inspect the lens housing." }
        ],
        "checkRequest": null,
        "discoveredClues": ["Salt-crusted lens key"],
        "statePatchProposals": [],
        "adventureState": "WAITING_FOR_PLAYER"
    });
    let completion = serde_json::json!({
        "id": "openrouter-adventure-turn",
        "model": "community/story-model:free",
        "choices": [{
            "message": { "content": turn_content.to_string() },
            "finish_reason": "stop"
        }]
    })
    .to_string();
    let (base_url, captured) = server(vec![(200, models), (200, completion)]).await;
    let config = OpenRouterPreset::config_for_contract_test(&base_url).unwrap();
    let provider = OpenAiCompatibleProvider::new().unwrap();

    let listed = provider
        .list_models(&config, CancellationToken::new())
        .await
        .unwrap();
    assert_eq!(listed[0].cost_status, ModelCostStatus::Paid);
    assert_eq!(listed[2].cost_status, ModelCostStatus::Unknown);
    let free = OpenRouterPreset::select_free_model(&listed).unwrap();
    assert_eq!(free.name, "community/story-model:free");
    assert_eq!(free.display_name, "Community Story Model (free)");
    assert_eq!(free.context_window_tokens, Some(32768));
    assert_eq!(free.supports_json_mode, Some(true));

    let mut request = normalized(ResponseFormat::JsonObject);
    request.model_name = free.name.clone();
    request.messages[1].content = "Continue the adventure with one structured turn.".to_owned();
    let response = provider
        .generate(&config, &request, CancellationToken::new())
        .await
        .unwrap();
    let turn: Value = serde_json::from_str(&response.content).unwrap();
    assert_eq!(turn["adventureState"], "WAITING_FOR_PLAYER");
    assert!(turn["sceneText"].as_str().unwrap().contains("beacon"));
    assert_eq!(turn["suggestedActions"].as_array().unwrap().len(), 2);
    assert_eq!(turn["discoveredClues"].as_array().unwrap().len(), 1);

    let requests = captured.lock().await;
    let body: Value = serde_json::from_slice(&requests[1].body).unwrap();
    assert_eq!(body["model"], "community/story-model:free");
    assert_eq!(body["response_format"]["type"], "json_object");
}

#[tokio::test]
async fn ollama_lists_installed_models_and_generates_structured_content_offline() {
    assert_eq!(OllamaPreset::KEY, "ollama");
    assert_eq!(OLLAMA_BASE_URL, "http://localhost:11434/v1/");
    let production = OllamaPreset::config().unwrap();
    assert!(production.credential_ref.is_none());

    let models = r#"{"data":[{"id":"local-story-model:latest","owned_by":"library"}]}"#.to_owned();
    let turn_content = serde_json::json!({
        "sceneText": "The cellar door opens onto a dry passage beneath the harbor.",
        "speakerNpcIds": [],
        "suggestedActions": [
            { "text": "Follow the chalk marks." },
            { "text": "Listen for movement." }
        ],
        "checkRequest": null,
        "discoveredClues": [],
        "statePatchProposals": [],
        "adventureState": "WAITING_FOR_PLAYER"
    });
    let completion = serde_json::json!({
        "id": "ollama-local-turn",
        "model": "local-story-model:latest",
        "choices": [{
            "message": { "content": turn_content.to_string() },
            "finish_reason": "stop"
        }]
    })
    .to_string();
    let (base_url, captured) = server(vec![(200, models), (200, completion)]).await;
    let config = OllamaPreset::config_for_contract_test(&base_url).unwrap();
    let provider = OpenAiCompatibleProvider::new().unwrap();

    let models = provider
        .list_models(&config, CancellationToken::new())
        .await
        .unwrap();
    assert_eq!(models[0].name, "local-story-model:latest");
    assert_eq!(models[0].cost_status, ModelCostStatus::Unknown);

    let mut request = normalized(ResponseFormat::JsonObject);
    request.model_name = models[0].name.clone();
    request.messages[1].content = "Generate the next structured adventure turn.".to_owned();
    let response = provider
        .generate(&config, &request, CancellationToken::new())
        .await
        .unwrap();
    let turn: Value = serde_json::from_str(&response.content).unwrap();
    assert_eq!(turn["adventureState"], "WAITING_FOR_PLAYER");
    assert_eq!(turn["suggestedActions"].as_array().unwrap().len(), 2);

    let requests = captured.lock().await;
    let model_head = String::from_utf8_lossy(&requests[0].head);
    let completion_head = String::from_utf8_lossy(&requests[1].head);
    assert!(model_head.starts_with("GET /v1/models "));
    assert!(completion_head.starts_with("POST /v1/chat/completions "));
    assert!(!model_head.to_ascii_lowercase().contains("authorization:"));
    assert!(
        !completion_head
            .to_ascii_lowercase()
            .contains("authorization:")
    );
    let body: Value = serde_json::from_slice(&requests[1].body).unwrap();
    assert_eq!(body["model"], "local-story-model:latest");
    assert_eq!(body["response_format"]["type"], "json_object");
}

#[tokio::test]
async fn custom_config_validates_endpoints_model_and_additional_headers() {
    let completion = r#"{"id":"custom-1","model":"custom-story-model","choices":[{"message":{"content":"Custom service response."},"finish_reason":"stop"}]}"#;
    let (base_url, captured) = server(vec![(200, completion)]).await;
    let base_url_without_slash = base_url.trim_end_matches('/');
    let config = CustomCompatibleConfig::new(
        base_url_without_slash,
        "custom-story-model",
        None,
        vec![
            CustomHeader::new("X-Workspace", "ember-local").unwrap(),
            CustomHeader::new("HTTP-Referer", "https://ember.invalid").unwrap(),
        ],
    )
    .unwrap();
    assert_eq!(config.model_name(), "custom-story-model");

    let mut request = normalized(ResponseFormat::Text);
    request.model_name = config.model_name().to_owned();
    let response = OpenAiCompatibleProvider::new()
        .unwrap()
        .generate(config.provider_config(), &request, CancellationToken::new())
        .await
        .unwrap();
    assert_eq!(response.content, "Custom service response.");

    let requests = captured.lock().await;
    let head = String::from_utf8_lossy(&requests[0].head).to_ascii_lowercase();
    assert!(head.contains("x-workspace: ember-local"));
    assert!(head.contains("http-referer: https://ember.invalid"));

    assert!(matches!(
        CustomCompatibleConfig::new("http://example.com/v1", "model", None, Vec::new()),
        Err(ProviderError::InvalidConfig)
    ));
    assert!(matches!(
        CustomCompatibleConfig::new("https://example.com/v1", " ", None, Vec::new()),
        Err(ProviderError::InvalidConfig)
    ));
    assert!(matches!(
        CustomHeader::new("Authorization", "plaintext-secret"),
        Err(ProviderError::InvalidConfig)
    ));
    assert!(matches!(
        CustomHeader::new("Host", "attacker.invalid"),
        Err(ProviderError::InvalidConfig)
    ));
}
