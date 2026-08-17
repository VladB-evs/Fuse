//! Spawning and supervising a single shell command.
//!
//! Commands run through the user's real login shell so that PATH, nvm, rbenv,
//! Homebrew and friends behave exactly as they do in Terminal.app.
//!
//! Cancellation kills the whole *process group*, not just the shell — otherwise
//! stopping `npm run dev` would orphan node. We put each command in its own
//! group via `setpgid(0, 0)` at spawn time and signal the group on stop.

use super::events::OutputStream;
use std::path::{Path, PathBuf};
use std::process::Stdio;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex;
use std::time::{Duration, Instant};
use tokio::io::{AsyncBufReadExt, AsyncRead, BufReader};
use tokio::process::Command as TokioCommand;
use tokio::sync::mpsc::{self, UnboundedSender};
use tokio::sync::Notify;

#[derive(Debug, thiserror::Error)]
pub enum ProcessError {
    #[error("Working directory does not exist: {0}")]
    MissingWorkingDir(String),
    #[error("Could not start the shell: {0}")]
    Spawn(String),
}

/// Applied to every command, overridable per block.
///
/// Fuse renders ANSI colour in its output panel, so the environment asks for
/// colour rather than suppressing it: without this every tool sees a pipe
/// instead of a terminal and prints flat grey text.
const NON_INTERACTIVE_ENV: &[(&str, &str)] = &[
    // Fail on a credential prompt instead of blocking on one.
    ("GIT_TERMINAL_PROMPT", "0"),
    // Pagers expect a terminal; without this `git log` output goes nowhere.
    ("PAGER", "cat"),
    ("GIT_PAGER", "cat"),
    // Claim a colour-capable terminal. Carriage-return progress redraws are
    // already collapsed by `pump`, so the usual downside does not apply.
    ("TERM", "xterm-256color"),
    ("COLORTERM", "truecolor"),
    // The three flags between them cover most of the CLI world: BSD tools,
    // Node/npm, Python (rich, pytest), Rust and Go tooling.
    ("CLICOLOR", "1"),
    ("CLICOLOR_FORCE", "1"),
    ("FORCE_COLOR", "1"),
    ("PY_COLORS", "1"),
    // Unbuffered Python output so prints stream in real-time
    ("PYTHONUNBUFFERED", "1"),
    ("NODE_NO_WARNINGS", "1"),
    // Git decides on colour by asking whether stdout is a terminal, which a
    // pipe never is. These three are how you override config from outside.
    ("GIT_CONFIG_COUNT", "1"),
    ("GIT_CONFIG_KEY_0", "color.ui"),
    ("GIT_CONFIG_VALUE_0", "always"),
];

/// Errors that mean "this wanted a human at a terminal", in lowercase.
const NEEDS_TERMINAL: &[&str] = &[
    "terminal is required",
    "not a terminal",
    "no tty",
    "terminal is dumb",
    "could not read username",
    "could not read password",
    "cannot run editor",
    "terminal prompts disabled",
];

/// True when a line looks like a command giving up for want of input.
pub fn looks_like_missing_input(line: &str) -> bool {
    let lower = line.to_lowercase();
    NEEDS_TERMINAL.iter().any(|needle| lower.contains(needle))
}

pub struct CommandSpec {
    pub command: String,
    pub working_dir: PathBuf,
    pub env: Vec<(String, String)>,
}

pub struct Outcome {
    pub exit_code: Option<i32>,
    pub duration_ms: u64,
    /// True when the process died because we signalled it.
    pub cancelled: bool,
}

/// Shared handle used to stop an in-flight run from another task.
#[derive(Default)]
pub struct RunControl {
    cancelled: AtomicBool,
    pgid: Mutex<Option<i32>>,
    /// Wakes anything parked on [`RunControl::cancelled_signal`] — a run
    /// waiting on a human has no process to kill, so it needs telling.
    notify: Notify,
}

impl RunControl {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn is_cancelled(&self) -> bool {
        self.cancelled.load(Ordering::SeqCst)
    }

    /// Resolves as soon as the run is cancelled, now or later.
    pub async fn cancelled_signal(&self) {
        loop {
            // Register *before* the check, so a cancel landing between the two
            // still wakes this up rather than parking forever.
            let waiting = self.notify.notified();
            if self.is_cancelled() {
                return;
            }
            waiting.await;
        }
    }

