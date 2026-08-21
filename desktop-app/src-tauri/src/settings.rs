use std::path::{Path, PathBuf};
use std::process::Command;

use serde::{Deserialize, Serialize};
use serde_json::Value;

const CONFIG_DIR_NAME: &str = ".a-coder-cli";
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

fn agent_dir() -> Result<PathBuf, String> {
    Ok(home_dir()?.join(CONFIG_DIR_NAME).join(AGENT_DIR))
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

/// Root directory for Agent Teams state (`~/.a-coder-cli/teams`). Honors the
/// same `A-CODER-CLI_TEAMS_DIR` override the coding-agent reads so dev/test
/// installs stay in sync.
pub fn global_teams_root() -> Result<PathBuf, String> {
    if let Ok(dir) = std::env::var("A-CODER-CLI_TEAMS_DIR") {
        if !dir.trim().is_empty() {
            return Ok(PathBuf::from(dir));
        }
    }
    Ok(home_dir()?.join(CONFIG_DIR_NAME).join("teams"))
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
    Ok(home_dir()?.join(CONFIG_DIR_NAME).join(MEMORY_FILE_NAME))
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
