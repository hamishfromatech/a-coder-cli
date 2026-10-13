//! Proxied reading frames for platforms without native child webviews (Linux,
//! macOS < 14): the gateway fetches the page's resources itself — through the
//! loopback proxy, inheriting its DNS pinning and private-address refusal —
//! strips every script and inline handler, rewrites all subresource URLs to
//! point back at the gateway, and serves the result as a sandboxed reading
//! frame whose only script is our sentinel, with a per-response CSP nonce.
//!
//! Degraded by design: no cookies or storage (opaque origin in the sandbox),
//! no in-page agent ops, captures only via the region path on macOS < 14. It
//! exists so pages are at least readable everywhere; full pages need macOS 14+
//! or Windows.

use std::sync::{Mutex, OnceLock};
use std::time::Duration;

use lol_html::{element, html_content::ContentType, text, HtmlRewriter, Settings};
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::TcpListener;
use tokio::net::TcpStream;
use uuid::Uuid;

use super::security::{navigation_allowed, page_url, reportable, MAX_REPORTABLE_URL};

const TIMEOUT: Duration = Duration::from_secs(30);
/// One resource at most; a real asset fits far below.
const MAX_RESPONSE: usize = 8 * 1024 * 1024;
/// Reading-frame HTML: anything above this is cut (not refused), so enormous
/// document dumps still render their start.
const MAX_HTML_RENDER: usize = 1024 * 1024;
/// UA for the gateway's fetches; some sites refuse unknown clients.
const USER_AGENT: &str =
	"Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15 a-coder-desktop/1.0";

static ADDRESS: OnceLock<Mutex<Option<reqwest::Client>>> = OnceLock::new();

/// The gateway's loopback origin, starting its accept loop and fetch client on
/// first call. Fetches ride the loopback proxy, so pages can no more reach
/// private hosts through the gateway than through a page view.
pub fn address() -> Result<String, String> {
	let guard = ADDRESS.get_or_init(|| Mutex::new(None));
	let mut slot = guard.lock().map_err(|_| "gateway init poisoned")?;
	if slot.is_none() {
		let proxy_port = super::proxy::address()?.port();
		let port = std::net::TcpListener::bind(("127.0.0.1", 0))
			.map_err(|e| e.to_string())?
			.local_addr()
			.map_err(|e| e.to_string())?
			.port();
		let client = reqwest::Client::builder()
			.timeout(TIMEOUT)
			.user_agent(USER_AGENT)
			.proxy(
				reqwest::Proxy::all(format!("http://127.0.0.1:{proxy_port}"))
					.map_err(|e| e.to_string())?,
			)
			.build()
			.map_err(|e| e.to_string())?;
		tauri::async_runtime::spawn(serve_loop(port));
		*slot = Some(client);
	}
	Ok(format!("http://127.0.0.1:{}", gateway_port()))
}

static GATEWAY_PORT: OnceLock<u16> = OnceLock::new();

/// The port is fixed at init and used for origin-form routing; the proxy's
/// port never collides (ephemeral bind).
fn gateway_port() -> u16 {
	*GATEWAY_PORT.get_or_init(|| 0)
}

/// Exposed to the panel: where frames load from, on platforms that need them.
#[tauri::command]
pub fn browser_gateway_url() -> Option<String> {
	match address() {
		Ok(url) if !super::tabs::native_pages_supported() => Some(url),
		_ => None,
	}
}

async fn serve_loop(port: u16) {
	let Ok(listener) = TcpListener::bind(("127.0.0.1", port)).await else {
		return;
	};
	let _ = GATEWAY_PORT.set(port);
	loop {
		match listener.accept().await {
			Ok((client, _)) => {
				tauri::async_runtime::spawn(async move {
					if let Err(error) = serve(client).await {
						log::info!("gateway request failed: {error}");
					}
				});
			}
			// Out of descriptors, say: don't spin.
			Err(_) => tokio::time::sleep(Duration::from_millis(100)).await,
		}
	}
}

#[derive(Debug, PartialEq)]
enum Route {
	/// `?u=` names the page to render as a reading frame.
	Page,
	/// `?u=` names a subresource to pass through (CSS rewritten).
	Asset,
}

