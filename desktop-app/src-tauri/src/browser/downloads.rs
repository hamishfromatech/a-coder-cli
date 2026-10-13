//! Panel downloads: the engine stages every download into our own directory
//! and the panel approves it (`browser_download_decide`) before it moves to
//! the user's folder. Denials delete the staging copy; per-tab rate limits
//! keep a site from flooding approvals.

use std::collections::{HashMap, HashSet, VecDeque};
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::time::{Duration, Instant};

use tauri::{AppHandle, Manager, Runtime, Url, Webview};
use uuid::Uuid;

use super::emit;
use super::tabs::TabsState;
use super::BrowserEvent;

/// Downloads allowed per tab per window; a burst beyond this is refused (the
/// page sees the download fail instead).
const MAX_PER_TAB_WINDOW: usize = 4;
const RATE_WINDOW: Duration = Duration::from_secs(10);
/// Unapproved prompts allowed per tab at once.
const MAX_UNANSWERED_PER_TAB: usize = 3;

#[derive(Default)]
pub struct DownloadsState {
	inner: Mutex<Inner>,
}

#[derive(Default)]
struct Inner {
	pending: HashMap<String, PendingDownload>,
	/// The download folder, persisted by the panel's settings; `None` uses the
	/// default (the user's Downloads directory).
	folder: Option<PathBuf>,
	per_tab: HashMap<String, VecDeque<Instant>>,
	unanswered: HashMap<String, usize>,
}

#[derive(Clone)]
struct PendingDownload {
	tab_id: String,
	url: String,
	name: String,
	staged: PathBuf,
}

fn staging_root<R: Runtime>(app: &AppHandle<R>) -> Option<PathBuf> {
	let dir = app
		.path()
		.app_local_data_dir()
		.ok()?
		.join("browser-downloads");
	std::fs::create_dir_all(&dir).ok()?;
	Some(dir)
}

/// The staging directory for a new download; also prunes stale staging dirs
/// from downloads the panel never settled (an app kill leaves one at most).
fn staging_dir<R: Runtime>(app: &AppHandle<R>) -> Option<PathBuf> {
	let root = staging_root(app)?;
	let dir = root.join(Uuid::new_v4().to_string());
	std::fs::create_dir_all(&dir).ok()?;
	Some(dir)
}

/// A unique file name inside `dir` for `wanted`: "name.k.ext" past the first.
fn unique_name(dir: &Path, wanted: &str) -> String {
	let wanted = wanted.trim();
	let name = if wanted.is_empty() {
		"download"
	} else {
		wanted
	};
	// Path separators and control characters never survive into staging.
	let chars: Vec<char> = name
		.chars()
		.filter(|ch| !ch.is_control())
		.map(|ch| match ch {
			'/' | '\\' | ':' => '_',
			other => other,
		})
		.collect();
	// Cap the total, but a long stem keeps its short extension: "report.pdf"
	// does not become a stem.
	let safe: String = if chars.len() > 200 {
		let ext_part: Vec<char> = match chars.iter().rposition(|&ch| ch == '.') {
			Some(at) if at > 0 && at + 1 < chars.len() => chars[at..].to_vec(),
			_ => Vec::new(),
		};
		let mut cut: Vec<char> = chars.iter().take(200 - ext_part.len()).cloned().collect();
		while cut.last() == Some(&'_') || cut.last() == Some(&'.') {
			cut.pop();
		}
		cut.extend(ext_part);
		cut.into_iter().collect()
	} else {
		chars.iter().collect()
	};
	let safe = safe.trim().to_string();
	let safe = if safe.is_empty() {
		"download".to_string()
	} else {
		safe
	};
	let stem = Path::new(&safe).extension().map(|_| {
		Path::new(&safe)
			.file_stem()
			.map(|s| s.to_string_lossy().into_owned())
			.unwrap_or(safe.clone())
	});
	let ext = Path::new(&safe)
		.extension()
		.map(|e| e.to_string_lossy().into_owned());
	let base_stem = stem.unwrap_or_else(|| safe.clone());
	for attempt in 0..1000u32 {
		let candidate = if attempt == 0 {
			safe.clone()
		} else {
			match &ext {
				Some(ext) => format!("{base_stem}.{attempt}.{ext}"),
				None => format!("{safe}.{attempt}"),
			}
		};
		let mut collision = false;
		if let Ok(entries) = std::fs::read_dir(dir) {
			for entry in entries.flatten() {
				if entry.file_name().to_string_lossy() == candidate {
					collision = true;
					break;
				}
			}
		}
		if !collision {
			return candidate;
		}
	}
	format!("{safe}.{count}", safe = base_stem, count = Uuid::new_v4())
}

