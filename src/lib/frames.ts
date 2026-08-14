/**
 * Frame membership.
 *
 * A block belongs to a frame because it was *dropped* into it — the id is
 * stored on the block and nothing else changes it. Moving or resizing a frame
 * never adopts or releases blocks; only dragging a block does.
 *
 * Geometry answers only one question — joining:
 *
 *   Joining  — a block joins the frame its *centre* lands in. You have to
 *              mean it.
 *   Leaving  — dragging never removes a block from its frame. Wherever it is
 *              put down, the frame stretches to keep it, because a box that
 *              sizes itself to its contents has no fixed edge to be "outside"
 *              of. Leaving is the eject button on the block, and nothing else.
 */

import {
  isBlockNode,
  isFrameNode,
  type BlockNodeType,
  type FrameNodeType,
  type FuseNode,
  type XY,
} from "@/types/workflow";

export type Rect = { x: number; y: number; width: number; height: number };

/** A block before React Flow has measured it. */
const NOMINAL_BLOCK = { width: 288, height: 88 };

export function frameRect(frame: FrameNodeType): Rect {
  return {
    x: frame.position.x,
    y: frame.position.y,
    width: frame.data.width,
    height: frame.data.height,
  };
}

export function nodeRect(node: FuseNode): Rect {
  return {
    x: node.position.x,
    y: node.position.y,
    width: node.measured?.width ?? node.width ?? NOMINAL_BLOCK.width,
    height: node.measured?.height ?? node.height ?? NOMINAL_BLOCK.height,
  };
}

export function centreOf(node: FuseNode): XY {
  const rect = nodeRect(node);
  return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
}

export function overlaps(a: Rect, b: Rect): boolean {
  return (
    a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y
  );
}

export function contains(rect: Rect, point: XY): boolean {
  return (
    point.x >= rect.x &&
    point.x <= rect.x + rect.width &&
    point.y >= rect.y &&
    point.y <= rect.y + rect.height
  );
}

export function union(a: Rect, b: Rect): Rect {
  const x = Math.min(a.x, b.x);
  const y = Math.min(a.y, b.y);
  return {
    x,
    y,
    width: Math.max(a.x + a.width, b.x + b.width) - x,
    height: Math.max(a.y + a.height, b.y + b.height) - y,
  };
}

/** The innermost frame holding this point, if any. */
export function frameAt(nodes: FuseNode[], point: XY): FrameNodeType | undefined {
  let best: FrameNodeType | undefined;
  let bestArea = Infinity;

  for (const node of nodes) {
    if (!isFrameNode(node) || !contains(frameRect(node), point)) continue;
    const area = node.data.width * node.data.height;
    if (area < bestArea) {
      best = node;
      bestArea = area;
    }
  }

  return best;
}

/**
 * Which frame a block belongs to once it is put down here.
 *
 * Membership is sticky: a block only ever changes frame by being dropped
 * squarely inside a *different* one. Dragging it into open canvas keeps it
 * where it was and stretches its frame after it — use the block's eject
 * button to take it out.
 */
export function frameOnDrop(block: BlockNodeType, nodes: FuseNode[]): string | null {
  const currentId = block.data.frameId;

  // Landing inside a different frame moves it there.
  const landed = frameAt(nodes, centreOf(block));
  if (landed && landed.id !== currentId) return landed.id;

  return currentId;
}

/** Blocks assigned to this frame, of every kind. */
export function membersOf(frameId: string, nodes: FuseNode[]): BlockNodeType[] {
  return nodes.filter((n) => isBlockNode(n) && n.data.frameId === frameId) as BlockNodeType[];
}

/** Blocks that belong to no frame — what the top-bar "Run all" is for. */
export function looseBlocks(nodes: FuseNode[]): BlockNodeType[] {
  return nodes.filter((n) => isBlockNode(n) && n.data.frameId === null) as BlockNodeType[];
}
