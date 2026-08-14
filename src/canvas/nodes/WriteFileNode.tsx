import { memo } from "react";
import { type NodeProps } from "@xyflow/react";
import { useWorkflowStore } from "@/store/workflowStore";
import { CodeArea, NodeShell, TextField, Toggle } from "./NodeShell";
import type { WriteFileNodeType } from "@/types/workflow";

function WriteFileNodeImpl({ id, data, selected }: NodeProps<WriteFileNodeType>) {
  const updateNodeData = useWorkflowStore((s) => s.updateNodeData);
  const beginEdit = useWorkflowStore((s) => s.beginEdit);

  return (
    <NodeShell
      id={id}
      kind="write_file"
      label={data.label}
      frameId={data.frameId}
      selected={!!selected}
      workingDir={data.workingDir}
      onRename={(label) => updateNodeData(id, { label })}
    >
      <TextField
        label="Path"
        value={data.path}
        placeholder="file.txt"
        onCommit={beginEdit}
        onChange={(path) => updateNodeData(id, { path })}
      />
      <CodeArea
        value={data.content}
        rows={3}
        placeholder="Content..."
        onCommit={beginEdit}
        onChange={(content) => updateNodeData(id, { content })}
      />
      <Toggle
        checked={data.continueOnError}
        onChange={(continueOnError) => {
          beginEdit();
          updateNodeData(id, { continueOnError });
        }}
      >
        Continue on error
      </Toggle>
    </NodeShell>
  );
}

export const WriteFileNode = memo(WriteFileNodeImpl);
