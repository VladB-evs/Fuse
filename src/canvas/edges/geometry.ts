/**
 * Floating-edge geometry.
 *
 * Wires are not pinned to a handle. Each end is the point where the line
 * between the two blocks crosses the block's outline, recomputed on every
 * render — so a wire slides around the border as blocks move and always
 * enters from the side it is actually coming from.
 */

import { Position } from "@xyflow/react";
import type { InternalNode, Node } from "@xyflow/react";

/** Breathing room between the outline and where the wire stops. */
const GAP = 4;

type Box = { cx: number; cy: number; hw: number; hh: number };

export type Anchor = { x: number; y: number; position: Position };

function boxOf(node: InternalNode<Node>): Box {
  const { x, y } = node.internals.positionAbsolute;
  const w = node.measured.width ?? 0;
  const h = node.measured.height ?? 0;
  return { cx: x + w / 2, cy: y + h / 2, hw: w / 2 + GAP, hh: h / 2 + GAP };
}

/** Where the ray from `box` towards (tx, ty) leaves `box`. */
function exitPoint(box: Box, tx: number, ty: number): Anchor {
  const dx = tx - box.cx;
  const dy = ty - box.cy;

  if (dx === 0 && dy === 0) {
    return { x: box.cx, y: box.cy - box.hh, position: Position.Top };
  }

  const scaleX = dx === 0 ? Infinity : box.hw / Math.abs(dx);
  const scaleY = dy === 0 ? Infinity : box.hh / Math.abs(dy);
  const scale = Math.min(scaleX, scaleY);

  return {
    x: box.cx + dx * scale,
    y: box.cy + dy * scale,
    position:
      scaleX <= scaleY
        ? dx > 0
          ? Position.Right
          : Position.Left
        : dy > 0
          ? Position.Bottom
          : Position.Top,
  };
}

/** Both ends of a wire running between two blocks. */
export function floatingAnchors(
  source: InternalNode<Node>,
  target: InternalNode<Node>,
): { from: Anchor; to: Anchor } {
  const a = boxOf(source);
  const b = boxOf(target);
  return {
    from: exitPoint(a, b.cx, b.cy),
    to: exitPoint(b, a.cx, a.cy),
  };
}

/** The end of a wire that is still following the pointer. */
export function anchorTowards(node: InternalNode<Node>, x: number, y: number): Anchor {
  return exitPoint(boxOf(node), x, y);
}

/** Position the loose end should face, so the curve meets the pointer head-on. */
export function facing(position: Position): Position {
  switch (position) {
    case Position.Left:
      return Position.Right;
    case Position.Right:
      return Position.Left;
    case Position.Top:
      return Position.Bottom;
    default:
      return Position.Top;
  }
}
