//! The steps that do work without asking anyone anything.
//!
//! Each one is a small async function that reports through a [`Reporter`] and
//! hands back a [`StepOutcome`]. They know nothing about scheduling: the walk
//! in `mod.rs` decides what runs, these decide what happens when it does.
//!
//! Everything here ultimately goes through [`process::run`], so cancellation,
//! process-group cleanup and line streaming behave exactly as they do for an
//! ordinary command block.

use super::events::{EngineEvent, EventSink, NodeStatus, OutputStream, RunMode};
use super::process::{self, CommandSpec, RunControl};
use super::prompt::{PromptKind, PromptReply, PromptRequest, Prompter};
use crate::model::{CaptureData, ConditionData, HttpData, ScriptData, WaitData, ReadFileData, WriteFileData, SetVariableData, NoteData, now_ms};
use std::path::{Path, PathBuf};
use std::time::{Duration, Instant};

/// What a step leaves behind for the scheduler.
pub(crate) struct StepOutcome {
    pub status: NodeStatus,
    /// A value to publish for later steps, as (name, value).
    pub value: Option<(String, String)>,
    /// Which way a condition went, if this step was one.
    pub branch: Option<bool>,
}

impl StepOutcome {
    fn plain(status: NodeStatus) -> Self {
        Self {
            status,
            value: None,
            branch: None,
        }
    }
}

/// Emits a step's progress on the run's event channel.
pub(crate) struct Reporter<'a> {
    pub sink: &'a dyn EventSink,
    pub run_id: &'a str,
    pub node_id: &'a str,
    started: Instant,
}

impl<'a> Reporter<'a> {
    pub fn new(sink: &'a dyn EventSink, run_id: &'a str, node_id: &'a str) -> Self {
        Self {
            sink,
            run_id,
            node_id,
            started: Instant::now(),
        }
    }

    pub fn started(&self, working_dir: &std::path::Path) {
        self.sink.emit(EngineEvent::NodeStarted {
            run_id: self.run_id.to_string(),
            node_id: self.node_id.to_string(),
            working_dir: process::display_dir(working_dir),
            at: now_ms(),
        });
    }

    pub fn line(&self, stream: OutputStream, line: impl Into<String>) {
        self.sink.emit(EngineEvent::NodeOutput {
            run_id: self.run_id.to_string(),
            node_id: self.node_id.to_string(),
            stream,
            line: line.into(),
            at: now_ms(),
        });
    }

    pub fn out(&self, line: impl Into<String>) {
        self.line(OutputStream::Stdout, line);
    }

    pub fn err(&self, line: impl Into<String>) {
        self.line(OutputStream::Stderr, line);
    }

    pub fn finished(&self, status: NodeStatus, exit_code: Option<i32>) -> NodeStatus {
        self.sink.emit(EngineEvent::NodeFinished {
            run_id: self.run_id.to_string(),
            node_id: self.node_id.to_string(),
            status,
            exit_code,
            output_value: None,
            duration_ms: self.started.elapsed().as_millis() as u64,
            at: now_ms(),
        });
        status
    }

    pub fn finished_with_value(&self, status: NodeStatus, exit_code: Option<i32>, value: String) -> NodeStatus {
        self.sink.emit(EngineEvent::NodeFinished {
            run_id: self.run_id.to_string(),
            node_id: self.node_id.to_string(),
            status,
            exit_code,
            output_value: Some(value),
            duration_ms: self.started.elapsed().as_millis() as u64,
            at: now_ms(),
        });
        status
    }
}

/// Wrap a value so the shell treats it as one literal argument.
pub(crate) fn shell_quote(value: &str) -> String {
    format!("'{}'", value.replace('\'', r"'\''"))
}

/// Outcome of one command line: what it printed, and how it ended.
struct Ran {
    exit_code: Option<i32>,
    cancelled: bool,
    /// Only collected when asked for; chatty steps skip it.
    stdout: String,
    failed_to_start: bool,
}

