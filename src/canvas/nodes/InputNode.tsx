import { memo, useMemo, useState } from "react";
import { type NodeProps } from "@xyflow/react";
import {
  ArrowUpRight,
  Check,
  Copy,
  Eye,
  EyeOff,
  HelpCircle,
  KeyRound,
  Lock,
  MessageSquare,
  Type,
  Variable,
} from "lucide-react";
import { useWorkflowStore } from "@/store/workflowStore";
import { useUIStore } from "@/store/uiStore";
import { NodeShell, fieldKeys } from "./NodeShell";
import { cn } from "@/lib/utils";
import type { InputNodeType } from "@/types/workflow";

/** Only names a shell will let us export can be used as variables. */
const VALID_NAME = /^[A-Za-z_][A-Za-z0-9_]*$/;

type PresetTemplate = {
  label: string;
  variable: string;
  message: string;
  defaultValue: string;
  secret: boolean;
};

const PRESETS: PresetTemplate[] = [
  {
    label: "+ API Token",
    variable: "API_TOKEN",
    message: "Enter your API secret token",
    defaultValue: "",
    secret: true,
  },
  {
    label: "+ Version",
    variable: "VERSION",
    message: "Release version tag",
    defaultValue: "",
    secret: false,
  },
  {
    label: "+ Environment",
    variable: "DEPLOY_ENV",
    message: "Target deployment environment",
    defaultValue: "",
    secret: false,
  },
  {
    label: "+ Commit Msg",
    variable: "COMMIT_MSG",
    message: "Enter git commit message",
    defaultValue: "",
    secret: false,
  },
  {
    label: "+ Branch",
    variable: "BRANCH_NAME",
    message: "Target git branch",
    defaultValue: "",
    secret: false,
  },
];

/**
 * Supercharged, crystal-clear Ask (Input) Block.
 *
 * Pauses the workflow when reached to ask the operator for a value or secret token,
 * then injects it into all downstream steps as {{VARIABLE_NAME}} or $VARIABLE_NAME.
 */
