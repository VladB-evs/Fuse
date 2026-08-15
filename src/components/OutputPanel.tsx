import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import {
  Check,
  ChevronDown,
  Circle,
  Copy,
  Eraser,
  FileCode,
  FilePlus,
  FileX,
  FlaskConical,
  Minus,
  Terminal,
  Trash2,
  X,
} from "lucide-react";
import { useWorkflowStore } from "@/store/workflowStore";
import { useRuntimeStore } from "@/store/runtimeStore";
import { useUIStore } from "@/store/uiStore";
import { StatusDot } from "@/components/ui/StatusDot";
import { TerminalLine } from "@/components/ui/TerminalLine";
import { cn, formatDuration, formatTime, prettyPath } from "@/lib/utils";
import { STATUS_LABEL } from "@/lib/status";
import { catalogEntry } from "@/lib/catalog";
import {
  applySandboxChangesAction,
  discardSandboxAction,
} from "@/lib/actions";
import {
  isBlockNode,
  type BlockKind,
  type BlockNodeType,
  type NodeRunState,
  type SandboxFileDiff,
} from "@/types/workflow";

const MIN_HEIGHT = 140;
const MAX_HEIGHT = 640;
const DEFAULT_HEIGHT = 244;

export function OutputPanel({ homeDir }: { homeDir: string }) {
  const open = useUIStore((s) => s.outputOpen);
  const setOutputOpen = useUIStore((s) => s.setOutputOpen);
  const inspectedNodeId = useUIStore((s) => s.inspectedNodeId);
  const inspect = useUIStore((s) => s.inspect);

  const nodes = useWorkflowStore((s) => s.nodes);
  const workflowDir = useWorkflowStore((s) => s.workingDir);

  const runId = useRuntimeStore((s) => s.runId);
  const runMode = useRuntimeStore((s) => s.runMode);
  const sandboxDir = useRuntimeStore((s) => s.sandboxDir);
  const sandboxDiff = useRuntimeStore((s) => s.sandboxDiff);
  const order = useRuntimeStore((s) => s.order);
  const statuses = useRuntimeStore((s) => s.statuses);
  const clearOutput = useRuntimeStore((s) => s.clearOutput);

  const [height, setHeight] = useState(DEFAULT_HEIGHT);
  const [copied, setCopied] = useState(false);
  const [activeTab, setActiveTab] = useState<"output" | "sandbox">("output");

  useEffect(() => {
    if (runMode === "sandbox" && sandboxDiff && sandboxDiff.length > 0) {
      setActiveTab("sandbox");
    }
  }, [runMode, sandboxDiff]);

  // Steps follow the resolved run order once a run exists; before that, top-to
  // bottom on the canvas is the closest honest guess.
  const steps = useMemo(() => {
    // Frames are containers, not steps.
    const blocks = nodes.filter(isBlockNode);
    const byId = new Map(blocks.map((n) => [n.id, n]));
    const ids =
      order.length > 0
        ? order.filter((id) => byId.has(id))
        : [...blocks].sort((a, b) => a.position.y - b.position.y).map((n) => n.id);

    return ids.map((id) => {
      const node = byId.get(id)!;
      return {
        id,
        kind: node.type as BlockKind,
        label: node.data.label || "Terminal",
        // What the row shows: whatever that kind of block is actually about.
        detail: stepDetail(node),
        status: (statuses[id] ?? "idle") as NodeRunState,
      };
    });
  }, [nodes, order, statuses]);

  const activeId = inspectedNodeId ?? steps[0]?.id ?? null;

  const handleCopyOutput = useCallback(() => {
    if (!activeId) return;
    const lines = useRuntimeStore.getState().output[activeId];
    if (!lines || lines.length === 0) {
      useUIStore.getState().notify("No output to copy");
      return;
    }
    const text = lines.map((l) => l.text).join("\n");
    navigator.clipboard.writeText(text);
    setCopied(true);
    useUIStore.getState().notify("Output copied to clipboard");
    setTimeout(() => setCopied(false), 2000);
  }, [activeId]);

  const startResize = useCallback(
    (event: React.MouseEvent) => {
      event.preventDefault();
      const startY = event.clientY;
      const startHeight = height;

      const onMove = (move: MouseEvent) => {
        const next = startHeight + (startY - move.clientY);
        setHeight(Math.min(MAX_HEIGHT, Math.max(MIN_HEIGHT, next)));
      };
      const onUp = () => {
        window.removeEventListener("mousemove", onMove);
        window.removeEventListener("mouseup", onUp);
        document.body.style.cursor = "";
      };

      document.body.style.cursor = "ns-resize";
      window.addEventListener("mousemove", onMove);
      window.addEventListener("mouseup", onUp);
    },
    [height],
  );

  if (!open) return <CollapsedBar />;

  const showSandboxTab = runMode === "sandbox" || Boolean(sandboxDiff || sandboxDir);

  return (
    <section
      className="relative z-10 flex shrink-0 flex-col border-t border-line bg-base"
      style={{ height }}
    >
      <div
        onMouseDown={startResize}
        className="absolute -top-[3px] right-0 left-0 z-10 h-[6px] cursor-ns-resize"
        aria-hidden
      />

      <header className="flex h-8 shrink-0 items-center gap-2 border-b border-line px-3">
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => setActiveTab("output")}
            className={cn(
              "flex items-center gap-1.5 rounded-[5px] px-2 py-1 text-[11px] font-medium transition",
              activeTab === "output"
                ? "bg-hover text-fg"
                : "text-fg-subtle hover:bg-hover/60 hover:text-fg",
            )}
          >
            <Terminal size={12} />
            Output
          </button>

          {showSandboxTab && (
            <button
              type="button"
              onClick={() => setActiveTab("sandbox")}
              className={cn(
                "flex items-center gap-1.5 rounded-[5px] px-2 py-1 text-[11px] font-medium transition",
                activeTab === "sandbox"
                  ? "bg-amber-500/20 text-amber-300"
                  : "text-amber-400/80 hover:bg-amber-500/10 hover:text-amber-300",
              )}
            >
              <FlaskConical size={12} />
              Sandbox Changes
              {sandboxDiff && sandboxDiff.length > 0 && (
                <span className="rounded-full bg-amber-500/30 px-1.5 py-0.2 text-[9.5px] font-bold text-amber-300">
                  {sandboxDiff.length}
                </span>
              )}
            </button>
          )}
        </div>

        <div className="flex-1" />

        {activeTab === "output" && activeId && (
          <>
            <button
              type="button"
              onClick={handleCopyOutput}
              title="Copy output to clipboard"
              className="flex items-center gap-1 rounded-[5px] px-1.5 py-1 text-[11px] text-fg-subtle transition hover:bg-hover hover:text-fg"
            >
              {copied ? (
                <>
                  <Check size={11} strokeWidth={2.5} className="text-success" />
                  <span className="text-success">Copied</span>
                </>
              ) : (
                <>
                  <Copy size={11} strokeWidth={1.75} />
                  Copy
                </>
              )}
            </button>
            <button
              type="button"
              onClick={() => clearOutput(activeId)}
              title="Clear this block's output"
              className="flex items-center gap-1 rounded-[5px] px-1.5 py-1 text-[11px] text-fg-subtle transition hover:bg-hover hover:text-fg"
            >
              <Eraser size={11} strokeWidth={1.75} />
              Clear
            </button>
          </>
        )}
        <button
          type="button"
          onClick={() => setOutputOpen(false)}
          title="Hide output  ⌘/"
          className="flex size-6 items-center justify-center rounded-[5px] text-fg-subtle transition hover:bg-hover hover:text-fg"
        >
          <ChevronDown size={13} strokeWidth={2} />
        </button>
      </header>

      <div className="flex min-h-0 flex-1">
        {activeTab === "output" ? (
          <>
            <StepList
              steps={steps}
              activeId={activeId}
              onPick={(id) => inspect(id, { manual: true })}
            />
            <OutputView nodeId={activeId} homeDir={homeDir} workflowDir={workflowDir} />
          </>
        ) : (
          <SandboxDiffView
            runId={runId}
            diff={sandboxDiff}
            sandboxDir={sandboxDir}
            homeDir={homeDir}
          />
        )}
      </div>
    </section>
  );
}

