import { memo } from "react";
import { Handle, Position, type NodeProps } from "@xyflow/react";
import { ArrowDown, ArrowRight, CheckCircle2, XCircle } from "lucide-react";
import { useWorkflowStore } from "@/store/workflowStore";
import { NodeShell, Note, fieldKeys } from "./NodeShell";
import { FALSE_PORT, TARGET_PORT, TRUE_PORT } from "@/canvas/ports";
import { cn } from "@/lib/utils";
import type { ConditionNodeType } from "@/types/workflow";

const CONDITION_PRESETS = [
  { label: "+ File", snippet: 'test -f "dist/index.js"' },
  { label: "+ Dir", snippet: 'test -d "node_modules"' },
  { label: "+ Equals", snippet: '[ "$STATUS" = "ready" ]' },
  { label: "+ Non-empty", snippet: '[ -n "$TOKEN" ]' },
];

/**
 * A fork the machine decides.
 *
 * Evaluates a shell expression:
 * - Exit code 0 (success) -> follows the TRUE branch (Bottom port ↓).
 * - Exit code non-0 (failure) -> follows the FALSE branch (Right port →).
 */
function ConditionNodeImpl({ id, data, selected }: NodeProps<ConditionNodeType>) {
  const updateNodeData = useWorkflowStore((s) => s.updateNodeData);
  const beginEdit = useWorkflowStore((s) => s.beginEdit);

  const setPreset = (snippet: string) => {
    beginEdit();
    updateNodeData(id, { test: snippet });
  };

  return (
    <NodeShell
      id={id}
      kind="condition"
      label={data.label}
      frameId={data.frameId}
      selected={!!selected}
      workingDir={data.workingDir}
      onRename={(label) => updateNodeData(id, { label })}
      ports={
        <>
          <Handle id={TARGET_PORT} type="source" position={Position.Top} className="fuse-port fuse-port-top" />
          <Handle id="left" type="source" position={Position.Left} className="fuse-port fuse-port-left" />
          <Handle
            id={TRUE_PORT}
            type="source"
            position={Position.Bottom}
            className="fuse-port fuse-port-bottom fuse-port--true"
          />
          <Handle
            id="bottom"
            type="source"
            position={Position.Bottom}
            className="fuse-port fuse-port-bottom fuse-port--true"
          />
          <Handle
            id={FALSE_PORT}
            type="source"
            position={Position.Right}
            className="fuse-port fuse-port-right fuse-port--false"
          />
        </>
      }
    >
      {/* Test Expression Header & Presets */}
      <div>
        <div className="mb-1 flex items-center justify-between">
          <label className="text-[10.5px] font-medium text-fg-subtle">Test expression (shell)</label>
          <div className="nodrag flex items-center gap-1">
            {CONDITION_PRESETS.map((preset) => (
              <button
                key={preset.label}
                type="button"
                onClick={() => setPreset(preset.snippet)}
                className="rounded-[3px] border border-line/70 bg-elevated/50 px-1 py-0.5 font-mono text-[9px] text-fg-subtle transition hover:border-line-strong hover:bg-hover hover:text-fg cursor-pointer"
                title={`Insert ${preset.snippet}`}
              >
                {preset.label}
              </button>
            ))}
          </div>
        </div>

        {/* Code Input */}
        <textarea
          value={data.test}
          rows={2}
          spellCheck={false}
          autoCapitalize="off"
          autoCorrect="off"
          onFocus={beginEdit}
          onChange={(e) => updateNodeData(id, { test: e.currentTarget.value })}
          onKeyDown={(e) => fieldKeys(e, true)}
          placeholder={'e.g. test -f "dist/index.js" or [ -n "$VAR" ]'}
          className={cn(
            "nodrag nowheel w-full resize-none rounded-[5px] border bg-elevated/60 p-2 font-mono text-[11px] leading-[17px] text-fg outline-none transition focus:border-accent",
            data.test?.trim() ? "border-line" : "border-amber-500/30",
          )}
        />
      </div>

      {/* Dual Output Branch Configuration */}
      <div className="grid grid-cols-2 gap-1.5 border-t border-line/60 pt-2">
        {/* TRUE Branch (Exit 0 -> Down) */}
        <div className="flex flex-col gap-1 rounded-[6px] border border-emerald-500/30 bg-emerald-500/8 p-1.5 transition hover:border-emerald-500/50">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-1 text-[10px] font-bold text-emerald-400">
              <CheckCircle2 size={11} className="text-emerald-400" />
              <span>IF TRUE</span>
            </div>
            <span className="flex items-center gap-0.5 rounded bg-emerald-500/20 px-1 py-0.5 text-[8.5px] font-mono font-medium text-emerald-300">
              <ArrowDown size={8} /> Bottom
            </span>
          </div>

          <div className="flex items-center gap-1 mt-0.5">
            <span className="text-[9.5px] text-fg-subtle font-medium">Label:</span>
            <input
              value={data.trueLabel}
              placeholder="Yes"
              spellCheck={false}
              onFocus={beginEdit}
              onChange={(e) => updateNodeData(id, { trueLabel: e.currentTarget.value })}
              onKeyDown={(e) => fieldKeys(e)}
              className="nodrag min-w-0 flex-1 rounded-[4px] border border-emerald-500/30 bg-base/90 px-1.5 py-0.5 font-sans text-[10.5px] text-fg outline-none focus:border-emerald-400"
            />
          </div>
        </div>

        {/* FALSE Branch (Exit non-0 -> Right) */}
        <div className="flex flex-col gap-1 rounded-[6px] border border-amber-500/30 bg-amber-500/8 p-1.5 transition hover:border-amber-500/50">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-1 text-[10px] font-bold text-amber-400">
              <XCircle size={11} className="text-amber-400" />
              <span>IF FALSE</span>
            </div>
            <span className="flex items-center gap-0.5 rounded bg-amber-500/20 px-1 py-0.5 text-[8.5px] font-mono font-medium text-amber-300">
              <ArrowRight size={8} /> Right
            </span>
          </div>

          <div className="flex items-center gap-1 mt-0.5">
            <span className="text-[9.5px] text-fg-subtle font-medium">Label:</span>
            <input
              value={data.falseLabel}
              placeholder="No"
              spellCheck={false}
              onFocus={beginEdit}
              onChange={(e) => updateNodeData(id, { falseLabel: e.currentTarget.value })}
              onKeyDown={(e) => fieldKeys(e)}
              className="nodrag min-w-0 flex-1 rounded-[4px] border border-amber-500/30 bg-base/90 px-1.5 py-0.5 font-sans text-[10.5px] text-fg outline-none focus:border-amber-400"
            />
          </div>
        </div>
      </div>

      <Note tone={data.test?.trim() ? "muted" : "warn"}>
        {data.test?.trim()
          ? "Exit 0 follows down, any non-zero exit follows right."
          : "Add a test — exit 0 is true, anything else is false."}
      </Note>
    </NodeShell>
  );
}

export const ConditionNode = memo(ConditionNodeImpl);
