//! Voice mode HTTP helpers. The webview's `fetch` to external STT/TTS
//! endpoints is subject to CORS (providers don't return headers for the
//! `tauri://` origin), so we proxy the requests through Rust with `reqwest`.
//! This makes any OpenAI-compatible endpoint work regardless of CORS.

use base64::Engine;
use serde::Deserialize;

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct VoiceSettings {
	pub voice_stt_base_url: String,
	pub voice_stt_api_key: String,
	pub voice_stt_model: String,
	pub voice_tts_base_url: String,
	pub voice_tts_api_key: String,
	pub voice_tts_model: String,
	pub voice_tts_voice: String,
}

/// Normalize a user base URL to end with `/v1` (no trailing slash). Accepts a
/// bare host, a `/v1` base, or a full `/v1/audio/speech` URL.
fn normalize_base_url(raw: &str) -> Result<String, String> {
	let mut url = raw.trim().trim_end_matches('/').to_string();
	if url.is_empty() {
		return Err("Base URL is not configured".to_string());
	}
	if let Some(stripped) = url.strip_suffix("/audio/speech").or_else(|| url.strip_suffix("/audio/transcriptions")) {
		url = stripped.to_string();
	}
	if !url.to_lowercase().ends_with("/v1") {
		url.push_str("/v1");
	}
	Ok(url)
}

fn bearer(api_key: &str) -> Option<String> {
	let key = api_key.trim();
	if key.is_empty() {
		None
	} else {
		Some(format!("Bearer {}", key))
	}
}

/// Transcribe a base64-encoded audio recording via POST {base}/audio/transcriptions.
/// Returns the transcribed text.
#[tauri::command]
pub async fn voice_transcribe(
	audio_base64: String,
	mime_type: String,
	settings: VoiceSettings,
) -> Result<String, String> {
	let base = normalize_base_url(&settings.voice_stt_base_url)?;
	let bytes = base64::engine::general_purpose::STANDARD
		.decode(audio_base64.trim())
		.map_err(|e| format!("Invalid audio data: {}", e))?;

	let ext = if mime_type.contains("webm") {
		"webm"
	} else if mime_type.contains("ogg") {
		"ogg"
	} else if mime_type.contains("wav") {
		"wav"
	} else {
		"bin"
	};
	let mime = if mime_type.is_empty() { "application/octet-stream" } else { &mime_type };

	let part = reqwest::multipart::Part::bytes(bytes)
		.file_name(format!("recording.{}", ext))
		.mime_str(mime)
		.map_err(|e| e.to_string())?;
	let form = reqwest::multipart::Form::new()
		.text("model", if settings.voice_stt_model.trim().is_empty() { "whisper-1".to_string() } else { settings.voice_stt_model })
		.text("response_format", "json")
		.part("file", part);

	let client = reqwest::Client::new();
	let mut req = client
		.post(format!("{}/audio/transcriptions", base))
		.multipart(form);
	if let Some(auth) = bearer(&settings.voice_stt_api_key) {
		req = req.header("Authorization", auth);
	}

	let res = req.send().await.map_err(|e| format!("Transcription failed: {}", e))?;
	if !res.status().is_success() {
		let status = res.status();
		let body = res.text().await.unwrap_or_default();
		return Err(format!("Transcription failed: {} {} {}", status.as_u16(), status.canonical_reason().unwrap_or(""), body));
	}
	let text = res.text().await.map_err(|e| e.to_string())?;
	// response_format=json returns { "text": "..." }; be lenient about plain text.
	match serde_json::from_str::<serde_json::Value>(&text) {
		Ok(v) => Ok(v.get("text").and_then(|t| t.as_str()).unwrap_or(&text).to_string()),
		Err(_) => Ok(text),
	}
}

/// Synthesize speech via POST {base}/audio/speech. Returns base64-encoded audio.
#[tauri::command]
pub async fn voice_synthesize(text: String, settings: VoiceSettings) -> Result<String, String> {
	let base = normalize_base_url(&settings.voice_tts_base_url)?;
	if text.trim().is_empty() {
		return Err("Nothing to synthesize".to_string());
	}
	let body = serde_json::json!({
		"model": if settings.voice_tts_model.trim().is_empty() { "gpt-4o-mini-tts" } else { &settings.voice_tts_model },
		"input": text,
		"voice": if settings.voice_tts_voice.trim().is_empty() { "alloy" } else { &settings.voice_tts_voice },
		"response_format": "mp3",
		"speed": 1,
	});

	let client = reqwest::Client::new();
	let mut req = client
		.post(format!("{}/audio/speech", base))
		.header("Content-Type", "application/json")
		.json(&body);
	if let Some(auth) = bearer(&settings.voice_tts_api_key) {
		req = req.header("Authorization", auth);
	}

	let res = req.send().await.map_err(|e| format!("Speech synthesis failed: {}", e))?;
	if !res.status().is_success() {
		let status = res.status();
		let body = res.text().await.unwrap_or_default();
		return Err(format!("Speech synthesis failed: {} {} {}", status.as_u16(), status.canonical_reason().unwrap_or(""), body));
	}
	let bytes = res.bytes().await.map_err(|e| e.to_string())?;
	Ok(base64::engine::general_purpose::STANDARD.encode(&bytes))
}