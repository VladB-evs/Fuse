import { v4 as uuidv4 } from "uuid";
import type {
  BlockKind,
  NodeKind,
  PersistedEdge,
  PersistedNode,
} from "@/types/workflow";
import { emptyBlock } from "@/store/workflowStore";

export type ParsedFuseData = {
  kind: "workflow" | "blocks" | "single_node";
  name?: string;
  workingDir?: string | null;
  nodes: PersistedNode[];
  edges: PersistedEdge[];
  blockSummary: Record<string, number>;
};

export type ValidationResult = {
  valid: boolean;
  error?: string;
  data?: ParsedFuseData;
};

const VALID_NODE_KINDS: Set<string> = new Set([
  "command",
  "frame",
  "approval",
  "choice",
  "input",
  "script",
  "condition",
  "capture",
  "wait",
  "http",
  "note",
  "read_file",
  "write_file",
  "set_variable",
  "bump_version",
  "ai_commit",
]);

/**
 * Extracts and cleans JSON string from raw input, stripping Markdown code fences
 * or leading/trailing conversational text.
 */
export function sanitizeJsonText(raw: string): string {
  if (!raw) return "";
  let text = raw.trim();

  // Strip UTF-8 BOM if present
  if (text.charCodeAt(0) === 0xfeff) {
    text = text.slice(1).trim();
  }

  // 1. Look for ```json ... ``` or ``` ... ``` markdown fences
  const fenceMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenceMatch && fenceMatch[1]) {
    text = fenceMatch[1].trim();
  }

  // 2. If it still doesn't start with { or [, attempt to find the outer JSON structure
  if (!text.startsWith("{") && !text.startsWith("[")) {
    const firstBrace = text.indexOf("{");
    const firstBracket = text.indexOf("[");

    if (firstBrace !== -1 && (firstBracket === -1 || firstBrace < firstBracket)) {
      const lastBrace = text.lastIndexOf("}");
      if (lastBrace > firstBrace) {
        text = text.substring(firstBrace, lastBrace + 1).trim();
      }
    } else if (firstBracket !== -1) {
      const lastBracket = text.lastIndexOf("]");
      if (lastBracket > firstBracket) {
        text = text.substring(firstBracket, lastBracket + 1).trim();
      }
    }
  }

  return text;
}

/**
 * Safely parses raw text into structured Fuse workflow or block data.
 */
