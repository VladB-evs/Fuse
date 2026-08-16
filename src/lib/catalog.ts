/**
 * What kinds of block exist, in one place.
 *
 * The picker, the command palette, the output panel and the node cards all
 * read from here, so a new kind shows up everywhere at once and can't be
 * described two different ways in two different menus.
 */

import {
  Braces,
  FileCode,
  Frame,
  Globe,
  GitBranch,
  GitCommit,
  GitMerge,
  GitPullRequest,
  ShieldQuestionMark,
  Split,
  TerminalSquare,
  TextCursorInput,
  Timer,
  StickyNote,
  FileUp,
  FileDown,
  Variable,
  ArrowUpFromLine,
  Sparkles,
  type LucideIcon,
} from "lucide-react";
import type { NodeKind, BlockData } from "@/types/workflow";

export type Accent = "fg" | "warn" | "accent" | "success" | "danger" | "cyan";

export type CatalogEntry = {
  kind: NodeKind;
  label: string;
  /** One line, in the imperative: what this block *does*. */
  summary: string;
  /** The longer sentence the picker shows under the name. */
  detail: string;
  icon: LucideIcon;
  accent: Accent;
  group: "Run" | "Flow" | "Values" | "Layout" | "Git";
  /** Extra words the picker's search should match on. */
  keywords: string[];
  /** Shown on the right of a picker row, when there is one. */
  shortcut?: string;
  documentation: {
    what: string;
    when: string;
    example: string;
  };
  /** Pre-filled data for the node when created. */
  prefill?: Partial<BlockData>;
};

