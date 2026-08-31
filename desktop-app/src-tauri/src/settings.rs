use std::path::{Path, PathBuf};
use std::process::Command;

use serde::{Deserialize, Serialize};
use serde_json::Value;

const CONFIG_DIR_NAME: &str = ".a-coder-cli";
/// User-scope config root shared across A-Coder products (`~/.a-coder/cli`),
/// mirroring the engine's `USER_CONFIG_DIR_NAME`. Holds agent/, teams/ and
/// MEMORY.md. Project-scope dirs keep CONFIG_DIR_NAME.
const USER_CONFIG_DIR: (&str, &str) = (".a-coder", "cli");
const AGENT_DIR: &str = "agent";

pub fn home_dir() -> Result<PathBuf, String> {
    if cfg!(windows) {
        std::env::var("USERPROFILE")
            .or_else(|_| std::env::var("HOME"))
            .map_err(|_| "USERPROFILE or HOME not set".to_string())
    } else {
        std::env::var("HOME").map_err(|_| "HOME not set".to_string())
    }
    .map(PathBuf::from)
}

/// Resolve the user-scope config root. Prefers `~/.a-coder/cli`; falls back to
/// the legacy flat `~/.a-coder-cli` when it still holds the data (the engine
/// migrates it to the nested root on its next startup).
fn user_config_root() -> Result<PathBuf, String> {
    let home = home_dir()?;
    let new_root = home.join(USER_CONFIG_DIR.0).join(USER_CONFIG_DIR.1);
    if new_root.exists() {
        return Ok(new_root);
    }
    let legacy = home.join(CONFIG_DIR_NAME);
    if legacy.exists() {
        return Ok(legacy);
    }
    Ok(new_root)
}

fn agent_dir() -> Result<PathBuf, String> {
    Ok(user_config_root()?.join(AGENT_DIR))
}

pub fn global_settings_path() -> Result<PathBuf, String> {
    Ok(agent_dir()?.join("settings.json"))
}

pub fn global_auth_path() -> Result<PathBuf, String> {
    Ok(agent_dir()?.join("auth.json"))
}

pub fn global_subagents_path() -> Result<PathBuf, String> {
    Ok(agent_dir()?.join("subagents.json"))
}

/// Root directory for Agent Teams state (`~/.a-coder/cli/teams`). Honors the
/// same `A-CODER-CLI_TEAMS_DIR` override the coding-agent reads so dev/test
/// installs stay in sync.
pub fn global_teams_root() -> Result<PathBuf, String> {
    if let Ok(dir) = std::env::var("A-CODER-CLI_TEAMS_DIR") {
        if !dir.trim().is_empty() {
            return Ok(PathBuf::from(dir));
        }
    }
    Ok(user_config_root()?.join("teams"))
}

fn sanitize_member_name(name: &str) -> String {
    name.chars()
        .map(|c| {
            if c.is_ascii_alphanumeric() {
                c.to_ascii_lowercase()
            } else {
                '-'
            }
        })
        .collect()
}

fn unread_teammate_count(team_dir: &Path, member_name: &str) -> usize {
    let inbox = team_dir
        .join("inboxes")
        .join(format!("{}.json", sanitize_member_name(member_name)));
    let Ok(bytes) = std::fs::read(&inbox) else {
        return 0;
    };
    let Ok(value) = serde_json::from_slice::<Value>(&bytes) else {
        return 0;
    };
    value
        .as_array()
        .map(|messages| {
            messages
                .iter()
                .filter(|m| m.get("read").and_then(Value::as_bool) != Some(true))
                .count()
        })
        .unwrap_or(0)
}

pub fn global_models_path() -> Result<PathBuf, String> {
    Ok(agent_dir()?.join("models.json"))
}

pub fn global_keybindings_path() -> Result<PathBuf, String> {
    Ok(agent_dir()?.join("keybindings.json"))
}

const MEMORY_FILE_NAME: &str = "MEMORY.md";

pub fn global_memory_path() -> Result<PathBuf, String> {
    Ok(user_config_root()?.join(MEMORY_FILE_NAME))
}

