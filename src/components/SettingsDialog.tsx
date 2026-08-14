import { useEffect, useState } from "react";
import { Settings, X, Download, RefreshCw, CheckCircle2, AlertCircle, Folder } from "lucide-react";
import { useUIStore } from "@/store/uiStore";
import { Button } from "./ui/Button";
import { check, type Update } from "@tauri-apps/plugin-updater";
import { relaunch } from "@tauri-apps/plugin-process";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { getSettings, setWorkflowDirectory } from "@/bridge/commands";

export function SettingsDialog() {
  const open = useUIStore((s) => s.settingsOpen);
  const setOpen = useUIStore((s) => s.setSettingsOpen);

  const [checking, setChecking] = useState(false);
  const [update, setUpdate] = useState<Update | null>(null);
  const [downloading, setDownloading] = useState(false);
  const [progress, setProgress] = useState<{ downloaded: number; total: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [installed, setInstalled] = useState(false);

  const [customDir, setCustomDir] = useState<string | null>(null);
  const [pickingDir, setPickingDir] = useState(false);

  useEffect(() => {
    if (open) {
      getSettings().then(s => setCustomDir(s.customWorkflowDir || "Default"));
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

  if (!open) return null;

  async function handleChangeDirectory() {
    setPickingDir(true);
    try {
      const selected = await openDialog({
        directory: true,
        multiple: false,
        title: "Select Workflow Storage Location",
      });
      if (selected && typeof selected === "string") {
        await setWorkflowDirectory(selected);
        setCustomDir(selected);
        useUIStore.getState().notify("Storage location updated. Reloading...");
        setTimeout(() => window.location.reload(), 1000);
      }
    } catch (e) {
      console.error("Failed to set directory:", e);
    } finally {
      setPickingDir(false);
    }
  }

  async function checkForUpdate() {
    setChecking(true);
    setError(null);
    try {
      const updateResult = await check();
      setUpdate(updateResult);
      if (!updateResult) {
        // We could show a toast saying "You're on the latest version!"
      }
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

      <div className="animate-in-soft relative flex w-full max-w-[500px] flex-col rounded-xl border border-line-strong bg-base shadow-[0_18px_50px_-12px_rgba(0,0,0,0.8)] overflow-hidden">
        <div className="flex shrink-0 items-center justify-between border-b border-line px-5 py-4">
          <h2 className="flex items-center gap-2 text-lg font-semibold tracking-tight text-fg">
            <Settings size={20} className="text-fg-muted" />
            Settings
          </h2>
          <button
            onClick={() => setOpen(false)}
            disabled={downloading}
            className="flex items-center justify-center rounded-[6px] p-1.5 text-fg-subtle transition hover:bg-hover hover:text-fg disabled:opacity-50"
          >
            <X size={16} />
          </button>
        </div>
        
        <div className="flex-1 p-5">
          <div className="mb-4">
            <h3 className="text-[13px] font-semibold text-fg mb-1">Updates</h3>
            <p className="text-[12px] text-fg-subtle mb-4">
              Keep Fuse up to date with the latest features and bug fixes.
            </p>
            
            <div className="rounded-lg border border-line bg-elevated p-4">
              {error ? (
                <div className="flex items-start gap-3 text-danger mb-4">
                  <AlertCircle size={16} className="mt-0.5 shrink-0" />
                  <div className="text-[12px]">{error}</div>
                </div>
              ) : installed ? (
                <div className="flex flex-col items-center justify-center py-4 text-center">
                  <CheckCircle2 size={32} className="text-success mb-3" />
                  <h4 className="text-[14px] font-medium text-fg mb-1">Update Ready!</h4>
                  <p className="text-[12px] text-fg-subtle mb-4">
                    The new version has been installed. Restart Fuse to apply it.
                  </p>
                  <Button variant="primary" onClick={() => relaunch()}>
                    Restart Now
                  </Button>
                </div>
              ) : update ? (
                <div className="flex flex-col">
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-[13px] font-medium text-fg">
                      Version {update.version} is available!
                    </span>
                    <span className="text-[11px] text-fg-subtle">
                      {update.date?.split(" ")[0]}
                    </span>
                  </div>
                  {update.body && (
                    <div className="mb-4 text-[12px] text-fg-muted whitespace-pre-wrap">
                      {update.body}
                    </div>
                  )}
                  
                  {downloading ? (
                    <div className="flex flex-col gap-2 mt-2">
                      <div className="h-1.5 w-full overflow-hidden rounded-full bg-line">
                        <div 
                          className="h-full bg-fg transition-all duration-200" 
                          style={{ 
                            width: progress?.total 
                              ? `${(progress.downloaded / progress.total) * 100}%` 
                              : "0%" 
                          }}
                        />
                      </div>
                      <div className="flex justify-between text-[10px] text-fg-subtle tabular-nums">
                        <span>Downloading update...</span>
                        {progress?.total ? (
                          <span>
                            {Math.round(progress.downloaded / 1024 / 1024)}MB / {Math.round(progress.total / 1024 / 1024)}MB
                          </span>
                        ) : null}
                      </div>
                    </div>
                  ) : (
                    <Button variant="primary" onClick={downloadAndInstall} className="w-full justify-center">
                      <Download size={14} className="mr-2" />
                      Download and Install
                    </Button>
                  )}
                </div>
              ) : (
                <div className="flex items-center justify-between">
                  <span className="text-[13px] text-fg-muted">
                    {checking ? "Checking for updates..." : "You are up to date."}
                  </span>
                  <Button variant="subtle" onClick={checkForUpdate} disabled={checking}>
                    <RefreshCw size={14} className={checking ? "animate-spin mr-2" : "mr-2"} />
                    {checking ? "Checking" : "Check for Updates"}
                  </Button>
                </div>
              )}
            </div>

            <div className="flex flex-col gap-4 pt-4 border-t border-line">
              <div>
                <h3 className="text-[13px] font-medium text-fg mb-1">Storage Location</h3>
                <p className="text-[12px] text-fg-subtle mb-3 leading-relaxed">
                  Choose where your workflows are saved. If you change this, your existing workflows will be copied to the new folder.
                </p>
                <div className="flex items-center gap-2">
                  <div className="flex-1 min-w-0 px-3 py-2 bg-base border border-line rounded-[6px] text-[12px] font-mono text-fg truncate">
                    {customDir || "Loading..."}
                  </div>
                  <Button variant="subtle" onClick={handleChangeDirectory} disabled={pickingDir} className="shrink-0">
                    <Folder size={14} className="mr-2" />
                    {pickingDir ? "Changing..." : "Change"}
                  </Button>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
