//! The workflow document model.
//!
//! This is the single source of truth for the JSON that Fuse persists *and* the
//! payload the frontend exchanges with Rust. The on-disk shape is deliberately
//! aligned with React Flow's node/edge shape so the canvas can consume it with
//! no translation layer.
//!
//! Adding a node kind later means adding one variant to [`NodePayload`] plus a
//! matching executor arm — nothing else in the engine needs to change.

use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;
use std::time::{SystemTime, UNIX_EPOCH};

pub fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq)]
pub struct Position {
    pub x: f64,
    pub y: f64,
}

/// Per-kind node configuration.
///
/// Serialises adjacently as `{ "type": "command", "data": { .. } }`, which is
/// exactly React Flow's node shape.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(tag = "type", content = "data", rename_all = "camelCase")]
pub enum NodePayload {
    Command(CommandData),
    /// A rectangle on the canvas. Not executable: it sets the working
    /// directory for every command block sitting inside it.
    Frame(FrameData),
    /// Holds the run and waits for a yes or no from the person watching.
    Approval(ApprovalData),
    /// Holds the run and asks which of the connected paths to take.
    Choice(ChoiceData),
    /// Holds the run and asks for a value the later steps can use.
    Input(InputData),
    /// A multi-line program handed to an interpreter of your choosing.
    Script(ScriptData),
    /// Branches on the exit status of a test, without asking anyone.
    Condition(ConditionData),
    /// Runs a command and keeps its output as a value for later steps.
    Capture(CaptureData),
    /// Pauses, or waits for something to come up.
    Wait(WaitData),
    /// An HTTP request, with the response available to later steps.
    Http(HttpData),
    /// A visual sticky note, skipped during execution.
    Note(NoteData),
    /// Reads a file into a variable.
    ReadFile(ReadFileData),
    /// Writes text (or variables) into a file.
    WriteFile(WriteFileData),
    /// Sets a variable inside the workflow state.
    SetVariable(SetVariableData),
    /// Parses a semantic version and increments it.
    BumpVersion(BumpVersionData),
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Default)]
#[serde(rename_all = "camelCase", default)]
pub struct CommandData {
    /// Display title. Empty means the UI shows a sensible default.
    pub label: String,
    pub command: String,
    /// `None` inherits the frame directory, then the workflow one.
    pub working_dir: Option<String>,
    /// The frame this block was dropped into, if any. Assigned by the canvas
    /// when the block is dropped — never inferred from geometry here.
    pub frame_id: Option<String>,
    /// Extra environment on top of the inherited shell environment.
    pub env: BTreeMap<String, String>,
    /// When true, a failure here does not stop downstream nodes.
    pub continue_on_error: bool,
}

/// A stop sign. The run pauses here until someone reads what came before and
/// says whether it should carry on.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", default)]
pub struct ApprovalData {
    pub label: String,
    /// The question put to the user while the run waits.
    pub message: String,
    pub frame_id: Option<String>,
    pub continue_label: String,
    pub stop_label: String,
}

impl Default for ApprovalData {
    fn default() -> Self {
        Self {
            label: "Confirm".into(),
            message: "Check the output above. Continue?".into(),
            frame_id: None,
            continue_label: "Continue".into(),
            stop_label: "Stop".into(),
        }
    }
}

/// A fork. Everything wired out of this node is an option, and only the ones
/// picked at run time are executed — the rest are skipped along with whatever
/// hangs off them.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", default)]
pub struct ChoiceData {
    pub label: String,
    pub message: String,
    pub frame_id: Option<String>,
    /// When true the user may take several paths at once.
    pub allow_multiple: bool,
}

impl Default for ChoiceData {
    fn default() -> Self {
        Self {
            label: "Choose".into(),
            message: "Which path should run next?".into(),
            frame_id: None,
            allow_multiple: false,
        }
    }
}

