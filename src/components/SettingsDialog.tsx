import { useEffect, useState } from "react";
import { Settings, X, Download, RefreshCw, CheckCircle2, AlertCircle, FolderOpen } from "lucide-react";
import { useUIStore } from "@/store/uiStore";
import { Button } from "./ui/Button";
import { check, type Update } from "@tauri-apps/plugin-updater";
import { relaunch } from "@tauri-apps/plugin-process";
import { getSettings, openDirectory } from "@/bridge/commands";
import { importBlocks, importWorkflow } from "@/lib/actions";

export function SettingsDialog() {
  const open = useUIStore((s) => s.settingsOpen);
  const setOpen = useUIStore((s) => s.setSettingsOpen);

  const [checking, setChecking] = useState(false);
  const [update, setUpdate] = useState<Update | null>(null);
  const [downloading, setDownloading] = useState(false);
  const [progress, setProgress] = useState<{ downloaded: number; total: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [installed, setInstalled] = useState(false);

  const [workflowDir, setWorkflowDir] = useState<string>("");

  useEffect(() => {
    if (open) {
      getSettings().then((s) => {
        setWorkflowDir(s.workflowDir);
      });
    }
  }, [open]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape" && open && !downloading) {
        setOpen(false);
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [open, setOpen, downloading]);

  const [activeTab, setActiveTab] = useState<"general" | "updates">("general");

  if (!open) return null;

  async function handleOpenDirectory() {
    if (workflowDir) {
      try {
        await openDirectory(workflowDir);
      } catch (e) {
        console.error("Failed to open directory:", e);
      }
    }
  }

  async function checkForUpdate() {
    setChecking(true);
    setError(null);
    try {
      const updateResult = await check();
      setUpdate(updateResult);
    } catch (err) {
      setError(String(err));
    } finally {
      setChecking(false);
    }
  }

  async function downloadAndInstall() {
    if (!update) return;
    setDownloading(true);
    setError(null);
    
    let contentLength = 0;
    let downloaded = 0;

    try {
      await update.downloadAndInstall((event) => {
        switch (event.event) {
          case "Started":
            contentLength = event.data.contentLength ?? 0;
            setProgress({ downloaded: 0, total: contentLength });
            break;
          case "Progress":
            downloaded += event.data.chunkLength;
            setProgress({ downloaded, total: contentLength });
            break;
          case "Finished":
            setInstalled(true);
            break;
        }
      });
      setInstalled(true);
    } catch (err) {
      setError(String(err));
      setDownloading(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 sm:p-6"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget && !downloading) setOpen(false);
      }}
    >
      <div className="absolute inset-0 bg-canvas/55 backdrop-blur-[2px]" aria-hidden />

      <div className="animate-in-soft relative flex w-full max-w-[650px] min-h-[420px] flex-col rounded-xl border border-line-strong bg-base shadow-[0_18px_50px_-12px_rgba(0,0,0,0.8)] overflow-hidden">
        <div className="flex shrink-0 items-center justify-between border-b border-line px-5 py-4">
          <h2 className="flex items-center gap-2 text-lg font-semibold tracking-tight text-fg">
            <Settings size={18} className="text-fg-muted" />
            Settings
          </h2>
          <button
            onClick={() => setOpen(false)}
            disabled={downloading}
            className="flex items-center justify-center rounded-[6px] p-1.5 text-fg-subtle transition hover:bg-hover hover:text-fg disabled:opacity-50 cursor-pointer"
          >
            <X size={16} />
          </button>
        </div>
        
        <div className="flex flex-1 overflow-hidden">
          {/* Sidebar */}
          <div className="w-[180px] shrink-0 border-r border-line bg-canvas/30 p-2.5 flex flex-col gap-1">
            <button
              onClick={() => setActiveTab("general")}
              className={`flex w-full items-center gap-2.5 rounded-md px-3 py-2 text-sm font-medium transition cursor-pointer ${
                activeTab === "general" ? "bg-accent text-white" : "text-fg-subtle hover:bg-hover hover:text-fg"
              }`}
            >
              General
            </button>
            <button
              onClick={() => setActiveTab("updates")}
              className={`flex w-full items-center gap-2.5 rounded-md px-3 py-2 text-sm font-medium transition cursor-pointer ${
                activeTab === "updates" ? "bg-accent text-white" : "text-fg-subtle hover:bg-hover hover:text-fg"
              }`}
            >
              Updates
            </button>
          </div>
          
          {/* Content */}
          <div className="flex-1 p-6 overflow-y-auto bg-base">
            {activeTab === "general" && (
              <div className="flex flex-col gap-8">
                <div>
                  <h3 className="text-sm font-semibold text-fg mb-1">Storage Location</h3>
                  <p className="text-[12px] text-fg-subtle mb-4 leading-relaxed">
                    Where your workflows are saved on your computer.
                  </p>
                  <div className="flex items-center gap-2">
                    <div
                      className="flex-1 min-w-0 px-3 py-2 bg-canvas border border-line rounded-lg text-[11.5px] font-mono text-fg truncate cursor-pointer hover:border-accent/60 transition select-all"
                      title={workflowDir ? `Click to open ${workflowDir}` : undefined}
                      onClick={handleOpenDirectory}
                    >
                      {workflowDir || "Loading..."}
                    </div>
                    <Button
                      variant="subtle"
                      onClick={handleOpenDirectory}
                      disabled={!workflowDir}
                      title="Open in Finder"
                      className="shrink-0"
                    >
                      <FolderOpen size={14} className="mr-1.5" />
                      Open Finder
                    </Button>
                  </div>
                </div>

                <div className="h-px bg-line" />

                <div>
                  <h3 className="text-sm font-semibold text-fg mb-1">Import</h3>
                  <p className="text-[12px] text-fg-subtle mb-4 leading-relaxed">
                    Import full workflows or merge specific blocks into the current canvas.
                  </p>
                  <div className="flex flex-col gap-2">
                    <Button
                      variant="subtle"
                      onClick={() => {
                        importWorkflow();
                        setOpen(false);
                      }}
                      className="justify-start w-fit px-4"
                    >
                      <FolderOpen size={14} className="mr-2 text-fg-subtle" />
                      Import Workflow from File...
                    </Button>
                    <Button
                      variant="subtle"
                      onClick={() => {
                        importBlocks();
                        setOpen(false);
                      }}
                      className="justify-start w-fit px-4"
                    >
                      <FolderOpen size={14} className="mr-2 text-fg-subtle" />
                      Merge Blocks from File...
                    </Button>
                  </div>
                </div>
              </div>
            )}

            {activeTab === "updates" && (
              <div>
                <h3 className="text-sm font-semibold text-fg mb-1">Updates</h3>
                <p className="text-[12px] text-fg-subtle mb-5">
                  Keep Fuse up to date with the latest features and bug fixes.
                </p>
                
                <div className="rounded-xl border border-line bg-canvas/50 p-5">
                  {error ? (
                    <div className="flex items-start gap-3 text-danger mb-4">
                      <AlertCircle size={16} className="mt-0.5 shrink-0" />
                      <div className="text-[12px]">{error}</div>
                    </div>
                  ) : installed ? (
                    <div className="flex flex-col items-center justify-center py-6 text-center animate-in-soft">
                      <CheckCircle2 size={36} className="text-success mb-3" />
                      <h4 className="text-[15px] font-medium text-fg mb-1">Update Ready!</h4>
                      <p className="text-[12px] text-fg-subtle mb-5">
                        The new version has been installed. Restart Fuse to apply it.
                      </p>
                      <Button variant="primary" onClick={() => relaunch()} className="px-6">
                        Restart Now
                      </Button>
                    </div>
                  ) : update ? (
                    <div className="flex flex-col animate-in-soft">
                      <div className="flex items-center justify-between mb-2">
                        <span className="text-[14px] font-medium text-fg">
                          Version {update.version} is available!
                        </span>
                        <span className="text-[11px] text-fg-subtle bg-line/50 px-2 py-0.5 rounded-full">
                          {update.date?.split(" ")[0]}
                        </span>
                      </div>
                      {update.body && (
                        <div className="mb-5 text-[12px] text-fg-muted whitespace-pre-wrap bg-base border border-line rounded-lg p-3 max-h-[120px] overflow-y-auto">
                          {update.body}
                        </div>
                      )}
                      
                      {downloading ? (
                        <div className="flex flex-col gap-2 mt-2">
                          <div className="h-2 w-full overflow-hidden rounded-full bg-line/80">
                            <div 
                              className="h-full bg-accent transition-all duration-200" 
                              style={{ 
                                width: progress?.total 
                                  ? `${(progress.downloaded / progress.total) * 100}%` 
                                  : "0%" 
                              }}
                            />
                          </div>
                          <div className="flex justify-between text-[11px] text-fg-subtle tabular-nums font-medium">
                            <span>Downloading update...</span>
                            {progress?.total ? (
                              <span>
                                {Math.round(progress.downloaded / 1024 / 1024)} MB / {Math.round(progress.total / 1024 / 1024)} MB
                              </span>
                            ) : null}
                          </div>
                        </div>
                      ) : (
                        <Button variant="primary" onClick={downloadAndInstall} className="w-full justify-center mt-2 py-2">
                          <Download size={14} className="mr-2" />
                          Download and Install Update
                        </Button>
                      )}
                    </div>
                  ) : (
                    <div className="flex items-center justify-between py-2">
                      <div className="flex flex-col">
                        <span className="text-[13.5px] font-medium text-fg">
                          {checking ? "Checking for updates..." : "You are up to date."}
                        </span>
                        <span className="text-[11.5px] text-fg-subtle mt-0.5">
                          Fuse is running the latest version.
                        </span>
                      </div>
                      <Button variant="subtle" onClick={checkForUpdate} disabled={checking}>
                        <RefreshCw size={14} className={checking ? "animate-spin mr-2" : "mr-2"} />
                        {checking ? "Checking" : "Check for Updates"}
                      </Button>
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
