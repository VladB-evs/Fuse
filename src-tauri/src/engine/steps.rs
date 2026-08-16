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
use crate::model::{AiCommitData, CaptureData, ConditionData, HttpData, ScriptData, WaitData, ReadFileData, WriteFileData, SetVariableData, NoteData, now_ms};
use std::path::PathBuf;
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
) -> StepOutcome {
    reporter.started(&working_dir);

    if path.trim().is_empty() {
        reporter.err("No file path provided.");
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
        reporter.out(format!(
            "📋 [DRY RUN] Would write {} bytes to: {}",
            content.len(),
            absolute.display()
        ));
        tokio::time::sleep(std::time::Duration::from_millis(300)).await;
        return StepOutcome::plain(reporter.finished(NodeStatus::Success, Some(0)));
    }

    if let Some(parent) = absolute.parent() {
        if !parent.exists() {
            if let Err(err) = std::fs::create_dir_all(parent) {
                reporter.err(format!("Could not create parent directories: {}", err));
            }
        }
    }

    match std::fs::write(&absolute, content.as_bytes()) {
        Ok(_) => {
            reporter.out(format!("Wrote {} bytes to {}", content.len(), absolute.display()));
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

pub(crate) async fn run_bump_version(
    data: &crate::model::BumpVersionData,
    value_in: String,
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

    // Attempt to parse semantic version. We optionally strip a leading "v".
    let version_str = if input.starts_with('v') || input.starts_with('V') {
        &input[1..]
    } else {
        input
    };

    let mut version = match semver::Version::parse(version_str) {
        Ok(v) => v,
        Err(err) => {
            reporter.err(format!("Could not parse as semantic version (e.g. 1.2.3): {}", err));
            return StepOutcome::plain(reporter.finished(NodeStatus::Failed, None));
        }
    };

    match data.part.as_str() {
        "major" => {
            version.major += 1;
            version.minor = 0;
            version.patch = 0;
            version.pre = semver::Prerelease::EMPTY;
        }
        "minor" => {
            version.minor += 1;
            version.patch = 0;
            version.pre = semver::Prerelease::EMPTY;
        }
        "patch" => {
            version.patch += 1;
            version.pre = semver::Prerelease::EMPTY;
        }
        _ => {
            reporter.err(format!("Unknown bump type: {}", data.part));
            return StepOutcome::plain(reporter.finished(NodeStatus::Failed, None));
        }
    }

    // Preserve 'v' prefix if it was there
    let output = if input.starts_with('v') {
        format!("v{}", version)
    } else if input.starts_with('V') {
        format!("V{}", version)
    } else {
        version.to_string()
    };

    reporter.out(format!("Bumped {} to {}", input, output));
    
    StepOutcome {
        status: reporter.finished_with_value(NodeStatus::Success, Some(0), output.clone()),
        value: Some((data.variable_out.trim().to_string(), output)),
        branch: None,
    }
}

pub(crate) async fn run_ai_commit(
    data: &AiCommitData,
    resolved_prompt: Option<String>,
    resolved_input: Option<String>,
    control: &RunControl,
    working_dir: PathBuf,
    reporter: &Reporter<'_>,
    run_mode: RunMode,
) -> StepOutcome {
    reporter.started(&working_dir);

    if data.variable.trim().is_empty() {
        reporter.err("No output variable name provided.");
        return StepOutcome::plain(reporter.finished(NodeStatus::Failed, None));
    }

    let prompt = resolved_prompt
        .filter(|p| !p.trim().is_empty())
        .or_else(|| data.prompt.clone())
        .unwrap_or_else(|| "Summarize the changes into a concise conventional git commit message".to_string());

    if run_mode == RunMode::DryRun {
        reporter.out(format!("📋 [DRY RUN] Would process input and generate summary with prompt: \"{}\"", prompt));
        let simulated = if data.style == "concise" {
            "Simulated concise summary from dry run".to_string()
        } else {
            "feat(core): simulated commit message from dry run".to_string()
        };
        reporter.out(format!("✨ [DRY RUN] Generated result: \"{}\"", simulated));
        if !sleep_unless_stopped(0.35, control).await {
            return StepOutcome::plain(reporter.finished(NodeStatus::Cancelled, None));
        }
        return StepOutcome {
            status: reporter.finished_with_value(NodeStatus::Success, Some(0), simulated.clone()),
            value: Some((data.variable.trim().to_string(), simulated)),
            branch: None,
        };
    }

    // Determine input source:
    // 1. Direct input text passed from an incoming variable/wire (e.g. from git diff or capture node)
    // 2. Fall back to inspecting git diff/status in the working directory
    let (input_content, is_live_repo) = if let Some(ref custom_in) = resolved_input {
        if !custom_in.trim().is_empty() {
            (custom_in.trim().to_string(), false)
        } else {
            (String::new(), true)
        }
    } else {
        (String::new(), true)
    };

    let final_summary = if !is_live_repo && !input_content.is_empty() {
        if let Some(ai_result) = call_apple_intelligence(&input_content, "", &prompt, &data.style, reporter).await {
            ai_result
        } else if input_content.contains("diff --git") || input_content.contains("+++") || input_content.contains("@@") {
            summarize_diff(&input_content, "", &prompt, &data.style)
        } else {
            summarize_general_text(&input_content, &prompt, &data.style)
        }
    } else {
        let mut diff_ran = run_line(
            "git diff --cached".to_string(),
            working_dir.clone(),
            Vec::new(),
            control,
            reporter,
            run_mode,
            false,
            true,
        )
        .await;

        if data.scope == "all" || diff_ran.stdout.trim().is_empty() {
            let all_diff_ran = run_line(
                "git diff HEAD".to_string(),
                working_dir.clone(),
                Vec::new(),
                control,
                reporter,
                run_mode,
                false,
                true,
            )
            .await;

            if !all_diff_ran.stdout.trim().is_empty() {
                diff_ran = all_diff_ran;
            } else {
                let working_diff = run_line(
                    "git diff".to_string(),
                    working_dir.clone(),
                    Vec::new(),
                    control,
                    reporter,
                    run_mode,
                    false,
                    true,
                )
                .await;
                if !working_diff.stdout.trim().is_empty() {
                    diff_ran = working_diff;
                }
            }
        }

        let status_ran = run_line(
            "git status --porcelain".to_string(),
            working_dir.clone(),
            Vec::new(),
            control,
            reporter,
            run_mode,
            false,
            true,
        )
        .await;

        let diff_text = diff_ran.stdout.trim();
        let status_text = status_ran.stdout.trim();

        if diff_text.is_empty() && status_text.is_empty() {
            reporter.err("No changes found in git repository (working tree clean).");
            let fallback = "chore: working tree clean".to_string();
            if data.continue_on_error {
                return StepOutcome {
                    status: reporter.finished_with_value(NodeStatus::Success, Some(0), fallback.clone()),
                    value: Some((data.variable.trim().to_string(), fallback)),
                    branch: None,
                };
            } else {
                return StepOutcome::plain(reporter.finished(NodeStatus::Failed, None));
            }
        }

        let combined_diff = if !status_text.is_empty() && !diff_text.is_empty() {
            format!("Status:\n{}\n\nDiff:\n{}", status_text, diff_text)
        } else if !diff_text.is_empty() {
            diff_text.to_string()
        } else {
            status_text.to_string()
        };

        if let Some(ai_result) = call_apple_intelligence(&combined_diff, status_text, &prompt, &data.style, reporter).await {
            ai_result
        } else {
            summarize_diff(diff_text, status_text, &prompt, &data.style)
        }
    };

    reporter.out(final_summary.clone());

    StepOutcome {
        status: reporter.finished_with_value(NodeStatus::Success, Some(0), final_summary.clone()),
        value: Some((data.variable.trim().to_string(), final_summary)),
        branch: None,
    }
}

const APPLE_INTELLIGENCE_SWIFT: &str = include_str!("../../resources/apple_intelligence.swift");

async fn call_apple_intelligence(
    diff: &str,
    status: &str,
    user_prompt: &str,
    style: &str,
    _reporter: &Reporter<'_>,
) -> Option<String> {
    #[cfg(target_os = "macos")]
    {
        let payload = serde_json::json!({
            "diff": diff,
            "status": status,
            "prompt": user_prompt,
            "style": style,
        });

        let script_path = std::env::temp_dir().join("fuse_apple_intelligence.swift");
        if !script_path.exists() {
            let _ = std::fs::write(&script_path, APPLE_INTELLIGENCE_SWIFT);
        }

        let mut child = tokio::process::Command::new("swift")
            .arg(&script_path)
            .stdin(std::process::Stdio::piped())
            .stdout(std::process::Stdio::piped())
            .stderr(std::process::Stdio::piped())
            .spawn()
            .ok()?;

        if let Some(mut stdin) = child.stdin.take() {
            use tokio::io::AsyncWriteExt;
            let _ = stdin.write_all(payload.to_string().as_bytes()).await;
            let _ = stdin.shutdown().await;
        }

        let output = child.wait_with_output().await.ok()?;
        if output.status.success() {
            let result = String::from_utf8_lossy(&output.stdout).trim().to_string();
            if !result.is_empty() {
                return Some(result);
            }
        }
    }

    #[cfg(not(target_os = "macos"))]
    {
        let _ = (diff, status, user_prompt, style);
    }

    None
}

fn summarize_general_text(content: &str, prompt: &str, style: &str) -> String {
    let lines: Vec<&str> = content.lines().map(|l| l.trim()).filter(|l| !l.is_empty()).collect();
    if lines.is_empty() {
        return "No content to summarize".to_string();
    }

    let prompt_lower = prompt.to_lowercase();
    if style == "concise" || prompt_lower.contains("concise") || prompt_lower.contains("1-sentence") {
        if lines.len() == 1 {
            lines[0].to_string()
        } else {
            format!("{}.", lines[0].trim_end_matches('.'))
        }
    } else if style == "detailed" || prompt_lower.contains("release notes") || prompt_lower.contains("bullet") {
        if lines.len() <= 4 {
            lines.join("\n")
        } else {
            format!("- {}\n- {}\n- {}\n...and {} more items", lines[0], lines[1], lines[2], lines.len() - 3)
        }
    } else {
        if lines.len() == 1 {
            format!("feat(core): {}", lines[0])
        } else {
            format!("feat(core): process {}", lines[0])
        }
    }
}

fn summarize_diff(diff: &str, status: &str, prompt: &str, style: &str) -> String {
    let mut files = Vec::new();
    let mut new_files = Vec::new();
    let mut deleted_files = Vec::new();
    let mut file_hunks: std::collections::HashMap<String, Vec<String>> = std::collections::HashMap::new();
    let mut current_file = String::new();

    // 1. Collect files from git status porcelain
    for line in status.lines() {
        let line = line.trim();
        if line.len() > 3 {
            let flag = &line[0..2];
            let filename = line[3..].trim();
            if flag.contains('A') || flag.contains('?') {
                new_files.push(filename.to_string());
            }
            if flag.contains('D') {
                deleted_files.push(filename.to_string());
            }
            if !files.contains(&filename.to_string()) {
                files.push(filename.to_string());
            }
        }
    }

    // 2. Collect files and hunk lines from diff
    for line in diff.lines() {
        if let Some(rest) = line.strip_prefix("diff --git a/") {
            if let Some(idx) = rest.find(" b/") {
                let filename = rest[..idx].to_string();
                current_file = filename.clone();
                if !files.contains(&filename) {
                    files.push(filename);
                }
            }
        } else if let Some(rest) = line.strip_prefix("+++ b/") {
            let filename = rest.trim().to_string();
            if filename != "/dev/null" {
                current_file = filename.clone();
                if !files.contains(&filename) {
                    files.push(filename);
                }
            }
        } else if !current_file.is_empty() {
            if (line.starts_with('+') && !line.starts_with("+++"))
                || (line.starts_with('-') && !line.starts_with("---"))
                || line.starts_with("@@")
            {
                file_hunks.entry(current_file.clone()).or_default().push(line.to_string());
            }
        }
    }

    // 3. Determine scopes intelligently from files
    let mut scope_counts = std::collections::BTreeMap::new();
    for f in &files {
        let clean = f.replace('\\', "/");
        let parts: Vec<&str> = clean.split('/').collect();
        let scope = if parts.len() >= 2 {
            if parts[0] == "src" || parts[0] == "src-tauri" || parts[0] == "packages" || parts[0] == "app" {
                parts[1]
            } else {
                parts[0]
            }
        } else {
            let base = parts.last().unwrap_or(&"app");
            base.split('.').next().unwrap_or(base)
        };
        let clean_scope = scope.trim_matches(|c: char| !c.is_alphanumeric()).to_lowercase();
        let final_scope = if clean_scope.is_empty() || clean_scope == "src" {
            "core".to_string()
        } else {
            clean_scope
        };
        *scope_counts.entry(final_scope).or_insert(0) += 1;
    }

    let top_scope = scope_counts
        .into_iter()
        .max_by_key(|&(_, count)| count)
        .map(|(s, _)| s)
        .unwrap_or_else(|| "core".to_string());

    // 4. Extract rich file-level actions
    let mut file_actions = Vec::new();
    for f in &files {
        let f_name = f.rsplit('/').next().unwrap_or(f);
        let base_name = f_name.split('.').next().unwrap_or(f_name);

        if new_files.contains(f) {
            file_actions.push(format!("add {} module", base_name));
            continue;
        }
        if deleted_files.contains(f) {
            file_actions.push(format!("remove {}", base_name));
            continue;
        }

        let lines = file_hunks.get(f);
        if let Some(hunk_lines) = lines {
            let mut added_symbols = Vec::new();
            let mut detected_verbs = Vec::new();

            for l in hunk_lines {
                if l.starts_with("@@") {
                    if let Some(idx) = l.rfind("@@") {
                        let ctx = l[idx + 2..].trim();
                        let cleaned = ctx
                            .trim_start_matches("pub ")
                            .trim_start_matches("async ")
                            .trim_start_matches("fn ")
                            .trim_start_matches("function ")
                            .trim_start_matches("export ")
                            .trim_start_matches("const ")
                            .trim_start_matches("struct ")
                            .trim_start_matches("type ");
                        if let Some(p_idx) = cleaned.find('(') {
                            let sym = cleaned[..p_idx].trim();
                            if !sym.is_empty() && sym.len() < 25 && !added_symbols.contains(&sym.to_string()) {
                                added_symbols.push(sym.to_string());
                            }
                        }
                    }
                } else if l.starts_with('+') {
                    let lower = l.to_lowercase();
                    if lower.contains("variable") || lower.contains("interpolat") {
                        detected_verbs.push("support variables");
                    }
                    if lower.contains("preview") || lower.contains("markdown") {
                        detected_verbs.push("add live preview");
                    }
                    if lower.contains("blur") || lower.contains("activeelement") {
                        detected_verbs.push("handle input blur");
                    }
                    if lower.contains("delete") || lower.contains("remove") || lower.contains("doomed") {
                        detected_verbs.push("support deletion");
                    }
                    if lower.contains("fix") || lower.contains("guard") || lower.contains("catch") {
                        detected_verbs.push("fix error handling");
                    }
                    if lower.contains("prompt") || lower.contains("preset") {
                        detected_verbs.push("support prompt presets");
                    }
                    if lower.contains("button") || lower.contains("gradient") || lower.contains("style") {
                        detected_verbs.push("update styles");
                    }
                }
            }

            detected_verbs.dedup();
            if !detected_verbs.is_empty() {
                file_actions.push(format!("{} in {}", detected_verbs.join(" and "), base_name));
            } else if !added_symbols.is_empty() {
                file_actions.push(format!("update {} in {}", added_symbols.join(", "), base_name));
            } else {
                file_actions.push(format!("update {}", base_name));
            }
        } else {
            file_actions.push(format!("update {}", base_name));
        }
    }

    file_actions.dedup();
    if file_actions.is_empty() {
        file_actions.push("update repository changes".to_string());
    }

    let is_fix = diff.to_lowercase().contains("fix") || diff.to_lowercase().contains("bug") || diff.to_lowercase().contains("error");
    let is_feat = !new_files.is_empty() || diff.to_lowercase().contains("add ") || diff.to_lowercase().contains("support ") || diff.to_lowercase().contains("implement ");
    let is_docs = files.iter().all(|f| f.ends_with(".md") || f.contains("readme"));
    let is_style = files.iter().all(|f| f.ends_with(".css") || f.ends_with(".scss"));

    let commit_type = if is_docs {
        "docs"
    } else if is_style {
        "style"
    } else if is_feat {
        "feat"
    } else if is_fix {
        "fix"
    } else {
        "refactor"
    };

    let summary_description = if file_actions.len() >= 3 {
        format!("{}, {}, and {}", file_actions[0], file_actions[1], file_actions[2])
    } else if file_actions.len() == 2 {
        format!("{} and {}", file_actions[0], file_actions[1])
    } else {
        file_actions[0].clone()
    };

    let prompt_lower = prompt.to_lowercase();
    if style == "concise" || prompt_lower.contains("concise") || prompt_lower.contains("1-sentence") {
        let mut chars = summary_description.chars();
        match chars.next() {
            None => "Update repository changes.".to_string(),
            Some(f) => format!("{}.", f.to_uppercase().collect::<String>() + chars.as_str()),
        }
    } else if style == "detailed" || prompt_lower.contains("release notes") || prompt_lower.contains("bullet") {
        let mut notes = Vec::new();
        notes.push(format!("### {}", commit_type.to_uppercase()));
        for act in file_actions.iter().take(6) {
            let mut chars = act.chars();
            let cap = match chars.next() {
                None => act.clone(),
                Some(f) => f.to_uppercase().collect::<String>() + chars.as_str(),
            };
            notes.push(format!("- {}", cap));
        }
        if !files.is_empty() {
            notes.push("".to_string());
            notes.push(format!("*Modified {} file(s) in `{}`*", files.len(), top_scope));
        }
        notes.join("\n")
    } else {
        // Default conventional commit format
        format!("{}({}): {}", commit_type, top_scope, summary_description)
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
    use super::*;

    #[test]
    fn summarize_diff_creates_conventional_commit() {
        let diff = "+ let new_feature = true;";
        let status = "A src/feature.rs";
        let summary = summarize_diff(diff, status, "", "conventional");
        assert!(summary.contains("feature"));
    }
}