    /// Request cancellation and immediately signal any live process group.
    pub fn cancel(&self) {
        self.cancelled.store(true, Ordering::SeqCst);
        self.notify.notify_waiters();
        let pgid = self.pgid.lock().ok().and_then(|g| *g);
        if let Some(pgid) = pgid {
            signal_group(pgid, libc::SIGTERM);
            // Escalate if it ignores a polite request. Detached so `cancel`
            // stays non-blocking for the caller.
            std::thread::spawn(move || {
                std::thread::sleep(Duration::from_millis(2500));
                signal_group(pgid, libc::SIGKILL);
            });
        }
    }

    fn set_pgid(&self, pgid: Option<i32>) {
        if let Ok(mut guard) = self.pgid.lock() {
            *guard = pgid;
        }
    }
}

fn signal_group(pgid: i32, sig: i32) {
    // ESRCH (already gone) is expected and harmless.
    unsafe {
        libc::killpg(pgid, sig);
    }
}

pub fn home_dir() -> PathBuf {
    std::env::var("HOME")
        .map(PathBuf::from)
        .unwrap_or_else(|_| PathBuf::from("/"))
}

/// Expand a leading `~` and normalise to an absolute path.
pub fn resolve_dir(raw: &str) -> PathBuf {
    let trimmed = raw.trim();
    if trimmed == "~" {
        return home_dir();
    }
    if let Some(rest) = trimmed.strip_prefix("~/") {
        return home_dir().join(rest);
    }
    PathBuf::from(trimmed)
}

/// The user's login shell, falling back to zsh (the macOS default).
fn login_shell() -> String {
    std::env::var("SHELL").unwrap_or_else(|_| "/bin/zsh".to_string())
}

/// Ensure common tools (Homebrew, user local bins, pyenv, nvm, cargo) are reachable
/// even when the GUI app inherits a restricted system PATH.
pub fn enhanced_path() -> String {
    let current_path = std::env::var("PATH").unwrap_or_default();
    let home = home_dir();
    let home_str = home.display().to_string();

    let preferred_paths = [
        "/opt/homebrew/bin",
        "/opt/homebrew/sbin",
        "/usr/local/bin",
        "/usr/local/sbin",
        &format!("{home_str}/.local/bin"),
        &format!("{home_str}/.cargo/bin"),
        &format!("{home_str}/.pyenv/shims"),
        &format!("{home_str}/.nvm/current/bin"),
        &format!("{home_str}/.rbenv/shims"),
        &format!("{home_str}/.nodenv/shims"),
        &format!("{home_str}/bin"),
        "/usr/bin",
        "/bin",
        "/usr/sbin",
        "/sbin",
    ];

    let mut parts: Vec<String> = Vec::new();

    // 1. Add preferred paths first if they exist on disk
    for p in preferred_paths {
        if Path::new(p).is_dir() && !parts.iter().any(|existing| existing == p) {
            parts.push(p.to_string());
        }
    }

    // 2. Append any remaining current PATH elements
    for current in current_path.split(':').filter(|s| !s.is_empty()) {
        if !parts.iter().any(|existing| existing == current) {
            parts.push(current.to_string());
        }
    }

    parts.join(":")
}

use super::events::RunMode;

fn is_destructive_network_cmd(cmd: &str) -> bool {
    use regex::Regex;
    use std::sync::LazyLock;

    // Matches destructive publish/push subcommands anywhere in the command
    // string, so chained commands (`&& git push`), prefixes (`sudo git push`),
    // and interleaved flags (`git -c x push`) are all caught.
    static RE: LazyLock<Regex> = LazyLock::new(|| {
        Regex::new(
            r"(?i)\bgit\s+(?:[^\s;|&]+\s+)*push\b|\b(?:npm|yarn|pnpm|bun|cargo)\s+publish\b",
        )
        .unwrap()
    });

    RE.is_match(cmd)
}

