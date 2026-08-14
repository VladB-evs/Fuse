/**
 * The workflow document: nodes, edges, name, working directory, undo history.
 *
 * This store holds *only* things that get saved to disk. Live execution state
 * lives in `runtimeStore` so a run never dirties the document.
 */

import { create } from "zustand";
import {
  addEdge,
  applyEdgeChanges,
  applyNodeChanges,
  type Connection,
  type EdgeChange,
  type NodeChange,
} from "@xyflow/react";
import { newId } from "@/lib/id";
import { placeholdersIn } from "@/lib/placeholders";
import { SOURCE_PORT, TARGET_PORT } from "@/canvas/ports";
import {
  frameAt,
  frameOnDrop,
  frameRect,
  membersOf,
  nodeRect,
  union,
  type Rect,
} from "@/lib/frames";
import {
  isBlockNode,
  isCommandNode,
  isFrameNode,
  type BlockData,
  type BlockKind,
  type BlockNodeType,
  type CommandData,
  type FrameData,
  type FrameNodeType,
  type FuseEdge,
  type FuseNode,
  type PersistedNode,
  type WorkflowDocument,
} from "@/types/workflow";

export const GRID = 16;
const HISTORY_LIMIT = 100;
/** Vertical gap used when chaining a new block below the selected one. */
const CHAIN_OFFSET = 148;

type Snapshot = {
  nodes: FuseNode[];
  edges: FuseEdge[];
  name: string;
  workingDir: string | null;
};

export type WorkflowState = {
  id: string;
  name: string;
  workingDir: string | null;
  nodes: FuseNode[];
  edges: FuseEdge[];
  dirty: boolean;
  createdAt: number;
  updatedAt: number;

  past: Snapshot[];
  future: Snapshot[];

  onNodesChange: (changes: NodeChange<FuseNode>[]) => void;
  onEdgesChange: (changes: EdgeChange<FuseEdge>[]) => void;
  onConnect: (connection: Connection) => void;
  recomputeFrames: () => void;
  /** Cut one wire. */
  disconnect: (edgeId: string) => void;
  /** Cut every wire in or out of these blocks. */
  disconnectNodes: (nodeIds: string[]) => number;
  /** Move an existing wire's end onto a different block. */
  reconnect: (edgeId: string, connection: Connection) => void;

  /** Returns the new node id so the caller can focus it. */
  addBlockNode: (kind: BlockKind, options?: { position?: { x: number; y: number }; frameId?: string | null; prefill?: Partial<BlockData> }) => string;
  addFrameNode: (options?: { position?: { x: number; y: number } }) => string;
  updateNodeData: (id: string, patch: Partial<BlockData>) => void;
  updateFrameData: (id: string, patch: Partial<FrameData>) => void;
  /** Which frame a block would end up in if dropped where it is now. */
  frameOnDropFor: (nodeId: string) => string | null;
  /** Take a block out of its frame and park it just outside. */
  releaseFromFrame: (nodeId: string) => void;
  deleteNodes: (ids: string[]) => void;
  deleteSelected: () => void;
  duplicateSelected: () => string[];

  setName: (name: string) => void;
  setWorkingDir: (dir: string | null) => void;

  /** Snapshot before a burst of edits (e.g. typing) so undo is one step. */
  beginEdit: () => void;

  undo: () => void;
  redo: () => void;

  loadDocument: (doc: WorkflowDocument) => void;
  resetWorkflow: () => void;
  toDocument: () => WorkflowDocument;
  markSaved: (doc: WorkflowDocument) => void;
};

function cloneNode(node: FuseNode): FuseNode {
  const data: Record<string, unknown> = { ...node.data };
  // The two fields that are objects rather than values, so a copy is not a
  // copy until they are cloned too.
  if ("env" in data && data.env) data.env = { ...(data.env as object) };
  if ("headers" in data && data.headers) data.headers = { ...(data.headers as object) };
  return { ...node, data } as FuseNode;
}

function snapshotOf(state: WorkflowState): Snapshot {
  return {
    nodes: state.nodes.map(cloneNode),
    edges: state.edges.map((e) => ({ ...e })),
    name: state.name,
    workingDir: state.workingDir,
  };
}

