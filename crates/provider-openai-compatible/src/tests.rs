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

async fn server(responses: Vec<(u16, &'static str)>) -> (String, Arc<Mutex<Vec<CapturedRequest>>>) {
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let address = listener.local_addr().unwrap();
    let captured = Arc::new(Mutex::new(Vec::new()));
    let server_captured = Arc::clone(&captured);
    tokio::spawn(async move {
        for (status, response_body) in responses {
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
    let (base_url, _) = server(vec![(401, "{}"), (429, "{}"), (500, "{}")]).await;
    let config = OpenAiCompatibleConfig::new(&base_url, None).unwrap();
    let provider = OpenAiCompatibleProvider::new().unwrap();
    for expected in [
        ProviderError::Authentication,
        ProviderError::RateLimited,
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
