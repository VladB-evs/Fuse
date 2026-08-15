import { memo } from "react";
import { type NodeProps } from "@xyflow/react";
import { useWorkflowStore } from "@/store/workflowStore";
import { CodeArea, NodeShell } from "./NodeShell";
import type { ApprovalNodeType } from "@/types/workflow";

/**
 * A checkpoint: the run stops here, shows what the steps before it printed,
 * and goes no further until someone says so. Saying no stops the whole run.
 */
function ApprovalNodeImpl({ id, data, selected }: NodeProps<ApprovalNodeType>) {
  const updateNodeData = useWorkflowStore((s) => s.updateNodeData);
  const beginEdit = useWorkflowStore((s) => s.beginEdit);

  return (
    <NodeShell
      id={id}
      kind="approval"
      label={data.label}
      frameId={data.frameId}
      selected={!!selected}
      onRename={(label) => updateNodeData(id, { label })}
    >
      <CodeArea
        value={data.message}
        rows={2}
        placeholder="What should the person check before continuing?"
        onCommit={beginEdit}
        onChange={(message) => updateNodeData(id, { message })}
      />

      <div className="grid grid-cols-2 gap-2 border-t border-line/60 pt-2">
        <div className="flex items-center gap-1.5 min-w-0">
          <span className="shrink-0 text-[10.5px] font-medium text-success">Go</span>
          <input
            value={data.continueLabel}
            placeholder="Continue"
            spellCheck={false}
            onFocus={beginEdit}
            onChange={(e) => updateNodeData(id, { continueLabel: e.currentTarget.value })}
            className="nodrag min-w-0 flex-1 rounded-[4px] border border-line bg-elevated/60 px-1.5 py-1 text-[10.5px] text-fg outline-none focus:border-accent"
          />
        </div>
        <div className="flex items-center gap-1.5 min-w-0">
          <span className="shrink-0 text-[10.5px] font-medium text-danger">Stop</span>
          <input
            value={data.stopLabel}
            placeholder="Stop"
            spellCheck={false}
            onFocus={beginEdit}
            onChange={(e) => updateNodeData(id, { stopLabel: e.currentTarget.value })}
            className="nodrag min-w-0 flex-1 rounded-[4px] border border-line bg-elevated/60 px-1.5 py-1 text-[10.5px] text-fg outline-none focus:border-accent"
          />
        </div>
      </div>
    </NodeShell>
  );
}

export const ApprovalNode = memo(ApprovalNodeImpl);
