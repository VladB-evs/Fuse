/**
 * Laser Slicer geometry and intersection detection.
 *
 * Checks whether a laser cut stroke (a 2D line segment or polyline)
 * crosses nodes (bounding boxes) or edges (sampled bezier curves).
 */

import { nodeRect, type Rect } from "./frames";
import type { FuseEdge, FuseNode } from "@/types/workflow";

export type Point = { x: number; y: number };

/**
 * Returns true if segment (a -> b) intersects segment (c -> d).
 */
export function segmentsIntersect(a: Point, b: Point, c: Point, d: Point): boolean {
  const ccw = (p1: Point, p2: Point, p3: Point) => {
    return (p3.y - p1.y) * (p2.x - p1.x) > (p2.y - p1.y) * (p3.x - p1.x);
  };

  const ab_c = ccw(a, b, c);
  const ab_d = ccw(a, b, d);
  const cd_a = ccw(c, d, a);
  const cd_b = ccw(c, d, b);

  return ab_c !== ab_d && cd_a !== cd_b;
}

/**
 * Returns true if a point is inside a rectangle.
 */
export function pointInRect(p: Point, r: Rect): boolean {
  return p.x >= r.x && p.x <= r.x + r.width && p.y >= r.y && p.y <= r.y + r.height;
}

/**
 * Checks if a laser stroke segment (p1 -> p2) cuts through a node's bounding box.
 */
export function checkNodeSlice(p1: Point, p2: Point, node: FuseNode): boolean {
  if (node.type === "frame") return false; // Slicing applies to blocks

  const rect = nodeRect(node);
  const topLeft: Point = { x: rect.x, y: rect.y };
  const topRight: Point = { x: rect.x + rect.width, y: rect.y };
  const bottomLeft: Point = { x: rect.x, y: rect.y + rect.height };
  const bottomRight: Point = { x: rect.x + rect.width, y: rect.y + rect.height };

  // If either point is inside the node, or line crosses any of the 4 borders
  if (pointInRect(p1, rect) || pointInRect(p2, rect)) {
    return true;
  }

  return (
    segmentsIntersect(p1, p2, topLeft, topRight) ||
    segmentsIntersect(p1, p2, topRight, bottomRight) ||
    segmentsIntersect(p1, p2, bottomRight, bottomLeft) ||
    segmentsIntersect(p1, p2, bottomLeft, topLeft) ||
    segmentsIntersect(p1, p2, topLeft, bottomRight) ||
    segmentsIntersect(p1, p2, topRight, bottomLeft)
  );
}

/**
 * Evaluates a cubic bezier curve at parameter t (0 <= t <= 1).
 */
function cubicBezier(p0: Point, p1: Point, p2: Point, p3: Point, t: number): Point {
  const cx = 3 * (p1.x - p0.x);
  const bx = 3 * (p2.x - p1.x) - cx;
  const ax = p3.x - p0.x - cx - bx;

  const cy = 3 * (p1.y - p0.y);
  const by = 3 * (p2.y - p1.y) - cy;
  const ay = p3.y - p0.y - cy - by;

  const tSquared = t * t;
  const tCubed = tSquared * t;

  return {
    x: ax * tCubed + bx * tSquared + cx * t + p0.x,
    y: ay * tCubed + by * tSquared + cy * t + p0.y,
  };
}

/**
 * Checks if a laser stroke segment (p1 -> p2) crosses an edge connecting source and target nodes.
 */
export function checkEdgeSlice(
  p1: Point,
  p2: Point,
  edge: FuseEdge,
  nodes: FuseNode[],
): boolean {
  const sourceNode = nodes.find((n) => n.id === edge.source);
  const targetNode = nodes.find((n) => n.id === edge.target);
  if (!sourceNode || !targetNode) return false;

  const sRect = nodeRect(sourceNode);
  const tRect = nodeRect(targetNode);

  const sCenter: Point = { x: sRect.x + sRect.width / 2, y: sRect.y + sRect.height / 2 };
  const tCenter: Point = { x: tRect.x + tRect.width / 2, y: tRect.y + tRect.height / 2 };

  // Quick check: direct center-to-center segment intersection
  if (segmentsIntersect(p1, p2, sCenter, tCenter)) {
    return true;
  }

  // Anchor points
  const start: Point = {
    x: sRect.x + sRect.width / 2,
    y: sRect.y + (tCenter.y > sCenter.y ? sRect.height : 0),
  };
  const end: Point = {
    x: tRect.x + tRect.width / 2,
    y: tRect.y + (sCenter.y > tCenter.y ? tRect.height : 0),
  };

  const dx = Math.abs(end.x - start.x);
  const dy = Math.abs(end.y - start.y);
  const cp1: Point = { x: start.x + (end.x > start.x ? dx * 0.35 : -dx * 0.35), y: start.y + dy * 0.5 };
  const cp2: Point = { x: end.x + (start.x > end.x ? dx * 0.35 : -dx * 0.35), y: end.y - dy * 0.5 };

  // Sample 16 piecewise segments along the curve
  const SAMPLES = 16;
  let prev = start;
  for (let i = 1; i <= SAMPLES; i++) {
    const t = i / SAMPLES;
    const curr = cubicBezier(start, cp1, cp2, end, t);
    if (segmentsIntersect(p1, p2, prev, curr)) {
      return true;
    }
    prev = curr;
  }

  return false;
}
