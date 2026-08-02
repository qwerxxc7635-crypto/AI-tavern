//! Rust-only HTTP boundary for model providers.
//!
//! Callers must first construct an [`ApprovedEndpoint`]. Remote endpoints require
//! HTTPS; cleartext HTTP is reserved for loopback development providers. Redirects
//! are disabled so an approved origin cannot redirect a request elsewhere.

use std::{
    fmt,
    net::{IpAddr, Ipv4Addr, Ipv6Addr, SocketAddr},
    pin::Pin,
    time::Duration,
};

use bytes::Bytes;
use futures_util::{Stream, StreamExt};
use reqwest::{Method, StatusCode, Url, header::HeaderName};
use tokio::{
    net::lookup_host,
    time::{Instant, timeout_at},
};
use tokio_util::sync::CancellationToken;

const MIN_TIMEOUT: Duration = Duration::from_millis(100);
const MAX_TIMEOUT: Duration = Duration::from_secs(120);
const MAX_RESPONSE_BYTES: usize = 16 * 1024 * 1024;

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct ApprovedEndpoint {
    base_url: Url,
}

impl ApprovedEndpoint {
    pub fn parse(value: &str) -> Result<Self, TransportError> {
        let url = Url::parse(value).map_err(|_| TransportError::InvalidEndpoint)?;
        let host = url.host_str().ok_or(TransportError::InvalidEndpoint)?;
        let secure_remote = url.scheme() == "https";
        let loopback_http = url.scheme() == "http" && host_is_loopback(host);
        if !secure_remote && !loopback_http
            || secure_remote
                && host
                    .trim_matches(['[', ']'])
                    .parse::<IpAddr>()
                    .is_ok_and(|address| !address_is_public(address))
            || !url.username().is_empty()
            || url.password().is_some()
            || url.query().is_some()
            || url.fragment().is_some()
            || !url.path().ends_with('/')
        {
            return Err(TransportError::DisallowedEndpoint);
        }

        Ok(Self { base_url: url })
    }

    fn resolve(&self, relative_path: &str) -> Result<Url, TransportError> {
        if relative_path.is_empty()
            || relative_path.starts_with('/')
            || relative_path.starts_with("//")
            || relative_path.split('/').any(|part| part == "..")
        {
            return Err(TransportError::InvalidRequest);
        }
        self.base_url
            .join(relative_path)
            .map_err(|_| TransportError::InvalidRequest)
    }

    async fn pinned_client(&self) -> Result<reqwest::Client, TransportError> {
        let host = self
            .base_url
            .host_str()
            .ok_or(TransportError::InvalidEndpoint)?;
        let port = self
            .base_url
            .port_or_known_default()
            .ok_or(TransportError::InvalidEndpoint)?;
        let mut addresses = lookup_host((host, port))
            .await
            .map_err(|_| TransportError::Network)?
            .collect::<Vec<_>>();
        addresses.sort_unstable();
        addresses.dedup();
        validate_resolved_addresses(self.base_url.scheme(), &addresses)?;
        reqwest::Client::builder()
            .redirect(reqwest::redirect::Policy::none())
            .resolve_to_addrs(host, &addresses)
            .build()
            .map_err(|_| TransportError::Configuration)
    }
}

fn host_is_loopback(host: &str) -> bool {
    host.eq_ignore_ascii_case("localhost")
        || host
            .trim_matches(['[', ']'])
            .parse::<IpAddr>()
            .is_ok_and(|address| address.is_loopback())
}

fn validate_resolved_addresses(
    scheme: &str,
    addresses: &[SocketAddr],
) -> Result<(), TransportError> {
    let allowed = !addresses.is_empty()
        && match scheme {
            "http" => addresses.iter().all(|address| address.ip().is_loopback()),
            "https" => addresses
                .iter()
                .all(|address| address_is_public(address.ip())),
            _ => false,
        };
    if allowed {
        Ok(())
    } else {
        Err(TransportError::DisallowedEndpoint)
    }
}

fn address_is_public(address: IpAddr) -> bool {
    match address {
        IpAddr::V4(address) => ipv4_is_public(address),
        IpAddr::V6(address) => ipv6_is_public(address),
    }
}

