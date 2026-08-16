import { memo } from "react";
import { type NodeProps } from "@xyflow/react";
import { Plus, X } from "lucide-react";
import { useWorkflowStore } from "@/store/workflowStore";
import { Choices, CodeArea, NodeShell, Note, TextField, Toggle, fieldKeys } from "./NodeShell";
import { cn } from "@/lib/utils";
import type { HttpNodeType } from "@/types/workflow";

const METHODS = ["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD"];
/** Methods where a body is the normal thing rather than a curiosity. */
const TAKES_BODY = new Set(["POST", "PUT", "PATCH", "DELETE"]);

/**
 * An HTTP request as a first-class step.
 *
 * It goes out through `curl`, so proxies, certificates and `~/.curlrc` behave
 * as they do everywhere else on the machine — and the response can be kept
 * under a name, which is what makes it composable with the rest.
 */
function HttpNodeImpl({ id, data, selected }: NodeProps<HttpNodeType>) {
  const updateNodeData = useWorkflowStore((s) => s.updateNodeData);
  const beginEdit = useWorkflowStore((s) => s.beginEdit);

  const headers = Object.entries(data.headers);

  const replaceHeader = (oldKey: string, nextKey: string, nextValue: string) => {
    beginEdit();
    const next: Record<string, string> = {};
    for (const [k, v] of headers) {
      if (k === oldKey) {
        if (nextKey) next[nextKey] = nextValue;
      } else {
        next[k] = v;
      }
    }
    if (!oldKey && nextKey) next[nextKey] = nextValue;
    updateNodeData(id, { headers: next });
  };

  return (
    <NodeShell
      id={id}
      kind="http"
      label={data.label}
      frameId={data.frameId}
      selected={!!selected}
      onRename={(label) => updateNodeData(id, { label })}
    >
      <Choices
        label="Method"
        value={data.method}
        options={METHODS}
        onChange={(method) => {
          beginEdit();
          updateNodeData(id, { method });
        }}
      />

      <TextField
        label="URL"
        value={data.url}
        placeholder="https://api.example.com/deploys"
        invalid={data.url.trim() === ""}
        onCommit={beginEdit}
        onChange={(url) => updateNodeData(id, { url })}
      />

      <div className="border-t border-line/60 pt-1.5">
        <div className="mb-1 flex items-center justify-between">
          <span className="text-[10.5px] text-fg-subtle">Headers</span>
          <button
            type="button"
            onClick={() => {
              beginEdit();
              let key = "Authorization";
              let index = 2;
              while (data.headers[key] !== undefined) key = `Header-${index++}`;
              updateNodeData(id, { headers: { ...data.headers, [key]: "" } });
            }}
            className="nodrag flex items-center gap-0.5 rounded-[4px] px-1 py-0.5 text-[10px] text-accent hover:bg-hover"
          >
            <Plus size={9} strokeWidth={2.5} /> Add
          </button>
        </div>

        {headers.length === 0 ? (
          <p className="text-[10px] text-fg-subtle/80">
            None. A JSON body gets its content type on its own.
          </p>
        ) : (
          <div className="space-y-1">
            {headers.map(([key, value]) => (
              <div key={key} className="flex items-center gap-1">
                <input
                  value={key}
                  aria-label="Header name"
                  spellCheck={false}
                  onFocus={beginEdit}
                  onChange={(e) => replaceHeader(key, e.currentTarget.value, value)}
                  onKeyDown={(e) => fieldKeys(e)}
                  className={FIELD}
                />
                <span className="text-[10px] text-fg-subtle">:</span>
                <input
                  value={value}
                  aria-label={`Value for ${key}`}
                  spellCheck={false}
                  onFocus={beginEdit}
                  onChange={(e) =>
                    updateNodeData(id, {
                      headers: { ...data.headers, [key]: e.currentTarget.value },
                    })
                  }
                  onKeyDown={(e) => fieldKeys(e)}
                  className={cn(FIELD, "flex-1")}
                />
                <button
                  type="button"
                  aria-label={`Remove ${key}`}
                  onClick={() => replaceHeader(key, "", "")}
                  className="nodrag rounded-[4px] p-0.5 text-fg-subtle hover:bg-hover hover:text-danger"
                >
                  <X size={10} strokeWidth={2} />
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      {TAKES_BODY.has(data.method.toUpperCase()) && (
        <CodeArea
          value={data.body}
          rows={3}
          placeholder={'{ "ref": "{{SHA}}" }'}
          onCommit={beginEdit}
          onChange={(body) => updateNodeData(id, { body })}
        />
      )}

      <TextField
        label="Keep as"
        value={data.variable}
        placeholder="RESPONSE (optional)"
        onCommit={beginEdit}
        onChange={(variable) => updateNodeData(id, { variable })}
      />

      <Toggle
        checked={data.failOnErrorStatus}
        onChange={(failOnErrorStatus) => {
          beginEdit();
          updateNodeData(id, { failOnErrorStatus });
        }}
      >
        Fail on 4xx and 5xx
      </Toggle>

      <Note>Values from earlier steps work in the URL, headers and body.</Note>
    </NodeShell>
  );
}

const FIELD =
  "nodrag min-w-0 w-[38%] rounded-[4px] border border-line bg-elevated/60 px-1.5 py-1 font-mono text-[10px] text-fg outline-none focus:border-accent";

export const HttpNode = memo(HttpNodeImpl);
