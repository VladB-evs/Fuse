import { useCallback, useRef, useState, type MouseEvent as ReactMouseEvent } from "react";
import { useWorkflowStore } from "@/store/workflowStore";
import type { FuseNode } from "@/types/workflow";

export interface DragCollectionState {
  active: boolean;
  leaderId: string | null;
  count: number;
  isDropping: boolean;
}

export function useDragCollection() {
  const [collectionState, setCollectionState] = useState<DragCollectionState>({
    active: false,
    leaderId: null,
    count: 0,
    isDropping: false,
  });

  const activeRef = useRef(false);
  const leaderIdRef = useRef<string | null>(null);
  const selectedIdsRef = useRef<string[]>([]);
  const dropTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearTransforms = useCallback(() => {
    selectedIdsRef.current.forEach((id) => {
      const nodeEl = document.querySelector(`.react-flow__node[data-id="${id}"]`);
      if (!nodeEl) return;
      const target = (nodeEl.firstElementChild as HTMLElement) || (nodeEl as HTMLElement);
      target.style.transform = "";
      target.style.transition = "";
      target.style.boxShadow = "";
      target.style.zIndex = "";
      target.style.pointerEvents = "";
    });

    const edges = useWorkflowStore.getState().edges;
    edges.forEach((edge) => {
      const edgeEls = document.querySelectorAll(
        `.react-flow__edge[data-id="${edge.id}"], .react-flow__edge[data-testid="rf__edge-${edge.id}"], [id="${edge.id}"], [data-edge-id="${edge.id}"]`,
      );
      edgeEls.forEach((el) => {
        const container = (el.closest(".react-flow__edge") as HTMLElement) || (el as HTMLElement);
        container.style.opacity = "";
        container.style.transition = "";
        container.style.pointerEvents = "";
      });
    });

    // Reset all edge cut / label buttons
    document.querySelectorAll(".fuse-edge-cut, [data-edge-id]").forEach((el) => {
      const btn = el as HTMLElement;
      btn.style.opacity = "";
      btn.style.transition = "";
      btn.style.pointerEvents = "";
    });
  }, []);

  const handleNodeDragStart = useCallback(
    (_: ReactMouseEvent | MouseEvent | TouchEvent | unknown, activeNode: FuseNode, allNodes: FuseNode[]) => {
      if (dropTimeoutRef.current) {
        clearTimeout(dropTimeoutRef.current);
        dropTimeoutRef.current = null;
        clearTransforms();
      }

      // Find all selected non-frame nodes
      const selected = allNodes.filter(
        (n) => n.selected && n.type !== "frame",
      );

      // If less than 2 items are selected, standard drag
      if (selected.length < 2) {
        activeRef.current = false;
        leaderIdRef.current = null;
        selectedIdsRef.current = [];
        setCollectionState({
          active: false,
          leaderId: null,
          count: 0,
          isDropping: false,
        });
        return;
      }

      // Order so that activeNode (leader) is index 0
      const leaderId = activeNode.id;
      const otherIds = selected
        .filter((n) => n.id !== leaderId)
        .map((n) => n.id);
      const orderedIds = [leaderId, ...otherIds];

      activeRef.current = true;
      leaderIdRef.current = leaderId;
      selectedIdsRef.current = orderedIds;

      setCollectionState({
        active: true,
        leaderId,
        count: orderedIds.length,
        isDropping: false,
      });

      // Apply initial convergence transforms to nodes
      const nodeMap = new Map(allNodes.map((n) => [n.id, n]));
      const leader = nodeMap.get(leaderId);
      if (!leader) return;

      orderedIds.forEach((id, index) => {
        const nodeEl = document.querySelector(`.react-flow__node[data-id="${id}"]`);
        if (!nodeEl) return;
        const target = (nodeEl.firstElementChild as HTMLElement) || (nodeEl as HTMLElement);

        if (index === 0) {
          // Leader card styling
          target.style.zIndex = "1050";
          target.style.boxShadow =
            "0 22px 40px -10px rgba(0, 0, 0, 0.7), 0 0 0 1.5px rgba(255, 255, 255, 0.15)";
          target.style.transition = "box-shadow 0.2s ease";
        } else {
          // Follower cards in fanned stack
          const node = nodeMap.get(id);
          if (!node) return;

          const dx = leader.position.x - node.position.x;
          const dy = leader.position.y - node.position.y;

          // Fan offset & rotation
          const sign = index % 2 === 1 ? 1 : -1;
          const fanX = sign * Math.min(index, 4) * 5;
          const fanY = index * 4;
          const fanRot = sign * Math.min(index, 5) * 3.5;
          const scale = Math.max(0.92, 1 - index * 0.015);

          target.style.transform = `translate3d(${dx + fanX}px, ${dy + fanY}px, 0) rotate(${fanRot}deg) scale(${scale})`;
          target.style.transition =
            "transform 0.22s cubic-bezier(0.16, 1, 0.3, 1), box-shadow 0.2s ease";
          target.style.boxShadow =
            "0 18px 32px -8px rgba(0, 0, 0, 0.6), 0 0 0 1px rgba(255, 255, 255, 0.1)";
          target.style.zIndex = `${1000 - index}`;
          target.style.pointerEvents = "none";
        }
      });

      // Fade out internal edges, cut buttons, and dim external connected edges during collection drag
      const edges = useWorkflowStore.getState().edges;
      const selectedSet = new Set(orderedIds);

      edges.forEach((edge) => {
        const isInternal = selectedSet.has(edge.source) && selectedSet.has(edge.target);
        const isConnected = selectedSet.has(edge.source) || selectedSet.has(edge.target);

        if (isInternal || isConnected) {
          const edgeEls = document.querySelectorAll(
            `.react-flow__edge[data-id="${edge.id}"], .react-flow__edge[data-testid="rf__edge-${edge.id}"], [id="${edge.id}"], [data-edge-id="${edge.id}"]`,
          );
          edgeEls.forEach((el) => {
            const container = (el.closest(".react-flow__edge") as HTMLElement) || (el as HTMLElement);
            container.style.transition = "opacity 0.18s ease";
            container.style.opacity = isInternal ? "0" : "0.2";
            container.style.pointerEvents = "none";
          });
        }
      });

      // Hide all edge cut buttons on active collection nodes
      document.querySelectorAll(".fuse-edge-cut").forEach((el) => {
        const btn = el as HTMLElement;
        btn.style.opacity = "0";
        btn.style.pointerEvents = "none";
      });
    },
    [clearTransforms],
  );

  const handleNodeDrag = useCallback(
    (_: ReactMouseEvent | MouseEvent | TouchEvent | unknown, activeNode: FuseNode, allNodes: FuseNode[]) => {
      if (!activeRef.current || !leaderIdRef.current) return;

      const nodeMap = new Map(allNodes.map((n) => [n.id, n]));
      const leader = nodeMap.get(leaderIdRef.current) || activeNode;
      if (!leader) return;

      selectedIdsRef.current.forEach((id, index) => {
        if (index === 0) return; // leader moves naturally with ReactFlow

        const nodeEl = document.querySelector(`.react-flow__node[data-id="${id}"]`);
        if (!nodeEl) return;
        const target = (nodeEl.firstElementChild as HTMLElement) || (nodeEl as HTMLElement);
        const node = nodeMap.get(id);
        if (!node) return;

        const dx = leader.position.x - node.position.x;
        const dy = leader.position.y - node.position.y;

        const sign = index % 2 === 1 ? 1 : -1;
        const fanX = sign * Math.min(index, 4) * 5;
        const fanY = index * 4;
        const fanRot = sign * Math.min(index, 5) * 3.5;
        const scale = Math.max(0.92, 1 - index * 0.015);

        target.style.transform = `translate3d(${dx + fanX}px, ${dy + fanY}px, 0) rotate(${fanRot}deg) scale(${scale})`;
      });
    },
    [],
  );

  const handleNodeDragStop = useCallback(
    (_: ReactMouseEvent | MouseEvent | TouchEvent | unknown, _activeNode: FuseNode, onSettled?: () => void) => {
      if (!activeRef.current) {
        onSettled?.();
        return;
      }

      setCollectionState((prev) => ({
        ...prev,
        isDropping: true,
      }));

      // Staggered spring-back animation for nodes
      const count = selectedIdsRef.current.length;
      selectedIdsRef.current.forEach((id, index) => {
        const nodeEl = document.querySelector(`.react-flow__node[data-id="${id}"]`);
        if (!nodeEl) return;
        const target = (nodeEl.firstElementChild as HTMLElement) || (nodeEl as HTMLElement);

        const staggerDelay = index * 40;
        target.style.transition = `transform 0.32s cubic-bezier(0.175, 0.885, 0.32, 1.275) ${staggerDelay}ms, box-shadow 0.25s ease ${staggerDelay}ms`;
        target.style.transform = "translate3d(0, 0, 0) rotate(0deg) scale(1)";
        target.style.boxShadow = "";
      });

      // Smoothly fade connector lines and labels back in
      const edges = useWorkflowStore.getState().edges;
      const selectedSet = new Set(selectedIdsRef.current);

      edges.forEach((edge) => {
        const isInternal = selectedSet.has(edge.source) && selectedSet.has(edge.target);
        const isConnected = selectedSet.has(edge.source) || selectedSet.has(edge.target);

        if (isInternal || isConnected) {
          const edgeEls = document.querySelectorAll(
            `.react-flow__edge[data-id="${edge.id}"], .react-flow__edge[data-testid="rf__edge-${edge.id}"], [id="${edge.id}"], [data-edge-id="${edge.id}"]`,
          );
          edgeEls.forEach((el) => {
            const container = (el.closest(".react-flow__edge") as HTMLElement) || (el as HTMLElement);
            container.style.transition = "opacity 0.32s cubic-bezier(0.16, 1, 0.3, 1) 0.08s";
            container.style.opacity = "1";
            container.style.pointerEvents = "";
          });
        }
      });

      const totalDuration = count * 40 + 350;
      dropTimeoutRef.current = setTimeout(() => {
        clearTransforms();
        activeRef.current = false;
        leaderIdRef.current = null;
        selectedIdsRef.current = [];
        setCollectionState({
          active: false,
          leaderId: null,
          count: 0,
          isDropping: false,
        });
        dropTimeoutRef.current = null;
        useWorkflowStore.getState().recomputeFrames();
        onSettled?.();
      }, totalDuration);
    },
    [clearTransforms],
  );

  return {
    collectionState,
    handleNodeDragStart,
    handleNodeDrag,
    handleNodeDragStop,
  };
}