fn parse_request(head: &str) -> Option<(Route, String)> {
	let request_line = head.split("\r\n").next()?;
	let mut parts = request_line.split_ascii_whitespace();
	let (method, target, version) = (parts.next()?, parts.next()?, parts.next()?);
	if !method.eq_ignore_ascii_case("GET") || !version.starts_with("HTTP/1") {
		return None;
	}
	// Origin-form only (the proxy owns absolute-form and CONNECT).
	let (path, query) = target.split_once('?')?;
	let param = query
		.split('&')
		.find_map(|pair| pair.strip_prefix("u="))
		.map(str::to_string)?;
	let param = urldecode(&param)?;
	let route = match path {
		"/page" => Route::Page,
		"/asset" => Route::Asset,
		_ => return None,
	};
	Some((route, param))
}

/// Minimal percent-decoding (the panel encodeURIComponent's `u`).
fn urldecode(input: &str) -> Option<String> {
	let bytes = input.as_bytes();
	let mut out = Vec::with_capacity(bytes.len());
	let mut at = 0;
	while at < bytes.len() {
		match bytes[at] {
			b'%' if at + 2 < bytes.len() => {
				let hi = (bytes[at + 1] as char).to_digit(16)?;
				let lo = (bytes[at + 2] as char).to_digit(16)?;
				out.push(((hi << 4) | lo) as u8);
				at += 3;
			}
			b'+' => {
				out.push(b' ');
				at += 1;
			}
			byte => {
				out.push(byte);
				at += 1;
			}
		}
	}
	String::from_utf8(out).ok()
}

fn percent_encode(url: &str) -> String {
	let mut out = String::with_capacity(url.len() * 3);
	for byte in url.bytes() {
		if byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'_' | b'.' | b'~') {
			out.push(byte as char);
		} else {
			out.push_str(&format!("%{byte:02X}"));
		}
	}
	out
}

/// The absolute URL to route `href` to: pages load as documents, everything
/// else as assets. `None` drops the link (non-web or forbidden schemes).
fn routed(base: &str, href: &str, as_document: bool) -> Option<String> {
	if href.is_empty() {
		return None;
	}
	// Same-document jumps: no rewrite, no fetch.
	if href.starts_with('#') && !href.starts_with("#/") {
		return None;
	}
	let absolute = reqwest::Url::parse(href)
		.or_else(|_| reqwest::Url::parse(base).and_then(|base| base.join(href)))
		.ok()?;
	if !navigation_allowed(&absolute) {
		return None;
	}
	let route = if as_document { "/page" } else { "/asset" };
	Some(format!(
		"{}?u={}",
		gateway_url(),
		percent_encode(absolute.as_str())
	))
}

fn gateway_url() -> String {
	format!("http://127.0.0.1:{}", gateway_port())
}

/// Rewrites a chunk of CSS so every url(...) rides the gateway asset route.
pub(crate) fn rewrite_css(css: &str, base: &str) -> String {
	let mut out = String::with_capacity(css.len());
	let mut rest = css;
	while let Some(at) = rest.find("url(") {
		out.push_str(&rest[..at]);
		rest = &rest[at + 4..];
		let end = rest.find(')').unwrap_or(rest.len());
		let inner = &rest[..end];
		rest = &rest[end.min(rest.len())..];
		let without_quotes = inner.trim().trim_matches(['"', '\'']).trim();
		let replacement = match routed(base, without_quotes, false) {
			Some(routed_url) => format!("url(\"{routed_url}\")"),
			None => "url(about:invalid)".to_string(),
		};
		out.push_str(&replacement);
	}
	out.push_str(rest);
	out
}

/// Rewrites a served HTML document into a reading frame. `base` is the page's
/// URL; `nonce` marks the sentinel script the CSP allows.
pub(crate) fn rewrite_html(html: &str, base: &str, nonce: &str) -> Vec<u8> {
	out_from_rewriter(html, base, nonce)
}