/// Run one command to completion, streaming each output line to `on_line`.
pub async fn run<F>(
    spec: CommandSpec,
    control: &RunControl,
    run_mode: RunMode,
    mut on_line: F,
) -> Result<Outcome, ProcessError>
where
    F: FnMut(OutputStream, String),
{
    let started = Instant::now();

    if run_mode == RunMode::DryRun {
        let display = display_dir(&spec.working_dir);
        on_line(
            OutputStream::Stdout,
            format!("📋 [DRY RUN] Would execute in {}:", display),
        );
        on_line(OutputStream::Stdout, format!("$ {}", spec.command));
        if !spec.env.is_empty() {
            let env_str = spec
                .env
                .iter()
                .map(|(k, v)| format!("{k}={v}"))
                .collect::<Vec<_>>()
                .join(" ");
            on_line(OutputStream::Stdout, format!("📋 [DRY RUN] Env: {}", env_str));
        }

        // Pacing delay (350ms) so the user can visually track simulated node execution on canvas
        tokio::select! {
            _ = tokio::time::sleep(std::time::Duration::from_millis(350)) => {}
            _ = control.cancelled_signal() => {
                return Ok(Outcome {
                    exit_code: None,
                    duration_ms: started.elapsed().as_millis() as u64,
                    cancelled: true,
                });
            }
        }

        return Ok(Outcome {
            exit_code: Some(0),
            duration_ms: started.elapsed().as_millis() as u64,
            cancelled: false,
        });
    }

    if run_mode == RunMode::Sandbox && is_destructive_network_cmd(&spec.command) {
        on_line(
            OutputStream::Stderr,
            format!("🛡️ [SANDBOX GUARD] Blocked network command in sandbox: {}", spec.command),
        );
        on_line(
            OutputStream::Stderr,
            "Real network writes (e.g. git push, npm publish) are prevented during sandbox runs for safety.".to_string(),
        );
        return Ok(Outcome {
            exit_code: Some(1),
            duration_ms: started.elapsed().as_millis() as u64,
            cancelled: false,
        });
    }

    if !spec.working_dir.is_dir() {
        return Err(ProcessError::MissingWorkingDir(
            spec.working_dir.display().to_string(),
        ));
    }

    let shell = login_shell();
    let mut cmd = TokioCommand::new(&shell);

    // `-l` sources the user's profile so PATH matches their Terminal.
    cmd.arg("-l")
        .arg("-c")
        .arg(&spec.command)
        .current_dir(&spec.working_dir)
        // No terminal and no stdin: a command that wants to prompt gets EOF
        // and fails immediately rather than hanging a run forever.
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .kill_on_drop(true);

    // Ensure developer tools and version managers are in PATH
    cmd.env("PATH", enhanced_path());

    // Tell the usual suspects there is nobody to ask. Without this, git waits
    // on a credential prompt it can never receive and pagers swallow output.
    for (key, value) in NON_INTERACTIVE_ENV {
        cmd.env(key, value);
    }

    if run_mode == RunMode::Sandbox {
        cmd.env("FUSE_SANDBOX", "1");
    }

    // The block's own environment wins — this is a floor, not a ceiling.
    for (key, value) in &spec.env {
        cmd.env(key, value);
    }

    // Own process group => cancellation reaches grandchildren too.
    {
        use std::os::unix::process::CommandExt;
        cmd.as_std_mut().process_group(0);
    }

    let mut child = cmd
        .spawn()
        .map_err(|e| ProcessError::Spawn(e.to_string()))?;

    let pgid = child.id().map(|id| id as i32);
    control.set_pgid(pgid);

    // If cancellation landed between the check and the spawn, honour it now.
    if control.is_cancelled() {
        if let Some(pgid) = pgid {
            signal_group(pgid, libc::SIGKILL);
        }
    }

    let (tx, mut rx) = mpsc::unbounded_channel::<(OutputStream, String)>();

    if let Some(stdout) = child.stdout.take() {
        let tx = tx.clone();
        tokio::spawn(pump(stdout, OutputStream::Stdout, tx));
    }
    if let Some(stderr) = child.stderr.take() {
        let tx = tx.clone();
        tokio::spawn(pump(stderr, OutputStream::Stderr, tx));
    }
    // Both pumps hold clones; dropping ours lets the channel close when they end.
    drop(tx);

    while let Some((stream, line)) = rx.recv().await {
        on_line(stream, line);
    }

    let status = child.wait().await;
    control.set_pgid(None);

    let cancelled = control.is_cancelled();
    let exit_code = match status {
        Ok(s) => s.code(),
        Err(_) => None,
    };

    Ok(Outcome {
        exit_code,
        duration_ms: started.elapsed().as_millis() as u64,
        cancelled,
    })
}

