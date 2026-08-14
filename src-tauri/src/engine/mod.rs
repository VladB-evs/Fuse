//! The execution engine.
//!
//! Deliberately ignorant of Tauri, React and the filesystem layout: it takes a
//! [`Workflow`], walks the resolved DAG, and reports progress through an
//! [`EventSink`]. That keeps it unit-testable and means the UI can never be a
//! source of execution bugs.
//!
//! Scheduling rules:
//!   * A node runs only once every dependency has *passed*.
//!   * A failed node blocks everything downstream, unless it opted into
//!     `continueOnError`.
//!   * A branch the user did not pick at a choice step is skipped, and so is
//!     everything hanging off it.
//!   * Blocked nodes are reported as skipped rather than silently dropped, so
//!     the canvas can grey them out.
//!
//! Interactive steps (confirm / choose / ask) suspend the whole run: the
//! scheduler is a single sequential walk, so parking on a question parks
//! everything, which is exactly what "stop and let me look" should mean.

pub mod events;
pub mod graph;
pub mod process;
pub mod prompt;
pub mod steps;

pub use events::{EngineEvent, EventSink, NodeStatus, NullSink, OutputStream, RunStatus};
pub use graph::{Dag, GraphError};
pub use process::RunControl;
pub use prompt::{
    AutoPrompter, PromptFuture, PromptKind, PromptOption, PromptReply, PromptRequest, Prompter,
};

use crate::model::{now_ms, NodePayload, Workflow};
use std::collections::{BTreeMap, HashMap, HashSet};
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::Instant;

/// Appended when a command dies asking for input Fuse cannot give it.
const HINT_NEEDS_INPUT: &str = "Fuse runs commands without a terminal, so this one could not \
prompt. Use a flag that supplies the value (git commit -m …, npm --yes), or put a \
{{placeholder}} in the command and Fuse will ask you for it before the run.";

/// Execute an entire workflow with nobody available to answer questions.
///
/// Interactive steps take their safe default (continue, every path, the
/// pre-filled value). This is the headless entry point; the app uses
/// [`execute_with_prompts`].
pub async fn execute(
    workflow: &Workflow,
    run_id: &str,
    sink: &dyn EventSink,
    control: &RunControl,
) -> Result<RunStatus, GraphError> {
    execute_with_prompts(workflow, run_id, sink, control, &AutoPrompter).await
}

