/**
 * Every block exposes four connection bands — one along each side — rather
 * than two dots. Wires render as floating edges (see `edges/geometry.ts`), so
 * which band an edge is stored against never affects how it is drawn; the ids
 * exist only so React Flow can resolve an edge to a real handle.
 */

import { Position } from "@xyflow/react";

export type PortId = "top" | "right" | "bottom" | "left";

export const PORTS: { id: PortId; position: Position; type: "source" }[] = [
  { id: "top", position: Position.Top, type: "source" },
  { id: "left", position: Position.Left, type: "source" },
  { id: "right", position: Position.Right, type: "source" },
  { id: "bottom", position: Position.Bottom, type: "source" },
];

export const SOURCE_PORT: PortId = "bottom";
export const TARGET_PORT: PortId = "top";

/**
 * The two ways out of a condition block.
 *
 * These are handle *ids*, and the engine reads them: a wire leaving `false` is
 * the no path, and everything else — including a wire drawn from an ordinary
 * port — counts as yes. That default is deliberate, so a wire drawn without
 * thinking about ports behaves like the main path rather than never running.
 */
export const TRUE_PORT = "true";
export const FALSE_PORT = "false";
