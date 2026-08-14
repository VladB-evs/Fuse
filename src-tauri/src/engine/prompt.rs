//! Asking the person running the workflow a question, mid-run.
//!
//! The engine knows nothing about dialogs. It hands a [`PromptRequest`] to a
//! [`Prompter`] and awaits the answer; the app layer decides whether that means
//! a window, a test double, or nobody at all.
//!
//! Registration is synchronous on purpose: `request` must have recorded the
//! pending question *before* it returns, so the "waiting" event the engine
//! emits straight afterwards can never be answered before there is anything
//! listening for the answer.

use serde::{Deserialize, Serialize};
use std::future::Future;
use std::pin::Pin;

/// One of the paths out of a choice step.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct PromptOption {
    pub node_id: String,
    pub label: String,
    /// The command, or the step's own message — whatever says what it does.
    pub detail: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum PromptKind {
    #[serde(rename_all = "camelCase")]
    Approval {
        continue_label: String,
        stop_label: String,
    },
    #[serde(rename_all = "camelCase")]
    Choice {
        options: Vec<PromptOption>,
        allow_multiple: bool,
    },
    #[serde(rename_all = "camelCase")]
    Input {
        variable: String,
        default_value: String,
        secret: bool,
    },
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct PromptRequest {
    pub run_id: String,
    pub node_id: String,
    pub title: String,
    pub message: String,
    /// Steps whose output is worth reading before deciding — the direct
    /// dependencies of the waiting step. The UI already holds their output, so
    /// only the ids travel.
    pub sources: Vec<String>,
    #[serde(flatten)]
    pub kind: PromptKind,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(tag = "reply", rename_all = "camelCase")]
pub enum PromptReply {
    /// Carry on with the run.
    Approve,
    /// Stop the run here, deliberately.
    Deny,
    #[serde(rename_all = "camelCase")]
    Choose { node_ids: Vec<String> },
    #[serde(rename_all = "camelCase")]
    Value { value: String },
    /// The question went away without an answer (run stopped, window closed).
    Cancelled,
}

pub type PromptFuture = Pin<Box<dyn Future<Output = PromptReply> + Send>>;

/// Implemented by the host application to put questions in front of a human.
pub trait Prompter: Send + Sync + 'static {
    fn request(&self, request: PromptRequest) -> PromptFuture;
}

/// Answers on nobody's behalf: continue, take every path, accept the default.
///
/// This is what a headless run gets. It keeps `execute` usable in tests without
/// each of them having to stand up a fake UI.
pub struct AutoPrompter;

impl Prompter for AutoPrompter {
    fn request(&self, request: PromptRequest) -> PromptFuture {
        let reply = match request.kind {
            PromptKind::Approval { .. } => PromptReply::Approve,
            PromptKind::Choice { options, .. } => PromptReply::Choose {
                node_ids: options.into_iter().map(|o| o.node_id).collect(),
            },
            PromptKind::Input { default_value, .. } => PromptReply::Value {
                value: default_value,
            },
        };
        Box::pin(async move { reply })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_request_carries_its_kind_flat() {
        let request = PromptRequest {
            run_id: "r".into(),
            node_id: "n".into(),
            title: "Confirm".into(),
            message: "Continue?".into(),
            sources: vec!["a".into()],
            kind: PromptKind::Approval {
                continue_label: "Continue".into(),
                stop_label: "Stop".into(),
            },
        };

        let json = serde_json::to_value(&request).unwrap();
        assert_eq!(json["kind"], "approval");
        assert_eq!(json["continueLabel"], "Continue");
        assert_eq!(json["nodeId"], "n");

        let back: PromptRequest = serde_json::from_value(json).unwrap();
        assert_eq!(back, request);
    }

    #[test]
    fn replies_round_trip_from_the_shapes_the_ui_sends() {
        let approve: PromptReply = serde_json::from_str(r#"{"reply":"approve"}"#).unwrap();
        assert_eq!(approve, PromptReply::Approve);

        let chosen: PromptReply =
            serde_json::from_str(r#"{"reply":"choose","nodeIds":["a","b"]}"#).unwrap();
        assert_eq!(
            chosen,
            PromptReply::Choose {
                node_ids: vec!["a".into(), "b".into()]
            }
        );

        let value: PromptReply = serde_json::from_str(r#"{"reply":"value","value":"v1.2"}"#).unwrap();
        assert_eq!(
            value,
            PromptReply::Value {
                value: "v1.2".into()
            }
        );
    }
}
