//! Loopback forward proxy for panel pages: connects only to public addresses
//! of the requested host, resolved through this process's own resolver, so a
//! rebinding DNS answer cannot reach a private one. The page webviews (and
//! nothing else in the app) are pointed at it.

use std::collections::HashSet;
use std::net::{IpAddr, SocketAddr};
use std::sync::{Mutex, OnceLock};
use std::time::Duration;

use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::{TcpListener, TcpStream};
use url::{Host, Position, Url};

use super::security::{host_is_private, ip_is_loopback, ip_is_private};

const MAX_HEAD: usize = 16 * 1024;
const TIMEOUT: Duration = Duration::from_secs(30);
/// One address's share of the deadline, so a dead first answer leaves time for
/// the next of a host's many addresses.
const ADDRESS_TIMEOUT: Duration = Duration::from_secs(10);

static ADDRESS: OnceLock<Result<SocketAddr, String>> = OnceLock::new();
/// Loopback hosts the user navigated to explicitly. The proxy still refuses
/// every private LAN host; this set only opens localhost/127/8/::1.
static ALLOWED_LOCAL: OnceLock<Mutex<HashSet<String>>> = OnceLock::new();

fn allowed_local() -> &'static Mutex<HashSet<String>> {
	ALLOWED_LOCAL.get_or_init(|| Mutex::new(HashSet::new()))
}

fn local_host_key(host: &str) -> Option<String> {
	let trimmed = host.trim().trim_end_matches('.');
	let url = Url::parse(&format!("http://{trimmed}/")).ok()?;
	let parsed = url.host()?;
	match parsed {
		Host::Ipv4(ip) if ip.is_loopback() => Some(ip.to_string()),
		Host::Ipv6(ip) if ip.is_loopback() => Some(format!("[{ip}]")),
		Host::Domain(name)
			if name == "localhost" || name.ends_with(".localhost") =>
		{
			Some(name.to_string())
		}
		_ => None,
	}
}

/// Allow a loopback host for this process after an explicit user navigation.
pub fn allow_local(host: &str) {
	if let Some(key) = local_host_key(host) {
		if let Ok(mut set) = allowed_local().lock() {
			if set.len() < 64 {
				set.insert(key);
			}
		}
	}
}

pub fn local_allowed(host: &str) -> bool {
	local_host_key(host).is_some_and(|key| allowed_local().lock().is_ok_and(|set| set.contains(&key)))
}

/// The proxy's loopback address, starting its accept loop on first call.
pub fn address() -> Result<SocketAddr, String> {
	ADDRESS
		.get_or_init(|| {
			let listener =
				std::net::TcpListener::bind(("127.0.0.1", 0)).map_err(|e| e.to_string())?;
			listener.set_nonblocking(true).map_err(|e| e.to_string())?;
			let address = listener.local_addr().map_err(|e| e.to_string())?;
			tauri::async_runtime::spawn(async move {
				let Ok(listener) = TcpListener::from_std(listener) else {
					return;
				};
				loop {
					match listener.accept().await {
						Ok((client, _)) => {
							tauri::async_runtime::spawn(serve(client));
						}
						// Out of descriptors, say: don't spin.
						Err(_) => tokio::time::sleep(Duration::from_millis(100)).await,
					}
				}
			});
			Ok(address)
		})
		.clone()
}

#[derive(Debug, PartialEq)]
struct Request {
	host: String,
	port: u16,
	/// Rewritten head for a plain absolute-form HTTP request, with hop-by-hop
	/// proxy headers dropped. `None` for a CONNECT tunnel, which is byte-blind.
	forward: Option<String>,
}

#[derive(Debug, PartialEq)]
enum Refusal {
	Private,
	Unreachable,
}

fn parse(head: &str) -> Option<Request> {
	let mut lines = head.split("\r\n");
	let mut parts = lines.next()?.split_ascii_whitespace();
	let (method, target, version) = (parts.next()?, parts.next()?, parts.next()?);
	if method.eq_ignore_ascii_case("CONNECT") {
		let url = Url::parse(&format!("http://{target}/")).ok()?;
		return Some(Request {
			host: url.host_str()?.to_string(),
			port: url.port_or_known_default()?,
			forward: None,
		});
	}
	let url = Url::parse(target).ok()?;
	if url.scheme() != "http" {
		return None;
	}
	// One request per connection, without the proxy's own headers.
	let mut forward = format!("{method} {} {version}\r\n", &url[Position::BeforePath..]);
	for line in lines.filter(|line| !line.is_empty()) {
		let name = line
			.split(':')
			.next()
			.unwrap_or("")
			.trim()
			.to_ascii_lowercase();
		if !matches!(
			name.as_str(),
			"connection" | "keep-alive" | "proxy-connection" | "proxy-authorization"
		) {
			forward.push_str(line);
			forward.push_str("\r\n");
		}
	}
	forward.push_str("Connection: close\r\n\r\n");
	Some(Request {
		host: url.host_str()?.to_string(),
		port: url.port_or_known_default()?,
		forward: Some(forward),
	})
}

