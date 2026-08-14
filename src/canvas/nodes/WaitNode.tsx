import { memo } from "react";
import { type NodeProps } from "@xyflow/react";
import { useWorkflowStore } from "@/store/workflowStore";
import { CodeArea, NodeShell, Note, TextField } from "./NodeShell";
import type { WaitNodeType } from "@/types/workflow";

/**
 * A pause, or a wait for something to come up.
 *
 * The polling half is the useful one: start a dev server in one block, wait
 * until it answers in the next, and the steps after it can assume it is there.
 */
function WaitNodeImpl({ id, data, selected }: NodeProps<WaitNodeType>) {
  const updateNodeData = useWorkflowStore((s) => s.updateNodeData);
  const beginEdit = useWorkflowStore((s) => s.beginEdit);

  const polling = data.until.trim().length > 0;

  const number = (value: string, fallback: number) => {
    const parsed = Number.parseFloat(value);
    return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
  };

  return (
    <NodeShell
      id={id}
      kind="wait"
      label={data.label}
      frameId={data.frameId}
      selected={!!selected}
      workingDir={data.workingDir}
      onRename={(label) => updateNodeData(id, { label })}
    >
      <TextField
        label="Wait"
        value={String(data.seconds)}
        placeholder="2"
        onCommit={beginEdit}
        onChange={(value) => updateNodeData(id, { seconds: number(value, 0) })}
      />

      <CodeArea
        value={data.until}
        rows={2}
        placeholder="curl -fsS http://localhost:3000/health"
        onCommit={beginEdit}
        onChange={(until) => updateNodeData(id, { until })}
      />

      {polling && (
        <div className="flex gap-1.5">
          <TextField
            label="Every"
            width={38}
            value={String(data.intervalSeconds)}
            onCommit={beginEdit}
            onChange={(value) => updateNodeData(id, { intervalSeconds: number(value, 1) })}
          />
          <TextField
            label="Up to"
            width={38}
            value={String(data.timeoutSeconds)}
            onCommit={beginEdit}
            onChange={(value) => updateNodeData(id, { timeoutSeconds: number(value, 60) })}
          />
        </div>
      )}

      <Note>
        {polling
          ? `Retries every ${data.intervalSeconds}s, gives up after ${data.timeoutSeconds}s`
          : "Add a command above to wait until it succeeds"}
      </Note>
    </NodeShell>
  );
}

export const WaitNode = memo(WaitNodeImpl);