/// Run one shell line, streaming (or quietly collecting) its output.
async fn run_line(
    command: String,
    working_dir: PathBuf,
    env: Vec<(String, String)>,
    control: &RunControl,
    reporter: &Reporter<'_>,
    run_mode: RunMode,
    echo: bool,
    collect: bool,
) -> Ran {
    let mut stdout = String::new();

    let result = process::run(
        CommandSpec {
            command,
            working_dir,
            env,
        },
        control,
        run_mode,
        |stream, line| {
            if collect && stream == OutputStream::Stdout {
                if !stdout.is_empty() {
                    stdout.push('\n');
                }
                stdout.push_str(&line);
            }
            if echo {
                reporter.line(stream, line);
            }
        },
    )
    .await;

    match result {
        Ok(outcome) => Ran {
            exit_code: outcome.exit_code,
            cancelled: outcome.cancelled,
            stdout,
            failed_to_start: false,
        },
        Err(err) => {
            reporter.err(err.to_string());
            Ran {
                exit_code: None,
                cancelled: false,
                stdout,
                failed_to_start: true,
            }
        }
    }
}

fn status_for(ran: &Ran) -> NodeStatus {
    if ran.cancelled && ran.exit_code != Some(0) {
        NodeStatus::Cancelled
    } else if ran.exit_code == Some(0) && !ran.failed_to_start {
        NodeStatus::Success
    } else {
        NodeStatus::Failed
    }
}

// --- Script ---------------------------------------------------------------

/// Extensions some interpreters (and every error message) read better with.
fn script_extension(interpreter: &str) -> &'static str {
    let name = interpreter
        .split_whitespace()
        .next()
        .unwrap_or("")
        .rsplit('/')
        .next()
        .unwrap_or("");

    match name {
        "python" | "python3" => "py",
        "node" | "deno" | "bun" => "js",
        "ruby" => "rb",
        "perl" => "pl",
        "php" => "php",
        _ => "sh",
    }
}

/// Run a script through the interpreter named on the block.
pub(crate) async fn run_script(
    data: &ScriptData,
    script: String,
    working_dir: PathBuf,
    env: Vec<(String, String)>,
    control: &RunControl,
    reporter: &Reporter<'_>,
    run_mode: RunMode,
) -> StepOutcome {
    reporter.started(&working_dir);

    let interpreter = data.interpreter.trim();
    if interpreter.is_empty() {
        reporter.err("This step has no interpreter, so there was nothing to run it with.");
        return StepOutcome::plain(reporter.finished(NodeStatus::Skipped, None));
    }
    if script.trim().is_empty() {
        reporter.err("This script is empty.");
        return StepOutcome::plain(reporter.finished(NodeStatus::Skipped, None));
    }

    if run_mode == RunMode::DryRun {
        reporter.out(format!(
            "📋 [DRY RUN] Would run {} script in {}:",
            interpreter,
            process::display_dir(&working_dir)
        ));
        for line in script.lines() {
            reporter.out(format!("  {line}"));
        }
        return StepOutcome::plain(reporter.finished(NodeStatus::Success, Some(0)));
    }

    let path = std::env::temp_dir().join(format!(
        "fuse-script-{}.{}",
        uuid::Uuid::new_v4(),
        script_extension(interpreter)
    ));

    if let Err(err) = std::fs::write(&path, script.as_bytes()) {
        reporter.err(format!("Could not write the script to a temp file: {err}"));
        return StepOutcome::plain(reporter.finished(NodeStatus::Failed, None));
    }

    // The interpreter is *not* quoted as a whole: it may legitimately carry
    // flags ("/usr/bin/env -S deno run"). The path always is.
    let command = format!("{} {}", interpreter, shell_quote(&path.display().to_string()));
    let ran = run_line(command, working_dir, env, control, reporter, run_mode, true, false).await;

    let _ = std::fs::remove_file(&path);

    StepOutcome::plain(reporter.finished(status_for(&ran), ran.exit_code))
}

// --- Condition ------------------------------------------------------------
pub(crate) async fn run_condition(
    data: &ConditionData,
    test: String,
    working_dir: PathBuf,
    control: &RunControl,
    reporter: &Reporter<'_>,
    run_mode: RunMode,
) -> StepOutcome {
    reporter.started(&working_dir);

    if test.trim().is_empty() {
        reporter.err("This step has no test, so there was nothing to decide.");
        return StepOutcome::plain(reporter.finished(NodeStatus::Skipped, None));
    }

    if run_mode == RunMode::DryRun {
        reporter.out(format!("📋 [DRY RUN] Would test condition: {test}"));
        reporter.out("True (Simulated) — taking the default “Yes” path.".to_string());
        if !sleep_unless_stopped(0.35, control).await {
            return StepOutcome::plain(reporter.finished(NodeStatus::Cancelled, None));
        }
        return StepOutcome {
            status: reporter.finished(NodeStatus::Success, Some(0)),
            value: None,
            branch: Some(true),
        };
    }

    reporter.out(format!("$ {test}"));
    let ran = run_line(test, working_dir, vec![], control, reporter, run_mode, true, false).await;

    if ran.cancelled {
        return StepOutcome::plain(reporter.finished(NodeStatus::Cancelled, ran.exit_code));
    }

    let truthy = ran.exit_code == Some(0) && !ran.failed_to_start;
    let label = if truthy {
        &data.true_label
    } else {
        &data.false_label
    };
    reporter.out(format!(
        "{} — taking the “{}” path.",
        if truthy { "True" } else { "False" },
        if label.trim().is_empty() {
            if truthy {
                "Yes"
            } else {
                "No"
            }
        } else {
            label.trim()
        }
    ));

    StepOutcome {
        status: reporter.finished(NodeStatus::Success, ran.exit_code),
        value: None,
        branch: Some(truthy),
    }
}

