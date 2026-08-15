import { useCallback, useEffect, useRef, useState } from "react";
import { Command } from "cmdk";
import { useReactFlow } from "@xyflow/react";
import {
  FilePlus2,
  FolderOpen,
  Frame,
  Maximize2,
  Pencil,
  Plus,
  Redo2,
  Search,
  PanelBottom,
  Copy,
  Trash2,
  Undo2,
  Unlink,
  ZoomIn,
  ZoomOut,
  Download,
  Upload,
  FileJson,
  LayoutTemplate,
  Map,
  type LucideIcon,
} from "lucide-react";
import { listWorkflows } from "@/bridge/commands";
import { useUIStore } from "@/store/uiStore";
import { useWorkflowStore } from "@/store/workflowStore";
import { Kbd } from "@/components/ui/Kbd";
import {
  addFrameBlock,
  createNewWorkflow,
  disconnectSelection,
  chooseWorkingDirectory,
  openNodePicker,
  openWorkflowById,
  exportWorkflow,
  importWorkflow,
  importBlocks,
} from "@/lib/actions";
import { autoLayoutGraph } from "@/lib/layout";
import { cn } from "@/lib/utils";
import type { WorkflowSummary } from "@/types/workflow";

type Page = "root" | "open" | "preset";

export function CommandPalette() {
  const open = useUIStore((s) => s.paletteOpen);
  const setOpen = useUIStore((s) => s.setPaletteOpen);
  const toggleOutput = useUIStore((s) => s.toggleOutput);

  const { zoomIn, zoomOut, fitView } = useReactFlow();

  const [page, setPage] = useState<Page>("root");
  const [search, setSearch] = useState("");
  const [workflows, setWorkflows] = useState<WorkflowSummary[]>([]);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) return;
    setPage("root");
    setSearch("");
    // Prefetch so "Open Workflow" never shows a loading state.
    listWorkflows()
      .then(setWorkflows)
      .catch(() => setWorkflows([]));
  }, [open]);

  const close = useCallback(() => setOpen(false), [setOpen]);

  const act = useCallback(
    (fn: () => unknown) => () => {
      close();
      // Let the overlay unmount before focus moves elsewhere.
      requestAnimationFrame(() => void fn());
    },
    [close],
  );

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center pt-[15vh]">
      <div 
        className="absolute inset-0 bg-canvas/55 backdrop-blur-[2px]" 
        onMouseDown={close}
        aria-hidden 
      />

      <Command
        // One list per page. Swapping every item out from under cmdk leaves it
        // holding a selection that no longer exists, and nothing is
        // highlighted — remounting starts the new page on its first item and
        // puts the caret back in the search field.
        key={page}
        loop
        className={cn(
          "animate-in-soft relative w-[560px] max-w-[calc(100vw-32px)] overflow-hidden",
          "rounded-xl border border-line-strong bg-base shadow-[0_18px_50px_-12px_rgba(0,0,0,0.8)]",
        )}
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            event.preventDefault();
            if (page === "root") close();
            else setPage("root");
            return;
          }
          // Backspace on an empty query steps back out of a sub-page.
          if (event.key === "Backspace" && search === "" && page !== "root") {
            event.preventDefault();
            setPage("root");
          }
        }}
      >
        <div className="flex items-center gap-2 border-b border-line px-3.5">
          {page !== "root" && (
            <span className="shrink-0 rounded-[5px] bg-elevated px-1.5 py-0.5 text-[11px] text-fg-muted">
              {page === "open" ? "Open" : "Insert"}
            </span>
          )}
          <Command.Input
            ref={inputRef}
            autoFocus
            value={search}
            onValueChange={setSearch}
            placeholder={
              page === "open"
                ? "Search workflows…"
                : "Type a command…"
            }
            className="h-11 flex-1 bg-transparent text-[13px] text-fg outline-none placeholder:text-fg-subtle"
          />
        </div>

        <Command.List className="max-h-[340px] overflow-y-auto p-1.5">
          <Command.Empty className="px-3 py-6 text-center text-[12px] text-fg-subtle">
            No matching commands
          </Command.Empty>

          {page === "root" && (
            <>
              <Group heading="Workflow">
                <Item
                  icon={Plus}
                  hint="every kind of block, in one list"
                  value="add block node step insert command script http condition"
                  onSelect={act(() => openNodePicker())}
                  shortcut="Tab"
                >
                  Add a block…
                </Item>
                <Item
                  icon={Frame}
                  hint="group blocks under one folder"
                  onSelect={act(() => addFrameBlock())}
                  shortcut="F"
                >
                  Add a frame
                </Item>
                <Item
                  icon={FolderOpen}
                  hint="where this workflow's commands run"
                  onSelect={act(chooseWorkingDirectory)}
                >
                  Set project folder…
                </Item>
                <Item
                  icon={Unlink}
                  hint="cut the wires around the selected blocks"
                  value="disconnect unwire detach edges wires"
                  onSelect={act(disconnectSelection)}
                  shortcut="⇧ ⌫"
                >
                  Disconnect selection
                </Item>
              </Group>

              <Group heading="File">
                <Item icon={FilePlus2} onSelect={act(createNewWorkflow)} shortcut="⌘ N">
                  New workflow
                </Item>
                <Item icon={Pencil} onSelect={act(() => useUIStore.getState().setRenameOpen(true))}>
                  Rename workflow…
                </Item>
                <Item
                  icon={Search}
                  onSelect={() => {
                    setPage("open");
                    setSearch("");
                  }}
                  shortcut="⌘ O"
                >
                  Open workflow…
                </Item>
                <Item icon={Download} onSelect={act(exportWorkflow)}>
                  Export workflow…
                </Item>
                <Item icon={Upload} onSelect={act(importWorkflow)}>
                  Import workflow…
                </Item>
                <Item icon={FileJson} onSelect={act(importBlocks)}>
                  Import blocks into canvas…
                </Item>
              </Group>

              <Group heading="View">
                <Item icon={PanelBottom} onSelect={act(toggleOutput)} shortcut="⌘ /">
                  Toggle output panel
                </Item>
                <Item icon={Map} onSelect={act(() => useUIStore.getState().toggleMinimap())} shortcut="M">
                  Toggle minimap
                </Item>
                <Item icon={LayoutTemplate} onSelect={act(autoLayoutGraph)}>
                  Auto layout graph
                </Item>
                <Item icon={Maximize2} onSelect={act(() => fitView({ padding: 0.3, duration: 240, maxZoom: 1 }))}>
                  Fit canvas
                </Item>
                <Item icon={ZoomIn} onSelect={act(() => zoomIn({ duration: 160 }))} shortcut="⌘ +">
                  Zoom in
                </Item>
                <Item icon={ZoomOut} onSelect={act(() => zoomOut({ duration: 160 }))} shortcut="⌘ −">
                  Zoom out
                </Item>
              </Group>

              <Group heading="Edit">
                <Item
                  icon={Undo2}
                  onSelect={act(() => useWorkflowStore.getState().undo())}
                  shortcut="⌘ Z"
                >
                  Undo
                </Item>
                <Item
                  icon={Redo2}
                  onSelect={act(() => useWorkflowStore.getState().redo())}
                  shortcut="⌘ ⇧ Z"
                >
                  Redo
                </Item>
                <Item
                  icon={Copy}
                  onSelect={act(() => useWorkflowStore.getState().duplicateSelected())}
                  shortcut="⌘ D"
                >
                  Duplicate selection
                </Item>
                <Item
                  icon={Trash2}
                  onSelect={act(() => useWorkflowStore.getState().deleteSelected())}
                  shortcut="⌫"
                >
                  Delete selection
                </Item>
              </Group>
            </>
          )}

          {page === "open" && (
            <Group heading="Saved workflows">
              {workflows.length === 0 && (
                <div className="px-2.5 py-3 text-[12px] text-fg-subtle">
                  Nothing saved yet — press ⌘S to save this one.
                </div>
              )}
              {workflows.map((workflow) => (
                <Item
                  key={workflow.id}
                  value={`${workflow.name} ${workflow.id}`}
                  onSelect={act(() => openWorkflowById(workflow.id))}
                  shortcut={`${workflow.nodeCount} block${workflow.nodeCount === 1 ? "" : "s"}`}
                >
                  {workflow.name}
                </Item>
              ))}
            </Group>
          )}
        </Command.List>

        <div className="flex h-8 items-center gap-3 border-t border-line px-3 text-[10.5px] text-fg-subtle">
          <span className="flex items-center gap-1">
            <Kbd>↵</Kbd> select
          </span>
          <span className="flex items-center gap-1">
            <Kbd>↑</Kbd>
            <Kbd>↓</Kbd> navigate
          </span>
          <span className="flex items-center gap-1">
            <Kbd>esc</Kbd> {page === "root" ? "close" : "back"}
          </span>
        </div>
      </Command>
    </div>
  );
}

