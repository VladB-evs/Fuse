import { useEffect, useMemo, useState } from "react";
import { ChevronRight, GitBranch, Sparkles } from "lucide-react";
import { repositoryActivity } from "@/bridge/commands";
import { prettyPath } from "@/lib/utils";
import type { RepositoryActivity, RepositoryCommit } from "@/types/workflow";

const GRAPH_WIDTH_PER_COL = 14;
const ROW_HEIGHT = 72;
const DOT_CY = 16;
const GRAPH_COLORS = ["#ef4444", "#3b82f6", "#10b981", "#f59e0b", "#8b5cf6", "#ec4899", "#14b8a6"];

type LineSegment = {
  fromColumn: number;
  toColumn: number;
  color: string;
};

type GraphCommit = RepositoryCommit & {
  column: number;
  color: string;
  incoming: LineSegment[];
  outgoing: LineSegment[];
  numColumns: number;
};

function buildGraph(commits: RepositoryCommit[]): GraphCommit[] {
  const active: (string | null)[] = [];
  const graph: GraphCommit[] = [];

  for (const commit of commits) {
    let col = active.indexOf(commit.hash);
    if (col === -1) {
      col = active.findIndex(h => h === null);
      if (col === -1) col = active.length;
    }
    const color = GRAPH_COLORS[col % GRAPH_COLORS.length]!;
    const incoming: LineSegment[] = [];
    
    for (let i = 0; i < active.length; i++) {
      if (active[i] !== null) {
        if (active[i] === commit.hash) {
          incoming.push({ fromColumn: i, toColumn: col, color: GRAPH_COLORS[i % GRAPH_COLORS.length]! });
          active[i] = null;
        } else {
          incoming.push({ fromColumn: i, toColumn: i, color: GRAPH_COLORS[i % GRAPH_COLORS.length]! });
        }
      }
    }
    
    const nextBranches = [...active];
    const outgoing: LineSegment[] = [];
    
    if (commit.parents && commit.parents.length > 0) {
      nextBranches[col] = commit.parents[0]!;
      outgoing.push({ fromColumn: col, toColumn: col, color });
      
      for (let i = 1; i < commit.parents.length; i++) {
        const p = commit.parents[i]!;
        let pCol = nextBranches.indexOf(p);
        if (pCol === -1) {
          pCol = nextBranches.findIndex(h => h === null);
          if (pCol === -1) pCol = nextBranches.length;
          nextBranches[pCol] = p;
        }
        outgoing.push({ fromColumn: col, toColumn: pCol, color: GRAPH_COLORS[pCol % GRAPH_COLORS.length]! });
      }
    }
    
    for (let i = 0; i < nextBranches.length; i++) {
      if (i !== col && nextBranches[i] !== null && active[i] !== null) {
        outgoing.push({ fromColumn: i, toColumn: i, color: GRAPH_COLORS[i % GRAPH_COLORS.length]! });
      }
    }
    
    graph.push({ 
      ...commit, 
      column: col, 
      color, 
      incoming, 
      outgoing, 
      numColumns: Math.max(active.length, nextBranches.length, col + 1) 
    });
    
    active.length = 0;
    active.push(...nextBranches);
  }
  
  return graph;
}

