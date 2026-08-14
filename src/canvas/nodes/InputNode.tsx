import { memo } from "react";
import { type NodeProps } from "@xyflow/react";
import { useWorkflowStore } from "@/store/workflowStore";
import { CodeArea, NodeShell, Note, TextField, Toggle } from "./NodeShell";
import type { InputNodeType } from "@/types/workflow";

/** Only names a shell will let us export can be used as variables. */
const VALID_NAME = /^[A-Za-z_][A-Za-z0-9_]*$/;

/**
 * Asks for a value part-way through a run.
 *
 * Unlike the `{{placeholder}}`s collected before a run starts, this one is
 * asked at the moment it is reached — so the answer can depend on what the
 * earlier steps printed.
 */
function InputNodeImpl({ id, data, selected }: NodeProps<InputNodeType>) {
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
      kind="input"
      label={data.label}
      frameId={data.frameId}
      selected={!!selected}
      onRename={(label) => updateNodeData(id, { label })}
    >
      <CodeArea
        value={data.message}
        rows={2}
        placeholder="What are you asking for?"
        onCommit={beginEdit}
        onChange={(message) => updateNodeData(id, { message })}
      />

      <div className="space-y-1.5 border-t border-line/60 pt-2">
        <TextField
          label="Name"
          value={data.variable}
          placeholder="VERSION"
          invalid={!!problem}
          onCommit={beginEdit}
          onChange={(variable) => updateNodeData(id, { variable })}
        />

        <TextField
          label="Default"
          value={data.defaultValue}
          placeholder="Optional"
          onCommit={beginEdit}
          onChange={(defaultValue) => updateNodeData(id, { defaultValue })}
        />

        <Toggle
          checked={data.secret}
          onChange={(secret) => {
            beginEdit();
            updateNodeData(id, { secret });
          }}
        >
          Hide while typing, and keep it out of the log
        </Toggle>

        {problem ? (
          <Note tone="warn">{problem}</Note>
        ) : (
          <Note>
            Later steps: {`{{${name}}}`} or ${name}
          </Note>
        )}
      </div>
    </NodeShell>
  );
}

export const InputNode = memo(InputNodeImpl);
