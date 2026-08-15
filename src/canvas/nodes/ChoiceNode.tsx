import { memo, useMemo } from "react";
import { type NodeProps } from "@xyflow/react";
import { useWorkflowStore } from "@/store/workflowStore";
import { CodeArea, NodeShell, Note, Toggle } from "./NodeShell";
import { cn } from "@/lib/utils";
import { isBlockNode, type BlockNodeType, type ChoiceNodeType } from "@/types/workflow";

/**
 * A fork in the workflow.
 *
 * The options are not configured here — they *are* the wires leaving this
 * block, listed live so the card and the canvas can never disagree about what
 * will be on offer. Paths not chosen at run time are skipped, along with
 * everything hanging off them.
 */
function ChoiceNodeImpl({ id, data, selected }: NodeProps<ChoiceNodeType>) {
  const updateNodeData = useWorkflowStore((s) => s.updateNodeData);
  const beginEdit = useWorkflowStore((s) => s.beginEdit);

  // Selected as two stable references and joined here: a selector that built
  // the list itself would hand back a fresh array on every store read, which
  // zustand compares by identity and treats as a change — a render loop.
  const nodes = useWorkflowStore((s) => s.nodes);
  const edges = useWorkflowStore((s) => s.edges);

  const options = useMemo(() => {
    const targets = new Set(
      edges
        .filter((e) => e.source === id && !e.data?.disabled)
        .map((e) => e.target),
    );
    return [...targets]
      .map((target) => nodes.find((n) => n.id === target))
      .filter((n): n is BlockNodeType => !!n && isBlockNode(n) && !(n.data as any)?.disabled)
      .map((n) => n.data.label || "Untitled");
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
      <CodeArea
        value={data.message}
        rows={2}
        placeholder="What is the choice about?"
        onCommit={beginEdit}
        onChange={(message) => updateNodeData(id, { message })}
      />

      <div className="border-t border-line/60 pt-2">
        {options.length === 0 ? (
          <Note>Wire this block to two or more steps — each becomes an option.</Note>
        ) : (
          <ul className="space-y-[3px]">
            {options.map((option, index) => (
              <li
                key={`${option}-${index}`}
                className="flex items-center gap-1.5 text-[10.5px] text-fg-muted"
              >
                <span
                  className={cn(
                    "flex size-[14px] shrink-0 items-center justify-center rounded-[3px]",
                    "bg-accent/12 text-[9px] font-medium tabular-nums text-accent",
                  )}
                >
                  {index + 1}
                </span>
                <span className="truncate">{option}</span>
              </li>
            ))}
          </ul>
        )}

        <div className="mt-2">
          <Toggle
            checked={data.allowMultiple}
            onChange={(allowMultiple) => {
              beginEdit();
              updateNodeData(id, { allowMultiple });
            }}
          >
            Allow more than one path
          </Toggle>
        </div>
      </div>
    </NodeShell>
  );
}

export const ChoiceNode = memo(ChoiceNodeImpl);