/// Read one stream, emitting a message per line.
///
/// Uses raw bytes + lossy UTF-8 so binary-ish output can't kill the run, and
/// collapses carriage-return progress (`git push`, `docker pull`) to the final
/// segment the way a real terminal would render it.
async fn pump<R>(reader: R, stream: OutputStream, tx: UnboundedSender<(OutputStream, String)>)
where
    R: AsyncRead + Unpin,
{
    let mut reader = BufReader::with_capacity(8 * 1024, reader);
    let mut buf: Vec<u8> = Vec::with_capacity(1024);

    loop {
        buf.clear();
        match reader.read_until(b'\n', &mut buf).await {
            Ok(0) => break,
            Ok(_) => {
                let decoded = String::from_utf8_lossy(&buf);
                let trimmed = decoded.trim_end_matches('\n').trim_end_matches('\r');
                let line = trimmed.rsplit('\r').next().unwrap_or("").to_string();
                if tx.send((stream, line)).is_err() {
                    break;
                }
            }
            Err(_) => break,
        }
    }
}

/// Pick the directory a node should run in: node override, else workflow
/// default, else the filesystem root.
pub fn effective_dir(node_dir: Option<&str>, workflow_dir: Option<&str>) -> PathBuf {
    let chosen = node_dir
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .or_else(|| workflow_dir.map(str::trim).filter(|s| !s.is_empty()));

    match chosen {
        Some(dir) => resolve_dir(dir),
        None => PathBuf::from("/"),
    }
}