export const CATALOG: CatalogEntry[] = [
  {
    kind: "command",
    label: "Command",
    summary: "Run a shell command",
    detail: "One shell line, with pipes, && and your real PATH",
    icon: TerminalSquare,
    accent: "fg",
    group: "Run",
    keywords: ["terminal", "shell", "bash", "run", "cli"],
    shortcut: "A",
    documentation: {
      what: "Executes a single shell command line using your default shell environment.",
      when: "Use this to run quick CLI tools, start processes, or execute standard bash commands.",
      example: "npm run dev",
    },
  },
  {
    kind: "script",
    label: "Script",
    summary: "Run a multi-line script",
    detail: "bash, python3, node, ruby — whatever you name",
    icon: FileCode,
    accent: "cyan",
    group: "Run",
    keywords: ["python", "node", "bash", "program", "code", "multi-line"],
    documentation: {
      what: "Runs a multi-line script in a temporary file using the specified interpreter.",
      when: "Use this when you need complex logic that spans multiple lines or requires a language like Python or Node.js.",
      example: "python3\n\nprint('Hello world!')",
    },
  },
  {
    kind: "http",
    label: "HTTP request",
    summary: "Call an API",
    detail: "Method, URL, headers, body — response kept for later steps",
    icon: Globe,
    accent: "cyan",
    group: "Run",
    keywords: ["api", "rest", "curl", "webhook", "get", "post", "request"],
    documentation: {
      what: "Makes an HTTP request (via curl) and saves the response body to a variable.",
      when: "Use this to fetch data from APIs, trigger webhooks, or test backend services.",
      example: "GET https://api.github.com/repos/vladb/fuse",
    },
  },
  {
    kind: "condition",
    label: "If",
    summary: "Branch on a test",
    detail: "Exit 0 takes the yes path, anything else takes no",
    icon: GitBranch,
    accent: "accent",
    group: "Flow",
    keywords: ["condition", "branch", "test", "else", "when", "guard"],
    documentation: {
      what: "Evaluates a shell command and branches the execution path based on whether it exits with status code 0.",
      when: "Use this to conditionally skip steps, like checking if a file exists before trying to read it.",
      example: "test -f package.json",
    },
  },
  {
    kind: "choice",
    label: "Choose",
    summary: "Ask which path to take",
    detail: "Pauses and lets you pick between the connected steps",
    icon: Split,
    accent: "accent",
    group: "Flow",
    keywords: ["branch", "pick", "fork", "path", "manual"],
    documentation: {
      what: "Pauses the workflow and presents a prompt to the user to manually select which outgoing path(s) to execute.",
      when: "Use this for manual orchestration routing, like picking which environment to deploy to.",
      example: "(Wait for user to select 'Deploy Prod' or 'Deploy Staging')",
    },
  },
  {
    kind: "approval",
    label: "Confirm",
    summary: "Pause for a yes or no",
    detail: "Shows the output so far and waits; no stops the run",
    icon: ShieldQuestionMark,
    accent: "warn",
    group: "Flow",
    keywords: ["approve", "gate", "checkpoint", "pause", "review", "manual"],
    documentation: {
      what: "Pauses execution and waits for the user to manually approve before continuing to the next blocks.",
      when: "Use this as a safety gate before dangerous operations like deploying to production or dropping a database.",
      example: "(Wait for user to click 'Continue')",
    },
  },
  {
    kind: "wait",
    label: "Wait",
    summary: "Pause, or wait for something",
    detail: "A delay, or poll a command until it succeeds",
    icon: Timer,
    accent: "warn",
    group: "Flow",
    keywords: ["sleep", "delay", "retry", "poll", "until", "health"],
    documentation: {
      what: "Delays execution for a fixed number of seconds, or continually polls a command until it exits with code 0.",
      when: "Use this to give a dev server time to boot up before running tests against it.",
      example: "Wait 2s, or until: curl -fsS localhost:3000/health",
    },
  },
  {
    kind: "input",
    label: "Ask",
    summary: "Ask for a value mid-run",
    detail: "Later steps read it as {{name}} or $name",
    icon: TextCursorInput,
    accent: "success",
    group: "Values",
    keywords: ["input", "prompt", "variable", "value", "parameter"],
    documentation: {
      what: "Pauses execution and prompts the user to type in a value, which is then stored in a workflow variable.",
      when: "Use this to ask for a commit message, a version bump number, or a secret token at runtime.",
      example: "Variable: commit_msg",
    },
  },
  {
    kind: "capture",
    label: "Capture",
    summary: "Keep a command's output",
    detail: "Run something, store what it printed under a name",
    icon: Braces,
    accent: "success",
    group: "Values",
    keywords: ["variable", "output", "assign", "set", "store", "stdout"],
    documentation: {
      what: "Runs a shell command and captures its standard output into a workflow variable.",
      when: "Use this to extract data from CLI tools to pass into later steps (e.g., getting the current git branch).",
      example: "git rev-parse --abbrev-ref HEAD -> {{branch_name}}",
    },
  },
  {
    kind: "read_file",
    label: "Read File",
    summary: "Read file contents",
    detail: "Reads a text file into a workflow variable",
    icon: FileUp,
    accent: "success",
    group: "Values",
    keywords: ["read", "file", "fs", "load", "content", "variable"],
    documentation: {
      what: "Reads the entire contents of a file from disk and stores it into a workflow variable.",
      when: "Use this to load configuration files, templates, or logs to pass into subsequent HTTP requests or scripts.",
      example: "Read package.json into {{pkg}}",
    },
  },
  {
    kind: "write_file",
    label: "Write File",
    summary: "Write text to a file",
    detail: "Saves content (including variables) to disk",
    icon: FileDown,
    accent: "success",
    group: "Values",
    keywords: ["write", "file", "fs", "save", "output", "export"],
    documentation: {
      what: "Writes a string (which can include substituted variables) into a file on the local filesystem.",
      when: "Use this to generate configuration files, update JSON, or save API responses to disk.",
      example: "Write {{api_response}} to data.json",
    },
  },
  {
    kind: "set_variable",
    label: "Set Variable",
    summary: "Set a workflow variable",
    detail: "Assign a hardcoded value or substitute existing variables",
    icon: Variable,
    accent: "success",
    group: "Values",
    keywords: ["set", "variable", "assign", "value", "env"],
    documentation: {
      what: "Evaluates a string expression and assigns the result to a new workflow variable.",
      when: "Use this to define static configuration constants, or to concatenate existing variables together.",
      example: "Set {{url}} = https://api.example.com/{{version}}",
    },
  },
  {
    kind: "bump_version",
    label: "Bump Version",
    summary: "Increment a semantic version",
    detail: "Bumps the major, minor, or patch part of a v1.2.3 string",
    icon: ArrowUpFromLine,
    accent: "success",
    group: "Values",
    keywords: ["bump", "version", "semver", "tag", "release", "increment"],
    documentation: {
      what: "Parses a semantic version from an input variable and increments the specified part (major, minor, or patch).",
      when: "Use this when you want to automatically calculate the next version tag for a git release.",
      example: "Bump minor of {{current_version}} into {{next_version}}",
    },
  },
  {
    kind: "ai_commit",
    label: "AI Summarizer / Model",
    summary: "Summarize & transform with AI",
    detail: "Receives variables/diffs, summarizes with prompt, and outputs variable",
    icon: Sparkles,
    accent: "accent",
    group: "Values",
    keywords: ["ai", "commit", "intelligence", "diff", "summary", "prompt", "model", "smart", "llm", "values"],
    documentation: {
      what: "Takes input from an incoming variable or git diff, applies an AI prompt/summary, and outputs the result into a variable.",
      when: "Use this to generate conventional commit messages from git diff, summarize logs, or transform text before downstream steps.",
      example: "Feed {{git_diff}} into AI -> Output {{commit_message}} -> Run git commit -m '{{commit_message}}'",
    },
  },
  {
    kind: "frame",
    label: "Frame",
    summary: "Group blocks under a folder",
    detail: "Everything inside runs in the frame's directory",
    icon: Frame,
    accent: "fg",
    group: "Layout",
    keywords: ["group", "folder", "directory", "repo", "container"],
    shortcut: "F",
    documentation: {
      what: "A visual container that sets the default working directory for all blocks placed inside it.",
      when: "Use this to organize your canvas and ensure blocks run in the correct project folder.",
      example: "(Drag blocks inside to assign them to ~/my-project)",
    },
  },
  {
    kind: "note",
    label: "Note / Markdown",
    summary: "Add a markdown note",
    detail: "Supports variables, live markdown preview, and output variables",
    icon: StickyNote,
    accent: "fg",
    group: "Values",
    keywords: ["text", "comment", "documentation", "markdown", "sticky", "variable", "template"],
    shortcut: "N",
    documentation: {
      what: "A rich markdown note that evaluates template variables (like {{commit_message}} or {{version}}), renders live formatted markdown, and can save its evaluated content to a variable for other notes and steps to use.",
      when: "Use this to create dynamic changelogs, compose messages, explain workflows, or pass templates to downstream blocks.",
      example: "# Release {{next_version}}\n\n{{commit_message}}",
    },
  },
{
    kind: "command", label: "Git Init", summary: "Initialize repository", detail: "git init",
    icon: GitBranch, accent: "cyan", group: "Git", keywords: ["git", "init"],
    documentation: { what: "Initializes a Git repository.", when: "Starting a new project.", example: "git init" },
    prefill: { label: "Git Init", command: "git init" },
  },
  {
    kind: "command", label: "Git Clone", summary: "Clone repository", detail: "git clone",
    icon: GitBranch, accent: "cyan", group: "Git", keywords: ["git", "clone"],
    documentation: { what: "Clones a repository.", when: "Downloading a project.", example: "git clone {{url}}" },
    prefill: { label: "Git Clone", command: "git clone \"{{repository_url}}\"" },
  },
  {
    kind: "command", label: "Git Status", summary: "Show status", detail: "git status",
    icon: GitBranch, accent: "cyan", group: "Git", keywords: ["git", "status"],
    documentation: { what: "Shows working tree status.", when: "Checking for changes.", example: "git status" },
    prefill: { label: "Git Status", command: "git status" },
  },
  {
    kind: "command", label: "Git Add All", summary: "Stage all changes", detail: "git add .",
    icon: GitBranch, accent: "cyan", group: "Git", keywords: ["git", "add"],
    documentation: { what: "Stages all changes.", when: "Preparing to commit.", example: "git add ." },
    prefill: { label: "Git Add All", command: "git add ." },
  },
  {
    kind: "command", label: "Git Commit", summary: "Commit changes", detail: "git commit",
    icon: GitCommit, accent: "cyan", group: "Git", keywords: ["git", "commit"],
    documentation: { what: "Commits staged changes.", when: "Saving work.", example: "git commit -m 'msg'" },
    prefill: { label: "Git Commit", command: "git commit -m \"{{commit_message}}\"" },
  },
  {
    kind: "command", label: "Git Push", summary: "Push commits", detail: "git push",
    icon: GitBranch, accent: "cyan", group: "Git", keywords: ["git", "push"],
    documentation: { what: "Pushes commits to remote.", when: "Sharing work.", example: "git push" },
    prefill: { label: "Git Push", command: "git push origin \"{{branch_name}}\"" },
  },
  {
    kind: "command", label: "Git Pull", summary: "Pull commits", detail: "git pull",
    icon: GitPullRequest, accent: "cyan", group: "Git", keywords: ["git", "pull"],
    documentation: { what: "Pulls commits from remote.", when: "Updating branch.", example: "git pull" },
    prefill: { label: "Git Pull", command: "git pull origin \"{{branch_name}}\"" },
  },
  {
    kind: "command", label: "Git Branch", summary: "List branches", detail: "git branch",
    icon: GitBranch, accent: "cyan", group: "Git", keywords: ["git", "branch"],
    documentation: { what: "Lists branches.", when: "Checking branches.", example: "git branch" },
    prefill: { label: "Git Branch", command: "git branch" },
  },
  {
    kind: "command", label: "Git Checkout", summary: "Switch branch", detail: "git checkout",
    icon: GitBranch, accent: "cyan", group: "Git", keywords: ["git", "checkout"],
    documentation: { what: "Switches branch.", when: "Changing branches.", example: "git checkout main" },
    prefill: { label: "Git Checkout", command: "git checkout \"{{branch_name}}\"" },
  },
  {
    kind: "command", label: "Git Merge", summary: "Merge branch", detail: "git merge",
    icon: GitMerge, accent: "cyan", group: "Git", keywords: ["git", "merge"],
    documentation: { what: "Merges a branch.", when: "Integrating changes.", example: "git merge feat" },
    prefill: { label: "Git Merge", command: "git merge \"{{branch_name}}\"" },
  },
  {
    kind: "command", label: "Git Rebase", summary: "Rebase branch", detail: "git rebase",
    icon: GitBranch, accent: "cyan", group: "Git", keywords: ["git", "rebase"],
    documentation: { what: "Rebases current branch.", when: "Updating from main.", example: "git rebase main" },
    prefill: { label: "Git Rebase", command: "git rebase \"{{branch_name}}\"" },
  },
  {
    kind: "command", label: "Git Cherry-Pick", summary: "Cherry-pick commit", detail: "git cherry-pick",
    icon: GitBranch, accent: "cyan", group: "Git", keywords: ["git", "cherry", "pick"],
    documentation: { what: "Cherry-picks a commit.", when: "Applying specific commit.", example: "git cherry-pick {{hash}}" },
    prefill: { label: "Git Cherry-Pick", command: "git cherry-pick \"{{commit_hash}}\"" },
  },
  {
    kind: "command", label: "Git Tag", summary: "Create tag", detail: "git tag",
    icon: GitBranch, accent: "cyan", group: "Git", keywords: ["git", "tag"],
    documentation: { what: "Creates a new tag.", when: "Marking a release.", example: "git tag v1.0.0" },
    prefill: { label: "Git Tag", command: "git tag \"{{tag_name}}\"" },
  },
  {
    kind: "command", label: "Git Reset", summary: "Reset current HEAD", detail: "git reset",
    icon: GitBranch, accent: "cyan", group: "Git", keywords: ["git", "reset"],
    documentation: { what: "Resets HEAD.", when: "Undoing commits.", example: "git reset --hard HEAD~1" },
    prefill: { label: "Git Reset", command: "git reset --hard \"{{commit_hash}}\"" },
  },
  {
    kind: "command", label: "Git Revert", summary: "Revert commit", detail: "git revert",
    icon: GitBranch, accent: "cyan", group: "Git", keywords: ["git", "revert"],
    documentation: { what: "Reverts a commit.", when: "Undoing a specific commit.", example: "git revert {{hash}}" },
    prefill: { label: "Git Revert", command: "git revert \"{{commit_hash}}\"" },
  },
  {
    kind: "command", label: "Git Remote Add", summary: "Add remote", detail: "git remote add",
    icon: GitBranch, accent: "cyan", group: "Git", keywords: ["git", "remote"],
    documentation: { what: "Adds a new remote.", when: "Connecting to a remote repo.", example: "git remote add origin {{url}}" },
    prefill: { label: "Git Remote Add", command: "git remote add origin \"{{remote_url}}\"" },
  },
  {
    kind: "command", label: "Git Log", summary: "Show commit log", detail: "git log",
    icon: GitBranch, accent: "cyan", group: "Git", keywords: ["git", "log"],
    documentation: { what: "Shows commit history.", when: "Reviewing past changes.", example: "git log" },
    prefill: { label: "Git Log", command: "git log --oneline -n 10" },
  },
  {
    kind: "command", label: "Git Diff", summary: "Show changes", detail: "git diff",
    icon: GitBranch, accent: "cyan", group: "Git", keywords: ["git", "diff"],
    documentation: { what: "Shows file differences.", when: "Reviewing uncommitted changes.", example: "git diff" },
    prefill: { label: "Git Diff", command: "git diff" },
  },
  {
    kind: "command", label: "Git Stash", summary: "Stash changes", detail: "git stash",
    icon: GitBranch, accent: "cyan", group: "Git", keywords: ["git", "stash"],
    documentation: { what: "Stashes uncommitted changes.", when: "Temporarily clearing working directory.", example: "git stash" },
    prefill: { label: "Git Stash", command: "git stash" },
  },
  {
    kind: "command", label: "Git Stash Pop", summary: "Pop stashed changes", detail: "git stash pop",
    icon: GitBranch, accent: "cyan", group: "Git", keywords: ["git", "stash", "pop"],
    documentation: { what: "Pops stashed changes.", when: "Restoring stashed changes.", example: "git stash pop" },
    prefill: { label: "Git Stash Pop", command: "git stash pop" },
  }
];

