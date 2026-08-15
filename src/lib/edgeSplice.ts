import type { FuseEdge, FuseNode } from "@/types/workflow";
import { GRID } from "@/store/workflowStore";

const NOMINAL_WIDTH = 288;
const NOMINAL_HEIGHT = 88;
const MIN_GAP = 40;

function nodeWidth(node: FuseNode): number {
  return node.measured?.width ?? NOMINAL_WIDTH;
}

function nodeHeight(node: FuseNode): number {
  return node.measured?.height ?? NOMINAL_HEIGHT;
}

function snap(val: number): number {
  return Math.round(val / GRID) * GRID;
}

/**
 * Finds an edge that the dragged node is currently hovering over and between.
 * Ignores edges that already connect to the dragged node.
 */
export function findIntersectingEdge(
  draggedNode: FuseNode,
  edges: FuseEdge[],
  nodes: FuseNode[],
): FuseEdge | null {
  if (draggedNode.type === "frame") return null;

  const dW = nodeWidth(draggedNode);
  const dH = nodeHeight(draggedNode);
  const dX = draggedNode.position.x;
  const dY = draggedNode.position.y;
  const dCenterX = dX + dW / 2;
  const dCenterY = dY + dH / 2;

  let bestEdge: FuseEdge | null = null;
  let bestDist = Infinity;

  for (const edge of edges) {
    // Cannot splice into own connections
    if (edge.source === draggedNode.id || edge.target === draggedNode.id) continue;

    const sourceNode = nodes.find((n) => n.id === edge.source);
    const targetNode = nodes.find((n) => n.id === edge.target);
    if (!sourceNode || !targetNode || sourceNode.type === "frame" || targetNode.type === "frame") {
      continue;
    }

    const sW = nodeWidth(sourceNode);
    const sH = nodeHeight(sourceNode);
    const tW = nodeWidth(targetNode);
    const tH = nodeHeight(targetNode);

    const sCenterX = sourceNode.position.x + sW / 2;
    const sCenterY = sourceNode.position.y + sH / 2;
    const tCenterX = targetNode.position.x + tW / 2;
    const tCenterY = targetNode.position.y + tH / 2;

    const vx = tCenterX - sCenterX;
    const vy = tCenterY - sCenterY;
    const lengthSq = vx * vx + vy * vy;
    if (lengthSq < 100) continue;

    // Projection factor t along the segment
    const t = ((dCenterX - sCenterX) * vx + (dCenterY - sCenterY) * vy) / lengthSq;

    // Must be clearly between source and target (not overlapping source or target node centers)
    if (t < 0.12 || t > 0.88) continue;

    // Closest point on the segment
    const projX = sCenterX + t * vx;
    const projY = sCenterY + t * vy;

    // Check if projected point is inside the dragged node's bounding box (with generous grab padding)
    const pad = 24;
    const inBounds =
      projX >= dX - pad &&
      projX <= dX + dW + pad &&
      projY >= dY - pad &&
      projY <= dY + dH + pad;

    if (!inBounds) continue;

    const dist = Math.hypot(dCenterX - projX, dCenterY - projY);
    const maxAllowedDist = Math.max(dW, dH) / 2 + 30;

    if (dist <= maxAllowedDist && dist < bestDist) {
      bestDist = dist;
      bestEdge = edge;
    }
  }

  return bestEdge;
}

export type SpliceLayoutResult = {
  draggedNodePosition: { x: number; y: number };
  nodePositions: Map<string, { x: number; y: number }>;
  assignedFrameId: string | null;
};

/**
 * Computes positions for the inserted node and shifts all downstream nodes
 * if necessary to maintain clean, non-overlapping spacing.
 */
export function calculateSpliceLayout(
  sourceNode: FuseNode,
  targetNode: FuseNode,
  draggedNode: FuseNode,
  allNodes: FuseNode[],
  allEdges: FuseEdge[],
): SpliceLayoutResult {
  const sW = nodeWidth(sourceNode);
  const sH = nodeHeight(sourceNode);
  const dW = nodeWidth(draggedNode);
  const dH = nodeHeight(draggedNode);

  const deltaX = targetNode.position.x - sourceNode.position.x;
  const deltaY = targetNode.position.y - sourceNode.position.y;
  const isHorizontal = Math.abs(deltaX) > Math.abs(deltaY) && deltaX > 0;

  let draggedX: number;
  let draggedY: number;
  let shiftX = 0;
  let shiftY = 0;

  if (isHorizontal) {
    draggedX = snap(sourceNode.position.x + sW + MIN_GAP);
    draggedY = snap(sourceNode.position.y);

    const neededX = snap(draggedX + dW + MIN_GAP);
    if (targetNode.position.x < neededX) {
      shiftX = neededX - targetNode.position.x;
    }
  } else {
    // Vertical flow (default)
    draggedX = snap(sourceNode.position.x);
    draggedY = snap(sourceNode.position.y + sH + MIN_GAP);

    const neededY = snap(draggedY + dH + MIN_GAP);
    if (targetNode.position.y < neededY) {
      shiftY = neededY - targetNode.position.y;
    }
  }

  // BFS downstream from targetNode to find all connected downstream nodes
  const downstreamIds = new Set<string>();
  const queue = [targetNode.id];
  downstreamIds.add(targetNode.id);

  while (queue.length > 0) {
    const currId = queue.shift()!;
    const outgoing = allEdges.filter((e) => e.source === currId);
    for (const e of outgoing) {
      if (e.target !== draggedNode.id && !downstreamIds.has(e.target)) {
        downstreamIds.add(e.target);
        queue.push(e.target);
      }
    }
  }

  const nodePositions = new Map<string, { x: number; y: number }>();

  // If shifting is needed, apply to all downstream nodes
  if (shiftX > 0 || shiftY > 0) {
    for (const node of allNodes) {
      if (node.type === "frame" || node.id === draggedNode.id) continue;
      if (downstreamIds.has(node.id)) {
        nodePositions.set(node.id, {
          x: node.position.x + shiftX,
          y: node.position.y + shiftY,
        });
      }
    }
  }

  // Frame inheritance: if either source or target is in a frame, dragged node inherits it
  const sFrame = "frameId" in sourceNode.data ? sourceNode.data.frameId : null;
  const tFrame = "frameId" in targetNode.data ? targetNode.data.frameId : null;
  const assignedFrameId = sFrame || tFrame || null;

  return {
    draggedNodePosition: { x: draggedX, y: draggedY },
    nodePositions,
    assignedFrameId,
  };
}
