import { memo, useState } from "react";
import { type NodeProps } from "@xyflow/react";
import { Copy, Check, Sparkles } from "lucide-react";
import { useWorkflowStore } from "@/store/workflowStore";
import { NodeShell, Note, TextField } from "./NodeShell";
import type { AiCommitNodeType } from "@/types/workflow";

const VALID_NAME = /^[A-Za-z_][A-Za-z0-9_]*$/;

/**
 * Uses Apple on-device intelligence / local semantic diff analysis to summarize
 * git changes into a standardized commit message, saved to a variable.
 */
function AiCommitNodeImpl({ id, data, selected }: NodeProps<AiCommitNodeType>) {
  const updateNodeData = useWorkflowStore((s) => s.updateNodeData);
  const beginEdit = useWorkflowStore((s) => s.beginEdit);
  const [copied, setCopied] = useState(false);

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
      <div className="flex items-center gap-1.5 px-2.5 py-1.5 bg-accent/10 rounded-[6px] text-[11px] text-accent font-medium">
        <Sparkles size={12} className="shrink-0 text-accent" />
        <span>Apple On-Device Intelligence</span>
      </div>

      <p className="text-[11px] text-fg-subtle px-0.5 leading-[16px]">
        Summarizes uncommitted changes into a clean commit message before <code className="font-mono text-fg text-[10.5px]">git add .</code>
      </p>

      <TextField
        label="Variable Out"
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
            className="flex items-center justify-center p-1 rounded hover:bg-hover text-fg-subtle transition-colors shrink-0 cursor-pointer"
          >
            {copied ? <Check size={12} className="text-success" /> : <Copy size={12} />}
          </button>
        }
      />

      <Note>Later steps: {`{{${name || "commit_message"}}}`} or ${name || "commit_message"}</Note>
    </NodeShell>
  );
}

export const AiCommitNode = memo(AiCommitNodeImpl);
