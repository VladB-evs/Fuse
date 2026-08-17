import { memo, useMemo } from "react";
import { type NodeProps } from "@xyflow/react";
import { CheckSquare, CircleDot, GitFork, ArrowRight } from "lucide-react";
import { useWorkflowStore } from "@/store/workflowStore";
import { NodeShell, Note, fieldKeys } from "./NodeShell";
import { cn } from "@/lib/utils";
import { isBlockNode, type BlockNodeType, type ChoiceNodeType } from "@/types/workflow";

const KIND_COLORS: Record<string, { badge: string; text: string }> = {
  command: { badge: "bg-accent/15 text-accent border-accent/30", text: "Terminal" },
  script: { badge: "bg-emerald-500/15 text-emerald-400 border-emerald-500/30", text: "Script" },
  http: { badge: "bg-blue-500/15 text-blue-400 border-blue-500/30", text: "HTTP" },
  condition: { badge: "bg-amber-500/15 text-amber-400 border-amber-500/30", text: "If" },
  choice: { badge: "bg-violet-500/15 text-violet-400 border-violet-500/30", text: "Choice" },
  input: { badge: "bg-teal-500/15 text-teal-400 border-teal-500/30", text: "Ask" },
  approval: { badge: "bg-rose-500/15 text-rose-400 border-rose-500/30", text: "Confirm" },
  frame: { badge: "bg-indigo-500/15 text-indigo-400 border-indigo-500/30", text: "Frame" },
};

/**
 * A user decision fork in the workflow.
 *
 * Pauses the workflow at runtime and displays a prompt dialog asking the user
 * to choose which connected downstream branch(es) should execute next.
 *
 * Unselected branches (and their descendants) are skipped.
 */
