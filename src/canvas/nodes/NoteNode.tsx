import { memo, useMemo, useEffect, useRef, useState } from "react";
import { NodeResizeControl, type NodeProps } from "@xyflow/react";
import {
  Copy,
  Check,
  Zap,
  ArrowUpRight,
} from "lucide-react";
import { useWorkflowStore } from "@/store/workflowStore";
import { useRuntimeStore } from "@/store/runtimeStore";
import { useAvailableVariables } from "@/lib/useAvailableVariables";
import { NodeShell } from "./NodeShell";
import type { NoteNodeType } from "@/types/workflow";
import { cn } from "@/lib/utils";

const VALID_NAME = /^[A-Za-z_][A-Za-z0-9_]*$/;

function stripAnsi(text: string): string {
  // eslint-disable-next-line no-control-regex
  return text.replace(/\x1b\[[0-9;]*[a-zA-Z]/g, "").replace(/\x1b\([a-zA-Z]/g, "");
}

/**
 * Clean, Superpowered Note Block with Multi-Input Capture
 */
function NoteNodeImpl({ id, data, selected }: NodeProps<NoteNodeType>) {
  const updateNodeData = useWorkflowStore((s) => s.updateNodeData);
  const beginEdit = useWorkflowStore((s) => s.beginEdit);
  const nodes = useWorkflowStore((s) => s.nodes);
  const edges = useWorkflowStore((s) => s.edges);

  const outputMap = useRuntimeStore((s) => s.output);
  const availableVars = useAvailableVariables().filter((v) => v.name !== data.variable);

  const incomingEdges = useMemo(() => edges.filter((e) => e.target === id), [edges, id]);
  const outgoingEdges = useMemo(() => edges.filter((e) => e.source === id), [edges, id]);

  const upstreamNodes = useMemo(
    () =>
      incomingEdges
        .map((e) => nodes.find((n) => n.id === e.source))
        .filter((n): n is NonNullable<typeof n> => !!n),
    [incomingEdges, nodes],
  );

  const downstreamNodes = useMemo(
    () =>
      outgoingEdges
        .map((e) => nodes.find((n) => n.id === e.target))
        .filter((n): n is NonNullable<typeof n> => !!n),
    [outgoingEdges, nodes],
  );

  // Combine outputs from ALL upstream nodes plugged into this note and strip terminal escape codes
  const combinedUpstreamText = useMemo(() => {
    const outputs: string[] = [];
    for (const uNode of upstreamNodes) {
      const uOut = outputMap[uNode.id];
      if (uOut && uOut.length > 0) {
        const raw = uOut.map((o) => o.text).join("\n");
        const clean = stripAnsi(raw).trim();
        if (clean) {
          outputs.push(clean);
        }
      }
    }
    return outputs.join("\n\n");
  }, [upstreamNodes, outputMap]);

  const isCapturing = data.capture !== false && (data.capture === true || incomingEdges.length > 0);

  // Auto-sync upstream outputs into note text when Capture is active
  const lastSyncRef = useRef<string>("");
  useEffect(() => {
    if (isCapturing && combinedUpstreamText && combinedUpstreamText !== lastSyncRef.current) {
      lastSyncRef.current = combinedUpstreamText;
      updateNodeData(id, { text: combinedUpstreamText });
    }
  }, [isCapturing, combinedUpstreamText, id, updateNodeData]);

  const [copied, setCopied] = useState(false);

  const autoVarName = useMemo(() => {
    const clean = (data.label || "note").toLowerCase().replace(/[^a-z0-9_]/g, "_").replace(/^_+|_+$/g, "");
    return clean && clean !== "note" ? `note_${clean}` : "note";
  }, [data.label]);

  const effectiveVarName = data.variable?.trim() || autoVarName;

  const handleCopy = () => {
    navigator.clipboard.writeText(data.text || "");
    setCopied(true);
    setTimeout(() => setCopied(false), 1800);
  };

  const handleToggleCapture = () => {
    beginEdit();
    const nextState = !isCapturing;
    if (nextState && combinedUpstreamText) {
      updateNodeData(id, { capture: true, text: combinedUpstreamText });
    } else {
      updateNodeData(id, { capture: nextState });
    }
  };

  const handleInsertVar = (varName: string) => {
    beginEdit();
    const insertion = `{{${varName}}}`;
    const newText = data.text ? `${data.text} ${insertion}` : insertion;
    updateNodeData(id, { text: newText });
  };

  const varName = data.variable?.trim();
  const problem = varName && !VALID_NAME.test(varName) ? "Letters, digits and underscores only" : null;

  const cardWidth = data.width || 340;
  const cardHeight = data.height || 220;

  return (
    <NodeShell
      id={id}
      kind="note"
      label={data.label || "Note"}
      frameId={data.frameId}
      selected={!!selected}
      workingDir={null}
      onRename={(label) => updateNodeData(id, { label })}
      style={{ width: cardWidth, height: cardHeight }}
      className="w-full h-full"
      resizeControl={
        <>
          <NodeResizeControl
            position="top-left"
            minWidth={220}
            minHeight={130}
            className="fuse-corner-resizer fuse-corner-resizer-tl"
            onResize={(_, { width, height }) => {
              updateNodeData(id, { width, height });
            }}
          >
            <div className="fuse-corner-resize-grip fuse-corner-grip-tl" />
          </NodeResizeControl>
          <NodeResizeControl
            position="top-right"
            minWidth={220}
            minHeight={130}
            className="fuse-corner-resizer fuse-corner-resizer-tr"
            onResize={(_, { width, height }) => {
              updateNodeData(id, { width, height });
            }}
          >
            <div className="fuse-corner-resize-grip fuse-corner-grip-tr" />
          </NodeResizeControl>
          <NodeResizeControl
            position="bottom-left"
            minWidth={220}
            minHeight={130}
            className="fuse-corner-resizer fuse-corner-resizer-bl"
            onResize={(_, { width, height }) => {
              updateNodeData(id, { width, height });
            }}
          >
            <div className="fuse-corner-resize-grip fuse-corner-grip-bl" />
          </NodeResizeControl>
          <NodeResizeControl
            position="bottom-right"
            minWidth={220}
            minHeight={130}
            className="fuse-corner-resizer fuse-corner-resizer-br"
            onResize={(_, { width, height }) => {
              updateNodeData(id, { width, height });
            }}
          >
            <div className="fuse-corner-resize-grip fuse-corner-grip-br" />
          </NodeResizeControl>
        </>
      }
    >

      {/* Header bar */}
      <div className="flex shrink-0 items-center justify-between gap-1 pb-1">
        {upstreamNodes.length > 0 ? (
          <button
            type="button"
            onClick={handleToggleCapture}
            title={isCapturing ? "Capturing from connected nodes. Click to detach/stop auto-sync." : "Click to capture and auto-sync output from connected nodes."}
            className={cn(
              "flex items-center gap-1.5 rounded-[4px] px-2 py-0.5 text-[10px] font-semibold transition cursor-pointer border",
              isCapturing
                ? "bg-accent text-white border-accent shadow-xs"
                : "bg-elevated/70 text-fg-subtle hover:text-fg border-line/60 hover:bg-hover",
            )}
          >
            <Zap size={11} className={isCapturing ? "fill-current" : ""} />
            <span>Capture: {isCapturing ? `ON (${upstreamNodes.length})` : "OFF"}</span>
          </button>
        ) : (
          <span className="text-[10px] font-mono text-fg-subtle/70">Text / Notes</span>
        )}

        <button
          type="button"
          onClick={handleCopy}
          title="Copy note text to clipboard"
          className="flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] text-fg-subtle transition hover:bg-hover hover:text-fg cursor-pointer"
        >
          {copied ? <Check size={10} className="text-success" /> : <Copy size={10} />}
          <span>{copied ? "Copied" : "Copy"}</span>
        </button>
      </div>

      {/* Main Text Editor / Captured Content Area */}
      <div className="flex-1 min-h-0 flex flex-col space-y-1">
        <textarea
          value={data.text || ""}
          spellCheck={false}
          placeholder={
            isCapturing
              ? upstreamNodes.length > 0
                ? "Waiting for output from plugged node(s)..."
                : "Plug nodes into this note to capture their output..."
              : "Write text, markdown, or variables ({{git_status}})..."
          }
          onFocus={beginEdit}
          onChange={(e) => updateNodeData(id, { text: e.currentTarget.value })}
          onWheel={(e) => e.stopPropagation()}
          className={cn(
            "nodrag nowheel w-full flex-1 resize-none rounded-[6px] border border-line bg-elevated/30",
            "p-2.5 font-mono text-[11px] leading-[16px] text-fg placeholder:text-fg-subtle/50 outline-none focus:border-accent/70 select-text overflow-y-auto",
            isCapturing && "border-accent/30 bg-accent/[0.03]",
          )}
        />

        {availableVars.length > 0 && !isCapturing && (
          <div
            className="nowheel nodrag flex shrink-0 items-center gap-1 overflow-x-auto py-0.5"
            onWheel={(e) => e.stopPropagation()}
          >
            <span className="text-[9px] font-mono text-fg-subtle shrink-0">Vars:</span>
            {availableVars.slice(0, 6).map((v) => (
              <button
                key={v.name}
                type="button"
                onClick={() => handleInsertVar(v.name)}
                title={`Insert {{${v.name}}}`}
                className="nodrag shrink-0 rounded bg-elevated/80 px-1 py-0.5 text-[9px] font-mono text-accent hover:bg-accent hover:text-white transition cursor-pointer border border-accent/20"
              >
                +{v.name}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Footer Variable Info */}
      <div className="shrink-0 border-t border-line/60 pt-1.5 flex items-center justify-between gap-2 text-[10px]">
        <div className="flex items-center gap-1 min-w-0 flex-1">
          <span className="font-mono text-[9px] text-fg-subtle uppercase">Var:</span>
          <input
            type="text"
            value={data.variable || ""}
            placeholder={effectiveVarName}
            onFocus={beginEdit}
            onChange={(e) => updateNodeData(id, { variable: e.currentTarget.value })}
            className={cn(
              "nodrag min-w-0 flex-1 bg-transparent font-mono text-[10px] text-accent placeholder:text-accent/40 outline-none",
              problem && "text-danger",
            )}
          />
        </div>
        {downstreamNodes.length > 0 && (
          <span
            title={`Feeds {{${effectiveVarName}}} into downstream steps`}
            className="shrink-0 flex items-center gap-0.5 font-mono text-[9px] text-accent/80"
          >
            <ArrowUpRight size={10} />
            <span>feeds {downstreamNodes.length} {downstreamNodes.length === 1 ? "step" : "steps"}</span>
          </span>
        )}
      </div>
    </NodeShell>
  );
}

export const NoteNode = memo(NoteNodeImpl);
