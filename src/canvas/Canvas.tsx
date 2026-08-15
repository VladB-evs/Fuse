import { useCallback, useEffect, useRef, useState, type MouseEvent as ReactMouseEvent } from "react";
import {
  Background,
  BackgroundVariant,
  ConnectionMode,
  MiniMap,
  Panel,
  ReactFlow,
  useConnection,
  useReactFlow,
  useStoreApi,
  type Connection,
  type FinalConnectionState,
  MarkerType,
  type Edge as RFEdge,
} from "@xyflow/react";
import { Maximize2, Minus, Plus, Map } from "lucide-react";
import { nodeTypes } from "./nodes";
import { FRAME_THEMES } from "./nodes/FrameNode";
import { FlowEdge } from "./edges/FlowEdge";
import { ConnectionLine } from "./edges/ConnectionLine";
import { LaserSlicer } from "./LaserSlicer";
import { SOURCE_PORT, TARGET_PORT } from "./ports";
import { GRID, useWorkflowStore } from "@/store/workflowStore";
import { useRuntimeStore } from "@/store/runtimeStore";
import { useUIStore } from "@/store/uiStore";
import { setCanvasProjection, recordMouseScreen, addCommandBlock } from "@/lib/actions";
import { findIntersectingEdge } from "@/lib/edgeSplice";
import { Kbd } from "@/components/ui/Kbd";
import { cn } from "@/lib/utils";
import type { FuseEdge, FuseNode, FrameColor } from "@/types/workflow";

const edgeTypes = { flow: FlowEdge };

const MINIMAP_COLORS: Record<string, string> = {
  running: "#5b6cff",
  waiting: "#f5a524",
  success: "#3ecf8e",
  failed: "#f2555f",
  cancelled: "#f5a524",
};