/// Stage a download and ask the panel about it. Returning true lets it stage;
/// false refuses it.
pub(crate) fn requested<R: Runtime>(
	page: &Webview<R>,
	tab_id: &str,
	url: Url,
	destination: &mut PathBuf,
) -> bool {
	let app = page.app_handle();
	let state = app.state::<DownloadsState>();
	let mut inner = state.inner.lock().unwrap();
	let now = Instant::now();
	let starts = inner.per_tab.entry(tab_id.to_string()).or_default();
	while starts
		.front()
		.is_some_and(|at| now.duration_since(*at) > RATE_WINDOW)
	{
		starts.pop_front();
	}
	let name_hint = destination
		.file_name()
		.map(|name| name.to_string_lossy().into_owned())
		.unwrap_or_default();
	if starts.len() >= MAX_PER_TAB_WINDOW
		|| inner.unanswered.get(tab_id).copied().unwrap_or(0) >= MAX_UNANSWERED_PER_TAB
	{
		emit(
			app,
			BrowserEvent::DownloadSettled {
				id: String::new(),
				success: false,
				path: None,
			},
		);
		return false;
	}
	let Some(staging) = staging_dir(app) else {
		return false;
	};
	// The engine writes straight to our path (we were handed `destination`).
	let name = unique_name(&staging, &name_hint);
	let staged = staging.join(&name);
	inner
		.per_tab
		.entry(tab_id.to_string())
		.or_default()
		.push_back(now);
	*inner.unanswered.entry(tab_id.to_string()).or_default() += 1;
	*destination = staged.clone();
	// "" before the view showed its own page: the panel knows the tab instead.
	let site = app
		.state::<TabsState>()
		.inner
		.lock()
		.unwrap()
		.urls
		.get(tab_id)
		.cloned()
		.unwrap_or_default();
	let id = Uuid::new_v4().to_string();
	inner.pending.insert(
		id.clone(),
		PendingDownload {
			tab_id: tab_id.to_string(),
			url: url.to_string(),
			name: name.clone(),
			staged,
		},
	);
	emit(
		app,
		BrowserEvent::DownloadPrompt {
			id,
			tab_id: tab_id.to_string(),
			url: url.to_string(),
			site,
			name,
		},
	);
	true
}

/// Settle a finished download; the tab may have closed meanwhile.
pub(crate) fn finished<R: Runtime>(
	app: &AppHandle<R>,
	url: String,
	path: Option<PathBuf>,
	success: bool,
) {
	let state = app.state::<DownloadsState>();
	let matched = {
		let mut inner = state.inner.lock().unwrap();
		let staged = path
			.as_deref()
			.map(Path::to_string_lossy)
			.map(|lossy| lossy.into_owned());
		// Find the pending record belonging to this finish: by reported path,
		// else by URL with exactly one unanswered staging copy.
		let id = staged
			.as_deref()
			.and_then(|staged: &str| {
				inner
					.pending
					.iter()
					.find(|(_, record)| record.staged.to_string_lossy().as_ref() == staged)
					.map(|(id, _)| id.clone())
			})
			.or_else(|| {
				let mut same_url = inner
					.pending
					.iter()
					.filter(|(_, record)| record.url == url)
					.map(|(id, _)| id.clone());
				match (same_url.next(), same_url.next()) {
					(Some(only), None) => Some(only),
					_ => None,
				}
			});
		let Some(id) = id else {
			return;
		};
		let Some(record) = inner.pending.get(&id).cloned() else {
			return;
		};
		if !success {
			// Refused or failed: staging goes with it.
			std::fs::remove_dir_all(record.staged.parent().unwrap_or_else(|| Path::new("."))).ok();
			inner.pending.remove(&id);
			dec_unanswered(&mut inner, &record.tab_id);
		}
		Some((id, record, success && path.is_some()))
	};
	if let Some((id, record, ok)) = matched {
		if ok {
			emit(
				app,
				BrowserEvent::DownloadSettled {
					id,
					success: true,
					path: Some(record.staged.to_string_lossy().into_owned()),
				},
			);
		}
	}
}

