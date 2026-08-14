import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Check, ChevronDown, Circle, Copy, Eraser, Minus, X } from "lucide-react";
import { useWorkflowStore } from "@/store/workflowStore";
import { useRuntimeStore } from "@/store/runtimeStore";
import { useUIStore } from "@/store/uiStore";
import { StatusDot } from "@/components/ui/StatusDot";
import { TerminalLine } from "@/components/ui/TerminalLine";
import { cn, formatDuration, formatTime, prettyPath } from "@/lib/utils";
import { STATUS_LABEL } from "@/lib/status";
import { catalogEntry } from "@/lib/catalog";
import {
  isBlockNode,
  type BlockKind,
  type BlockNodeType,
  type NodeRunState,
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

  const order = useRuntimeStore((s) => s.order);
  const statuses = useRuntimeStore((s) => s.statuses);
  const clearOutput = useRuntimeStore((s) => s.clearOutput);

  const [height, setHeight] = useState(DEFAULT_HEIGHT);
  const [copied, setCopied] = useState(false);

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
        <span className="text-[11px] font-medium tracking-wide text-fg-muted uppercase">
          Output
        </span>
        <div className="flex-1" />
        {activeId && (
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
        <StepList steps={steps} activeId={activeId} onPick={(id) => inspect(id, { manual: true })} />
        <OutputView nodeId={activeId} homeDir={homeDir} workflowDir={workflowDir} />
      </div>
    </section>
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
