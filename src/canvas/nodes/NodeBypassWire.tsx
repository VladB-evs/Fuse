import { memo } from "react";
import { useInternalNode, useStoreApi } from "@xyflow/react";
import { useWorkflowStore } from "@/store/workflowStore";
import { floatingAnchors } from "@/canvas/edges/geometry";

type NodeBypassWireProps = {
  nodeId: string;
  disabled?: boolean;
};

export const NodeBypassWire = memo(function NodeBypassWire({
  nodeId,
  disabled,
}: NodeBypassWireProps) {
  const store = useStoreApi();
  const edges = useWorkflowStore((s) => s.edges);
  const thisNode = useInternalNode(nodeId);

  if (!disabled || !thisNode) return null;

  const width = thisNode.measured?.width ?? 288;
  const height = thisNode.measured?.height ?? 120;
  const thisPos = thisNode.internals?.positionAbsolute ?? { x: 0, y: 0 };

  const inEdges = edges.filter((e) => e.target === nodeId);
  const outEdges = edges.filter((e) => e.source === nodeId);

  // Calculate local entry points (in local card coords)
  const inAnchors: { x: number; y: number }[] = [];
  for (const edge of inEdges) {
    const srcNode = store.getState().nodeLookup.get(edge.source);
    if (srcNode) {
      try {
        const { to } = floatingAnchors(srcNode, thisNode);
        inAnchors.push({
          x: Math.max(0, Math.min(width, to.x - thisPos.x)),
          y: Math.max(0, Math.min(height, to.y - thisPos.y)),
        });
      } catch {
        // Fallback if node lookup is pending
      }
    }
  }

  // Calculate local exit points (in local card coords)
  const outAnchors: { x: number; y: number }[] = [];
  for (const edge of outEdges) {
    const tgtNode = store.getState().nodeLookup.get(edge.target);
    if (tgtNode) {
      try {
        const { from } = floatingAnchors(thisNode, tgtNode);
        outAnchors.push({
          x: Math.max(0, Math.min(width, from.x - thisPos.x)),
          y: Math.max(0, Math.min(height, from.y - thisPos.y)),
        });
      } catch {
        // Fallback if node lookup is pending
      }
    }
  }

  // Fallbacks if one or both sides have no connections
  const defaultIn = { x: 0, y: height / 2 };
  const defaultOut = { x: width, y: height / 2 };

  const pairs: { p1: { x: number; y: number }; p2: { x: number; y: number } }[] = [];

  if (inAnchors.length > 0 && outAnchors.length > 0) {
    for (const p1 of inAnchors) {
      for (const p2 of outAnchors) {
        pairs.push({ p1, p2 });
      }
    }
  } else if (inAnchors.length > 0) {
    for (const p1 of inAnchors) {
      pairs.push({ p1, p2: { x: width, y: p1.y } });
    }
  } else if (outAnchors.length > 0) {
    for (const p2 of outAnchors) {
      pairs.push({ p1: { x: 0, y: p2.y }, p2 });
    }
  } else {
    pairs.push({ p1: defaultIn, p2: defaultOut });
  }

  return (
    <svg className="pointer-events-none absolute inset-0 z-30 h-full w-full overflow-visible">
      {pairs.map(({ p1, p2 }, idx) => {
        const dx = Math.max(20, Math.abs(p2.x - p1.x) * 0.5);
        const path = `M ${p1.x} ${p1.y} C ${p1.x + dx} ${p1.y}, ${p2.x - dx} ${p2.y}, ${p2.x} ${p2.y}`;
        return (
          <g key={idx}>
            {/* Base dashed line */}
            <path d={path} className="fuse-bypass-base-wire" />
            {/* Blue travelling highlight pulse — exact same animation as normal lines */}
            <path d={path} pathLength={1} className="fuse-bypass-pulse" />
            {/* Connection end caps */}
            <circle cx={p1.x} cy={p1.y} r={2.8} className="fuse-bypass-cap" />
            <circle cx={p2.x} cy={p2.y} r={2.8} className="fuse-bypass-cap" />
          </g>
        );
      })}
    </svg>
  );
});
