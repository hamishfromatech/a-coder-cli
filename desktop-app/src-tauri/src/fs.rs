use std::fs;
use std::path::{Path, PathBuf};

use base64::Engine;
use walkdir::WalkDir;

/// Append a renderer diagnostic line to /tmp/a-coder-renderer.log (debug aid).
#[tauri::command]
pub fn debug_log(line: String) -> Result<(), String> {
    use std::io::Write;
    let mut f = std::fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open("/tmp/a-coder-renderer.log")
        .map_err(|e| e.to_string())?;
    writeln!(f, "{}", line).map_err(|e| e.to_string())
}

/// Read a UTF-8 text file with a hard 1 MiB cap. Returns Err if the file is
/// larger or not valid UTF-8.
#[tauri::command]
pub fn read_text_file(path: String) -> Result<String, String> {
    let path = PathBuf::from(&path);
    if !path.exists() {
        return Err(format!("File does not exist: {}", path.display()));
    }
    if !path.is_file() {
        return Err(format!("Not a file: {}", path.display()));
    }
    let metadata =
        fs::metadata(&path).map_err(|e| format!("Failed to stat {}: {e}", path.display()))?;
    const MAX_BYTES: u64 = 1024 * 1024;
    if metadata.len() > MAX_BYTES {
        return Err(format!(
            "File too large to preview ({} bytes, max {}).",
            metadata.len(),
            MAX_BYTES
        ));
    }
    fs::read_to_string(&path).map_err(|e| format!("Failed to read {}: {e}", path.display()))
}

/// List files inside `cwd` whose extension matches `extension` (e.g. ".html").
/// Recurses up to `max_depth` directories (default 5) and caps results at
/// `max_results` (default 200). Hidden directories and well-known build dirs
/// (node_modules, target, .git, dist, build) are skipped.
#[tauri::command]
pub fn list_files(
    cwd: String,
    extension: String,
    max_results: Option<usize>,
    max_depth: Option<usize>,
) -> Result<Vec<String>, String> {
    let cwd_path = Path::new(&cwd);
    if !cwd_path.exists() {
        return Err(format!("Directory does not exist: {cwd}"));
    }

    let max_depth = max_depth.unwrap_or(5);
    let max_results = max_results.unwrap_or(200);
    let ext_lower = extension.to_lowercase();

    let skip_dirs: &[&str] = &[
        "node_modules",
        "target",
        ".git",
        "dist",
        "build",
        ".next",
        ".cache",
        ".turbo",
        "out",
        ".venv",
        "__pycache__",
        ".gradle",
        "vendor",
    ];

    let mut out: Vec<String> = Vec::new();

    for entry in WalkDir::new(cwd_path)
        .max_depth(max_depth)
        .follow_links(false)
        .into_iter()
        .filter_entry(|e| {
            // Don't descend into skipped directories.
            if e.depth() == 0 {
                return true;
            }
            let name = e.file_name().to_string_lossy();
            if e.file_type().is_dir() && skip_dirs.contains(&name.as_ref()) {
                return false;
            }
            // Skip dotfiles except those explicitly checked.
            if name.starts_with('.') && name != "." && name != ".." {
                // Allow .github, etc — keep directories but flag files in filter below.
            }
            true
        })
        .flatten()
    {
        if !entry.file_type().is_file() {
            continue;
        }

        // Skip hidden files
        if entry
            .file_name()
            .to_string_lossy()
            .starts_with('.')
        {
            continue;
        }

        let path = entry.path();
        let path_lower = path.to_string_lossy().to_lowercase();
        if !path_lower.ends_with(&ext_lower) {
            continue;
        }

        if let Ok(rel) = path.strip_prefix(cwd_path) {
            out.push(rel.to_string_lossy().to_string());
            if out.len() >= max_results {
                break;
            }
        }
    }

    out.sort();
    Ok(out)
}

/// A directory entry for the file explorer. Children are populated only for
/// directories and are sorted alphabetically (directories before files).
#[derive(serde::Serialize, Debug)]
pub struct DirEntry {
    path: String,
    name: String,
    is_dir: bool,
    children: Vec<DirEntry>,
}

