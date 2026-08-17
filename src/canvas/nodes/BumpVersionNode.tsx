import { memo, useMemo, useState } from "react";
import { type NodeProps } from "@xyflow/react";
import {
  ArrowRight,
  ArrowUpRight,
  Check,
  Copy,
  HelpCircle,
  Tag,
} from "lucide-react";
import { useWorkflowStore } from "@/store/workflowStore";
import { useAvailableVariables } from "@/lib/useAvailableVariables";
import { useUIStore } from "@/store/uiStore";
import { NodeShell, fieldKeys } from "./NodeShell";
import { cn } from "@/lib/utils";
import type { BumpVersionNodeType } from "@/types/workflow";

const VALID_NAME = /^[A-Za-z_][A-Za-z0-9_]*$/;

type BumpPart = "major" | "minor" | "patch";

/**
 * Parses and increments versions of any format:
 * - 2-part: 0.1 -> 0.2 (minor/patch) or 1.0 (major)
 * - 3-part semver: 1.2.3 -> 1.2.4 (patch) / 1.3.0 (minor) / 2.0.0 (major)
 * - 1-part integers: 42 -> 43
 * - 4-part: 1.2.3.4
 * Supports prefix (front) and suffix (back) elements.
 */
function computeBumpedVersion(
    rawInput: string,
    part: BumpPart,
    prefix?: string,
    suffix?: string,
): { bumpedCore: string; finalResult: string } | null {
  let trimmed = rawInput.trim();
  if (!trimmed) return null;

  // Auto-detect existing 'v' or 'V' prefix if none explicitly configured
  let autoPrefix = "";
  if (trimmed.startsWith("v")) {
    autoPrefix = "v";
    trimmed = trimmed.slice(1);
  } else if (trimmed.startsWith("V")) {
    autoPrefix = "V";
    trimmed = trimmed.slice(1);
  }

  // Strip existing suffix if present (e.g. -beta.1 or +build)
  const sepIdx = trimmed.search(/[-+]/);
  const core = sepIdx !== -1 ? trimmed.slice(0, sepIdx) : trimmed;

  const parts = core.split(".");
  const numbers = parts.map((p) => parseInt(p, 10));
  if (numbers.some((n) => Number.isNaN(n))) return null;

  const numParts = numbers.length;
  if (numParts === 0) return null;

  const bumped = [...numbers];

  if (numParts === 1) {
    bumped[0] = (bumped[0] ?? 0) + 1;
  } else if (numParts === 2) {
    if (part === "major") {
      bumped[0] = (bumped[0] ?? 0) + 1;
      bumped[1] = 0;
    } else {
      // Both minor and patch bump the secondary number for 2-part versions (0.1 -> 0.2)
      bumped[1] = (bumped[1] ?? 0) + 1;
    }
  } else if (numParts === 3) {
    if (part === "major") {
      bumped[0] = (bumped[0] ?? 0) + 1;
      bumped[1] = 0;
      bumped[2] = 0;
    } else if (part === "minor") {
      bumped[1] = (bumped[1] ?? 0) + 1;
      bumped[2] = 0;
    } else {
      bumped[2] = (bumped[2] ?? 0) + 1;
    }
  } else {
    // 4+ parts
    if (part === "major") {
      bumped[0] = (bumped[0] ?? 0) + 1;
      for (let i = 1; i < bumped.length; i++) bumped[i] = 0;
    } else if (part === "minor") {
      bumped[1] = (bumped[1] ?? 0) + 1;
      for (let i = 2; i < bumped.length; i++) bumped[i] = 0;
    } else {
      if (bumped.length >= 3) {
        bumped[2] = (bumped[2] ?? 0) + 1;
        for (let i = 3; i < bumped.length; i++) bumped[i] = 0;
      } else {
        const lastIdx = bumped.length - 1;
        bumped[lastIdx] = (bumped[lastIdx] ?? 0) + 1;
      }
    }
  }

  const bumpedCore = bumped.join(".");
  const finalPrefix = prefix !== undefined ? prefix : autoPrefix;
  const finalSuffix = suffix || "";
  const finalResult = `${finalPrefix}${bumpedCore}${finalSuffix}`;

  return { bumpedCore, finalResult };
}

