//! The Tauri bridge.
//!
//! Intentionally thin: every command here validates input, delegates to the
//! engine or the store, and translates errors into strings the UI can show.
//! No execution logic lives in this file.

use crate::engine::{
    self, EngineEvent, EventSink, PromptFuture, PromptReply, PromptRequest, Prompter, RunControl,
};
use crate::model::{Workflow, WorkflowSummary};
use crate::storage::WorkflowStore;
use serde::Serialize;
use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::{Arc, Mutex, RwLock};
use tauri::{AppHandle, Emitter, Manager, State};
use tauri_plugin_dialog::DialogExt;
use tokio::sync::oneshot;

/// Single channel the frontend listens on for all engine progress.
pub const ENGINE_EVENT: &str = "fuse://engine";

pub struct AppState {
    pub store: RwLock<Arc<dyn WorkflowStore>>,
    pub active: Mutex<Option<Arc<RunControl>>>,
    pub prompts: Arc<PromptRegistry>,
    pub sandboxes: Arc<Mutex<HashMap<String, engine::sandbox::SandboxContext>>>,
    pub app_data_dir: PathBuf,
}

impl AppState {
    pub fn new(store: Arc<dyn WorkflowStore>, app_data_dir: PathBuf) -> Self {
        Self {
            store: RwLock::new(store),
            active: Mutex::new(None),
            prompts: Arc::new(PromptRegistry::default()),
            sandboxes: Arc::new(Mutex::new(HashMap::new())),
            app_data_dir,
        }
    }
}

/// Forwards engine events into the webview.
struct WebviewSink {
    app: AppHandle,
}

impl EventSink for WebviewSink {
    fn emit(&self, event: EngineEvent) {
        let _ = self.app.emit(ENGINE_EVENT, event);
    }
}

// --- Interactive steps ----------------------------------------------------

/// The questions the engine is currently waiting on, by run and step.
///
/// A run only ever waits on one at a time, but the key includes the run id so
/// a stale answer from a previous run can never unblock this one.
#[derive(Default)]
pub struct PromptRegistry {
    waiting: Mutex<HashMap<String, oneshot::Sender<PromptReply>>>,
}

fn prompt_key(run_id: &str, node_id: &str) -> String {
    format!("{run_id}\u{1f}{node_id}")
}

impl PromptRegistry {
    /// Deliver an answer. `false` means nothing was waiting for it — the run
    /// moved on, usually because it was stopped.
    fn answer(&self, run_id: &str, node_id: &str, reply: PromptReply) -> bool {
        let Ok(mut waiting) = self.waiting.lock() else {
            return false;
        };
        match waiting.remove(&prompt_key(run_id, node_id)) {
            Some(sender) => sender.send(reply).is_ok(),
            None => false,
        }
    }

    /// Drop every pending question. Their futures resolve as cancelled, which
    /// is what a stopped or finished run should leave behind.
    fn clear(&self) {
        if let Ok(mut waiting) = self.waiting.lock() {
            waiting.clear();
        }
    }
}

/// Puts questions to the person at the keyboard, over the same event channel
/// the rest of the run reports on.
struct WebviewPrompter {
    registry: Arc<PromptRegistry>,
}

impl Prompter for WebviewPrompter {
    fn request(&self, request: PromptRequest) -> PromptFuture {
        let (tx, rx) = oneshot::channel();

        // Registered synchronously: the engine emits the "waiting" event only
        // after this returns, so the answer can never outrun the question.
        if let Ok(mut waiting) = self.registry.waiting.lock() {
            waiting.insert(prompt_key(&request.run_id, &request.node_id), tx);
        }

        Box::pin(async move { rx.await.unwrap_or(PromptReply::Cancelled) })
    }
}

/// Answer whatever the run is currently waiting on.
#[tauri::command]
pub fn resolve_prompt(
    state: State<'_, AppState>,
    run_id: String,
    node_id: String,
    reply: PromptReply,
) -> Result<(), String> {
    state.prompts.answer(&run_id, &node_id, reply);
    // A question nobody is waiting on is not an error worth showing: the run
    // was stopped, and the dialog is closing anyway.
    Ok(())
}

// --- Persistence ----------------------------------------------------------

#[derive(Debug, Clone, Serialize, serde::Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct AppSettings {
    pub custom_workflow_dir: Option<String>,
    pub workflow_dir: String,
}

pub fn load_settings(data_dir: &std::path::Path) -> AppSettings {
    let path = data_dir.join("settings.json");
    let mut settings = if let Ok(content) = std::fs::read_to_string(&path) {
        serde_json::from_str::<AppSettings>(&content).unwrap_or_default()
    } else {
        AppSettings::default()
    };

    let workflow_dir = if let Some(ref custom) = settings.custom_workflow_dir {
        PathBuf::from(custom)
    } else {
        data_dir.join("workflows")
    };
    let _ = std::fs::create_dir_all(&workflow_dir);
    settings.workflow_dir = workflow_dir.to_string_lossy().to_string();

    settings
}