function ChoiceNodeImpl({ id, data, selected }: NodeProps<ChoiceNodeType>) {
  const updateNodeData = useWorkflowStore((s) => s.updateNodeData);
  const beginEdit = useWorkflowStore((s) => s.beginEdit);

  const nodes = useWorkflowStore((s) => s.nodes);
  const edges = useWorkflowStore((s) => s.edges);

  const allowMultiple = !!data.allowMultiple;

  // Resolve all connected downstream target blocks
  const targetBlocks = useMemo(() => {
    const rawTargets = [
      ...new Set(
        edges
          .filter((e) => e.source === id && !e.data?.disabled)
          .map((e) => e.target),
      ),
    ];

    const resolved: Array<{ id: string; label: string; kind: string; isFrameMember?: boolean }> = [];

    for (const targetId of rawTargets) {
      const node = nodes.find((n) => n.id === targetId);
      if (!node || (node.data as any)?.disabled) continue;

      if (node.type === "frame") {
        const members = nodes.filter(
          (m): m is BlockNodeType =>
            isBlockNode(m) && m.data.frameId === node.id && !(m.data as any)?.disabled,
        );
        for (const member of members) {
          resolved.push({
            id: member.id,
            label: (member.data as any).label || "Untitled Step",
            kind: member.type,
            isFrameMember: true,
          });
        }
      } else if (isBlockNode(node)) {
        resolved.push({
          id: node.id,
          label: (node.data as any).label || "Untitled Step",
          kind: node.type,
        });
      }
    }

    return resolved;
  }, [id, nodes, edges]);

  return (
    <NodeShell
      id={id}
      kind="choice"
      label={data.label}
      frameId={data.frameId}
      selected={!!selected}
      onRename={(label) => updateNodeData(id, { label })}
    >
      {/* Selection Mode Switcher (Single Choice vs Multiple Choice) */}
      <div>
        <label className="mb-1 block text-[10.5px] font-medium text-fg-subtle">
          Selection mode at run time
        </label>
        <div className="nodrag grid grid-cols-2 gap-1 rounded-[6px] border border-line bg-elevated/40 p-0.5">
          <button
            type="button"
            onClick={() => {
              beginEdit();
              updateNodeData(id, { allowMultiple: false });
            }}
            className={cn(
              "flex items-center justify-center gap-1.5 rounded-[4px] py-1 text-center font-medium text-[10px] transition cursor-pointer border border-transparent",
              !allowMultiple
                ? "bg-accent text-white font-semibold shadow-xs"
                : "text-fg-subtle hover:bg-hover hover:text-fg",
            )}
            title="User picks exactly 1 branch to run (Radio buttons)"
          >
            <CircleDot size={11} strokeWidth={2.5} />
            <span>Strictly One</span>
          </button>

          <button
            type="button"
            onClick={() => {
              beginEdit();
              updateNodeData(id, { allowMultiple: true });
            }}
            className={cn(
              "flex items-center justify-center gap-1.5 rounded-[4px] py-1 text-center font-medium text-[10px] transition cursor-pointer border border-transparent",
              allowMultiple
                ? "bg-accent text-white font-semibold shadow-xs"
                : "text-fg-subtle hover:bg-hover hover:text-fg",
            )}
            title="User can select 1 or more branches to run concurrently (Checkboxes)"
          >
            <CheckSquare size={11} strokeWidth={2.5} />
            <span>Multiple</span>
          </button>
        </div>
      </div>

      {/* Prompt Question Input */}
      <div>
        <label className="mb-1 block text-[10.5px] font-medium text-fg-subtle">
          Prompt message for the user
        </label>
        <textarea
          value={data.message}
          rows={2}
          spellCheck={false}
          autoCapitalize="off"
          autoCorrect="off"
          onFocus={beginEdit}
          onChange={(e) => updateNodeData(id, { message: e.currentTarget.value })}
          onKeyDown={(e) => fieldKeys(e, true)}
          placeholder="e.g. Which environment should we deploy to?"
          className="nodrag nowheel w-full resize-none rounded-[5px] border border-line bg-elevated/60 p-2 text-[11px] leading-[17px] text-fg outline-none transition focus:border-accent"
        />
      </div>

      {/* Connected Target Options Inspector */}
      <div className="border-t border-line/60 pt-2">
        <div className="mb-1.5 flex items-center justify-between">
          <span className="text-[10.5px] font-medium text-fg-subtle">
            Wired target branches
          </span>
          <span className="rounded bg-elevated/80 px-1.5 py-0.5 text-[9.5px] font-mono text-fg-subtle">
            {targetBlocks.length} {targetBlocks.length === 1 ? "option" : "options"}
          </span>
        </div>

        {targetBlocks.length === 0 ? (
          <div className="flex flex-col items-center justify-center rounded-[6px] border border-dashed border-line/80 bg-elevated/20 p-3 text-center">
            <GitFork size={16} className="text-fg-subtle/50 mb-1" />
            <p className="text-[10px] font-medium text-fg-subtle">No target branches wired yet</p>
            <p className="mt-0.5 text-[9px] text-fg-subtle/70">
              Drag wires from this block to 2 or more target blocks. Each becomes an option you can pick at runtime.
            </p>
          </div>
        ) : (
          <ul className="space-y-1">
            {targetBlocks.map((target, index) => {
              const kindConfig = KIND_COLORS[target.kind] ?? {
                badge: "bg-elevated text-fg-subtle border-line",
                text: target.kind,
              };

              return (
                <li
                  key={`${target.id}-${index}`}
                  className="flex items-center gap-1.5 rounded-[5px] border border-line/60 bg-elevated/40 px-2 py-1 transition hover:border-line-strong hover:bg-elevated/70"
                >
                  <span className="flex size-[15px] shrink-0 items-center justify-center rounded-[3px] bg-accent/15 text-[9.5px] font-mono font-bold text-accent">
                    {index + 1}
                  </span>

                  <span
                    className={cn(
                      "rounded px-1 py-0.2 text-[8.5px] font-mono font-semibold border",
                      kindConfig.badge,
                    )}
                  >
                    {kindConfig.text}
                  </span>

                  <span className="truncate text-[10.5px] font-medium text-fg flex-1">
                    {target.label}
                  </span>

                  <ArrowRight size={10} className="text-fg-subtle/60 shrink-0" />
                </li>
              );
            })}
          </ul>
        )}
      </div>

      <Note>
        {allowMultiple
          ? "Multiple choice: Pick any combination of branches to run at runtime."
          : "Single choice: Exactly one chosen branch will run; others are skipped."}
      </Note>
    </NodeShell>
  );
}

export const ChoiceNode = memo(ChoiceNodeImpl);