// --- Capture --------------------------------------------------------------

/// Run a command and keep what it printed under a name.
pub(crate) async fn run_capture(
    data: &CaptureData,
    command: String,
    working_dir: PathBuf,
    env: Vec<(String, String)>,
    control: &RunControl,
    reporter: &Reporter<'_>,
    run_mode: RunMode,
) -> StepOutcome {
    reporter.started(&working_dir);

    let variable = data.variable.trim().to_string();
    if variable.is_empty() {
        reporter.err("This step has no variable name, so there was nothing to keep.");
        return StepOutcome::plain(reporter.finished(NodeStatus::Skipped, None));
    }
    if command.trim().is_empty() {
        reporter.err("This step has no command to run.");
        return StepOutcome::plain(reporter.finished(NodeStatus::Skipped, None));
    }

    if run_mode == RunMode::DryRun {
        reporter.out(format!(
            "📋 [DRY RUN] Would capture output of '{}' into variable '{}'",
            command, variable
        ));
        let simulated = format!("[dry-run-value-for-{variable}]");
        reporter.out(format!("{variable} = {simulated}"));
        if !sleep_unless_stopped(0.35, control).await {
            return StepOutcome::plain(reporter.finished(NodeStatus::Cancelled, None));
        }
        return StepOutcome {
            status: reporter.finished(NodeStatus::Success, Some(0)),
            value: Some((variable, simulated)),
            branch: None,
        };
    }

    reporter.out(format!("$ {command}"));
    let ran = run_line(command, working_dir, env, control, reporter, run_mode, true, true).await;
    let status = status_for(&ran);

    if status != NodeStatus::Success {
        return StepOutcome::plain(reporter.finished(status, ran.exit_code));
    }

    let captured = if data.first_line_only {
        ran.stdout.lines().next().unwrap_or_default().trim().to_string()
    } else {
        ran.stdout.trim().to_string()
    };

    if captured.is_empty() {
        reporter.err(format!("{variable} is empty — the command printed nothing."));
    } else {
        reporter.out(format!("{variable} = {captured}"));
    }

    StepOutcome {
        status: reporter.finished(status, ran.exit_code),
        value: Some((variable, captured)),
        branch: None,
    }
}

// --- Wait -----------------------------------------------------------------

