/**
 * The typed contract with Rust.
 *
 * Every shape here mirrors a `serde` type in `src-tauri/src`. Keep the two in
 * step — the Rust side is the source of truth.
 *
 * Note: these are `type` aliases rather than `interface`s on purpose. React
 * Flow requires node data to satisfy `Record<string, unknown>`, which only type
 * aliases get implicitly.
 */

import type { Node as RFNode, Edge as RFEdge } from "@xyflow/react";

/**
 * Node kinds.
 *
 * `frame` is scenery — a container that sets the working directory for every
 * block sitting inside it. Everything else is a step the engine visits:
 * `command` runs something, while `approval`, `choice` and `input` stop the
 * run and put a question to the person watching it.
 */
export type NodeKind =
  | "command"
  | "frame"
  | "approval"
  | "choice"
  | "input"
  | "script"
  | "condition"
  | "capture"
  | "wait"
  | "http"
  | "note"
  | "read_file"
  | "write_file"
  | "set_variable"
  | "bump_version"
  | "ai_commit";

/** Every kind except a frame — the things that appear in a run. */
export type BlockKind = Exclude<NodeKind, "frame">;

/**
 * Shared by every block.
 *
 * `frameId` is the frame this block belongs to, or `null` for a loose block.
 * Membership is an explicit assignment made when *this block* is dropped,
 * never something a frame acquires by being moved over things.
 */
export type BlockCommon = {
  label: string;
  frameId: string | null;
  disabled?: boolean;
};

export type CommandData = BlockCommon & {
  command: string;
  /** `null` inherits the frame directory, then the workflow one. */
  workingDir: string | null;
  env: Record<string, string>;
  continueOnError: boolean;
};

/** Holds the run until someone reads the output and says yes or no. */
export type ApprovalData = BlockCommon & {
  message: string;
  continueLabel: string;
  stopLabel: string;
};

/**
 * Holds the run and asks which way to go. Everything wired out of this block
 * is an option; the paths not chosen are skipped.
 */
export type ChoiceData = BlockCommon & {
  message: string;
  allowMultiple: boolean;
};

/** Holds the run and asks for a value later steps read as `{{name}}`. */
export type InputData = BlockCommon & {
  message: string;
  variable: string;
  defaultValue: string;
  secret: boolean;
};

/** A multi-line program handed to a named interpreter. */
export type ScriptData = BlockCommon & {
  interpreter: string;
  script: string;
  workingDir: string | null;
  env: Record<string, string>;
  continueOnError: boolean;
};

/** Branches on a command's exit status: 0 is yes, anything else is no. */
export type ConditionData = BlockCommon & {
  test: string;
  workingDir: string | null;
  trueLabel: string;
  falseLabel: string;
};

/** Runs a command and keeps what it printed under a name. */
export type CaptureData = BlockCommon & {
  command: string;
  variable: string;
  workingDir: string | null;
  firstLineOnly: boolean;
  continueOnError: boolean;
};

/** A delay, or a poll until something comes up. */
export type WaitData = BlockCommon & {
  seconds: number;
  until: string;
  intervalSeconds: number;
  timeoutSeconds: number;
  workingDir: string | null;
};

/** An HTTP request, with the response available to later steps. */
export type HttpData = BlockCommon & {
  method: string;
  url: string;
  headers: Record<string, string>;
  body: string;
  variable: string;
  failOnErrorStatus: boolean;
  workingDir: string | null;
};

/** A visually distinct block for writing notes or markdown, with variable substitution and variable output. */
export type NoteData = BlockCommon & {
  text: string;
  variable?: string;
  width?: number;
  height?: number;
  capture?: boolean;
};

/** Reads a file from the filesystem and stores its contents in a variable. */
export type ReadFileData = BlockCommon & {
  path: string;
  variable: string;
  workingDir: string | null;
  continueOnError: boolean;
};

/** Writes a string (including variables) to a file on the filesystem. */
export type WriteFileData = BlockCommon & {
  path: string;
  content: string;
  workingDir: string | null;
  continueOnError: boolean;
};

/** Evaluates a string and stores the result in a variable without spawning a shell. */
export type SetVariableData = BlockCommon & {
  variable: string;
  value: string;
};

export type BumpVersionData = BlockCommon & {
  variableIn: string;
  variableOut: string;
  part: string;
};

