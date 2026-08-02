use std::{sync::Arc, time::Duration};

use tokio::{
    io::{AsyncReadExt, AsyncWriteExt},
    net::TcpListener,
    sync::Notify,
};
use tokio_util::sync::CancellationToken;

use super::*;

async fn serve_once(
    response_parts: Vec<(&'static [u8], Duration)>,
) -> (ApprovedEndpoint, Arc<Notify>) {
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let address = listener.local_addr().unwrap();
    let request_received = Arc::new(Notify::new());
    let server_notification = Arc::clone(&request_received);
    tokio::spawn(async move {
        let (mut socket, _) = listener.accept().await.unwrap();
        let mut request = Vec::new();
        let mut buffer = [0_u8; 1024];
        while !request.windows(4).any(|window| window == b"\r\n\r\n") {
            let bytes_read = socket.read(&mut buffer).await.unwrap();
            assert_ne!(bytes_read, 0, "client closed before sending HTTP headers");
            request.extend_from_slice(&buffer[..bytes_read]);
        }
        server_notification.notify_one();
        for (part, delay) in response_parts {
            tokio::time::sleep(delay).await;
            socket.write_all(part).await.unwrap();
            socket.flush().await.unwrap();
        }
    });
    (
        ApprovedEndpoint::parse(&format!("http://{address}/")).unwrap(),
        request_received,
    )
}

#[test]
fn endpoint_policy_rejects_unsafe_origins_and_paths() {
    assert_eq!(
        ApprovedEndpoint::parse("http://example.com/v1/"),
        Err(TransportError::DisallowedEndpoint)
    );
    assert_eq!(
        ApprovedEndpoint::parse("https://user:secret@example.com/v1/"),
        Err(TransportError::DisallowedEndpoint)
    );
    assert_eq!(
        ApprovedEndpoint::parse("https://example.com/v1"),
        Err(TransportError::DisallowedEndpoint)
    );
    for endpoint in [
        "https://127.0.0.1/v1/",
        "https://[::1]/v1/",
        "https://10.0.0.1/v1/",
        "https://169.254.169.254/v1/",
        "https://[fe80::1]/v1/",
    ] {
        assert_eq!(
            ApprovedEndpoint::parse(endpoint),
            Err(TransportError::DisallowedEndpoint)
        );
    }
    let endpoint = ApprovedEndpoint::parse("https://example.com/v1/").unwrap();
    assert_eq!(
        endpoint.resolve("../admin"),
        Err(TransportError::InvalidRequest)
    );
    assert_eq!(
        endpoint.resolve("//attacker.example/api"),
        Err(TransportError::InvalidRequest)
    );
}

#[test]
fn resolved_endpoint_policy_rejects_private_and_mixed_dns_answers() {
    let public_v4 = "93.184.216.34:443".parse().unwrap();
    let public_v6 = "[2606:2800:220:1:248:1893:25c8:1946]:443".parse().unwrap();
    let private_v4 = "10.0.0.8:443".parse().unwrap();
    let loopback_v6 = "[::1]:443".parse().unwrap();

    assert_eq!(
        validate_resolved_addresses("https", &[public_v4, public_v6]),
        Ok(())
    );
    assert_eq!(
        validate_resolved_addresses("https", &[private_v4]),
        Err(TransportError::DisallowedEndpoint)
    );
    assert_eq!(
        validate_resolved_addresses("https", &[public_v4, loopback_v6]),
        Err(TransportError::DisallowedEndpoint)
    );
    assert_eq!(
        validate_resolved_addresses("http", &["127.0.0.1:11434".parse().unwrap()]),
        Ok(())
    );
    assert_eq!(
        validate_resolved_addresses("http", &["[::1]:11434".parse().unwrap()]),
        Ok(())
    );
    assert_eq!(
        validate_resolved_addresses("http", &[public_v4]),
        Err(TransportError::DisallowedEndpoint)
    );
}

#[test]
fn sensitive_headers_never_expose_values_in_debug_output() {
    let header = RequestHeader::sensitive("authorization", "Bearer top-secret").unwrap();
    let debug = format!("{header:?}");
    assert!(debug.contains("<redacted>"));
    assert!(!debug.contains("top-secret"));

    let mut request = TransportRequest::post("responses", b"private prompt".to_vec());
    request.headers.push(header);
    let debug = format!("{request:?}");
    assert!(!debug.contains("private prompt"));
    assert!(!debug.contains("top-secret"));
}

#[tokio::test]
async fn sends_and_collects_a_bounded_response() {
    let (endpoint, _) = serve_once(vec![(
        b"HTTP/1.1 200 OK\r\nContent-Length: 5\r\n\r\nhello",
        Duration::ZERO,
    )])
    .await;
    let response = SecureHttpTransport::new()
        .unwrap()
        .send(
            &endpoint,
            TransportRequest::post("responses", b"request".to_vec()),
            CancellationToken::new(),
        )
        .await
        .unwrap();
    assert_eq!(response.status, 200);
    assert_eq!(response.body, b"hello");
}

#[tokio::test]
async fn streams_chunks_without_waiting_for_completion() {
    let (endpoint, _) = serve_once(vec![
        (
            b"HTTP/1.1 200 OK\r\nTransfer-Encoding: chunked\r\n\r\n5\r\nfirst\r\n",
            Duration::ZERO,
        ),
        (b"6\r\nsecond\r\n0\r\n\r\n", Duration::from_millis(150)),
    ])
    .await;
    let mut response = SecureHttpTransport::new()
        .unwrap()
        .send_streaming(
            &endpoint,
            TransportRequest::post("responses", Vec::new()),
            CancellationToken::new(),
        )
        .await
        .unwrap();
    assert_eq!(response.next_chunk().await.unwrap().unwrap(), b"first"[..]);
    assert_eq!(response.next_chunk().await.unwrap().unwrap(), b"second"[..]);
    assert!(response.next_chunk().await.unwrap().is_none());
}

#[tokio::test]
async fn cancellation_interrupts_an_in_flight_request() {
    let (endpoint, request_received) = serve_once(vec![(
        b"HTTP/1.1 200 OK\r\nContent-Length: 0\r\n\r\n",
        Duration::from_secs(2),
    )])
    .await;
    let cancellation = CancellationToken::new();
    let cancel_after_request = cancellation.clone();
    tokio::spawn(async move {
        request_received.notified().await;
        cancel_after_request.cancel();
    });
    let result = SecureHttpTransport::new()
        .unwrap()
        .send(
            &endpoint,
            TransportRequest::post("responses", Vec::new()),
            cancellation,
        )
        .await;
    assert_eq!(result, Err(TransportError::Cancelled));
}

#[tokio::test]
async fn timeout_covers_the_entire_stream() {
    let (endpoint, _) = serve_once(vec![(
        b"HTTP/1.1 200 OK\r\nContent-Length: 4\r\n\r\nlate",
        Duration::from_millis(250),
    )])
    .await;
    let mut request = TransportRequest::post("responses", Vec::new());
    request.timeout = Duration::from_millis(100);
    let result = SecureHttpTransport::new()
        .unwrap()
        .send(&endpoint, request, CancellationToken::new())
        .await;
    assert_eq!(result, Err(TransportError::Timeout));
}

#[tokio::test]
async fn normalizes_status_and_size_failures() {
    let (endpoint, _) = serve_once(vec![(
        b"HTTP/1.1 429 Too Many Requests\r\nContent-Length: 0\r\n\r\n",
        Duration::ZERO,
    )])
    .await;
    let result = SecureHttpTransport::new()
        .unwrap()
        .send(
            &endpoint,
            TransportRequest::post("responses", Vec::new()),
            CancellationToken::new(),
        )
        .await;
    assert_eq!(result, Err(TransportError::RateLimited));

    let (endpoint, _) = serve_once(vec![(
        b"HTTP/1.1 200 OK\r\nContent-Length: 5\r\n\r\nhello",
        Duration::ZERO,
    )])
    .await;
    let mut request = TransportRequest::post("responses", Vec::new());
    request.max_response_bytes = 4;
    let result = SecureHttpTransport::new()
        .unwrap()
        .send(&endpoint, request, CancellationToken::new())
        .await;
    assert_eq!(result, Err(TransportError::ResponseTooLarge));
}
