import { memo, useMemo, useState } from "react";
import { type NodeProps } from "@xyflow/react";
import {
  AlignLeft,
  ArrowUpRight,
  Check,
  Copy,
  HelpCircle,
  Rows,
  Terminal,
} from "lucide-react";
import { useWorkflowStore } from "@/store/workflowStore";
import { useUIStore } from "@/store/uiStore";
import { NodeShell, fieldKeys } from "./NodeShell";
import { cn } from "@/lib/utils";
import type { CaptureNodeType } from "@/types/workflow";

const VALID_NAME = /^[A-Za-z_][A-Za-z0-9_]*$/;

/**
 * Modern, supercharged Capture Node.
 *
 * Runs a command and saves its stdout into a named workflow variable
 * for downstream steps to consume via {{VARIABLE}} or $VARIABLE.
 */
function CaptureNodeImpl({ id, data, selected }: NodeProps<CaptureNodeType>) {
  const updateNodeData = useWorkflowStore((s) => s.updateNodeData);
  const beginEdit = useWorkflowStore((s) => s.beginEdit);
  const nodes = useWorkflowStore((s) => s.nodes);
  const edges = useWorkflowStore((s) => s.edges);
  const notify = useUIStore((s) => s.notify);

  const [copied, setCopied] = useState(false);

  const rawName = data.variable ?? "";
  const name = rawName.trim();
  const command = data.command ?? "";
  const firstLineOnly = data.firstLineOnly ?? true;
  const continueOnError = Boolean(data.continueOnError);

  // Validation
  const problem =
    name === ""
      ? "Name the variable so later steps can use it"
      : !VALID_NAME.test(name)
        ? "Letters, digits and underscores only"
        : null;

  // Downstream steps connected to this Capture block
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
      kind="capture"
      label={data.label || "Capture Output"}
      frameId={data.frameId}
      selected={!!selected}
      workingDir={data.workingDir}
      width={340}
      onRename={(label) => updateNodeData(id, { label })}
    >
      {/* 1. Command Header & Output Mode Toggle */}
      <div className="space-y-1">
        <div className="flex items-center justify-between">
          <label className="flex items-center gap-1 text-[10.5px] font-semibold text-fg-subtle">
            <Terminal size={11} className="text-accent" />
            <span>COMMAND TO RUN</span>
          </label>

          {/* Mode Switcher: 1st line vs Full Output */}
          <div className="nodrag flex shrink-0 items-center gap-0.5 rounded-[5px] border border-line bg-elevated/70 p-0.5">
            <button
              type="button"
              onClick={() => {
                beginEdit();
                updateNodeData(id, { firstLineOnly: true });
              }}
              className={cn(
                "flex items-center gap-1 rounded-[3px] px-1.5 py-0.5 font-mono text-[9px] font-semibold transition cursor-pointer",
                firstLineOnly
                  ? "bg-accent text-white shadow-xs"
                  : "text-fg-subtle hover:bg-hover hover:text-fg",
              )}
              title="Only keep the first line (ideal for hashes, tags, IDs)"
            >
              <AlignLeft size={10} />
              <span>1st Line</span>
            </button>

            <button
              type="button"
              onClick={() => {
                beginEdit();
                updateNodeData(id, { firstLineOnly: false });
              }}
              className={cn(
                "flex items-center gap-1 rounded-[3px] px-1.5 py-0.5 font-mono text-[9px] font-semibold transition cursor-pointer",
                !firstLineOnly
                  ? "bg-accent text-white shadow-xs"
                  : "text-fg-subtle hover:bg-hover hover:text-fg",
              )}
              title="Capture the entire command output"
            >
              <Rows size={10} />
              <span>Full</span>
            </button>
          </div>
        </div>

        {/* Command Textarea */}
        <textarea
          rows={2}
          value={command}
          spellCheck={false}
          onFocus={beginEdit}
          placeholder="e.g. git rev-parse --short HEAD"
          onChange={(e) => updateNodeData(id, { command: e.currentTarget.value })}
          onKeyDown={(e) => fieldKeys(e, true)}
          className="nodrag w-full resize-none rounded-[5px] border border-line bg-elevated/50 p-2 font-mono text-[11.5px] leading-[17px] text-fg placeholder:text-fg-subtle/50 outline-none transition focus:border-accent"
        />
      </div>

      {/* 2. Target Variable Name & 1-Click Copy */}
      <div className="border-t border-line/60 pt-2 space-y-1.5">
        <div className="space-y-0.5">
          <span className={cn("text-[10px] font-semibold", problem ? "text-danger" : "text-fg-subtle")}>
            STORE OUTPUT IN VARIABLE
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
              placeholder="e.g. COMMIT_SHA"
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

      {/* 3. Options & Downstream Info */}
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

        {downstreamNodes.length > 0 && (
          <span
            title={`Provides {{${name || "OUTPUT"}}} to ${downstreamNodes.length} connected downstream steps`}
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

export const CaptureNode = memo(CaptureNodeImpl);
