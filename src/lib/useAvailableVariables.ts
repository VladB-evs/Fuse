/**
 * Scans the workflow for variables that nodes produce.
 *
 * Used by CommandNode (and potentially other nodes) to let users pick from
 * available variables instead of having to type `{{name}}` by hand.
 */

import { useMemo } from "react";
import { useWorkflowStore } from "@/store/workflowStore";
import { isBlockNode } from "@/types/workflow";

export type AvailableVariable = {
  /** The variable name, e.g. "next_version". */
  name: string;
  /** The human-readable label of the node that produces it. */
  sourceLabel: string;
  /** The node type that produces it, e.g. "bump_version". */
  sourceKind: string;
};

/** Returns every variable that any node in the workflow will produce. */
export function useAvailableVariables(): AvailableVariable[] {
  const nodes = useWorkflowStore((s) => s.nodes);

  return useMemo(() => {
    const vars: AvailableVariable[] = [];

    for (const node of nodes) {
      if (!isBlockNode(node)) continue;
      const d = node.data as Record<string, unknown>;

      // Nodes that expose a `variable` field.
      if (
        (node.type === "input" ||
          node.type === "capture" ||
          node.type === "read_file" ||
          node.type === "set_variable" ||
          node.type === "http" ||
          node.type === "ai_commit") &&
        typeof d.variable === "string" &&
        d.variable.trim()
      ) {
        vars.push({
          name: d.variable.trim(),
          sourceLabel: (d.label as string) || node.type,
          sourceKind: node.type,
        });
      }

      // bump_version exposes `variableOut`.
      if (
        node.type === "bump_version" &&
        typeof d.variableOut === "string" &&
        d.variableOut.trim()
      ) {
        vars.push({
          name: d.variableOut.trim(),
          sourceLabel: (d.label as string) || "Bump Version",
          sourceKind: node.type,
        });
      }
    }

    // Deduplicate by name — first writer wins.
    const seen = new Set<string>();
    return vars.filter((v) => {
      if (seen.has(v.name)) return false;
      seen.add(v.name);
      return true;
    });
  }, [nodes]);
}
