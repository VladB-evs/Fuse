//! Graph resolution: turn a workflow's nodes + edges into a validated DAG with
//! a deterministic execution order.
//!
//! Nothing here assumes the graph is a straight line. Branches, diamonds and
//! multiple roots all resolve correctly; the scheduler in `mod.rs` simply walks
//! the order this produces and consults `dependencies_of` for gating.

use crate::model::{Workflow, WorkflowNode};
use std::collections::{HashMap, HashSet, VecDeque};

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

    /// Builds a DAG from a workflow document.
    pub fn build(workflow: &Workflow) -> Result<Self, GraphError> {
        // Frames are scenery — they group blocks and set a directory, but they
        // never execute, so they stay out of the graph entirely. Every other
        // kind is a step, whether it runs a command or asks a question.
        let runnable: Vec<&WorkflowNode> = workflow
            .nodes
            .iter()
            .filter(|n| n.is_runnable())
            .collect();

        if runnable.is_empty() {
            return Err(GraphError::Empty);
        }

        let ids: HashSet<&str> = runnable.iter().map(|n| n.id.as_str()).collect();
        let known: HashSet<&str> = workflow.nodes.iter().map(|n| n.id.as_str()).collect();

        let mut dependencies: HashMap<String, Vec<String>> = HashMap::new();
        let mut dependents: HashMap<String, Vec<String>> = HashMap::new();
        let mut indegree: HashMap<String, usize> = HashMap::new();

        for node in &runnable {
            dependencies.entry(node.id.clone()).or_default();
            dependents.entry(node.id.clone()).or_default();
            indegree.entry(node.id.clone()).or_insert(0);
        }

        let mut frame_children: HashMap<&str, Vec<&str>> = HashMap::new();
        for node in &runnable {
            if let Some(fid) = node.frame_id() {
                frame_children.entry(fid).or_default().push(node.id.as_str());
            }
        }

        // Build active outgoing adjacency map for all nodes
        let mut outgoing: HashMap<&str, Vec<&str>> = HashMap::new();

        for edge in &workflow.edges {
            if edge.disabled == Some(true) {
                continue;
            }
            if !known.contains(edge.source.as_str()) {
                return Err(GraphError::DanglingEdge(edge.source.clone()));
            }
            if !known.contains(edge.target.as_str()) {
                return Err(GraphError::DanglingEdge(edge.target.clone()));
            }

            outgoing
                .entry(edge.source.as_str())
                .or_default()
                .push(edge.target.as_str());
        }

        // Helper to resolve runnable targets through zero or more disabled nodes
        let resolve_runnable_targets = |start: &str| -> Vec<String> {
            let mut result = Vec::new();
            let mut visited = HashSet::new();
            let mut queue = VecDeque::new();

            queue.push_back(start);
            visited.insert(start);

            while let Some(curr) = queue.pop_front() {
                if ids.contains(curr) {
                    result.push(curr.to_string());
                } else if let Some(children) = frame_children.get(curr) {
                    for &child in children {
                        if ids.contains(child) {
                            result.push(child.to_string());
                        }
                    }
                } else {
                    // curr is a non-runnable node (e.g. disabled block or empty frame);
                    // traverse downstream active edges to bypass this node and connect downstream
                    if let Some(next_nodes) = outgoing.get(curr) {
                        for &next in next_nodes {
                            if visited.insert(next) {
                                queue.push_back(next);
                            }
                        }
                    }
                }
            }
            result
        };

        // De-duplicate parallel edges so indegree accounting stays honest.
        let mut seen_pairs: HashSet<(&str, String)> = HashSet::new();

        for edge in &workflow.edges {
            if edge.disabled == Some(true) {
                continue;
            }

            // Expand sources: if source is runnable, it's [source]. If frame, all runnable children.
            let sources = if ids.contains(edge.source.as_str()) {
                vec![edge.source.as_str()]
            } else if let Some(children) = frame_children.get(edge.source.as_str()) {
                children.clone()
            } else {
                // If edge source is a disabled block, we don't start from here because
                // upstream runnable nodes will traverse forward through this disabled block.
                vec![]
            };

            let targets = resolve_runnable_targets(edge.target.as_str());

            for &s in &sources {
                for t in &targets {
                    if s == t.as_str() {
                        return Err(GraphError::Cycle(s.to_string()));
                    }
                    if seen_pairs.insert((s, t.clone())) {
                        dependencies
                            .entry(t.clone())
                            .or_default()
                            .push(s.to_string());
                        dependents
                            .entry(s.to_string())
                            .or_default()
                            .push(t.clone());
                        *indegree.entry(t.clone()).or_insert(0) += 1;
                    }
                }
            }
        }

        // Kahn's algorithm. Among simultaneously-ready nodes we pick the
        // top-most / left-most on the canvas so runs are reproducible and match
        // what the user sees.
        let sort_key = build_sort_keys(&runnable);

        let mut ready: Vec<String> = indegree
            .iter()
            .filter(|(_, &deg)| deg == 0)
            .map(|(id, _)| id.clone())
            .collect();
        sort_by_key(&mut ready, &sort_key);

        let mut order = Vec::with_capacity(runnable.len());

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

        if order.len() != runnable.len() {
            let stuck: Vec<String> = runnable
                .iter()
                .filter(|n| !order.contains(&n.id))
                .map(|n| n.title())
                .collect();
            return Err(GraphError::Cycle(stuck.join(" → ")));
        }

        Ok(Dag {
            order,
            dependencies,
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
    fn disabled_nodes_are_skipped_from_execution() {
        let mut n2 = node("b", 100.0);
        n2.disabled = Some(true);
        let wf = workflow(
            vec![node("a", 0.0), n2, node("c", 200.0)],
            vec![edge("a", "b"), edge("b", "c")],
        );
        let dag = Dag::build(&wf).unwrap();
        assert_eq!(dag.order(), &["a", "c"]);
        assert_eq!(dag.dependencies_of("c"), &["a"]);
    }

    #[test]
    fn disabled_edges_do_not_impose_dependencies() {
        let mut e = edge("a", "b");
        e.disabled = Some(true);
        let wf = workflow(
            vec![node("a", 0.0), node("b", 100.0)],
            vec![e],
        );
        let dag = Dag::build(&wf).unwrap();
        // Since the edge is disabled, 'b' has no dependencies on 'a'
        assert_eq!(dag.dependencies_of("b"), &[] as &[String]);
    }
}
