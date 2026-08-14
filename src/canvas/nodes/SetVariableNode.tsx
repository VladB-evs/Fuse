import { memo } from "react";
import { type NodeProps } from "@xyflow/react";
import { useWorkflowStore } from "@/store/workflowStore";
import { NodeShell, TextField, CodeArea } from "./NodeShell";
import type { SetVariableNodeType } from "@/types/workflow";

function SetVariableNodeImpl({ id, data, selected }: NodeProps<SetVariableNodeType>) {
  const updateNodeData = useWorkflowStore((s) => s.updateNodeData);
  const beginEdit = useWorkflowStore((s) => s.beginEdit);

  return (
    <NodeShell
      id={id}
      kind="set_variable"
      label={data.label}
      frameId={data.frameId}
      selected={!!selected}
      workingDir={null}
      onRename={(label) => updateNodeData(id, { label })}
    >
      <TextField
        label="Variable"
        value={data.variable}
        placeholder="name"
        onCommit={beginEdit}
        onChange={(variable) => updateNodeData(id, { variable })}
      />
      <CodeArea
        value={data.value}
        rows={2}
        placeholder="Value (can use {{other_var}})"
        onCommit={beginEdit}
        onChange={(value) => updateNodeData(id, { value })}
      />
    </NodeShell>
  );
}

export const SetVariableNode = memo(SetVariableNodeImpl);
