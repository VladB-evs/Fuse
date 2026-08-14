# Fuse

A visual command workflow builder for macOS. Draw your terminal commands as
blocks on an infinite canvas, wire them together, and run the whole chain with
one button.

Built with Tauri 2 + Rust + React + TypeScript. No Electron.

```
git add .          ✓
     ↓
git commit -m "…"  ✓
     ↓
git push           ● running
```

## Running it

```bash
npm install
npm run tauri dev
```

Build a distributable `.app`:

```bash
npm run tauri build
```

## Using it

| Action | How |
| --- | --- |
| Add any kind of block | `Tab`, or **+ Add block** — search, arrows, enter |
| Add a command block fast | `A`, or double-click the canvas |
| Edit a command | Click into the block and type |
| Rename a block | Double-click its title |
| Connect blocks | Drag from anywhere along a block's edge, drop anywhere on another block |
| Add a block already wired up | Drag a wire out and drop it on empty canvas |
| Disconnect | Hover the wire and click **✕**, or drag either end off |
| Group blocks by folder | `F`, or **Frame** — see below |
| Take a block out of its frame | Hover the block, click ⏏ |
| Start from a git preset | `⌘K` → *Insert a git workflow…* |
| Run everything | `⌘↵` or **Run all** |
| Run one frame | **▶ Run** in its header |
| Run one block | Hover the block, click ▶ |
| Rename the workflow | `⌘K` → *Rename workflow…* |
| Stop | `⌘.` or **Stop** |
| See output | Click a block |

Adding a block while exactly one is selected auto-wires it below — so
`A → type → A → type → ⌘↵` builds and runs a chain without touching the mouse.

### Adding blocks

`Tab` opens the block picker wherever the pointer is. Every kind is on one
screen, grouped and described, so "what can this thing do" is answerable by
looking rather than by remembering. Type to filter, arrows to move, `↵` to
drop it on the canvas.

The other way in is the wire itself: **drag a wire off a block and let go over
empty canvas**, and the picker opens at the loose end — whatever you choose is
created *and connected* in one gesture. Dragging a wire is already the way you
say "something goes here", so it may as well be the way you make it.

`⌘K` is for acting on the workflow — run, save, open, rename, presets — not for
building it.

### Disconnecting

Three ways, because wires are as much a part of the graph as blocks:

- **Hover a wire and click ✕.** It appears on the wire itself, at the midpoint.
- **Drag either end off the block** and let go over empty canvas. Dropping it
  on a different block moves the wire there instead.
- **Select blocks and press `⇧⌫`** to cut every wire around them, leaving the
  blocks where they are. Plain `⌫` still deletes the selection.

### Frames

A frame is a rectangle with a folder and a Run button attached. Blocks inside
it run in that folder, so one workflow can drive several repositories.

Drop a frame with `F`, then put blocks in it by **dragging them in** or by
double-clicking inside it. The frame lights up while a block is hovering over
it, and the block's footer then names the frame it joined. Click **Set
folder…** in the header tab to choose the directory.

**Frames size themselves.** There are no resize handles: the rectangle is the
bounding box of the blocks inside it, recomputed as they move, grow, join and
leave. Drag a block towards the edge and the frame **stretches to follow it** —
a box that sizes itself to its contents has no fixed edge to be pushed out of,
so dragging is never how a block leaves.

**Rename by clicking the name** in the header tab. New frames come up as
"Frame 1", "Frame 2"; picking a folder for one that still has its default name
renames it after the folder, so you get "api" and "web" rather than numbers.

**Drag anywhere on a frame** to move it, and its blocks travel with it. Blocks
sit on a layer above the frame, so a click that lands on a block goes to the
block — selecting a frame never puts it in front of its own contents.

Membership is an assignment, not a location, and joining and leaving are
deliberately not mirror images:

- **Joining** — a block joins the frame its centre lands in. You have to mean
  it: overlapping a corner is not enough.
- **Staying** — once in, a block stays in. Drag it anywhere you like, however
  far, and it is still a member; the frame just stretches after it.
- **Leaving** — hover the block and press **⏏** in its header. It comes out of
  the frame and parks just past the edge, and the frame closes up behind it.

Nothing else moves a block between frames, so a drag can never lose one by
accident — and a frame moved across the canvas never adopts what it passes
over.

