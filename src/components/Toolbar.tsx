import { useEffect, useMemo, useState } from "react";
import { BookOpen, PanelLeft, PanelLeftClose, PanelRight, PanelRightClose, Play, Plus, Square, Settings, FolderOpen, FolderInput, Sparkles } from "lucide-react";
import { useWorkflowStore } from "@/store/workflowStore";
import { useRuntimeStore } from "@/store/runtimeStore";
import { useUIStore } from "@/store/uiStore";
import { Button } from "@/components/ui/Button";
import { StatusDot } from "@/components/ui/StatusDot";
import { Kbd } from "@/components/ui/Kbd";
import { openNodePicker, runCurrentWorkflow, stopCurrentRun, importWorkflow, importBlocks } from "@/lib/actions";
import { looseBlocks } from "@/lib/frames";
import { cn, formatDuration } from "@/lib/utils";
import { RUN_STATUS_LABEL, RUN_STATUS_TONE, TONE_TEXT } from "@/lib/status";
import type { NodeRunState } from "@/types/workflow";

const TERMINAL_STATES: NodeRunState[] = ["success", "failed", "skipped", "cancelled"];

/** Ticking elapsed time for the live run readout. */
function useElapsed(startedAt: number | null, active: boolean): number {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (!active || startedAt === null) return;
    setNow(Date.now());
    const timer = setInterval(() => setNow(Date.now()), 100);
    return () => clearInterval(timer);
  }, [active, startedAt]);

  return startedAt === null ? 0 : Math.max(0, now - startedAt);
}

