import { memo, useState } from "react";
import {
  BaseEdge,
  EdgeLabelRenderer,
  getBezierPath,
  useInternalNode,
  type EdgeProps,
} from "@xyflow/react";
import { Plus, Power, X } from "lucide-react";
import { useRuntimeStore } from "@/store/runtimeStore";
import { useUIStore } from "@/store/uiStore";
import { useWorkflowStore } from "@/store/workflowStore";
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
  data,
}: EdgeProps) {
  const sourceNode = useInternalNode(source);
  const targetNode = useInternalNode(target);

  const sourceStatus = useRuntimeStore((s) => s.statuses[source] ?? "idle");
  const targetStatus = useRuntimeStore((s) => s.statuses[target] ?? "idle");
  const isDropTarget = useUIStore((s) => s.dropEdgeId === id);
  const storeDisabled = useWorkflowStore(
    (s) => !!s.edges.find((e) => e.id === id)?.data?.disabled,
  );
  const disabled = data?.disabled !== undefined ? !!data.disabled : storeDisabled;

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
    if (disabled) return "disabled";
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
          disabled && "fuse-edge--disabled",
          isDropTarget && "fuse-edge--splice is-selected",
        )}
      >
        <BaseEdge id={id} path={path} markerEnd={markerEnd} style={style} />

        {/* Travelling highlight. `pathLength={1}` normalises the dash units so a
            single set of dash values works for wires of any length. */}
        {!disabled && <path className="fuse-edge-pulse" d={path} pathLength={1} />}

        <circle className="fuse-edge-cap" cx={from.x} cy={from.y} r={2.4} />
      </g>

      {/* Splicing insert preview badge */}
      {isDropTarget && (
        <EdgeLabelRenderer>
          <div
            className="nodrag nopan pointer-events-none absolute z-50 flex items-center gap-1 rounded-full border border-accent/90 bg-accent px-2 py-0.5 text-[10px] font-semibold text-white shadow-[0_0_16px_rgba(91,108,255,0.8)] animate-pulse"
            style={{ transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)` }}
          >
            <Plus size={10} strokeWidth={3} />
            <span>Insert</span>
          </div>
        </EdgeLabelRenderer>
      )}

      {/* Permanent Enable button on disabled wire */}
      {disabled && !isDropTarget && (
        <EdgeLabelRenderer>
          <div
            className="nodrag nopan pointer-events-auto absolute z-40"
            style={{
              position: "absolute",
              transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)`,
              pointerEvents: "all",
            }}
          >
            <button
              type="button"
              title="Connection is disabled. Click to re-enable."
              onPointerDown={(e) => {
                e.preventDefault();
                e.stopPropagation();
              }}
              onMouseDown={(e) => {
                e.preventDefault();
                e.stopPropagation();
              }}
              onClick={(event) => {
                event.preventDefault();
                event.stopPropagation();
                useWorkflowStore.getState().toggleEdgeDisabled(id);
              }}
              className="flex items-center gap-1 rounded-full border border-accent/70 bg-base/95 px-2.5 py-0.5 text-[9.5px] font-bold text-accent shadow-md backdrop-blur hover:bg-accent hover:text-white transition cursor-pointer active:opacity-75 select-none"
            >
              <Power size={9} strokeWidth={2.8} />
              <span>Enable</span>
            </button>
          </div>
        </EdgeLabelRenderer>
      )}

      {/* Cut button: Only shown on active wires when hovered or selected */}
      {!disabled && !isDropTarget && (hovered || selected) && (
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
