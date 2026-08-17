//! Ephemeral workspace sandboxing for safe dry runs and isolated execution.

use crate::engine::events::SandboxFileDiff;
use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;

#[derive(Debug, Clone)]
pub struct SandboxContext {
    pub run_id: String,
    pub original_dir: PathBuf,
    pub sandbox_dir: PathBuf,
    pub is_git: bool,
    pub is_worktree: bool,
}

impl SandboxContext {
    /// Creates an isolated ephemeral workspace.
    pub fn create(working_dir: &Path, run_id: &str) -> Result<Self, String> {
        let original_dir = if working_dir.exists() {
            working_dir
                .canonicalize()
                .unwrap_or_else(|_| working_dir.to_path_buf())
        } else {
            working_dir.to_path_buf()
        };

        let temp_base = std::env::temp_dir();
        let sandbox_dir = temp_base.join(format!("fuse-sandbox-{}", run_id));

        // Clean up any stale directory at this path
        if sandbox_dir.exists() {
            let _ = fs::remove_dir_all(&sandbox_dir);
        }

        let is_git = is_git_repo(&original_dir);
        let mut is_worktree = false;

        if is_git {
            // Attempt to create a fast git worktree
            let output = Command::new("git")
                .arg("-C")
                .arg(&original_dir)
                .args(["worktree", "add", "--detach"])
                .arg(&sandbox_dir)
                .arg("HEAD")
                .output();

            if let Ok(out) = output {
                if out.status.success() {
                    is_worktree = true;
                    // Copy untracked/modified working tree files so the sandbox matches current working state
                    copy_dirty_working_files(&original_dir, &sandbox_dir);
                }
            }
        }

        if !is_worktree {
            // Non-git fallback: fast directory copy (ignoring heavy build/cache folders)
            fs::create_dir_all(&sandbox_dir).map_err(|e| format!("Failed to create sandbox dir: {e}"))?;
            if original_dir.exists() {
                let _ = copy_dir_filtered(&original_dir, &sandbox_dir, 0);
            }
        }

        Ok(Self {
            run_id: run_id.to_string(),
            original_dir,
            sandbox_dir,
            is_git,
            is_worktree,
        })
    }

    /// Remaps any path inside the original directory to its corresponding sandbox path.
    /// If the path is outside the original directory, returns None so the external path is preserved.
    pub fn remap_dir(&self, step_dir: Option<&Path>) -> Option<PathBuf> {
        let dir = step_dir?;
        let canonical = dir.canonicalize().unwrap_or_else(|_| dir.to_path_buf());

        if let Ok(rel) = canonical.strip_prefix(&self.original_dir) {
            Some(self.sandbox_dir.join(rel))
        } else if canonical == self.original_dir {
            Some(self.sandbox_dir.clone())
        } else {
            // External path outside workspace: do not redirect to sandbox root
            None
        }
    }

    /// Collects diff of modified, added, and deleted files.
    pub fn collect_diff(&self) -> Result<Vec<SandboxFileDiff>, String> {
        if !self.sandbox_dir.exists() {
            return Ok(vec![]);
        }

        if self.is_worktree {
            let output = Command::new("git")
                .arg("-C")
                .arg(&self.sandbox_dir)
                .args(["status", "--porcelain", "-uall"])
                .output()
                .map_err(|e| format!("Failed to get git status: {e}"))?;

            let status_text = String::from_utf8_lossy(&output.stdout);
            let mut diffs = Vec::new();

            for line in status_text.lines() {
                if line.len() < 4 {
                    continue;
                }
                let code = &line[0..2];
                let path = line[3..].trim().to_string();

                let status = if code.contains('?') || code.contains('A') {
                    "added".to_string()
                } else if code.contains('D') {
                    "deleted".to_string()
                } else {
                    "modified".to_string()
                };

                let diff_out = Command::new("git")
                    .arg("-C")
                    .arg(&self.sandbox_dir)
                    .args(["diff", "HEAD", "--", &path])
                    .output()
                    .ok();

                let diff = diff_out
                    .filter(|o| o.status.success() && !o.stdout.is_empty())
                    .map(|o| String::from_utf8_lossy(&o.stdout).to_string());

                diffs.push(SandboxFileDiff { path, status, diff });
            }

            Ok(diffs)
        } else {
            // Compare files between sandbox and original
            let mut diffs = Vec::new();
            collect_dir_diffs(&self.original_dir, &self.sandbox_dir, &self.sandbox_dir, &mut diffs);
            collect_deleted_diffs(&self.original_dir, &self.sandbox_dir, &self.original_dir, &mut diffs);
            Ok(diffs)
        }
    }

    /// Synchronizes all changes made in the sandbox back to the real project directory.
    pub fn apply_changes(&self) -> Result<(), String> {
        if !self.sandbox_dir.exists() || !self.original_dir.exists() {
            return Err("Sandbox or original directory no longer exists".into());
        }

        let diffs = self.collect_diff()?;
        for file in diffs {
            let src_file = self.sandbox_dir.join(&file.path);
            let dest_file = self.original_dir.join(&file.path);

            if file.status == "deleted" {
                if dest_file.exists() {
                    let _ = fs::remove_file(&dest_file);
                }
            } else if src_file.exists() && src_file.is_file() {
                if let Some(parent) = dest_file.parent() {
                    let _ = fs::create_dir_all(parent);
                }
                fs::copy(&src_file, &dest_file)
                    .map_err(|e| format!("Failed to copy {} to original: {e}", file.path))?;
            }
        }

        Ok(())
    }