export function Toolbar() {
  const dirty = useWorkflowStore((s) => s.dirty);
  const nodeCount = useWorkflowStore((s) => s.nodes.length);

  // "Run all" only earns its place while something sits outside every frame.
  // Once every block belongs to a frame, the frames' own buttons say exactly
  // what will run, and a second button here would only muddy that.
  const loose = useWorkflowStore((s) => looseBlocks(s.nodes).length);
  const frames = useWorkflowStore((s) => s.nodes.filter((n) => n.type === "frame").length);
  const showRunAll = frames === 0 || loose > 0;

  const running = useRuntimeStore((s) => s.running);
  const startedAt = useRuntimeStore((s) => s.startedAt);
  const order = useRuntimeStore((s) => s.order);
  const statuses = useRuntimeStore((s) => s.statuses);
  const lastRun = useRuntimeStore((s) => s.lastRun);

  const toast = useUIStore((s) => s.toast);
  const availableUpdate = useUIStore((s) => s.availableUpdate);
  const setPaletteOpen = useUIStore((s) => s.setPaletteOpen);
  const setDocsOpen = useUIStore((s) => s.setDocsOpen);
  const setSettingsOpen = useUIStore((s) => s.setSettingsOpen);
  const leftSidebarOpen = useUIStore((s) => s.leftSidebarOpen);
  const rightSidebarOpen = useUIStore((s) => s.rightSidebarOpen);
  const toggleLeftSidebar = useUIStore((s) => s.toggleLeftSidebar);
  const toggleRightSidebar = useUIStore((s) => s.toggleRightSidebar);

  const elapsed = useElapsed(startedAt, running);

  const done = useMemo(
    () => order.filter((id) => TERMINAL_STATES.includes(statuses[id] ?? "idle")).length,
    [order, statuses],
  );

  return (
    <header
      data-tauri-drag-region
      className="relative z-20 flex h-11 shrink-0 items-center gap-2 border-b border-line bg-base pr-2.5 pl-[86px]"
    >
      <button
        type="button"
        onClick={() => toggleLeftSidebar()}
        title="Toggle sidebar"
        className="flex items-center justify-center rounded-[6px] p-1.5 text-fg-subtle transition hover:bg-hover hover:text-fg"
      >
        {leftSidebarOpen ? <PanelLeftClose size={15} /> : <PanelLeft size={15} />}
      </button>

      {/* Identity */}
      <span data-tauri-drag-region className="text-[12px] font-semibold tracking-tight text-fg">
        Fuse
      </span>
      {dirty && (
        <span title="Unsaved changes" className="size-[5px] shrink-0 rounded-full bg-fg-subtle" />
      )}

      {/* Live run readout */}
      <div
        data-tauri-drag-region
        className="flex min-w-0 flex-1 items-center justify-center gap-2"
      >
        {running ? (
          <span className="flex items-center gap-2 text-[11px] text-fg-muted">
            <StatusDot status="running" />
            <span className="tabular-nums">
              {done} of {order.length}
            </span>
            <span className="text-fg-subtle/60">·</span>
            <span className="tabular-nums text-fg-subtle">{formatDuration(elapsed)}</span>
          </span>
        ) : toast ? (
          <span
            className={cn(
              "animate-in-soft truncate text-[11px]",
              toast.tone === "error" ? "text-danger" : "text-fg-muted",
            )}
          >
            {toast.text}
          </span>
        ) : lastRun ? (
          <span
            className={cn(
              "animate-in-soft flex items-center gap-2 text-[11px]",
              TONE_TEXT[RUN_STATUS_TONE[lastRun.status]],
            )}
          >
            <StatusDot status={lastRun.status === "cancelled" ? "cancelled" : lastRun.status} />
            {RUN_STATUS_LABEL[lastRun.status]}
            <span className="tabular-nums text-fg-subtle">
              {formatDuration(lastRun.durationMs)}
            </span>
          </span>
        ) : null}
      </div>

      <Button
        variant="subtle"
        onClick={(event) => {
          // Opens under the button, so the list appears where you clicked.
          const box = event.currentTarget.getBoundingClientRect();
          openNodePicker({ x: box.right - 320, y: box.bottom + 6 });
        }}
        title="Add a block  Tab"
      >
        <Plus size={13} strokeWidth={2} />
        Add block
        <Kbd>Tab</Kbd>
      </Button>

      {running ? (
        <Button variant="danger" onClick={() => void stopCurrentRun()} title="Stop the run">
          <Square size={9} fill="currentColor" strokeWidth={0} />
          Stop
        </Button>
      ) : (
        showRunAll && (
          <Button
            variant="primary"
            onClick={() => void runCurrentWorkflow()}
            disabled={nodeCount === 0}
            title={
              frames > 0
                ? `Run every block, including the ${loose} outside any frame  ⌘↵`
                : "Run workflow  ⌘↵"
            }
          >
            <Play size={10} fill="currentColor" strokeWidth={0} />
            {frames > 0 ? "Run all" : "Run"}
          </Button>
        )
      )}

      <button
        type="button"
        onClick={() => setPaletteOpen(true)}
        title="Command palette"
        className="ml-0.5 flex items-center gap-0.5 rounded-[6px] px-1 py-1 transition hover:bg-hover"
      >
        <Kbd>⌘</Kbd>
        <Kbd>K</Kbd>
      </button>

      <button
        type="button"
        onClick={() => setDocsOpen(true)}
        title="Documentation"
        className="flex items-center justify-center rounded-[6px] p-1.5 text-fg-subtle transition hover:bg-hover hover:text-fg"
      >
        <BookOpen size={15} />
      </button>

      <button
        type="button"
        onClick={() => void importWorkflow()}
        title="Open Workflow"
        className="flex items-center justify-center rounded-[6px] p-1.5 text-fg-subtle transition hover:bg-hover hover:text-fg"
      >
        <FolderOpen size={15} />
      </button>

      <button
        type="button"
        onClick={() => void importBlocks()}
        title="Import Blocks into Current Flow"
        className="flex items-center justify-center rounded-[6px] p-1.5 text-fg-subtle transition hover:bg-hover hover:text-fg"
      >
        <FolderInput size={15} />
      </button>

      {availableUpdate && (
        <button
          type="button"
          onClick={() => setSettingsOpen(true)}
          className="flex items-center gap-1.5 rounded-full bg-emerald-500/15 border border-emerald-500/30 px-2.5 py-1 text-[11px] font-medium text-emerald-400 hover:bg-emerald-500/25 transition shadow-sm"
          title={`Update to v${availableUpdate} available — Click to install`}
        >
          <Sparkles size={12} className="text-emerald-400 animate-pulse" />
          <span>Update v{availableUpdate}</span>
        </button>
      )}

      <button
        type="button"
        onClick={() => setSettingsOpen(true)}
        title="Settings"
        className="flex items-center justify-center rounded-[6px] p-1.5 text-fg-subtle transition hover:bg-hover hover:text-fg"
      >
        <Settings size={15} />
      </button>

      <div className="ml-1 h-3 w-px bg-line" />

      <button
        type="button"
        onClick={() => toggleRightSidebar()}
        title="Toggle activity panel"
        className="flex items-center justify-center rounded-[6px] p-1.5 text-fg-subtle transition hover:bg-hover hover:text-fg"
      >
        {rightSidebarOpen ? <PanelRightClose size={15} /> : <PanelRight size={15} />}
      </button>
    </header>
  );
}