function Group({ heading, children }: { heading: string; children: React.ReactNode }) {
  return (
    <Command.Group
      heading={heading}
      className={cn(
        "mb-0.5 [&_[cmdk-group-heading]]:px-2.5 [&_[cmdk-group-heading]]:py-1.5",
        "[&_[cmdk-group-heading]]:text-[10px] [&_[cmdk-group-heading]]:font-medium",
        "[&_[cmdk-group-heading]]:tracking-wide [&_[cmdk-group-heading]]:text-fg-subtle",
        "[&_[cmdk-group-heading]]:uppercase",
      )}
    >
      {children}
    </Command.Group>
  );
}

function Item({
  children,
  onSelect,
  shortcut,
  disabled,
  value,
  icon: Icon,
  hint,
}: {
  children: React.ReactNode;
  onSelect: () => void;
  shortcut?: string;
  disabled?: boolean;
  value?: string;
  icon?: LucideIcon;
  /** The half-sentence that says what the row actually does. */
  hint?: string;
}) {
  return (
    <Command.Item
      value={value}
      onSelect={onSelect}
      disabled={disabled}
      className={cn(
        "flex cursor-default items-center gap-2.5 rounded-[7px] px-2.5 py-[7px]",
        "text-[12.5px] text-fg-muted select-none",
        "data-[selected=true]:bg-hover data-[selected=true]:text-fg",
        "data-[disabled=true]:opacity-40",
      )}
    >
      {Icon && <Icon size={12} strokeWidth={1.75} className="shrink-0 text-fg-subtle" />}
      <span className="min-w-0 flex-1 truncate">
        {children}
        {hint && <span className="ml-2 text-[11px] text-fg-subtle">{hint}</span>}
      </span>
      {shortcut && <span className="shrink-0 text-[10.5px] text-fg-subtle">{shortcut}</span>}
    </Command.Item>
  );
}
