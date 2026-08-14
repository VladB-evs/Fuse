import { memo } from "react";
import { type NodeProps } from "@xyflow/react";
import { useWorkflowStore } from "@/store/workflowStore";
import { Choices, CodeArea, NodeShell, Note, TextField, Toggle } from "./NodeShell";
import type { ScriptNodeType } from "@/types/workflow";

/** The interpreters worth one click; anything else can be typed. */
const COMMON = ["bash", "zsh", "sh", "python3", "node", "ruby", "custom…"];

/**
 * A real script, not a shell one-liner.
 *
 * Fuse writes the body to a temp file and hands it to the interpreter through
 * the login shell, so `python3` and `node` resolve through the same PATH and
 * version manager they would in a terminal.
 */
function ScriptNodeImpl({ id, data, selected }: NodeProps<ScriptNodeType>) {
  const updateNodeData = useWorkflowStore((s) => s.updateNodeData);
  const beginEdit = useWorkflowStore((s) => s.beginEdit);

  const known = COMMON.slice(0, -1).includes(data.interpreter);
  const lines = data.script ? data.script.split("\n").length : 0;

  return (
    <NodeShell
      id={id}
      kind="script"
      label={data.label}
      frameId={data.frameId}
      selected={!!selected}
      workingDir={data.workingDir}
      onRename={(label) => updateNodeData(id, { label })}
    >
      <Choices
        label="Run with"
        value={known ? data.interpreter : "custom…"}
        options={COMMON}
        onChange={(choice) => {
          beginEdit();
          updateNodeData(id, { interpreter: choice === "custom…" ? "" : choice });
        }}
      />

      {!known && (
        <TextField
          label="Command"
          value={data.interpreter}
          placeholder="/usr/bin/env -S deno run"
          onCommit={beginEdit}
          onChange={(interpreter) => updateNodeData(id, { interpreter })}
        />
      )}

      <CodeArea
        value={data.script}
        rows={6}
        placeholder={"#!/usr/bin/env bash\nset -euo pipefail\n…"}
        onCommit={beginEdit}
        onChange={(script) => updateNodeData(id, { script })}
      />

      <Toggle
        checked={data.continueOnError}
        onChange={(continueOnError) => {
          beginEdit();
          updateNodeData(id, { continueOnError });
        }}
      >
        Carry on if this fails
      </Toggle>

      <Note>
        {lines === 0 ? "Empty — this step will be skipped" : `${lines} line${lines === 1 ? "" : "s"}`}
      </Note>
    </NodeShell>
  );
}

export const ScriptNode = memo(ScriptNodeImpl);