/// Execute an entire workflow, putting interactive steps to `prompter`.
/// Returns the overall outcome.
pub async fn execute_with_prompts(
    workflow: &Workflow,
    run_id: &str,
    sink: &dyn EventSink,
    control: &RunControl,
    prompter: &dyn Prompter,
) -> Result<RunStatus, GraphError> {
    let dag = Dag::build(workflow)?;
    let started = Instant::now();

    sink.emit(EngineEvent::RunStarted {
        run_id: run_id.to_string(),
        order: dag.order().to_vec(),
        at: now_ms(),
    });

    let mut statuses: HashMap<String, NodeStatus> = HashMap::new();
    // Values collected by ask steps, for the steps that come after them.
    let mut values: BTreeMap<String, String> = BTreeMap::new();
    // Choice step -> the branches the user picked. Anything else downstream of
    // that step is skipped.
    let mut taken: HashMap<String, HashSet<String>> = HashMap::new();

    for node_id in dag.order() {
        let Some(node) = workflow.node(node_id) else {
            continue;
        };

        if control.is_cancelled() {
            statuses.insert(node_id.clone(), NodeStatus::Cancelled);
            sink.emit(EngineEvent::NodeSkipped {
                run_id: run_id.to_string(),
                node_id: node_id.clone(),
                reason: "Run stopped".into(),
                at: now_ms(),
            });
            continue;
        }

        if let Some(reason) = blocking_reason(&dag, workflow, node_id, &statuses, &taken) {
            statuses.insert(node_id.clone(), NodeStatus::Skipped);
            sink.emit(EngineEvent::NodeSkipped {
                run_id: run_id.to_string(),
                node_id: node_id.clone(),
                reason,
                at: now_ms(),
            });
            continue;
        }

        // An interactive step parks the run until it is answered.
        if matches!(
            node.payload,
            NodePayload::Approval(_) | NodePayload::Choice(_) | NodePayload::Input(_)
        ) {
            let outcome = ask_step(
                workflow,
                &dag,
                node_id,
                run_id,
                sink,
                control,
                prompter,
                &mut values,
                &mut taken,
            )
            .await;
            statuses.insert(node_id.clone(), outcome);
            continue;
        }

        // Steps that do their own work: script, condition, capture, wait, http.
        if !matches!(
            node.payload,
            NodePayload::Command(_) | NodePayload::Frame(_) | NodePayload::Note(_)
        ) {
            let outcome = automated_step(workflow, node_id, run_id, sink, control, &values).await;

            if let Some((name, value)) = outcome.value {
                values.insert(name, value);
            }
            if let Some(truthy) = outcome.branch {
                taken.insert(node_id.clone(), branch_targets(workflow, node_id, truthy));
            }

            statuses.insert(node_id.clone(), outcome.status);
            continue;
        }

        let Some(data) = node.command() else {
            continue;
        };

        if data.command.trim().is_empty() {
            statuses.insert(node_id.clone(), NodeStatus::Skipped);
            sink.emit(EngineEvent::NodeSkipped {
                run_id: run_id.to_string(),
                node_id: node_id.clone(),
                reason: "No command".into(),
                at: now_ms(),
            });
            continue;
        }

        // A block's own folder wins; otherwise it inherits from the frame it
        // sits in, and only then from the workflow.
        let working_dir =
            process::effective_dir(data.working_dir.as_deref(), workflow.inherited_dir(node));

        sink.emit(EngineEvent::NodeStarted {
            run_id: run_id.to_string(),
            node_id: node_id.clone(),
            working_dir: process::display_dir(&working_dir),
            at: now_ms(),
        });

        // Anything an ask step collected is substituted into the command and
        // also handed over as an environment variable, so `{{tag}}` and `$tag`
        // both work.
        let spec = process::CommandSpec {
            command: substitute(&data.command, &values, Quoting::Shell),
            working_dir,
            env: values
                .iter()
                .filter(|(name, _)| is_env_name(name))
                .map(|(name, value)| (name.clone(), value.clone()))
                .chain(
                    data.env
                        .iter()
                        .map(|(k, v)| (k.clone(), substitute(v, &values, Quoting::Raw))),
                )
                .collect(),
        };

        let node_started = Instant::now();

        // Commands run with no terminal and no stdin, so anything that wanted
        // to prompt dies with a message the user did not write and may not
        // recognise. Watch for those and explain afterwards.
        let wanted_input = AtomicBool::new(false);

        let result = process::run(spec, control, |stream, line| {
            if stream == OutputStream::Stderr && process::looks_like_missing_input(&line) {
                wanted_input.store(true, Ordering::Relaxed);
            }
            sink.emit(EngineEvent::NodeOutput {
                run_id: run_id.to_string(),
                node_id: node_id.clone(),
                stream,
                line,
                at: now_ms(),
            });
        })
        .await;

        let (status, exit_code, duration_ms) = match result {
            Ok(outcome) => {
                let status = if outcome.cancelled && outcome.exit_code != Some(0) {
                    NodeStatus::Cancelled
                } else if outcome.exit_code == Some(0) {
                    NodeStatus::Success
                } else {
                    NodeStatus::Failed
                };
                (status, outcome.exit_code, outcome.duration_ms)
            }
            Err(err) => {
                // Surface setup failures (bad cwd, unusable shell) in the same
                // output stream the user is already reading.
                sink.emit(EngineEvent::NodeOutput {
                    run_id: run_id.to_string(),
                    node_id: node_id.clone(),
                    stream: OutputStream::Stderr,
                    line: err.to_string(),
                    at: now_ms(),
                });
                (
                    NodeStatus::Failed,
                    None,
                    node_started.elapsed().as_millis() as u64,
                )
            }
        };

        if wanted_input.load(Ordering::Relaxed) {
            sink.emit(EngineEvent::NodeOutput {
                run_id: run_id.to_string(),
                node_id: node_id.clone(),
                stream: OutputStream::Stderr,
                line: HINT_NEEDS_INPUT.into(),
                at: now_ms(),
            });
        }

        statuses.insert(node_id.clone(), status);

        sink.emit(EngineEvent::NodeFinished {
            run_id: run_id.to_string(),
            node_id: node_id.clone(),
            status,
            exit_code,
            output_value: None,
            duration_ms,
            at: now_ms(),
        });
    }

    let run_status = if control.is_cancelled() {
        RunStatus::Cancelled
    } else if statuses.values().any(|s| *s == NodeStatus::Failed) {
        RunStatus::Failed
    } else {
        RunStatus::Success
    };

    sink.emit(EngineEvent::RunFinished {
        run_id: run_id.to_string(),
        status: run_status,
        duration_ms: started.elapsed().as_millis() as u64,
        at: now_ms(),
    });

    Ok(run_status)
}

/// `None` means the node is clear to run.
fn blocking_reason(
    dag: &Dag,
    workflow: &Workflow,
    node_id: &str,
    statuses: &HashMap<String, NodeStatus>,
    taken: &HashMap<String, HashSet<String>>,
) -> Option<String> {
    for dep_id in dag.dependencies_of(node_id) {
        // A choice step only feeds the branches that were picked.
        if let Some(chosen) = taken.get(dep_id) {
            if !chosen.contains(node_id) {
                return Some("Skipped — another path was chosen".into());
            }
        }

        match statuses.get(dep_id) {
            Some(NodeStatus::Success) => {}
            Some(NodeStatus::Failed) => {
                let tolerated = workflow
                    .node(dep_id)
                    .map(|n| n.continue_on_error())
                    .unwrap_or(false);
                if !tolerated {
                    let title = workflow
                        .node(dep_id)
                        .map(|n| n.title())
                        .unwrap_or_else(|| dep_id.to_string());
                    return Some(format!("Skipped — \"{title}\" failed"));
                }
            }
            Some(NodeStatus::Skipped) | Some(NodeStatus::Cancelled) => {
                return Some("Skipped — an earlier step did not run".into());
            }
            None => return Some("Skipped — an earlier step did not run".into()),
        }
    }
    None
}

// --- Steps that do their own work -----------------------------------------