function SandboxDiffView({
  runId,
  diff,
  sandboxDir,
  homeDir,
}: {
  runId: string | null;
  diff: SandboxFileDiff[] | null;
  sandboxDir: string | null;
  homeDir: string;
}) {
  const [selectedPath, setSelectedPath] = useState<string | null>(diff?.[0]?.path ?? null);
  const [isApplying, setIsApplying] = useState(false);
  const [isDiscarding, setIsDiscarding] = useState(false);

  useEffect(() => {
    if (diff && diff.length > 0 && (!selectedPath || !diff.some((d) => d.path === selectedPath))) {
      setSelectedPath(diff[0]?.path ?? null);
    }
  }, [diff, selectedPath]);

  const selectedDiff = diff?.find((d) => d.path === selectedPath) ?? diff?.[0] ?? null;

  const handleApply = async () => {
    if (!runId) return;
    setIsApplying(true);
    try {
      await applySandboxChangesAction(runId);
    } finally {
      setIsApplying(false);
    }
  };

  const handleDiscard = async () => {
    if (!runId) return;
    setIsDiscarding(true);
    try {
      await discardSandboxAction(runId);
    } finally {
      setIsDiscarding(false);
    }
  };

  return (
    <div className="flex min-w-0 flex-1 flex-col bg-canvas/30">
      {/* Action Bar */}
      <div className="flex h-9 shrink-0 items-center justify-between border-b border-line bg-surface/60 px-3">
        <div className="flex items-center gap-2 text-[11.5px] text-fg-muted">
          <span className="flex items-center gap-1 font-medium text-amber-400">
            <FlaskConical size={13} />
            Isolated Sandbox
          </span>
          <span className="text-fg-subtle/50">·</span>
          <span className="text-[11px] text-fg-subtle truncate max-w-[280px]">
            {sandboxDir ? prettyPath(sandboxDir, homeDir) : "Worktree copy"}
          </span>
        </div>

        {runId && diff && diff.length > 0 && (
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={handleDiscard}
              disabled={isDiscarding || isApplying}
              className="flex items-center gap-1 rounded-[5px] border border-line bg-surface px-2.5 py-1 text-[11px] font-medium text-fg-subtle hover:bg-hover hover:text-danger transition cursor-pointer disabled:opacity-50"
              title="Discard all changes made in this sandbox"
            >
              <Trash2 size={11} />
              {isDiscarding ? "Discarding…" : "Discard Sandbox"}
            </button>

            <button
              type="button"
              onClick={handleApply}
              disabled={isApplying || isDiscarding}
              className="flex items-center gap-1 rounded-[5px] bg-emerald-600 px-2.5 py-1 text-[11px] font-medium text-white hover:bg-emerald-500 transition shadow-sm cursor-pointer disabled:opacity-50"
              title="Apply all sandbox file modifications into your real workspace"
            >
              <Check size={11} strokeWidth={2.5} />
              {isApplying ? "Applying…" : "Apply to Real Repo"}
            </button>
          </div>
        )}
      </div>

      {/* Main Diff Content */}
      <div className="flex min-h-0 flex-1">
        {/* File List */}
        <div className="w-[240px] shrink-0 overflow-y-auto border-r border-line py-1 bg-base/40">
          {!diff || diff.length === 0 ? (
            <div className="p-3 text-[11px] text-fg-subtle">
              No files were created or modified during this sandbox run.
            </div>
          ) : (
            <ul>
              {diff.map((item) => {
                const isSelected = item.path === selectedPath;
                return (
                  <li key={item.path}>
                    <button
                      type="button"
                      onClick={() => setSelectedPath(item.path)}
                      className={cn(
                        "flex w-full items-center gap-2 px-3 py-1.5 text-left text-[11px] transition cursor-pointer",
                        isSelected ? "bg-hover text-fg font-medium" : "text-fg-subtle hover:bg-hover/60 hover:text-fg",
                      )}
                    >
                      {item.status === "added" && (
                        <FilePlus size={12} className="shrink-0 text-emerald-400" />
                      )}
                      {item.status === "modified" && (
                        <FileCode size={12} className="shrink-0 text-amber-400" />
                      )}
                      {item.status === "deleted" && (
                        <FileX size={12} className="shrink-0 text-rose-400" />
                      )}
                      <span className="min-w-0 flex-1 truncate font-mono">{item.path}</span>
                      <span
                        className={cn(
                          "shrink-0 text-[9.5px] uppercase font-semibold px-1 py-0.2 rounded",
                          item.status === "added" && "bg-emerald-500/20 text-emerald-400",
                          item.status === "modified" && "bg-amber-500/20 text-amber-400",
                          item.status === "deleted" && "bg-rose-500/20 text-rose-400",
                        )}
                      >
                        {item.status}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        {/* Diff Viewer */}
        <div className="selectable min-h-0 flex-1 overflow-auto bg-canvas/60 p-3 font-mono text-[11.5px] leading-[18px]">
          {selectedDiff?.diff ? (
            <div className="space-y-0.5">
              {selectedDiff.diff.split("\n").map((line, idx) => {
                const isAddition = line.startsWith("+") && !line.startsWith("+++");
                const isDeletion = line.startsWith("-") && !line.startsWith("---");
                const isHunk = line.startsWith("@@");

                return (
                  <div
                    key={idx}
                    className={cn(
                      "px-1.5 py-0.2 rounded-xs whitespace-pre-wrap break-all",
                      isAddition && "bg-emerald-950/40 text-emerald-300",
                      isDeletion && "bg-rose-950/40 text-rose-300",
                      isHunk && "text-sky-400/90 font-semibold bg-sky-950/20",
                      !isAddition && !isDeletion && !isHunk && "text-fg-muted",
                    )}
                  >
                    {line || " "}
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="flex h-full items-center justify-center text-[11.5px] text-fg-subtle">
              {!diff || diff.length === 0
                ? "Clean sandbox — no differences detected against your working tree."
                : "Select a file on the left to inspect its diff."}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function CollapsedBar() {
  const toggleOutput = useUIStore((s) => s.toggleOutput);
  const running = useRuntimeStore((s) => s.running);

  return (
    <div className="z-10 flex h-7 shrink-0 items-center border-t border-line bg-base px-3">
      <button
        type="button"
        onClick={toggleOutput}
        className="flex items-center gap-1.5 text-[11px] text-fg-subtle transition hover:text-fg"
      >
        {running ? <StatusDot status="running" /> : <Minus size={11} strokeWidth={2} />}
        Output
      </button>
    </div>
  );
}

type Step = {
  id: string;
  kind: BlockKind;
  label: string;
  detail: string;
  status: NodeRunState;
};

/**
 * The one line that says what a step is about.
 *
 * Each kind is summarised by the field that actually distinguishes it — the
 * command for a terminal block, the request for an HTTP one, the question for
 * a step that asks one.
 */
function stepDetail(node: BlockNodeType): string {
  switch (node.type) {
    case "command":
      return node.data.command.trim();
    case "script":
      return `${node.data.interpreter} · ${node.data.script.split("\n")[0]?.trim() ?? ""}`;
    case "condition":
      return node.data.test.trim();
    case "capture":
      return node.data.command.trim();
    case "http":
      return `${node.data.method} ${node.data.url}`.trim();
    case "wait":
      return node.data.until.trim() || `wait ${node.data.seconds}s`;
    case "note":
      return node.data.text.split("\n")[0]?.trim() || "Note";
    case "read_file":
      return `Read: ${node.data.path.trim()}`;
    case "write_file":
      return `Write: ${node.data.path.trim()}`;
    case "set_variable":
      return `Set: ${node.data.variable.trim()}`;
    case "bump_version":
      return `Bump: ${node.data.variableIn.trim()}`;
    case "ai_commit":
      return `AI Commit: ${node.data.variable.trim()}`;
    default:
      return "message" in node.data ? node.data.message.trim() : "Unknown";
  }
}

function StepList({
  steps,
  activeId,
  onPick,
}: {
  steps: Step[];
  activeId: string | null;
  onPick: (id: string) => void;
}) {
  return (
    <ul className="w-[210px] shrink-0 overflow-y-auto border-r border-line py-1">
      {steps.length === 0 && (
        <li className="px-3 py-2 text-[11px] text-fg-subtle">No blocks yet</li>
      )}
      {steps.map((step) => {
        const Icon = catalogEntry(step.kind).icon;
        return (
          <li key={step.id}>
            <button
              type="button"
              onClick={() => onPick(step.id)}
              className={cn(
                "flex w-full items-center gap-2 px-3 py-[5px] text-left transition",
                activeId === step.id ? "bg-hover" : "hover:bg-hover/60",
              )}
            >
              <StepGlyph status={step.status} />
              {step.kind !== "command" && (
                <Icon size={10} strokeWidth={1.75} className="shrink-0 text-fg-subtle" />
              )}
              <span className="min-w-0 flex-1">
                <span
                  className={cn(
                    "block truncate text-[11px]",
                    step.kind === "command" && "font-mono",
                    step.status === "waiting"
                      ? "text-warn"
                      : step.status === "skipped"
                        ? "text-fg-subtle"
                        : "text-fg-muted",
                  )}
                >
                  {step.detail || step.label}
                </span>
              </span>
            </button>
          </li>
        );
      })}
    </ul>
  );
}

function StepGlyph({ status }: { status: NodeRunState }) {
  if (status === "waiting") return <StatusDot status="waiting" className="status-pulse mx-[2.5px]" />;
  if (status === "success") {
    return <Check size={11} strokeWidth={2.5} className="shrink-0 text-success" />;
  }
  if (status === "failed") {
    return <X size={11} strokeWidth={2.5} className="shrink-0 text-danger" />;
  }
  if (status === "running") return <StatusDot status="running" className="mx-[2.5px]" />;
  if (status === "cancelled") return <StatusDot status="cancelled" className="mx-[2.5px]" />;
  return <Circle size={9} strokeWidth={1.5} className="mx-[1px] shrink-0 text-fg-subtle/60" />;
}

function OutputView({
  nodeId,
  homeDir,
  workflowDir,
}: {
  nodeId: string | null;
  homeDir: string;
  workflowDir: string | null;
}) {
  const lines = useRuntimeStore((s) => (nodeId ? s.output[nodeId] : undefined));
  const meta = useRuntimeStore((s) => (nodeId ? s.meta[nodeId] : undefined));
  const status = useRuntimeStore((s) => (nodeId ? (s.statuses[nodeId] ?? "idle") : "idle"));

  // The command this output came from, echoed above it the way a terminal
  // would — output with no visible command is half a transcript.
  const command = useWorkflowStore((s) => {
    const node = s.nodes.find((n) => n.id === nodeId);
    return node && node.type === "command" ? node.data.command.trim() : "";
  });

  const scrollRef = useRef<HTMLDivElement>(null);
  const pinnedRef = useRef(true);

  // Follow the tail unless the user has scrolled up to read something.
  const onScroll = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    pinnedRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 24;
  }, []);

  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (el && pinnedRef.current) el.scrollTop = el.scrollHeight;
  }, [lines]);

  useEffect(() => {
    pinnedRef.current = true;
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [nodeId]);

  const dir = meta?.workingDir ?? workflowDir;

  return (
    <div className="flex min-w-0 flex-1 flex-col">
      <div
        ref={scrollRef}
        onScroll={onScroll}
        className="selectable min-h-0 flex-1 overflow-auto bg-canvas/40 px-3 py-2"
      >
        {command && (
          <div className="mb-1 flex gap-1.5">
            <span className="shrink-0 select-none font-mono text-[11.5px] leading-[17px] text-success">
              $
            </span>
            <span className="min-w-0 font-mono text-[11.5px] leading-[17px] break-all whitespace-pre-wrap text-fg">
              {command}
            </span>
          </div>
        )}

        {!lines || lines.length === 0 ? (
          <p className="text-[11px] text-fg-subtle">
            {status === "running"
              ? "Waiting for output…"
              : status === "waiting"
                ? "Paused — answer the question to carry on."
                : "No output yet. Run this block to see it here."}
          </p>
        ) : (
          lines.map((line, index) => (
            <TerminalLine key={`${line.at}-${index}`} text={line.text} stream={line.stream} />
          ))
        )}
      </div>

      <footer className="flex h-[26px] shrink-0 items-center gap-2.5 border-t border-line px-3 text-[10.5px] text-fg-subtle">
        <span className="flex items-center gap-1.5">
          <StatusDot status={status} />
          {STATUS_LABEL[status]}
        </span>

        {meta?.reason && <span className="truncate">{meta.reason}</span>}

        {meta?.exitCode != null && (
          <span className="tabular-nums">exit {meta.exitCode}</span>
        )}
        {meta?.durationMs != null && (
          <span className="tabular-nums">{formatDuration(meta.durationMs)}</span>
        )}
        {meta?.startedAt != null && (
          <span className="tabular-nums">{formatTime(meta.startedAt)}</span>
        )}

        <div className="flex-1" />

        {dir && <span className="truncate font-mono">{prettyPath(dir, homeDir)}</span>}
      </footer>
    </div>
  );
}
