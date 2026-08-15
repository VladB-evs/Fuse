import { memo, useEffect, useRef, useState } from "react";
import { useReactFlow } from "@xyflow/react";
import { checkNodeSlice, checkEdgeSlice, type Point } from "@/lib/slicer";
import { useWorkflowStore } from "@/store/workflowStore";
import { useUIStore } from "@/store/uiStore";

export const LaserSlicer = memo(function LaserSlicer() {
  const { screenToFlowPosition } = useReactFlow();
  const [ctrlHeld, setCtrlHeld] = useState(false);
  const [cursorPos, setCursorPos] = useState<Point | null>(null);
  const [startPos, setStartPos] = useState<Point | null>(null);
  const [isDragging, setIsDragging] = useState(false);

  const isDraggingRef = useRef(false);
  const startPosRef = useRef<Point | null>(null);
  const cursorPosRef = useRef<Point | null>(null);
  const ctrlHeldRef = useRef(false);
  const slicedNodesRef = useRef<Set<string>>(new Set());
  const slicedEdgesRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Control") {
        ctrlHeldRef.current = true;
        setCtrlHeld(true);
        document.body.classList.add("slicing-active");
      }
    };

    const handleKeyUp = (e: KeyboardEvent) => {
      if (e.key === "Control") {
        ctrlHeldRef.current = false;
        setCtrlHeld(false);
        document.body.classList.remove("slicing-active");
        if (!isDraggingRef.current) {
          setStartPos(null);
          startPosRef.current = null;
        }
      }
    };

    const handleBlur = () => {
      ctrlHeldRef.current = false;
      setCtrlHeld(false);
      document.body.classList.remove("slicing-active");
      if (!isDraggingRef.current) {
        setStartPos(null);
        startPosRef.current = null;
      }
    };

    const handlePointerDown = (e: PointerEvent) => {
      if (!e.ctrlKey || e.button !== 0) return;

      e.preventDefault();
      e.stopPropagation();

      const screenPt: Point = { x: e.clientX, y: e.clientY };
      isDraggingRef.current = true;
      startPosRef.current = screenPt;
      cursorPosRef.current = screenPt;
      slicedNodesRef.current = new Set();
      slicedEdgesRef.current = new Set();

      setIsDragging(true);
      setStartPos(screenPt);
      setCursorPos(screenPt);
    };

    const handlePointerMove = (e: PointerEvent) => {
      const screenPt: Point = { x: e.clientX, y: e.clientY };
      cursorPosRef.current = screenPt;

      if (ctrlHeldRef.current || e.ctrlKey) {
        setCursorPos(screenPt);
      }

      if (!isDraggingRef.current || !startPosRef.current) return;

      e.preventDefault();
      e.stopPropagation();
    };

    const handlePointerUp = (e: PointerEvent) => {
      if (!isDraggingRef.current) return;

      if (startPosRef.current) {
        const screenPt: Point = { x: e.clientX, y: e.clientY };
        const p1 = screenToFlowPosition(startPosRef.current);
        const p2 = screenToFlowPosition(screenPt);

        const state = useWorkflowStore.getState();
        const nodes = state.nodes;
        const edges = state.edges;

        const slicedNodes: string[] = [];
        const slicedEdges: string[] = [];

        for (const node of nodes) {
          if (node.type !== "frame") {
            if (checkNodeSlice(p1, p2, node)) {
              slicedNodes.push(node.id);
            }
          }
        }

        for (const edge of edges) {
          if (checkEdgeSlice(p1, p2, edge, nodes)) {
            slicedEdges.push(edge.id);
          }
        }

        const slicedNodeSet = new Set(slicedNodes);
        // Slicing a node disables the node while keeping all attached lines intact!
        const filteredEdges = slicedEdges.filter((edgeId) => {
          const edge = edges.find((e) => e.id === edgeId);
          if (!edge) return false;
          return !slicedNodeSet.has(edge.source) && !slicedNodeSet.has(edge.target);
        });

        if (slicedNodes.length > 0 || filteredEdges.length > 0) {
          state.applySlice(slicedNodes, filteredEdges);
          const total = slicedNodes.length + filteredEdges.length;
          useUIStore.getState().notify(
            total === 1 ? "Toggled item status" : `Toggled ${total} items`,
          );
        }
      }

      isDraggingRef.current = false;
      startPosRef.current = null;
      setIsDragging(false);
      setStartPos(null);
    };

    window.addEventListener("keydown", handleKeyDown);
    window.addEventListener("keyup", handleKeyUp);
    window.addEventListener("blur", handleBlur);
    window.addEventListener("pointerdown", handlePointerDown, { capture: true });
    window.addEventListener("pointermove", handlePointerMove, { capture: true });
    window.addEventListener("pointerup", handlePointerUp, { capture: true });
    window.addEventListener("pointercancel", handlePointerUp, { capture: true });

    return () => {
      document.body.classList.remove("slicing-active");
      window.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("keyup", handleKeyUp);
      window.removeEventListener("blur", handleBlur);
      window.removeEventListener("pointerdown", handlePointerDown, { capture: true });
      window.removeEventListener("pointermove", handlePointerMove, { capture: true });
      window.removeEventListener("pointerup", handlePointerUp, { capture: true });
      window.removeEventListener("pointercancel", handlePointerUp, { capture: true });
    };
  }, [screenToFlowPosition]);

  if (!ctrlHeld && !isDragging) return null;

  return (
    <svg className="pointer-events-none fixed inset-0 z-[99999] h-screen w-screen overflow-visible">
      {/* Floating Hover Reticle before drag starts */}
      {ctrlHeld && !isDragging && cursorPos && (
        <g transform={`translate(${cursorPos.x}, ${cursorPos.y})`}>
          <circle cx="0" cy="0" r="10" className="slicer-reticle" />
          <circle cx="0" cy="0" r="3" fill="#ff3b69" />
        </g>
      )}

      {/* Dotted slicing line and circle endpoints during drag */}
      {isDragging && startPos && cursorPos && (
        <>
          {/* Straight Dotted Slice Line */}
          <line
            x1={startPos.x}
            y1={startPos.y}
            x2={cursorPos.x}
            y2={cursorPos.y}
            className="slicer-dotted-line"
          />

          {/* Start Anchor Circle */}
          <g transform={`translate(${startPos.x}, ${startPos.y})`}>
            <circle cx="0" cy="0" r="7" className="slicer-anchor-circle" />
            <circle cx="0" cy="0" r="2.5" fill="#ffffff" />
          </g>

          {/* End Cursor Circle */}
          <g transform={`translate(${cursorPos.x}, ${cursorPos.y})`}>
            <circle cx="0" cy="0" r="7" className="slicer-anchor-circle" />
            <circle cx="0" cy="0" r="2.5" fill="#ff3b69" />
          </g>
        </>
      )}
    </svg>
  );
});