/**
 * React Flow drops any edge whose handle it cannot resolve, so every edge —
 * including ones loaded from documents written before blocks had named ports —
 * gets a real handle on both ends. Wires are drawn as floating edges, so which
 * port an edge names has no effect on where it is painted.
 */
function withPorts(edge: FuseEdge): FuseEdge {
  return {
    ...edge,
    sourceHandle: edge.sourceHandle ?? SOURCE_PORT,
    targetHandle: edge.targetHandle ?? TARGET_PORT,
  };
}

function snap(value: number): number {
  return Math.round(value / GRID) * GRID;
}

/**
 * Frames size themselves.
 *
 * A frame is the bounding box of the blocks assigned to it plus padding,
 * recomputed whenever anything moves, grows, joins or leaves. There is no
 * resize handle: the rectangle is a *consequence* of its contents, so it can
 * never disagree with them.
 *
 * Mid-drag it behaves differently, and the difference is the whole point:
 *
 *   * It never shrinks. `held` is each frame's outline from before the drag,
 *     and the box stays at least that big until the block lands — otherwise
 *     the frame would collapse away from the block under the cursor.
 *   * It *grows* to follow a block being dragged, however far that block
 *     goes. Membership is not geometry: a member stays a member until it is
 *     ejected, so the frame's job is to keep showing that it holds it.
 */
function fitFrames(
  nodes: FuseNode[],
  held = new Map<string, Rect>(),
  settled = false,
): FuseNode[] {
  const same = (a: number, b: number) => Math.abs(a - b) < 0.5;
  let changed = false;

  const box = (node: FrameNodeType, rect: Rect): FuseNode =>
    sizedFrame({
      ...node,
      position: { x: rect.x, y: rect.y },
      data: { ...node.data, width: rect.width, height: rect.height },
    });

  const next = nodes.map((node) => {
    if (!isFrameNode(node)) return node;

    const remembered = held.get(node.id);
    // Once the drag is over the frame is free to shrink again.
    const floor = settled ? undefined : remembered;

    const members = membersOf(node.id, nodes);
    if (members.length === 0) {
      // Its last block was just ejected, and the frame may have stretched to
      // follow it. Put it back to the size it was before that drag.
      if (settled && remembered && !same(node.data.width, remembered.width)) {
        changed = true;
        return box(node, remembered);
      }
      return node;
    }

    let content = nodeRect(members[0]!);
    for (const member of members.slice(1)) content = union(content, nodeRect(member));

    let fitted: Rect = {
      x: content.x - FRAME_PAD,
      y: content.y - FRAME_PAD,
      width: Math.max(FRAME_MIN.width, content.width + FRAME_PAD * 2),
      height: Math.max(FRAME_MIN.height, content.height + FRAME_PAD * 2),
    };

    // Never smaller than it was when the drag began.
    if (floor) fitted = union(fitted, floor);

    if (
      same(node.position.x, fitted.x) &&
      same(node.position.y, fitted.y) &&
      same(node.data.width, fitted.width) &&
      same(node.data.height, fitted.height)
    ) {
      return node;
    }

    changed = true;
    return box(node, fitted);
  });

  return changed ? next : nodes;
}

/** Deleting a frame frees its blocks rather than leaving them pointing at a ghost. */
function released(nodes: FuseNode[], removedIds: Set<string>): FuseNode[] {
  return nodes.map((node) =>
    isBlockNode(node) && node.data.frameId && removedIds.has(node.data.frameId)
      ? ({ ...node, data: { ...node.data, frameId: null } } as FuseNode)
      : node,
  );
}

function emptyCommand(label = "Terminal"): CommandData {
  return {
    label,
    command: "",
    workingDir: null,
    frameId: null,
    env: {},
    continueOnError: false,
  };
}

/**
 * A fresh block of each kind.
 *
 * These defaults are the Rust ones (`impl Default` in `model.rs`) written out
 * again, so a block created here and a block loaded from disk are identical.
 */