/// Read the directory tree starting at `cwd`. Hidden directories and well-known
/// build/output dirs are skipped. Results are capped by `max_depth` and an
/// overall entry limit to keep large projects responsive.
#[tauri::command]
pub fn list_directory(
    cwd: String,
    max_depth: Option<usize>,
) -> Result<Vec<DirEntry>, String> {
    let cwd_path = Path::new(&cwd);
    if !cwd_path.exists() {
        return Err(format!("Directory does not exist: {cwd}"));
    }
    if !cwd_path.is_dir() {
        return Err(format!("Not a directory: {cwd}"));
    }

    let max_depth = max_depth.unwrap_or(8);
    let skip_dirs: &[&str] = &[
        "node_modules",
        "target",
        ".git",
        "dist",
        "build",
        ".next",
        ".cache",
        ".turbo",
        "out",
        ".venv",
        "__pycache__",
        ".gradle",
        "vendor",
    ];

    fn read_entries(
        dir: &Path,
        cwd: &Path,
        depth: usize,
        max_depth: usize,
        skip_dirs: &[&str],
        count: &mut usize,
        max_entries: usize,
    ) -> Result<Vec<DirEntry>, String> {
        if depth >= max_depth {
            return Ok(Vec::new());
        }

        let mut entries: Vec<DirEntry> = Vec::new();
        let iter = fs::read_dir(dir).map_err(|e| format!("Failed to read directory {}: {e}", dir.display()))?;

        for entry in iter.flatten() {
            if *count >= max_entries {
                break;
            }

            let name = entry.file_name().to_string_lossy().to_string();
            if name.starts_with('.') {
                continue;
            }

            let path = entry.path();
            let file_type = entry.file_type().map_err(|e| {
                format!("Failed to read file type for {}: {e}", path.display())
            })?;
            // Avoid symlink loops and unexpected traversal.
            if file_type.is_symlink() {
                continue;
            }
            let is_dir = file_type.is_dir();

            if is_dir && skip_dirs.contains(&name.as_str()) {
                continue;
            }

            let rel_path = path
                .strip_prefix(cwd)
                .map(|p| p.to_string_lossy().to_string())
                .unwrap_or_else(|_| name.clone());

            let children = if is_dir {
                read_entries(&path, cwd, depth + 1, max_depth, skip_dirs, count, max_entries)?
            } else {
                Vec::new()
            };

            *count += 1;
            entries.push(DirEntry {
                path: rel_path,
                name,
                is_dir,
                children,
            });
        }

        entries.sort_by(|a, b| match (a.is_dir, b.is_dir) {
            (true, false) => std::cmp::Ordering::Less,
            (false, true) => std::cmp::Ordering::Greater,
            _ => a.name.to_lowercase().cmp(&b.name.to_lowercase()),
        });

        Ok(entries)
    }

    let mut count = 0;
    let max_entries = 5000;
    read_entries(cwd_path, cwd_path, 0, max_depth, skip_dirs, &mut count, max_entries)
}

/// Read a binary file and return it as a base64 string plus a guessed MIME type.
/// Capped at 8 MiB to keep UI memory reasonable.
#[derive(serde::Serialize, Debug)]
pub struct FileBase64 {
    content: String,
    mime_type: String,
}

#[tauri::command]
pub fn read_file_base64(path: String) -> Result<FileBase64, String> {
    let path = PathBuf::from(&path);
    if !path.exists() {
        return Err(format!("File does not exist: {}", path.display()));
    }
    if !path.is_file() {
        return Err(format!("Not a file: {}", path.display()));
    }

    let metadata = fs::metadata(&path).map_err(|e| format!("Failed to stat {}: {e}", path.display()))?;
    const MAX_BYTES: u64 = 8 * 1024 * 1024;
    if metadata.len() > MAX_BYTES {
        return Err(format!(
            "File too large to preview ({} bytes, max {}).",
            metadata.len(),
            MAX_BYTES
        ));
    }

    let bytes = fs::read(&path).map_err(|e| format!("Failed to read {}: {e}", path.display()))?;
    let encoded = base64::engine::general_purpose::STANDARD.encode(&bytes);

    let mime_type = mime_type_from_path(&path);
    Ok(FileBase64 { content: encoded, mime_type })
}