fn ipv4_is_public(address: Ipv4Addr) -> bool {
    let [first, second, third, _] = address.octets();
    !(first == 0
        || first == 10
        || first == 127
        || first >= 224
        || first == 100 && (64..=127).contains(&second)
        || first == 169 && second == 254
        || first == 172 && (16..=31).contains(&second)
        || first == 192 && second == 0 && third == 0
        || first == 192 && second == 0 && third == 2
        || first == 192 && second == 168
        || first == 198 && (second == 18 || second == 19)
        || first == 198 && second == 51 && third == 100
        || first == 203 && second == 0 && third == 113)
}

fn ipv6_is_public(address: Ipv6Addr) -> bool {
    if let Some(mapped) = address.to_ipv4_mapped() {
        return ipv4_is_public(mapped);
    }
    let segments = address.segments();
    !(address.is_unspecified()
        || address.is_loopback()
        || address.is_multicast()
        || segments[0] & 0xfe00 == 0xfc00
        || segments[0] & 0xffc0 == 0xfe80
        || segments[0] & 0xffc0 == 0xfec0
        || segments[0] == 0x2001 && segments[1] == 0x0db8)
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum RequestMethod {
    Get,
    Post,
}

#[derive(Clone)]
pub struct RequestHeader {
    name: HeaderName,
    value: reqwest::header::HeaderValue,
}

impl RequestHeader {
    pub fn sensitive(name: &str, value: &str) -> Result<Self, TransportError> {
        let name =
            HeaderName::from_bytes(name.as_bytes()).map_err(|_| TransportError::InvalidRequest)?;
        let mut value = reqwest::header::HeaderValue::from_str(value)
            .map_err(|_| TransportError::InvalidRequest)?;
        value.set_sensitive(true);
        Ok(Self { name, value })
    }
}

impl fmt::Debug for RequestHeader {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter
            .debug_struct("RequestHeader")
            .field("name", &self.name)
            .field("value", &"<redacted>")
            .finish()
    }
}

#[derive(Clone)]
pub struct TransportRequest {
    pub method: RequestMethod,
    pub relative_path: String,
    pub headers: Vec<RequestHeader>,
    pub body: Vec<u8>,
    pub timeout: Duration,
    pub max_response_bytes: usize,
}

impl fmt::Debug for TransportRequest {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter
            .debug_struct("TransportRequest")
            .field("method", &self.method)
            .field("relative_path", &self.relative_path)
            .field("headers", &self.headers)
            .field("body", &format_args!("<{} bytes>", self.body.len()))
            .field("timeout", &self.timeout)
            .field("max_response_bytes", &self.max_response_bytes)
            .finish()
    }
}

impl TransportRequest {
    pub fn post(relative_path: impl Into<String>, body: Vec<u8>) -> Self {
        Self {
            method: RequestMethod::Post,
            relative_path: relative_path.into(),
            headers: Vec::new(),
            body,
            timeout: Duration::from_secs(30),
            max_response_bytes: 4 * 1024 * 1024,
        }
    }
}

#[derive(Clone)]
pub struct SecureHttpTransport;

impl SecureHttpTransport {
    pub fn new() -> Result<Self, TransportError> {
        Ok(Self)
    }

    pub async fn send(
        &self,
        endpoint: &ApprovedEndpoint,
        request: TransportRequest,
        cancellation: CancellationToken,
    ) -> Result<TransportResponse, TransportError> {
        let mut response = self.send_streaming(endpoint, request, cancellation).await?;
        let mut body = Vec::new();
        while let Some(chunk) = response.next_chunk().await? {
            body.extend_from_slice(&chunk);
        }
        Ok(TransportResponse {
            status: response.status,
            body,
        })
    }