export function parseFuseJson(rawInput: string): ValidationResult {
  const sanitized = sanitizeJsonText(rawInput);
  if (!sanitized) {
    return { valid: false, error: "Input is empty." };
  }

  let parsed: any;
  try {
    parsed = JSON.parse(sanitized);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return {
      valid: false,
      error: `Invalid JSON syntax: ${msg}`,
    };
  }

  if (!parsed || typeof parsed !== "object") {
    return {
      valid: false,
      error: "JSON must be an object or an array.",
    };
  }

  let rawNodes: any[] = [];
  let rawEdges: any[] = [];
  let name: string | undefined = undefined;
  let workingDir: string | null = null;
  let kind: ParsedFuseData["kind"] = "blocks";

  // Case 1: Array of nodes directly e.g. [ { type: "command", data: {...} } ]
  if (Array.isArray(parsed)) {
    rawNodes = parsed;
    kind = "blocks";
  }
  // Case 2: Full Workflow Document ({ id, name, nodes, edges, ... })
  else if (parsed.nodes && Array.isArray(parsed.nodes) && (parsed.id || parsed.name || parsed.updatedAt !== undefined)) {
    rawNodes = parsed.nodes;
    rawEdges = Array.isArray(parsed.edges) ? parsed.edges : [];
    name = typeof parsed.name === "string" ? parsed.name : undefined;
    workingDir = typeof parsed.workingDir === "string" ? parsed.workingDir : null;
    kind = "workflow";
  }
  // Case 3: Partial Fuse Export ({ type: "fuse_export", nodes: [...], edges: [...] }) or generic { nodes, edges }
  else if (parsed.nodes && Array.isArray(parsed.nodes)) {
    rawNodes = parsed.nodes;
    rawEdges = Array.isArray(parsed.edges) ? parsed.edges : [];
    kind = "blocks";
  }
  // Case 4: Single Node object ({ type: "command", data: {...} } or { id, type, position, data })
  else if (parsed.type && VALID_NODE_KINDS.has(parsed.type)) {
    rawNodes = [parsed];
    kind = "single_node";
  } else {
    return {
      valid: false,
      error: "Unrecognized format. Expected a Fuse workflow document, export object, or list of nodes.",
    };
  }

  if (rawNodes.length === 0) {
    return {
      valid: false,
      error: "No blocks or nodes found in the provided JSON.",
    };
  }

  // Validate and normalize nodes
  const normalizedNodes: PersistedNode[] = [];
  const blockSummary: Record<string, number> = {};

  for (let i = 0; i < rawNodes.length; i++) {
    const item = rawNodes[i];
    if (!item || typeof item !== "object") {
      return {
        valid: false,
        error: `Node at index ${i} is not a valid object.`,
      };
    }

    const nodeType: NodeKind = item.type && VALID_NODE_KINDS.has(item.type) ? item.type : "command";
    const id = typeof item.id === "string" && item.id.trim() ? item.id : uuidv4();
    const position =
      item.position && typeof item.position.x === "number" && typeof item.position.y === "number"
        ? { x: item.position.x, y: item.position.y }
        : { x: (i % 3) * 320, y: Math.floor(i / 3) * 160 };

    let data: any;
    if (nodeType === "frame") {
      data = {
        label: item.data?.label || "Frame",
        workingDir: item.data?.workingDir ?? null,
        width: typeof item.data?.width === "number" ? item.data.width : 480,
        height: typeof item.data?.height === "number" ? item.data.height : 360,
        color: item.data?.color ?? "default",
      };
    } else {
      const defaults = emptyBlock(nodeType as BlockKind);
      data = {
        ...defaults,
        ...(item.data || {}),
      };
      if (item.data?.frameId !== undefined) {
        data.frameId = item.data.frameId;
      }
    }

    normalizedNodes.push({
      id,
      position,
      type: nodeType as any,
      data,
    });

    blockSummary[nodeType] = (blockSummary[nodeType] || 0) + 1;
  }

  // Validate and normalize edges
  const normalizedEdges: PersistedEdge[] = [];
  for (let j = 0; j < rawEdges.length; j++) {
    const e = rawEdges[j];
    if (e && typeof e === "object" && typeof e.source === "string" && typeof e.target === "string") {
      normalizedEdges.push({
        id: typeof e.id === "string" && e.id.trim() ? e.id : uuidv4(),
        source: e.source,
        target: e.target,
        sourceHandle: e.sourceHandle ?? null,
        targetHandle: e.targetHandle ?? null,
        disabled: !!e.disabled,
      });
    }
  }

  return {
    valid: true,
    data: {
      kind,
      name,
      workingDir,
      nodes: normalizedNodes,
      edges: normalizedEdges,
      blockSummary,
    },
  };
}

/**
 * Prepares imported nodes and edges for insertion into a canvas:
 * 1. Remaps all node IDs to prevent UUID collisions.
 * 2. Remaps edge sources, targets, and child `frameId`s.
 * 3. Shifts coordinates so imported blocks spawn cleanly at the target location or offset.
 */
export function prepareImportedNodesAndEdges(
  data: ParsedFuseData,
  targetPosition?: { x: number; y: number },
): { nodes: PersistedNode[]; edges: PersistedEdge[] } {
  const idMap = new Map<string, string>();
  data.nodes.forEach((n) => idMap.set(n.id, uuidv4()));

  // Calculate bounding box of the imported nodes
  let minX = Infinity;
  let minY = Infinity;
  data.nodes.forEach((n) => {
    if (n.position.x < minX) minX = n.position.x;
    if (n.position.y < minY) minY = n.position.y;
  });

  const hasFiniteOrigin = Number.isFinite(minX) && Number.isFinite(minY);
  const originX = hasFiniteOrigin ? minX : 0;
  const originY = hasFiniteOrigin ? minY : 0;

  // Determine positional offset
  const offsetX = targetPosition ? targetPosition.x - originX : 40;
  const offsetY = targetPosition ? targetPosition.y - originY : 40;

  const newNodes = data.nodes.map((n) => {
    const newId = idMap.get(n.id)!;
    const clonedPos = targetPosition
      ? { x: n.position.x + offsetX, y: n.position.y + offsetY }
      : { x: n.position.x + offsetX, y: n.position.y + offsetY };

    let clonedData = { ...n.data };
    if (n.type !== "frame" && "frameId" in clonedData && typeof clonedData.frameId === "string") {
      const fId = clonedData.frameId;
      if (idMap.has(fId)) {
        clonedData.frameId = idMap.get(fId)!;
      } else {
        clonedData.frameId = null;
      }
    }

    return {
      ...n,
      id: newId,
      position: clonedPos,
      data: clonedData,
    } as PersistedNode;
  });

  const newEdges = data.edges.map((e) => ({
    ...e,
    id: uuidv4(),
    source: idMap.get(e.source) || e.source,
    target: idMap.get(e.target) || e.target,
  }));

  return { nodes: newNodes, edges: newEdges };
}
