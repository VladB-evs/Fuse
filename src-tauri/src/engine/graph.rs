//! Graph resolution: turn a workflow's nodes + edges into a validated DAG with
//! a deterministic execution order.
//!
//! Nothing here assumes the graph is a straight line. Branches, diamonds and
//! multiple roots all resolve correctly; the scheduler in `mod.rs` simply walks
//! the order this produces and consults `dependencies_of` for gating.

use crate::model::{Workflow, WorkflowNode};
use std::collections::{HashMap, HashSet};

#[derive(Debug, thiserror::Error)]
pub enum GraphError {
    #[error("This workflow has no command blocks to run.")]
    Empty,
    #[error("This workflow has a cycle ({0}) — commands would never finish.")]
    Cycle(String),
    #[error("Edge references a node that does not exist: {0}")]
    DanglingEdge(String),
}

pub struct Dag {
    order: Vec<String>,
    dependencies: HashMap<String, Vec<String>>,
    disabled_incoming: HashSet<String>,
}

impl Dag {
    /// Topologically sorted execution order.
    pub fn order(&self) -> &[String] {
        &self.order
    }

    /// The list of block ids that must finish successfully before `id` is
    /// allowed to run.
    pub fn dependencies_of(&self, id: &str) -> &[String] {
        self.dependencies
            .get(id)
            .map(|v| v.as_slice())
            .unwrap_or(&[])
    }

    /// All transitive upstream dependencies of `id` in the active graph.
    pub fn transitive_dependencies_of(&self, id: &str) -> HashSet<String> {
        let mut result = HashSet::new();
        let mut queue = vec![id.to_string()];
        while let Some(curr) = queue.pop() {
            for dep in self.dependencies_of(&curr) {
                if result.insert(dep.clone()) {
                    queue.push(dep.clone());
                }
            }
        }
        result
    }

    /// True if the node has incoming connections in the workflow, but all of them are disabled.
    pub fn is_disabled_incoming(&self, id: &str) -> bool {
        self.disabled_incoming.contains(id)
    }

    /// Builds a DAG from a workflow document.
    pub fn build(workflow: &Workflow) -> Result<Self, GraphError> {
        // Frames are scenery — they group blocks, but they never execute. Every other kind is a step in the DAG.
        let step_nodes: Vec<&WorkflowNode> = workflow
            .nodes
            .iter()
            .filter(|n| !n.is_frame())
            .collect();

        if step_nodes.is_empty() {
            return Err(GraphError::Empty);
        }

        let ids: HashSet<&str> = step_nodes.iter().map(|n| n.id.as_str()).collect();
        let known: HashSet<&str> = workflow.nodes.iter().map(|n| n.id.as_str()).collect();

        let mut frame_children: HashMap<&str, Vec<&str>> = HashMap::new();
        for node in &step_nodes {
            if let Some(fid) = node.frame_id() {
                frame_children.entry(fid).or_default().push(node.id.as_str());
            }
        }

        let expand_target = |target: &str| -> Vec<&str> {
            if let Some(&id_ref) = ids.get(target) {
                vec![id_ref]
            } else if let Some(children) = frame_children.get(target) {
                children.clone()
            } else {
                vec![]
            }
        };

        for edge in &workflow.edges {
            if !known.contains(edge.source.as_str()) {
                return Err(GraphError::DanglingEdge(edge.source.clone()));
            }
            if !known.contains(edge.target.as_str()) {
                return Err(GraphError::DanglingEdge(edge.target.clone()));
            }
        }

        // Track incoming and outgoing edges per node: total vs active (non-disabled)
        let mut total_incoming: HashMap<&str, usize> = HashMap::new();
        let mut active_incoming: HashMap<&str, usize> = HashMap::new();
        let mut total_outgoing: HashMap<&str, usize> = HashMap::new();
        let mut active_outgoing: HashMap<&str, usize> = HashMap::new();

        for edge in &workflow.edges {
            let sources = expand_target(edge.source.as_str());
            let targets = expand_target(edge.target.as_str());
            for &s in &sources {
                if !targets.is_empty() {
                    *total_outgoing.entry(s).or_insert(0) += 1;
                    if edge.disabled != Some(true) {
                        *active_outgoing.entry(s).or_insert(0) += 1;
                    }
                }
            }
            for &t in &targets {
                if !sources.is_empty() {
                    *total_incoming.entry(t).or_insert(0) += 1;
                    if edge.disabled != Some(true) {
                        *active_incoming.entry(t).or_insert(0) += 1;
                    }
                }
            }
        }

        let mut disabled_incoming: HashSet<String> = HashSet::new();
        for node in &step_nodes {
            let tot_in = total_incoming.get(node.id.as_str()).copied().unwrap_or(0);
            let act_in = active_incoming.get(node.id.as_str()).copied().unwrap_or(0);
            if tot_in > 0 && act_in == 0 {
                disabled_incoming.insert(node.id.clone());
            }
        }

        let mut dependencies: HashMap<String, Vec<String>> = HashMap::new();
        let mut dependents: HashMap<String, Vec<String>> = HashMap::new();
        let mut indegree: HashMap<String, usize> = HashMap::new();

        for node in &step_nodes {
            dependencies.entry(node.id.clone()).or_default();
            dependents.entry(node.id.clone()).or_default();
            indegree.entry(node.id.clone()).or_insert(0);
        }

        // De-duplicate parallel edges so indegree accounting stays honest.
        let mut seen_pairs: HashSet<(&str, &str)> = HashSet::new();

        for edge in &workflow.edges {
            if edge.disabled == Some(true) {
                continue;
            }

            let sources = expand_target(edge.source.as_str());
            let targets = expand_target(edge.target.as_str());

            for &s in &sources {
                for &t in &targets {
                    if s == t {
                        return Err(GraphError::Cycle(s.to_string()));
                    }
                    if seen_pairs.insert((s, t)) {
                        dependencies
                            .entry(t.to_string())
                            .or_default()
                            .push(s.to_string());
                        dependents
                            .entry(s.to_string())
                            .or_default()
                            .push(t.to_string());
                        *indegree.entry(t.to_string()).or_insert(0) += 1;
                    }
                }
            }
        }

        // Kahn's algorithm. Among simultaneously-ready nodes we pick the
        // top-most / left-most on the canvas so runs are reproducible and match
        // what the user sees.
        let sort_key = build_sort_keys(&step_nodes);

        let mut ready: Vec<String> = indegree
            .iter()
            .filter(|(_, &deg)| deg == 0)
            .map(|(id, _)| id.clone())
            .collect();
        sort_by_key(&mut ready, &sort_key);

        let mut order = Vec::with_capacity(step_nodes.len());

        while let Some(next) = ready.first().cloned() {
            ready.remove(0);
            order.push(next.clone());

            if let Some(children) = dependents.get(&next) {
                let mut unlocked = Vec::new();
                for child in children {
                    if let Some(deg) = indegree.get_mut(child) {
                        *deg -= 1;
                        if *deg == 0 {
                            unlocked.push(child.clone());
                        }
                    }
                }
                if !unlocked.is_empty() {
                    ready.extend(unlocked);
                    sort_by_key(&mut ready, &sort_key);
                }
            }
        }

        if order.len() != step_nodes.len() {
            let stuck: Vec<String> = step_nodes
                .iter()
                .filter(|n| !order.contains(&n.id))
                .map(|n| n.title())
                .collect();
            return Err(GraphError::Cycle(stuck.join(" → ")));
        }

        Ok(Dag {
            order,
            dependencies,
            disabled_incoming,
        })
    }
}