fn mime_type_from_path(path: &Path) -> String {
    match path.extension().and_then(|e| e.to_str()) {
        Some("png") => "image/png",
        Some("jpg") | Some("jpeg") => "image/jpeg",
        Some("gif") => "image/gif",
        Some("webp") => "image/webp",
        Some("svg") => "image/svg+xml",
        Some("bmp") => "image/bmp",
        Some("ico") => "image/x-icon",
        // Audio
        Some("mp3") => "audio/mpeg",
        Some("wav") => "audio/wav",
        Some("aac") => "audio/aac",
        Some("ogg") => "audio/ogg",
        Some("oga") => "audio/ogg",
        Some("opus") => "audio/opus",
        Some("flac") => "audio/flac",
        Some("m4a") => "audio/mp4",
        // Video
        Some("mp4") => "video/mp4",
        Some("mov") => "video/quicktime",
        Some("mkv") => "video/x-matroska",
        Some("avi") => "video/x-msvideo",
        Some("webm") => "video/webm",
        Some("ogv") => "video/ogg",
        Some("m4v") => "video/mp4",
        Some("pdf") => "application/pdf",
        _ => "application/octet-stream",
    }
    .to_string()
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs::{self, File};
    use std::io::Write;
    use tempfile::tempdir;

    #[test]
    fn test_read_text_file_returns_content() {
        let dir = tempdir().expect("Failed to create temp dir");
        let file_path = dir.path().join("test.txt");
        let mut file = File::create(&file_path).expect("Failed to create file");
        writeln!(file, "Hello, world!").expect("Failed to write");

        let result = read_text_file(file_path.to_string_lossy().to_string());
        assert!(result.is_ok());
        assert!(result.unwrap().contains("Hello, world!"));
    }

    #[test]
    fn test_read_text_file_missing_file() {
        let result = read_text_file("/nonexistent/file.txt".to_string());
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("File does not exist"));
    }

    #[test]
    fn test_read_text_file_directory_not_file() {
        let dir = tempdir().expect("Failed to create temp dir");
        let result = read_text_file(dir.path().to_string_lossy().to_string());
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("Not a file"));
    }

    #[test]
    fn test_read_text_file_too_large() {
        let dir = tempdir().expect("Failed to create temp dir");
        let file_path = dir.path().join("large.txt");
        let file = File::create(&file_path).expect("Failed to create file");
        // Set the file size to be larger than MAX_BYTES (1 MiB) by truncating
        file.set_len(2 * 1024 * 1024).expect("Failed to set len");

        let result = read_text_file(file_path.to_string_lossy().to_string());
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("File too large"));
    }

    #[test]
    fn test_list_files_finds_matching_extension() {
        let dir = tempdir().expect("Failed to create temp dir");
        let html_path = dir.path().join("index.html");
        File::create(&html_path).expect("Failed to create file");
        let css_path = dir.path().join("style.css");
        File::create(&css_path).expect("Failed to create file");

        let result = list_files(
            dir.path().to_string_lossy().to_string(),
            ".html".to_string(),
            None,
            None,
        );
        assert!(result.is_ok());
        let files = result.unwrap();
        assert_eq!(files.len(), 1);
        assert!(files[0].ends_with("index.html"));
    }

    #[test]
    fn test_list_files_missing_directory() {
        let result = list_files(
            "/nonexistent/directory".to_string(),
            ".html".to_string(),
            None,
            None,
        );
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("Directory does not exist"));
    }

    #[test]
    fn test_list_files_skips_node_modules() {
        let dir = tempdir().expect("Failed to create temp dir");
        let node_modules = dir.path().join("node_modules");
        fs::create_dir(&node_modules).expect("Failed to create dir");
        File::create(node_modules.join("dep.html")).expect("Failed to create file");

        let result = list_files(
            dir.path().to_string_lossy().to_string(),
            ".html".to_string(),
            None,
            None,
        );
        assert!(result.is_ok());
        let files = result.unwrap();
        assert_eq!(files.len(), 0, "Should skip node_modules");
    }

    #[test]
    fn test_list_files_respects_max_results() {
        let dir = tempdir().expect("Failed to create temp dir");
        for i in 0..10 {
            let path = dir.path().join(format!("file{i}.html"));
            File::create(&path).expect("Failed to create file");
        }

        let result = list_files(
            dir.path().to_string_lossy().to_string(),
            ".html".to_string(),
            Some(5),
            None,
        );
        assert!(result.is_ok());
        let files = result.unwrap();
        assert_eq!(files.len(), 5);
    }

    #[test]
    fn test_list_directory_returns_entries() {
        let dir = tempdir().expect("Failed to create temp dir");
        File::create(dir.path().join("file1.txt")).expect("Failed to create file");
        fs::create_dir(dir.path().join("subdir")).expect("Failed to create dir");

        let result = list_directory(dir.path().to_string_lossy().to_string(), None);
        assert!(result.is_ok());
        let entries = result.unwrap();
        // Should have subdir (dir) and file1.txt
        assert_eq!(entries.len(), 2);
        // Directory should come first
        assert!(entries[0].is_dir);
        assert!(!entries[1].is_dir);
    }

    #[test]
    fn test_list_directory_missing_dir() {
        let result = list_directory("/nonexistent".to_string(), None);
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("Directory does not exist"));
    }

    #[test]
    fn test_list_directory_not_a_directory() {
        let dir = tempdir().expect("Failed to create temp dir");
        let file_path = dir.path().join("file.txt");
        File::create(&file_path).expect("Failed to create file");

        let result = list_directory(file_path.to_string_lossy().to_string(), None);
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("Not a directory"));
    }

    #[test]
    fn test_mime_type_from_path_png() {
        assert_eq!(
            mime_type_from_path(Path::new("image.png")),
            "image/png"
        );
    }

    #[test]
    fn test_mime_type_from_path_jpg() {
        assert_eq!(
            mime_type_from_path(Path::new("image.jpg")),
            "image/jpeg"
        );
    }

    #[test]
    fn test_mime_type_from_path_jpeg() {
        assert_eq!(
            mime_type_from_path(Path::new("image.jpeg")),
            "image/jpeg"
        );
    }

    #[test]
    fn test_mime_type_from_path_svg() {
        assert_eq!(
            mime_type_from_path(Path::new("icon.svg")),
            "image/svg+xml"
        );
    }

    #[test]
    fn test_mime_type_from_path_pdf() {
        assert_eq!(
            mime_type_from_path(Path::new("doc.pdf")),
            "application/pdf"
        );
    }

    #[test]
    fn test_mime_type_from_path_unknown() {
        assert_eq!(
            mime_type_from_path(Path::new("file.xyz")),
            "application/octet-stream"
        );
    }

    #[test]
    fn test_mime_type_from_path_no_extension() {
        assert_eq!(
            mime_type_from_path(Path::new("README")),
            "application/octet-stream"
        );
    }

    #[test]
    fn test_read_file_base64_returns_content() {
        let dir = tempdir().expect("Failed to create temp dir");
        let file_path = dir.path().join("image.png");
        let mut file = File::create(&file_path).expect("Failed to create file");
        file.write_all(b"fake png content").expect("Failed to write");

        let result = read_file_base64(file_path.to_string_lossy().to_string());
        assert!(result.is_ok());
        let file_b64 = result.unwrap();
        assert!(!file_b64.content.is_empty());
        assert_eq!(file_b64.mime_type, "image/png");
    }

    #[test]
    fn test_read_file_base64_missing_file() {
        let result = read_file_base64("/nonexistent/file.png".to_string());
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("File does not exist"));
    }
}