pub fn display_dir(path: &Path) -> String {
    path.display().to_string()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn node_dir_overrides_workflow_dir() {
        let dir = effective_dir(Some("/tmp"), Some("/usr"));
        assert_eq!(dir, PathBuf::from("/tmp"));
    }

    #[test]
    fn blank_node_dir_inherits_workflow() {
        let dir = effective_dir(Some("  "), Some("/usr"));
        assert_eq!(dir, PathBuf::from("/usr"));
    }

    #[test]
    fn missing_dirs_fall_back_to_filesystem_root() {
        assert_eq!(effective_dir(None, None), PathBuf::from("/"));
    }

    #[test]
    fn terminal_complaints_are_recognised() {
        assert!(looks_like_missing_input(
            "sudo: a terminal is required to read the password"
        ));
        assert!(looks_like_missing_input(
            "fatal: could not read Username for 'https://github.com'"
        ));
        assert!(looks_like_missing_input("error: cannot run editor: vim"));
        assert!(!looks_like_missing_input("error: pathspec did not match"));
    }

    #[tokio::test]
    async fn commands_get_no_stdin_rather_than_hanging() {
        let spec = CommandSpec {
            // Would block forever if stdin were inherited.
            command: "read -r line; echo \"got:[$line]\"".into(),
            working_dir: std::env::temp_dir(),
            env: vec![],
        };

        let mut lines = Vec::new();
        let outcome = run(spec, &RunControl::new(), RunMode::Live, |_, line| lines.push(line))
            .await
            .unwrap();

        assert_eq!(lines, vec!["got:[]".to_string()]);
        assert!(outcome.duration_ms < 5_000, "should not have blocked");
    }

    #[tokio::test]
    async fn the_non_interactive_environment_is_set_but_overridable() {
        let spec = CommandSpec {
            command: "echo \"$GIT_TERMINAL_PROMPT $PAGER $TERM\"".into(),
            working_dir: std::env::temp_dir(),
            env: vec![("TERM".to_string(), "xterm".to_string())],
        };

        let mut lines = Vec::new();
        run(spec, &RunControl::new(), RunMode::Live, |_, line| lines.push(line))
            .await
            .unwrap();

        assert_eq!(lines, vec!["0 cat xterm".to_string()]);
    }

    #[test]
    fn tilde_expands() {
        assert_eq!(resolve_dir("~"), home_dir());
        assert_eq!(resolve_dir("~/dev"), home_dir().join("dev"));
    }

    #[tokio::test]
    async fn captures_stdout_and_exit_code() {
        let control = RunControl::new();
        let mut lines = Vec::new();
        let outcome = run(
            CommandSpec {
                command: "echo hello && echo oops 1>&2".into(),
                working_dir: std::env::temp_dir(),
                env: vec![],
            },
            &control,
            RunMode::Live,
            |stream, line| lines.push((stream, line)),
        )
        .await
        .unwrap();

        assert_eq!(outcome.exit_code, Some(0));
        assert!(lines
            .iter()
            .any(|(s, l)| *s == OutputStream::Stdout && l == "hello"));
        assert!(lines
            .iter()
            .any(|(s, l)| *s == OutputStream::Stderr && l == "oops"));
    }

    /// A block holds a shell line, not a single program: `&&`, `||`, pipes and
    /// newlines all belong to the user's shell and must reach it untouched.
    #[tokio::test]
    async fn shell_operators_work_inside_one_block() {
        let control = RunControl::new();
        let mut lines = Vec::new();
        let outcome = run(
            CommandSpec {
                command: "echo one && echo two | tr a-z A-Z\nfalse || echo recovered".into(),
                working_dir: std::env::temp_dir(),
                env: vec![],
            },
            &control,
            RunMode::Live,
            |_, line| lines.push(line),
        )
        .await
        .unwrap();

        assert_eq!(outcome.exit_code, Some(0));
        assert_eq!(lines, vec!["one", "TWO", "recovered"]);
    }

    /// `&&` must still short-circuit, and the block must fail with it —
    /// otherwise a failed `git commit` would let `git push` look successful.
    #[tokio::test]
    async fn a_failing_left_side_short_circuits_and_fails_the_block() {
        let control = RunControl::new();
        let mut lines = Vec::new();
        let outcome = run(
            CommandSpec {
                command: "exit 4 && echo never".into(),
                working_dir: std::env::temp_dir(),
                env: vec![],
            },
            &control,
            RunMode::Live,
            |_, line| lines.push(line),
        )
        .await
        .unwrap();

        assert_eq!(outcome.exit_code, Some(4));
        assert!(lines.is_empty());
    }

    #[tokio::test]
    async fn reports_failure_exit_codes() {
        let control = RunControl::new();
        let outcome = run(
            CommandSpec {
                command: "exit 3".into(),
                working_dir: std::env::temp_dir(),
                env: vec![],
            },
            &control,
            RunMode::Live,
            |_, _| {},
        )
        .await
        .unwrap();
        assert_eq!(outcome.exit_code, Some(3));
    }

    #[tokio::test]
    async fn env_overrides_reach_the_command() {
        let control = RunControl::new();
        let mut lines = Vec::new();
        run(
            CommandSpec {
                command: "echo $FUSE_TEST_VAR".into(),
                working_dir: std::env::temp_dir(),
                env: vec![("FUSE_TEST_VAR".into(), "wired".into())],
            },
            &control,
            RunMode::Live,
            |_, line| lines.push(line),
        )
        .await
        .unwrap();
        assert!(lines.iter().any(|l| l == "wired"));
    }

    #[tokio::test]
    async fn missing_working_dir_is_reported() {
        let control = RunControl::new();
        let err = run(
            CommandSpec {
                command: "echo hi".into(),
                working_dir: PathBuf::from("/definitely/not/here/fuse"),
                env: vec![],
            },
            &control,
            RunMode::Live,
            |_, _| {},
        )
        .await;
        assert!(matches!(err, Err(ProcessError::MissingWorkingDir(_))));
    }

    #[tokio::test]
    async fn dry_run_simulates_without_spawning() {
        let control = RunControl::new();
        let mut lines = Vec::new();
        let outcome = run(
            CommandSpec {
                command: "rm -rf /definitely/dangerous/path".into(),
                working_dir: std::env::temp_dir(),
                env: vec![],
            },
            &control,
            RunMode::DryRun,
            |_, line| lines.push(line),
        )
        .await
        .unwrap();

        assert_eq!(outcome.exit_code, Some(0));
        assert!(lines.iter().any(|l| l.contains("[DRY RUN] Would execute")));
    }

    #[tokio::test]
    async fn sandbox_mode_blocks_git_push() {
        let control = RunControl::new();
        let mut lines = Vec::new();
        let outcome = run(
            CommandSpec {
                command: "git push origin main".into(),
                working_dir: std::env::temp_dir(),
                env: vec![],
            },
            &control,
            RunMode::Sandbox,
            |stream, line| lines.push((stream, line)),
        )
        .await
        .unwrap();

        assert_eq!(outcome.exit_code, Some(1));
        assert!(lines.iter().any(|(s, l)| *s == OutputStream::Stderr && l.contains("[SANDBOX GUARD] Blocked network command")));
    }

    #[tokio::test]
    async fn cancellation_kills_a_long_command() {
        let control = std::sync::Arc::new(RunControl::new());
        let killer = control.clone();
        tokio::spawn(async move {
            tokio::time::sleep(Duration::from_millis(300)).await;
            killer.cancel();
        });

        let started = Instant::now();
        let outcome = run(
            CommandSpec {
                command: "sleep 30".into(),
                working_dir: std::env::temp_dir(),
                env: vec![],
            },
            &control,
            RunMode::Live,
            |_, _| {},
        )
        .await
        .unwrap();

        assert!(outcome.cancelled);
        assert!(
            started.elapsed() < Duration::from_secs(10),
            "cancel should not wait for the full sleep"
        );
    }
}
