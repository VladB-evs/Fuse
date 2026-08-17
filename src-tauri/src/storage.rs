//! Workflow persistence.
//!
//! Workflows are plain, human-readable JSON files under the app data
//! directory — one file per workflow, so they diff cleanly and can be copied
//! between machines by hand.
//!
//! Everything goes through the [`WorkflowStore`] trait. Swapping in SQLite
//! later means writing one more implementor and changing a single line in
//! `lib.rs`; nothing above this layer knows how bytes reach disk.

use crate::model::{now_ms, Workflow, WorkflowSummary};
use std::fs;
use std::path::{Path, PathBuf};

#[derive(Debug, thiserror::Error)]
pub enum StorageError {
    #[error("Workflow not found: {0}")]
    NotFound(String),
    #[error("Invalid workflow id: {0}")]
    InvalidId(String),
    #[error("Could not read workflow file: {0}")]
    Io(#[from] std::io::Error),
    #[error("Workflow file is not valid JSON: {0}")]
    Parse(#[from] serde_json::Error),
}

pub trait WorkflowStore: Send + Sync + 'static {
    fn list(&self) -> Result<Vec<WorkflowSummary>, StorageError>;
    fn load(&self, id: &str) -> Result<Workflow, StorageError>;
    fn save(&self, workflow: &Workflow) -> Result<Workflow, StorageError>;
    fn delete(&self, id: &str) -> Result<(), StorageError>;
}

pub struct JsonStore {
    dir: PathBuf,
}

impl JsonStore {
    /// `dir` is the exact directory where workflow files live directly.
    pub fn new_direct(dir: PathBuf) -> Result<Self, StorageError> {
        fs::create_dir_all(&dir)?;
        Ok(Self { dir })
    }

    /// `root` is the app data directory; workflows live in a subfolder.
    pub fn new(root: impl AsRef<Path>) -> Result<Self, StorageError> {
        let dir = root.as_ref().join("workflows");
        fs::create_dir_all(&dir)?;
        Ok(Self { dir })
    }

    pub fn directory(&self) -> &Path {
        &self.dir
    }

    fn path_for(&self, id: &str) -> Result<PathBuf, StorageError> {
        if !is_safe_id(id) {
            return Err(StorageError::InvalidId(id.to_string()));
        }
        Ok(self.dir.join(format!("{id}.json")))
    }
}

/// Ids come from the frontend, so never let one escape the workflows folder.
fn is_safe_id(id: &str) -> bool {
    !id.is_empty()
        && id.len() <= 64
        && id
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_')
}

impl WorkflowStore for JsonStore {
    fn list(&self) -> Result<Vec<WorkflowSummary>, StorageError> {
        let mut out = Vec::new();

        for entry in fs::read_dir(&self.dir)? {
            let entry = entry?;
            let path = entry.path();
            if path.extension().and_then(|e| e.to_str()) != Some("json") {
                continue;
            }

            // One corrupt file must not hide every other workflow.
            let Ok(text) = fs::read_to_string(&path) else {
                continue;
            };
            let Ok(workflow) = serde_json::from_str::<Workflow>(&text) else {
                continue;
            };

            out.push(WorkflowSummary {
                id: workflow.id,
                name: workflow.name,
                node_count: workflow.nodes.len(),
                updated_at: workflow.updated_at,
            });
        }

        out.sort_by(|a, b| b.updated_at.cmp(&a.updated_at));
        Ok(out)
    }

    fn load(&self, id: &str) -> Result<Workflow, StorageError> {
        let path = self.path_for(id)?;
        if !path.exists() {
            return Err(StorageError::NotFound(id.to_string()));
        }
        let text = fs::read_to_string(path)?;
        Ok(serde_json::from_str(&text)?)
    }