export function emptyBlock(kind: BlockKind): BlockData {
  switch (kind) {
    case "command":
      return emptyCommand();
    case "approval":
      return {
        label: "Confirm",
        frameId: null,
        message: "Check the output above. Continue?",
        continueLabel: "Continue",
        stopLabel: "Stop",
      };
    case "choice":
      return {
        label: "Choose",
        frameId: null,
        message: "Which path should run next?",
        allowMultiple: false,
      };
    case "input":
      return {
        label: "Ask",
        frameId: null,
        message: "Value for this run",
        variable: "",
        defaultValue: "",
        secret: false,
      };
    case "script":
      return {
        label: "Script",
        frameId: null,
        interpreter: "bash",
        script: "",
        workingDir: null,
        env: {},
        continueOnError: false,
      };
    case "condition":
      return {
        label: "If",
        frameId: null,
        test: "",
        workingDir: null,
        trueLabel: "Yes",
        falseLabel: "No",
      };
    case "capture":
      return {
        label: "Capture",
        frameId: null,
        command: "",
        variable: "",
        workingDir: null,
        firstLineOnly: true,
        continueOnError: false,
      };
    case "wait":
      return {
        label: "Wait",
        frameId: null,
        seconds: 2,
        until: "",
        intervalSeconds: 1,
        timeoutSeconds: 60,
        workingDir: null,
      };
    case "http":
      return {
        label: "HTTP",
        frameId: null,
        method: "GET",
        url: "",
        headers: {},
        body: "",
        variable: "",
        failOnErrorStatus: true,
        workingDir: null,
      };
    case "note":
      return {
        label: "Note",
        frameId: null,
        text: "",
      };
    case "read_file":
      return {
        label: "Read File",
        frameId: null,
        path: "",
        variable: "",
        workingDir: null,
        continueOnError: false,
      };
    case "write_file":
      return {
        label: "Write File",
        frameId: null,
        path: "",
        content: "",
        workingDir: null,
        continueOnError: false,
      };
    case "set_variable":
      return {
        label: "Set Variable",
        frameId: null,
        variable: "",
        value: "",
      };
    case "bump_version":
      return {
        label: "Bump Version",
        frameId: null,
        variableIn: "",
        variableOut: "",
        part: "patch",
      };
    case "ai_commit":
      return {
        label: "AI Commit Summary",
        frameId: null,
        variable: "commit_message",
        scope: "staged",
        style: "conventional",
        workingDir: null,
        continueOnError: false,
      };
  }
}

const FRAME_SIZE = { width: 480, height: 360 };

/**
 * Stacking. Frames are backdrops and blocks sit on them, so the order is
 * fixed rather than left to React Flow's "raise whatever is selected" — that
 * is what used to lift a selected frame over its own blocks and swallow
 * clicks meant for them.
 */
const Z_FRAME = 0;
const Z_BLOCK = 1;

/** Breathing room between a frame's edge and the blocks it holds. */
const FRAME_PAD = 26;
/** A frame never collapses below this, so an empty one is still a target. */
const FRAME_MIN = { width: 320, height: 190 };

/** A command block before it has been measured — enough to place it in a frame. */
const NOMINAL_BLOCK = { width: 288, height: 88 };

function emptyFrame(label: string): FrameData {
  return { label, workingDir: null, ...FRAME_SIZE };
}

/**
 * Frames are told apart by name, so a new one gets a numbered default rather
 * than a pile of identical "Frame"s. Picking a folder renames it again — see
 * `chooseFrameDirectory`.
 */
export function isDefaultFrameName(label: string): boolean {
  return /^Frame(\s+\d+)?$/.test(label.trim());
}

function nextFrameName(nodes: FuseNode[]): string {
  const taken = new Set(nodes.filter(isFrameNode).map((n) => n.data.label.trim()));
  for (let i = 1; ; i += 1) {
    const candidate = `Frame ${i}`;
    if (!taken.has(candidate)) return candidate;
  }
}

/**
 * React Flow lays a node out from `width`/`height`; the document keeps them in
 * `data` so a frame's geometry survives a save. Both have to agree.
 */
function sizedFrame(node: FuseNode): FuseNode {
  if (!isFrameNode(node)) return node;
  return { ...node, width: node.data.width, height: node.data.height };
}

