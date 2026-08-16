import { memo, useState, useMemo } from "react";
import { type NodeProps } from "@xyflow/react";
import {
  Copy,
  Check,
  Sparkles,
  ChevronDown,
  ChevronRight,
  Variable,
} from "lucide-react";
import { useWorkflowStore } from "@/store/workflowStore";
import { useRuntimeStore } from "@/store/runtimeStore";
import { NodeShell, Note, TextField } from "./NodeShell";
import type { AiCommitNodeType } from "@/types/workflow";
import { cn } from "@/lib/utils";

const VALID_NAME = /^[A-Za-z_][A-Za-z0-9_]*$/;

const PROMPT_PRESETS = [
  {
    name: "⚡ Conventional Commit",
    prompt: "Summarize the changes into a concise conventional git commit message (e.g. feat(auth): add oauth login support)",
    style: "conventional",
  },
  {
    name: "📝 1-Sentence Summary",
    prompt: "Provide a 1-sentence executive summary of the changes",
    style: "concise",
  },
  {
    name: "📋 Release Notes",
    prompt: "Format the changes into concise markdown release notes bullet points",
    style: "detailed",
  },
  {
    name: "🛠 Custom Prompt",
    prompt: "",
    style: "custom",
  },
];

/**
 * AI Summarizer & Model Node
 *
 * Receives input data from upstream wires, variables, or git diffs,
 * applies an AI task/prompt with live preview, and routes generated
 * text into downstream variables.
 */