/**
 * Supercharged Version Bump Node.
 *
 * Supports semantic versions (1.2.3), 2-part versions (0.1), build numbers,
 * customizable prefix (front) & suffix (back) elements with dynamic variables.
 */
function BumpVersionNodeImpl({ id, data, selected }: NodeProps<BumpVersionNodeType>) {
  const updateNodeData = useWorkflowStore((s) => s.updateNodeData);
  const beginEdit = useWorkflowStore((s) => s.beginEdit);
  const nodes = useWorkflowStore((s) => s.nodes);
  const edges = useWorkflowStore((s) => s.edges);
  const notify = useUIStore((s) => s.notify);
  const availableVars = useAvailableVariables();

  const [copied, setCopied] = useState(false);

  const rawIn = data.variableIn ?? "";
  const rawOut = data.variableOut ?? "NEXT_VERSION";
  const part: BumpPart = (data.part as BumpPart) || "patch";
  const prefix = data.prefix ?? "";
  const suffix = data.suffix ?? "";

  const nameOut = rawOut.trim();

  // Validation
  const problem =
    nameOut === ""
      ? "Set an output variable name (e.g. NEXT_VERSION)"
      : !VALID_NAME.test(nameOut)
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

  // Compute live preview based on sample or literal input
  const previewSample = rawIn.trim() || "0.1";
  const previewInfo = useMemo(
    () => computeBumpedVersion(previewSample, part, prefix || undefined, suffix || undefined),
    [previewSample, part, prefix, suffix],
  );

  const handleCopy = async (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!nameOut) return;
    const tag = `{{${nameOut}}}`;
    try {
      await navigator.clipboard.writeText(tag);
      setCopied(true);
      notify(`Copied ${tag} to clipboard`);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      notify("Failed to copy variable", "error");
    }
  };

  const handleVariableOutChange = (val: string) => {
    const sanitized = val.replace(/\s+/g, "_");
    beginEdit();
    updateNodeData(id, { variableOut: sanitized });
  };

  const handleInsertSuffixVar = (varName: string) => {
    beginEdit();
    const tag = `{{${varName}}}`;
    const nextSuffix = suffix ? `${suffix}.${tag}` : `-${tag}`;
    updateNodeData(id, { suffix: nextSuffix });
  };

  return (
    <NodeShell
      id={id}
      kind="bump_version"
      label={data.label || "Bump Version"}
      frameId={data.frameId}
      selected={!!selected}
      workingDir={null}
      width={340}
      onRename={(label) => updateNodeData(id, { label })}
    >
      {/* 1. Input Version / Variable */}
      <div className="space-y-1">
        <label className="flex items-center gap-1 text-[10.5px] font-semibold text-fg-subtle">
          <Tag size={11} className="text-accent" />
          <span>CURRENT VERSION (OR VARIABLE)</span>
        </label>
        <div className="nodrag flex items-center rounded-[5px] border border-line bg-elevated/50 px-2 py-1.5 focus-within:border-accent transition">
          <input
            type="text"
            value={rawIn}
            spellCheck={false}
            placeholder="e.g. 0.1, 1.0.0, or {{CURRENT_VERSION}}"
            onFocus={beginEdit}
            onChange={(e) => updateNodeData(id, { variableIn: e.currentTarget.value })}
            onKeyDown={(e) => fieldKeys(e)}
            className="nodrag min-w-0 flex-1 bg-transparent font-mono text-[11.5px] text-fg placeholder:text-fg-subtle/50 outline-none"
          />
        </div>

        {/* Quick Variable Picker Chips */}
        {availableVars.length > 0 && (
          <div className="nodrag flex items-center gap-1 overflow-x-auto py-0.5">
            <span className="text-[9px] font-mono text-fg-subtle shrink-0">Use:</span>
            {availableVars.slice(0, 4).map((v) => (
              <button
                key={v.name}
                type="button"
                onClick={() => {
                  beginEdit();
                  updateNodeData(id, { variableIn: v.name });
                }}
                title={`Use variable {{${v.name}}}`}
                className="nodrag shrink-0 rounded bg-elevated/80 px-1.5 py-0.5 text-[9px] font-mono text-accent hover:bg-accent hover:text-white transition cursor-pointer border border-accent/20"
              >
                {v.name}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* 2. Bump Increment Type */}
      <div className="border-t border-line/60 pt-2 space-y-1">
        <span className="text-[10px] font-semibold text-fg-subtle">
          BUMP INCREMENT
        </span>
        <div className="nodrag grid grid-cols-3 gap-1 rounded-[5px] border border-line bg-elevated/70 p-0.5">
          <button
            type="button"
            onClick={() => {
              beginEdit();
              updateNodeData(id, { part: "patch" });
            }}
            className={cn(
              "flex items-center justify-center gap-1 rounded-[4px] py-1 text-[9.5px] font-semibold transition cursor-pointer",
              part === "patch"
                ? "bg-accent text-white shadow-xs"
                : "text-fg-subtle hover:bg-hover hover:text-fg",
            )}
            title="Increment patch component (e.g. 0.1 -> 0.2, 1.0.0 -> 1.0.1)"
          >
            <span>Patch (+0.0.1 / +0.1)</span>
          </button>

          <button
            type="button"
            onClick={() => {
              beginEdit();
              updateNodeData(id, { part: "minor" });
            }}
            className={cn(
              "flex items-center justify-center gap-1 rounded-[4px] py-1 text-[9.5px] font-semibold transition cursor-pointer",
              part === "minor"
                ? "bg-accent text-white shadow-xs"
                : "text-fg-subtle hover:bg-hover hover:text-fg",
            )}
            title="Increment minor component (e.g. 0.1 -> 0.2, 1.0.0 -> 1.1.0)"
          >
            <span>Minor (+0.1.0)</span>
          </button>

          <button
            type="button"
            onClick={() => {
              beginEdit();
              updateNodeData(id, { part: "major" });
            }}
            className={cn(
              "flex items-center justify-center gap-1 rounded-[4px] py-1 text-[9.5px] font-semibold transition cursor-pointer",
              part === "major"
                ? "bg-accent text-white shadow-xs"
                : "text-fg-subtle hover:bg-hover hover:text-fg",
            )}
            title="Increment major component (e.g. 0.1 -> 1.0, 1.0.0 -> 2.0.0)"
          >
            <span>Major (+1.0.0)</span>
          </button>
        </div>
      </div>

      {/* 3. Prefix (Front) & Suffix (Back) Custom Elements */}
      <div className="border-t border-line/60 pt-2 space-y-1.5">
        <div className="grid grid-cols-2 gap-2">
          {/* Prefix (Front) */}
          <div className="space-y-0.5">
            <span className="text-[10px] font-semibold text-fg-subtle">
              FRONT PREFIX
            </span>
            <div className="nodrag flex items-center rounded-[5px] border border-line bg-base/90 px-2 py-1 focus-within:border-accent transition">
              <input
                type="text"
                value={prefix}
                spellCheck={false}
                placeholder="e.g. v or release-"
                onFocus={beginEdit}
                onChange={(e) => updateNodeData(id, { prefix: e.currentTarget.value })}
                onKeyDown={(e) => fieldKeys(e)}
                className="nodrag min-w-0 flex-1 bg-transparent font-mono text-[11px] text-fg placeholder:text-fg-subtle/40 outline-none"
              />
            </div>
          </div>

          {/* Suffix (Back) */}
          <div className="space-y-0.5">
            <span className="text-[10px] font-semibold text-fg-subtle">
              BACK SUFFIX / PRERELEASE
            </span>
            <div className="nodrag flex items-center rounded-[5px] border border-line bg-base/90 px-2 py-1 focus-within:border-accent transition">
              <input
                type="text"
                value={suffix}
                spellCheck={false}
                placeholder="e.g. -beta.1, -rc"
                onFocus={beginEdit}
                onChange={(e) => updateNodeData(id, { suffix: e.currentTarget.value })}
                onKeyDown={(e) => fieldKeys(e)}
                className="nodrag min-w-0 flex-1 bg-transparent font-mono text-[11px] text-fg placeholder:text-fg-subtle/40 outline-none"
              />
            </div>
          </div>
        </div>

        {/* Dynamic variable chips for Suffix */}
        {availableVars.length > 0 && (
          <div className="nodrag flex items-center gap-1 overflow-x-auto py-0.5">
            <span className="text-[9px] font-mono text-fg-subtle shrink-0">Append:</span>
            {availableVars.slice(0, 3).map((v) => (
              <button
                key={v.name}
                type="button"
                onClick={() => handleInsertSuffixVar(v.name)}
                title={`Append -{{${v.name}}} to suffix`}
                className="nodrag shrink-0 rounded bg-elevated/70 px-1.5 py-0.5 text-[8.5px] font-mono text-fg-subtle hover:text-fg hover:bg-hover transition cursor-pointer border border-line/60"
              >
                +{{VAR: v.name}.VAR}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* 4. Live Assembled Version Preview */}
      {previewInfo && (
        <div className="border-t border-line/60 pt-2 space-y-1">
          <div className="flex items-center justify-between text-[10px] font-semibold text-fg-subtle">
            <span>LIVE BUMP PREVIEW</span>
            <span className="font-mono text-[9px] text-accent/80">Format: {part}</span>
          </div>

          <div className="flex items-center gap-1.5 rounded-[5px] border border-accent/25 bg-accent/5 p-1.5 font-mono text-[10.5px]">
            <span className="text-fg-subtle truncate max-w-[80px]" title={`Current: ${previewSample}`}>
              {previewSample}
            </span>
            <ArrowRight size={11} className="text-accent shrink-0" />
            <span className="font-bold text-accent truncate flex-1">
              {previewInfo.finalResult}
            </span>
          </div>
        </div>
      )}

      {/* 5. Output Variable Name & 1-Click Copy */}
      <div className="border-t border-line/60 pt-2 space-y-1.5">
        <div className="space-y-0.5">
          <span className={cn("text-[10px] font-semibold", problem ? "text-danger" : "text-fg-subtle")}>
            STORE BUMPED VERSION IN
          </span>

          <div
            className={cn(
              "nodrag flex items-center rounded-[5px] border bg-base/90 px-2 py-1 transition",
              problem ? "border-danger/70 bg-danger/5" : "border-line focus-within:border-accent",
            )}
          >
            <input
              type="text"
              value={rawOut}
              spellCheck={false}
              placeholder="NEXT_VERSION"
              onFocus={beginEdit}
              onChange={(e) => handleVariableOutChange(e.currentTarget.value)}
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
                {`{{${nameOut}}}`}
              </code>
            </div>

            <button
              type="button"
              onClick={handleCopy}
              className="nodrag flex items-center gap-1 rounded px-1.5 py-0.5 font-mono text-[9.5px] font-semibold text-accent hover:bg-accent/15 transition cursor-pointer"
              title="Copy {{VARIABLE}} to paste in commands"
            >
              {copied ? <Check size={10} className="text-success" /> : <Copy size={10} />}
              <span>{copied ? "Copied" : "Copy"}</span>
            </button>
          </div>
        )}
      </div>

      {/* 6. Downstream Counter */}
      {downstreamNodes.length > 0 && (
        <div className="border-t border-line/60 pt-1.5 flex items-center justify-end text-[10.5px]">
          <span
            title={`Provides {{${nameOut || "NEXT_VERSION"}}} to ${downstreamNodes.length} connected downstream steps`}
            className="flex items-center gap-0.5 font-mono text-[9.5px] text-accent/80"
          >
            <ArrowUpRight size={10} />
            <span>feeds {downstreamNodes.length} {downstreamNodes.length === 1 ? "step" : "steps"}</span>
          </span>
        </div>
      )}
    </NodeShell>
  );
}

export const BumpVersionNode = memo(BumpVersionNodeImpl);