const BY_KIND = new Map(CATALOG.map((entry) => [entry.kind, entry]));

export function catalogEntry(kind: NodeKind): CatalogEntry {
  return BY_KIND.get(kind) ?? CATALOG[0]!;
}

export const ACCENT_TEXT: Record<Accent, string> = {
  fg: "text-fg-muted",
  warn: "text-warn",
  accent: "text-accent",
  success: "text-success",
  danger: "text-danger",
  cyan: "text-[#3ec9d6]",
};

export const ACCENT_BORDER: Record<Accent, string> = {
  fg: "border-line",
  warn: "border-warn/45",
  accent: "border-accent/45",
  success: "border-success/40",
  danger: "border-danger/45",
  cyan: "border-[#3ec9d6]/40",
};

export const ACCENT_TINT: Record<Accent, string> = {
  fg: "bg-white/[0.02]",
  warn: "bg-warn/8",
  accent: "bg-accent/8",
  success: "bg-success/8",
  danger: "bg-danger/8",
  cyan: "bg-[#3ec9d6]/8",
};

/** Ranked matches for a picker query. Empty query keeps catalogue order. */
export function searchCatalog(query: string): CatalogEntry[] {
  const needle = query.trim().toLowerCase();
  if (!needle) return CATALOG;

  return CATALOG.map((entry) => {
    const label = entry.label.toLowerCase();
    const haystack = `${label} ${entry.summary} ${entry.detail} ${entry.keywords.join(" ")}`
      .toLowerCase();

    // Name matches beat keyword matches, so typing "co" lands on Command
    // rather than on whatever merely mentions it.
    const score = label.startsWith(needle)
      ? 0
      : label.includes(needle)
        ? 1
        : entry.keywords.some((word) => word.startsWith(needle))
          ? 2
          : haystack.includes(needle)
            ? 3
            : -1;

    return { entry, score };
  })
    .filter((row) => row.score >= 0)
    .sort((a, b) => a.score - b.score)
    .map((row) => row.entry);
}