fn out_from_rewriter(html: &str, base: &str, nonce: &str) -> Vec<u8> {
	const SENTINEL_BODY: &str = "(function(){var post=function(){try{parent.postMessage(JSON.stringify({type:'a-coder-frame',href:location.href,title:document.title}),'*')}catch(e){}};window.addEventListener('load',post);setTimeout(post,600);})();";
	let sentinel_open = format!("<script nonce=\"{nonce}\">{SENTINEL_BODY}</script>");
	let mut out: Vec<u8> = Vec::with_capacity(html.len() + 256);
	let mut sink = |chunk: &[u8]| out.extend_from_slice(chunk);
	let rewriter = HtmlRewriter::new(
		Settings {
			element_content_handlers: vec![
				// No scripts but our sentinel; no nested frames; refreshes and
				// preloads would fetch the origin directly.
				element!("script", |el| {
					el.remove();
					Ok(())
				}),
				element!("iframe, frame, frameset, meta[http-equiv]", |el| {
					el.remove();
					Ok(())
				}),
				// Everything URL-ish rides the gateway.
				element!("a[href]", |el| {
					let href = el.get_attribute("href").unwrap_or_default();
					if let Some(routed_url) = routed(base, &href, true) {
						let _ = el.set_attribute("href", &routed_url);
					} else {
						el.remove_attribute("href");
					}
					let _ = el.set_attribute("target", "_self");
					Ok(())
				}),
				element!(
					"img[src], source[src], video[src], audio[src], video[poster], track[src]",
					|el| {
						let src = el.get_attribute("src").unwrap_or_default();
						if let Some(routed_url) = routed(base, &src, false) {
							let _ = el.set_attribute("src", &routed_url);
						} else {
							el.remove_attribute("src");
						}
						rewrite_style_attr(el);
						Ok(())
					}
				),
				element!("[srcset]", |el| {
					if let Some(srcset) = el.get_attribute("srcset") {
						let rewritten = srcset
							.split(',')
							.filter_map(|candidate| {
								let mut parts = candidate.trim().splitn(2, char::is_whitespace);
								let url_part = parts.next().unwrap_or_default().trim();
								let descriptor = parts.next().unwrap_or_default().trim();
								let routed_url = routed(base, url_part, false)?;
								Some(if descriptor.is_empty() {
									routed_url
								} else {
									format!("{routed_url} {descriptor}")
								})
							})
							.filter(|candidate| !candidate.is_empty())
							.collect::<Vec<_>>()
							.join(", ");
						if rewritten.is_empty() {
							el.remove_attribute("srcset");
						} else {
							let _ = el.set_attribute("srcset", &rewritten);
						}
					}
					Ok(())
				}),
				element!("link[href]", |el| {
					let href = el.get_attribute("href").unwrap_or_default();
					if let Some(routed_url) = routed(base, &href, false) {
						let _ = el.set_attribute("href", &routed_url);
					} else {
						el.remove();
					}
					Ok(())
				}),
				element!("form", |el| {
					if let Some(action) = el.get_attribute("action") {
						if let Some(routed_url) = routed(base, &action, true) {
							let _ = el.set_attribute("action", &routed_url);
						}
					}
					let _ = el.set_attribute("target", "_self");
					Ok(())
				}),
				// Inline handlers (`on*`) never reach the frame.
				element!("*", |el| {
					let drop_names: Vec<String> = el
						.attributes()
						.iter()
						.filter(|attr| {
							attr.name().len() > 1
								&& attr
									.name()
									.to_lowercase()
									.starts_with("on\"".trim_matches('"'))
						})
						.map(|attr| attr.name().to_string())
						.collect();
					for name in drop_names {
						el.remove_attribute(&name);
					}
					rewrite_style_attr(el);
					Ok(())
				}),
				// <style> bodies ride the gateway too.
				text!("style", |chunk| {
					let rewritten = rewrite_css(chunk.as_str(), base);
					chunk.replace(&rewritten, ContentType::Text);
					Ok(())
				}),
			],
			..Settings::default()
		},
		&mut sink,
	);
	let mut rewriter = rewriter;
	let _ = rewriter.write(html.as_bytes());
	let _ = rewriter.end();
	// The sentinel goes in by string splice (the rewriter has no append-at-end
	// hook that also survives truncation).
	let mut html = String::from_utf8_lossy(&out).into_owned();
	html = if let Some(at) = html.rfind("</body>") {
		format!("{}{sentinel_open}{}", &html[..at], &html[at..])
	} else {
		format!("{html}{sentinel_open}")
	};
	let mut out = html.into_bytes();
	if out.len() > MAX_HTML_RENDER {
		out.truncate(MAX_HTML_RENDER);
		out.extend_from_slice(b"<!-- a-coder: document too large, truncated --></body></html>");
	}
	out
}