function isoDate(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function graphDays(activity: RepositoryActivity | null) {
  const values = new Map(activity?.days.map((day) => [day.date, day.count]));
  const start = new Date();
  start.setHours(12, 0, 0, 0);
  start.setDate(start.getDate() - start.getDay() - 52 * 7);

  return Array.from({ length: 53 * 7 }, (_, index) => {
    const date = new Date(start);
    date.setDate(start.getDate() + index);
    const key = isoDate(date);

    return {
      date: key,
      count: values.get(key) ?? 0,
    };
  });
}

function cellColor(count: number): string {
  if (count === 0) return "#1a1a1e";
  if (count === 1) return "#263958";
  if (count < 4) return "#3659a8";
  if (count < 8) return "#5476ff";
  return "#9baaff";
}

function formatCommitDate(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

function renderBezier(x1: number, y1: number, x2: number, y2: number) {
  if (x1 === x2) return `M ${x1} ${y1} L ${x2} ${y2}`;
  const midY = (y1 + y2) / 2;
  return `M ${x1} ${y1} C ${x1} ${midY}, ${x2} ${midY}, ${x2} ${y2}`;
}

export function RepositoryActivityPanel({
  directory,
  homeDir,
}: {
  directory: string | null;
  homeDir: string;
}) {
  const [activity, setActivity] = useState<RepositoryActivity | null>(null);
  const [loading, setLoading] = useState(false);
  const [collapsed, setCollapsed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    if (!directory) {
      setActivity(null);
      return;
    }
    setLoading(true);
    repositoryActivity(directory)
      .then((data) => !cancelled && setActivity(data))
      .catch(() => !cancelled && setActivity(null))
      .finally(() => !cancelled && setLoading(false));
    return () => { cancelled = true; };
  }, [directory]);

  const days = useMemo(() => graphDays(activity), [activity]);
  const graphHistory = useMemo(() => activity ? buildGraph(activity.history) : [], [activity]);

  return (
    <aside
      className={`relative flex h-full shrink-0 flex-col border-l border-line bg-canvas transition-[width] duration-200 ${
        collapsed ? "w-10" : "w-[360px]"
      }`}
    >
      <button
        type="button"
        onClick={() => setCollapsed((value) => !value)}
        className="absolute left-0 top-3 z-20 flex size-6 -translate-x-1/2 items-center justify-center rounded-full border border-line bg-canvas text-fg-subtle shadow-sm transition-colors hover:bg-canvas-subtle hover:text-fg"
        title={collapsed ? "Expand" : "Collapse"}
      >
        <ChevronRight size={13} className={`transition-transform duration-200 ${collapsed ? "rotate-180" : ""}`} />
      </button>

      {!collapsed && (
        <>
          <div className="px-3 py-3">
            <p className="text-[12px] font-medium text-fg">Repository history</p>
          </div>

          {!directory ? (
            <EmptyState title="Attach a project folder" detail="Pick a folder in the workflow sidebar to inspect its commit history." />
          ) : loading ? (
            <div className="flex flex-1 items-center justify-center">
              <div className="size-5 animate-spin rounded-full border-2 border-line border-t-accent" />
            </div>
          ) : !activity?.isRepository ? (
            <EmptyState title="No Git repository here" detail={`${prettyPath(directory, homeDir)} is not a Git checkout.`} />
          ) : (
            <div className="animate-in-soft min-h-0 flex-1 overflow-y-auto px-3 py-3">
              <div className="mb-3 flex items-start gap-2">
                <span className="flex size-7 shrink-0 items-center justify-center rounded-[7px] bg-accent/14 text-accent">
                  <Sparkles size={13} />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[12px] font-medium text-fg">
                    {activity.isGithub ? "GitHub remote" : "Local Git repository"}
                  </p>
                  <p className="mt-0.5 truncate text-[10.5px] text-fg-subtle">
                    {activity.remote ?? prettyPath(directory, homeDir)}
                  </p>
                </div>
              </div>

              <div className="mb-3 grid grid-cols-[1fr_auto] gap-2 rounded-[7px] border border-line bg-canvas px-2.5 py-2">
                <div className="min-w-0">
                  <p className="truncate text-[10px] text-fg-subtle">Current branch</p>
                  <p className="mt-0.5 flex items-center gap-1 truncate text-[12px] font-medium text-fg">
                    <GitBranch size={10} />
                    {activity.branch || "detached"}
                  </p>
                </div>
                <div className="text-right">
                  <p className="text-[10px] text-fg-subtle">Last year</p>
                  <p className="mt-0.5 text-[12px] font-medium text-fg">
                    {activity.commits.toLocaleString()} commits
                  </p>
                </div>
              </div>

              {/* OVERFLOW FIX: overflow-x-auto keeps the squares confined */}
              <div className="mb-4 overflow-x-auto rounded-[7px] border border-line bg-canvas p-2">
                <div className="grid grid-flow-col grid-rows-7 gap-[2px] w-max">
                  {days.map((day, index) => (
                    <span
                      key={day.date}
                      title={`${day.date}: ${day.count} commit${day.count === 1 ? "" : "s"}`}
                      className="repo-activity-cell size-[10px] rounded-[2px]"
                      style={{
                        backgroundColor: cellColor(day.count),
                        animationDelay: `${Math.min(index, 90) * 4}ms`,
                      }}
                    />
                  ))}
                </div>
              </div>

              {graphHistory.length === 0 ? (
                <EmptyInline title="No commits yet" detail="This repository has no readable commit history." />
              ) : (
                <div className="relative pl-1">
                  {graphHistory.map((commit, index) => (
                    <CommitRow key={commit.hash} commit={commit} index={index} />
                  ))}
                </div>
              )}
            </div>
          )}
        </>
      )}
    </aside>
  );
}

function CommitRow({ commit, index }: { commit: GraphCommit; index: number }) {
  const width = Math.max(1, commit.numColumns) * GRAPH_WIDTH_PER_COL + 8;

  return (
    <article
      className="repo-history-item relative flex gap-2"
      style={{ height: `${ROW_HEIGHT}px`, animationDelay: `${Math.min(index, 24) * 22}ms` }}
    >
      <div className="relative shrink-0" style={{ width: `${width}px`, height: '100%' }}>
        <svg className="absolute left-0 top-0 h-full w-full pointer-events-none">
          {commit.incoming.map((p, i) => {
            const x1 = 8 + p.fromColumn * GRAPH_WIDTH_PER_COL;
            const x2 = 8 + p.toColumn * GRAPH_WIDTH_PER_COL;
            return (
              <path key={`in-${i}`} d={renderBezier(x1, 0, x2, DOT_CY)} fill="none" stroke={p.color} strokeWidth="1.5" />
            );
          })}
          
          {commit.outgoing.map((p, i) => {
            const x1 = 8 + p.fromColumn * GRAPH_WIDTH_PER_COL;
            const x2 = 8 + p.toColumn * GRAPH_WIDTH_PER_COL;
            return (
              <path key={`out-${i}`} d={renderBezier(x1, DOT_CY, x2, ROW_HEIGHT)} fill="none" stroke={p.color} strokeWidth="1.5" />
            );
          })}

          <circle cx={8 + commit.column * GRAPH_WIDTH_PER_COL} cy={DOT_CY} r="3.5" fill="var(--color-canvas)" stroke={commit.color} strokeWidth="1.5" />
        </svg>
      </div>

      <div className="min-w-0 flex-1 pt-[6px]">
        <div className="flex flex-wrap items-center gap-1.5">
          <p className="truncate text-[11px] font-medium text-fg">
            {commit.subject}
          </p>
          {commit.refs.map(ref => {
            const cleanRef = ref.replace("HEAD -> ", "");
            return (
              <span key={ref} className="px-1 py-[1px] text-[8.5px] font-medium text-fg-muted bg-line/50 border border-line rounded-[3px] truncate max-w-[120px]">
                {cleanRef}
              </span>
            );
          })}
        </div>

        <p className="mt-0.5 font-mono text-[9px] text-fg-subtle">
          {commit.shortHash}
        </p>

        <p className="mt-1 text-[9.5px] text-fg-subtle">
          {commit.author} · {formatCommitDate(commit.authoredAt)} · {commit.relativeTime}
        </p>

        <p className="mt-1 text-[9.5px] text-fg-subtle">
          {commit.filesChanged} file{commit.filesChanged === 1 ? "" : "s"}
          <span className="ml-1 text-green-400">+{commit.insertions}</span>
          <span className="ml-1 text-red-400">-{commit.deletions}</span>
        </p>
      </div>
    </article>
  );
}

function EmptyInline({ title, detail }: { title: string; detail: string }) {
  return (
    <div className="rounded-[7px] border border-line bg-canvas px-3 py-3">
      <p className="text-[11px] font-medium text-fg">{title}</p>
      <p className="mt-1 text-[10px] leading-4 text-fg-subtle">{detail}</p>
    </div>
  );
}

function EmptyState({ title, detail }: { title: string; detail: string }) {
  return (
    <div className="flex flex-1 items-center justify-center px-6">
      <div className="max-w-[240px] text-center">
        <p className="text-[12px] font-medium text-fg">{title}</p>
        <p className="mt-1 text-[10.5px] leading-4 text-fg-subtle">{detail}</p>
      </div>
    </div>
  );
}