import { useEffect, useMemo, useRef, useState } from "react";
import {
  BookOpen,
  Braces,
  ChevronDown,
  FileSearch,
  FlaskConical,
  FolderInput,
  FolderOpen,
  PanelLeft,
  PanelLeftClose,
  Play,
  Plus,
  Settings,
  Square,
  Zap,
} from "lucide-react";
import { useWorkflowStore } from "@/store/workflowStore";
import { useRuntimeStore } from "@/store/runtimeStore";
import { useUIStore } from "@/store/uiStore";
import { Button } from "@/components/ui/Button";
import { StatusDot } from "@/components/ui/StatusDot";
import { Kbd } from "@/components/ui/Kbd";
import {
  importBlocks,
  importWorkflow,
  openNodePicker,
  runCurrentWorkflow,
  stopCurrentRun,
} from "@/lib/actions";
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

  // Always show the Run button in the top toolbar so the user can easily run
  // the entire workflow (or all frames) in Live, Sandbox, or Dry Run modes.
  const showRunAll = true;

  const running = useRuntimeStore((s) => s.running);
  const activeRunMode = useRuntimeStore((s) => s.runMode);
  const sandboxDiff = useRuntimeStore((s) => s.sandboxDiff);
  const startedAt = useRuntimeStore((s) => s.startedAt);
  const order = useRuntimeStore((s) => s.order);
  const statuses = useRuntimeStore((s) => s.statuses);
  const lastRun = useRuntimeStore((s) => s.lastRun);

  const selectedMode = useRuntimeStore((s) => s.selectedRunMode);
  const setSelectedMode = useRuntimeStore((s) => s.setSelectedRunMode);
  const [modeMenuOpen, setModeMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  const toast = useUIStore((s) => s.toast);
  const setPaletteOpen = useUIStore((s) => s.setPaletteOpen);
  const setDocsOpen = useUIStore((s) => s.setDocsOpen);
  const setImportJsonOpen = useUIStore((s) => s.setImportJsonOpen);
  const setSettingsOpen = useUIStore((s) => s.setSettingsOpen);
  const leftSidebarOpen = useUIStore((s) => s.leftSidebarOpen);
  const toggleLeftSidebar = useUIStore((s) => s.toggleLeftSidebar);
  const setOutputOpen = useUIStore((s) => s.setOutputOpen);

  const elapsed = useElapsed(startedAt, running);

  const done = useMemo(
    () => order.filter((id) => TERMINAL_STATES.includes(statuses[id] ?? "idle")).length,
    [order, statuses],
  );

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setModeMenuOpen(false);
      }
    }
    if (modeMenuOpen) {
      document.addEventListener("mousedown", handleClickOutside);
      return () => document.removeEventListener("mousedown", handleClickOutside);
    }
  }, [modeMenuOpen]);

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
          <div className="flex items-center gap-2">
            {activeRunMode === "sandbox" && (
              <span className="flex items-center gap-1 rounded-full border border-amber-500/30 bg-amber-500/10 px-2 py-0.5 text-[10.5px] font-medium text-amber-400">
                <FlaskConical size={11} className="animate-pulse" />
                SANDBOX RUN
              </span>
            )}
            {activeRunMode === "dry_run" && (
              <span className="flex items-center gap-1 rounded-full border border-sky-500/30 bg-sky-500/10 px-2 py-0.5 text-[10.5px] font-medium text-sky-400">
                <FileSearch size={11} className="animate-pulse" />
                DRY RUN (SIMULATION)
              </span>
            )}
            <span className="flex items-center gap-2 text-[11px] text-fg-muted">
              <StatusDot status="running" />
              <span className="tabular-nums">
                {done} of {order.length}
              </span>
              <span className="text-fg-subtle/60">·</span>
              <span className="tabular-nums text-fg-subtle">{formatDuration(elapsed)}</span>
            </span>
          </div>
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
          <div className="flex items-center gap-2">
            {activeRunMode === "sandbox" && (
              <button
                type="button"
                onClick={() => setOutputOpen(true)}
                className="flex items-center gap-1 rounded-full border border-amber-500/30 bg-amber-500/10 px-2 py-0.5 text-[10.5px] font-medium text-amber-400 hover:bg-amber-500/20 transition cursor-pointer"
                title="View Sandbox Changes"
              >
                <FlaskConical size={11} />
                Sandbox {sandboxDiff ? `(${sandboxDiff.length} files)` : "Completed"}
              </button>
            )}
            {activeRunMode === "dry_run" && (
              <span className="flex items-center gap-1 rounded-full border border-sky-500/30 bg-sky-500/10 px-2 py-0.5 text-[10.5px] font-medium text-sky-400">
                <FileSearch size={11} />
                Dry Run
              </span>
            )}
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
          </div>
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
          <div ref={menuRef} className="relative flex items-center">
            <Button
              variant="primary"
              onClick={() => void runCurrentWorkflow(selectedMode)}
              disabled={nodeCount === 0}
              className={cn(
                "rounded-r-none pr-2.5",
                selectedMode === "live" && "fuse-btn-live",
                selectedMode === "sandbox" && "fuse-btn-sandbox",
                selectedMode === "dry_run" && "fuse-btn-dryrun",
              )}
              title={
                selectedMode === "sandbox"
                  ? "Run isolated in Sandbox  ⌘↵"
                  : selectedMode === "dry_run"
                    ? "Dry run simulation  ⌘↵"
                    : "⚡ Live Run (Real Execution)  ⌘↵"
              }
            >
              {selectedMode === "sandbox" ? (
                <FlaskConical size={11} strokeWidth={2} className="drop-shadow-[0_0_4px_rgba(255,255,255,0.6)]" />
              ) : selectedMode === "dry_run" ? (
                <FileSearch size={11} strokeWidth={2} className="drop-shadow-[0_0_4px_rgba(255,255,255,0.6)]" />
              ) : (
                <Play size={10} fill="currentColor" strokeWidth={0} className="drop-shadow-[0_0_4px_rgba(255,255,255,0.8)]" />
              )}
              {selectedMode === "sandbox"
                ? "Sandbox"
                : selectedMode === "dry_run"
                  ? "Dry Run"
                  : "Live Run"}
            </Button>
            <Button
              variant="primary"
              onClick={() => setModeMenuOpen((prev) => !prev)}
              disabled={nodeCount === 0}
              className={cn(
                "rounded-l-none border-l border-white/20 px-1.5",
                selectedMode === "live" && "fuse-btn-live",
                selectedMode === "sandbox" && "fuse-btn-sandbox",
                selectedMode === "dry_run" && "fuse-btn-dryrun",
              )}
              title="Select Run Mode"
            >
              <ChevronDown size={11} strokeWidth={2} />
            </Button>

            {modeMenuOpen && (
              <div className="absolute top-full right-0 z-50 mt-1.5 w-64 rounded-lg border border-line bg-surface/95 p-1 shadow-xl backdrop-blur-md animate-in-soft">
                <button
                  type="button"
                  onClick={() => {
                    setSelectedMode("live");
                    setModeMenuOpen(false);
                  }}
                  className={cn(
                    "flex w-full items-start gap-2.5 rounded-md p-2 text-left transition hover:bg-hover cursor-pointer",
                    selectedMode === "live" && "bg-hover/80",
                  )}
                >
                  <Zap size={14} className="mt-0.5 shrink-0 text-emerald-400" />
                  <div className="flex-1">
                    <div className="text-[12px] font-medium text-fg">⚡ Live Run</div>
                    <div className="text-[10.5px] text-fg-subtle">
                      Execute commands directly against your repo.
                    </div>
                  </div>
                </button>

                <button
                  type="button"
                  onClick={() => {
                    setSelectedMode("sandbox");
                    setModeMenuOpen(false);
                  }}
                  className={cn(
                    "flex w-full items-start gap-2.5 rounded-md p-2 text-left transition hover:bg-hover cursor-pointer",
                    selectedMode === "sandbox" && "bg-hover/80",
                  )}
                >
                  <FlaskConical size={14} className="mt-0.5 shrink-0 text-amber-400" />
                  <div className="flex-1">
                    <div className="text-[12px] font-medium text-fg">🧪 Sandbox Run</div>
                    <div className="text-[10.5px] text-fg-subtle">
                      Isolated git worktree with diff review before applying.
                    </div>
                  </div>
                </button>

                <button
                  type="button"
                  onClick={() => {
                    setSelectedMode("dry_run");
                    setModeMenuOpen(false);
                  }}
                  className={cn(
                    "flex w-full items-start gap-2.5 rounded-md p-2 text-left transition hover:bg-hover cursor-pointer",
                    selectedMode === "dry_run" && "bg-hover/80",
                  )}
                >
                  <FileSearch size={14} className="mt-0.5 shrink-0 text-sky-400" />
                  <div className="flex-1">
                    <div className="text-[12px] font-medium text-fg">📋 Dry Run (Simulate)</div>
                    <div className="text-[10.5px] text-fg-subtle">
                      Zero side effects. Validates flow, branches & placeholders.
                    </div>
                  </div>
                </button>
              </div>
            )}
          </div>
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
        onClick={() => setImportJsonOpen(true)}
        title="Import from JSON / Clipboard"
        className="flex items-center justify-center rounded-[6px] p-1.5 text-fg-subtle transition hover:bg-hover hover:text-fg"
      >
        <Braces size={15} />
      </button>

      <button
        type="button"
        onClick={() => void importWorkflow()}
        title="Open Workflow from File"
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

      <button
        type="button"
        onClick={() => setSettingsOpen(true)}
        title="Settings"
        className="flex items-center justify-center rounded-[6px] p-1.5 text-fg-subtle transition hover:bg-hover hover:text-fg"
      >
        <Settings size={15} />
      </button>
    </header>
  );
}
