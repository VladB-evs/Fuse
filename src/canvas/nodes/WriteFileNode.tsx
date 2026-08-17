import { memo } from "react";
import { type NodeProps } from "@xyflow/react";
import {
  FileCode,
  FilePenLine,
  FilePlus2,
  FileSpreadsheet,
  MessageSquareShare,
  Replace,
} from "lucide-react";
import { useWorkflowStore } from "@/store/workflowStore";
import { useAvailableVariables } from "@/lib/useAvailableVariables";
import { NodeShell, fieldKeys } from "./NodeShell";
import { cn } from "@/lib/utils";
import type { WriteFileNodeType } from "@/types/workflow";

type WriteMode = "overwrite" | "append" | "ask" | "auto_rename";

/**
 * Modern, robust Write File Node.
 *
 * Writes formatted text, configuration, or variables into a local file.
 * Features customizable collision modes:
 * - Overwrite (replace file)
 * - Append (add to end of file)
 * - Ask (pause and prompt user for a new name if file exists)
 * - Auto-rename (automatically save as file_1.ext, file_2.ext)
 */
function WriteFileNodeImpl({ id, data, selected }: NodeProps<WriteFileNodeType>) {
  const updateNodeData = useWorkflowStore((s) => s.updateNodeData);
  const beginEdit = useWorkflowStore((s) => s.beginEdit);
  const availableVars = useAvailableVariables();

  const path = data.path ?? "";
  const content = data.content ?? "";
  const writeMode: WriteMode = data.writeMode ?? "overwrite";
  const continueOnError = Boolean(data.continueOnError);

  const handleInsertVar = (varName: string) => {
    beginEdit();
    const tag = `{{${varName}}}`;
    const nextContent = content ? `${content} ${tag}` : tag;
    updateNodeData(id, { content: nextContent });
  };

  const handleModeChange = (mode: WriteMode) => {
    beginEdit();
    updateNodeData(id, { writeMode: mode });
  };

  return (
    <NodeShell
      id={id}
      kind="write_file"
      label={data.label || "Write File"}
      frameId={data.frameId}
      selected={!!selected}
      workingDir={data.workingDir}
      width={340}
      onRename={(label) => updateNodeData(id, { label })}
    >
      {/* 1. File Path Input */}
      <div className="space-y-1">
        <label className="flex items-center gap-1 text-[10.5px] font-semibold text-fg-subtle">
          <FilePenLine size={11} className="text-accent" />
          <span>TARGET FILE PATH</span>
        </label>
        <div className="nodrag flex items-center gap-1.5 rounded-[5px] border border-line bg-elevated/50 px-2 py-1.5 focus-within:border-accent transition">
          <FileCode size={13} className="text-fg-subtle shrink-0" />
          <input
            type="text"
            value={path}
            spellCheck={false}
            placeholder="e.g. dist/output.txt or .env"
            onFocus={beginEdit}
            onChange={(e) => updateNodeData(id, { path: e.currentTarget.value })}
            onKeyDown={(e) => fieldKeys(e)}
            className="nodrag min-w-0 flex-1 bg-transparent font-mono text-[11.5px] text-fg placeholder:text-fg-subtle/50 outline-none"
          />
        </div>
      </div>

      {/* 2. Write Collision Mode Switcher */}
      <div className="border-t border-line/60 pt-2 space-y-1">
        <div className="flex items-center justify-between">
          <span className="text-[10px] font-semibold text-fg-subtle">
            IF FILE ALREADY EXISTS
          </span>
        </div>

        {/* 4-Way Segmented Mode Switcher */}
        <div className="nodrag grid grid-cols-4 gap-1 rounded-[5px] border border-line bg-elevated/70 p-0.5">
          <button
            type="button"
            onClick={() => handleModeChange("overwrite")}
            className={cn(
              "flex items-center justify-center gap-1 rounded-[4px] py-1 text-[9px] font-semibold transition cursor-pointer",
              writeMode === "overwrite"
                ? "bg-accent text-white shadow-xs"
                : "text-fg-subtle hover:bg-hover hover:text-fg",
            )}
            title="Replace existing file contents"
          >
            <Replace size={10} />
            <span>Overwrite</span>
          </button>

          <button
            type="button"
            onClick={() => handleModeChange("append")}
            className={cn(
              "flex items-center justify-center gap-1 rounded-[4px] py-1 text-[9px] font-semibold transition cursor-pointer",
              writeMode === "append"
                ? "bg-accent text-white shadow-xs"
                : "text-fg-subtle hover:bg-hover hover:text-fg",
            )}
            title="Append to the end of existing file without overwriting"
          >
            <FilePlus2 size={10} />
            <span>Append</span>
          </button>

          <button
            type="button"
            onClick={() => handleModeChange("ask")}
            className={cn(
              "flex items-center justify-center gap-1 rounded-[4px] py-1 text-[9px] font-semibold transition cursor-pointer",
              writeMode === "ask"
                ? "bg-amber-600 text-white shadow-xs"
                : "text-fg-subtle hover:bg-hover hover:text-fg",
            )}
            title="Pause run and ask operator for a new file name"
          >
            <MessageSquareShare size={10} />
            <span>Ask name</span>
          </button>

          <button
            type="button"
            onClick={() => handleModeChange("auto_rename")}
            className={cn(
              "flex items-center justify-center gap-1 rounded-[4px] py-1 text-[9px] font-semibold transition cursor-pointer",
              writeMode === "auto_rename"
                ? "bg-accent text-white shadow-xs"
                : "text-fg-subtle hover:bg-hover hover:text-fg",
            )}
            title="Automatically save with numbering suffix (_1, _2...)"
          >
            <FileSpreadsheet size={10} />
            <span>Auto-1,2</span>
          </button>
        </div>
      </div>

      {/* 3. Content Area with Upstream Variable Insertion Bar */}
      <div className="border-t border-line/60 pt-2 space-y-1.5">
        <div className="flex items-center justify-between">
          <span className="text-[10px] font-semibold text-fg-subtle">
            FILE CONTENT
          </span>
          <span className="font-mono text-[9px] text-fg-subtle/70">
            Supports {`{{VAR}}`}
          </span>
        </div>

        <textarea
          rows={3}
          value={content}
          spellCheck={false}
          onFocus={beginEdit}
          placeholder="Write content or insert template variables below…"
          onChange={(e) => updateNodeData(id, { content: e.currentTarget.value })}
          onKeyDown={(e) => fieldKeys(e, true)}
          className="nodrag w-full resize-none rounded-[5px] border border-line bg-elevated/50 p-2 font-mono text-[11px] leading-[16px] text-fg placeholder:text-fg-subtle/50 outline-none transition focus:border-accent"
        />

        {/* Upstream Variable Insertion Chips */}
        {availableVars.length > 0 && (
          <div className="nodrag flex items-center gap-1 overflow-x-auto py-0.5">
            <span className="text-[9px] font-mono text-fg-subtle shrink-0">Insert:</span>
            {availableVars.slice(0, 6).map((v) => (
              <button
                key={v.name}
                type="button"
                onClick={() => handleInsertVar(v.name)}
                title={`Insert {{${v.name}}}`}
                className="nodrag shrink-0 rounded bg-elevated/80 px-1.5 py-0.5 text-[9px] font-mono text-accent hover:bg-accent hover:text-white transition cursor-pointer border border-accent/20"
              >
                +{v.name}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* 4. Options */}
      <div className="border-t border-line/60 pt-1.5 flex items-center justify-between text-[10.5px]">
        <label className="nodrag flex cursor-pointer items-center gap-1.5 text-fg-subtle hover:text-fg transition">
          <input
            type="checkbox"
            checked={continueOnError}
            onChange={(e) => {
              beginEdit();
              updateNodeData(id, { continueOnError: e.currentTarget.checked });
            }}
            className="rounded border-line accent-accent"
          />
          <span>Carry on if fails</span>
        </label>
      </div>
    </NodeShell>
  );
}

export const WriteFileNode = memo(WriteFileNodeImpl);
