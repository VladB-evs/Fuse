import { memo, useEffect, useRef, useState } from "react";
import { Handle, type NodeProps } from "@xyflow/react";
import { Pencil, Play, Download, LayoutDashboard, RotateCcw, GripVertical } from "lucide-react";
import { useWorkflowStore } from "@/store/workflowStore";
import { useRuntimeStore } from "@/store/runtimeStore";
import { useUIStore } from "@/store/uiStore";
import { runFrame, exportFrame } from "@/lib/actions";
import { autoLayoutFrame } from "@/lib/layout";
import { membersOf } from "@/lib/frames";
import { cn } from "@/lib/utils";
import { PORTS } from "../ports";
import type { FrameNodeType } from "@/types/workflow";

/**
 * A frame is a named folder wrapped around a set of blocks, with its own Run.
 *
 * It has no resize handles: the rectangle is computed from the blocks inside
 * it, so it always hugs its contents. Dragging anywhere on it moves the frame
 * and everything it holds — the blocks sit on a layer above, so a click that
 * lands on a block still goes to the block.
 */
function FrameNodeImpl({ id, data, selected }: NodeProps<FrameNodeType>) {
  const beginEdit = useWorkflowStore((s) => s.beginEdit);
  const updateFrameData = useWorkflowStore((s) => s.updateFrameData);

  const memberCount = useWorkflowStore((s) => membersOf(id, s.nodes).length);
  const runActive = useRuntimeStore((s) => s.running);
  const isDropTarget = useUIStore((s) => s.dropFrameId === id);

  const [editingLabel, setEditingLabel] = useState(false);
  const labelRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (editingLabel) labelRef.current?.select();
  }, [editingLabel]);

  return (
    <div
      className={cn(
        "group/frame relative h-full w-full rounded-[14px] border-2 border-dashed",
        "transition-colors duration-150 pointer-events-none",
        data.workingDir
          ? "border-accent/40 bg-accent/[0.045]"
          : "border-line-strong bg-white/[0.015]",
        selected && "border-solid border-accent/80",
        // A block is hovering over this frame and will join it on release.
        isDropTarget && "border-solid border-accent bg-accent/[0.09]",
      )}
    >
      <div className="absolute inset-0 rounded-[12px]" />

      {/* Header tab. Sits above the frame so it never covers a block. */}
      <div
        className={cn(
          "absolute -top-[30px] left-0 flex h-[26px] min-w-[140px] max-w-full items-center gap-1",
          "rounded-t-[8px] border border-b-0 border-line bg-elevated pr-1.5 pl-1",
          "pointer-events-auto",
          selected && "border-accent/60",
        )}
      >
        {/* Dedicated drag handle */}
        <div 
          className="flex h-full items-center justify-center cursor-grab active:cursor-grabbing text-fg-subtle/40 hover:text-fg-subtle px-2 transition-colors -space-x-[7px]" 
          title="Drag frame"
        >
          <GripVertical size={14} strokeWidth={2.5} />
          <GripVertical size={14} strokeWidth={2.5} />
        </div>

        <div className="nodrag flex flex-1 items-center gap-1.5 h-full px-1" title="Select frame">
        {editingLabel ? (
          <input
            ref={labelRef}
            className="min-w-[6ch] bg-transparent text-[11.5px] font-medium text-fg outline-none"
            defaultValue={data.label}
            autoFocus
            size={Math.max(data.label.length, 8)}
            onFocus={beginEdit}
            onBlur={(e) => {
              updateFrameData(id, { label: e.currentTarget.value.trim() || "Frame" });
              setEditingLabel(false);
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === "Escape") e.currentTarget.blur();
              e.stopPropagation();
            }}
          />
        ) : (
          <button
            type="button"
            // Single click renames: the name is the one thing on a frame you
            // reach for, and hiding it behind a double-click hid it entirely.
            onClick={(e) => {
              e.stopPropagation();
              setEditingLabel(true);
            }}
            title="Click to rename"
            className="flex shrink-0 items-center gap-1 rounded-[5px] px-1 py-0.5 text-[11.5px] font-medium text-fg transition hover:bg-hover"
          >
            {data.label || "Frame"}
            <Pencil
              size={9}
              strokeWidth={2}
              className="text-fg-subtle opacity-0 transition group-hover/frame:opacity-100"
            />
          </button>
        )}

        <span className="shrink-0 text-[10.5px] tabular-nums text-fg-subtle">
          {memberCount} block{memberCount === 1 ? "" : "s"}
        </span>
        </div>

        <button
          type="button"
          disabled={runActive || memberCount === 0}
          title={
            memberCount === 0
              ? "Drag blocks into this frame to run it"
              : `Run the ${memberCount} block${memberCount === 1 ? "" : "s"} in this frame`
          }
          onClick={(e) => {
            e.stopPropagation();
            void runFrame(id);
          }}
          className={cn(
            "nodrag ml-auto flex shrink-0 items-center gap-1 rounded-[5px] px-1.5 py-0.5",
            "text-[10.5px] font-medium text-fg-muted transition",
            "hover:bg-accent hover:text-white",
            "disabled:pointer-events-none disabled:opacity-35",
          )}
        >
          <Play size={8} fill="currentColor" strokeWidth={0} />
          Run
        </button>

        <button
          type="button"
          title="Auto-align blocks in this frame"
          onClick={(e) => {
            e.stopPropagation();
            void autoLayoutFrame(id);
          }}
          className={cn(
            "nodrag flex shrink-0 items-center justify-center rounded-[5px] size-[22px]",
            "text-fg-subtle transition",
            "hover:bg-accent hover:text-white",
          )}
        >
          <LayoutDashboard size={10} strokeWidth={2} />
        </button>

        <button
          type="button"
          title="Reset run state"
          onClick={(e) => {
            e.stopPropagation();
            useRuntimeStore.getState().clearAll();
          }}
          className={cn(
            "nodrag flex shrink-0 items-center justify-center rounded-[5px] size-[22px]",
            "text-fg-subtle transition",
            "hover:bg-accent hover:text-white",
          )}
        >
          <RotateCcw size={10} strokeWidth={2} />
        </button>

        <button
          type="button"
          title="Export frame blocks to JSON"
          onClick={(e) => {
            e.stopPropagation();
            void exportFrame(id);
          }}
          className={cn(
            "nodrag flex shrink-0 items-center justify-center rounded-[5px] size-[22px]",
            "text-fg-subtle transition",
            "hover:bg-accent hover:text-white",
          )}
        >
          <Download size={10} strokeWidth={2} />
        </button>
      </div>

      {memberCount === 0 && (
        <div className="absolute inset-0 flex items-center justify-center">
          <p className="text-[11px] text-fg-subtle">Drag blocks in, or double-click to add one</p>
        </div>
      )}

      {PORTS.map((port) => (
        <Handle
          key={port.id}
          id={port.id}
          type={port.type}
          position={port.position}
          className={`fuse-port fuse-port-${port.id}`}
        />
      ))}
    </div>
  );
}

export const FrameNode = memo(FrameNodeImpl);