    /// Cleans up worktrees and temporary sandbox directory.
    pub fn cleanup(&self) {
        if self.is_worktree {
            let _ = Command::new("git")
                .arg("-C")
                .arg(&self.original_dir)
                .args(["worktree", "remove", "--force"])
                .arg(&self.sandbox_dir)
                .output();

            let _ = Command::new("git")
                .arg("-C")
                .arg(&self.original_dir)
                .args(["worktree", "prune"])
                .output();
        }

        if self.sandbox_dir.exists() {
            let _ = fs::remove_dir_all(&self.sandbox_dir);
        }
    }
}

fn is_git_repo(dir: &Path) -> bool {
    Command::new("git")
        .arg("-C")
        .arg(dir)
        .args(["rev-parse", "--is-inside-work-tree"])
        .output()
        .map(|o| o.status.success() && String::from_utf8_lossy(&o.stdout).trim() == "true")
        .unwrap_or(false)
}

fn copy_dirty_working_files(original_dir: &Path, sandbox_dir: &Path) {
    if let Ok(output) = Command::new("git")
        .arg("-C")
        .arg(original_dir)
        .args(["status", "--porcelain", "-uall"])
        .output()
    {
        let status_text = String::from_utf8_lossy(&output.stdout);
        for line in status_text.lines() {
            if line.len() < 4 {
                continue;
            }
            let path_str = line[3..].trim();
            let src = original_dir.join(path_str);
            let dest = sandbox_dir.join(path_str);

            if src.is_file() {
                if let Some(parent) = dest.parent() {
                    let _ = fs::create_dir_all(parent);
                }
                let _ = fs::copy(&src, &dest);
            }
        }
    }
}

fn copy_dir_filtered(src: &Path, dest: &Path, depth: usize) -> std::io::Result<()> {
    if depth > 10 {
        return Ok(());
    }

    if let Ok(entries) = fs::read_dir(src) {
        for entry in entries.flatten() {
            let file_name = entry.file_name();
            let name = file_name.to_string_lossy();

            // Skip heavy build/cache folders
            if name == ".git"
                || name == "node_modules"
                || name == "target"
                || name == "dist"
                || name == ".DS_Store"
            {
                continue;
            }

            let path = entry.path();
            let target = dest.join(&file_name);

            if path.is_dir() {
                let _ = fs::create_dir_all(&target);
                let _ = copy_dir_filtered(&path, &target, depth + 1);
            } else if path.is_file() {
                let _ = fs::copy(&path, &target);
            }
        }
    }
    Ok(())
}

fn collect_dir_diffs(
    original_root: &Path,
    sandbox_root: &Path,
    current_dir: &Path,
    diffs: &mut Vec<SandboxFileDiff>,
) {
    if let Ok(entries) = fs::read_dir(current_dir) {
        for entry in entries.flatten() {
            let path = entry.path();
            let file_name = entry.file_name();
            let name = file_name.to_string_lossy();
            if name == ".git" || name == "node_modules" || name == "target" || name == "dist" || name == ".DS_Store" {
                continue;
            }
            if path.is_dir() {
                collect_dir_diffs(original_root, sandbox_root, &path, diffs);
            } else if path.is_file() {
                if let Ok(rel) = path.strip_prefix(sandbox_root) {
                    let orig = original_root.join(rel);
                    let rel_str = rel.to_string_lossy().to_string();

                    if !orig.exists() {
                        diffs.push(SandboxFileDiff {
                            path: rel_str,
                            status: "added".into(),
                            diff: None,
                        });
                    } else if let (Ok(s_meta), Ok(o_meta)) = (fs::metadata(&path), fs::metadata(&orig)) {
                        let is_modified = if s_meta.len() != o_meta.len() {
                            true
                        } else if let (Ok(s_time), Ok(o_time)) = (s_meta.modified(), o_meta.modified()) {
                            if s_time != o_time {
                                fs::read(&path).ok() != fs::read(&orig).ok()
                            } else {
                                false
                            }
                        } else {
                            fs::read(&path).ok() != fs::read(&orig).ok()
                        };

                        if is_modified {
                            diffs.push(SandboxFileDiff {
                                path: rel_str,
                                status: "modified".into(),
                                diff: None,
                            });
                        }
                    }
                }
            }
        }
    }
}

fn collect_deleted_diffs(
    original_root: &Path,
    sandbox_root: &Path,
    current_dir: &Path,
    diffs: &mut Vec<SandboxFileDiff>,
) {
    if let Ok(entries) = fs::read_dir(current_dir) {
        for entry in entries.flatten() {
            let path = entry.path();
            let file_name = entry.file_name();
            let name = file_name.to_string_lossy();
            if name == ".git" || name == "node_modules" || name == "target" || name == "dist" || name == ".DS_Store" {
                continue;
            }
            if path.is_dir() {
                collect_deleted_diffs(original_root, sandbox_root, &path, diffs);
            } else if path.is_file() {
                if let Ok(rel) = path.strip_prefix(original_root) {
                    let sb_file = sandbox_root.join(rel);
                    if !sb_file.exists() {
                        diffs.push(SandboxFileDiff {
                            path: rel.to_string_lossy().to_string(),
                            status: "deleted".into(),
                            diff: None,
                        });
                    }
                }
            }
        }
    }
}
