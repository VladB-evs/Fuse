import { memo } from "react";
import { type NodeProps } from "@xyflow/react";
import { useWorkflowStore } from "@/store/workflowStore";
import { CodeArea, NodeShell, TextField } from "./NodeShell";
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

      <div className="flex items-center gap-1.5 border-t border-line/60 pt-2">
        <span className="text-[10px] text-success">Go</span>
        <TextField
          value={data.continueLabel}
          placeholder="Continue"
          mono={false}
          onCommit={beginEdit}
          onChange={(continueLabel) => updateNodeData(id, { continueLabel })}
        />
        <span className="text-[10px] text-danger">Stop</span>
        <TextField
          value={data.stopLabel}
          placeholder="Stop"
          mono={false}
          onCommit={beginEdit}
          onChange={(stopLabel) => updateNodeData(id, { stopLabel })}
        />
      </div>
    </NodeShell>
  );
}

export const ApprovalNode = memo(ApprovalNodeImpl);