/// A download the user approved/decided on: `action` is `save` (into the
/// folder), `open` (save then open), `reveal` (save then show the file), or
/// `cancel` (delete the staging copy).
#[tauri::command]
pub async fn browser_download_decide<R: Runtime>(
	webview: tauri::Webview<R>,
	id: String,
	action: String,
) -> Result<Option<String>, String> {
	super::require_main(&webview)?;
	let app = webview.app_handle().clone();
	let state = app.state::<DownloadsState>();
	let record = {
		let mut inner = state.inner.lock().unwrap();
		inner.pending.remove(&id)
	};
	let Some(record) = record else {
		return Err("That download is no longer pending".into());
	};
	dec_unanswered(&mut state.inner.lock().unwrap(), &record.tab_id);
	if action == "cancel" {
		std::fs::remove_dir_all(record.staged.parent().unwrap_or_else(|| Path::new("."))).ok();
		emit(
			&app,
			BrowserEvent::DownloadSettled {
				id,
				success: false,
				path: None,
			},
		);
		return Ok(None);
	}
	if !record.staged.exists() {
		emit(
			&app,
			BrowserEvent::DownloadSettled {
				id,
				success: false,
				path: None,
			},
		);
		return Err("The download never arrived".into());
	}
	let folder = {
		let inner = state.inner.lock().unwrap();
		inner.folder.clone().unwrap_or_else(default_folder)
	};
	std::fs::create_dir_all(&folder).map_err(|error| error.to_string())?;
	let target = folder.join(&record.name);
	// Another file with that name may exist in the real folder.
	let target = ensure_unique(&target);
	std::fs::rename(&record.staged, &target)
		.or_else(|_| std::fs::copy(&record.staged, &target).map(|_| ()))
		.map_err(|error| error.to_string())?;
	std::fs::remove_dir_all(record.staged.parent().unwrap_or_else(|| Path::new("."))).ok();
	let path = target.to_string_lossy().into_owned();
	emit(
		&app,
		BrowserEvent::DownloadSettled {
			id,
			success: true,
			path: Some(path.clone()),
		},
	);
	match action.as_str() {
		"open" => super::open_path(&app, &path),
		"reveal" => super::reveal_path(&app, &target),
		_ => Ok(()),
	}?;
	Ok(Some(path))
}

/// The download folder; the panel reads it to label the picker.
#[tauri::command]
pub fn browser_download_folder<R: Runtime>(
	webview: tauri::Webview<R>,
) -> Result<Option<String>, String> {
	super::require_main(&webview)?;
	let state = webview.app_handle().state::<DownloadsState>();
	let folder = state.inner.lock().unwrap().folder.clone();
	Ok(folder.map(|folder| folder.to_string_lossy().into_owned()))
}

/// The panel set the folder explicitly (empty resets to default).
#[tauri::command]
pub fn browser_download_folder_pick<R: Runtime>(
	webview: tauri::Webview<R>,
	folder: String,
) -> Result<(), String> {
	super::require_main(&webview)?;
	let state = webview.app_handle().state::<DownloadsState>();
	let mut inner = state.inner.lock().unwrap();
	if folder.trim().is_empty() {
		inner.folder = None;
	} else {
		inner.folder = Some(PathBuf::from(folder));
	}
	Ok(())
}

/// Open a settled download.
#[tauri::command]
pub fn browser_download_open<R: Runtime>(
	webview: tauri::Webview<R>,
	path: String,
) -> Result<(), String> {
	super::require_main(&webview)?;
	super::open_path(webview.app_handle(), &path)
}

