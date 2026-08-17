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
  type LucideIcon,
} from "lucide-react";
import type { NodeKind, BlockData } from "@/types/workflow";

export type Accent = "fg" | "warn" | "accent" | "success" | "danger" | "cyan";

export type NodeGroup = "Run" | "Flow" | "Values" | "Layout";

export type CatalogEntry = {
  kind: NodeKind;
  label: string;
  /** One line, in the imperative: what this block *does*. */
  summary: string;
  /** The longer sentence the picker shows under the name. */
  detail: string;
  icon: LucideIcon;
  accent: Accent;
  group: NodeGroup;
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

export const CATEGORY_THEME: Record<
  NodeGroup,
  {
    name: string;
    text: string;
    bg: string;
    headerBg: string;
    border: string;
    badge: string;
    icon: string;
    accent: Accent;
  }
> = {
  Run: {
    name: "Run",
    text: "text-sky-400",
    bg: "bg-sky-500/10",
    headerBg: "bg-sky-500/[0.08]",
    border: "border-sky-500/30",
    badge: "bg-sky-500/15 text-sky-400 border border-sky-500/25",
    icon: "text-sky-400",
    accent: "cyan",
  },
  Flow: {
    name: "Flow",
    text: "text-amber-400",
    bg: "bg-amber-500/10",
    headerBg: "bg-amber-500/[0.08]",
    border: "border-amber-500/30",
    badge: "bg-amber-500/15 text-amber-400 border border-amber-500/25",
    icon: "text-amber-400",
    accent: "warn",
  },
  Values: {
    name: "Values",
    text: "text-emerald-400",
    bg: "bg-emerald-500/10",
    headerBg: "bg-emerald-500/[0.08]",
    border: "border-emerald-500/30",
    badge: "bg-emerald-500/15 text-emerald-400 border border-emerald-500/25",
    icon: "text-emerald-400",
    accent: "success",
  },
  Layout: {
    name: "Layout",
    text: "text-purple-400",
    bg: "bg-purple-500/10",
    headerBg: "bg-purple-500/[0.08]",
    border: "border-purple-500/30",
    badge: "bg-purple-500/15 text-purple-400 border border-purple-500/25",
    icon: "text-purple-400",
    accent: "fg",
  },
};

export const CATALOG: CatalogEntry[] = [
  // --- Category: Run (Cyan / Sky) ---
  {
    kind: "command",
    label: "Command",
    summary: "Run a shell command",
    detail: "One shell line, with pipes, && and your real PATH",
    icon: TerminalSquare,
    accent: "cyan",
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

  // --- Category: Flow (Amber / Gold) ---
  {
    kind: "condition",
    label: "If",
    summary: "Branch on a test",
    detail: "Exit 0 takes the yes path, anything else takes no",
    icon: GitBranch,
    accent: "warn",
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
    accent: "warn",
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

  // --- Category: Values (Emerald / Green) ---
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
    detail: "Bumps the major, minor, or patch part of a v1.2.3 or 0.1 string",
    icon: ArrowUpFromLine,
    accent: "success",
    group: "Values",
    keywords: ["bump", "version", "semver", "tag", "release", "increment"],
    documentation: {
      what: "Parses a semantic or 2-part version from an input variable and increments the specified part (major, minor, or patch).",
      when: "Use this when you want to automatically calculate the next version tag for a git release.",
      example: "Bump minor of {{current_version}} into {{next_version}}",
    },
  },
  {
    kind: "note",
    label: "Note / Markdown",
    summary: "Add a markdown note",
    detail: "Supports variables, live markdown preview, and output variables",
    icon: StickyNote,
    accent: "success",
    group: "Values",
    keywords: ["text", "comment", "documentation", "markdown", "sticky", "variable", "template"],
    shortcut: "N",
    documentation: {
      what: "A rich markdown note that evaluates template variables (like {{commit_message}} or {{version}}), renders live formatted markdown, and can save its evaluated content to a variable for other notes and steps to use.",
      when: "Use this to create dynamic changelogs, compose messages, explain workflows, or pass templates to downstream blocks.",
      example: "# Release {{next_version}}\n\n{{commit_message}}",
    },
  },

  // --- Category: Layout ---
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
];

const BY_KIND = new Map(CATALOG.map((entry) => [entry.kind, entry]));

export function catalogEntry(kind: NodeKind): CatalogEntry {
  return BY_KIND.get(kind) ?? CATALOG[0]!;
}

export const ACCENT_TEXT: Record<Accent, string> = {
  fg: "text-fg-muted",
  warn: "text-amber-400",
  accent: "text-amber-400",
  success: "text-emerald-400",
  danger: "text-rose-400",
  cyan: "text-sky-400",
};

export const ACCENT_BORDER: Record<Accent, string> = {
  fg: "border-line",
  warn: "border-amber-500/40",
  accent: "border-amber-500/40",
  success: "border-emerald-500/40",
  danger: "border-rose-500/40",
  cyan: "border-sky-500/40",
};

export const ACCENT_TINT: Record<Accent, string> = {
  fg: "bg-white/[0.02]",
  warn: "bg-amber-500/[0.08]",
  accent: "bg-amber-500/[0.08]",
  success: "bg-emerald-500/[0.08]",
  danger: "bg-rose-500/[0.08]",
  cyan: "bg-sky-500/[0.08]",
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
