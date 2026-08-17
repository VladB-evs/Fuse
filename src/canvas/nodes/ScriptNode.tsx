import { memo, useMemo } from "react";
import { type NodeProps } from "@xyflow/react";
import { Maximize2 } from "lucide-react";
import { useWorkflowStore } from "@/store/workflowStore";
import { useUIStore } from "@/store/uiStore";
import { Choices, NodeShell, TextField, Toggle } from "./NodeShell";
import { getPrismLanguage, highlightCode } from "@/lib/syntaxHighlight";
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
  const openScriptEditor = useUIStore((s) => s.openScriptEditor);

  const known = COMMON.slice(0, -1).includes(data.interpreter);
  const lines = data.script ? data.script.split("\n").length : 0;
  const prismLang = useMemo(() => getPrismLanguage(data.interpreter), [data.interpreter]);
  const highlighted = useMemo(() => highlightCode(data.script || "", prismLang), [data.script, prismLang]);

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

      {/* Read-Only Scrollable Code Preview Box with Expand Trigger */}
      <div className="group/code relative rounded-[5px] border border-line bg-elevated/40 overflow-hidden">
        <div className="flex items-center justify-between border-b border-line/60 bg-elevated/70 px-2 py-1">
          <span className="text-[10px] font-mono text-fg-subtle">
            {prismLang} · {lines === 0 ? "empty" : `${lines} line${lines === 1 ? "" : "s"}`}
          </span>
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              openScriptEditor(id);
            }}
            className="nodrag flex items-center gap-1 rounded-[4px] px-1.5 py-0.5 text-[10px] font-medium text-accent hover:bg-hover hover:text-fg cursor-pointer transition"
            title="Open floating script editor"
          >
            <Maximize2 size={10} />
            <span>Expand editor</span>
          </button>
        </div>

        <div
          onClick={(e) => {
            e.stopPropagation();
            openScriptEditor(id);
          }}
          className="nodrag nowheel min-h-[96px] max-h-[170px] overflow-auto p-2 cursor-pointer transition hover:bg-elevated/70 select-none"
          title="Click to open full script editor"
        >
          {data.script?.trim() ? (
            <pre
              aria-hidden="true"
              className="m-0 whitespace-pre font-mono text-[11px] leading-[16px] text-fg"
              style={{ tabSize: 2 }}
            >
              <code
                className={`language-${prismLang}`}
                dangerouslySetInnerHTML={{ __html: highlighted }}
              />
            </pre>
          ) : (
            <div className="flex h-[80px] items-center justify-center text-center text-[10.5px] font-mono text-fg-subtle/60 italic">
              Empty script — click to write code…
            </div>
          )}
        </div>
      </div>

      <Toggle
        checked={data.continueOnError}
        onChange={(continueOnError) => {
          beginEdit();
          updateNodeData(id, { continueOnError });
        }}
      >
        Carry on if this fails
      </Toggle>
    </NodeShell>
  );
}

export const ScriptNode = memo(ScriptNodeImpl);