/// Asks for a value mid-run. Later steps read it as `{{name}}` in their
/// command, or as `$name` in the shell.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", default)]
pub struct InputData {
    pub label: String,
    pub message: String,
    /// Name later steps refer to. Blank means the step has nothing to set.
    pub variable: String,
    pub default_value: String,
    pub frame_id: Option<String>,
    /// Masks the field, and keeps the value out of the output log.
    pub secret: bool,
}

impl Default for InputData {
    fn default() -> Self {
        Self {
            label: "Ask".into(),
            message: "Value for this run".into(),
            variable: String::new(),
            default_value: String::new(),
            frame_id: None,
            secret: false,
        }
    }
}

/// A script, run by whichever interpreter you name.
///
/// The script is written to a temp file and handed to the interpreter through
/// the login shell, so `python3`, `node` and friends resolve through the same
/// PATH (and version manager) they would in a terminal.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", default)]
pub struct ScriptData {
    pub label: String,
    /// Program name or path: `bash`, `python3`, `node`, `ruby`, `/usr/bin/env -S deno run`.
    pub interpreter: String,
    pub script: String,
    pub working_dir: Option<String>,
    pub frame_id: Option<String>,
    pub env: BTreeMap<String, String>,
    pub continue_on_error: bool,
}

impl Default for ScriptData {
    fn default() -> Self {
        Self {
            label: "Script".into(),
            interpreter: "bash".into(),
            script: String::new(),
            working_dir: None,
            frame_id: None,
            env: BTreeMap::new(),
            continue_on_error: false,
        }
    }
}

/// A fork decided by a command's exit status rather than by a person.
///
/// Downstream steps are sorted by the port their wire leaves from: the `false`
/// port when the test fails, everything else when it passes.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", default)]
pub struct ConditionData {
    pub label: String,
    /// A shell command. Exit 0 is true, anything else is false.
    pub test: String,
    pub working_dir: Option<String>,
    pub frame_id: Option<String>,
    pub true_label: String,
    pub false_label: String,
}

impl Default for ConditionData {
    fn default() -> Self {
        Self {
            label: "If".into(),
            test: String::new(),
            working_dir: None,
            frame_id: None,
            true_label: "Yes".into(),
            false_label: "No".into(),
        }
    }
}

/// Runs a command and keeps what it printed, under a name later steps can use.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", default)]
pub struct CaptureData {
    pub label: String,
    pub command: String,
    /// Name later steps read as `{{name}}` or `$name`.
    pub variable: String,
    pub working_dir: Option<String>,
    pub frame_id: Option<String>,
    /// Keep only the first line — the common case for ids, hashes and versions.
    pub first_line_only: bool,
    pub continue_on_error: bool,
}

impl Default for CaptureData {
    fn default() -> Self {
        Self {
            label: "Capture".into(),
            command: String::new(),
            variable: String::new(),
            working_dir: None,
            frame_id: None,
            first_line_only: true,
            continue_on_error: false,
        }
    }
}

/// A pause, or a wait for something to come up.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", default)]
pub struct WaitData {
    pub label: String,
    /// Flat delay before anything else happens.
    pub seconds: f64,
    /// Optional command polled until it succeeds. Empty means "just wait".
    pub until: String,
    pub interval_seconds: f64,
    pub timeout_seconds: f64,
    pub working_dir: Option<String>,
    pub frame_id: Option<String>,
}

impl Default for WaitData {
    fn default() -> Self {
        Self {
            label: "Wait".into(),
            seconds: 2.0,
            until: String::new(),
            interval_seconds: 1.0,
            timeout_seconds: 60.0,
            working_dir: None,
            frame_id: None,
        }
    }
}

/// An HTTP request, issued through `curl` so proxies, certificates and
/// `~/.curlrc` behave the way the rest of the machine expects.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", default)]
pub struct HttpData {
    pub label: String,
    pub method: String,
    pub url: String,
    pub headers: BTreeMap<String, String>,
    pub body: String,
    /// Optional name to keep the response body under.
    pub variable: String,
    /// Treat 4xx and 5xx as a failed step.
    pub fail_on_error_status: bool,
    pub working_dir: Option<String>,
    pub frame_id: Option<String>,
}

