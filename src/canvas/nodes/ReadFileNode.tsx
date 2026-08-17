import { memo, useMemo, useState } from "react";
import { type NodeProps } from "@xyflow/react";
import {
  AlertCircle,
  ArrowUpRight,
  Check,
  Copy,
  FileCode,
  FileText,
  HelpCircle,
} from "lucide-react";
import { useWorkflowStore } from "@/store/workflowStore";
import { useUIStore } from "@/store/uiStore";
import { NodeShell, fieldKeys } from "./NodeShell";
import { cn } from "@/lib/utils";
import type { ReadFileNodeType } from "@/types/workflow";

const VALID_NAME = /^[A-Za-z_][A-Za-z0-9_]*$/;

/**
 * Modern, robust Read File Node.
 *
 * Reads a text or JSON file from the filesystem and injects its contents
 * into a workflow variable ({{FILE_CONTENT}}) for later steps to use.
 * Gracefully handles missing files with fallback value or error handling.
 */
function ReadFileNodeImpl({ id, data, selected }: NodeProps<ReadFileNodeType>) {
  const updateNodeData = useWorkflowStore((s) => s.updateNodeData);
  const beginEdit = useWorkflowStore((s) => s.beginEdit);
  const nodes = useWorkflowStore((s) => s.nodes);
  const edges = useWorkflowStore((s) => s.edges);
  const notify = useUIStore((s) => s.notify);

  const [copied, setCopied] = useState(false);

  const path = data.path ?? "";
  const rawName = data.variable ?? "";
  const name = rawName.trim();
  const fallback = data.fallback ?? "";
  const continueOnError = Boolean(data.continueOnError);

  // Validation
  const problem =
    name === ""
      ? "Set a variable name (e.g. PKG_JSON)"
      : !VALID_NAME.test(name)
        ? "Letters, digits and underscores only"
        : null;

  // Downstream consumers
  const outgoingEdges = useMemo(() => edges.filter((e) => e.source === id), [edges, id]);
  const downstreamNodes = useMemo(
    () =>
      outgoingEdges
        .map((e) => nodes.find((n) => n.id === e.target))
        .filter((n): n is NonNullable<typeof n> => !!n),
    [outgoingEdges, nodes],
  );

  const handleCopyVar = async (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!name) return;
    const tag = `{{${name}}}`;
    try {
      await navigator.clipboard.writeText(tag);
      setCopied(true);
      notify(`Copied ${tag} to clipboard`);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      notify("Failed to copy variable", "error");
    }
  };

  const handleVariableChange = (val: string) => {
    const sanitized = val.replace(/\s+/g, "_");
    beginEdit();
    updateNodeData(id, { variable: sanitized });
  };

  return (
    <NodeShell
      id={id}
      kind="read_file"
      label={data.label || "Read File"}
      frameId={data.frameId}
      selected={!!selected}
      workingDir={data.workingDir}
      width={340}
      onRename={(label) => updateNodeData(id, { label })}
    >
      {/* 1. File Path Input */}
      <div className="space-y-1">
        <label className="flex items-center gap-1 text-[10.5px] font-semibold text-fg-subtle">
          <FileText size={11} className="text-accent" />
          <span>FILE PATH TO READ</span>
        </label>
        <div className="nodrag flex items-center gap-1.5 rounded-[5px] border border-line bg-elevated/50 px-2 py-1.5 focus-within:border-accent transition">
          <FileCode size={13} className="text-fg-subtle shrink-0" />
          <input
            type="text"
            value={path}
            spellCheck={false}
            placeholder="e.g. package.json or config/.env"
            onFocus={beginEdit}
            onChange={(e) => updateNodeData(id, { path: e.currentTarget.value })}
            onKeyDown={(e) => fieldKeys(e)}
            className="nodrag min-w-0 flex-1 bg-transparent font-mono text-[11.5px] text-fg placeholder:text-fg-subtle/50 outline-none"
          />
        </div>
      </div>

      {/* 2. Target Variable Name & 1-Click Copy */}
      <div className="border-t border-line/60 pt-2 space-y-1.5">
        <div className="space-y-0.5">
          <span className={cn("text-[10px] font-semibold", problem ? "text-danger" : "text-fg-subtle")}>
            STORE CONTENT IN VARIABLE
          </span>

          <div
            className={cn(
              "nodrag flex items-center rounded-[5px] border bg-base/90 px-2 py-1 transition",
              problem ? "border-danger/70 bg-danger/5" : "border-line focus-within:border-accent",
            )}
          >
            <input
              type="text"
              value={rawName}
              spellCheck={false}
              placeholder="e.g. FILE_CONTENT"
              onFocus={beginEdit}
              onChange={(e) => handleVariableChange(e.currentTarget.value)}
              onKeyDown={(e) => fieldKeys(e)}
              className="nodrag min-w-0 flex-1 bg-transparent font-mono text-[11px] font-bold text-accent placeholder:text-accent/30 outline-none"
            />
          </div>
        </div>

        {/* Validation or Usage Pill */}
        {problem ? (
          <div className="flex items-center gap-1 rounded bg-danger/10 px-2 py-1 text-[10px] font-medium text-danger">
            <HelpCircle size={11} />
            <span>{problem}</span>
          </div>
        ) : (
          <div className="flex items-center justify-between rounded-[5px] border border-accent/25 bg-accent/5 px-2 py-1 text-[10.5px]">
            <div className="flex items-center gap-1.5 min-w-0">
              <span className="text-[9.5px] font-medium text-fg-subtle">Use in steps:</span>
              <code className="truncate font-mono font-bold text-accent">
                {`{{${name}}}`}
              </code>
            </div>

            <button
              type="button"
              onClick={handleCopyVar}
              className="nodrag flex items-center gap-1 rounded px-1.5 py-0.5 font-mono text-[9.5px] font-semibold text-accent hover:bg-accent/15 transition cursor-pointer"
              title="Copy {{VARIABLE}} to paste in commands"
            >
              {copied ? <Check size={10} className="text-success" /> : <Copy size={10} />}
              <span>{copied ? "Copied" : "Copy"}</span>
            </button>
          </div>
        )}
      </div>

      {/* 3. Edge Case Handling: Fallback Value if Missing */}
      <div className="border-t border-line/60 pt-2 space-y-1">
        <div className="flex items-center justify-between">
          <label className="flex items-center gap-1 text-[10px] font-semibold text-fg-subtle">
            <AlertCircle size={10} className="text-amber-400" />
            <span>IF FILE DOES NOT EXIST (FALLBACK)</span>
          </label>
        </div>
        <div className="nodrag flex items-center rounded-[5px] border border-line bg-elevated/40 px-2 py-1 focus-within:border-accent transition">
          <input
            type="text"
            value={fallback}
            spellCheck={false}
            placeholder="Optional fallback value (e.g. default content or {})"
            onFocus={beginEdit}
            onChange={(e) => updateNodeData(id, { fallback: e.currentTarget.value })}
            onKeyDown={(e) => fieldKeys(e)}
            className="nodrag min-w-0 flex-1 bg-transparent font-mono text-[11px] text-fg placeholder:text-fg-subtle/40 outline-none"
          />
        </div>
      </div>

      {/* 4. Options & Downstream Status */}
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
          <span>Carry on if missing / fails</span>
        </label>

        {downstreamNodes.length > 0 && (
          <span
            title={`Provides {{${name || "CONTENT"}}} to ${downstreamNodes.length} connected downstream steps`}
            className="flex items-center gap-0.5 font-mono text-[9.5px] text-accent/80"
          >
            <ArrowUpRight size={10} />
            <span>feeds {downstreamNodes.length} {downstreamNodes.length === 1 ? "step" : "steps"}</span>
          </span>
        )}
      </div>
    </NodeShell>
  );
}

export const ReadFileNode = memo(ReadFileNodeImpl);