function InputNodeImpl({ id, data, selected }: NodeProps<InputNodeType>) {
  const updateNodeData = useWorkflowStore((s) => s.updateNodeData);
  const beginEdit = useWorkflowStore((s) => s.beginEdit);
  const nodes = useWorkflowStore((s) => s.nodes);
  const edges = useWorkflowStore((s) => s.edges);
  const notify = useUIStore((s) => s.notify);

  const [copied, setCopied] = useState(false);
  const [showPreview, setShowPreview] = useState(false);

  const rawName = data.variable ?? "";
  const name = rawName.trim();
  const message = data.message ?? "Value for this run";
  const defaultValue = data.defaultValue ?? "";
  const isSecret = Boolean(data.secret);

  // Validate variable name
  const problem =
    name === ""
      ? "Set a variable name (e.g. API_KEY)"
      : !VALID_NAME.test(name)
        ? "Letters, numbers & underscores only"
        : null;

  // Downstream steps connected to this Ask block
  const outgoingEdges = useMemo(() => edges.filter((e) => e.source === id), [edges, id]);
  const downstreamNodes = useMemo(
    () =>
      outgoingEdges
        .map((e) => nodes.find((n) => n.id === e.target))
        .filter((n): n is NonNullable<typeof n> => !!n),
    [outgoingEdges, nodes],
  );

  const handleApplyPreset = (preset: PresetTemplate) => {
    beginEdit();
    updateNodeData(id, {
      variable: preset.variable,
      message: preset.message,
      defaultValue: preset.defaultValue,
      secret: preset.secret,
    });
  };

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
    // Sanitize spaces to underscores
    const sanitized = val.replace(/\s+/g, "_");
    beginEdit();
    updateNodeData(id, { variable: sanitized });
  };

  const toggleSecret = (nextSecret: boolean) => {
    beginEdit();
    updateNodeData(id, { secret: nextSecret });
  };

  return (
    <NodeShell
      id={id}
      kind="input"
      label={data.label || "Ask for Input"}
      frameId={data.frameId}
      selected={!!selected}
      width={340}
      onRename={(label) => updateNodeData(id, { label })}
    >
      {/* 1. Type Switcher (Standard Text vs Masked Secret) */}
      <div className="space-y-1.5">
        <div className="flex items-center justify-between">
          <label className="flex items-center gap-1 text-[10.5px] font-semibold text-fg-subtle">
            <Variable size={11} className="text-accent" />
            <span>INPUT TYPE</span>
          </label>

          {/* Mode Switcher */}
          <div className="nodrag flex shrink-0 items-center gap-0.5 rounded-[5px] border border-line bg-elevated/70 p-0.5">
            <button
              type="button"
              onClick={() => toggleSecret(false)}
              className={cn(
                "flex items-center gap-1 rounded-[3px] px-2 py-0.5 text-[9.5px] font-semibold transition cursor-pointer",
                !isSecret
                  ? "bg-accent text-white shadow-xs"
                  : "text-fg-subtle hover:bg-hover hover:text-fg",
              )}
            >
              <Type size={10} />
              <span>Visible Text</span>
            </button>

            <button
              type="button"
              onClick={() => toggleSecret(true)}
              className={cn(
                "flex items-center gap-1 rounded-[3px] px-2 py-0.5 text-[9.5px] font-semibold transition cursor-pointer",
                isSecret
                  ? "bg-amber-600 text-white shadow-xs"
                  : "text-fg-subtle hover:bg-hover hover:text-fg",
              )}
            >
              <Lock size={10} />
              <span>Secret / Token</span>
            </button>
          </div>
        </div>

        {/* Quick Presets Bar */}
        <div className="nodrag flex flex-wrap gap-1">
          {PRESETS.map((p) => (
            <button
              key={p.label}
              type="button"
              onClick={() => handleApplyPreset(p)}
              className="rounded-[3px] border border-line/70 bg-elevated/50 px-1.5 py-0.5 font-mono text-[9px] text-fg-subtle transition hover:border-line-strong hover:bg-hover hover:text-fg cursor-pointer"
            >
              {p.label}
            </button>
          ))}
        </div>
      </div>

      {/* 2. Prompt Question (Message shown during run) */}
      <div className="border-t border-line/60 pt-2 space-y-1">
        <label className="flex items-center gap-1 text-[10.5px] font-semibold text-fg-subtle">
          <MessageSquare size={11} className="text-accent" />
          <span>QUESTION PROMPT</span>
        </label>
        <textarea
          rows={2}
          value={message}
          spellCheck={false}
          onFocus={beginEdit}
          placeholder="e.g. Enter release version tag or deployment environment…"
          onChange={(e) => updateNodeData(id, { message: e.currentTarget.value })}
          onKeyDown={(e) => fieldKeys(e, true)}
          className="nodrag w-full resize-none rounded-[5px] border border-line bg-elevated/40 p-2 font-sans text-[11.5px] leading-[16px] text-fg placeholder:text-fg-subtle/50 outline-none transition focus:border-accent"
        />
      </div>

      {/* 3. Variable Name & Default Fallback */}
      <div className="border-t border-line/60 pt-2 space-y-1.5">
        <div className="grid grid-cols-2 gap-2">
          {/* Variable Name */}
          <div className="space-y-0.5">
            <div className="flex items-center justify-between text-[10px] font-semibold">
              <span className={cn(problem ? "text-danger" : "text-fg-subtle")}>
                VARIABLE NAME
              </span>
            </div>
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
                placeholder="API_KEY"
                onFocus={beginEdit}
                onChange={(e) => handleVariableChange(e.currentTarget.value)}
                onKeyDown={(e) => fieldKeys(e)}
                className="nodrag min-w-0 flex-1 bg-transparent font-mono text-[11px] font-bold text-accent placeholder:text-accent/30 outline-none"
              />
            </div>
          </div>

          {/* Default Value */}
          <div className="space-y-0.5">
            <span className="text-[10px] font-semibold text-fg-subtle">
              DEFAULT (OPTIONAL)
            </span>
            <div className="nodrag flex items-center rounded-[5px] border border-line bg-base/90 px-2 py-1 focus-within:border-accent transition">
              <input
                type={isSecret ? "password" : "text"}
                value={defaultValue}
                spellCheck={false}
                placeholder={isSecret ? "••••••••" : "e.g. main"}
                onFocus={beginEdit}
                onChange={(e) => updateNodeData(id, { defaultValue: e.currentTarget.value })}
                onKeyDown={(e) => fieldKeys(e)}
                className="nodrag min-w-0 flex-1 bg-transparent font-mono text-[11px] text-fg placeholder:text-fg-subtle/40 outline-none"
              />
            </div>
          </div>
        </div>

        {/* Validation error or Variable usage bar */}
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

      {/* 4. Live Runtime Dialog Mini-Preview Toggle */}
      <div className="border-t border-line/60 pt-1.5">
        <div className="flex items-center justify-between">
          <button
            type="button"
            onClick={() => setShowPreview(!showPreview)}
            className="nodrag flex items-center gap-1 text-[10px] font-medium text-fg-subtle hover:text-fg transition cursor-pointer"
          >
            {showPreview ? <EyeOff size={11} /> : <Eye size={11} />}
            <span>{showPreview ? "Hide popup preview" : "Preview prompt dialog"}</span>
          </button>

          {downstreamNodes.length > 0 && (
            <span
              title={`Provides {{${name || "VALUE"}}} to ${downstreamNodes.length} connected downstream steps`}
              className="flex items-center gap-0.5 font-mono text-[9.5px] text-accent/80"
            >
              <ArrowUpRight size={10} />
              <span>feeds {downstreamNodes.length} {downstreamNodes.length === 1 ? "step" : "steps"}</span>
            </span>
          )}
        </div>

        {/* Mini Preview Box */}
        {showPreview && (
          <div className="mt-1.5 space-y-1.5 rounded-[6px] border border-warn/40 bg-elevated/80 p-2.5 shadow-sm animate-in fade-in duration-150">
            <div className="flex items-center justify-between border-b border-line/70 pb-1">
              <div className="flex items-center gap-1.5">
                <span className="flex size-[14px] items-center justify-center rounded bg-warn/15 text-warn">
                  <KeyRound size={9} />
                </span>
                <span className="text-[10px] font-bold text-fg">{data.label || "Ask"}</span>
              </div>
              <span className="rounded bg-warn/15 px-1 py-0.2 font-mono text-[8.5px] font-bold text-warn">
                RUN-TIME PROMPT
              </span>
            </div>

            <p className="text-[10.5px] text-fg leading-tight">
              {message || "Value for this run"}
            </p>

            <div className="flex items-center gap-1.5 rounded border border-line bg-base px-2 py-1">
              <span className="font-mono text-[9px] text-fg-subtle">{name || "VAR"}:</span>
              <span className="font-mono text-[10.5px] text-fg/90">
                {isSecret ? "••••••••••••" : defaultValue || "User types answer here…"}
              </span>
            </div>
          </div>
        )}
      </div>
    </NodeShell>
  );
}

export const InputNode = memo(InputNodeImpl);
