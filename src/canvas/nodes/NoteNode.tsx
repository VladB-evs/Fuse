import { memo } from "react";
import { type NodeProps } from "@xyflow/react";
import { useWorkflowStore } from "@/store/workflowStore";
import { NodeShell, CodeArea } from "./NodeShell";
import type { NoteNodeType } from "@/types/workflow";

function NoteNodeImpl({ id, data, selected }: NodeProps<NoteNodeType>) {
  const updateNodeData = useWorkflowStore((s) => s.updateNodeData);
  const beginEdit = useWorkflowStore((s) => s.beginEdit);

  return (
    <NodeShell
      id={id}
      kind="note"
      label={data.label || "Note"}
      frameId={data.frameId}
      selected={!!selected}
      workingDir={null}
      onRename={(label) => updateNodeData(id, { label })}
    >
      <CodeArea
        value={data.text}
        rows={4}
        placeholder="Type some markdown notes here..."
        onCommit={beginEdit}
        onChange={(text) => updateNodeData(id, { text })}
      />
    </NodeShell>
  );
}

export const NoteNode = memo(NoteNodeImpl);