/// Sleep, or poll a command until it succeeds.
///
/// Both halves stay interruptible: a run stopped while this step is sleeping
/// or between polls ends immediately rather than at the next tick.
pub(crate) async fn run_wait(
    data: &WaitData,
    until: String,
    working_dir: PathBuf,
    control: &RunControl,
    reporter: &Reporter<'_>,
    run_mode: RunMode,
) -> StepOutcome {
    reporter.started(&working_dir);

    if run_mode == RunMode::DryRun {
        reporter.out(format!(
            "📋 [DRY RUN] Would wait (delay: {}s, until: '{}')",
            data.seconds, until
        ));
        if !sleep_unless_stopped(0.35, control).await {
            return StepOutcome::plain(reporter.finished(NodeStatus::Cancelled, None));
        }
        return StepOutcome::plain(reporter.finished(NodeStatus::Success, Some(0)));
    }

    let delay = data.seconds.max(0.0);
    if delay > 0.0 {
        reporter.out(format!("Waiting {delay}s…"));
        if !sleep_unless_stopped(delay, control).await {
            return StepOutcome::plain(reporter.finished(NodeStatus::Cancelled, None));
        }
    }

    if until.trim().is_empty() {
        return StepOutcome::plain(reporter.finished(NodeStatus::Success, None));
    }

    let interval = data.interval_seconds.max(0.1);
    let timeout = if data.timeout_seconds > 0.0 {
        data.timeout_seconds
    } else {
        f64::INFINITY
    };

    reporter.out(format!("Waiting until this succeeds: {until}"));

    let started = Instant::now();
    let mut attempt = 0u32;

    loop {
        if control.is_cancelled() {
            return StepOutcome::plain(reporter.finished(NodeStatus::Cancelled, None));
        }

        attempt += 1;
        // Polling output is noise until it matters, so only a failed final
        // attempt gets to speak.
        let ran = run_line(
            until.clone(),
            working_dir.clone(),
            vec![],
            control,
            reporter,
            run_mode,
            false,
            false,
        )
        .await;

        if ran.cancelled {
            return StepOutcome::plain(reporter.finished(NodeStatus::Cancelled, ran.exit_code));
        }
        if ran.exit_code == Some(0) && !ran.failed_to_start {
            reporter.out(format!(
                "Ready after {:.1}s ({attempt} attempt{}).",
                started.elapsed().as_secs_f64(),
                if attempt == 1 { "" } else { "s" }
            ));
            return StepOutcome::plain(reporter.finished(NodeStatus::Success, Some(0)));
        }

        if started.elapsed().as_secs_f64() + interval > timeout {
            reporter.err(format!(
                "Gave up after {:.1}s — it never succeeded.",
                started.elapsed().as_secs_f64()
            ));
            return StepOutcome::plain(reporter.finished(NodeStatus::Failed, ran.exit_code));
        }

        if !sleep_unless_stopped(interval, control).await {
            return StepOutcome::plain(reporter.finished(NodeStatus::Cancelled, None));
        }
    }
}

/// `false` means the run was stopped rather than the sleep completing.
async fn sleep_unless_stopped(seconds: f64, control: &RunControl) -> bool {
    tokio::select! {
        _ = tokio::time::sleep(Duration::from_secs_f64(seconds)) => true,
        _ = control.cancelled_signal() => false,
    }
}

// --- HTTP -----------------------------------------------------------------

/// Marker curl writes after the body, carrying the bits we want back.
const HTTP_TRAILER: &str = "__fuse_http__";

/// Issue an HTTP request and, optionally, keep the response body.
pub(crate) async fn run_http(
    data: &HttpData,
    url: String,
    body: String,
    headers: Vec<(String, String)>,
    working_dir: PathBuf,
    control: &RunControl,
    reporter: &Reporter<'_>,
    run_mode: RunMode,
) -> StepOutcome {
    reporter.started(&working_dir);

    if url.trim().is_empty() {
        reporter.err("This step has no URL.");
        return StepOutcome::plain(reporter.finished(NodeStatus::Skipped, None));
    }

    let method = if data.method.trim().is_empty() {
        "GET".to_string()
    } else {
        data.method.trim().to_uppercase()
    };

    if run_mode == RunMode::DryRun {
        reporter.out(format!(
            "📋 [DRY RUN] Would send HTTP {} request to {}",
            method, url
        ));
        if !body.trim().is_empty() {
            reporter.out(format!("  Body: {body}"));
        }
        if !sleep_unless_stopped(0.35, control).await {
            return StepOutcome::plain(reporter.finished(NodeStatus::Cancelled, None));
        }
        return StepOutcome::plain(reporter.finished(NodeStatus::Success, Some(0)));
    }

    let mut command = format!(
        "curl -sS -L -X {} -w {}",
        shell_quote(&method),
        shell_quote(&format!("\\n{HTTP_TRAILER} %{{http_code}} %{{time_total}}\\n"))
    );

    let has_content_type = headers
        .iter()
        .any(|(name, _)| name.eq_ignore_ascii_case("content-type"));

    for (name, value) in &headers {
        command.push(' ');
        command.push_str(&format!("-H {}", shell_quote(&format!("{name}: {value}"))));
    }

    if !body.trim().is_empty() {
        // A JSON-shaped body with no content type is the one guess worth
        // making: everything else is left exactly as written.
        if !has_content_type && (body.trim_start().starts_with('{') || body.trim_start().starts_with('['))
        {
            command.push_str(" -H 'Content-Type: application/json'");
        }
        command.push(' ');
        command.push_str(&format!("-d {}", shell_quote(&body)));
    }

    command.push(' ');
    command.push_str(&shell_quote(&url));

    reporter.out(format!("$ {method} {url}"));
    let ran = run_line(command, working_dir, vec![], control, reporter, run_mode, false, true).await;

    if ran.cancelled {
        return StepOutcome::plain(reporter.finished(NodeStatus::Cancelled, ran.exit_code));
    }

    let mut status_code: Option<i32> = None;
    let mut elapsed: Option<String> = None;
    let mut response = String::new();

    for line in ran.stdout.lines() {
        if let Some(rest) = line.strip_prefix(HTTP_TRAILER) {
            let mut parts = rest.split_whitespace();
            status_code = parts.next().and_then(|code| code.parse().ok());
            elapsed = parts.next().map(str::to_string);
            continue;
        }
        if !response.is_empty() {
            response.push('\n');
        }
        response.push_str(line);
    }

    for line in response.lines() {
        reporter.out(line.to_string());
    }

    match status_code {
        Some(code) => reporter.line(
            if code >= 400 {
                OutputStream::Stderr
            } else {
                OutputStream::Stdout
            },
            format!(
                "HTTP {code}{}",
                elapsed.map(|t| format!(" · {t}s")).unwrap_or_default()
            ),
        ),
        None => reporter.err("The request did not complete."),
    }

    let variable = data.variable.trim().to_string();
    let value = (!variable.is_empty()).then(|| (variable, response.trim().to_string()));

    let status = if ran.failed_to_start || ran.exit_code != Some(0) || status_code.is_none() {
        NodeStatus::Failed
    } else if data.fail_on_error_status && status_code.is_some_and(|code| code >= 400) {
        NodeStatus::Failed
    } else {
        NodeStatus::Success
    };

    StepOutcome {
        status: reporter.finished(status, status_code),
        value: if status == NodeStatus::Success { value } else { None },
        branch: None,
    }
}

