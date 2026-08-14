import { useEffect, useMemo, useRef, useState } from "react";
import { Play } from "lucide-react";
import { useUIStore, type InputValues } from "@/store/uiStore";
import { fillPlaceholders } from "@/lib/placeholders";
import { Button } from "@/components/ui/Button";

/**
 * Asked for just before a run when any command in it carries a
 * `{{placeholder}}`.
 *
 * The preview is the point: it shows the exact command line that will be
 * handed to the shell, quoting and all, so nobody has to guess how their
 * commit message got escaped.
 */

/** Last values, so re-running a workflow does not mean retyping everything. */
const remembered: InputValues = {};

export function RunInputDialog() {
  const request = useUIStore((s) => s.inputRequest);
  const answer = useUIStore((s) => s.answerInputs);

  const [values, setValues] = useState<InputValues>({});
  const firstField = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!request) return;
    setValues(Object.fromEntries(request.fields.map((f) => [f, remembered[f] ?? ""])));
  }, [request]);

  const previews = useMemo(
    () =>
      request?.blocks.map((block) => ({
        ...block,
        resolved: fillPlaceholders(block.command, values),
      })) ?? [],
    [request, values],
  );

  if (!request) return null;

  const submit = () => {
    Object.assign(remembered, values);
    answer(values);
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center pt-[16vh]"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) answer(null);
      }}
    >
      <div className="absolute inset-0 bg-canvas/55 backdrop-blur-[2px]" aria-hidden />

      <div
        className="animate-in-soft relative w-[520px] max-w-[calc(100vw-32px)] overflow-hidden rounded-xl border border-line-strong bg-base shadow-[0_18px_50px_-12px_rgba(0,0,0,0.8)]"
        onKeyDown={(e) => {
          e.stopPropagation();
          if (e.key === "Escape") answer(null);
          if (e.key === "Enter" && !e.shiftKey) submit();
        }}
      >
        <div className="border-b border-line px-3.5 py-2.5">
          <p className="text-[12px] font-medium text-fg">
            {request.fields.length === 1 ? "This run needs a value" : "This run needs some values"}
          </p>
          <p className="mt-0.5 text-[11px] text-fg-subtle">
            Filled in just for this run — your blocks keep the placeholders.
          </p>
        </div>

        <div className="space-y-2.5 px-3.5 py-3">
          {request.fields.map((field, index) => (
            <div key={field} className="flex items-center gap-2.5">
              <label
                htmlFor={`run-input-${field}`}
                className="w-[92px] shrink-0 truncate text-right font-mono text-[11px] text-fg-muted"
                title={field}
              >
                {field}
              </label>
              <input
                id={`run-input-${field}`}
                ref={index === 0 ? firstField : undefined}
                autoFocus={index === 0}
                value={values[field] ?? ""}
                spellCheck={false}
                autoCapitalize="off"
                autoCorrect="off"
                onChange={(e) => {
                  // Read the value *now*: React clears `currentTarget` once the
                  // handler returns, and the updater below runs later, during
                  // the next render.
                  const value = e.currentTarget.value;
                  setValues((v) => ({ ...v, [field]: value }));
                }}
                className="min-w-0 flex-1 rounded-[7px] border border-line bg-elevated px-2.5 py-1.5 text-[12px] text-fg outline-none focus:border-accent/70"
              />
            </div>
          ))}
        </div>

        {/* Exactly what the shell will receive. */}
        <div className="max-h-[180px] space-y-2 overflow-y-auto border-t border-line bg-elevated/40 px-3.5 py-2.5">
          {previews.map((block) => (
            <div key={block.id}>
              <div className="mb-0.5 text-[10px] text-fg-subtle">{block.label}</div>
              <div className="flex gap-1.5">
                <span className="select-none font-mono text-[11px] text-fg-subtle">$</span>
                <code className="selectable min-w-0 flex-1 font-mono text-[11px] leading-[16px] break-words whitespace-pre-wrap text-fg-muted">
                  {block.resolved}
                </code>
              </div>
            </div>
          ))}
        </div>

        <div className="flex items-center justify-end gap-1.5 border-t border-line px-3.5 py-2.5">
          <Button variant="ghost" onClick={() => answer(null)}>
            Cancel
          </Button>
          <Button variant="primary" onClick={submit}>
            <Play size={10} fill="currentColor" strokeWidth={0} />
            Run
          </Button>
        </div>
      </div>
    </div>
  );
}
