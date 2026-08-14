import dagre from "dagre";
import type { FuseNode, PersistedEdge } from "@/types/workflow";
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
}