// --- File and Variable Extensions ----------------------------------------

pub(crate) async fn run_read_file(
    data: &ReadFileData,
    path: String,
    working_dir: PathBuf,
    sandbox_ctx: Option<&super::SandboxContext>,
    reporter: &Reporter<'_>,
    run_mode: RunMode,
) -> StepOutcome {
    reporter.started(&working_dir);

    if path.trim().is_empty() {
        reporter.err("No file path provided.");
        return StepOutcome::plain(reporter.finished(NodeStatus::Failed, None));
    }
    
    if data.variable.trim().is_empty() {
        reporter.err("No variable name provided to store the file contents.");
        return StepOutcome::plain(reporter.finished(NodeStatus::Failed, None));
    }

    let mut absolute = if std::path::Path::new(&path).is_absolute() {
        PathBuf::from(path)
    } else {
        working_dir.join(path)
    };
    if let Some(sb) = sandbox_ctx {
        if let Some(remapped) = sb.remap_dir(Some(&absolute)) {
            absolute = remapped;
        }
    }

    if run_mode == RunMode::DryRun {
        reporter.out(format!("📋 [DRY RUN] Would read file: {}", absolute.display()));
        tokio::time::sleep(std::time::Duration::from_millis(300)).await;
        let content = std::fs::read_to_string(&absolute)
            .unwrap_or_else(|_| format!("[dry-run-content for {}]", absolute.display()));
        return StepOutcome {
            status: reporter.finished(NodeStatus::Success, Some(0)),
            value: Some((data.variable.trim().to_string(), content)),
            branch: None,
        };
    }

    match std::fs::read_to_string(&absolute) {
        Ok(content) => {
            reporter.out(format!("Read {} bytes from {}", content.len(), absolute.display()));
            StepOutcome {
                status: reporter.finished(NodeStatus::Success, Some(0)),
                value: Some((data.variable.trim().to_string(), content)),
                branch: None,
            }
        }
        Err(err) => {
            if let Some(ref fallback) = data.fallback {
                if !fallback.is_empty() {
                    reporter.out(format!(
                        "⚠️ File not found ({}), using fallback value ({} bytes)",
                        absolute.display(),
                        fallback.len()
                    ));
                    return StepOutcome {
                        status: reporter.finished(NodeStatus::Success, Some(0)),
                        value: Some((data.variable.trim().to_string(), fallback.clone())),
                        branch: None,
                    };
                }
            }
            reporter.err(format!("Could not read file {}: {}", absolute.display(), err));
            if data.continue_on_error {
                StepOutcome::plain(reporter.finished(NodeStatus::Success, None))
            } else {
                StepOutcome::plain(reporter.finished(NodeStatus::Failed, None))
            }
        }
    }
}

