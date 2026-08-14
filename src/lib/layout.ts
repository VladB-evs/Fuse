import dagre from "dagre";
import type { FuseNode, PersistedEdge } from "@/types/workflow";
import { isBlockNode } from "@/types/workflow";
import { useWorkflowStore } from "@/store/workflowStore";

export function getLayoutedElements(nodes: FuseNode[], edges: PersistedEdge[], direction = "TB") {
  const dagreGraph = new dagre.graphlib.Graph();
  dagreGraph.setDefaultEdgeLabel(() => ({}));

  // Setup layout settings
  dagreGraph.setGraph({ 
    rankdir: direction,
    nodesep: 80,
    edgesep: 80,
    ranksep: 120,
    align: "UL", // top-left alignment
  });

  nodes.forEach((node) => {
    const width = node.measured?.width ?? node.width ?? 300;
    const height = node.measured?.height ?? node.height ?? 100;
    dagreGraph.setNode(node.id, { width, height });
  });

  edges.forEach((edge) => {
    dagreGraph.setEdge(edge.source, edge.target);
  });

  dagre.layout(dagreGraph);

  // Map back to our nodes
  const layoutedNodes = nodes.map((node) => {
    const nodeWithPosition = dagreGraph.node(node.id);
    
    // Dagre returns the center point of the node, React Flow expects top-left
    const width = node.measured?.width ?? node.width ?? 300;
    const height = node.measured?.height ?? node.height ?? 100;

    return {
      ...node,
      position: {
        x: nodeWithPosition.x - width / 2,
        y: nodeWithPosition.y - height / 2,
      },
    };
  });

  return layoutedNodes;
}

export async function autoLayoutGraph() {
  const store = useWorkflowStore.getState();
  const nodes = store.nodes;
  const edges = store.edges;

  if (nodes.length === 0) return;

  const layoutedNodes = getLayoutedElements(nodes, edges);

  useWorkflowStore.setState((state) => ({
    ...state,
    nodes: layoutedNodes as any,
    dirty: true
  }));
  useWorkflowStore.getState().recomputeFrames();
}

export async function autoLayoutFrame(frameId: string) {
  const store = useWorkflowStore.getState();
  const allNodes = store.nodes;
  const allEdges = store.edges;

  const frameNodes = allNodes.filter(n => isBlockNode(n) && n.data?.frameId === frameId);
  if (frameNodes.length === 0) return;

  const frameNodeIds = new Set(frameNodes.map(n => n.id));
  const frameEdges = allEdges.filter(e => frameNodeIds.has(e.source) && frameNodeIds.has(e.target));

  const layoutedFrameNodes = getLayoutedElements(frameNodes, frameEdges);

  let minX = Infinity, minY = Infinity;
  for (const n of frameNodes) {
    if (n.position.x < minX) minX = n.position.x;
    if (n.position.y < minY) minY = n.position.y;
  }
  
  let newMinX = Infinity, newMinY = Infinity;
  for (const n of layoutedFrameNodes) {
    if (n.position.x < newMinX) newMinX = n.position.x;
    if (n.position.y < newMinY) newMinY = n.position.y;
  }

  const offsetX = minX !== Infinity && newMinX !== Infinity ? minX - newMinX : 0;
  const offsetY = minY !== Infinity && newMinY !== Infinity ? minY - newMinY : 0;

  const finalNodes = layoutedFrameNodes.map(n => ({
    ...n,
    position: {
      x: n.position.x + offsetX,
      y: n.position.y + offsetY
    }
  }));

  const updatedNodesMap = new Map(finalNodes.map(n => [n.id, n]));

  const nextNodes = allNodes.map(n => {
    if (updatedNodesMap.has(n.id)) {
      return updatedNodesMap.get(n.id)!;
    }
    return n;
  });

  useWorkflowStore.setState((state) => ({
    ...state,
    nodes: nextNodes as any,
    dirty: true
  }));
  useWorkflowStore.getState().recomputeFrames();
}
