import { useCallback, useEffect, useRef, useState } from "react";
import { Braces, FilePlus2, Pencil, RefreshCw, Sparkles, Trash2, Workflow } from "lucide-react";
import AppIcon from "@/assets/icon.png";
import { listWorkflows } from "@/bridge/commands";
import {
  createNewWorkflow,
  openWorkflowById,
  renameSavedWorkflow,
  deleteWorkflowAction,
} from "@/lib/actions";
import { confirm } from "@tauri-apps/plugin-dialog";
import { getVersion } from "@tauri-apps/api/app";
import { cn } from "@/lib/utils";
import { useWorkflowStore } from "@/store/workflowStore";
import { useUIStore } from "@/store/uiStore";
import type { WorkflowSummary } from "@/types/workflow";

function relativeDate(updatedAt: number): string {
  const elapsed = Math.max(0, Date.now() - updatedAt);
  if (elapsed < 60_000) return "just now";
  if (elapsed < 3_600_000) return `${Math.floor(elapsed / 60_000)}m ago`;
  if (elapsed < 86_400_000) return `${Math.floor(elapsed / 3_600_000)}h ago`;
  if (elapsed < 604_800_000) return `${Math.floor(elapsed / 86_400_000)}d ago`;
  return new Date(updatedAt).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

/** Always-visible library of workflows, kept deliberately small and fast. */
export function WorkflowSidebar() {
  const activeId = useWorkflowStore((s) => s.id);
  const activeName = useWorkflowStore((s) => s.name);
  const dirty = useWorkflowStore((s) => s.dirty);
  const availableUpdate = useUIStore((s) => s.availableUpdate);
  const setSettingsOpen = useUIStore((s) => s.setSettingsOpen);
  const setImportJsonOpen = useUIStore((s) => s.setImportJsonOpen);
  const [workflows, setWorkflows] = useState<WorkflowSummary[]>([]);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [appVersion, setAppVersion] = useState<string>("");

  useEffect(() => {
    getVersion().then(setAppVersion).catch(() => {});
  }, []);
  const cancelRenameRef = useRef(false);

  const [refreshing, setRefreshing] = useState(false);

  const refresh = useCallback(async (silent = true) => {
    setRefreshing(true);
    try {
      const list = await listWorkflows();
      if (!silent) {
        // Compare with what was already known to report discoveries.
        setWorkflows((prev) => {
          const prevIds = new Set(prev.map((w) => w.id));
          const newOnes = list.filter((w) => !prevIds.has(w.id));
          if (newOnes.length > 0) {
            useUIStore.getState().notify(
              newOnes.length === 1
                ? `Found "${newOnes[0]?.name}"`
                : `Found ${newOnes.length} new workflows`,
            );
          } else {
            useUIStore.getState().notify("Already up to date");
          }
          return list;
        });
      } else {
        setWorkflows(list);
      }
    } catch {
      setWorkflows([]);
    } finally {
      setRefreshing(false);
    }
  }, []);

  // Silent refresh whenever the active workflow changes or is saved.
  useEffect(() => {
    void refresh(true);
  }, [refresh, activeId, activeName, dirty]);

  const handleRefreshClick = () => void refresh(false);

  const beginRename = (workflow: WorkflowSummary) => {
    cancelRenameRef.current = false;
    setEditingId(workflow.id);
    setDraft(workflow.name);
  };

  const createWorkflowFromSidebar = async () => {
    const created = await createNewWorkflow();
    await refresh(true);
    if (!created) return;
    cancelRenameRef.current = false;
    setEditingId(created.id);
    setDraft(created.name);
  };

  const commitRename = async () => {
    if (!editingId) return;
    if (cancelRenameRef.current) {
      cancelRenameRef.current = false;
      setEditingId(null);
      return;
    }
    const id = editingId;
    setEditingId(null);
    try {
      await renameSavedWorkflow(id, draft);
      refresh();
    } catch {
      // The action has already shown a useful error in the toolbar.
    }
  };

  const deleteWorkflow = async (workflow: WorkflowSummary) => {
    const yes = await confirm(`Are you sure you want to delete “${workflow.name}”?`, {
      title: "Delete Workflow",
      kind: "warning",
    });
    if (yes) {
      await deleteWorkflowAction(workflow.id);
      refresh();
    }
  };

  return (
    <aside className="flex w-[218px] shrink-0 flex-col border-r border-line bg-base">
      <header
        data-tauri-drag-region
        className="flex h-11 items-center justify-between border-b border-line px-3"
      >
        <div data-tauri-drag-region className="flex items-center gap-2">
          {/* App Icon */}
          <img src={AppIcon} alt="Fuse Logo" className="size-[20px] rounded-[5px] pointer-events-none" />
          <span data-tauri-drag-region className="text-[12px] font-bold tracking-tight text-fg">
            Fuse
          </span>
        </div>
        <div className="flex items-center gap-0.5">
          <button
            type="button"
            onClick={handleRefreshClick}
            disabled={refreshing}
            title="Scan for new workflows"
            className="flex size-6 items-center justify-center rounded-[5px] text-fg-subtle transition hover:bg-hover hover:text-fg disabled:opacity-50"
          >
            <RefreshCw size={11} strokeWidth={2} className={refreshing ? "animate-spin" : ""} />
          </button>
          <button
            type="button"
            onClick={() => setImportJsonOpen(true)}
            title="Import JSON / Clipboard"
            className="flex size-6 items-center justify-center rounded-[5px] text-fg-subtle transition hover:bg-hover hover:text-fg"
          >
            <Braces size={12} strokeWidth={2} />
          </button>
          <button
            type="button"
            onClick={() => void createWorkflowFromSidebar()}
            title="New workflow"
            className="flex size-6 items-center justify-center rounded-[5px] text-fg-subtle transition hover:bg-hover hover:text-fg"
          >
            <FilePlus2 size={12} strokeWidth={2} />
          </button>
        </div>
      </header>

      <div className="flex h-8 items-center px-3 border-b border-line/50">
        <span className="text-[10.5px] font-medium tracking-wide text-fg-muted uppercase">Workflows</span>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto p-1.5">
        {workflows.length === 0 ? (
          <div className="px-2 py-5 text-center">
            <Workflow size={16} className="mx-auto mb-2 text-fg-subtle" />
            <p className="text-[11px] leading-4 text-fg-subtle">Saved workflows will appear here.</p>
          </div>
        ) : (
          workflows.map((workflow) => {
            const active = workflow.id === activeId;
            const editing = workflow.id === editingId;
            return (
              <div
                key={workflow.id}
                className={cn(
                  "group relative mb-0.5 rounded-[7px] transition",
                  active ? "bg-accent/13" : "hover:bg-hover/70",
                )}
              >
                {editing ? (
                  <input
                    autoFocus
                    value={draft}
                    spellCheck={false}
                    aria-label="Workflow name"
                    onChange={(event) => setDraft(event.currentTarget.value)}
                    onFocus={(event) => event.currentTarget.select()}
                    onBlur={() => void commitRename()}
                    onKeyDown={(event) => {
                      event.stopPropagation();
                      if (event.key === "Enter") event.currentTarget.blur();
                      if (event.key === "Escape") {
                        cancelRenameRef.current = true;
                        setEditingId(null);
                      }
                    }}
                    className="m-1 w-[calc(100%_-_8px)] rounded-[5px] border border-accent/70 bg-base px-1.5 py-1 font-mono text-[11px] text-fg outline-none"
                  />
                ) : (
                  <button
                    type="button"
                    onClick={() => void openWorkflowById(workflow.id)}
                    className="w-full px-2 py-1.5 pr-7 text-left"
                    title={`Open “${workflow.name}”`}
                  >
                    <span className={cn("block truncate text-[11.5px] font-medium", active ? "text-fg" : "text-fg-muted")}>
                      {workflow.name}
                    </span>
                    <span className="mt-0.5 block text-[10px] text-fg-subtle">
                      {workflow.nodeCount} block{workflow.nodeCount === 1 ? "" : "s"} · {relativeDate(workflow.updatedAt)}
                    </span>
                  </button>
                )}
                {!editing && (
                  <div className="absolute top-2 right-1.5 flex gap-1 opacity-0 transition group-hover:opacity-100 focus-within:opacity-100">
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        e.preventDefault();
                        beginRename(workflow);
                      }}
                      title={`Rename “${workflow.name}”`}
                      className="flex size-5 items-center justify-center rounded-[4px] text-fg-subtle hover:bg-base hover:text-fg"
                    >
                      <Pencil size={10} strokeWidth={2} />
                    </button>
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        e.preventDefault();
                        void deleteWorkflow(workflow);
                      }}
                      title={`Delete “${workflow.name}”`}
                      className="flex size-5 items-center justify-center rounded-[4px] text-fg-subtle hover:bg-danger hover:text-white"
                    >
                      <Trash2 size={10} strokeWidth={2} />
                    </button>
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>

      <footer className="px-2 py-2">
        {availableUpdate && (
          <button
            type="button"
            onClick={() => setSettingsOpen(true)}
            className="mt-2 flex w-full items-center justify-center gap-1.5 rounded-[6px] border border-emerald-500/30 bg-emerald-500/15 px-2 py-1.5 text-[11px] font-medium text-emerald-400 hover:bg-emerald-500/25 transition shadow-sm cursor-pointer"
            title={`Update to v${availableUpdate} available — Click to install`}
          >
            <Sparkles size={12} className="text-emerald-400 animate-pulse shrink-0" />
            <span className="truncate">Update to v{availableUpdate}</span>
          </button>
        )}
        {appVersion && (
          <div className="mt-2 text-center text-[9px] text-fg-subtle/50">
            v{appVersion}
          </div>
        )}
      </footer>
    </aside>
  );
}