/// Connect to a public address of `host`, refusing it if any resolved answer
/// is private. One deadline covers the lookup and every address.
async fn connect(host: &str, port: u16) -> Result<TcpStream, Refusal> {
	tokio::time::timeout(TIMEOUT, connect_within(host, port))
		.await
		.unwrap_or(Err(Refusal::Unreachable))
}

async fn connect_within(host: &str, port: u16) -> Result<TcpStream, Refusal> {
	let parsed = Host::parse(host).map_err(|_| Refusal::Unreachable)?;
	let borrowed = match &parsed {
		Host::Domain(name) => Host::Domain(name.as_str()),
		Host::Ipv4(ip) => Host::Ipv4(*ip),
		Host::Ipv6(ip) => Host::Ipv6(*ip),
	};
	let allowed_local = local_allowed(host);
	if host_is_private(&borrowed) && !allowed_local {
		return Err(Refusal::Private);
	}
	let addresses: Vec<SocketAddr> = match parsed {
		Host::Ipv4(ip) => vec![SocketAddr::new(IpAddr::V4(ip), port)],
		Host::Ipv6(ip) => vec![SocketAddr::new(IpAddr::V6(ip), port)],
		Host::Domain(name) => tokio::net::lookup_host((name.as_str(), port))
			.await
			.map_err(|_| Refusal::Unreachable)?
			.collect(),
	};
	if addresses
		.iter()
		.any(|address| ip_is_private(&address.ip()) && !(allowed_local && ip_is_loopback(&address.ip())))
	{
		return Err(Refusal::Private);
	}
	for address in addresses {
		if let Ok(Ok(stream)) =
			tokio::time::timeout(ADDRESS_TIMEOUT, TcpStream::connect(address)).await
		{
			return Ok(stream);
		}
	}
	Err(Refusal::Unreachable)
}

/// One connection's request head, with the body buffered behind it.
async fn read_head(client: &mut TcpStream) -> Option<(String, Vec<u8>)> {
	let mut buffer = Vec::new();
	let mut chunk = [0u8; 4096];
	loop {
		let read = client.read(&mut chunk).await.ok()?;
		if read == 0 {
			return None;
		}
		buffer.extend_from_slice(&chunk[..read]);
		if let Some(end) = buffer.windows(4).position(|window| window == b"\r\n\r\n") {
			let rest = buffer.split_off(end + 4);
			return Some((String::from_utf8(buffer).ok()?, rest));
		}
		if buffer.len() > MAX_HEAD {
			return None;
		}
	}
}

async fn serve(mut client: TcpStream) {
	let Ok(Some((head, rest))) = tokio::time::timeout(TIMEOUT, read_head(&mut client)).await else {
		return;
	};
	let Some(request) = parse(&head) else {
		log::info!("proxy: unparseable request head");
		let _ = reply(&mut client, "400 Bad Request").await;
		return;
	};
	log::info!(
		"proxy: {} {}:{} ({})",
		if request.forward.is_some() {
			"GET"
		} else {
			"CONNECT"
		},
		request.host,
		request.port,
		request.host
	);
	let mut upstream = match connect(&request.host, request.port).await {
		Ok(stream) => {
			log::info!(
				"proxy: connected {}:{} ({} bytes pending)",
				request.host,
				request.port,
				rest.len()
			);
			stream
		}
		Err(Refusal::Private) => {
			log::info!("browser proxy refused private host {}", request.host);
			let _ = reply(&mut client, "403 Forbidden").await;
			return;
		}
		Err(Refusal::Unreachable) => {
			let _ = reply(&mut client, "502 Bad Gateway").await;
			return;
		}
	};
	let opened = match &request.forward {
		Some(forward) => upstream.write_all(forward.as_bytes()).await,
		None => {
			client
				.write_all(b"HTTP/1.1 200 Connection Established\r\n\r\n")
				.await
		}
	};
	if opened.is_ok() && upstream.write_all(&rest).await.is_ok() {
		let _ = tokio::io::copy_bidirectional(&mut client, &mut upstream).await;
	}
}

async fn reply(client: &mut TcpStream, status: &str) -> std::io::Result<()> {
	let response = format!("HTTP/1.1 {status}\r\nContent-Length: 0\r\nConnection: close\r\n\r\n");
	client.write_all(response.as_bytes()).await
}