/// Resolve a step's folder, substitute the values collected so far, and run it.
///
/// Every kind gets the same treatment before it starts — folder precedence,
/// `{{value}}` substitution, inherited environment — so the differences
/// between them stay in `steps.rs` rather than leaking into the walk.
async fn automated_step(
    workflow: &Workflow,
    node_id: &str,
    run_id: &str,
    sink: &dyn EventSink,
    control: &RunControl,
    values: &BTreeMap<String, String>,
) -> steps::StepOutcome {
    let node = workflow.node(node_id).expect("caller checked the node exists");
    let reporter = steps::Reporter::new(sink, run_id, node_id);
    let working_dir = process::effective_dir(node.working_dir(), workflow.inherited_dir(node));

    // Values reach a step's own environment too, so `$NAME` works alongside
    // `{{NAME}}` exactly as it does in a command block.
    let exported: Vec<(String, String)> = values
        .iter()
        .filter(|(name, _)| is_env_name(name))
        .map(|(name, value)| (name.clone(), value.clone()))
        .collect();

    match &node.payload {
        NodePayload::Script(data) => {
            let env = exported
                .into_iter()
                .chain(
                    data.env
                        .iter()
                        .map(|(k, v)| (k.clone(), substitute(v, values, Quoting::Raw))),
                )
                .collect();

            steps::run_script(
                data,
                // A script is a program, not a command line: values are
                // substituted raw, because quoting them for a shell would put
                // literal quotes into Python or JavaScript source.
                substitute(&data.script, values, Quoting::Raw),
                working_dir,
                env,
                control,
                &reporter,
            )
            .await
        }

        NodePayload::Condition(data) => {
            steps::run_condition(
                data,
                substitute(&data.test, values, Quoting::Shell),
                working_dir,
                control,
                &reporter,
            )
            .await
        }

        NodePayload::Capture(data) => {
            steps::run_capture(
                data,
                substitute(&data.command, values, Quoting::Shell),
                working_dir,
                exported,
                control,
                &reporter,
            )
            .await
        }

        NodePayload::Wait(data) => {
            steps::run_wait(
                data,
                substitute(&data.until, values, Quoting::Shell),
                working_dir,
                control,
                &reporter,
            )
            .await
        }

        NodePayload::Http(data) => {
            let headers = data
                .headers
                .iter()
                .map(|(name, value)| {
                    (
                        name.clone(),
                        substitute(value, values, Quoting::Raw),
                    )
                })
                .collect();

            steps::run_http(
                data,
                substitute(&data.url, values, Quoting::Raw),
                substitute(&data.body, values, Quoting::Raw),
                headers,
                working_dir,
                control,
                &reporter,
            )
            .await
        }

        NodePayload::ReadFile(data) => {
            steps::run_read_file(
                data,
                substitute(&data.path, values, Quoting::Raw),
                working_dir,
                &reporter,
            )
            .await
        }

        NodePayload::WriteFile(data) => {
            steps::run_write_file(
                data,
                substitute(&data.path, values, Quoting::Raw),
                substitute(&data.content, values, Quoting::Raw),
                working_dir,
                &reporter,
            )
            .await
        }

        NodePayload::SetVariable(data) => {
            steps::run_set_variable(
                data,
                substitute(&data.value, values, Quoting::Raw),
                working_dir,
                &reporter,
            )
            .await
        }

        NodePayload::BumpVersion(data) => {
            steps::run_bump_version(
                data,
                substitute(&data.variable_in, values, Quoting::Raw),
                working_dir,
                &reporter,
            )
            .await
        }


        _ => steps::StepOutcome {
            status: NodeStatus::Skipped,
            value: None,
            branch: None,
        },
    }
}

/// The steps on one side of a condition.
///
/// A wire leaving the `false` port is the false branch; everything else — the
/// `true` port, or a wire drawn before the block had ports at all — is the
/// true branch. Defaulting that way means an unlabelled wire behaves like the
/// main path rather than silently never running.
fn branch_targets(workflow: &Workflow, node_id: &str, truthy: bool) -> HashSet<String> {
    workflow
        .edges
        .iter()
        .filter(|edge| edge.source == node_id)
        .filter(|edge| {
            let is_false = edge.source_handle.as_deref() == Some(FALSE_PORT);
            is_false != truthy
        })
        .map(|edge| edge.target.clone())
        .collect()
}

/// Handle id the canvas gives a condition's "no" port.
pub const FALSE_PORT: &str = "false";

// --- Interactive steps ----------------------------------------------------

