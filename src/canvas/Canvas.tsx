import { useCallback, useEffect, useRef, type MouseEvent as ReactMouseEvent } from "react";
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
import { Maximize2, Minus, Plus } from "lucide-react";
import { nodeTypes } from "./nodes";
import { FlowEdge } from "./edges/FlowEdge";
import { ConnectionLine } from "./edges/ConnectionLine";
import { SOURCE_PORT, TARGET_PORT } from "./ports";
import { GRID, useWorkflowStore } from "@/store/workflowStore";
import { useRuntimeStore } from "@/store/runtimeStore";
import { useUIStore } from "@/store/uiStore";
import { setCanvasProjection, recordMouseScreen, addCommandBlock } from "@/lib/actions";
import { Kbd } from "@/components/ui/Kbd";
import { cn } from "@/lib/utils";
import type { FuseEdge, FuseNode } from "@/types/workflow";

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

      // Pulling from an input runs the wire backwards.
      const backwards = state.fromHandle?.type === "target";

      // Dropped on empty canvas: offer to create the block this wire wants,
      // already connected. Dragging a wire *is* the intent to add something.
      if (!dropped) {
        useUIStore.getState().openPicker({
          at: { x: point.clientX, y: point.clientY },
          position: { x: flow.x - 144, y: flow.y - 20 },
          connectFrom: {
            nodeId: state.fromNode.id,
            handleId: state.fromHandle?.id ?? (backwards ? TARGET_PORT : SOURCE_PORT),
            backwards,
          },
        });
        return;
      }

      if (dropped.id === state.fromNode.id) return;

      onConnect({
        source: backwards ? dropped.id : state.fromNode.id,
        target: backwards ? state.fromNode.id : dropped.id,
        // Which port the wire *left* from carries meaning on a condition
        // block, so it is kept rather than normalised away.
        sourceHandle: backwards ? SOURCE_PORT : (state.fromHandle?.id ?? SOURCE_PORT),
        targetHandle: backwards ? (state.fromHandle?.id ?? TARGET_PORT) : TARGET_PORT,
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
    const target = useWorkflowStore.getState().frameOnDropFor(node.id);
    useUIStore.getState().setDropFrame(target === node.data.frameId ? null : target);
  }, []);

  const handleNodeDragStop = useCallback(() => {
    useUIStore.getState().setDropFrame(null);
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
          <div className="flex items-center gap-0.5 rounded-lg border border-line bg-base/85 p-0.5 backdrop-blur-md">
            <CanvasButton label="Zoom out" onClick={() => zoomOut({ duration: 160 })}>
              <Minus size={13} strokeWidth={2} />
            </CanvasButton>
            <CanvasButton label="Zoom in" onClick={() => zoomIn({ duration: 160 })}>
              <Plus size={13} strokeWidth={2} />
            </CanvasButton>
            <CanvasButton
              label="Fit canvas"
              onClick={() => fitView({ padding: 0.3, duration: 240, maxZoom: 1 })}
            >
              <Maximize2 size={12} strokeWidth={2} />
            </CanvasButton>
          </div>
        </Panel>

        <MiniMap
          position="bottom-right"
          className="!m-3"
          pannable
          zoomable
          maskColor="rgba(8,8,10,0.72)"
          nodeStrokeWidth={0}
          nodeBorderRadius={3}
          nodeColor={(node) => {
            const status = useRuntimeStore.getState().statuses[node.id];
            return (status && MINIMAP_COLORS[status]) || "#2e2e35";
          }}
          style={{ width: 148, height: 96 }}
        />
      </ReactFlow>

      {nodes.length === 0 && <EmptyState />}
    </div>
  );
}

function CanvasButton({
  label,
  onClick,
  children,
}: {
  label: string;
  onClick: () => void;
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
