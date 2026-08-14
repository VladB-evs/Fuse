import { memo, useState } from "react";
import {
  BaseEdge,
  EdgeLabelRenderer,
  getBezierPath,
  useInternalNode,
  type EdgeProps,
} from "@xyflow/react";
import { X } from "lucide-react";
import { useRuntimeStore } from "@/store/runtimeStore";
import { floatingAnchors } from "./geometry";
import { disconnectEdge } from "@/lib/actions";
import { FALSE_PORT } from "@/canvas/ports";
import { cn } from "@/lib/utils";

/**
 * Connection wire.
 *
 * Both ends float on the block outline instead of sitting on a fixed handle,
 * so the curve always leaves and enters from the side the other block is on.
 * A short highlight travels along the path to show direction of flow; it
 * speeds up and brightens while the block it feeds is executing.
 */
function FlowEdgeImpl({
  id,
  source,
  target,
  sourceHandleId,
  markerEnd,
  style,
  selected,
}: EdgeProps) {
  const sourceNode = useInternalNode(source);
  const targetNode = useInternalNode(target);

  const sourceStatus = useRuntimeStore((s) => s.statuses[source] ?? "idle");
  const targetStatus = useRuntimeStore((s) => s.statuses[target] ?? "idle");

  const [hovered, setHovered] = useState(false);

  if (!sourceNode || !targetNode) return null;

  const { from, to } = floatingAnchors(sourceNode, targetNode);

  const [path, labelX, labelY] = getBezierPath({
    sourceX: from.x,
    sourceY: from.y,
    sourcePosition: from.position,
    targetX: to.x,
    targetY: to.y,
    targetPosition: to.position,
    curvature: 0.32,
  });

  const state = (() => {
    // A wire feeding a step that is waiting on the user is where the run has
    // actually got to, so it reads as live rather than idle.
    if (targetStatus === "waiting") return "waiting";
    if (targetStatus === "running") return "running";
    if (targetStatus === "skipped") return "skipped";
    if (sourceStatus === "failed" || sourceStatus === "cancelled") return "stopped";
    if (sourceStatus === "success" && targetStatus === "success") return "done";
    return "idle";
  })();

  // A wire out of a condition's "no" port is worth calling out: which port it
  // left from is the whole difference between the two branches.
  const negative = sourceHandleId === FALSE_PORT;

  return (
    <>
      <g
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
        className={cn(
          "fuse-edge",
          `fuse-edge--${state}`,
          selected && "is-selected",
          negative && "fuse-edge--no",
        )}
      >
        <BaseEdge id={id} path={path} markerEnd={markerEnd} style={style} />

        {/* Travelling highlight. `pathLength={1}` normalises the dash units so a
            single set of dash values works for wires of any length. */}
        <path className="fuse-edge-pulse" d={path} pathLength={1} />

        <circle className="fuse-edge-cap" cx={from.x} cy={from.y} r={2.4} />
      </g>

      {/* Cut. Hidden until the wire is hovered or selected, so a canvas full of
          wires is not also a canvas full of buttons. */}
      {(hovered || selected) && (
        <EdgeLabelRenderer>
          <button
            type="button"
            aria-label="Disconnect"
            title="Disconnect  (or drag either end off the block)"
            onMouseEnter={() => setHovered(true)}
            onMouseLeave={() => setHovered(false)}
            onClick={(event) => {
              event.stopPropagation();
              disconnectEdge(id);
            }}
            className="fuse-edge-cut nodrag nopan"
            style={{ transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)` }}
          >
            <X size={10} strokeWidth={2.5} />
          </button>
        </EdgeLabelRenderer>
      )}
    </>
  );
}

export const FlowEdge = memo(FlowEdgeImpl);