### What Run runs

| Button | Runs |
| --- | --- |
| **▶ Run** on a frame's header | Exactly the blocks that frame holds, and the wires between them |
| **▶ Run all** in the top bar | Everything, including blocks outside any frame |
| **▶** on a block (on hover) | That one block, on its own |

The top-bar button disappears once every block belongs to a frame — at that
point the frames say what will run, and a second button could only be vaguer.
It reads **Run** when there are no frames at all and **Run all** otherwise.

Folder precedence: a block's own folder, then its frame's, then your home
directory.

### What a block can hold

A block holds a **shell line, not a single program**. It is handed to your
login shell (`$SHELL -l -c`), so `&&`, `||`, `|`, `;`, subshells, redirection,
globs and `$VARS` all mean what they mean in your terminal — and your `PATH`,
nvm, rbenv and Homebrew are already set up because the profile is sourced.

```
git add -A && git commit -m {{message}} && git push
```

Newlines work too: a block can hold a short script, one command per line. The
block's exit status is the shell's, so a chain that short-circuits on a failed
`&&` fails the block, and everything wired downstream is skipped.

Where you draw the line between one block and several is a judgement call.
`&&` inside one block is right when the steps are one thought and you never
want to run the second alone; separate wired blocks are right when you want to
see each step's status, re-run one on its own, or read its output apart from
the rest.

### The block types

| Block | What it does |
| --- | --- |
| **Command** | One shell line — pipes, `&&`, your real `PATH` |
| **Script** | A multi-line program run by `bash`, `python3`, `node`, `ruby` or whatever you name |
| **HTTP request** | Method, URL, headers, body; the response is available to later steps |
| **If** | Branches on a command's exit status: 0 takes the yes path, anything else takes no |
| **Choose** | Pauses and asks which connected path to take |
| **Confirm** | Pauses, shows the output so far, waits for yes or no |
| **Wait** | A delay, or polls a command until it succeeds |
| **Ask** | Asks for a value mid-run |
| **Capture** | Runs a command and keeps what it printed, under a name |
| **Frame** | Groups blocks under one folder |

Everything except Frame is a step in the graph: it can sit in a frame, inherit
its folder, be wired up, and be run on its own with the ▶ on its header.

### Values

