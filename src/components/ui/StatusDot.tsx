import { cn } from "@/lib/utils";
import { STATUS_LABEL, STATUS_TONE, TONE_BG, TONE_TEXT } from "@/lib/status";
import type { NodeRunState } from "@/types/workflow";

export function StatusDot({
  status,
  className,
}: {
  status: NodeRunState;
  className?: string;
}) {
  const tone = STATUS_TONE[status];
  return (
    <span
      className={cn(
        "inline-block size-[6px] shrink-0 rounded-full",
        TONE_BG[tone],
        status === "skipped" && "opacity-45",
        status === "running" && "status-pulse",
        className,
      )}
    />
  );
}

export function StatusBadge({
  status,
  label,
  className,
}: {
  status: NodeRunState;
  label?: string;
  className?: string;
}) {
  const tone = STATUS_TONE[status];
  return (
    <span className={cn("flex items-center gap-1.5 text-[11px]", TONE_TEXT[tone], className)}>
      <StatusDot status={status} />
      <span className="tabular-nums">{label ?? STATUS_LABEL[status]}</span>
    </span>
  );
}