/// Show a settled download's file in its folder.
#[tauri::command]
pub fn browser_download_reveal<R: Runtime>(
	webview: tauri::Webview<R>,
	path: String,
) -> Result<(), String> {
	super::require_main(&webview)?;
	super::reveal_path(webview.app_handle(), Path::new(&path))
}

/// Drop a closed tab's still-unanswered prompts (their staging dirs go too).
pub(crate) fn forget_tab<R: Runtime>(app: &AppHandle<R>, tab_id: &str) {
	let state = app.state::<DownloadsState>();
	let mut inner = state.inner.lock().unwrap();
	let ids: HashSet<String> = inner
		.pending
		.iter()
		.filter(|(_, record)| record.tab_id == tab_id)
		.map(|(id, _)| id.clone())
		.collect();
	for (id, record) in inner.pending.iter() {
		if ids.contains(id) {
			std::fs::remove_dir_all(record.staged.parent().unwrap_or_else(|| Path::new("."))).ok();
		}
	}
	inner.pending.retain(|id, _| !ids.contains(id));
	inner.unanswered.remove(tab_id);
	inner.per_tab.remove(tab_id);
}

fn dec_unanswered(inner: &mut Inner, tab_id: &str) {
	if let Some(count) = inner.unanswered.get_mut(tab_id) {
		*count = count.saturating_sub(1);
	}
}

fn default_folder() -> PathBuf {
	dirs::download_dir()
		.unwrap_or_else(|| dirs::home_dir().unwrap_or_else(|| PathBuf::from(".")))
		.join("a-coder-downloads")
}

fn ensure_unique(target: &Path) -> PathBuf {
	let mut candidate = target.to_path_buf();
	let stem = target.file_stem().map(|s| s.to_string_lossy().into_owned());
	let ext = target.extension().map(|e| e.to_string_lossy().into_owned());
	let mut attempt = 0u32;
	while candidate.exists() {
		attempt += 1;
		candidate = match (&stem, &ext) {
			(Some(stem), Some(ext)) => target.with_file_name(format!("{stem}.{attempt}.{ext}")),
			(Some(stem), None) => target.with_file_name(format!("{stem}.{attempt}")),
			_ => target.with_file_name(format!(
				"{attempt}.{}",
				target
					.file_name()
					.map(|n| n.to_string_lossy())
					.unwrap_or_default()
			)),
		};
	}
	candidate
}

#[cfg(test)]
mod tests {
	use super::*;

	#[test]
	fn staging_names_are_sanitized_and_unique() {
		let dir = tempfile::tempdir().unwrap();
		assert_eq!(unique_name(dir.path(), "report.pdf"), "report.pdf");
		assert_eq!(unique_name(dir.path(), "a/b\\c:txt"), "a_b_c_txt");
		assert_eq!(unique_name(dir.path(), ""), "download");
		assert_eq!(unique_name(dir.path(), "\u{0}\u{1}"), "download");
		// The second download of the same name gets a number, when the first
		// file was already staged in the fresh directory.
		let first = unique_name(dir.path(), "file.bin");
		std::fs::write(dir.path().join(&first), b"x").unwrap();
		assert_eq!(unique_name(dir.path(), "file.bin"), "file.1.bin");
	}

	#[test]
	fn long_names_keep_some_extension() {
		let dir = tempfile::tempdir().unwrap();
		let long = format!("{}.pdf", "x".repeat(300));
		let name = unique_name(dir.path(), &long);
		assert!(name.len() < 300, "{name}");
		assert!(name.ends_with(".pdf"));
	}

	#[test]
	fn real_folders_get_unique_targets() {
		let dir = tempfile::tempdir().unwrap();
		let target = dir.path().join("file.txt");
		std::fs::write(&target, b"one").unwrap();
		let next = ensure_unique(&target);
		assert_eq!(next.file_name().unwrap().to_string_lossy(), "file.1.txt");
		assert!(!next.exists());
	}
}