/// Run one confirm / choose / ask step to completion, including the wait.
///
/// Returns the status the scheduler should record. A step the user stops
/// cancels the whole run: the remaining steps are then reported as stopped by
/// the main loop, which is where all cancellation is handled.
#[allow(clippy::too_many_arguments)]
async fn ask_step(
    workflow: &Workflow,
    dag: &Dag,
    node_id: &str,
    run_id: &str,
    sink: &dyn EventSink,
    control: &RunControl,
    prompter: &dyn Prompter,
    values: &mut BTreeMap<String, String>,
    taken: &mut HashMap<String, HashSet<String>>,
) -> NodeStatus {
    let Some(node) = workflow.node(node_id) else {
        return NodeStatus::Skipped;
    };
    let started = Instant::now();

    let working_dir = process::effective_dir(None, workflow.inherited_dir(node));
    sink.emit(EngineEvent::NodeStarted {
        run_id: run_id.to_string(),
        node_id: node_id.to_string(),
        working_dir: process::display_dir(&working_dir),
        at: now_ms(),
    });

    let say = |stream: OutputStream, line: String| {
        sink.emit(EngineEvent::NodeOutput {
            run_id: run_id.to_string(),
            node_id: node_id.to_string(),
            stream,
            line,
            at: now_ms(),
        });
    };

    let finish = |status: NodeStatus| {
        sink.emit(EngineEvent::NodeFinished {
            run_id: run_id.to_string(),
            node_id: node_id.to_string(),
            status,
            exit_code: None,
            output_value: None,
            duration_ms: started.elapsed().as_millis() as u64,
            at: now_ms(),
        });
        status
    };

    // Everything already run that fed this step — what the user is being asked
    // to look at.
    let sources: Vec<String> = dag.dependencies_of(node_id).to_vec();

    let kind = match &node.payload {
        NodePayload::Approval(data) => PromptKind::Approval {
            continue_label: fallback(&data.continue_label, "Continue"),
            stop_label: fallback(&data.stop_label, "Stop"),
        },
        NodePayload::Choice(data) => {
            let options = branch_options(workflow, node_id);
            if options.is_empty() {
                say(
                    OutputStream::Stderr,
                    "Nothing is connected after this step, so there was nothing to choose."
                        .into(),
                );
                return finish(NodeStatus::Success);
            }
            PromptKind::Choice {
                options,
                allow_multiple: data.allow_multiple,
            }
        }
        NodePayload::Input(data) => {
            if data.variable.trim().is_empty() {
                say(
                    OutputStream::Stderr,
                    "This step has no variable name, so there was nothing to ask for.".into(),
                );
                return finish(NodeStatus::Skipped);
            }
            PromptKind::Input {
                variable: data.variable.trim().to_string(),
                default_value: substitute(&data.default_value, values, Quoting::Raw),
                secret: data.secret,
            }
        }
        _ => return finish(NodeStatus::Skipped),
    };

    let message = match &node.payload {
        NodePayload::Approval(d) => substitute(&d.message, values, Quoting::Raw),
        NodePayload::Choice(d) => substitute(&d.message, values, Quoting::Raw),
        NodePayload::Input(d) => substitute(&d.message, values, Quoting::Raw),
        _ => String::new(),
    };

    let request = PromptRequest {
        run_id: run_id.to_string(),
        node_id: node_id.to_string(),
        title: node.title(),
        message,
        sources,
        kind,
    };

    let reply = ask(request, sink, control, prompter).await;

    match reply {
        PromptReply::Approve => {
            say(OutputStream::Stdout, "Continued.".into());
            finish(NodeStatus::Success)
        }

        PromptReply::Choose { node_ids } => {
            let options = branch_options(workflow, node_id);
            let picked: HashSet<String> = node_ids
                .into_iter()
                .filter(|id| options.iter().any(|o| &o.node_id == id))
                .collect();

            if picked.is_empty() {
                say(OutputStream::Stderr, "No path chosen — run stopped.".into());
                control.cancel();
                return finish(NodeStatus::Cancelled);
            }

            let names: Vec<&str> = options
                .iter()
                .filter(|o| picked.contains(&o.node_id))
                .map(|o| o.label.as_str())
                .collect();
            say(
                OutputStream::Stdout,
                format!("Continuing with {}.", names.join(", ")),
            );

            taken.insert(node_id.to_string(), picked);
            finish(NodeStatus::Success)
        }

        PromptReply::Value { value } => {
            let variable = match &node.payload {
                NodePayload::Input(data) => data.variable.trim().to_string(),
                _ => String::new(),
            };
            let secret = matches!(&node.payload, NodePayload::Input(data) if data.secret);

            say(
                OutputStream::Stdout,
                if secret {
                    format!("{variable} = ••••••••")
                } else {
                    format!("{variable} = {value}")
                },
            );
            values.insert(variable, value);
            finish(NodeStatus::Success)
        }

        PromptReply::Deny => {
            say(OutputStream::Stderr, "Stopped here — nothing after this ran.".into());
            control.cancel();
            finish(NodeStatus::Cancelled)
        }

        PromptReply::Cancelled => {
            // Either the run was stopped from the toolbar, or the question went
            // away. Either way nothing downstream should run.
            control.cancel();
            finish(NodeStatus::Cancelled)
        }
    }
}

/// Put a question to the user and wait, without losing the ability to stop.
async fn ask(
    request: PromptRequest,
    sink: &dyn EventSink,
    control: &RunControl,
    prompter: &dyn Prompter,
) -> PromptReply {
    // Registered before the event goes out, so an instant answer cannot arrive
    // before there is anywhere to put it.
    let pending = prompter.request(request.clone());

    sink.emit(EngineEvent::NodeWaiting {
        run_id: request.run_id.clone(),
        node_id: request.node_id.clone(),
        prompt: request,
        at: now_ms(),
    });

    tokio::select! {
        reply = pending => reply,
        _ = control.cancelled_signal() => PromptReply::Cancelled,
    }
}

