//! The engine's outbound event contract.
//!
//! The engine talks to the outside world *only* through [`EventSink`]. It has
//! no idea Tauri or a webview exists; the app layer implements the sink and
//! forwards events wherever it likes (webview, log file, test harness).

use super::prompt::PromptRequest;
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum OutputStream {
    Stdout,
    Stderr,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum NodeStatus {
    Success,
    Failed,
    Skipped,
    Cancelled,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum RunStatus {
    Success,
    Failed,
    Cancelled,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "event", rename_all = "camelCase")]
pub enum EngineEvent {
    #[serde(rename_all = "camelCase")]
    RunStarted {
        run_id: String,
        /// Execution order the scheduler resolved, for progress display.
        order: Vec<String>,
        at: u64,
    },
    #[serde(rename_all = "camelCase")]
    NodeStarted {
        run_id: String,
        node_id: String,
        /// Fully resolved directory the command actually runs in.
        working_dir: String,
        at: u64,
    },
    #[serde(rename_all = "camelCase")]
    NodeOutput {
        run_id: String,
        node_id: String,
        stream: OutputStream,
        line: String,
        at: u64,
    },
    /// The run has stopped at an interactive step and is waiting for an answer.
    /// Nothing else runs until [`crate::engine::PromptReply`] comes back.
    #[serde(rename_all = "camelCase")]
    NodeWaiting {
        run_id: String,
        node_id: String,
        prompt: PromptRequest,
        at: u64,
    },
    #[serde(rename_all = "camelCase")]
    NodeFinished {
        run_id: String,
        node_id: String,
        status: NodeStatus,
        exit_code: Option<i32>,
        output_value: Option<String>,
        duration_ms: u64,
        at: u64,
    },
    #[serde(rename_all = "camelCase")]
    NodeSkipped {
        run_id: String,
        node_id: String,
        reason: String,
        at: u64,
    },
    #[serde(rename_all = "camelCase")]
    RunFinished {
        run_id: String,
        status: RunStatus,
        duration_ms: u64,
        at: u64,
    },
}

/// Implemented by the host application to receive engine progress.
pub trait EventSink: Send + Sync + 'static {
    fn emit(&self, event: EngineEvent);
}

/// Discards everything. Useful in tests and headless runs.
pub struct NullSink;

impl EventSink for NullSink {
    fn emit(&self, _event: EngineEvent) {}
}
