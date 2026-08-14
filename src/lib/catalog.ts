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
  type LucideIcon,
} from "lucide-react";
import type { NodeKind } from "@/types/workflow";

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
  group: "Run" | "Flow" | "Values" | "Layout";
  /** Extra words the picker's search should match on. */
  keywords: string[];
  /** Shown on the right of a picker row, when there is one. */
  shortcut?: string;
  documentation: {
    what: string;
    when: string;
    example: string;
  };
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
    label: "Note",
    summary: "Add a markdown note",
    detail: "Visual documentation on the canvas (skipped during runs)",
    icon: StickyNote,
    accent: "fg",
    group: "Layout",
    keywords: ["text", "comment", "documentation", "markdown", "sticky"],
    shortcut: "N",
    documentation: {
      what: "A purely visual block that holds markdown text. It is entirely ignored during workflow execution.",
      when: "Use this to explain complex logic, leave instructions for your team, or outline TODOs.",
      example: "## Remember to run this before deploying!",
    },
  },
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
