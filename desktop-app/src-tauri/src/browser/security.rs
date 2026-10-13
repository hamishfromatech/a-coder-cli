//! Security policy for browser-panel pages. Pages are untrusted inputs: the
//! navigation allow-list, private-address refusal and reportability limits
//! here are the only things standing between a page and the app's trusted
//! surface.

use std::net::IpAddr;
use url::{Host, Url};

/// A URL longer than this would leave the panel's address bar showing the last
/// page's, so refuse to report it (and refuse the navigation: a page may lie by
/// omission). Generous; real links stay far below.
pub const MAX_REPORTABLE_URL: usize = 2048;

/// Schemes a page may hand the OS instead of loading (mailto:, tel:, …). The
/// panel opens these with the user's default handler, never in-app.
const EXTERNAL_SCHEMES: [&str; 6] = [
	"mailto",
	"tel",
	"sms",
	"facetime",
	"facetime-audio",
	"callto",
];

/// A navigable URL: http(s) only, parsed, with a host. Returns `Err` for
/// everything else (file: would drive reading local paths through WebKit's
/// file entitlement; about: is ours to issue, not the page's).
pub fn page_url(input: &str) -> Result<Url, String> {
	let url = Url::parse(input).map_err(|error| format!("Bad address: {error}"))?;
	let scheme = url.scheme();
	if scheme != "http" && scheme != "https" {
		return Err("Only http and https pages load in the panel".into());
	}
	if url.host_str().is_none() {
		return Err("The address has no host".into());
	}
	Ok(url)
}

/// Whether a URL is allowed to load in a page view: http(s) to a public host.
/// The host text is checked here; the proxy re-checks every resolved address,
/// so a rebinding DNS answer still cannot reach a private one.
pub fn navigation_allowed(url: &Url) -> bool {
	if !matches!(url.scheme(), "http" | "https") {
		return false;
	}
	match url.host() {
		Some(host) => !host_is_private(&host),
		None => false,
	}
}

/// Whether the URL should be handed the OS instead of loaded (mailto:, tel:, …).
pub fn is_external_handoff(url: &Url) -> bool {
	EXTERNAL_SCHEMES.contains(&url.scheme())
}

/// Whether the panel may display this address (length cap). Navigations too
/// large to report are refused outright, in both the allow-list and the
/// page-load reporter.
pub fn reportable(url: &str) -> bool {
	url.len() <= MAX_REPORTABLE_URL
}

/// Whether a host *literal* or name is private by inspection (DNS not consulted).
pub fn host_is_private(host: &Host<&str>) -> bool {
	match *host {
		Host::Ipv4(ip) => ip_is_private(&IpAddr::V4(ip)),
		Host::Ipv6(ip) => ip_is_private(&IpAddr::V6(ip)),
		Host::Domain(name) => {
			let name = name.to_ascii_lowercase();
			// The well-known private name spaces: mDNS (.local) can resolve to
			// anything on the link, and .internal/.home.arpa are reserved for
			// behind-the-firewall use.
			name == "localhost"
				|| name.ends_with(".localhost")
				|| name.ends_with(".local")
				|| name.ends_with(".internal")
				|| name.ends_with(".home.arpa")
		}
	}
}

fn v4_is_private(octets: [u8; 4]) -> bool {
	let [o0, o1, _, _] = octets;
	// 0/8 "this network" (0.0.0.0 targets the host), 127/8 loopback,
	// 10/8, 172.16/12, 192.168/16 private-use, 169.254/16 link-local,
	// 100.64/10 carrier NAT, 224/4 multicast, 240/4 reserved + broadcast.
	o0 == 0
		|| o0 == 127
		|| o0 == 10
		|| (o0 == 172 && o1 & 0xf0 == 16)
		|| (o0 == 192 && o1 == 168)
		|| (o0 == 169 && o1 == 254)
		|| (o0 == 100 && o1 & 0xc0 == 64)
		|| o0 & 0xf0 == 224
		|| o0 >= 240
}