type SortKey = (i64, i64, String);

fn build_sort_keys(nodes: &[&WorkflowNode]) -> HashMap<String, SortKey> {
    nodes
        .iter()
        .map(|n| {
            (
                n.id.clone(),
                (
                    n.position.y.round() as i64,
                    n.position.x.round() as i64,
                    n.id.clone(),
                ),
            )
        })
        .collect()
}

fn sort_by_key(ids: &mut [String], keys: &HashMap<String, SortKey>) {
    ids.sort_by(|a, b| {
        let ka = keys.get(a);
        let kb = keys.get(b);
        ka.cmp(&kb)
    });
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::model::{CommandData, NodePayload, Position, WorkflowEdge};

    fn node(id: &str, y: f64) -> WorkflowNode {
        WorkflowNode {
            id: id.into(),
            position: Position { x: 0.0, y },
            disabled: None,
            payload: NodePayload::Command(CommandData {
                command: format!("echo {id}"),
                ..Default::default()
            }),
        }
    }

    fn edge(source: &str, target: &str) -> WorkflowEdge {
        WorkflowEdge {
            id: format!("{source}-{target}"),
            source: source.into(),
            target: target.into(),
            source_handle: None,
            target_handle: None,
            disabled: None,
        }
    }

    fn workflow(nodes: Vec<WorkflowNode>, edges: Vec<WorkflowEdge>) -> Workflow {
        Workflow {
            id: "w".into(),
            name: "test".into(),
            working_dir: None,
            nodes,
            edges,
            created_at: 0,
            updated_at: 0,
        }
    }

    #[test]
    fn linear_chain_runs_in_order() {
        // Deliberately declare the nodes out of order to prove edges win.
        let wf = workflow(
            vec![node("c", 200.0), node("a", 0.0), node("b", 100.0)],
            vec![edge("a", "b"), edge("b", "c")],
        );
        let dag = Dag::build(&wf).unwrap();
        assert_eq!(dag.order(), &["a", "b", "c"]);
        assert_eq!(dag.dependencies_of("c"), &["b"]);
    }

    #[test]
    fn diamond_resolves_and_joins() {
        let wf = workflow(
            vec![
                node("root", 0.0),
                node("left", 100.0),
                node("right", 110.0),
                node("join", 200.0),
            ],
            vec![
                edge("root", "left"),
                edge("root", "right"),
                edge("left", "join"),
                edge("right", "join"),
            ],
        );
        let dag = Dag::build(&wf).unwrap();
        assert_eq!(dag.order(), &["root", "left", "right", "join"]);
        let mut deps = dag.dependencies_of("join").to_vec();
        deps.sort();
        assert_eq!(deps, vec!["left".to_string(), "right".to_string()]);
    }

    #[test]
    fn disconnected_roots_sort_by_canvas_position() {
        let wf = workflow(vec![node("low", 500.0), node("high", 10.0)], vec![]);
        let dag = Dag::build(&wf).unwrap();
        assert_eq!(dag.order(), &["high", "low"]);
    }

    #[test]
    fn cycles_are_rejected() {
        let wf = workflow(
            vec![node("a", 0.0), node("b", 100.0)],
            vec![edge("a", "b"), edge("b", "a")],
        );
        assert!(matches!(Dag::build(&wf), Err(GraphError::Cycle(_))));
    }

    #[test]
    fn duplicate_edges_do_not_deadlock() {
        let wf = workflow(
            vec![node("a", 0.0), node("b", 100.0)],
            vec![edge("a", "b"), edge("a", "b")],
        );
        let dag = Dag::build(&wf).unwrap();
        assert_eq!(dag.order(), &["a", "b"]);
    }

    #[test]
    fn empty_workflow_is_an_error() {
        let wf = workflow(vec![], vec![]);
        assert!(matches!(Dag::build(&wf), Err(GraphError::Empty)));
    }

    fn frame(id: &str) -> WorkflowNode {
        WorkflowNode {
            id: id.into(),
            position: Position {
                x: -100.0,
                y: -100.0,
            },
            disabled: None,
            payload: NodePayload::Frame(crate::model::FrameData::default()),
        }
    }

    #[test]
    fn frames_are_not_execution_steps() {
        let wf = workflow(
            vec![frame("f"), node("a", 0.0), node("b", 100.0)],
            vec![edge("a", "b")],
        );
        let dag = Dag::build(&wf).unwrap();
        assert_eq!(dag.order(), &["a", "b"]);
    }

    #[test]
    fn a_workflow_of_only_frames_has_nothing_to_run() {
        let wf = workflow(vec![frame("f")], vec![]);
        assert!(matches!(Dag::build(&wf), Err(GraphError::Empty)));
    }

    #[test]
    fn disabled_nodes_remain_in_order_with_natural_dependencies() {
        let mut n2 = node("b", 100.0);
        n2.disabled = Some(true);
        let wf = workflow(
            vec![node("a", 0.0), n2, node("c", 200.0)],
            vec![edge("a", "b"), edge("b", "c")],
        );
        let dag = Dag::build(&wf).unwrap();
        assert_eq!(dag.order(), &["a", "b", "c"]);
        assert_eq!(dag.dependencies_of("b"), &["a"]);
        assert_eq!(dag.dependencies_of("c"), &["b"]);
    }

    #[test]
    fn disabled_edges_are_tracked_as_disabled_incoming() {
        let mut e = edge("a", "b");
        e.disabled = Some(true);
        let wf = workflow(
            vec![node("a", 0.0), node("b", 100.0)],
            vec![e],
        );
        let dag = Dag::build(&wf).unwrap();
        // Since the edge is disabled, 'b' has no active dependencies, but is marked disabled_incoming
        assert_eq!(dag.dependencies_of("b"), &[] as &[String]);
        assert!(dag.is_disabled_incoming("b"));
    }

    #[test]
    fn frame_to_confirm_to_frame_resolves_in_order() {
        let f1 = frame("f1");
        let mut b1 = node("b1", 10.0);
        if let NodePayload::Command(ref mut d) = b1.payload {
            d.frame_id = Some("f1".into());
        }

        let confirm = WorkflowNode {
            id: "confirm".into(),
            position: Position { x: 0.0, y: 100.0 },
            disabled: None,
            payload: NodePayload::Approval(crate::model::ApprovalData::default()),
        };

        let f2 = frame("f2");
        let mut b2 = node("b2", 200.0);
        if let NodePayload::Command(ref mut d) = b2.payload {
            d.frame_id = Some("f2".into());
        }

        let wf = workflow(
            vec![f1, b1, confirm, f2, b2],
            vec![edge("f1", "confirm"), edge("confirm", "f2")],
        );

        let dag = Dag::build(&wf).unwrap();
        assert_eq!(dag.order(), &["b1", "confirm", "b2"]);
        assert_eq!(dag.dependencies_of("confirm"), &["b1"]);
        assert_eq!(dag.dependencies_of("b2"), &["confirm"]);
    }


}