pub fn project_settings_path(cwd: &str) -> PathBuf {
    PathBuf::from(cwd).join(".a-coder-cli").join("settings.json")
}

/// Per-project trust marker persisted by the desktop so the "ask" trust
/// decision is remembered across sessions. Lives in the project's
/// `.a-coder-cli` directory.
pub fn project_trust_path(cwd: &str) -> PathBuf {
    PathBuf::from(cwd).join(".a-coder-cli").join("trusted")
}

#[derive(Debug, Serialize)]
pub struct SettingsPaths {
    pub global: String,
    pub project: Option<String>,
    pub auth: String,
    pub models: String,
    pub agent_dir: String,
}

#[derive(Debug, Deserialize)]
pub struct PathsArgs {
    pub cwd: Option<String>,
}

#[tauri::command]
pub fn get_settings_paths(args: PathsArgs) -> Result<SettingsPaths, String> {
    let agent = agent_dir()?;
    let global = global_settings_path()?;
    let auth = global_auth_path()?;
    let models = global_models_path()?;
    let project = args.cwd.filter(|c| !c.is_empty()).map(|c| {
        project_settings_path(&c)
            .to_string_lossy()
            .into_owned()
    });
    Ok(SettingsPaths {
        global: global.to_string_lossy().into_owned(),
        project,
        auth: auth.to_string_lossy().into_owned(),
        models: models.to_string_lossy().into_owned(),
        agent_dir: agent.to_string_lossy().into_owned(),
    })
}

#[derive(Debug, Deserialize)]
pub struct ReadFileArgs {
    pub scope: String,
    pub cwd: Option<String>,
}

fn read_json(path: &Path) -> Result<Value, String> {
    if !path.exists() {
        return Ok(Value::Null);
    }
    let bytes = std::fs::read(path).map_err(|e| format!("read {}: {e}", path.display()))?;
    if bytes.is_empty() {
        return Ok(Value::Null);
    }
    serde_json::from_slice::<Value>(&bytes)
        .map_err(|e| format!("parse {}: {e}", path.display()))
}

fn write_json(path: &Path, value: &Value) -> Result<(), String> {
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)
            .map_err(|e| format!("mkdir {}: {e}", parent.display()))?;
    }
    // Preserve auth.json's 0600 permissions by writing then chmod'ing if the
    // file already exists.
    let _existed = path.exists();
    let serialized = serde_json::to_string_pretty(value)
        .map_err(|e| format!("serialize: {e}"))?;
    std::fs::write(path, serialized).map_err(|e| format!("write {}: {e}", path.display()))?;

    // a-coder-cli writes auth.json with 0600 (user read/write only). Mirror
    // that when the file already had restricted perms so secrets don't leak.
    #[cfg(unix)]
    if _existed && path.ends_with("auth.json") {
        use std::os::unix::fs::PermissionsExt;
        let _ = std::fs::set_permissions(path, std::fs::Permissions::from_mode(0o600));
    }

    Ok(())
}

#[tauri::command]
pub fn read_settings_file(args: ReadFileArgs) -> Result<Value, String> {
    let path = match args.scope.as_str() {
        "global" => global_settings_path()?,
        "project" => {
            let cwd = args
                .cwd
                .ok_or_else(|| "cwd required for project scope".to_string())?;
            if cwd.is_empty() {
                return Ok(Value::Null);
            }
            project_settings_path(&cwd)
        }
        other => return Err(format!("unknown scope: {other}")),
    };
    read_json(&path)
}

#[derive(Debug, Deserialize)]
pub struct WriteFileArgs {
    pub scope: String,
    pub cwd: Option<String>,
    pub value: Value,
}

#[tauri::command]
pub fn write_settings_file(args: WriteFileArgs) -> Result<(), String> {
    let path = match args.scope.as_str() {
        "global" => global_settings_path()?,
        "project" => {
            let cwd = args
                .cwd
                .ok_or_else(|| "cwd required for project scope".to_string())?;
            project_settings_path(&cwd)
        }
        other => return Err(format!("unknown scope: {other}")),
    };
    write_json(&path, &args.value)
}

