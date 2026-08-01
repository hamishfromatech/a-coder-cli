use std::process::Command;

use serde::Deserialize;
use serde_json::Value;

use crate::cli::{reconstructed_path, resolve_cli_path};

#[derive(Debug, Deserialize)]
pub struct CwdArgs {
    pub cwd: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct InstallPackageArgs {
    pub source: String,
    pub local: bool,
    pub cwd: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct RemovePackageArgs {
    pub source: String,
    pub local: bool,
    pub cwd: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct UpdatePackageArgs {
    pub source: Option<String>,
    pub cwd: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct ToggleResourceArgs {
    pub resource_type: String,
    pub path: String,
    pub enabled: bool,
    pub scope: String,
    pub origin: String,
    pub source: Option<String>,
    pub base_dir: Option<String>,
    pub cwd: Option<String>,
}

fn run_resources_command(cwd: Option<String>, subcommand: Vec<String>) -> Result<Value, String> {
    let cli_path = resolve_cli_path(None)?;
    let mut args: Vec<String> = vec![cli_path.to_string_lossy().into_owned()];
    args.push("resources".into());
    args.extend(subcommand.iter().cloned());
    args.push("--json".into());
    if let Some(c) = cwd.as_ref().filter(|s| !s.is_empty()) {
        args.push("--cwd".into());
        args.push(c.clone());
    }

    let output = Command::new("node")
        .args(args)
        .current_dir(cwd.as_deref().unwrap_or("."))
        .env("PATH", reconstructed_path())
        .output()
        .map_err(|e| format!("Failed to run resources command: {e}"))?;

    if !output.stderr.is_empty() {
        let err = String::from_utf8_lossy(&output.stderr);
        if !err.trim().is_empty() {
            tracing::warn!("resources command stderr: {}", err);
        }
    }

    let stdout = String::from_utf8_lossy(&output.stdout);
    let trimmed = stdout.trim();
    if trimmed.is_empty() {
        return Err("resources command produced no output".into());
    }

    serde_json::from_str(trimmed).map_err(|e| format!("Failed to parse resources output: {e}\n{trimmed}"))
}

#[tauri::command]
pub fn resolve_resources(args: CwdArgs) -> Result<Value, String> {
    run_resources_command(args.cwd, vec!["resolve".into()])
}

#[tauri::command]
pub fn list_packages(args: CwdArgs) -> Result<Value, String> {
    run_resources_command(args.cwd, vec!["list".into()])
}

#[tauri::command]
pub fn install_package(args: InstallPackageArgs) -> Result<Value, String> {
    let mut cmd = vec!["install".into(), "--source".into(), args.source];
    if args.local {
        cmd.push("--local".into());
    }
    run_resources_command(args.cwd, cmd)
}

#[tauri::command]
pub fn remove_package(args: RemovePackageArgs) -> Result<Value, String> {
    let mut cmd = vec!["remove".into(), "--source".into(), args.source];
    if args.local {
        cmd.push("--local".into());
    }
    run_resources_command(args.cwd, cmd)
}

#[tauri::command]
pub fn update_package(args: UpdatePackageArgs) -> Result<Value, String> {
    let mut cmd = vec!["update".into()];
    if let Some(source) = args.source {
        cmd.push("--source".into());
        cmd.push(source);
    }
    run_resources_command(args.cwd, cmd)
}

#[tauri::command]
pub fn toggle_resource(args: ToggleResourceArgs) -> Result<Value, String> {
    let mut cmd = vec![
        "toggle".into(),
        "--type".into(),
        args.resource_type,
        "--path".into(),
        args.path,
        "--enabled".into(),
        if args.enabled { "true".into() } else { "false".into() },
        "--scope".into(),
        args.scope,
        "--origin".into(),
        args.origin,
    ];
    if let Some(source) = args.source {
        cmd.push("--source".into());
        cmd.push(source);
    }
    if let Some(base_dir) = args.base_dir {
        cmd.push("--baseDir".into());
        cmd.push(base_dir);
    }
    run_resources_command(args.cwd, cmd)
}