fn save_settings(data_dir: &std::path::Path, settings: &AppSettings) -> Result<(), String> {
    let path = data_dir.join("settings.json");
    let content = serde_json::to_string_pretty(settings).map_err(|e| e.to_string())?;
    std::fs::write(&path, content).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn get_settings(state: State<'_, AppState>) -> Result<AppSettings, String> {
    Ok(load_settings(&state.app_data_dir))
}

#[tauri::command]
pub async fn open_directory(path: String) -> Result<(), String> {
    #[cfg(target_os = "macos")]
    {
        std::process::Command::new("open")
            .arg(&path)
            .spawn()
            .map_err(|e| e.to_string())?;
    }
    #[cfg(target_os = "windows")]
    {
        std::process::Command::new("explorer")
            .arg(&path)
            .spawn()
            .map_err(|e| e.to_string())?;
    }
    #[cfg(target_os = "linux")]
    {
        std::process::Command::new("xdg-open")
            .arg(&path)
            .spawn()
            .map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[tauri::command]
pub async fn set_workflow_directory(
    state: State<'_, AppState>,
    path: Option<String>,
) -> Result<(), String> {
    let mut settings = load_settings(&state.app_data_dir);
    
    let old_dir = PathBuf::from(&settings.workflow_dir);
    
    // Check if the new path exists and is a directory
    if let Some(ref dir_path) = path {
        let p = std::path::Path::new(dir_path);
        if !p.exists() {
            std::fs::create_dir_all(p).map_err(|e| format!("Could not create directory: {}", e))?;
        }
        if !p.is_dir() {
            return Err("Path is not a directory".to_string());
        }
    }
    
    settings.custom_workflow_dir = path.clone();
    save_settings(&state.app_data_dir, &settings)?;

    // Create a new store pointing to the new directory (or default if None)
    let new_store = if let Some(ref custom) = path {
        crate::storage::JsonStore::new_direct(PathBuf::from(custom)).map_err(|e| e.to_string())?
    } else {
        crate::storage::JsonStore::new(&state.app_data_dir).map_err(|e| e.to_string())?
    };
    let new_workflows_dir = new_store.directory();
    
    // Migrate files if they don't already exist in the new directory
    if old_dir.exists() && &old_dir != new_workflows_dir {
        if let Ok(entries) = std::fs::read_dir(&old_dir) {
            for entry in entries.filter_map(Result::ok) {
                if let Ok(file_type) = entry.file_type() {
                    if file_type.is_file() {
                        let file_name = entry.file_name();
                        let target_path = new_workflows_dir.join(&file_name);
                        if !target_path.exists() {
                            let _ = std::fs::copy(entry.path(), target_path);
                        }
                    }
                }
            }
        }
    }
    
    let mut store_lock = state.store.write().map_err(|_| "Failed to lock store".to_string())?;
    *store_lock = Arc::new(new_store);

    Ok(())
}

#[tauri::command]
pub async fn list_workflows(state: State<'_, AppState>) -> Result<Vec<WorkflowSummary>, String> {
    let store = state.store.read().unwrap().clone();
    store.list().map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn load_workflow(state: State<'_, AppState>, id: String) -> Result<Workflow, String> {
    let store = state.store.read().unwrap().clone();
    store.load(&id).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn save_workflow(
    state: State<'_, AppState>,
    workflow: Workflow,
) -> Result<Workflow, String> {
    let store = state.store.read().unwrap().clone();
    store.save(&workflow).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn delete_workflow(state: State<'_, AppState>, id: String) -> Result<(), String> {
    let store = state.store.read().unwrap().clone();
    store.delete(&id).map_err(|e| e.to_string())
}

// --- Execution ------------------------------------------------------------

#[tauri::command]
pub async fn run_workflow(
    app: AppHandle,
    state: State<'_, AppState>,
    workflow: Workflow,
    run_mode: Option<engine::events::RunMode>,
) -> Result<String, String> {
    begin_run(app, &state, workflow, run_mode)
}

/// Run a single block on its own, ignoring graph dependencies.
#[tauri::command]
pub async fn run_node(
    app: AppHandle,
    state: State<'_, AppState>,
    workflow: Workflow,
    node_id: String,
    run_mode: Option<engine::events::RunMode>,
) -> Result<String, String> {
    let node = workflow
        .node(&node_id)
        .cloned()
        .ok_or_else(|| format!("Block not found: {node_id}"))?;

    if node.is_disabled() {
        return Err("Cannot run a disabled step. Re-enable it first.".into());
    }

    // If running a choice or condition node, include all reachable downstream nodes and edges
    if node.is_choice() || node.is_condition() {
        let mut reachable_ids = std::collections::HashSet::new();
        reachable_ids.insert(node_id.clone());
        let mut queue = std::collections::VecDeque::new();
        queue.push_back(node_id.clone());

        let mut included_edges = Vec::new();

        while let Some(current_id) = queue.pop_front() {
            for edge in &workflow.edges {
                if edge.disabled == Some(true) {
                    continue;
                }
                if edge.source == current_id {
                    included_edges.push(edge.clone());
                    if reachable_ids.insert(edge.target.clone()) {
                        queue.push_back(edge.target.clone());
                        let is_frame = workflow.node(&edge.target).map(|n| n.is_frame()).unwrap_or(false);
                        if is_frame {
                            for member in &workflow.nodes {
                                if member.frame_id() == Some(&edge.target) && !member.is_disabled() {
                                    if reachable_ids.insert(member.id.clone()) {
                                        queue.push_back(member.id.clone());
                                    }
                                }
                            }
                        }
                    }
                }
            }
        }

        let nodes: Vec<_> = workflow
            .nodes
            .iter()
            .filter(|n| n.frame().is_some() || reachable_ids.contains(&n.id))
            .cloned()
            .collect();

        let branch_flow = Workflow {
            nodes,
            edges: included_edges,
            ..workflow
        };

        return begin_run(app, &state, branch_flow, run_mode);
    }

    // Single standalone step: frames come along for working directories.
    let mut nodes: Vec<_> = workflow
        .nodes
        .iter()
        .filter(|n| n.frame().is_some())
        .cloned()
        .collect();
    nodes.push(node);

    let single = Workflow {
        nodes,
        edges: vec![],
        ..workflow
    };

    begin_run(app, &state, single, run_mode)
}

#[tauri::command]
pub fn stop_run(state: State<'_, AppState>) -> Result<(), String> {
    let active = state.active.lock().map_err(|_| "Runtime state is locked")?;
    if let Some(control) = active.as_ref() {
        control.cancel();
    }
    Ok(())
}

#[tauri::command]
pub fn is_running(state: State<'_, AppState>) -> bool {
    state.active.lock().map(|a| a.is_some()).unwrap_or(false)
}

#[tauri::command]
pub async fn apply_sandbox_changes(
    state: State<'_, AppState>,
    run_id: String,
) -> Result<(), String> {
    let mut sandboxes = state.sandboxes.lock().map_err(|_| "Failed to lock sandboxes")?;
    let sandbox = sandboxes
        .remove(&run_id)
        .ok_or_else(|| format!("Sandbox for run {run_id} not found"))?;
    sandbox.apply_changes()?;
    sandbox.cleanup();
    Ok(())
}

#[tauri::command]
pub async fn discard_sandbox(
    state: State<'_, AppState>,
    run_id: String,
) -> Result<(), String> {
    let mut sandboxes = state.sandboxes.lock().map_err(|_| "Failed to lock sandboxes")?;
    if let Some(sandbox) = sandboxes.remove(&run_id) {
        sandbox.cleanup();
    }
    Ok(())
}

fn begin_run(
    app: AppHandle,
    state: &AppState,
    workflow: Workflow,
    run_mode: Option<engine::events::RunMode>,
) -> Result<String, String> {
    let mode = run_mode.unwrap_or(engine::events::RunMode::Live);
    let mut active = state.active.lock().map_err(|_| "Runtime state is locked")?;

    if active.is_some() {
        return Err("A workflow is already running.".into());
    }

    // Validate the graph up front so cycles surface as a clear message rather
    // than a run that starts and quietly does nothing.
    engine::Dag::build(&workflow).map_err(|e| e.to_string())?;

    let run_id = uuid::Uuid::new_v4().to_string();
    let control = Arc::new(RunControl::new());
    *active = Some(control.clone());
    drop(active);

    // Nothing from a previous run may answer this one.
    state.prompts.clear();

    let state_handle = app.clone();
    let sink = WebviewSink { app };
    let prompter = WebviewPrompter {
        registry: state.prompts.clone(),
    };
    let id = run_id.clone();
    let sandboxes = state.sandboxes.clone();

    tauri::async_runtime::spawn(async move {
        let result = engine::execute_with_prompts(
            &workflow,
            &id,
            &sink,
            &control,
            &prompter,
            mode,
        )
        .await;

        // Store the engine's sandbox so Apply/Discard can use it.
        // The engine already created and populated this sandbox during
        // execution — creating a new one here would wipe the changes.
        if let Ok((_, Some(sb))) = result {
            if let Ok(mut map) = sandboxes.lock() {
                map.insert(id.clone(), sb);
            }
        }

        // Free the slot so the next Run works, however this run ended.
        if let Some(state) = state_handle.try_state::<AppState>() {
            state.prompts.clear();
            if let Ok(mut active) = state.active.lock() {
                *active = None;
            }
        }
    });

    Ok(run_id)
}

// --- Environment ----------------------------------------------------------

#[tauri::command]
pub fn home_directory() -> String {
    engine::process::home_dir().display().to_string()
}

/// Native folder picker for choosing a workflow's project directory.
#[tauri::command]
pub async fn pick_directory(app: AppHandle) -> Result<Option<String>, String> {
    let (tx, rx) = tokio::sync::oneshot::channel();

    app.dialog()
        .file()
        .set_title("Choose project folder")
        .pick_folder(move |picked| {
            let _ = tx.send(picked);
        });

    let picked = rx.await.map_err(|_| "Folder picker was dismissed")?;

    Ok(picked
        .and_then(|p| p.into_path().ok())
        .map(|p| p.display().to_string()))
}

