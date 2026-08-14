import { useCallback, useEffect, useRef, useState } from "react";
import { FilePlus2, Folder, Pencil, RefreshCw, Workflow, X, Trash2 } from "lucide-react";
import { listWorkflows } from "@/bridge/commands";
import {
  chooseWorkingDirectory,
  clearWorkingDirectory,
  createNewWorkflow,
  openWorkflowById,
  renameSavedWorkflow,
  deleteWorkflowAction,
} from "@/lib/actions";
import { confirm } from "@tauri-apps/plugin-dialog";
import { getVersion } from "@tauri-apps/api/app";
import { cn, prettyPath } from "@/lib/utils";
import { useWorkflowStore } from "@/store/workflowStore";
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
  const workingDir = useWorkflowStore((s) => s.workingDir);
  const dirty = useWorkflowStore((s) => s.dirty);
  const [workflows, setWorkflows] = useState<WorkflowSummary[]>([]);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [appVersion, setAppVersion] = useState<string>("");

  useEffect(() => {
    getVersion().then(setAppVersion).catch(() => {});
  }, []);
  const cancelRenameRef = useRef(false);

  const refresh = useCallback(() => {
    void listWorkflows().then(setWorkflows).catch(() => setWorkflows([]));
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh, activeId, activeName, dirty]);

  const beginRename = (workflow: WorkflowSummary) => {
    cancelRenameRef.current = false;
    setEditingId(workflow.id);
    setDraft(workflow.name);
  };

  const createWorkflowFromSidebar = async () => {
    const created = await createNewWorkflow();
    refresh();
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
      <header className="flex h-10 items-center justify-between border-b border-line px-3">
        <span className="text-[11px] font-medium tracking-wide text-fg-muted uppercase">Workflows</span>
        <div className="flex items-center gap-0.5">
          <button
            type="button"
            onClick={refresh}
            title="Refresh saved workflows"
            className="flex size-6 items-center justify-center rounded-[5px] text-fg-subtle transition hover:bg-hover hover:text-fg"
          >
            <RefreshCw size={11} strokeWidth={2} />
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
                      onClick={() => beginRename(workflow)}
                      title={`Rename “${workflow.name}”`}
                      className="flex size-5 items-center justify-center rounded-[4px] text-fg-subtle hover:bg-base hover:text-fg"
                    >
                      <Pencil size={10} strokeWidth={2} />
                    </button>
                    <button
                      type="button"
                      onClick={() => void deleteWorkflow(workflow)}
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

      <footer className="border-t border-line px-2 py-2">
        <div className="mb-2 flex items-center justify-between px-1 text-[10px] text-fg-subtle">
          <span>{workflows.length} saved workflow{workflows.length === 1 ? "" : "s"}</span>
          {workingDir && (
            <button
              type="button"
              onClick={clearWorkingDirectory}
              title="Clear workflow folder"
              className="flex size-5 items-center justify-center rounded-[4px] text-fg-subtle transition hover:bg-hover hover:text-fg"
            >
              <X size={10} strokeWidth={2} />
            </button>
          )}
        </div>
        <button
          type="button"
          onClick={() => void chooseWorkingDirectory()}
          title={workingDir ? `Workflow folder: ${workingDir}` : "Attach a workflow folder"}
          className="flex w-full items-center gap-2 rounded-[7px] border border-line bg-canvas px-2 py-1.5 text-left transition hover:border-accent/40 hover:bg-hover"
        >
          <Folder size={12} className={workingDir ? "text-accent" : "text-fg-subtle"} />
          <span className="min-w-0 flex-1">
            <span className="block truncate text-[10.5px] font-medium text-fg-muted">
              {workingDir ? prettyPath(workingDir) : "/"}
            </span>
            <span className="block truncate text-[9.5px] text-fg-subtle">
              {workingDir ? "Frames inherit this folder" : "No folder attached"}
            </span>
          </span>
        </button>
        {appVersion && (
          <div className="mt-2 text-center text-[9px] text-fg-subtle/50">
            v{appVersion}
          </div>
        )}
      </footer>
    </aside>
  );
}