#[tauri::command]
pub fn read_auth_file() -> Result<Value, String> {
    let path = global_auth_path()?;
    read_json(&path)
}

#[tauri::command]
pub fn read_subagents_file() -> Result<Value, String> {
    let path = global_subagents_path()?;
    read_json(&path)
}

#[tauri::command]
pub fn read_teams() -> Result<Value, String> {
    let root = global_teams_root()?;
    let entries = match std::fs::read_dir(&root) {
        Ok(e) => e,
        Err(_) => return Ok(Value::Array(Vec::new())),
    };

    let mut teams: Vec<Value> = Vec::new();
    for entry in entries.flatten() {
        let team_dir = entry.path();
        if !team_dir.is_dir() {
            continue;
        }
        let team_file = team_dir.join("team.json");
        let Ok(bytes) = std::fs::read(&team_file) else {
            continue;
        };
        let Ok(mut team) = serde_json::from_slice::<Value>(&bytes) else {
            continue;
        };
        if let Some(members) = team.get_mut("members").and_then(Value::as_array_mut) {
            for member in members.iter_mut() {
                let name = member
                    .get("name")
                    .and_then(Value::as_str)
                    .unwrap_or("")
                    .to_string();
                let unread = unread_teammate_count(&team_dir, &name);
                if let Some(obj) = member.as_object_mut() {
                    obj.insert("unread".to_string(), Value::from(unread));
                }
            }
        }
        teams.push(team);
    }

    Ok(Value::Array(teams))
}

#[derive(Debug, Deserialize)]
pub struct ProjectPathArgs {
    pub cwd: String,
}

/// Returns whether the desktop has previously recorded a trust decision for
/// the project at `cwd`. The marker file is a single byte: `1` = trusted,
/// absent = no decision yet.
#[tauri::command]
pub fn get_project_trust(args: ProjectPathArgs) -> Result<bool, String> {
    if args.cwd.is_empty() {
        return Ok(false);
    }
    Ok(project_trust_path(&args.cwd).exists())
}

/// Persist a trust decision (true) or clear it (false) for a project.
#[tauri::command]
pub fn set_project_trust(args: ProjectPathArgs, trusted: bool) -> Result<(), String> {
    if args.cwd.is_empty() {
        return Err("cwd required".to_string());
    }
    let path = project_trust_path(&args.cwd);
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)
            .map_err(|e| format!("mkdir {}: {e}", parent.display()))?;
    }
    if trusted {
        std::fs::write(&path, b"1").map_err(|e| format!("write {}: {e}", path.display()))?;
    } else if path.exists() {
        std::fs::remove_file(&path).map_err(|e| format!("remove {}: {e}", path.display()))?;
    }
    Ok(())
}

#[tauri::command]
pub fn write_auth_file(value: Value) -> Result<(), String> {
    let path = global_auth_path()?;
    write_json(&path, &value)
}

#[tauri::command]
pub fn read_models_file() -> Result<Value, String> {
    let path = global_models_path()?;
    read_json(&path)
}

#[tauri::command]
pub fn write_models_file(value: Value) -> Result<(), String> {
    let path = global_models_path()?;
    write_json(&path, &value)
}

/// Arguments for `fetch_provider_models`. Field names are camelCase so the
/// webview can pass provider objects straight through.
#[derive(Debug, Deserialize)]
pub struct FetchProviderModelsArgs {
    #[serde(rename = "baseUrl")]
    pub base_url: String,
    #[serde(rename = "apiKey")]
    #[serde(default)]
    pub api_key: Option<String>,
}