impl Default for HttpData {
    fn default() -> Self {
        Self {
            label: "HTTP".into(),
            method: "GET".into(),
            url: String::new(),
            headers: BTreeMap::new(),
            body: String::new(),
            variable: String::new(),
            fail_on_error_status: true,
            working_dir: None,
            frame_id: None,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", default)]
pub struct FrameData {
    pub label: String,
    /// Directory the blocks inside this frame run in. `None` inherits.
    pub working_dir: Option<String>,
    pub width: f64,
    pub height: f64,
}

impl Default for FrameData {
    fn default() -> Self {
        Self {
            label: "Frame".into(),
            working_dir: None,
            width: 480.0,
            height: 360.0,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Default)]
#[serde(rename_all = "camelCase", default)]
pub struct NoteData {
    pub label: String,
    pub frame_id: Option<String>,
    pub text: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Default)]
#[serde(rename_all = "camelCase", default)]
pub struct ReadFileData {
    pub label: String,
    pub frame_id: Option<String>,
    pub path: String,
    pub variable: String,
    pub working_dir: Option<String>,
    pub continue_on_error: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Default)]
#[serde(rename_all = "camelCase", default)]
pub struct WriteFileData {
    pub label: String,
    pub frame_id: Option<String>,
    pub path: String,
    pub content: String,
    pub working_dir: Option<String>,
    pub continue_on_error: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Default)]
#[serde(rename_all = "camelCase", default)]
pub struct SetVariableData {
    pub label: String,
    pub frame_id: Option<String>,
    pub variable: String,
    pub value: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct WorkflowNode {
    pub id: String,
    pub position: Position,
    #[serde(flatten)]
    pub payload: NodePayload,
}
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", default)]
pub struct BumpVersionData {
    pub label: String,
    pub frame_id: Option<String>,
    pub variable_in: String,
    pub variable_out: String,
    pub part: String,
}

impl Default for BumpVersionData {
    fn default() -> Self {
        Self {
            label: "Bump Version".into(),
            frame_id: None,
            variable_in: String::new(),
            variable_out: String::new(),
            part: "patch".into(),
        }
    }
}

impl WorkflowNode {
    pub fn command(&self) -> Option<&CommandData> {
        match &self.payload {
            NodePayload::Command(c) => Some(c),
            _ => None,
        }
    }

    pub fn frame(&self) -> Option<&FrameData> {
        match &self.payload {
            NodePayload::Frame(f) => Some(f),
            _ => None,
        }
    }

    /// Everything except a frame is a step the scheduler has to visit.
    pub fn is_runnable(&self) -> bool {
        !matches!(self.payload, NodePayload::Frame(_))
    }

    /// The frame this step was dropped into, if any. Frames themselves never
    /// nest, so they have none.
    pub fn frame_id(&self) -> Option<&str> {
        match &self.payload {
            NodePayload::Command(c) => c.frame_id.as_deref(),
            NodePayload::Approval(a) => a.frame_id.as_deref(),
            NodePayload::Choice(c) => c.frame_id.as_deref(),
            NodePayload::Input(i) => i.frame_id.as_deref(),
            NodePayload::Script(s) => s.frame_id.as_deref(),
            NodePayload::Condition(c) => c.frame_id.as_deref(),
            NodePayload::Capture(c) => c.frame_id.as_deref(),
            NodePayload::Wait(w) => w.frame_id.as_deref(),
            NodePayload::Http(h) => h.frame_id.as_deref(),
            NodePayload::Note(n) => n.frame_id.as_deref(),
            NodePayload::ReadFile(r) => r.frame_id.as_deref(),
            NodePayload::WriteFile(w) => w.frame_id.as_deref(),
            NodePayload::SetVariable(s) => s.frame_id.as_deref(),
            NodePayload::BumpVersion(b) => b.frame_id.as_deref(),
            NodePayload::Frame(_) => None,
        }
    }