export const useWorkflowStore = create<WorkflowState>()((set, get) => {
  /**
   * Drags fire a `position` change on every mouse move. We snapshot once when
   * a drag starts, not on every frame, so one drag is one undo step.
   */
  let dragging = false;

  /** Where the frame being dragged was last frame, so moves can be mirrored. */
  let frameDrag: { id: string; x: number; y: number } | null = null;

  /**
   * Each frame's outline from before the current drag began.
   *
   * A frame stretches to follow a block being pulled out of it, so by the
   * time the block is released the live outline has moved to wherever the
   * block is — useless for deciding whether it left. This is the outline both
   * that decision and the no-shrink floor are measured against.
   */
  let heldFrames = new Map<string, Rect>();

  const holdFrames = (nodes: FuseNode[], inFlight: Set<string>) => {
    for (const node of nodes) {
      if (!isFrameNode(node) || heldFrames.has(node.id)) continue;
      if (membersOf(node.id, nodes).some((m) => inFlight.has(m.id))) {
        heldFrames.set(node.id, frameRect(node));
      }
    }
  };

  /**
   * Dragging a frame carries the blocks assigned to it — and only those. A
   * frame passing over a block does not pick it up; membership changes only
   * when the *block* is dropped somewhere.
   */
  const carryFrameContents = (
    changes: NodeChange<FuseNode>[],
    nodes: FuseNode[],
  ): NodeChange<FuseNode>[] => {
    const extra: NodeChange<FuseNode>[] = [];

    for (const change of changes) {
      if (change.type !== "position") continue;

      if (change.dragging === false) {
        if (frameDrag?.id === change.id) frameDrag = null;
        continue;
      }
      if (!change.dragging || !change.position) continue;

      const frame = nodes.find((n) => n.id === change.id);
      if (!frame || !isFrameNode(frame)) continue;

      if (frameDrag?.id !== frame.id) {
        frameDrag = { id: frame.id, x: frame.position.x, y: frame.position.y };
      }

      const dx = change.position.x - frameDrag.x;
      const dy = change.position.y - frameDrag.y;
      frameDrag.x = change.position.x;
      frameDrag.y = change.position.y;
      if (dx === 0 && dy === 0) continue;

      for (const member of membersOf(frame.id, nodes)) {
        extra.push({
          id: member.id,
          type: "position",
          position: { x: member.position.x + dx, y: member.position.y + dy },
          dragging: true,
        });
      }
    }

    return extra;
  };

  /**
   * A block that has just been let go joins whichever frame it landed in, or
   * leaves the one it came from. This is the only thing that ever reassigns a
   * block, which is what makes membership predictable.
   */
  const settleDroppedBlocks = (changes: NodeChange<FuseNode>[], nodes: FuseNode[]): FuseNode[] => {
    const dropped = changes
      .filter((c) => c.type === "position" && c.dragging === false)
      .map((c) => (c as { id: string }).id);
    if (dropped.length === 0) return nodes;

    // A frame drag moves its members; that must not re-home them.
    const carried = new Set(
      dropped.flatMap((id) => {
        const node = nodes.find((n) => n.id === id);
        return node && isFrameNode(node) ? membersOf(node.id, nodes).map((m) => m.id) : [];
      }),
    );

    let changed = false;
    const next = nodes.map((node) => {
      if (!isBlockNode(node) || carried.has(node.id) || !dropped.includes(node.id)) {
        return node;
      }

      const frameId = frameOnDrop(node, nodes);
      if (frameId === node.data.frameId) return node;

      changed = true;
      return { ...node, data: { ...node.data, frameId } } as FuseNode;
    });

    return changed ? next : nodes;
  };

  const pushHistory = () => {
    const state = get();
    const past = [...state.past, snapshotOf(state)].slice(-HISTORY_LIMIT);
    set({ past, future: [] });
  };

  const applySnapshot = (snapshot: Snapshot) => {
    set({
      nodes: snapshot.nodes,
      edges: snapshot.edges,
      name: snapshot.name,
      workingDir: snapshot.workingDir,
      dirty: true,
    });
  };

  return {
    id: newId(),
    name: "Untitled",
    workingDir: null,
    nodes: [],
    edges: [],
    dirty: false,
    createdAt: 0,
    updatedAt: 0,
    past: [],
    future: [],

    onNodesChange: (changes) => {
      const moved = changes.some((c) => c.type === "position");
      const structural = changes.some((c) => c.type === "remove" || c.type === "add");

      // Exactly one history entry per drag: taken when the drag begins, so
      // undo restores where the block started rather than where it landed.
      if (!dragging && changes.some((c) => c.type === "position" && c.dragging === true)) {
        dragging = true;
        pushHistory();
      } else if (structural && !dragging) {
        pushHistory();
      }

      if (dragging && changes.some((c) => c.type === "position" && c.dragging === false)) {
        dragging = false;
      }

      // Selection and measurement are view state, not document changes.
      const touchesDocument = moved || structural;

      const inFlight = new Set(
        changes
          .filter((c) => c.type === "position" && c.dragging === true)
          .map((c) => (c as { id: string }).id),
      );
      const dropEnded = changes.some((c) => c.type === "position" && c.dragging === false);

      set((state) => {
        // Remember each affected frame's outline on the first tick of a drag.
        holdFrames(state.nodes, inFlight);

        const all = [...changes, ...carryFrameContents(changes, state.nodes)];
        // Membership is decided against the remembered outline…
        const settled = settleDroppedBlocks(changes, applyNodeChanges(all, state.nodes));

        // …and only then is the drag over, freeing frames to shrink again.
        const held = heldFrames;
        if (dropEnded) heldFrames = new Map();

        return {
          nodes: fitFrames(settled, held, dropEnded),
          dirty: state.dirty || touchesDocument,
        };
      });
    },

    /** Which frame a block would end up in if dropped where it is now. */
    frameOnDropFor: (nodeId) => {
      const nodes = get().nodes;
      const block = nodes.find((n) => n.id === nodeId);
      if (!block || !isCommandNode(block)) return null;
      return frameOnDrop(block, nodes);
    },

    /**
     * Take a block out of its frame — the only way out, now that dragging
     * cannot lose one by accident.
     *
     * The block is parked just past the frame's edge rather than left sitting
     * inside a rectangle it no longer belongs to.
     */
    releaseFromFrame: (nodeId) => {
      const state = get();
      const block = state.nodes.find((n) => n.id === nodeId);
      if (!block || !isBlockNode(block) || !block.data.frameId) return;

      const frame = state.nodes.find((n) => n.id === block.data.frameId);
      const landing =
        frame && isFrameNode(frame)
          ? { x: snap(frameRect(frame).x + frameRect(frame).width + FRAME_PAD), y: snap(block.position.y) }
          : block.position;

      pushHistory();
      set((s) => ({
        nodes: fitFrames(
          s.nodes.map((n) =>
            n.id === nodeId && isBlockNode(n)
              ? ({ ...n, position: landing, data: { ...n.data, frameId: null } } as FuseNode)
              : n,
          ),
        ),
        dirty: true,
      }));
    },

    recomputeFrames: () => {
      set((state) => ({
        nodes: fitFrames(state.nodes, new Map(), true),
      }));
    },

    onEdgesChange: (changes) => {
      const touchesDocument = changes.some((c) => c.type === "remove" || c.type === "add");
      if (touchesDocument) pushHistory();

      set((state) => ({
        edges: applyEdgeChanges(changes, state.edges),
        dirty: state.dirty || touchesDocument,
      }));
    },

    onConnect: (connection) => {
      if (!connection.source || !connection.target) return;
      if (connection.source === connection.target) return;

      const { edges } = get();
      // One wire per pair, in either direction — a cycle can't be executed.
      const duplicate = edges.some(
        (e) =>
          (e.source === connection.source && e.target === connection.target) ||
          (e.source === connection.target && e.target === connection.source),
      );
      if (duplicate) return;

      pushHistory();
      set((state) => {
        // Include the new edge so the BFS can traverse it.
        const newEdge = withPorts({ ...connection, id: newId(), type: "flow" });
        const allEdges = addEdge(newEdge, state.edges);

        let newNodes = state.nodes;
        const targetNode = state.nodes.find((n) => n.id === connection.target);

        // If the target is a command node with unresolved placeholders, walk
        // upstream to find the closest variable-producing node and auto-bind.
        if (targetNode && targetNode.type === "command" && targetNode.data.command) {
          const placeholders = placeholdersIn(targetNode.data.command as string);

          // Collect all variables already produced by other nodes.
          const knownVars = new Set<string>();
          for (const n of state.nodes) {
            if (n.type === "input" || n.type === "capture" || n.type === "read_file" || n.type === "set_variable" || n.type === "http" || n.type === "ai_commit") {
              const v = (n.data as any).variable?.trim();
              if (v) knownVars.add(v);
            } else if (n.type === "bump_version") {
              const v = (n.data as any).variableOut?.trim();
              if (v) knownVars.add(v);
            }
          }

          // Find unbound placeholders — ones that don't match any known variable.
          const unbound = placeholders.filter((p) => !knownVars.has(p));

          if (unbound.length >= 1) {
            // BFS upstream from the target to find the closest variable producer.
            const visited = new Set<string>();
            const queue = [connection.target!];
            let upstreamVar: string | null = null;

            while (queue.length > 0 && !upstreamVar) {
              const current = queue.shift()!;
              if (visited.has(current)) continue;
              visited.add(current);

              const incoming = allEdges.filter((e) => e.target === current);
              for (const edge of incoming) {
                const src = state.nodes.find((n) => n.id === edge.source);
                if (!src) continue;
                if (src.type === "input" || src.type === "capture" || src.type === "read_file" || src.type === "set_variable" || src.type === "http" || src.type === "ai_commit") {
                  upstreamVar = (src.data as any).variable?.trim() || null;
                } else if (src.type === "bump_version") {
                  upstreamVar = (src.data as any).variableOut?.trim() || null;
                }
                if (upstreamVar) break;
                queue.push(src.id);
              }
            }

            if (upstreamVar) {
              // Replace the first unbound placeholder with the upstream variable.
              const p = unbound[0]!;
              const newCommand = (targetNode.data.command as string).replace(
                new RegExp(`\\{\\{\\s*${p}\\s*\\}\\}`, "g"),
                `{{${upstreamVar}}}`
              );
              newNodes = state.nodes.map((n) =>
                n.id === targetNode.id
                  ? ({ ...n, data: { ...n.data, command: newCommand } } as FuseNode)
                  : n
              );
            }
          }
        }

        return {
          edges: allEdges,
          nodes: newNodes,
          dirty: true,
        };
      });
    },

    disconnect: (edgeId) => {
      if (!get().edges.some((e) => e.id === edgeId)) return;
      pushHistory();
      set((state) => ({
        edges: state.edges.filter((e) => e.id !== edgeId),
        dirty: true,
      }));
    },

    disconnectNodes: (nodeIds) => {
      const ids = new Set(nodeIds);
      const doomed = get().edges.filter((e) => ids.has(e.source) || ids.has(e.target));
      if (doomed.length === 0) return 0;

      pushHistory();
      const cut = new Set(doomed.map((e) => e.id));
      set((state) => ({
        edges: state.edges.filter((e) => !cut.has(e.id)),
        dirty: true,
      }));
      return doomed.length;
    },

    /**
     * Dragging a wire's end onto another block moves it rather than leaving a
     * duplicate — and a move that would land on a pair already wired together
     * is dropped instead, keeping the one-wire-per-pair rule intact.
     */
    reconnect: (edgeId, connection) => {
      const { edges } = get();
      const existing = edges.find((e) => e.id === edgeId);
      if (!existing || !connection.source || !connection.target) return;
      if (connection.source === connection.target) return;

      const duplicate = edges.some(
        (e) =>
          e.id !== edgeId &&
          ((e.source === connection.source && e.target === connection.target) ||
            (e.source === connection.target && e.target === connection.source)),
      );

      pushHistory();
      set((state) => ({
        edges: duplicate
          ? state.edges.filter((e) => e.id !== edgeId)
          : state.edges.map((e) =>
              e.id === edgeId
                ? withPorts({
                    ...e,
                    source: connection.source!,
                    target: connection.target!,
                    sourceHandle: connection.sourceHandle,
                    targetHandle: connection.targetHandle,
                  })
                : e,
            ),
        dirty: true,
      }));
    },

    addBlockNode: (kind, options) => {
      const state = get();
      pushHistory();

      const selected = state.nodes.filter((n) => n.selected && isBlockNode(n));
      const anchor = selected.length === 1 ? selected[0] : undefined;

      const position = options?.position ?? {
        x: anchor ? anchor.position.x : snap(240),
        y: anchor ? anchor.position.y + CHAIN_OFFSET : snap(160),
      };

      const id = newId();
      const at = { x: snap(position.x), y: snap(position.y) };

      // A block created inside a frame belongs to it straight away — that is
      // the whole point of double-clicking inside one.
      const frame = options?.frameId !== undefined 
        ? { id: options.frameId }
        : frameAt(state.nodes, {
            x: at.x + NOMINAL_BLOCK.width / 2,
            y: at.y + NOMINAL_BLOCK.height / 2,
          });

      const node = {
        id,
        type: kind,
        position: at,
        data: { ...emptyBlock(kind), frameId: frame?.id ?? null, ...(options?.prefill ?? {}) },
        selected: true,
        zIndex: Z_BLOCK,
      } as BlockNodeType;

      // Chaining from the selected block is the fast path: add → type → run.
      const chained: FuseEdge[] =
        anchor && !options?.position
          ? [withPorts({ id: newId(), source: anchor.id, target: id, type: "flow" })]
          : [];

      set((s) => ({
        nodes: [...s.nodes.map((n) => ({ ...n, selected: false })), node],
        edges: [...s.edges, ...chained],
        dirty: true,
      }));

      return id;
    },

    addFrameNode: (options) => {
      const state = get();
      pushHistory();

      const position = options?.position ?? { x: snap(180), y: snap(140) };
      const id = newId();

      const node: FuseNode = sizedFrame({
        id,
        type: "frame",
        position: { x: snap(position.x), y: snap(position.y) },
        data: emptyFrame(nextFrameName(state.nodes)),
        selected: true,
        // Frames sit behind the blocks they contain.
        zIndex: Z_FRAME,
      });

      set((s) => ({
        nodes: [...s.nodes.map((n) => ({ ...n, selected: false })), node],
        dirty: true,
      }));

      return id;
    },

    updateNodeData: (id, patch) => {
      set((state) => ({
        nodes: state.nodes.map((n) =>
          n.id === id && isBlockNode(n) ? ({ ...n, data: { ...n.data, ...patch } } as FuseNode) : n,
        ),
        dirty: true,
      }));
    },

    updateFrameData: (id, patch) => {
      set((state) => ({
        nodes: state.nodes.map((n) =>
          n.id === id && isFrameNode(n)
            ? sizedFrame({ ...n, data: { ...n.data, ...patch } })
            : n,
        ),
        dirty: true,
      }));
    },

    deleteNodes: (ids) => {
      if (ids.length === 0) return;
      pushHistory();
      const doomed = new Set(ids);
      set((state) => ({
        nodes: fitFrames(released(state.nodes.filter((n) => !doomed.has(n.id)), doomed)),
        edges: state.edges.filter((e) => !doomed.has(e.source) && !doomed.has(e.target)),
        dirty: true,
      }));
    },

    deleteSelected: () => {
      const state = get();
      const nodeIds = state.nodes.filter((n) => n.selected).map((n) => n.id);
      const edgeIds = state.edges.filter((e) => e.selected).map((e) => e.id);
      if (nodeIds.length === 0 && edgeIds.length === 0) return;

      pushHistory();
      const doomed = new Set(nodeIds);
      const doomedEdges = new Set(edgeIds);
      set((s) => ({
        nodes: fitFrames(
          released(
            s.nodes.filter((n) => !doomed.has(n.id)),
            doomed,
          ),
        ),
        edges: s.edges.filter(
          (e) => !doomedEdges.has(e.id) && !doomed.has(e.source) && !doomed.has(e.target),
        ),
        dirty: true,
      }));
    },

    duplicateSelected: () => {
      const state = get();
      const selected = state.nodes.filter((n) => n.selected);
      if (selected.length === 0) return [];

      pushHistory();

      const idMap = new Map<string, string>();
      const copies: FuseNode[] = selected.map((node) => {
        const id = newId();
        idMap.set(node.id, id);
        const position = { x: node.position.x + GRID * 2, y: node.position.y + GRID * 2 };

        return isFrameNode(node)
          ? sizedFrame({ ...node, id, position, data: { ...node.data }, selected: true })
          : ({ ...cloneNode(node), id, position, selected: true } as FuseNode);
      });

      // Copying a frame along with its blocks keeps them in the *copy*.
      for (const copy of copies) {
        if (!isBlockNode(copy) || !copy.data.frameId) continue;
        const movedFrame = idMap.get(copy.data.frameId);
        if (movedFrame) copy.data = { ...copy.data, frameId: movedFrame };
      }

      // Preserve wiring *between* the duplicated blocks.
      const copiedEdges: FuseEdge[] = state.edges
        .filter((e) => idMap.has(e.source) && idMap.has(e.target))
        .map((e) => ({
          ...e,
          id: newId(),
          source: idMap.get(e.source)!,
          target: idMap.get(e.target)!,
          selected: false,
        }));

      set((s) => ({
        nodes: [...s.nodes.map((n) => ({ ...n, selected: false })), ...copies],
        edges: [...s.edges, ...copiedEdges],
        dirty: true,
      }));

      return copies.map((c) => c.id);
    },

    setName: (name) => {
      set({ name, dirty: true });
    },

    setWorkingDir: (dir) => {
      pushHistory();
      set({ workingDir: dir, dirty: true });
    },

    beginEdit: () => {
      pushHistory();
    },

    undo: () => {
      const state = get();
      const previous = state.past[state.past.length - 1];
      if (!previous) return;

      set({
        past: state.past.slice(0, -1),
        future: [snapshotOf(state), ...state.future].slice(0, HISTORY_LIMIT),
      });
      applySnapshot(previous);
    },

    redo: () => {
      const state = get();
      const next = state.future[0];
      if (!next) return;

      set({
        past: [...state.past, snapshotOf(state)].slice(-HISTORY_LIMIT),
        future: state.future.slice(1),
      });
      applySnapshot(next);
    },

    loadDocument: (doc) => {
      set({
        id: doc.id,
        name: doc.name,
        workingDir: doc.workingDir ?? null,
        // Missing fields fall back to the same defaults a fresh block gets, so
        // a document written by an older version still opens cleanly.
        nodes: doc.nodes.map((n) =>
          n.type === "frame"
            ? sizedFrame({
                id: n.id,
                type: "frame" as const,
                position: n.position,
                data: { ...emptyFrame("Frame"), ...n.data },
                zIndex: Z_FRAME,
              })
            : ({
                id: n.id,
                type: n.type,
                position: n.position,
                zIndex: Z_BLOCK,
                data: { ...emptyBlock(n.type), ...n.data },
              } as FuseNode),
        ),
        edges: doc.edges.map((e) =>
          withPorts({
            id: e.id,
            source: e.source,
            target: e.target,
            sourceHandle: e.sourceHandle,
            targetHandle: e.targetHandle,
            type: "flow",
          }),
        ),
        createdAt: doc.createdAt,
        updatedAt: doc.updatedAt,
        dirty: false,
        past: [],
        future: [],
      });
    },

    resetWorkflow: () => {
      set({
        id: newId(),
        name: "Untitled",
        workingDir: null,
        nodes: [],
        edges: [],
        createdAt: 0,
        updatedAt: 0,
        dirty: false,
        past: [],
        future: [],
      });
    },

    /** Strip React Flow's view state down to the persisted shape. */
    toDocument: () => {
      const state = get();
      return {
        id: state.id,
        name: state.name.trim() || "Untitled",
        workingDir: state.workingDir,
        nodes: state.nodes.map((n) => {
          const position = { x: n.position.x, y: n.position.y };
          return isFrameNode(n)
            ? {
                id: n.id,
                position,
                type: "frame" as const,
                data: {
                  label: n.data.label,
                  workingDir: n.data.workingDir,
                  width: n.data.width,
                  height: n.data.height,
                },
              }
            : // React Flow hangs view state off `data`-adjacent fields only, so
              // the block's data is already exactly what belongs on disk.
              ({
                id: n.id,
                position,
                type: n.type,
                data: { ...n.data },
              } as PersistedNode);
        }),
        edges: state.edges.map((e) => ({
          id: e.id,
          source: e.source,
          target: e.target,
          sourceHandle: e.sourceHandle ?? null,
          targetHandle: e.targetHandle ?? null,
        })),
        createdAt: state.createdAt,
        updatedAt: state.updatedAt,
      };
    },

    markSaved: (doc) => {
      set({
        id: doc.id,
        name: doc.name,
        workingDir: doc.workingDir ?? null,
        dirty: false,
        createdAt: doc.createdAt,
        updatedAt: doc.updatedAt,
      });
    },
  };
});