pub(crate) async fn run_write_file(
    data: &WriteFileData,
    path: String,
    content: String,
    working_dir: PathBuf,
    sandbox_ctx: Option<&super::SandboxContext>,
    reporter: &Reporter<'_>,
    run_mode: RunMode,
    run_id: &str,
    node_id: &str,
    sink: &dyn EventSink,
    control: &RunControl,
    prompter: &dyn Prompter,
) -> StepOutcome {
    reporter.started(&working_dir);

    if path.trim().is_empty() {
        reporter.err("No file path provided.");
        return StepOutcome::plain(reporter.finished(NodeStatus::Failed, None));
    }

    let mut current_path = path;
    let mut absolute = if std::path::Path::new(&current_path).is_absolute() {
        PathBuf::from(&current_path)
    } else {
        working_dir.join(&current_path)
    };
    if let Some(sb) = sandbox_ctx {
        if let Some(remapped) = sb.remap_dir(Some(&absolute)) {
            absolute = remapped;
        }
    }

    let mode = data.write_mode.as_deref().unwrap_or("overwrite");
    let mut file_exists = absolute.exists();

    if run_mode == RunMode::DryRun {
        reporter.out(format!(
            "📋 [DRY RUN] Would write {} bytes to {} (mode: {})",
            content.len(),
            absolute.display(),
            mode
        ));
        tokio::time::sleep(std::time::Duration::from_millis(300)).await;
        return StepOutcome::plain(reporter.finished(NodeStatus::Success, Some(0)));
    }

    // Handle "ask" / "ask_new_name" mode when file exists
    if file_exists && (mode == "ask" || mode == "ask_new_name") {
        reporter.out(format!(
            "⚠️ File '{}' already exists on disk. Asking for a new file name…",
            current_path
        ));

        let req = PromptRequest {
            run_id: run_id.to_string(),
            node_id: node_id.to_string(),
            title: format!("File Already Exists: {}", current_path),
            message: format!(
                "The target file '{}' already exists. Enter a new name or path to write to (or leave unchanged to overwrite):",
                current_path
            ),
            sources: vec![],
            kind: PromptKind::Input {
                variable: "NEW_FILE_NAME".to_string(),
                default_value: format!("{}.new", current_path),
                secret: false,
            },
        };

        let reply = super::ask(req, sink, control, prompter).await;
        match reply {
            PromptReply::Value { value } => {
                let trimmed = value.trim().to_string();
                if !trimmed.is_empty() {
                    current_path = trimmed;
                    absolute = if std::path::Path::new(&current_path).is_absolute() {
                        PathBuf::from(&current_path)
                    } else {
                        working_dir.join(&current_path)
                    };
                    if let Some(sb) = sandbox_ctx {
                        if let Some(remapped) = sb.remap_dir(Some(&absolute)) {
                            absolute = remapped;
                        }
                    }
                    file_exists = absolute.exists();
                }
            }
            PromptReply::Approve => {
                // User approved keeping the current path (overwrite)
            }
            PromptReply::Deny | PromptReply::Cancelled => {
                reporter.err("Write operation stopped by user.");
                return StepOutcome::plain(reporter.finished(NodeStatus::Failed, None));
            }
            _ => {}
        }
    } else if file_exists && mode == "auto_rename" {
        // Auto-increment name: file_1.ext, file_2.ext
        let p = Path::new(&current_path);
        let stem = p.file_stem().and_then(|s| s.to_str()).unwrap_or("file");
        let ext = p.extension().and_then(|s| s.to_str()).map(|e| format!(".{}", e)).unwrap_or_default();
        let parent = p.parent().unwrap_or_else(|| Path::new(""));

        let mut counter = 1;
        loop {
            let candidate_name = format!("{}_{}{}", stem, counter, ext);
            let candidate_path = if parent.as_os_str().is_empty() {
                PathBuf::from(candidate_name)
            } else {
                parent.join(candidate_name)
            };
            let candidate_abs = if candidate_path.is_absolute() {
                candidate_path.clone()
            } else {
                working_dir.join(&candidate_path)
            };
            if !candidate_abs.exists() {
                current_path = candidate_path.to_string_lossy().to_string();
                absolute = candidate_abs;
                file_exists = false;
                reporter.out(format!("File already exists: automatically renamed target to '{}'", current_path));
                break;
            }
            counter += 1;
        }
    }

    if let Some(parent) = absolute.parent() {
        if !parent.exists() {
            if let Err(err) = std::fs::create_dir_all(parent) {
                reporter.err(format!("Could not create parent directories: {}", err));
            }
        }
    }

    let write_res = if mode == "append" {
        use std::io::Write;
        std::fs::OpenOptions::new()
            .create(true)
            .append(true)
            .open(&absolute)
            .and_then(|mut f| f.write_all(content.as_bytes()))
    } else {
        std::fs::write(&absolute, content.as_bytes())
    };

    match write_res {
        Ok(_) => {
            let action = if mode == "append" {
                "Appended to"
            } else if file_exists {
                "Overwrote"
            } else {
                "Wrote"
            };
            reporter.out(format!(
                "{} {} ({} bytes written)",
                action,
                absolute.display(),
                content.len()
            ));
            StepOutcome::plain(reporter.finished(NodeStatus::Success, Some(0)))
        }
        Err(err) => {
            reporter.err(format!("Could not write to file {}: {}", absolute.display(), err));
            if data.continue_on_error {
                StepOutcome::plain(reporter.finished(NodeStatus::Success, None))
            } else {
                StepOutcome::plain(reporter.finished(NodeStatus::Failed, None))
            }
        }
    }
}