    /// The step's own folder override, before the frame and workflow ones.
    pub fn working_dir(&self) -> Option<&str> {
        match &self.payload {
            NodePayload::Command(c) => c.working_dir.as_deref(),
            NodePayload::Script(s) => s.working_dir.as_deref(),
            NodePayload::Condition(c) => c.working_dir.as_deref(),
            NodePayload::Capture(c) => c.working_dir.as_deref(),
            NodePayload::Wait(w) => w.working_dir.as_deref(),
            NodePayload::Http(h) => h.working_dir.as_deref(),
            NodePayload::ReadFile(r) => r.working_dir.as_deref(),
            NodePayload::WriteFile(w) => w.working_dir.as_deref(),
            _ => None,
        }
    }

    /// Whether a failure here is allowed to let dependents run anyway. Steps
    /// that cannot fail in an interesting way never opt in.
    pub fn continue_on_error(&self) -> bool {
        match &self.payload {
            NodePayload::Command(c) => c.continue_on_error,
            NodePayload::Script(s) => s.continue_on_error,
            NodePayload::Capture(c) => c.continue_on_error,
            NodePayload::ReadFile(r) => r.continue_on_error,
            NodePayload::WriteFile(w) => w.continue_on_error,
            _ => false,
        }
    }

    /// Human label used in logs and errors.
    pub fn title(&self) -> String {
        let named = |label: &str, fallback: &str| {
            if label.trim().is_empty() {
                fallback.to_string()
            } else {
                label.trim().to_string()
            }
        };

        match &self.payload {
            NodePayload::Command(c) => {
                if !c.label.trim().is_empty() {
                    c.label.clone()
                } else if !c.command.trim().is_empty() {
                    c.command.lines().next().unwrap_or_default().to_string()
                } else {
                    "Untitled".to_string()
                }
            }
            NodePayload::Frame(f) => named(&f.label, "Frame"),
            NodePayload::Approval(a) => named(&a.label, "Confirm"),
            NodePayload::Choice(c) => named(&c.label, "Choose"),
            NodePayload::Input(i) => named(&i.label, "Ask"),
            NodePayload::Script(s) => named(&s.label, "Script"),
            NodePayload::Condition(c) => named(&c.label, "If"),
            NodePayload::Capture(c) => named(&c.label, "Capture"),
            NodePayload::Wait(w) => named(&w.label, "Wait"),
            NodePayload::Http(h) => named(&h.label, "HTTP"),
            NodePayload::Note(n) => named(&n.label, "Note"),
            NodePayload::ReadFile(r) => named(&r.label, "Read File"),
            NodePayload::WriteFile(w) => named(&w.label, "Write File"),
            NodePayload::SetVariable(s) => named(&s.label, "Set Variable"),
            NodePayload::BumpVersion(b) => named(&b.label, "Bump Version"),
        }
    }

