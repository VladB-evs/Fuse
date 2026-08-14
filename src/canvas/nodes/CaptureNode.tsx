import { memo } from "react";
import { type NodeProps } from "@xyflow/react";
import { useWorkflowStore } from "@/store/workflowStore";
import { CodeArea, NodeShell, Note, TextField, Toggle } from "./NodeShell";
import type { CaptureNodeType } from "@/types/workflow";

const VALID_NAME = /^[A-Za-z_][A-Za-z0-9_]*$/;

/**
 * Turns a command's output into a value.
 *
 * This is how a workflow gets facts about itself — the current SHA, a version
 * from a file, the name of the branch — without a person retyping them.
 */
function CaptureNodeImpl({ id, data, selected }: NodeProps<CaptureNodeType>) {
  const updateNodeData = useWorkflowStore((s) => s.updateNodeData);
  const beginEdit = useWorkflowStore((s) => s.beginEdit);

  const name = data.variable.trim();
  const problem =
    name === ""
      ? "Name the value so later steps can use it"
      : !VALID_NAME.test(name)
        ? "Letters, digits and underscores only"
        : null;

  return (
    <NodeShell
      id={id}
      kind="capture"
      label={data.label}
      frameId={data.frameId}
      selected={!!selected}
      workingDir={data.workingDir}
      onRename={(label) => updateNodeData(id, { label })}
    >
      <CodeArea
        value={data.command}
        rows={2}
        placeholder="git rev-parse --short HEAD"
        onCommit={beginEdit}
        onChange={(command) => updateNodeData(id, { command })}
      />

      <TextField
        label="Keep as"
        value={data.variable}
        placeholder="SHA"
        invalid={!!problem}
        onCommit={beginEdit}
        onChange={(variable) => updateNodeData(id, { variable })}
      />

      <Toggle
        checked={data.firstLineOnly}
        onChange={(firstLineOnly) => {
          beginEdit();
          updateNodeData(id, { firstLineOnly });
        }}
      >
        First line only
      </Toggle>

      <Toggle
        checked={data.continueOnError}
        onChange={(continueOnError) => {
          beginEdit();
          updateNodeData(id, { continueOnError });
        }}
      >
        Carry on if this fails
      </Toggle>

      {problem ? (
        <Note tone="warn">{problem}</Note>
      ) : (
        <Note>
          Later steps: {`{{${name}}}`} or ${name}
        </Note>
      )}
    </NodeShell>
  );
}

export const CaptureNode = memo(CaptureNodeImpl);