pub(crate) async fn run_set_variable(
    data: &SetVariableData,
    value: String,
    working_dir: PathBuf,
    reporter: &Reporter<'_>,
) -> StepOutcome {
    reporter.started(&working_dir);

    if data.variable.trim().is_empty() {
        reporter.err("No variable name provided.");
        return StepOutcome::plain(reporter.finished(NodeStatus::Failed, None));
    }

    reporter.out(format!("{} = {}", data.variable.trim(), value));
    
    StepOutcome {
        status: reporter.finished(NodeStatus::Success, Some(0)),
        value: Some((data.variable.trim().to_string(), value)),
        branch: None,
    }
}

pub(crate) fn bump_version_string(
    raw_input: &str,
    part: &str,
    explicit_prefix: Option<&str>,
    explicit_suffix: Option<&str>,
) -> Result<String, String> {
    let mut trimmed = raw_input.trim();
    if trimmed.is_empty() {
        return Err("Input version is empty".into());
    }

    // Detect existing 'v' or 'V' prefix in input if no explicit prefix is specified
    let mut auto_prefix = "";
    if trimmed.starts_with('v') {
        auto_prefix = "v";
        trimmed = &trimmed[1..];
    } else if trimmed.starts_with('V') {
        auto_prefix = "V";
        trimmed = &trimmed[1..];
    }

    // Split off existing prerelease or build metadata if present (e.g. -beta.1 or +20240101)
    let (core_version, _existing_suffix) = if let Some(idx) = trimmed.find(|c| c == '-' || c == '+') {
        (&trimmed[..idx], &trimmed[idx..])
    } else {
        (trimmed, "")
    };

    // Split numeric dot parts
    let parts: Vec<&str> = core_version.split('.').collect();
    let num_parts = parts.len();

    let mut numbers: Vec<u64> = parts
        .iter()
        .map(|s| s.parse::<u64>().map_err(|_| format!("Invalid version component: '{}'", s)))
        .collect::<Result<Vec<u64>, String>>()?;

    if numbers.is_empty() {
        return Err(format!("Could not parse numeric version from '{}'", raw_input));
    }

    match num_parts {
        1 => {
            // Single integer build/counter e.g. "42" -> "43"
            numbers[0] += 1;
        }
        2 => {
            // 2-part version e.g. "0.1"
            match part {
                "major" => {
                    numbers[0] += 1;
                    numbers[1] = 0;
                }
                "minor" | "patch" => {
                    // Both minor and patch bump the secondary number in 2-part versions (0.1 -> 0.2)
                    numbers[1] += 1;
                }
                _ => return Err(format!("Unknown bump type: '{}'", part)),
            }
        }
        3 => {
            // 3-part semver e.g. "1.2.3"
            match part {
                "major" => {
                    numbers[0] += 1;
                    numbers[1] = 0;
                    numbers[2] = 0;
                }
                "minor" => {
                    numbers[1] += 1;
                    numbers[2] = 0;
                }
                "patch" => {
                    numbers[2] += 1;
                }
                _ => return Err(format!("Unknown bump type: '{}'", part)),
            }
        }
        _ => {
            // 4+ part version e.g. "1.2.3.4"
            match part {
                "major" => {
                    numbers[0] += 1;
                    for n in numbers.iter_mut().skip(1) {
                        *n = 0;
                    }
                }
                "minor" => {
                    numbers[1] += 1;
                    for n in numbers.iter_mut().skip(2) {
                        *n = 0;
                    }
                }
                "patch" => {
                    if numbers.len() >= 3 {
                        numbers[2] += 1;
                        for n in numbers.iter_mut().skip(3) {
                            *n = 0;
                        }
                    } else if let Some(last) = numbers.last_mut() {
                        *last += 1;
                    }
                }
                _ => return Err(format!("Unknown bump type: '{}'", part)),
            }
        }
    }

    let bumped_core = numbers
        .iter()
        .map(|n| n.to_string())
        .collect::<Vec<_>>()
        .join(".");

    let prefix = explicit_prefix.unwrap_or(auto_prefix);
    let suffix = explicit_suffix.unwrap_or("");

    Ok(format!("{}{}{}", prefix, bumped_core, suffix))
}