fn rewrite_style_attr(el: &mut lol_html::html_content::Element) {
	if let Some(style) = el.get_attribute("style") {
		let rewritten = rewrite_css(&style, "");
		let _ = el.set_attribute("style", &rewritten);
	}
}

/// One client connection: exactly one GET, one response.
async fn serve(mut client: TcpStream) -> Result<(), String> {
	let head = read_head(&mut client).await.ok_or("no request")?;
	let Some((route, target)) = parse_request(&head) else {
		reply(&mut client, 400, "text/plain", b"bad request", None).await;
		return Err("bad gateway request".into());
	};
	if !reportable(&target) || target.len() > MAX_REPORTABLE_URL {
		reply(&mut client, 400, "text/plain", b"address too long", None).await;
		return Err("address too long".into());
	}
	let http_url = page_url(&target)?;
	let http_url_str = http_url.to_string();
	let http_client = ADDRESS
		.get()
		.and_then(|guard| guard.lock().ok())
		.and_then(|slot| slot.clone())
		.ok_or("gateway client not initialized")?;
	let response = http_client
		.get(&http_url_str)
		.header(
			"accept",
			match route {
				Route::Page => "text/html,application/xhtml+xml;q=0.9,*/*;q=0.8",
				Route::Asset => "*/*",
			},
		)
		// Ask for identity: the rewrites run on decoded text, so a compressed
		// body would have to be decoded before them. Some servers send gzip
		// unrequested anyway (RFC 9110 12.5.3 allows accepting anything);
		// decode those below as they arrive.
		.header(reqwest::header::ACCEPT_ENCODING, "identity")
		.send()
		.await
		.map_err(|error| error.to_string())?;
	let status = response.status();
	let content_type = response
		.headers()
		.get(reqwest::header::CONTENT_TYPE)
		.and_then(|value| value.to_str().ok())
		.map(str::to_string)
		.unwrap_or_else(|| "application/octet-stream".into());
	// A server may compress unrequested (RFC 9110 12.5.3 allows accepting
	// anything); headers first — bytes() consumes the response.
	let encoding = response
		.headers()
		.get(reqwest::header::CONTENT_ENCODING)
		.and_then(|value| value.to_str().ok())
		.map(|value| value.trim().to_ascii_lowercase());
	let mut bytes = response
		.bytes()
		.await
		.map_err(|error| error.to_string())?
		.to_vec();
	match encoding.as_deref() {
		Some("gzip") | Some("x-gzip") => {
			bytes = decode_with(flate2::read::GzDecoder::new(&bytes[..]))?;
		}
		Some("deflate") => {
			// RFC 9110 12.5.3: "deflate" is zlib-wrapped; raw-deflate servers
			// exist, so fall back to a plain inflate.
			bytes = match decode_with(flate2::read::ZlibDecoder::new(&bytes[..])) {
				Ok(decoded) => decoded,
				Err(_) => decode_with(flate2::read::DeflateDecoder::new(&bytes[..]))?,
			};
		}
		_ => {}
	}
	if bytes.len() > MAX_RESPONSE {
		reply(&mut client, 413, "text/plain", b"resource too large", None).await;
		return Err("resource too large".into());
	}
	if !status.is_success() {
		let message = format!("upstream {}", status.as_u16());
		let code = if status.is_client_error() {
			status.as_u16()
		} else {
			502
		};
		reply(&mut client, code, "text/plain", message.as_bytes(), None).await;
		return Ok(());
	}
	let is_css = content_type.contains("text/css");
	let is_html = content_type.contains("text/html") || content_type.contains("application/xhtml");
	match (route, is_html) {
		(Route::Page, true) => {
			let html = String::from_utf8_lossy(&bytes);
			let nonce = Uuid::new_v4().simple().to_string();
			let body = rewrite_html(&html, &http_url_str, &nonce);
			reply(&mut client, 200, "text/html", &body, Some(&nonce)).await;
		}
		// Stylesheets rewrite their url(...) references as they pass through;
		// other bytes pass through untouched.
		(_, true) | (_, false) => {
			let body: Vec<u8> = if is_css {
				rewrite_css(&String::from_utf8_lossy(&bytes), &http_url_str).into_bytes()
			} else {
				bytes
			};
			reply(&mut client, status.as_u16(), &content_type, &body, None).await;
		}
	}
	Ok(())
}

