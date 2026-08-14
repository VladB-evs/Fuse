import { useEffect, useState } from "react";
import { useUIStore } from "@/store/uiStore";
import { useWorkflowStore } from "@/store/workflowStore";
import { Button } from "@/components/ui/Button";

/**
 * The workflow name lives here rather than in the toolbar: it matters when you
 * save or reopen a workflow, and nowhere else. Reached from the command
 * palette.
 */
export function RenameDialog() {
  const open = useUIStore((s) => s.renameOpen);
  const setOpen = useUIStore((s) => s.setRenameOpen);
  const name = useWorkflowStore((s) => s.name);
  const setName = useWorkflowStore((s) => s.setName);

  const [draft, setDraft] = useState(name);

  useEffect(() => {
    if (open) setDraft(name);
  }, [open, name]);

  if (!open) return null;

  const commit = () => {
    setName(draft.trim() || "Untitled");
    setOpen(false);
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center pt-[22vh]"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) setOpen(false);
      }}
    >
      <div className="absolute inset-0 bg-canvas/55 backdrop-blur-[2px]" aria-hidden />

      <div className="animate-in-soft relative w-[380px] max-w-[calc(100vw-32px)] rounded-xl border border-line-strong bg-base p-3.5 shadow-[0_18px_50px_-12px_rgba(0,0,0,0.8)]">
        <label className="mb-2 block text-[11px] text-fg-muted" htmlFor="workflow-name">
          Workflow name
        </label>
        <input
          id="workflow-name"
          autoFocus
          value={draft}
          spellCheck={false}
          onChange={(e) => setDraft(e.currentTarget.value)}
          onFocus={(e) => e.currentTarget.select()}
          onKeyDown={(e) => {
            e.stopPropagation();
            if (e.key === "Enter") commit();
            if (e.key === "Escape") setOpen(false);
          }}
          className="w-full rounded-[7px] border border-line bg-elevated px-2.5 py-2 text-[13px] text-fg outline-none focus:border-accent/70"
        />

        <div className="mt-3 flex justify-end gap-1.5">
          <Button variant="ghost" onClick={() => setOpen(false)}>
            Cancel
          </Button>
          <Button variant="primary" onClick={commit}>
            Rename
          </Button>
        </div>
      </div>
    </div>
  );
}
