import { memo, useState } from "react";
import { type NodeProps } from "@xyflow/react";
import { Copy, Check } from "lucide-react";
import { useWorkflowStore } from "@/store/workflowStore";
import { NodeShell, TextField, Choices } from "./NodeShell";
import type { BumpVersionNodeType } from "@/types/workflow";

function BumpVersionNodeImpl({ id, data, selected }: NodeProps<BumpVersionNodeType>) {
  const updateNodeData = useWorkflowStore((s) => s.updateNodeData);
  const beginEdit = useWorkflowStore((s) => s.beginEdit);
  const [copied, setCopied] = useState(false);

  const handleCopy = () => {
    const varName = data.variableOut || "next_version";
    navigator.clipboard.writeText(`{{${varName}}}`);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const getPreview = () => {
    const input = data.variableIn?.trim();
    if (!input) return null;
    const versionStr = input.startsWith('v') || input.startsWith('V') ? input.slice(1) : input;
    const match = versionStr.match(/^(\d+)\.(\d+)\.(\d+)(?:-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/);
    if (!match) return null;
    let major = parseInt(match[1]!, 10);
    let minor = parseInt(match[2]!, 10);
    let patch = parseInt(match[3]!, 10);
    if (data.part === "major") {
      major++; minor = 0; patch = 0;
    } else if (data.part === "minor") {
      minor++; patch = 0;
    } else if (data.part === "patch") {
      patch++;
    }
    const prefix = input.startsWith('v') ? 'v' : input.startsWith('V') ? 'V' : '';
    return `${prefix}${major}.${minor}.${patch}`;
  };

  const preview = getPreview();

  return (
    <NodeShell
      id={id}
      kind="bump_version"
      label={data.label}
      frameId={data.frameId}
      selected={!!selected}
      workingDir={null}
      onRename={(label) => updateNodeData(id, { label })}
    >
      <TextField
        label="Variable In"
        value={data.variableIn}
        placeholder="current_version"
        onCommit={beginEdit}
        onChange={(variableIn) => updateNodeData(id, { variableIn })}
      />
      <Choices
        label="Bump Type"
        value={data.part}
        options={["major", "minor", "patch"]}
        onChange={(part) => {
          beginEdit();
          updateNodeData(id, { part });
        }}
      />
      <TextField
        label="Variable Out"
        value={data.variableOut}
        placeholder="next_version"
        onCommit={beginEdit}
        onChange={(variableOut) => updateNodeData(id, { variableOut })}
        rightNode={
          <button
            type="button"
            onClick={handleCopy}
            title="Copy variable template"
            className="flex items-center justify-center p-1 rounded hover:bg-hover text-fg-subtle transition-colors shrink-0"
          >
            {copied ? <Check size={12} className="text-success" /> : <Copy size={12} />}
          </button>
        }
      />
      {preview && (
        <div className="flex items-center gap-1.5 mt-1">
          <span className="shrink-0 text-[10.5px] text-fg-subtle" style={{ width: 52 }}>
            Preview
          </span>
          <div className="nodrag min-w-0 flex-1 rounded-[4px] bg-accent/10 px-1.5 py-1 text-[10.5px] text-accent font-mono border border-accent/20">
            {preview}
          </div>
        </div>
      )}
    </NodeShell>
  );
}

export const BumpVersionNode = memo(BumpVersionNodeImpl);