/// The runnable steps wired directly out of `node_id` — the paths on offer.
fn branch_options(workflow: &Workflow, node_id: &str) -> Vec<PromptOption> {
    let mut seen: HashSet<&str> = HashSet::new();
    let mut options = Vec::new();

    for edge in &workflow.edges {
        if edge.source != node_id || !seen.insert(edge.target.as_str()) {
            continue;
        }
        let Some(target) = workflow.node(&edge.target) else {
            continue;
        };
        if !target.is_runnable() {
            continue;
        }
        options.push(PromptOption {
            node_id: target.id.clone(),
            label: target.title(),
            detail: target.detail(),
        });
    }

    options
}

fn fallback(value: &str, default: &str) -> String {
    if value.trim().is_empty() {
        default.to_string()
    } else {
        value.trim().to_string()
    }
}

// --- Run-time values ------------------------------------------------------

#[derive(Clone, Copy, PartialEq)]
enum Quoting {
    /// Going into a command line: quote so a value with spaces or quotes in it
    /// stays one argument and cannot break out.
    Shell,
    /// Going somewhere the shell will never parse — an env value, a message.
    Raw,
}

/// True for names a shell will actually let us export.
fn is_env_name(name: &str) -> bool {
    !name.is_empty()
        && !name.starts_with(|c: char| c.is_ascii_digit())
        && name
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '_')
}

/// Replace `{{name}}` with what an ask step collected.
///
/// Unknown names are left alone: they are the up-front `{{placeholder}}`s the
/// UI already filled in, or simply text that happens to look like one.
fn substitute(text: &str, values: &BTreeMap<String, String>, quoting: Quoting) -> String {
    if !text.contains("{{") || values.is_empty() {
        return text.to_string();
    }

    let bytes = text.as_bytes();
    let mut out = String::with_capacity(text.len());
    let mut i = 0;

    while i < text.len() {
        if bytes[i] == b'{' && bytes.get(i + 1) == Some(&b'{') {
            if let Some(end) = text[i + 2..].find("}}") {
                let name = text[i + 2..i + 2 + end].trim();
                if let Some(value) = values.get(name) {
                    let before = text[..i].chars().last();
                    let after = text[i + 4 + end..].chars().next();
                    out.push_str(&quoted(value, quoting, before, after));
                    i += 4 + end;
                    continue;
                }
            }
        }
        let ch = text[i..].chars().next().unwrap();
        out.push(ch);
        i += ch.len_utf8();
    }

    out
}