export function Canvas() {
  const nodes = useWorkflowStore((s) => s.nodes);
  const edges = useWorkflowStore((s) => s.edges);
  const onNodesChangeStore = useWorkflowStore((s) => s.onNodesChange);
  const onEdgesChange = useWorkflowStore((s) => s.onEdgesChange);
  const onConnect = useWorkflowStore((s) => s.onConnect);
  const minimapOpen = useUIStore((s) => s.minimapOpen);
  const toggleMinimap = useUIStore((s) => s.toggleMinimap);

  const [ctrlHeld, setCtrlHeld] = useState(false);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Control") setCtrlHeld(true);
    };
    const handleKeyUp = (e: KeyboardEvent) => {
      if (e.key === "Control") setCtrlHeld(false);
    };
    const handleBlur = () => setCtrlHeld(false);

    window.addEventListener("keydown", handleKeyDown);
    window.addEventListener("keyup", handleKeyUp);
    window.addEventListener("blur", handleBlur);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("keyup", handleKeyUp);
      window.removeEventListener("blur", handleBlur);
    };
  }, []);

  const { screenToFlowPosition, getNodes, zoomIn, zoomOut, fitView } = useReactFlow();
  const store = useStoreApi();
  const connecting = useConnection((c) => c.inProgress);

  const onNodesChange = useCallback(
    (changes: import("@xyflow/react").NodeChange<FuseNode>[]) => {
      if (store.getState().userSelectionActive) {
        changes = changes.filter((c) => {
          if (c.type === "select" && c.selected) {
            const node = nodes.find((n) => n.id === c.id);
            if (node?.type === "frame") return false;
          }
          return true;
        });
      }
      onNodesChangeStore(changes);
    },
    [nodes, onNodesChangeStore, store],
  );

  /** Did the wire being dragged land on a handle, or nowhere? */
  const reconnected = useRef(false);
  const lastMousePos = useRef<{ x: number; y: number } | null>(null);

  useEffect(() => {
    const onMouseMove = (e: MouseEvent) => {
      const pos = { x: e.clientX, y: e.clientY };
      lastMousePos.current = pos;
      recordMouseScreen(pos);

      // When dragging with Shift/Meta or selection is active, kill any browser text selection
      if (e.shiftKey || e.metaKey || store.getState().userSelectionActive) {
        window.getSelection()?.removeAllRanges();
      }
    };
    window.addEventListener("mousemove", onMouseMove, { passive: true });
    return () => window.removeEventListener("mousemove", onMouseMove);
  }, [store]);

  // The picker and actions turn screen points into canvas ones.
  useEffect(() => {
    setCanvasProjection(
      (point) => {
        const flow = screenToFlowPosition(point);
        return { x: flow.x - 144, y: flow.y - 44 };
      },
      (screenPoint) => {
        const pt = screenPoint ?? lastMousePos.current ?? {
          x: window.innerWidth / 2,
          y: window.innerHeight / 2,
        };
        const flow = screenToFlowPosition(pt);
        return { x: flow.x - 144, y: flow.y - 44 };
      },
    );
  }, [screenToFlowPosition]);

  /**
   * Dropping a wire on a handle is React Flow's job. This picks up the other
   * case — released over a block's *body* — and wires it to the nearest
   * sensible ports, so the whole block is a drop target rather than a dot.
   */
  const handleConnectEnd = useCallback(
    (event: MouseEvent | TouchEvent, state: FinalConnectionState) => {
      if (state.isValid || !state.fromNode) return;

      const point = "changedTouches" in event ? event.changedTouches[0] : event;
      if (!point) return;

      const flow = screenToFlowPosition({ x: point.clientX, y: point.clientY });
      // Last match wins: later nodes paint on top, so that is what was hit.
      const dropped = getNodes()
        .filter((node) => node.type !== "frame")
        .reverse()
        .find((node) => {
          const width = node.measured?.width ?? 0;
          const height = node.measured?.height ?? 0;
          return (
            flow.x >= node.position.x &&
            flow.x <= node.position.x + width &&
            flow.y >= node.position.y &&
            flow.y <= node.position.y + height
          );
        });

      // Dropped on empty canvas: offer to create the block this wire wants,
      // already connected. Dragging a wire *is* the intent to add something.
      if (!dropped) {
        useUIStore.getState().openPicker({
          at: { x: point.clientX, y: point.clientY },
          position: { x: flow.x - 144, y: flow.y - 20 },
          connectFrom: {
            nodeId: state.fromNode.id,
            handleId: state.fromHandle?.id ?? SOURCE_PORT,
            backwards: false,
          },
        });
        return;
      }

      if (dropped.id === state.fromNode.id) return;

      onConnect({
        source: state.fromNode.id,
        target: dropped.id,
        // Which port the wire *left* from carries meaning on a condition
        // block, so it is kept rather than normalised away.
        sourceHandle: state.fromHandle?.id ?? SOURCE_PORT,
        targetHandle: TARGET_PORT,
      });
    },
    [screenToFlowPosition, getNodes, onConnect],
  );

  const handleNodeClick = useCallback((_: ReactMouseEvent, node: FuseNode) => {
    // Frames hold no output of their own.
    if (node.type === "frame") return;

    // "Clicking a node reveals its output" — but only pop the drawer open when
    // there is something to read, so authoring stays undisturbed.
    const hasOutput = (useRuntimeStore.getState().output[node.id]?.length ?? 0) > 0;
    useUIStore.getState().inspect(node.id, hasOutput ? { open: true } : undefined);
  }, []);

  /**
   * Light up the frame a block would *join*, so joining reads as a deliberate
   * drop rather than something that happened to the block. A block hovering
   * over the frame it already belongs to is not news, so that stays quiet.
   */
  const handleNodeDrag = useCallback((_: MouseEvent | TouchEvent, node: FuseNode) => {
    if (node.type === "frame") return;
    const wf = useWorkflowStore.getState();
    const targetFrame = wf.frameOnDropFor(node.id);
    useUIStore.getState().setDropFrame(targetFrame === node.data.frameId ? null : targetFrame);

    const targetEdge = findIntersectingEdge(node, wf.edges, wf.nodes);
    useUIStore.getState().setDropEdge(targetEdge ? targetEdge.id : null);
  }, []);

  const handleNodeDragStop = useCallback((_: MouseEvent | TouchEvent, node: FuseNode) => {
    const dropEdgeId = useUIStore.getState().dropEdgeId;
    if (dropEdgeId && node && node.type !== "frame") {
      useWorkflowStore.getState().spliceNodeIntoEdge(dropEdgeId, node.id);
      useUIStore.getState().notify("Node inserted into connection");
    }
    useUIStore.getState().setDropFrame(null);
    useUIStore.getState().setDropEdge(null);
  }, []);

  /**
   * Dragging a wire's end off onto empty canvas cuts it.
   *
   * React Flow reports the drag start, then either a landing on a handle or
   * nothing at all; "nothing at all" is the gesture people already expect to
   * mean disconnect.
   */
  const handleReconnectStart = useCallback(() => {
    reconnected.current = false;
  }, []);

  const handleReconnect = useCallback((edge: FuseEdge, connection: Connection) => {
    reconnected.current = true;
    useWorkflowStore.getState().reconnect(edge.id, connection);
  }, []);

  const handleReconnectEnd = useCallback((_: MouseEvent | TouchEvent, edge: FuseEdge) => {
    if (reconnected.current) return;
    useWorkflowStore.getState().disconnect(edge.id);
    useUIStore.getState().notify("Wire cut");
  }, []);

  const isValidConnection = useCallback((connection: Connection | RFEdge) => {
    const { source, target } = connection;
    const nodes = getNodes();
    const sourceNode = nodes.find(n => n.id === source);
    const targetNode = nodes.find(n => n.id === target);

    if (!sourceNode || !targetNode) return false;

    // Prevent frames from connecting to their own members to avoid infinite loops
    if (sourceNode.type !== "frame" && targetNode.type === "frame") {
      if ((sourceNode.data as any).frameId === targetNode.id) return false;
    }
    if (targetNode.type !== "frame" && sourceNode.type === "frame") {
      if ((targetNode.data as any).frameId === sourceNode.id) return false;
    }

    return true;
  }, [getNodes]);

  return (
    <div
      className={cn("relative min-h-0 flex-1", connecting && "is-connecting")}
    >
      <ReactFlow
        nodes={nodes}
        edges={edges}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onConnect={onConnect}
        onConnectEnd={handleConnectEnd}
        isValidConnection={isValidConnection}
        // Wires can be picked up by either end: dropped on another block they
        // move, dropped on nothing they are cut.
        onReconnectStart={handleReconnectStart}
        onReconnect={handleReconnect}
        onReconnectEnd={handleReconnectEnd}
        reconnectRadius={16}
        onNodeClick={handleNodeClick}
        onNodeDrag={handleNodeDrag}
        onNodeDragStop={handleNodeDragStop}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        defaultEdgeOptions={{ 
          type: "flow",
          markerEnd: {
            type: MarkerType.ArrowClosed,
            width: 14,
            height: 14,
            color: "currentColor",
          }
        }}
        connectionLineComponent={ConnectionLine}
        // Loose: any side of a block can start *or* finish a wire.
        connectionMode={ConnectionMode.Loose}
        connectionRadius={38}
        snapToGrid
        snapGrid={[GRID, GRID]}
        // Frames are backdrops and blocks live on top. Letting React Flow
        // raise the selected node would put a selected frame over its own
        // blocks and eat clicks meant for them.
        elevateNodesOnSelect={false}
        fitView
        fitViewOptions={{ padding: 0.3, maxZoom: 1 }}
        minZoom={0.25}
        maxZoom={2.5}
        // Deletion runs through our own shortcut handler so it can't fire
        // while the user is typing inside a command.
        deleteKeyCode={null}
        multiSelectionKeyCode="Meta"
        selectionKeyCode="Shift"
        panOnDrag={ctrlHeld ? false : true}
        nodesDraggable={!ctrlHeld}
        elementsSelectable={!ctrlHeld}
        onSelectionStart={() => window.getSelection()?.removeAllRanges()}
        onSelectionDrag={() => window.getSelection()?.removeAllRanges()}
        onSelectionEnd={() => window.getSelection()?.removeAllRanges()}
        panActivationKeyCode="Space"
        zoomActivationKeyCode="Meta"
        // Trackpad-native: two fingers pan, pinch zooms — like Figma on a Mac.
        panOnScroll
        zoomOnScroll={false}
        zoomOnPinch
        zoomOnDoubleClick={false}
        onDoubleClick={(e) => {
          if (
            (e.target as HTMLElement).closest(".react-flow__node") ||
            (e.target as HTMLElement).closest("button") ||
            (e.target as HTMLElement).closest(".react-flow__panel")
          ) {
            return;
          }
          const flow = screenToFlowPosition({ x: e.clientX, y: e.clientY });
          addCommandBlock({ x: flow.x - 144, y: flow.y - 44 });
        }}
        proOptions={{ hideAttribution: true }}
      >
        <Background
          variant={BackgroundVariant.Dots}
          gap={GRID}
          size={1}
          color="#1e1e23"
          bgColor="#08080a"
        />

        <Panel position="bottom-left" className="!m-3">
          <div className="flex items-center gap-0.5 rounded-lg border border-line bg-base/90 p-0.5 shadow-lg backdrop-blur-md">
            <CanvasButton label="Zoom out (-)" onClick={() => zoomOut({ duration: 160 })}>
              <Minus size={13} strokeWidth={2} />
            </CanvasButton>
            <CanvasButton label="Zoom in (+)" onClick={() => zoomIn({ duration: 160 })}>
              <Plus size={13} strokeWidth={2} />
            </CanvasButton>
            <CanvasButton
              label="Fit canvas (0)"
              onClick={() => fitView({ padding: 0.3, duration: 240, maxZoom: 1 })}
            >
              <Maximize2 size={12} strokeWidth={2} />
            </CanvasButton>
            <div className="my-0.5 h-3.5 w-px bg-line/80" />
            <CanvasButton
              label={minimapOpen ? "Hide minimap (M)" : "Show minimap (M)"}
              onClick={toggleMinimap}
              active={minimapOpen}
            >
              <Map size={12} strokeWidth={2} />
            </CanvasButton>
          </div>
        </Panel>

        {minimapOpen && (
          <MiniMap
            position="bottom-right"
            className="!m-3 !border !border-line !rounded-xl !overflow-hidden !shadow-2xl backdrop-blur-md animate-in-soft"
            pannable
            zoomable
            maskColor="rgba(8,8,10,0.76)"
            nodeStrokeWidth={1}
            nodeBorderRadius={4}
            nodeColor={(node) => {
              if (node.type === "frame") {
                const color = (node.data as any)?.color as FrameColor | undefined;
                return color && FRAME_THEMES[color] ? FRAME_THEMES[color].dot + "33" : "#27272a33";
              }
              const status = useRuntimeStore.getState().statuses[node.id];
              return (status && MINIMAP_COLORS[status]) || "#3f3f46";
            }}
            nodeStrokeColor={(node) => {
              if (node.type === "frame") {
                const color = (node.data as any)?.color as FrameColor | undefined;
                return color && FRAME_THEMES[color] ? FRAME_THEMES[color].dot : "#52525b";
              }
              return "#18181b";
            }}
            style={{ width: 164, height: 108, backgroundColor: "#0c0c0e" }}
          />
        )}
        <LaserSlicer />
      </ReactFlow>

      {nodes.length === 0 && <EmptyState />}
    </div>
  );
}

function CanvasButton({
  label,
  onClick,
  active,
  children,
}: {
  label: string;
  onClick: () => void;
  active?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={onClick}
      className={cn(
        "flex size-6 items-center justify-center rounded-[6px] text-fg-muted",
        "transition hover:bg-hover hover:text-fg active:scale-95",
        active && "bg-accent/20 text-accent font-medium hover:bg-accent/30",
      )}
    >
      {children}
    </button>
  );
}

function EmptyState() {
  return (
    <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
      <div className="animate-in-soft flex flex-col items-center gap-3 text-center">
        <p className="text-[13px] text-fg-muted">Build a workflow from blocks</p>
        <p className="flex items-center gap-1.5 text-[11px] text-fg-subtle">
          Press <Kbd>Tab</Kbd> for every kind of block, or double-click for a command
        </p>
        <p className="flex items-center gap-1.5 text-[11px] text-fg-subtle/80">
          Drag from the edge of a block to wire it to the next one
        </p>
      </div>
    </div>
  );
}