async fn read_head(client: &mut TcpStream) -> Option<String> {
	let mut buffer = Vec::new();
	let mut chunk = [0u8; 4096];
	loop {
		let read = client.read(&mut chunk).await.ok()?;
		if read == 0 {
			return None;
		}
		buffer.extend_from_slice(&chunk[..read]);
		if let Some(end) = buffer.windows(4).position(|window| window == b"\r\n\r\n") {
			buffer.truncate(end);
			return Some(String::from_utf8(buffer).ok()?);
		}
		if buffer.len() > 16 * 1024 {
			return None;
		}
	}
}

async fn reply(
	client: &mut TcpStream,
	status: u16,
	content_type: &str,
	body: &[u8],
	nonce: Option<&str>,
) {
	let reason = match status {
		200..=299 => "OK",
		400..=499 => "Client Error",
		_ => "Upstream Error",
	};
	let script_policy = match nonce {
		Some(nonce) => format!("script-src 'nonce-{nonce}'"),
		None => "script-src 'none'".to_string(),
	};
	let head = format!(
		"HTTP/1.1 {status} {reason}\r\nContent-Type: {content_type}\r\nContent-Length: {}\r\nConnection: close\r\nCache-Control: no-store\r\nContent-Security-Policy: default-src 'self'; {script_policy}; img-src 'self' data:; media-src 'self'; style-src 'self' 'unsafe-inline'; frame-src 'none'; form-action 'self'\r\n\r\n",
		body.len()
	);
	let _ = client.write_all(head.as_bytes()).await;
	let _ = client.write_all(body).await;
	let _ = client.flush().await;
}

#[cfg(test)]
mod tests {
	use super::*;

	#[test]
	fn percent_encoding_round_trips_through_the_parser() {
		let original = "https://example.com/a?b=1&c=<tag>";
		let encoded = percent_encode(original);
		assert_eq!(urldecode(&encoded).as_deref(), Some(original));
	}

	#[test]
	fn requests_parse_to_routes() {
		let head = "GET /page?u=https%3A%2F%2Fexample.com%2Fa HTTP/1.1\r\nHost: x\r\n\r\n";
		assert_eq!(
			parse_request(head),
			Some((Route::Page, "https://example.com/a".to_string()))
		);
		let head = "GET /asset?u=https%3A%2F%2Fcdn.example.com%2Fx.css HTTP/1.1\r\n\r\n";
		assert_eq!(
			parse_request(head),
			Some((Route::Asset, "https://cdn.example.com/x.css".to_string()))
		);
		assert_eq!(parse_request("GET / HTTP/1.1\r\n\r\n"), None);
		assert_eq!(
			parse_request("GET http://evil.com/page?u=x HTTP/1.1\r\n\r\n"),
			None,
			"absolute-form is the proxy's, not the gateway's"
		);
		assert_eq!(parse_request("POST /page?u=x HTTP/1.1\r\n\r\n"), None);
	}

	#[test]
	fn fragment_jumps_are_left_alone() {
		assert_eq!(routed("http://example.com/a", "#section", true), None);
	}

