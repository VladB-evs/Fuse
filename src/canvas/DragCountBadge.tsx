import { cn } from "@/lib/utils";

interface DragCountBadgeProps {
  count: number;
  className?: string;
}

export function DragCountBadge({ count, className }: DragCountBadgeProps) {
  if (count <= 1) return null;

  return (
    <div
      className={cn(
        "pointer-events-none absolute -top-3.5 -right-3.5 z-[1100] flex items-center gap-1",
        "animate-in zoom-in-50 duration-200 ease-out",
        className,
      )}
    >
      <div
        className={cn(
          "flex h-[22px] min-w-[22px] items-center justify-center rounded-full px-1.5",
          "bg-gradient-to-b from-rose-500 to-rose-600 text-white font-bold text-[11.5px] leading-none",
          "border border-white/40 shadow-[0_4px_12px_rgba(244,63,94,0.4),0_2px_4px_rgba(0,0,0,0.4)]",
          "tracking-tight tabular-nums select-none",
        )}
      >
        {count}
      </div>
    </div>
  );
}

export default DragCountBadge;