/** Uses AI / intelligence to summarize diffs, variables, or custom text prompts into structured output variables. */
export type AiCommitData = BlockCommon & {
  prompt?: string;
  inputVariable?: string;
  variable: string;
  scope: "staged" | "all" | "variable";
  style: "conventional" | "concise" | "detailed" | "custom";
  workingDir: string | null;
  continueOnError: boolean;
};

export type BlockData =
  | CommandData
  | ApprovalData
  | ChoiceData
  | InputData
  | ScriptData
  | ConditionData
  | CaptureData
  | WaitData
  | HttpData
  | NoteData
  | ReadFileData
  | WriteFileData
  | SetVariableData
  | BumpVersionData
  | AiCommitData;

export type FrameColor = "default" | "blue" | "green" | "purple" | "amber" | "rose" | "cyan";

export type FrameData = {
  label: string;
  /** Directory every block inside this frame runs in. `null` inherits. */
  workingDir: string | null;
  width: number;
  height: number;
  color?: FrameColor;
};

export type XY = { x: number; y: number };

// --- Persisted document (exactly what lands in JSON) ----------------------

export type PersistedNode =
  | { id: string; position: XY; type: "command"; data: CommandData }
  | { id: string; position: XY; type: "frame"; data: FrameData }
  | { id: string; position: XY; type: "approval"; data: ApprovalData }
  | { id: string; position: XY; type: "choice"; data: ChoiceData }
  | { id: string; position: XY; type: "input"; data: InputData }
  | { id: string; position: XY; type: "script"; data: ScriptData }
  | { id: string; position: XY; type: "condition"; data: ConditionData }
  | { id: string; position: XY; type: "capture"; data: CaptureData }
  | { id: string; position: XY; type: "wait"; data: WaitData }
  | { id: string; position: XY; type: "http"; data: HttpData }
  | { id: string; position: XY; type: "note"; data: NoteData }
  | { id: string; position: XY; type: "read_file"; data: ReadFileData }
  | { id: string; position: XY; type: "write_file"; data: WriteFileData }
  | { id: string; position: XY; type: "set_variable"; data: SetVariableData }
  | { id: string; position: XY; type: "bump_version"; data: BumpVersionData }
  | { id: string; position: XY; type: "ai_commit"; data: AiCommitData };

export type PersistedEdge = {
  id: string;
  source: string;
  target: string;
  sourceHandle?: string | null;
  targetHandle?: string | null;
  disabled?: boolean;
};

export type WorkflowDocument = {
  id: string;
  name: string;
  workingDir: string | null;
  nodes: PersistedNode[];
  edges: PersistedEdge[];
  createdAt: number;
  updatedAt: number;
};

export type WorkflowSummary = {
  id: string;
  name: string;
  nodeCount: number;
  updatedAt: number;
};

export type RepositoryActivity = {
  isRepository: boolean;
  isGithub: boolean;
  remote: string | null;
  branch: string | null;
  commits: number;
  days: { date: string; count: number }[];
  history: RepositoryCommit[];
};

export type RepositoryCommit = {
  hash: string;
  shortHash: string;
  author: string;
  email: string;
  authoredAt: string;
  relativeTime: string;
  subject: string;
  filesChanged: number;
  insertions: number;
  deletions: number;
  parents: string[];
  refs: string[];
};

// --- Canvas types ---------------------------------------------------------

export type CommandNodeType = RFNode<CommandData, "command">;
export type FrameNodeType = RFNode<FrameData, "frame">;
export type ApprovalNodeType = RFNode<ApprovalData, "approval">;
export type ChoiceNodeType = RFNode<ChoiceData, "choice">;
export type InputNodeType = RFNode<InputData, "input">;
export type ScriptNodeType = RFNode<ScriptData, "script">;
export type ConditionNodeType = RFNode<ConditionData, "condition">;
export type CaptureNodeType = RFNode<CaptureData, "capture">;
export type WaitNodeType = RFNode<WaitData, "wait">;
export type HttpNodeType = RFNode<HttpData, "http">;
export type NoteNodeType = RFNode<NoteData, "note">;
export type ReadFileNodeType = RFNode<ReadFileData, "read_file">;
export type WriteFileNodeType = RFNode<WriteFileData, "write_file">;
export type SetVariableNodeType = RFNode<SetVariableData, "set_variable">;
export type BumpVersionNodeType = RFNode<BumpVersionData, "bump_version">;
export type AiCommitNodeType = RFNode<AiCommitData, "ai_commit">;