/// A model entry from a provider's `/models` endpoint, mapped onto the
/// models.json ProviderModelConfig shape. Optional fields are omitted when
/// the endpoint doesn't provide them so the UI can fall back to its defaults.
#[derive(Debug, Serialize)]
pub struct ProviderModelEntry {
    pub id: String,
    pub name: Option<String>,
    #[serde(rename = "contextWindow", skip_serializing_if = "Option::is_none")]
    pub context_window: Option<f64>,
    #[serde(rename = "maxTokens", skip_serializing_if = "Option::is_none")]
    pub max_tokens: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub reasoning: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub input: Option<Vec<String>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub cost: Option<ModelCost>,
}

#[derive(Debug, Serialize)]
pub struct ModelCost {
    pub input: f64,
    pub output: f64,
    #[serde(rename = "cacheRead")]
    pub cache_read: f64,
    #[serde(rename = "cacheWrite")]
    pub cache_write: f64,
}

/// Pull a f64 out of a JSON value held as a number or a numeric string
/// (providers commonly encode pricing as strings of per-token amounts).
fn value_as_f64(value: Option<&Value>) -> Option<f64> {
    match value? {
        Value::Number(n) => n.as_f64(),
        Value::String(s) => s.trim().parse::<f64>().ok(),
        _ => None,
    }
}

/// Fetch the model list from an OpenAI-compatible endpoint (`GET <baseUrl>/models`).
///
/// Runs on the Rust side on purpose: a `fetch()` from the webview is blocked
/// by CORS/ATS for most remote endpoints and fails with `TypeError: Load
/// failed` (WKWebView). Native HTTP has no origin restrictions, so custom
/// providers on any host can be probed from the Custom AI settings panel.
/// Map a single `/models` entry onto the models.json ProviderModelConfig shape.
/// Returns `None` for entries without a usable (non-empty string) `id`.
fn map_model_entry(entry: &Value) -> Option<ProviderModelEntry> {
    let id = entry.get("id").and_then(|v| v.as_str())?;
    if id.is_empty() {
        return None;
    }

    // Rich metadata when present: context/output limits, per-token pricing
    // (scaled to per-million), reasoning support, input types.
    let context_window =
        value_as_f64(entry.get("context_length")).filter(|v| *v > 0.0);
    let max_tokens =
        value_as_f64(entry.get("max_output_length")).filter(|v| *v > 0.0);

    // Per-token prices arrive as strings (or numbers); scale to $/M tokens.
    let scale_to_million = |v: f64| v * 1_000_000.0;
    let pricing = entry.get("pricing");
    let cost = pricing.map(|p| ModelCost {
        input: value_as_f64(p.get("prompt")).map(scale_to_million).unwrap_or(0.0),
        output: value_as_f64(p.get("completion")).map(scale_to_million).unwrap_or(0.0),
        cache_read: value_as_f64(p.get("input_cache_read")).map(scale_to_million).unwrap_or(0.0),
        cache_write: 0.0,
    });

    let reasoning = entry
        .get("supported_features")
        .and_then(|f| f.as_array())
        .map(|features| {
            features
                .iter()
                .any(|f| f.as_str().map(|s| s == "reasoning").unwrap_or(false))
        });

    let input = entry
        .get("input_modalities")
        .and_then(|m| m.as_array())
        .map(|mods| {
            // Only text/image are valid a-coder-cli inputs; keep order stable.
            let mut kinds: Vec<String> = ["text", "image"]
                .iter()
                .filter(|k| {
                    mods.iter()
                        .any(|m| m.as_str().map(|s| s == **k).unwrap_or(false))
                })
                .map(|k| k.to_string())
                .collect();
            if kinds.is_empty() {
                kinds.push("text".to_string());
            }
            kinds
        });

    Some(ProviderModelEntry {
        id: id.to_string(),
        name: entry
            .get("name")
            .and_then(|v| v.as_str())
            .map(|s| s.to_string()),
        context_window,
        max_tokens,
        reasoning,
        input,
        // Present whenever the provider reports a pricing block (even all
        // zeros), absent when the endpoint omits pricing entirely.
        cost,
    })
}