function AiCommitNodeImpl({ id, data, selected }: NodeProps<AiCommitNodeType>) {
  const updateNodeData = useWorkflowStore((s) => s.updateNodeData);
  const beginEdit = useWorkflowStore((s) => s.beginEdit);
  const nodes = useWorkflowStore((s) => s.nodes);
  const edges = useWorkflowStore((s) => s.edges);

  const outputMap = useRuntimeStore((s) => s.output);
  const myOutput = outputMap[id];
  const lastOutput = myOutput && myOutput.length > 0 ? myOutput[myOutput.length - 1]?.text : null;

  const [copied, setCopied] = useState(false);
  const [showPreview, setShowPreview] = useState(true);

  // Detect incoming connections
  const incomingEdges = useMemo(() => edges.filter((e) => e.target === id), [edges, id]);
  const incomingSources = useMemo(
    () => nodes.filter((n) => incomingEdges.some((e) => e.source === n.id)),
    [nodes, incomingEdges],
  );

  const handleCopy = () => {
    const varName = data.variable || "commit_message";
    navigator.clipboard.writeText(`{{${varName}}}`);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const name = data.variable.trim();
  const problem =
    name === ""
      ? "Name the variable so later steps can use it"
      : !VALID_NAME.test(name)
        ? "Letters, digits and underscores only"
        : null;

  const currentPrompt =
    data.prompt ??
    "Summarize the changes into a concise conventional git commit message";

  const firstSource = incomingSources[0];

  // Compute what the AI receives for live preview
  const liveIncomingContent = useMemo(() => {
    if (data.inputVariable && data.inputVariable.trim()) {
      const varKey = data.inputVariable.replace(/^\{\{|\}\}$/g, "").trim();
      return `Variable: {{${varKey}}}`;
    }
    if (firstSource) {
      const srcOutput = outputMap[firstSource.id];
      if (srcOutput && srcOutput.length > 0) {
        return srcOutput.slice(0, 8).map((o) => o.text).join("\n");
      }
      return `[Connected from: ${(firstSource.data as any)?.label || firstSource.type} — output data stream]`;
    }
    return `[Git Repository Changes in ${data.workingDir ? "custom directory" : "working folder"}]`;
  }, [data.inputVariable, data.workingDir, firstSource, outputMap]);

  const totalChars = (currentPrompt?.length || 0) + (liveIncomingContent?.length || 0);
  const tokenEstimate = Math.ceil(totalChars / 4);

  return (
    <NodeShell
      id={id}
      kind="ai_commit"
      label={data.label}
      frameId={data.frameId}
      selected={!!selected}
      workingDir={data.workingDir}
      onRename={(label) => updateNodeData(id, { label })}
    >
      {/* 4-Way Port Indicators */}
      <div className="flex items-center justify-between px-1 py-0.5 text-[9px] font-mono uppercase tracking-wider text-fg-subtle/75">
        <div className="flex items-center gap-1">
          <span className="inline-block size-1.5 rounded-full bg-sky-400" />
          <span>Left: Data In</span>
        </div>
        <div className="flex items-center gap-1">
          <span>Right: Var Out</span>
          <span className="inline-block size-1.5 rounded-full bg-emerald-400" />
        </div>
      </div>

      {/* Input Source & Binding */}
      <div className="space-y-1 rounded-[6px] border border-line bg-surface/40 p-2">
        <div className="flex items-center justify-between text-[10.5px]">
          <span className="flex items-center gap-1 font-medium text-fg">
            <Variable size={11} className="text-sky-400" />
            Input Source
          </span>
          <span className="text-[10px] text-fg-subtle">
            {firstSource
              ? `Connected (${incomingSources.length})`
              : "Auto / Git Diff"}
          </span>
        </div>
        <TextField
          label="In Var"
          value={data.inputVariable || ""}
          placeholder={
            firstSource
              ? `Auto from ${(firstSource.data as any)?.label || firstSource.type}`
              : "{{diff}} or (Auto)"
          }
          onCommit={beginEdit}
          onChange={(inputVariable) => updateNodeData(id, { inputVariable })}
        />
      </div>

      {/* Prompt / Task Configuration */}
      <div className="space-y-1.5 rounded-[6px] border border-line bg-surface/40 p-2">
        <div className="flex items-center justify-between text-[10.5px]">
          <span className="flex items-center gap-1 font-medium text-fg">
            <Sparkles size={11} className="text-accent" />
            AI Prompt & Task
          </span>
        </div>

        {/* Preset Pills */}
        <div className="flex flex-wrap gap-1">
          {PROMPT_PRESETS.map((preset) => {
            const active =
              preset.style === data.style ||
              (preset.style === "conventional" && (!data.style || data.style === "conventional"));
            return (
              <button
                key={preset.name}
                type="button"
                onClick={() => {
                  beginEdit();
                  updateNodeData(id, {
                    prompt: preset.prompt,
                    style: preset.style as any,
                  });
                }}
                className={cn(
                  "nodrag rounded-full px-2 py-0.5 text-[9.5px] font-medium transition cursor-pointer",
                  active
                    ? "bg-accent text-white shadow-xs"
                    : "bg-elevated/80 text-fg-subtle hover:bg-hover hover:text-fg",
                )}
              >
                {preset.name}
              </button>
            );
          })}
        </div>

        <textarea
          value={currentPrompt}
          rows={2}
          spellCheck={false}
          autoCapitalize="off"
          autoCorrect="off"
          placeholder="Enter AI prompt instruction..."
          onFocus={beginEdit}
          onChange={(e) => updateNodeData(id, { prompt: e.currentTarget.value })}
          className={cn(
            "nodrag nowheel max-h-[140px] w-full resize-none rounded-[4px] border border-line bg-elevated/80",
            "p-1.5 font-mono text-[10.5px] leading-[15px] text-fg outline-none focus:border-accent",
          )}
        />
      </div>

      {/* Interactive Live Preview Inspector */}
      <div className="rounded-[6px] border border-line bg-elevated/40">
        <button
          type="button"
          onClick={() => setShowPreview((p) => !p)}
          className="flex w-full items-center justify-between px-2 py-1 text-[10px] font-medium text-fg-muted hover:text-fg cursor-pointer"
        >
          <span className="flex items-center gap-1">
            {showPreview ? <ChevronDown size={11} /> : <ChevronRight size={11} />}
            AI Payload Preview
          </span>
          <span className="rounded bg-base px-1.5 py-0.2 text-[9px] font-mono text-fg-subtle">
            ~{tokenEstimate} tokens
          </span>
        </button>

        {showPreview && (
          <div className="space-y-1.5 border-t border-line/60 p-2 text-[10px] font-mono animate-in-soft">
            <div>
              <span className="text-[9px] font-semibold uppercase text-accent/90">Prompt:</span>
              <p className="mt-0.5 line-clamp-2 rounded bg-base/80 p-1 text-fg-subtle">
                {currentPrompt}
              </p>
            </div>
            <div>
              <span className="text-[9px] font-semibold uppercase text-sky-400">Incoming Data:</span>
              <p className="mt-0.5 line-clamp-3 rounded bg-base/80 p-1 text-fg-muted">
                {liveIncomingContent}
              </p>
            </div>
            {lastOutput && (
              <div>
                <span className="text-[9px] font-semibold uppercase text-emerald-400">Last Generated Output:</span>
                <p className="mt-0.5 line-clamp-2 rounded border border-emerald-500/20 bg-emerald-500/10 p-1 text-emerald-300">
                  {lastOutput}
                </p>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Output Variable */}
      <TextField
        label="Out Var"
        value={data.variable}
        placeholder="commit_message"
        invalid={!!problem}
        onCommit={beginEdit}
        onChange={(variable) => updateNodeData(id, { variable })}
        rightNode={
          <button
            type="button"
            onClick={handleCopy}
            title="Copy variable template"
            className="flex shrink-0 cursor-pointer items-center justify-center rounded p-1 text-fg-subtle transition-colors hover:bg-hover"
          >
            {copied ? <Check size={12} className="text-success" /> : <Copy size={12} />}
          </button>
        }
      />

      <Note>
        Plug right port into: {`{{${name || "commit_message"}}}`}
      </Note>
    </NodeShell>
  );
}

export const AiCommitNode = memo(AiCommitNodeImpl);