    /// One line of extra context, used when a step is offered as a choice.
    pub fn detail(&self) -> String {
        match &self.payload {
            NodePayload::Command(c) => c
                .command
                .lines()
                .map(str::trim)
                .find(|line| !line.is_empty())
                .unwrap_or_default()
                .to_string(),
            NodePayload::Approval(a) => a.message.clone(),
            NodePayload::Choice(c) => c.message.clone(),
            NodePayload::Input(i) => i.message.clone(),
            NodePayload::Script(s) => format!(
                "{} script, {} line{}",
                s.interpreter,
                s.script.lines().count(),
                if s.script.lines().count() == 1 { "" } else { "s" }
            ),
            NodePayload::Condition(c) => c.test.clone(),
            NodePayload::Capture(c) => c.command.clone(),
            NodePayload::Wait(w) => {
                if w.until.trim().is_empty() {
                    format!("wait {}s", w.seconds)
                } else {
                    format!("wait until: {}", w.until)
                }
            }
            NodePayload::Http(h) => format!("{} {}", h.method, h.url),
            NodePayload::Note(n) => n.text.clone(),
            NodePayload::ReadFile(r) => format!("Read into {}", r.variable),
            NodePayload::WriteFile(w) => format!("Write {}", w.path),
            NodePayload::SetVariable(s) => format!("Set {} = {}", s.variable, s.value),
            NodePayload::BumpVersion(b) => format!("Bump {} ({})", b.variable_in, b.part),
            NodePayload::Frame(_) => String::new(),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct WorkflowEdge {
    pub id: String,
    pub source: String,
    pub target: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub source_handle: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub target_handle: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Workflow {
    pub id: String,
    pub name: String,
    /// Workflow-wide working directory. Nodes inherit this unless overridden.
    #[serde(default)]
    pub working_dir: Option<String>,
    #[serde(default)]
    pub nodes: Vec<WorkflowNode>,
    #[serde(default)]
    pub edges: Vec<WorkflowEdge>,
    #[serde(default)]
    pub created_at: u64,
    #[serde(default)]
    pub updated_at: u64,
}

impl Workflow {
    pub fn node(&self, id: &str) -> Option<&WorkflowNode> {
        self.nodes.iter().find(|n| n.id == id)
    }

    /// Directory a block should run in, before its own override is applied:
    /// the folder of the frame it was assigned to, falling back to the
    /// workflow folder. Membership is whatever the canvas recorded — the
    /// engine never re-derives it from positions.
    pub fn inherited_dir(&self, node: &WorkflowNode) -> Option<&str> {
        node.frame_id()
            .and_then(|frame_id| self.node(frame_id))
            .and_then(|frame| frame.frame())
            .and_then(|frame| frame.working_dir.as_deref())
            .map(str::trim)
            .filter(|dir| !dir.is_empty())
            .or(self.working_dir.as_deref())
    }
}

/// Lightweight row for the "open workflow" list — avoids parsing whole graphs.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkflowSummary {
    pub id: String,
    pub name: String,
    pub node_count: usize,
    pub updated_at: u64,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn node_round_trips_in_react_flow_shape() {
        let node = WorkflowNode {
            id: "n1".into(),
            position: Position { x: 12.0, y: 40.0 },
            payload: NodePayload::Command(CommandData {
                label: "Terminal".into(),
                command: "git add .".into(),
                ..Default::default()
            }),
        };

        let json = serde_json::to_value(&node).unwrap();
        assert_eq!(json["type"], "command");
        assert_eq!(json["data"]["command"], "git add .");
        assert_eq!(json["id"], "n1");
        assert_eq!(json["position"]["x"], 12.0);

        let back: WorkflowNode = serde_json::from_value(json).unwrap();
        assert_eq!(back, node);
    }

    fn block(id: &str, frame_id: Option<&str>) -> WorkflowNode {
        WorkflowNode {
            id: id.into(),
            position: Position { x: 0.0, y: 0.0 },
            payload: NodePayload::Command(CommandData {
                command: "echo hi".into(),
                frame_id: frame_id.map(str::to_string),
                ..Default::default()
            }),
        }
    }

    fn frame(id: &str, dir: Option<&str>) -> WorkflowNode {
        WorkflowNode {
            id: id.into(),
            position: Position { x: 0.0, y: 0.0 },
            payload: NodePayload::Frame(FrameData {
                label: id.into(),
                working_dir: dir.map(str::to_string),
                ..Default::default()
            }),
        }
    }

    fn with(nodes: Vec<WorkflowNode>, working_dir: Option<&str>) -> Workflow {
        Workflow {
            id: "w".into(),
            name: "t".into(),
            working_dir: working_dir.map(str::to_string),
            nodes,
            edges: vec![],
            created_at: 0,
            updated_at: 0,
        }
    }

    #[test]
    fn a_block_assigned_to_a_frame_inherits_its_directory() {
        let wf = with(
            vec![
                frame("f", Some("/repo")),
                block("inside", Some("f")),
                block("loose", None),
            ],
            Some("/fallback"),
        );

        assert_eq!(wf.inherited_dir(wf.node("inside").unwrap()), Some("/repo"));
        assert_eq!(
            wf.inherited_dir(wf.node("loose").unwrap()),
            Some("/fallback")
        );
    }

    #[test]
    fn a_frame_without_a_directory_falls_through() {
        let wf = with(
            vec![frame("f", None), block("n", Some("f"))],
            Some("/fallback"),
        );

        assert_eq!(wf.inherited_dir(wf.node("n").unwrap()), Some("/fallback"));
    }

    #[test]
    fn overlapping_a_frame_is_not_membership() {
        // The block sits inside the frame's rectangle but was never assigned
        // to it. Geometry must not sneak the directory in.
        let mut wf = with(vec![frame("f", Some("/repo")), block("n", None)], None);
        wf.nodes[0].position = Position {
            x: -100.0,
            y: -100.0,
        };

        assert_eq!(wf.inherited_dir(wf.node("n").unwrap()), None);
    }

    #[test]
    fn a_dangling_frame_id_falls_back_rather_than_panicking() {
        let wf = with(vec![block("n", Some("deleted"))], Some("/fallback"));
        assert_eq!(wf.inherited_dir(wf.node("n").unwrap()), Some("/fallback"));
    }

    #[test]
    fn frame_round_trips_in_react_flow_shape() {
        let node = frame("f1", Some("/tmp"));
        let json = serde_json::to_value(&node).unwrap();

        assert_eq!(json["type"], "frame");
        assert_eq!(json["data"]["workingDir"], "/tmp");
        assert_eq!(json["data"]["width"], 480.0);

        let back: WorkflowNode = serde_json::from_value(json).unwrap();
        assert_eq!(back, node);
        assert!(back.command().is_none());
    }

    #[test]
    fn interactive_kinds_round_trip_and_carry_their_frame() {
        let node = WorkflowNode {
            id: "gate".into(),
            position: Position { x: 0.0, y: 0.0 },
            payload: NodePayload::Approval(ApprovalData {
                message: "Ship it?".into(),
                frame_id: Some("f".into()),
                ..Default::default()
            }),
        };

        let json = serde_json::to_value(&node).unwrap();
        assert_eq!(json["type"], "approval");
        assert_eq!(json["data"]["message"], "Ship it?");
        assert_eq!(json["data"]["continueLabel"], "Continue");

        let back: WorkflowNode = serde_json::from_value(json).unwrap();
        assert_eq!(back, node);
        assert_eq!(back.frame_id(), Some("f"));
        assert!(back.is_runnable(), "a checkpoint is a step, not scenery");
    }

    #[test]
    fn an_interactive_step_inherits_its_frames_directory() {
        let mut gate = WorkflowNode {
            id: "gate".into(),
            position: Position { x: 0.0, y: 0.0 },
            payload: NodePayload::Choice(ChoiceData::default()),
        };
        if let NodePayload::Choice(data) = &mut gate.payload {
            data.frame_id = Some("f".into());
        }

        let wf = with(vec![frame("f", Some("/repo")), gate], Some("/fallback"));
        assert_eq!(wf.inherited_dir(wf.node("gate").unwrap()), Some("/repo"));
    }

    #[test]
    fn older_documents_without_the_new_kinds_still_load() {
        let wf: Workflow = serde_json::from_str(
            r#"{"id":"a","name":"Deploy","nodes":[{"id":"n","position":{"x":0,"y":0},
                "type":"command","data":{"command":"echo hi"}}],"edges":[]}"#,
        )
        .unwrap();
        assert_eq!(wf.nodes[0].command().unwrap().command, "echo hi");
    }

    #[test]
    fn workflow_tolerates_minimal_json() {
        let wf: Workflow =
            serde_json::from_str(r#"{"id":"a","name":"Deploy","nodes":[],"edges":[]}"#).unwrap();
        assert_eq!(wf.name, "Deploy");
        assert!(wf.working_dir.is_none());
    }
}