    fn save(&self, workflow: &Workflow) -> Result<Workflow, StorageError> {
        let path = self.path_for(&workflow.id)?;

        let mut record = workflow.clone();
        record.updated_at = now_ms();
        if record.created_at == 0 {
            record.created_at = record.updated_at;
        }

        let json = serde_json::to_string_pretty(&record)?;

        // Write-then-rename so a crash mid-save can't truncate a good file.
        let tmp = path.with_extension("json.tmp");
        fs::write(&tmp, json)?;
        fs::rename(&tmp, &path)?;

        Ok(record)
    }

    fn delete(&self, id: &str) -> Result<(), StorageError> {
        let path = self.path_for(id)?;
        if path.exists() {
            fs::remove_file(path)?;
        }
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::model::{CommandData, NodePayload, Position, WorkflowNode};

    fn temp_root(tag: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("fuse-test-{tag}-{}", now_ms()));
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    fn sample(id: &str, name: &str) -> Workflow {
        Workflow {
            id: id.into(),
            name: name.into(),
            working_dir: Some("~/dev".into()),
            nodes: vec![WorkflowNode {
                id: "n1".into(),
                position: Position { x: 0.0, y: 0.0 },
                disabled: None,
                payload: NodePayload::Command(CommandData {
                    command: "git status".into(),
                    ..Default::default()
                }),
            }],
            edges: vec![],
            created_at: 0,
            updated_at: 0,
        }
    }

    #[test]
    fn saves_and_reloads_a_workflow() {
        let store = JsonStore::new(temp_root("roundtrip")).unwrap();
        let saved = store.save(&sample("wf1", "Deploy")).unwrap();

        assert!(saved.created_at > 0);

        let loaded = store.load("wf1").unwrap();
        assert_eq!(loaded.name, "Deploy");
        assert_eq!(loaded.nodes.len(), 1);
        assert_eq!(loaded.working_dir.as_deref(), Some("~/dev"));
        assert_eq!(loaded.nodes[0].command().unwrap().command, "git status");
    }

    #[test]
    fn saved_json_is_human_readable() {
        let root = temp_root("readable");
        let store = JsonStore::new(&root).unwrap();
        store.save(&sample("wf2", "Ship")).unwrap();

        let text = fs::read_to_string(store.directory().join("wf2.json")).unwrap();
        assert!(text.contains("\"name\": \"Ship\""));
        assert!(text.contains("\"type\": \"command\""));
        assert!(text.contains('\n'), "expected pretty-printed JSON");
    }

    #[test]
    fn lists_newest_first() {
        let store = JsonStore::new(temp_root("list")).unwrap();
        let mut older = sample("wf-old", "Older");
        older.updated_at = 1;
        let mut newer = sample("wf-new", "Newer");
        newer.updated_at = 2;

        store.save(&older).unwrap();
        std::thread::sleep(std::time::Duration::from_millis(5));
        store.save(&newer).unwrap();

        let names: Vec<String> = store.list().unwrap().into_iter().map(|s| s.name).collect();
        assert_eq!(names, vec!["Newer", "Older"]);
    }

    #[test]
    fn deletes_workflows() {
        let store = JsonStore::new(temp_root("delete")).unwrap();
        store.save(&sample("wf3", "Temp")).unwrap();
        store.delete("wf3").unwrap();
        assert!(matches!(store.load("wf3"), Err(StorageError::NotFound(_))));
    }

    #[test]
    fn rejects_path_traversal_ids() {
        let store = JsonStore::new(temp_root("traversal")).unwrap();
        assert!(matches!(
            store.load("../../etc/passwd"),
            Err(StorageError::InvalidId(_))
        ));
        assert!(!is_safe_id("a/b"));
        assert!(is_safe_id("wf_123-abc"));
    }

    #[test]
    fn corrupt_files_do_not_break_the_list() {
        let root = temp_root("corrupt");
        let store = JsonStore::new(&root).unwrap();
        store.save(&sample("good", "Good")).unwrap();
        fs::write(store.directory().join("bad.json"), "{ not json").unwrap();

        let list = store.list().unwrap();
        assert_eq!(list.len(), 1);
        assert_eq!(list[0].name, "Good");
    }
}