/// Whether an IP must never be reachable from a page: loopback, link-local,
/// private-use, unique-local, multicast, broadcast, unspecified and the IPv4
/// ranges above. The app's own loopback servers live in there.
pub fn ip_is_private(ip: &IpAddr) -> bool {
	match *ip {
		IpAddr::V4(ipv4) => v4_is_private(ipv4.octets()),
		IpAddr::V6(ipv6) => {
			if ipv6.is_loopback() || ipv6.is_unspecified() {
				return true;
			}
			// IPv4-mapped (::ffff:a.b.c.d) and IPv4-compatible (::a.b.c.d)
			// addresses take the IPv4 verdict, so ::ffff:127.0.0.1 cannot
			// dress up as public.
			if let Some(mapped) = ipv6.to_ipv4_mapped() {
				return v4_is_private(mapped.octets());
			}
			if let Some(v4) = ipv6.to_ipv4() {
				return v4_is_private(v4.octets());
			}
			// unique-local fc00::/7, link-local fe80::/10, multicast ff00::/8.
			let octets = ipv6.octets();
			octets[0] & 0xfe == 0xfc
				|| (octets[0] == 0xfe && octets[1] & 0xc0 == 0x80)
				|| octets[0] == 0xff
		}
	}
}

#[cfg(test)]
mod tests {
	use super::*;
	use std::net::Ipv6Addr;

	fn allowed(address: &str) -> bool {
		Url::parse(address)
			.map(|url| navigation_allowed(&url))
			.unwrap_or(false)
	}

	#[test]
	fn https_pages_load_and_other_schemes_do_not() {
		assert!(allowed("https://example.com/"));
		assert!(allowed("http://example.com/a?b=1"));
		assert!(!allowed("file:///etc/passwd"));
		assert!(!allowed("about:blank"));
		assert!(!allowed("javascript:alert(1)"));
		assert!(!allowed("data:text/html,hi"));
		assert!(!allowed("not a url"));
	}

	#[test]
	fn private_hosts_are_refused_however_written() {
		for address in [
			"http://localhost/",
			"http://app.localhost/",
			"http://127.0.0.1/",
			"http://[::1]/",
			"http://[::ffff:127.0.0.1]/",
			"http://10.0.0.1/",
			"http://192.168.1.4/",
			"http://172.16.4.9/",
			"http://169.254.1.1/",
			"http://[fe80::1]/",
			"http://[fc00::1]/",
			"http://0.0.0.0/",
			"http://100.64.0.1/",
			"http://224.0.0.1/",
			"http://255.255.255.255/",
		] {
			assert!(!allowed(address), "{address}");
		}
		assert!(allowed("https://example.com/"));
		assert!(allowed("http://8.8.8.8/"));
		assert!(allowed("http://100.128.0.1/"));
	}

	#[test]
	fn external_schemes_are_handoffs() {
		let mail = Url::parse("mailto:hi@example.com").unwrap();
		let tel = Url::parse("tel:+15551234567").unwrap();
		let page = Url::parse("https://example.com/").unwrap();
		assert!(is_external_handoff(&mail));
		assert!(is_external_handoff(&tel));
		assert!(!is_external_handoff(&page));
	}

	#[test]
	fn oversized_urls_are_not_reportable() {
		assert!(reportable("https://example.com/"));
		let long = format!("https://example.com/?p={}", "x".repeat(MAX_REPORTABLE_URL));
		assert!(!reportable(&long));
	}

	#[test]
	fn ipv6_addresses_take_their_ipv4_verdict() {
		assert!(ip_is_private(&IpAddr::V6(Ipv6Addr::new(
			0, 0, 0, 0, 0, 0xffff, 0x0a00, 1
		))));
		assert!(ip_is_private(&IpAddr::V6(Ipv6Addr::new(
			0, 0, 0, 0, 0, 0, 0x7f00, 1
		))));
		assert!(!ip_is_private(&IpAddr::V6(Ipv6Addr::new(
			0, 0, 0, 0, 0, 0xffff, 0x0808, 0x0808
		))));
		assert!(ip_is_private(&IpAddr::V6(Ipv6Addr::LOCALHOST)));
		assert!(!ip_is_private(&IpAddr::V6(Ipv6Addr::new(
			0x2606, 0x4700, 0, 0, 0, 0, 0, 0x4700
		))));
	}
}