/// Escape a value for the context it lands in. Mirrors the front end's
/// `fillPlaceholders`, so a value behaves the same whether it was asked for
/// before the run or during it.
fn quoted(value: &str, quoting: Quoting, before: Option<char>, after: Option<char>) -> String {
    if quoting == Quoting::Raw {
        return value.to_string();
    }

    // Already inside double quotes: neutralise what the shell would expand.
    if before == Some('"') && after == Some('"') {
        return value
            .chars()
            .flat_map(|c| {
                if matches!(c, '"' | '\\' | '$' | '`') {
                    vec!['\\', c]
                } else {
                    vec![c]
                }
            })
            .collect();
    }
    // Already inside single quotes: only an apostrophe can escape.
    if before == Some('\'') && after == Some('\'') {
        return value.replace('\'', r"'\''");
    }
    // Bare: quote it ourselves so spaces stay one argument.
    format!("'{}'", value.replace('\'', r"'\''"))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::model::{CommandData, NodePayload, Position, WorkflowEdge, WorkflowNode};
    use std::sync::{Arc, Mutex};

    #[derive(Default)]
    struct Recorder {
        events: Mutex<Vec<EngineEvent>>,
    }

    impl EventSink for Arc<Recorder> {
        fn emit(&self, event: EngineEvent) {
            self.events.lock().unwrap().push(event);
        }
    }

    impl Recorder {
        fn finished(&self) -> Vec<(String, NodeStatus)> {
            self.events
                .lock()
                .unwrap()
                .iter()
                .filter_map(|e| match e {
                    EngineEvent::NodeFinished {
                        node_id, status, ..
                    } => Some((node_id.clone(), *status)),
                    _ => None,
                })
                .collect()
        }

        fn skipped(&self) -> Vec<String> {
            self.events
                .lock()
                .unwrap()
                .iter()
                .filter_map(|e| match e {
                    EngineEvent::NodeSkipped { node_id, .. } => Some(node_id.clone()),
                    _ => None,
                })
                .collect()
        }

        fn stdout_lines(&self) -> Vec<String> {
            self.events
                .lock()
                .unwrap()
                .iter()
                .filter_map(|e| match e {
                    EngineEvent::NodeOutput {
                        stream: OutputStream::Stdout,
                        line,
                        ..
                    } => Some(line.clone()),
                    _ => None,
                })
                .collect()
        }
    }

    fn cmd_node(id: &str, y: f64, command: &str, continue_on_error: bool) -> WorkflowNode {
        WorkflowNode {
            id: id.into(),
            position: Position { x: 0.0, y },
            payload: NodePayload::Command(CommandData {
                label: id.into(),
                command: command.into(),
                continue_on_error,
                ..Default::default()
            }),
        }
    }

    fn edge(source: &str, target: &str) -> WorkflowEdge {
        WorkflowEdge {
            id: format!("{source}->{target}"),
            source: source.into(),
            target: target.into(),
            source_handle: None,
            target_handle: None,
        }
    }

    fn workflow(nodes: Vec<WorkflowNode>, edges: Vec<WorkflowEdge>) -> Workflow {
        Workflow {
            id: "w".into(),
            name: "test".into(),
            working_dir: Some(std::env::temp_dir().display().to_string()),
            nodes,
            edges,
            created_at: 0,
            updated_at: 0,
        }
    }

    #[tokio::test]
    async fn runs_a_chain_in_dependency_order() {
        let wf = workflow(
            vec![
                cmd_node("a", 0.0, "echo one", false),
                cmd_node("b", 100.0, "echo two", false),
                cmd_node("c", 200.0, "echo three", false),
            ],
            vec![edge("a", "b"), edge("b", "c")],
        );

        let sink = Arc::new(Recorder::default());
        let control = RunControl::new();
        let status = execute(&wf, "run-1", &sink, &control).await.unwrap();

        assert_eq!(status, RunStatus::Success);
        assert_eq!(
            sink.finished(),
            vec![
                ("a".to_string(), NodeStatus::Success),
                ("b".to_string(), NodeStatus::Success),
                ("c".to_string(), NodeStatus::Success),
            ]
        );
        assert_eq!(sink.stdout_lines(), vec!["one", "two", "three"]);
    }

    #[tokio::test]
    async fn failure_stops_everything_downstream() {
        let wf = workflow(
            vec![
                cmd_node("a", 0.0, "echo start", false),
                cmd_node("b", 100.0, "exit 1", false),
                cmd_node("c", 200.0, "echo never", false),
            ],
            vec![edge("a", "b"), edge("b", "c")],
        );

        let sink = Arc::new(Recorder::default());
        let control = RunControl::new();
        let status = execute(&wf, "run-2", &sink, &control).await.unwrap();

        assert_eq!(status, RunStatus::Failed);
        assert_eq!(
            sink.finished(),
            vec![
                ("a".to_string(), NodeStatus::Success),
                ("b".to_string(), NodeStatus::Failed),
            ]
        );
        assert_eq!(sink.skipped(), vec!["c".to_string()]);
        assert!(!sink.stdout_lines().contains(&"never".to_string()));
    }

    #[tokio::test]
    async fn continue_on_error_lets_downstream_proceed() {
        let wf = workflow(
            vec![
                cmd_node("a", 0.0, "exit 1", true),
                cmd_node("b", 100.0, "echo still ran", false),
            ],
            vec![edge("a", "b")],
        );

        let sink = Arc::new(Recorder::default());
        let control = RunControl::new();
        execute(&wf, "run-3", &sink, &control).await.unwrap();

        assert!(sink.stdout_lines().contains(&"still ran".to_string()));
    }

    #[tokio::test]
    async fn independent_branches_both_run() {
        let wf = workflow(
            vec![
                cmd_node("root", 0.0, "echo root", false),
                cmd_node("left", 100.0, "echo left", false),
                cmd_node("right", 110.0, "echo right", false),
            ],
            vec![edge("root", "left"), edge("root", "right")],
        );

        let sink = Arc::new(Recorder::default());
        let control = RunControl::new();
        execute(&wf, "run-4", &sink, &control).await.unwrap();

        assert_eq!(sink.stdout_lines(), vec!["root", "left", "right"]);
    }

    #[tokio::test]
    async fn stopping_mid_run_cancels_the_rest() {
        let wf = workflow(
            vec![
                cmd_node("a", 0.0, "sleep 30", false),
                cmd_node("b", 100.0, "echo never", false),
            ],
            vec![edge("a", "b")],
        );

        let sink = Arc::new(Recorder::default());
        let control = Arc::new(RunControl::new());
        let killer = control.clone();
        tokio::spawn(async move {
            tokio::time::sleep(std::time::Duration::from_millis(300)).await;
            killer.cancel();
        });

        let status = execute(&wf, "run-5", &sink, &control).await.unwrap();

        assert_eq!(status, RunStatus::Cancelled);
        assert!(!sink.stdout_lines().contains(&"never".to_string()));
    }

    #[tokio::test]
    async fn a_block_runs_in_the_directory_of_the_frame_it_belongs_to() {
        use crate::model::FrameData;

        let dir = std::env::temp_dir().join("fuse-frame-test");
        std::fs::create_dir_all(&dir).unwrap();
        // macOS hands out /var/… symlinked to /private/var; compare resolved.
        let expected = dir.canonicalize().unwrap().display().to_string();

        let frame = WorkflowNode {
            id: "frame".into(),
            position: Position { x: 0.0, y: 0.0 },
            payload: NodePayload::Frame(FrameData {
                label: "Repo".into(),
                working_dir: Some(dir.display().to_string()),
                width: 400.0,
                height: 300.0,
            }),
        };

        let mut inside = cmd_node("inside", 50.0, "pwd", false);
        if let NodePayload::Command(data) = &mut inside.payload {
            data.frame_id = Some("frame".into());
        }
        // Sits in the same place on the canvas but was never assigned to the
        // frame — proof that membership is the id, not the geometry.
        let outside = cmd_node("outside", 50.0, "pwd", false);

        let wf = workflow(vec![frame, inside, outside], vec![]);

        let sink = Arc::new(Recorder::default());
        let control = RunControl::new();
        execute(&wf, "run-frame", &sink, &control).await.unwrap();

        let lines = sink.stdout_lines();
        assert_eq!(lines.len(), 2, "both blocks should have run");
        assert_eq!(lines[0], expected, "the framed block runs in the frame dir");
        assert_ne!(lines[1], expected, "the unassigned block does not");
    }

    // --- Interactive steps -------------------------------------------------

    use crate::model::{ApprovalData, ChoiceData, InputData};

    /// A prompter with a script: each question is answered with the next reply
    /// in the list, and the questions it was asked are kept for inspection.
    struct Scripted {
        replies: Mutex<Vec<PromptReply>>,
        asked: Mutex<Vec<PromptRequest>>,
    }

    impl Scripted {
        fn new(replies: Vec<PromptReply>) -> Arc<Self> {
            Arc::new(Self {
                replies: Mutex::new(replies.into_iter().rev().collect()),
                asked: Mutex::new(vec![]),
            })
        }
    }

    impl Prompter for Arc<Scripted> {
        fn request(&self, request: PromptRequest) -> PromptFuture {
            self.asked.lock().unwrap().push(request);
            let reply = self
                .replies
                .lock()
                .unwrap()
                .pop()
                .unwrap_or(PromptReply::Cancelled);
            Box::pin(async move { reply })
        }
    }

    fn approval(id: &str, y: f64) -> WorkflowNode {
        WorkflowNode {
            id: id.into(),
            position: Position { x: 0.0, y },
            payload: NodePayload::Approval(ApprovalData {
                label: id.into(),
                ..Default::default()
            }),
        }
    }

    fn choice(id: &str, y: f64, allow_multiple: bool) -> WorkflowNode {
        WorkflowNode {
            id: id.into(),
            position: Position { x: 0.0, y },
            payload: NodePayload::Choice(ChoiceData {
                label: id.into(),
                allow_multiple,
                ..Default::default()
            }),
        }
    }

    fn ask_for(id: &str, y: f64, variable: &str) -> WorkflowNode {
        WorkflowNode {
            id: id.into(),
            position: Position { x: 0.0, y },
            payload: NodePayload::Input(InputData {
                label: id.into(),
                variable: variable.into(),
                ..Default::default()
            }),
        }
    }

    #[tokio::test]
    async fn approving_a_checkpoint_lets_the_rest_run() {
        let wf = workflow(
            vec![
                cmd_node("a", 0.0, "echo before", false),
                approval("gate", 100.0),
                cmd_node("b", 200.0, "echo after", false),
            ],
            vec![edge("a", "gate"), edge("gate", "b")],
        );

        let sink = Arc::new(Recorder::default());
        let prompter = Scripted::new(vec![PromptReply::Approve]);
        let status = execute_with_prompts(&wf, "run-a", &sink, &RunControl::new(), &prompter)
            .await
            .unwrap();

        assert_eq!(status, RunStatus::Success);
        assert!(sink.stdout_lines().contains(&"after".to_string()));

        // The question names the step it is waiting behind, so the UI can show
        // the output the decision is about.
        let asked = prompter.asked.lock().unwrap();
        assert_eq!(asked.len(), 1);
        assert_eq!(asked[0].sources, vec!["a".to_string()]);
        assert!(matches!(asked[0].kind, PromptKind::Approval { .. }));
    }

    #[tokio::test]
    async fn denying_a_checkpoint_stops_the_workflow() {
        let wf = workflow(
            vec![
                cmd_node("a", 0.0, "echo before", false),
                approval("gate", 100.0),
                cmd_node("b", 200.0, "echo after", false),
            ],
            vec![edge("a", "gate"), edge("gate", "b")],
        );

        let sink = Arc::new(Recorder::default());
        let prompter = Scripted::new(vec![PromptReply::Deny]);
        let status = execute_with_prompts(&wf, "run-b", &sink, &RunControl::new(), &prompter)
            .await
            .unwrap();

        assert_eq!(status, RunStatus::Cancelled);
        assert!(!sink.stdout_lines().contains(&"after".to_string()));
        assert_eq!(sink.skipped(), vec!["b".to_string()]);
    }

    #[tokio::test]
    async fn a_choice_runs_only_the_branch_that_was_picked() {
        let wf = workflow(
            vec![
                choice("pick", 0.0, false),
                cmd_node("left", 100.0, "echo left", false),
                cmd_node("right", 110.0, "echo right", false),
                cmd_node("after-left", 200.0, "echo after-left", false),
            ],
            vec![
                edge("pick", "left"),
                edge("pick", "right"),
                edge("left", "after-left"),
            ],
        );

        let sink = Arc::new(Recorder::default());
        let prompter = Scripted::new(vec![PromptReply::Choose {
            node_ids: vec!["left".into()],
        }]);
        let status = execute_with_prompts(&wf, "run-c", &sink, &RunControl::new(), &prompter)
            .await
            .unwrap();

        assert_eq!(status, RunStatus::Success);
        let out = sink.stdout_lines();
        assert!(out.contains(&"left".to_string()));
        // The branch not taken is skipped, and so is everything behind it.
        assert!(!out.contains(&"right".to_string()));
        assert!(out.contains(&"after-left".to_string()));
        assert_eq!(sink.skipped(), vec!["right".to_string()]);

        // Both wired steps were offered.
        let asked = prompter.asked.lock().unwrap();
        match &asked[0].kind {
            PromptKind::Choice { options, .. } => {
                let ids: Vec<&str> = options.iter().map(|o| o.node_id.as_str()).collect();
                assert_eq!(ids, vec!["left", "right"]);
                assert_eq!(options[0].detail, "echo left");
            }
            other => panic!("expected a choice, got {other:?}"),
        }
    }

    #[tokio::test]
    async fn a_choice_can_take_several_paths_at_once() {
        let wf = workflow(
            vec![
                choice("pick", 0.0, true),
                cmd_node("left", 100.0, "echo left", false),
                cmd_node("right", 110.0, "echo right", false),
            ],
            vec![edge("pick", "left"), edge("pick", "right")],
        );

        let sink = Arc::new(Recorder::default());
        let prompter = Scripted::new(vec![PromptReply::Choose {
            node_ids: vec!["left".into(), "right".into()],
        }]);
        execute_with_prompts(&wf, "run-d", &sink, &RunControl::new(), &prompter)
            .await
            .unwrap();

        let out = sink.stdout_lines();
        assert!(out.contains(&"left".to_string()));
        assert!(out.contains(&"right".to_string()));
    }

    #[tokio::test]
    async fn choosing_nothing_stops_the_run() {
        let wf = workflow(
            vec![
                choice("pick", 0.0, false),
                cmd_node("left", 100.0, "echo left", false),
            ],
            vec![edge("pick", "left")],
        );

        let sink = Arc::new(Recorder::default());
        let prompter = Scripted::new(vec![PromptReply::Choose { node_ids: vec![] }]);
        let status = execute_with_prompts(&wf, "run-e", &sink, &RunControl::new(), &prompter)
            .await
            .unwrap();

        assert_eq!(status, RunStatus::Cancelled);
        assert!(sink.stdout_lines().is_empty());
    }

    #[tokio::test]
    async fn a_value_asked_for_mid_run_reaches_later_commands() {
        let wf = workflow(
            vec![
                ask_for("ask", 0.0, "TAG"),
                cmd_node("use", 100.0, "echo {{TAG}} and $TAG", false),
            ],
            vec![edge("ask", "use")],
        );

        let sink = Arc::new(Recorder::default());
        let prompter = Scripted::new(vec![PromptReply::Value {
            value: "v1.2 beta".into(),
        }]);
        execute_with_prompts(&wf, "run-f", &sink, &RunControl::new(), &prompter)
            .await
            .unwrap();

        // Quoted on the way in, so a value with a space stays one argument.
        assert!(sink
            .stdout_lines()
            .contains(&"v1.2 beta and v1.2 beta".to_string()));
    }

    #[tokio::test]
    async fn an_ask_step_without_a_name_is_skipped_rather_than_stalling() {
        let wf = workflow(
            vec![
                ask_for("ask", 0.0, "  "),
                cmd_node("after", 100.0, "echo after", false),
            ],
            vec![],
        );

        let sink = Arc::new(Recorder::default());
        let prompter = Scripted::new(vec![]);
        execute_with_prompts(&wf, "run-g", &sink, &RunControl::new(), &prompter)
            .await
            .unwrap();

        assert!(prompter.asked.lock().unwrap().is_empty());
        assert!(sink.stdout_lines().contains(&"after".to_string()));
    }

    #[tokio::test]
    async fn stopping_the_run_releases_a_step_waiting_on_an_answer() {
        /// Never answers — the run has to free itself.
        struct Silent;
        impl Prompter for Silent {
            fn request(&self, _request: PromptRequest) -> PromptFuture {
                Box::pin(std::future::pending())
            }
        }

        let wf = workflow(
            vec![
                approval("gate", 0.0),
                cmd_node("after", 100.0, "echo after", false),
            ],
            vec![edge("gate", "after")],
        );

        let sink = Arc::new(Recorder::default());
        let control = Arc::new(RunControl::new());
        let killer = control.clone();
        tokio::spawn(async move {
            tokio::time::sleep(std::time::Duration::from_millis(150)).await;
            killer.cancel();
        });

        let status = tokio::time::timeout(
            std::time::Duration::from_secs(5),
            execute_with_prompts(&wf, "run-h", &sink, &control, &Silent),
        )
        .await
        .expect("a stopped run must not hang on a question")
        .unwrap();

        assert_eq!(status, RunStatus::Cancelled);
        assert!(!sink.stdout_lines().contains(&"after".to_string()));
    }

    #[tokio::test]
    async fn blank_commands_are_skipped_not_failed() {
        let wf = workflow(
            vec![
                cmd_node("a", 0.0, "   ", false),
                cmd_node("b", 100.0, "echo after", false),
            ],
            vec![],
        );

        let sink = Arc::new(Recorder::default());
        let control = RunControl::new();
        let status = execute(&wf, "run-6", &sink, &control).await.unwrap();

        assert_eq!(status, RunStatus::Success);
        assert_eq!(sink.skipped(), vec!["a".to_string()]);
    }
}