	#[test]
	fn private_targets_never_route() {
		assert_eq!(
			routed("https://example.com/", "http://127.0.0.1:8080/", true),
			None
		);
		assert_eq!(
			routed("https://example.com/", "http://intranet.local/", true),
			None,
			".local is private by name"
		);
		assert_eq!(
			routed("https://example.com/", "http://10.1.2.3/admin", false),
			None
		);
		assert_eq!(
			routed("https://example.com/", "javascript:alert(1)", true),
			None
		);
		assert_eq!(
			routed("https://example.com/", "file:///etc/passwd", true),
			None
		);
	}

	#[test]
	fn relative_links_resolve_against_the_page() {
		let base = "http://example.com/a/b/c";
		let routed_url = routed(base, "d.html", true).unwrap();
		assert!(routed_url.starts_with(&gateway_url()), "{routed_url}");
		assert!(
			routed_url.contains("u=http%3A%2F%2Fexample.com%2Fa%2Fb%2Fd.html"),
			"{routed_url}"
		);
	}

	#[test]
	fn html_survives_with_its_links_rerouted() {
		let html = r#"<html><head>
			<script>alert(1)</script>
			<link rel="stylesheet" href="/style.css">
		</head><body onload="boom()">
			<a href="/next">Next</a>
			<img src="http://example.com/pic.png" onerror="evil()">
			<iframe src="http://example.com/embed"></iframe>
			<style>body { background: url(/bg.png); }</style>
		</body></html>"#;
		let out =
			String::from_utf8(rewrite_html(html, "http://example.com/", "TESTNONCE")).unwrap();
		assert!(!out.contains("<script>alert"), "no page scripts: {out}");
		assert!(!out.contains("onload="));
		assert!(!out.contains("onerror="));
		assert!(!out.contains("<iframe"), "{out}");
		// The sentinel rides along exactly once, tagged with the nonce.
		assert_eq!(out.matches("a-coder-frame").count(), 1, "{out}");
		assert_eq!(out.matches("nonce=\"TESTNONCE\"").count(), 1, "{out}");
		// Links and styles ride the gateway.
		assert!(out.contains("u=http%3A%2F%2Fexample.com%2Fnext"), "{out}");
		assert!(
			out.contains("u=http%3A%2F%2Fexample.com%2Fstyle.css"),
			"{out}"
		);
		assert!(out.contains("u=http%3A%2F%2Fexample.com%2Fbg.png"), "{out}");
		assert!(
			out.contains("u=http%3A%2F%2Fexample.com%2Fpic.png"),
			"{out}"
		);
	}

	#[test]
	fn css_urls_reroute_and_private_ones_die() {
		let css = "a { background: url(hero.jpg); } b { background: url(http://127.0.0.1/x.png); }";
		let out = rewrite_css(css, "http://example.com/a/");
		assert!(
			out.contains("u=http%3A%2F%2Fexample.com%2Fa%2Fhero.jpg"),
			"{out}"
		);
		assert!(out.contains("about:invalid"), "{out}");
	}
}

/// A server may ignore `identity` and send gzip unrequested; the gateway
/// then rewrites the DECODED bytes, so the frame reads real HTML.
#[cfg(test)]
mod encoding_tests {
	use super::*;
	use std::io::Write as _;

	#[test]
	fn unrequested_gzip_html_decodes_for_the_rewrites() {
		let mut encoder = flate2::write::GzEncoder::new(
			Vec::new(),
			flate2::Compression::default(),
		);
		encoder.write_all(b"<html><body>real</body></html>").unwrap();
		let gzipped = encoder.finish().unwrap();
		let decoded = decode_with(flate2::read::GzDecoder::new(&gzipped[..])).unwrap();
		assert_eq!(
			String::from_utf8_lossy(&decoded),
			"<html><body>real</body></html>"
		);
	}
}

/// Decodes an entire stream with a reader over the given compressed bytes.
fn decode_with<R: std::io::Read>(mut reader: R) -> Result<Vec<u8>, String> {
	let mut decoded = Vec::new();
	reader
		.read_to_end(&mut decoded)
		.map_err(|_| "cannot undo the page's compression".to_string())?;
	Ok(decoded)
}