#[tauri::command]
pub async fn fetch_provider_models(
    args: FetchProviderModelsArgs,
) -> Result<Vec<ProviderModelEntry>, String> {
    let base = args.base_url.trim().trim_end_matches('/');
    if base.is_empty() {
        return Err("baseUrl required".to_string());
    }
    let url = format!("{base}/models");

    let client = reqwest::Client::builder()
        .user_agent("a-coder-desktop")
        .timeout(std::time::Duration::from_secs(30))
        .build()
        .map_err(|e| e.to_string())?;

    let mut req = client.get(&url);
    if let Some(key) = args.api_key.as_deref() {
        if !key.is_empty() && key != "not-needed" {
            req = req.bearer_auth(key);
        }
    }

    let resp = req.send().await.map_err(|e| e.to_string())?;
    let status = resp.status();
    let body = resp.text().await.unwrap_or_default();
    if !status.is_success() {
        let reason = status.canonical_reason().unwrap_or("");
        return Err(format!("Endpoint returned {} {}", status.as_u16(), reason));
    }

    let json: Value =
        serde_json::from_str(&body).map_err(|_| "Endpoint did not return JSON".to_string())?;
    let data = json
        .get("data")
        .and_then(|d| d.as_array())
        .cloned()
        .unwrap_or_default();

    let models: Vec<ProviderModelEntry> =
        data.iter().filter_map(map_model_entry).collect();
    if models.is_empty() {
        return Err("No models found at this endpoint.".to_string());
    }
    Ok(models)
}

#[tauri::command]
pub fn read_keybindings_file() -> Result<Value, String> {
    let path = global_keybindings_path()?;
    read_json(&path)
}

#[derive(Debug, Deserialize)]
pub struct WriteKeybindingsArgs {
    pub value: Value,
}

#[tauri::command]
pub fn write_keybindings_file(args: WriteKeybindingsArgs) -> Result<(), String> {
    let path = global_keybindings_path()?;
    write_json(&path, &args.value)
}

#[derive(Debug, Deserialize)]
pub struct OpenArgs {
    pub path: String,
}

#[tauri::command]
pub fn reveal_in_file_manager(args: OpenArgs) -> Result<(), String> {
    let path = PathBuf::from(&args.path);
    if !path.exists() {
        return Err(format!("path does not exist: {}", path.display()));
    }
    #[cfg(target_os = "macos")]
    {
        Command::new("open")
            .arg("-R")
            .arg(&path)
            .spawn()
            .map_err(|e| format!("open -R: {e}"))?;
    }
    #[cfg(target_os = "windows")]
    {
        Command::new("explorer")
            .arg("/select,")
            .arg(&path)
            .spawn()
            .map_err(|e| format!("explorer: {e}"))?;
    }
    #[cfg(all(unix, not(target_os = "macos")))]
    {
        Command::new("xdg-open")
            .arg(path.parent().unwrap_or(Path::new(".")))
            .spawn()
            .map_err(|e| format!("xdg-open: {e}"))?;
    }
    Ok(())
}

/// Open a settings/auth file directly in the OS default editor (TextEdit on
/// macOS, notepad on Windows, xdg-open on Linux).
#[tauri::command]
pub fn open_file_in_editor(args: OpenArgs) -> Result<(), String> {
    let path = PathBuf::from(&args.path);
    // Make sure the file exists (write empty object if not) so the OS editor
    // doesn't open an empty new file in some random location.
    if let Some(parent) = path.parent() {
        let _ = std::fs::create_dir_all(parent);
    }
    if !path.exists() {
        std::fs::write(&path, "{}\n").map_err(|e| format!("touch {}: {e}", path.display()))?;
    }
    #[cfg(target_os = "macos")]
    {
        Command::new("open")
            .arg("-t")
            .arg(&path)
            .spawn()
            .map_err(|e| format!("open -t: {e}"))?;
    }
    #[cfg(target_os = "windows")]
    {
        Command::new("notepad")
            .arg(&path)
            .spawn()
            .map_err(|e| format!("notepad: {e}"))?;
    }
    #[cfg(all(unix, not(target_os = "macos")))]
    {
        Command::new("xdg-open")
            .arg(&path)
            .spawn()
            .map_err(|e| format!("xdg-open: {e}"))?;
    }
    Ok(())
}

