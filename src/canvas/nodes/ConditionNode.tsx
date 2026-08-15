import { memo } from "react";
import { Handle, Position, type NodeProps } from "@xyflow/react";
import { useWorkflowStore } from "@/store/workflowStore";
import { CodeArea, NodeShell, Note, TextField } from "./NodeShell";
import { FALSE_PORT, TARGET_PORT, TRUE_PORT } from "@/canvas/ports";
import type { ConditionNodeType } from "@/types/workflow";

/**
 * A fork the machine decides.
 *
 * This is the one block with more than one way out, so it draws its own ports:
 * **yes** along the bottom (the path that carries on) and **no** on the right
 * (the path that branches off). Which port a wire leaves from is what the
 * engine reads, so the two are labelled on the card itself rather than being
 * something you have to remember.
 */
function ConditionNodeImpl({ id, data, selected }: NodeProps<ConditionNodeType>) {
  const updateNodeData = useWorkflowStore((s) => s.updateNodeData);
  const beginEdit = useWorkflowStore((s) => s.beginEdit);

  return (
    <NodeShell
      id={id}
      kind="condition"
      label={data.label}
      frameId={data.frameId}
      selected={!!selected}
      workingDir={data.workingDir}
      onRename={(label) => updateNodeData(id, { label })}
      ports={
        <>
          <Handle id={TARGET_PORT} type="source" position={Position.Top} className="fuse-port fuse-port-top" />
          <Handle id="left" type="source" position={Position.Left} className="fuse-port fuse-port-left" />
          <Handle
            id={TRUE_PORT}
            type="source"
            position={Position.Bottom}
            className="fuse-port fuse-port-bottom fuse-port--true"
          />
          <Handle
            id={FALSE_PORT}
            type="source"
            position={Position.Right}
            className="fuse-port fuse-port-right fuse-port--false"
          />

          {/* The wires read themselves: which port a wire left from is what
              the engine acts on, so both are named on the canvas. */}
          <span className="pointer-events-none absolute -bottom-[16px] left-2 text-[9px] font-medium text-success/85">
            {data.trueLabel || "Yes"} ↓
          </span>
          <span className="pointer-events-none absolute top-1/2 -right-[8px] translate-x-full -translate-y-1/2 text-[9px] font-medium text-warn/85">
            → {data.falseLabel || "No"}
          </span>
        </>
      }
    >
      <CodeArea
        value={data.test}
        rows={2}
        placeholder="test -f dist/index.js"
        onCommit={beginEdit}
        onChange={(test) => updateNodeData(id, { test })}
      />

      <div className="flex items-center gap-1.5">
        <span className="flex items-center gap-1 text-[10px] text-success">
          <span className="size-[6px] rounded-full bg-success" />↓
        </span>
        <TextField
          value={data.trueLabel}
          placeholder="Yes"
          mono={false}
          onCommit={beginEdit}
          onChange={(trueLabel) => updateNodeData(id, { trueLabel })}
        />
        <span className="flex items-center gap-1 text-[10px] text-warn">
          <span className="size-[6px] rounded-full bg-warn" />→
        </span>
        <TextField
          value={data.falseLabel}
          placeholder="No"
          mono={false}
          onCommit={beginEdit}
          onChange={(falseLabel) => updateNodeData(id, { falseLabel })}
        />
      </div>

      <Note tone={data.test.trim() ? "muted" : "warn"}>
        {data.test.trim()
          ? "Exit 0 goes down, anything else goes right"
          : "Add a test — exit 0 is yes, anything else is no"}
      </Note>
    </NodeShell>
  );
}

export const ConditionNode = memo(ConditionNodeImpl);
