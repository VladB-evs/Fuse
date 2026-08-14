import type { NodeTypes } from "@xyflow/react";
import { CommandNode } from "./CommandNode";
import { FrameNode } from "./FrameNode";
import { ApprovalNode } from "./ApprovalNode";
import { ChoiceNode } from "./ChoiceNode";
import { InputNode } from "./InputNode";
import { ScriptNode } from "./ScriptNode";
import { ConditionNode } from "./ConditionNode";
import { CaptureNode } from "./CaptureNode";
import { WaitNode } from "./WaitNode";
import { HttpNode } from "./HttpNode";
import { NoteNode } from "./NoteNode";
import { ReadFileNode } from "./ReadFileNode";
import { WriteFileNode } from "./WriteFileNode";
import { SetVariableNode } from "./SetVariableNode";

/**
 * Node registry.
 *
 * A new kind needs an entry here, a variant in `NodePayload` on the Rust side,
 * a default in `emptyBlock()`, and a row in `lib/catalog.ts` — which is what
 * puts it in the picker, the palette and the output panel at once.
 */
export const nodeTypes: NodeTypes = {
  command: CommandNode,
  frame: FrameNode,
  approval: ApprovalNode,
  choice: ChoiceNode,
  input: InputNode,
  script: ScriptNode,
  condition: ConditionNode,
  capture: CaptureNode,
  wait: WaitNode,
  http: HttpNode,
  note: NoteNode,
  read_file: ReadFileNode,
  write_file: WriteFileNode,
  set_variable: SetVariableNode,
};