/// Read the global MEMORY.md file, creating it with a default header if absent.
#[tauri::command]
pub fn get_memory() -> Result<MemoryContent, String> {
    let path = global_memory_path()?;
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).map_err(|e| format!("mkdir {}: {e}", parent.display()))?;
    }
    if !path.exists() {
        const DEFAULT_MEMORY: &str = "# Memory\n\nPersistent notes shared across all a-coder workspaces.\n";
        std::fs::write(&path, DEFAULT_MEMORY).map_err(|e| format!("write {}: {e}", path.display()))?;
    }
    let content = std::fs::read_to_string(&path).map_err(|e| format!("read {}: {e}", path.display()))?;
    Ok(MemoryContent { content })
}

#[derive(Debug, Serialize)]
pub struct MemoryContent {
    pub content: String,
}

#[derive(Debug, Deserialize)]
pub struct SetMemoryArgs {
    pub content: String,
}

/// Overwrite the global MEMORY.md file.
#[tauri::command]
pub fn set_memory(args: SetMemoryArgs) -> Result<(), String> {
    let path = global_memory_path()?;
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).map_err(|e| format!("mkdir {}: {e}", parent.display()))?;
    }
    std::fs::write(&path, args.content).map_err(|e| format!("write {}: {e}", path.display()))?;
    Ok(())
}

#[cfg(test)]
mod provider_model_tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn maps_full_chat_model_entry() {
        // Realistic entry shaped like scx.ai /v1/models output (GLM-5.3-Flash).
        let entry = json!({
            "id": "GLM-5.3-Flash",
            "name": "GLM-5.3-Flash",
            "input_modalities": ["text", "image"],
            "context_length": 1048576,
            "max_output_length": 131072,
            "pricing": {
                "prompt": "0.0000002",
                "completion": "0.0000006",
                "input_cache_read": "0.00000004",
                "request": "0"
            },
            "supported_features": ["tools", "reasoning", "json_mode"]
        });
        let m = map_model_entry(&entry).expect("entry should map");
        assert_eq!(m.id, "GLM-5.3-Flash");
        assert_eq!(m.context_window, Some(1_048_576.0));
        assert_eq!(m.max_tokens, Some(131_072.0));
        assert_eq!(m.reasoning, Some(true));
        assert_eq!(m.input.as_deref(), Some(&["text".to_string(), "image".to_string()][..]));
        let cost = m.cost.expect("cost should be present");
        assert!((cost.input - 0.2).abs() < 1e-9);
        assert!((cost.output - 0.6).abs() < 1e-9);
        assert!((cost.cache_read - 0.04).abs() < 1e-9);
    }

    #[test]
    fn maps_embedding_model_with_null_output_length() {
        // E5-style entry: null max_output_length, embeddings-only output.
        let entry = json!({
            "id": "E5-Mistral-7B-Instruct",
            "input_modalities": ["text"],
            "output_modalities": ["embeddings"],
            "context_length": 32768,
            "max_output_length": null,
            "pricing": { "prompt": "0.000000320438", "completion": "0" },
            "supported_features": []
        });
        let m = map_model_entry(&entry).expect("entry should map");
        assert_eq!(m.context_window, Some(32_768.0));
        assert_eq!(m.max_tokens, None, "null max_output_length must map to None");
        assert_eq!(m.reasoning, Some(false));
        assert_eq!(m.input.as_deref(), Some(&["text".to_string()][..]));
        let cost = m.cost.expect("cost should be present");
        assert!((cost.input - 0.320438).abs() < 1e-6);
        assert!((cost.output - 0.0).abs() < 1e-9);
    }

    #[test]
    fn skips_entries_without_id() {
        assert!(map_model_entry(&json!({ "name": "no id" })).is_none());
        assert!(map_model_entry(&json!({ "id": "" })).is_none());
        assert!(map_model_entry(&json!({ "id": 42 })).is_none());
    }
}