Four blocks put a value into a run: **Ask** (typed by you), **Capture** (a
command's output), and **HTTP** (a response body), plus the `{{placeholder}}`s
collected before the run starts. They all land in the same place, so a later
step reads any of them the same way:

```
{{VERSION}}     in a command, a test, a URL, a body, a script
$VERSION        in the shell, because they are exported too
```

Escaping follows where the value lands, not where it came from: text going to
a shell is quoted so spaces and apostrophes can't break out, while a script
body, a URL or a JSON payload gets the value verbatim — quoting those would put
stray apostrophes into your Python.

### Real work, without a command block

**Capture** is the one that changes what a workflow can be. `git rev-parse
--short HEAD` kept as `SHA`, then an **HTTP** POST whose body is
`{"ref": "{{SHA}}"}`, then an **If** on `test -d dist`, and the whole thing
never needed a person to retype anything.

**Wait** with a poll command — `curl -fsS http://localhost:3000/health` — is how
you start a server in one block and depend on it in the next: it retries on an
interval and gives up after a timeout, so the steps after it can assume the
thing is actually up.

**If** is the only block with two ways out, and they are drawn on the card:
wires leaving the **bottom** are the yes path, the one leaving the **right** is
no. A "no" wire is dashed on the canvas. Whatever hangs off the branch not
taken is skipped, exactly as with **Choose**.

### Steps that stop and ask you

Not every decision can be made before a run starts. Three block kinds hand
control back to you part-way through — the run genuinely stops at them, and
nothing downstream moves until you answer.

| Step | What it does |
| --- | --- |
| **Confirm** | Shows what the steps before it printed, and waits for yes or no. No stops the whole run. |
| **Choose** | Asks which of the connected paths to take. The paths you don't pick are skipped. |
| **Ask** | Asks for a value the later steps can use. |

Add them from **Ask me** in the top bar, or the command palette. They sit in
frames, run in a frame's folder and wire up exactly like command blocks.

**Confirm** is the "look at this before it goes further" step: a build, then a
confirm, then the deploy. The dialog shows the output of whatever fed it, in
colour, so the decision is made against the actual text rather than a memory of
it. Choosing to stop is a deliberate outcome, not a failure — the run ends as
*stopped*, and the steps that never ran say so.

**Choose** turns the wires leaving it into options. Wire it to two steps and it
offers two paths; the card lists them as you connect them, so what the canvas
shows and what you'll be offered can't disagree. Tick *Allow more than one
path* to take several at once. Every branch not taken is skipped, and so is
everything hanging off it.

**Ask** names a value — say `VERSION` — and later steps use it as `{{VERSION}}`
in their command or `$VERSION` in the shell. Unlike a `{{placeholder}}`, which
Fuse collects before the run starts, this one is asked at the moment it is
reached, so the answer can depend on what the earlier steps printed. Values are
quoted the same way placeholders are, so spaces and apostrophes are safe. Tick
*secret* to mask the field and keep the value out of the log.

While a run is parked, the waiting step glows on the canvas and `⌘.` still
stops the run outright.

### Output, in colour

Commands run under `TERM=xterm-256color` with the usual force-colour flags set,
so tools that colour their output in a terminal colour it here too — 16-colour,
256-colour and truecolor escapes, bold, dim and highlights all render.

Output that arrives with no colour of its own still gets some: lines are read
for the shapes tools actually use (`error:`, `npm ERR!`, `warning:`, `✓`) and
tinted accordingly, with stderr warmer than stdout. The command itself is
echoed above its output, so the panel reads as a transcript rather than a
stream of text with no question attached.

### Git presets

`⌘K` → **Insert a git workflow…** drops a ready-made frame onto the canvas:

| Preset | |
| --- | --- |
| **Commit & push** | status → stage all → commit `{{message}}` → push |
| **Sync** | fetch --all --prune → pull --rebase --autostash → recent log |
| **New branch** | fetch → switch -c `{{branch}}` → push -u origin |
| **Review** | status → diff --stat → staged diff --stat → recent log |

They land as ordinary frames and ordinary blocks, wired in order and yours to
edit — there is nothing special about them afterwards. Set the frame's folder
to point one at a repository. Anything you would have to decide is a
placeholder rather than a wrong default, and every command is one that runs
without a terminal (`--no-pager` and friends are load-bearing here).

### Commands that need input

Blocks run with **no terminal and no stdin**. A command that tries to prompt
gets EOF and fails straight away rather than hanging the run — `sudo`, a
`git commit` that would open an editor, and `git` asking for credentials all
stop instead of blocking. When Fuse spots one of those failures it appends a
line to the output saying what happened and what to do about it.

For values you want to decide at run time, use a placeholder:

```
git commit -m {{message}}
```

Fuse asks for `message` just before the run, shows you the exact command line
it will hand to the shell, and substitutes it in. Your block keeps the
placeholder — only the run gets the filled-in copy, and the last value you
used is prefilled next time.

Substitution is shell-aware. An unquoted placeholder is quoted for you, so a
message containing spaces, apostrophes or a stray `;` stays one argument and
cannot run anything of its own. If you quoted it yourself — `-m "{{message}}"`
— the value is escaped to match those quotes instead. The preview in the
dialog shows the result either way.

Genuinely interactive programs (a REPL, `ssh` to a prompt, `top`) are out of
scope: there is nowhere to type. Reach for the non-interactive flag those
tools almost always have.

### Keyboard

| Key | |
| --- | --- |
| `⌘K` | Command palette |
| `⌘S` | Save (there is also a 1.2s autosave) |
| `⌘Z` / `⌘⇧Z` | Undo / redo |
| `⌘↵` | Run workflow |
| `⌘.` | Stop |
| `⌘N` / `⌘O` | New / open workflow |
| `⌘/` | Toggle output panel |
| `⌘0` / `⌘+` / `⌘−` | Fit / zoom |
| `⌘D` | Duplicate selection |
| `Tab` | Add a block (the picker) |
| `A` / `F` | Add a command block / a frame |
| `⌫` | Delete selection |
| `⇧⌫` | Disconnect selection |
| `Space`-drag | Pan |

Shortcuts that would collide with text editing are suppressed while a command
input has focus.

## How execution works

Commands run through your real login shell (`$SHELL -l -c`), so `PATH`, nvm,
rbenv and Homebrew behave exactly as they do in Terminal.

The engine resolves the graph into a DAG and walks it in topological order,
breaking ties by canvas position (top-to-bottom) so runs are reproducible. A
block runs only once every upstream block has passed. **A failure stops
everything downstream** unless that block opted into `continueOnError`; blocked
blocks are reported as skipped rather than silently dropped. A branch not taken
at a **Choose** step is skipped the same way.

The walk is a single sequential pass, which is what makes an interactive step
possible at all: parking on a question parks the whole run. The engine asks
through a `Prompter` trait — the app implements it with a dialog, tests with a
script, and a headless run with "continue, every path, the default" — so the
engine still knows nothing about the UI. Stopping a run releases a step that is
waiting on an answer, so a question can never strand a run.

Stopping kills the whole process group, not just the shell — so stopping
`npm run dev` doesn't orphan node.

Branches and diamonds already work; the scheduler was never written around
linear chains.

## Architecture

```
src/
  bridge/      the only code that calls Tauri
  store/       zustand — workflow document, runtime state, UI state
  canvas/      React Flow canvas, node + edge renderers
  components/  toolbar, output panel, command palette
  lib/actions  UI intent → store + bridge (one path per action)

src-tauri/src/
  commands.rs  Tauri bridge — thin, no logic
  storage.rs   persistence behind a trait (SQLite-ready)
  engine/      DAG scheduling + process supervision
  model.rs     the shared document model
```

Two boundaries are enforced deliberately:

- **The engine knows nothing about Tauri or React.** It reports progress
  through an `EventSink` trait; the app layer implements it by forwarding to the
  webview. That's why the scheduler is unit-testable — see `engine/mod.rs`.
- **The frontend never spawns processes.** It sends a workflow document to Rust
  and listens for events.

Engine events are batched one frame at a time before touching React, so a
command emitting thousands of lines a second can't stutter the canvas.

### Adding a node type

Ten kinds exist today. To add another:

1. Add a variant to `NodePayload` in `src-tauri/src/model.rs`, and the matching
   data type in `src/types/workflow.ts`.
2. Add an executor to `src-tauri/src/engine/steps.rs` and an arm to the
   dispatcher in `engine/mod.rs`.
3. Add a renderer built on `NodeShell`, register it in
   `src/canvas/nodes/index.ts`, and give it a default in `emptyBlock()`.
4. Add a row to `src/lib/catalog.ts`.

That last one is what puts it in the picker, the command palette and the output
panel at once — one description, everywhere it is named. Nothing in the graph
resolver, storage layer or bridge needs to change: the resolver asks
`is_runnable()`, and everything but a frame says yes.

## Storage

Workflows are one human-readable JSON file each, under
`~/Library/Application Support/com.fuse.app/workflows/`:

```json
{
  "id": "…",
  "name": "Deploy",
  "workingDir": "~/dev/app",
  "nodes": [
    {
      "id": "…",
      "position": { "x": 240, "y": 160 },
      "type": "command",
      "data": { "label": "Terminal", "command": "git add .", "frameId": null, "env": {} }
    }
  ],
  "edges": [{ "id": "…", "source": "…", "target": "…" }]
}
```

Writes go through a temp file and a rename, so a crash mid-save can't truncate a
good workflow. All persistence sits behind the `WorkflowStore` trait — moving to
SQLite means adding one implementor and changing one line in `lib.rs`.

## Tests

```bash
cd src-tauri && cargo test
```

55 tests covering DAG resolution (chains, diamonds, cycles, duplicate edges,
frames excluded from the graph), frame directory inheritance, failure gating,
cancellation of a live process, shell env/exit codes, the non-interactive
environment, stdin never blocking a run, and storage round-trips including
path-traversal rejection.

The steps that do their own work — script, condition, capture, wait, http —
run through the same `process::run` as a command block, so cancellation,
process-group cleanup and line streaming behave identically; they are not
separately covered by tests yet.

The interactive steps are covered through a scripted `Prompter`:
approving and denying a checkpoint, a choice running only the branch it was
given (and skipping what hangs off the others), taking several branches at
once, a value asked for mid-run reaching a later command correctly quoted, and
stopping a run that is parked on a question.