pub(crate) async fn run_bump_version(
    data: &crate::model::BumpVersionData,
    value_in: String,
    prefix: Option<String>,
    suffix: Option<String>,
    working_dir: PathBuf,
    reporter: &Reporter<'_>,
) -> StepOutcome {
    reporter.started(&working_dir);

    if data.variable_out.trim().is_empty() {
        reporter.err("No output variable name provided.");
        return StepOutcome::plain(reporter.finished(NodeStatus::Failed, None));
    }

    let input = value_in.trim();
    if input.is_empty() {
        reporter.err("Input version is empty.");
        return StepOutcome::plain(reporter.finished(NodeStatus::Failed, None));
    }

    let output = match bump_version_string(
        input,
        &data.part,
        prefix.as_deref().or(data.prefix.as_deref()),
        suffix.as_deref().or(data.suffix.as_deref()),
    ) {
        Ok(out) => out,
        Err(err) => {
            reporter.err(format!("Could not bump version '{}': {}", input, err));
            return StepOutcome::plain(reporter.finished(NodeStatus::Failed, None));
        }
    };

    reporter.out(format!("Bumped {} ({}) to {}", input, data.part, output));

    StepOutcome {
        status: reporter.finished_with_value(NodeStatus::Success, Some(0), output.clone()),
        value: Some((data.variable_out.trim().to_string(), output)),
        branch: None,
    }
}

pub(crate) async fn run_note(
    _data: &NoteData,
    rendered: String,
    var_name: Option<String>,
    reporter: &Reporter<'_>,
) -> StepOutcome {
    if let Some(name) = var_name {
        reporter.out(format!("Note evaluated into variable \"{}\"", name));
        StepOutcome {
            status: reporter.finished_with_value(NodeStatus::Success, Some(0), rendered.clone()),
            value: Some((name, rendered)),
            branch: None,
        }
    } else {
        StepOutcome::plain(reporter.finished(NodeStatus::Success, Some(0)))
    }
}

#[cfg(test)]
mod tests {
    use super::bump_version_string;

    #[test]
    fn test_two_part_versions() {
        assert_eq!(bump_version_string("0.1", "minor", None, None).unwrap(), "0.2");
        assert_eq!(bump_version_string("0.1", "patch", None, None).unwrap(), "0.2");
        assert_eq!(bump_version_string("0.1", "major", None, None).unwrap(), "1.0");
        assert_eq!(bump_version_string("1.9", "minor", None, None).unwrap(), "1.10");
        assert_eq!(bump_version_string("1.9", "major", None, None).unwrap(), "2.0");
    }

    #[test]
    fn test_three_part_semver() {
        assert_eq!(bump_version_string("1.2.3", "patch", None, None).unwrap(), "1.2.4");
        assert_eq!(bump_version_string("1.2.3", "minor", None, None).unwrap(), "1.3.0");
        assert_eq!(bump_version_string("1.2.3", "major", None, None).unwrap(), "2.0.0");
        assert_eq!(bump_version_string("v1.2.3", "patch", None, None).unwrap(), "v1.2.4");
    }

    #[test]
    fn test_prefix_and_suffix() {
        assert_eq!(
            bump_version_string("0.1", "patch", Some("v"), Some("-beta.1")).unwrap(),
            "v0.2-beta.1"
        );
        assert_eq!(
            bump_version_string("1.0.0", "minor", Some("release-"), Some("+build.42")).unwrap(),
            "release-1.1.0+build.42"
        );
    }
}

