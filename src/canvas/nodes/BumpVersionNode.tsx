import { memo } from "react";
import { type NodeProps } from "@xyflow/react";
import { useWorkflowStore } from "@/store/workflowStore";
import { NodeShell, TextField, Choices } from "./NodeShell";
import type { BumpVersionNodeType } from "@/types/workflow";

function BumpVersionNodeImpl({ id, data, selected }: NodeProps<BumpVersionNodeType>) {
  const updateNodeData = useWorkflowStore((s) => s.updateNodeData);
  const beginEdit = useWorkflowStore((s) => s.beginEdit);

  return (
    <NodeShell
      id={id}
      kind="bump_version"
      label={data.label}
      frameId={data.frameId}
      selected={!!selected}
      workingDir={null}
      onRename={(label) => updateNodeData(id, { label })}
    >
      <TextField
        label="Variable In"
        value={data.variableIn}
        placeholder="current_version"
        onCommit={beginEdit}
        onChange={(variableIn) => updateNodeData(id, { variableIn })}
      />
      <Choices
        label="Bump Type"
        value={data.part}
        options={["major", "minor", "patch"]}
        onChange={(part) => {
          beginEdit();
          updateNodeData(id, { part });
        }}
      />
      <TextField
        label="Variable Out"
        value={data.variableOut}
        placeholder="next_version"
        onCommit={beginEdit}
        onChange={(variableOut) => updateNodeData(id, { variableOut })}
      />
    </NodeShell>
  );
}

export const BumpVersionNode = memo(BumpVersionNodeImpl);