/** Anything that takes part in a run. */
export type BlockNodeType =
  | CommandNodeType
  | ApprovalNodeType
  | ChoiceNodeType
  | InputNodeType
  | ScriptNodeType
  | ConditionNodeType
  | CaptureNodeType
  | WaitNodeType
  | HttpNodeType
  | NoteNodeType
  | ReadFileNodeType
  | WriteFileNodeType
  | SetVariableNodeType
  | BumpVersionNodeType
  | AiCommitNodeType;

export type FuseNode = BlockNodeType | FrameNodeType;
export type FuseEdge = RFEdge;

export function isCommandNode(node: FuseNode): node is CommandNodeType {
  return node.type === "command";
}

export function isFrameNode(node: FuseNode): node is FrameNodeType {
  return node.type === "frame";
}

/**
 * A step rather than scenery. Frame membership, deletion, duplication and the
 * output panel all work on blocks regardless of which kind they are.
 */
export function isBlockNode(node: FuseNode): node is BlockNodeType {
  return node.type !== "frame";
}

/** True for the kinds that stop a run to ask the user something. */
export function isInteractiveNode(node: FuseNode): boolean {
  return node.type === "approval" || node.type === "choice" || node.type === "input";
}

// --- Engine events --------------------------------------------------------

export type OutputStream = "stdout" | "stderr";
export type NodeStatus = "success" | "failed" | "skipped" | "cancelled";
export type RunStatus = "success" | "failed" | "cancelled";

/**
 * What the canvas renders per node; a superset of the engine's NodeStatus.
 * `waiting` is the pause at an interactive step — the run is alive but stopped
 * until the user answers.
 */
export type NodeRunState = "idle" | "pending" | "running" | "waiting" | NodeStatus;

// --- Questions asked mid-run ----------------------------------------------

/** One of the paths out of a choice step. */
export type PromptOption = { nodeId: string; label: string; detail: string };

/**
 * A question the engine is parked on. Mirrors `PromptRequest` in Rust: the
 * `kind` field is flattened, so the payload is one flat object.
 */
export type PromptRequest = {
  runId: string;
  nodeId: string;
  title: string;
  message: string;
  /** Steps that fed this one — whose output the decision is about. */
  sources: string[];
} & (
  | { kind: "approval"; continueLabel: string; stopLabel: string }
  | { kind: "choice"; options: PromptOption[]; allowMultiple: boolean }
  | { kind: "input"; variable: string; defaultValue: string; secret: boolean }
);

export type PromptReply =
  | { reply: "approve" }
  | { reply: "deny" }
  | { reply: "choose"; nodeIds: string[] }
  | { reply: "value"; value: string }
  | { reply: "cancelled" };

export type RunMode = "live" | "sandbox" | "dry_run";

export type SandboxFileDiff = {
  path: string;
  status: "added" | "modified" | "deleted";
  diff?: string | null;
};

export type EngineEvent =
  | { event: "runStarted"; runId: string; order: string[]; runMode?: RunMode; at: number }
  | {
      event: "nodeStarted";
      runId: string;
      nodeId: string;
      workingDir: string;
      at: number;
    }
  | {
      event: "nodeOutput";
      runId: string;
      nodeId: string;
      stream: OutputStream;
      line: string;
      at: number;
    }
  | {
      event: "nodeWaiting";
      runId: string;
      nodeId: string;
      prompt: PromptRequest;
      at: number;
    }
  | {
      event: "nodeFinished";
      runId: string;
      nodeId: string;
      status: NodeStatus;
      exitCode: number | null;
      outputValue?: string | null;
      durationMs: number;
      at: number;
    }
  | { event: "nodeSkipped"; runId: string; nodeId: string; reason: string; at: number }
  | {
      event: "runFinished";
      runId: string;
      status: RunStatus;
      durationMs: number;
      runMode?: RunMode;
      sandboxDir?: string | null;
      diff?: SandboxFileDiff[] | null;
      at: number;
    };

export type OutputLine = {
  stream: OutputStream;
  text: string;
  at: number;
};

export type NodeRunMeta = {
  exitCode: number | null;
  durationMs: number | null;
  startedAt: number | null;
  finishedAt: number | null;
  workingDir: string | null;
  reason: string | null;
};