#[cfg(test)]
static TEST_LOCK: Mutex<()> = Mutex::new(());

#[cfg(test)]
fn clear_local_allowlist() {
	if let Ok(mut set) = allowed_local().lock() {
		set.clear();
	}
}

#[cfg(test)]
mod tests {
	use super::*;

	#[test]
	fn only_loopback_hosts_can_be_allowlisted() {
		assert_eq!(local_host_key("localhost"), Some("localhost".into()));
		assert_eq!(local_host_key("APP.localhost"), Some("app.localhost".into()));
		assert_eq!(local_host_key("127.0.0.1"), Some("127.0.0.1".into()));
		assert_eq!(local_host_key("[::1]"), Some("[::1]".into()));
		assert_eq!(local_host_key("10.0.0.1"), None);
		assert_eq!(local_host_key("example.com"), None);
	}

	#[test]
	fn parses_tunnels_and_plain_requests() {
		assert_eq!(
			parse("CONNECT example.com:443 HTTP/1.1\r\nHost: example.com:443\r\n\r\n"),
			Some(Request {
				host: "example.com".into(),
				port: 443,
				forward: None
			})
		);
		assert_eq!(
			parse("CONNECT [::1]:8888 HTTP/1.1\r\n\r\n").unwrap().host,
			"[::1]"
		);
		let plain = parse(
			"GET http://example.com/a?b=1 HTTP/1.1\r\nHost: example.com\r\nProxy-Connection: keep-alive\r\nConnection: keep-alive\r\nAccept: */*\r\n\r\n",
		)
		.unwrap();
		assert_eq!((plain.host.as_str(), plain.port), ("example.com", 80));
		assert_eq!(
			plain.forward.unwrap(),
			"GET /a?b=1 HTTP/1.1\r\nHost: example.com\r\nAccept: */*\r\nConnection: close\r\n\r\n"
		);
		assert_eq!(parse("GET /relative HTTP/1.1\r\n\r\n"), None);
		assert_eq!(parse("GET https://example.com/ HTTP/1.1\r\n\r\n"), None);
	}

	#[test]
	fn the_port_defaults_follow_the_scheme() {
		let tunnel = parse("CONNECT example.com:443 HTTP/1.1\r\n\r\n").unwrap();
		assert_eq!(tunnel.port, 443);
		let plain = parse("GET http://example.com/x HTTP/1.0\r\n\r\n").unwrap();
		assert_eq!(plain.port, 80);
		let explicit = parse("GET http://example.com:8080/x HTTP/1.1\r\n\r\n").unwrap();
		assert_eq!(explicit.port, 8080);
	}

	#[tokio::test]
	async fn private_hosts_are_refused_however_written() {
		let _guard = TEST_LOCK.lock().unwrap();
		clear_local_allowlist();
		for host in [
			"localhost",
			"127.0.0.1",
			"[::1]",
			"[::ffff:7f00:1]",
			"10.0.0.1",
			"192.168.0.2",
		] {
			assert_eq!(
				connect(host, 80).await.err(),
				Some(Refusal::Private),
				"{host}"
			);
		}
	}

	#[tokio::test]
	async fn allowlisted_loopback_connects() {
		let _guard = TEST_LOCK.lock().unwrap();
		clear_local_allowlist();
		let listener = TcpListener::bind(("127.0.0.1", 0)).await.unwrap();
		let port = listener.local_addr().unwrap().port();
		tokio::spawn(async move {
			let _ = listener.accept().await;
		});
		allow_local("127.0.0.1");
		assert!(connect("127.0.0.1", port).await.is_ok());
		clear_local_allowlist();
	}

	#[tokio::test]
	async fn unreachable_hosts_answer_unreachable() {
		// A public, never-answering literal: TEST-NET (203.0.113.x) is public
		// by the private-address rules but cannot connect.
		assert_eq!(
			connect("203.0.113.1", 80).await.err(),
			Some(Refusal::Unreachable)
		);
	}

	#[tokio::test]
	async fn the_proxy_answers_a_private_tunnel_with_403() {
		let _guard = TEST_LOCK.lock().unwrap();
		clear_local_allowlist();
		let address = tokio::task::spawn_blocking(address).await.unwrap().unwrap();
		let mut client = TcpStream::connect(address).await.unwrap();
		client
			.write_all(b"CONNECT 127.0.0.1:22 HTTP/1.1\r\n\r\n")
			.await
			.unwrap();
		let mut response = String::new();
		client.read_to_string(&mut response).await.unwrap();
		assert!(response.starts_with("HTTP/1.1 403"), "{response}");
	}
}
