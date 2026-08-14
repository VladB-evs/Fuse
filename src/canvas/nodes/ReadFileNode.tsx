import { memo } from "react";
import { type NodeProps } from "@xyflow/react";
import { useWorkflowStore } from "@/store/workflowStore";
import { NodeShell, TextField, Toggle } from "./NodeShell";
import type { ReadFileNodeType } from "@/types/workflow";

function ReadFileNodeImpl({ id, data, selected }: NodeProps<ReadFileNodeType>) {
  const updateNodeData = useWorkflowStore((s) => s.updateNodeData);
  const beginEdit = useWorkflowStore((s) => s.beginEdit);

  return (
    <NodeShell
      id={id}
      kind="read_file"
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
      <TextField
        label="Into variable"
        value={data.variable}
        placeholder="content"
        onCommit={beginEdit}
        onChange={(variable) => updateNodeData(id, { variable })}
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

export const ReadFileNode = memo(ReadFileNodeImpl);