    pub async fn send_streaming(
        &self,
        endpoint: &ApprovedEndpoint,
        request: TransportRequest,
        cancellation: CancellationToken,
    ) -> Result<StreamingResponse, TransportError> {
        validate_request(&request)?;
        let url = endpoint.resolve(&request.relative_path)?;
        let deadline = Instant::now() + request.timeout;
        let client = tokio::select! {
            () = cancellation.cancelled() => return Err(TransportError::Cancelled),
            result = timeout_at(deadline, endpoint.pinned_client()) => {
                result.map_err(|_| TransportError::Timeout)??
            }
        };
        let method = match request.method {
            RequestMethod::Get => Method::GET,
            RequestMethod::Post => Method::POST,
        };
        let mut builder = client.request(method, url).body(request.body);
        for header in request.headers {
            builder = builder.header(header.name, header.value);
        }

        let response = tokio::select! {
            () = cancellation.cancelled() => return Err(TransportError::Cancelled),
            result = timeout_at(deadline, builder.send()) => {
                result.map_err(|_| TransportError::Timeout)?
                    .map_err(normalize_reqwest_error)?
            }
        };
        let status = response.status();
        if !status.is_success() {
            return Err(normalize_status(status));
        }

        Ok(StreamingResponse {
            status: status.as_u16(),
            stream: Box::pin(response.bytes_stream()),
            cancellation,
            deadline,
            bytes_read: 0,
            max_response_bytes: request.max_response_bytes,
        })
    }
}

impl Default for SecureHttpTransport {
    fn default() -> Self {
        Self::new().expect("default HTTP client configuration must be valid")
    }
}

#[derive(Debug, PartialEq, Eq)]
pub struct TransportResponse {
    pub status: u16,
    pub body: Vec<u8>,
}

type ByteStream = Pin<Box<dyn Stream<Item = Result<Bytes, reqwest::Error>> + Send>>;

pub struct StreamingResponse {
    pub status: u16,
    stream: ByteStream,
    cancellation: CancellationToken,
    deadline: Instant,
    bytes_read: usize,
    max_response_bytes: usize,
}

impl StreamingResponse {
    pub async fn next_chunk(&mut self) -> Result<Option<Bytes>, TransportError> {
        let next = tokio::select! {
            () = self.cancellation.cancelled() => return Err(TransportError::Cancelled),
            result = timeout_at(self.deadline, self.stream.next()) => {
                result.map_err(|_| TransportError::Timeout)?
            }
        };
        let Some(chunk) = next else {
            return Ok(None);
        };
        let chunk = chunk.map_err(normalize_reqwest_error)?;
        self.bytes_read = self
            .bytes_read
            .checked_add(chunk.len())
            .ok_or(TransportError::ResponseTooLarge)?;
        if self.bytes_read > self.max_response_bytes {
            return Err(TransportError::ResponseTooLarge);
        }
        Ok(Some(chunk))
    }
}

#[derive(Clone, Debug, thiserror::Error, PartialEq, Eq)]
pub enum TransportError {
    #[error("HTTP transport configuration failed")]
    Configuration,
    #[error("endpoint is invalid")]
    InvalidEndpoint,
    #[error("endpoint is not permitted")]
    DisallowedEndpoint,
    #[error("request is invalid")]
    InvalidRequest,
    #[error("request timed out")]
    Timeout,
    #[error("request was cancelled")]
    Cancelled,
    #[error("TLS connection failed")]
    Tls,
    #[error("network request failed")]
    Network,
    #[error("authentication failed")]
    Authentication,
    #[error("request was rate limited")]
    RateLimited,
    #[error("remote service rejected the request ({0})")]
    Client(u16),
    #[error("remote service failed ({0})")]
    Server(u16),
    #[error("streaming response failed")]
    Stream,
    #[error("response exceeded the configured size limit")]
    ResponseTooLarge,
}

fn validate_request(request: &TransportRequest) -> Result<(), TransportError> {
    if !(MIN_TIMEOUT..=MAX_TIMEOUT).contains(&request.timeout)
        || request.max_response_bytes == 0
        || request.max_response_bytes > MAX_RESPONSE_BYTES
    {
        return Err(TransportError::InvalidRequest);
    }
    Ok(())
}

fn normalize_reqwest_error(error: reqwest::Error) -> TransportError {
    if error.is_timeout() {
        TransportError::Timeout
    } else if error.is_connect() {
        if error.to_string().to_ascii_lowercase().contains("tls") {
            TransportError::Tls
        } else {
            TransportError::Network
        }
    } else {
        TransportError::Stream
    }
}

fn normalize_status(status: StatusCode) -> TransportError {
    match status.as_u16() {
        401 | 403 => TransportError::Authentication,
        429 => TransportError::RateLimited,
        code if status.is_server_error() => TransportError::Server(code),
        code => TransportError::Client(code),
    }
}

#[cfg(test)]
mod tests;
