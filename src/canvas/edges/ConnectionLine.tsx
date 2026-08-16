import { getBezierPath, type ConnectionLineComponentProps } from "@xyflow/react";
import { anchorTowards, facing } from "./geometry";
import { cn } from "@/lib/utils";

/**
 * The wire being dragged. It leaves the block from wherever the pointer is
 * pulling, not from a fixed dot, and reads as "live" until it lands.
 */
export function ConnectionLine({
  fromNode,
  toX,
  toY,
  connectionStatus,
}: ConnectionLineComponentProps) {
  const from = anchorTowards(fromNode, toX, toY);

  const [path] = getBezierPath({
    sourceX: from.x,
    sourceY: from.y,
    sourcePosition: from.position,
    targetX: toX,
    targetY: toY,
    targetPosition: facing(from.position),
    curvature: 0.32,
  });

  return (
    <g className={cn("fuse-link", connectionStatus === "invalid" && "is-invalid")}>
      <path className="fuse-link-glow" d={path} />
      <path className="fuse-link-path" d={path} pathLength={1} />
      <circle className="fuse-link-origin" cx={from.x} cy={from.y} r={4.2} />
      <circle className="fuse-link-tip" cx={toX} cy={toY} r={4.8} />
    </g>
  );
}
