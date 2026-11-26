// Orrery — Full-Bleed Infinite Spatial Cosmic Desktop Environment for Herdr.
// Dispatches roles via `props()?.role || p?.role || "universe"`:
//   - "universe"  : Full-bleed pannable/zoomable cosmic desktop + physical Note cards
//   - "menubtn"   : Always-on-top bottom-left `≡` menu trigger orb (36×36 non-draggable window)
//   - "launcher"  : Always-on-top `kind: "popup"` Launcher Menu (Spaces, SSH Machines, Terminals, Agents, Apps)
//   - "ctxmenu"   : Always-on-top `kind: "popup"` Context Menus (space, machine, new-space, desktop, note, window)
//   - "winbar"    : 30px draggable titlebar (─ □ ×) for terminal windows
//   - "toolwin"   : 28px draggable titlebar (─ ×) for desktop app & Note windows
//   - "edge"      : 5px native 8-way border & corner resize strip around every floating window
//   - "resizer"   : Full-screen transparent 60fps 8-way wireframe move/resize capture overlay
//   - "fleet"     : Desktop App — Fleet Monitor (live Machines, Spaces, Agents & Sub-agents)
//   - "notes"     : Physical Scratchpad Note Editor (native markdown Editor per noteId)
//   - "topbar"    : 28px native multi-pane focus-mode top bar (window_drag: true)
//   - "pane"      : 22px stark terminal pane header in focus mode

import { View } from "gpui-kit";
import { EditorState } from "gpui-base";
import { agents, hc, machines, nextCommand, pickFolder, props, setAgentOrder, spaces } from "herdr";
import {
  clearContextPopupIfMatch,
  clearLauncherPopupIfMatch,
  clearMenuButtonIfMatch,
  clearWindowOverlayIfMatch,
  drainPendingCosmosActions,
  dropNoteInView,
  ensureMenuButtonOnTop,
  formatClockHHMM,
  getNoteById,
  getViewportDims,
  hasMenuButton,
  isFocusMode,
  loadKnownAgents,
  machineStatusInfo,
  MONO,
  openOrCreateNoteInView,
  openSpaceTerminalAsync,
  openTabTerminalAsync,
  pollGitStatus,
  pollMachinesList,
  pruneDeadState,
  pruneOpenWindows,
  readCamera,
  readCamResetSeq,
  readGitInfo,
  readMachinesList,
  readNotes,
  readOpenWins,
  readSpacePositions,
  reconnectMachine,
  removeMachine,
  resolveActiveGitTarget,
  sortAgentsByUrgency,
  spawnAgentOnMachine,
  spawnNewSpace,
  spawnTerminalInSpace,
  syncLiveOverlaysToCamera,
  tileAllOpenWindows,
  toggleLauncherPopup,
  toggleMode,
  toggleShowDesktop,
  toggleToolSurface,
  updateNoteText,
  writeCamera,
  writeNotes,
} from "./state.js";
import {
  animateCameraToWindow,
  applyCameraZoomAt,
  cancelCameraAnim,
  renderUniverse,
} from "./views/universe.js";
import { computePlanetPositions } from "./cosmos.js";
import { createCosmicDirector } from "./director.js";
import { renderMenubtn } from "./views/menubtn.js";
import { renderLauncher } from "./views/launcher.js";
import { renderCtxmenu } from "./views/ctxmenu.js";
import { renderWinbar } from "./views/winbar.js";
import { renderToolwin } from "./views/toolwin.js";
import { renderEdge } from "./views/edge.js";
import { renderResizer } from "./views/resizer.js";
import { renderFleet } from "./views/fleet.js";
import { renderNotes } from "./views/notes.js";
import { renderTopbar } from "./views/topbar.js";
import { renderPane } from "./views/pane.js";

const DEFAULT_DIMS = {
  universe: { w: 1600, h: 1000 },
  menubtn: { w: 36, h: 36 },
  launcher: { w: 310, h: 430 },
  ctxmenu: { w: 260, h: 320 },
  winbar: { w: 800, h: 30 },
  toolwin: { w: 460, h: 28 },
  edge: { w: 600, h: 5 },
  resizer: { w: 1600, h: 1000 },
  fleet: { w: 620, h: 560 },
  notes: { w: 440, h: 340 },
  topbar: { w: 1200, h: 28 },
  pane: { w: 960, h: 22 },
};

export default class Orrery extends View {
  init(p, cx) {
    const pr = props() || {};
    const role = pr.role || p?.role || "universe";
    this.role = role;
    this._overlayId = pr.overlay || p?.overlay || "";
    this._closed = false;
    this._targetKind = role === "winbar" ? "terminal" : role === "toolwin" ? (pr.tool === "note" ? "note" : "tool") : role === "notes" ? "note" : "";
    this._targetId =
      role === "winbar"
        ? pr.terminal || ""
        : role === "toolwin"
          ? pr.tool === "note"
            ? pr.noteId || ""
            : pr.tool || ""
          : role === "notes"
            ? pr.noteId || p?.noteId || ""
            : "";

    const dims = DEFAULT_DIMS[role] || DEFAULT_DIMS.universe;
    this.vpW = dims.w;
    this.vpH = dims.h;
    this.edgeW = 0;
    this.edgeH = 0;
    this._measured = false;
    this._didAutoOpen = false;
    this._didReconcile = false;
    this._userMinimized = false;
    this._lastCamResetSeq = readCamResetSeq();
    this._wasFocus = isFocusMode();

    // Timer handles (cancelled cleanly in close())
    this._timers = [];
    this._autoOpenTimer = null;
    this._confirmTimer = null;
    this._confirmRmTimer = null;
    this._noteSaveTimer = null;
    this._camSyncTimer = null;
    this._camAnimTimer = null;
    this._scaleTimer = null;
    this._pendingScaleFactor = 1.0;
    this._pendingMove = null;

    // Local transient UI state (never persisted in shared())
    this.showNewSpace = false;
    this.showAgentPicker = false;
    this.showSettled = false;
    this.showSpaceSwitcher = false;
    this.blockedCursor = 0;
    this.confirmCloseAddr = "";
    this.confirmCloseUntil = 0;
    this.confirmRmMachine = "";
    this.confirmRmMachineUntil = 0;
    this._noteDeleted = false;
    this.clockText = formatClockHHMM();

    // Restore persisted camera on universe init (clamped on first on_size_change)
    const savedCam = role === "universe" ? readCamera() : { camX: 0, camY: 0, zoom: 1.0 };
    this.camX = savedCam.camX;
    this.camY = savedCam.camY;
    this.zoom = savedCam.zoom;
    this.panDrag = null;
    this.noteDrag = null;
    this.winCardDrag = null;
    this.lastEmptyClickMs = 0;
    this.lastEmptyClickPos = null;
    this.lastTitleClickMs = 0;
    this.termSnapshots = new Map();
    this._snapshotBusy = false;
    this._snapshotQueued = false;
    this._keyQueue = [];
    this._keyBusy = false;

    // Resizer transient pointer/focus state
    this.curMouseX = null;
    this.curMouseY = null;
    this.resizerFocus = null;
    this.resizerOpenedAt = Date.now();

    // Inline +agent launcher cache
    this.agentSeq = 0;
    this.agentLoaded = false;
    this.agentLoading = false;
    this.agentList = [];
    this.agentError = "";
    this.agentMachine = null;

    // Retained native editor state for physical Scratchpad Notes (released cleanly in close())
    this.noteId = pr.noteId || p?.noteId || "";
    this.editorState = null;
    this.notesFocus = null;

    // NEVER call cx.notify() synchronously inside init()!

    if (role === "launcher") {
      const allSpaces = spaces() || [];
      const activeSpace = allSpaces.find((sp) => sp.active) ?? allSpaces[0] ?? null;
      loadKnownAgents(this, cx, activeSpace?.machine ?? null);
    }

    if (role === "ctxmenu" && pr.kind === "space") {
      const allSpaces = spaces() || [];
      const sp = pr.spaceId ? allSpaces.find((s) => s.id === pr.spaceId) ?? null : allSpaces[0] ?? null;
      if (sp) {
        const machRec = sp.machine ? readMachinesList().find((m) => !m.isLocal && m.name === sp.machine) : null;
        if (!sp.machine || machineStatusInfo(machRec).connected) {
          loadKnownAgents(this, cx, sp.machine ?? null);
        } else {
          this.agentLoaded = true;
          this.agentError = "machine offline";
        }
      }
    }

    if (role === "ctxmenu" && pr.kind === "machine" && pr.machineName) {
      const machRec = readMachinesList().find((m) => !m.isLocal && m.name === pr.machineName);
      if (machineStatusInfo(machRec).connected) {
        loadKnownAgents(this, cx, pr.machineName);
      } else {
        this.agentLoaded = true;
        this.agentError = "machine offline";
      }
    }

    if (role === "fleet") {
      cx.spawn(async (asyncCx) => {
        await pollMachinesList();
        asyncCx.notify();
      });
    }

    if (role === "resizer") {
      this.resizerFocus = cx.focus_handle();
      cx.spawn(async (c) => {
        await c.sleep(16);
        try {
          this.resizerFocus?.focus?.();
        } catch (_err) {
          // Ignore focus race
        }
      });
    }

    if (role === "notes") {
      this.notesFocus = cx.focus_handle();
      const initialVal = this.noteId ? getNoteById(this.noteId)?.text || "" : readNotes();
      this.editorState = EditorState.new({
        language: "markdown",
        value: initialVal,
        font_family: MONO,
        font_size: 13,
        line_numbers: false,
        folding: false,
        soft_wrap: true,
      });
      this.editorState.on("change", (_ev, evCx) => {
        try {
          if (this._noteDeleted) return;
          const val = this.editorState ? this.editorState.value() : "";
          // Debounce shared() write by 140ms so rapid typing stays 0-lag while
          // still updating the live cosmos slate preview smoothly.
          if (this._noteSaveTimer) {
            try {
              this._noteSaveTimer.cancel();
            } catch (_err) {
              // Ignore finished timer
            }
            this._noteSaveTimer = null;
          }
          if (evCx?.timer?.after) {
            this._noteSaveTimer = evCx.timer.after(140, () => {
              this._noteSaveTimer = null;
              if (this._noteDeleted) return;
              const latest = this.editorState ? this.editorState.value() : val;
              if (this.noteId) {
                updateNoteText(this.noteId, latest);
              } else {
                writeNotes(latest);
              }
            });
          } else if (this.noteId) {
            updateNoteText(this.noteId, val);
          } else {
            writeNotes(val);
          }
          evCx?.notify?.();
        } catch (_err) {
          // Ignore transient read error
        }
      });
      this.editorState.on("blur", () => {
        if (this._noteDeleted || !this.editorState) return;
        if (this._noteSaveTimer) {
          try {
            this._noteSaveTimer.cancel();
          } catch (_err) {
            // ignore
          }
          this._noteSaveTimer = null;
        }
        try {
          const latest = this.editorState.value();
          if (this.noteId) updateNoteText(this.noteId, latest);
          else writeNotes(latest);
        } catch (_err) {
          // ignore
        }
      });
      const shouldAutoFocus = Boolean(pr.autoFocus || p?.autoFocus || initialVal.length === 0);
      if (shouldAutoFocus) {
        cx.spawn(async (c) => {
          await c.sleep(24);
          if (this._closed) return;
          try {
            this.notesFocus?.focus?.();
          } catch (_err) {
            // Ignore focus race
          }
        });
      }
    }

    if (role === "universe") {
      this.canvasFocus = cx.focus_handle();
      this.activeZoomTerm = null;
      this.director = createCosmicDirector();
      this._lastSnapshotAt = 0;

      const refreshTermSnapshots = (tickCx, forceNotify = false) => {
        if (this._closed || isFocusMode()) return;
        if (this._snapshotBusy) {
          if (forceNotify) this._snapshotQueued = true;
          return;
        }
        const openWins = readOpenWins();
        const addrs = Object.keys(openWins);
        if (addrs.length === 0) return;

        // Skip offline remote machines so one slow SSH host never stalls local snapshots
        const offlineMachs = new Set(
          (machines() || []).filter((m) => m && m.name && m.layout !== "ready").map((m) => m.name)
        );
        this._snapshotBusy = true;
        this._lastSnapshotAt = Date.now();
        tickCx.spawn(async (asyncCx) => {
          try {
            let changed = false;
            const latestWins = readOpenWins();
            await Promise.all(
              addrs.map(async (addr) => {
                try {
                  const slash = addr.indexOf("/");
                  if (slash > 0 && offlineMachs.has(addr.slice(0, slash))) return;

                  const rec = latestWins[addr];
                  const isLive = Boolean(rec?.overlayId) && !rec?.suspended;
                  const prev = this.termSnapshots.get(addr);
                  const isTypingHere =
                    (this.zoom || 1.0) < 0.995 && this.activeZoomTerm && this.activeZoomTerm === addr;

                  // Keep exact pre-zoom live snapshot frozen unless actively typing into this zoomed terminal
                  if (!isLive && !isTypingHere && prev?.fromLiveOverlay && prev.lines?.length > 0) {
                    return;
                  }

                  const dimsKey = `${rec?.screenW || rec?.width || 0}x${rec?.screenH || rec?.height || 0}`;
                  const needDims = !prev || !prev.cols || !prev.rows || prev.dimsKey !== dimsKey || isTypingHere;
                  const readRes = await hc(["read", "--lines", "0", addr]);
                  const infoRes = needDims ? await hc(["get", "--json", addr]).catch(() => null) : null;
                  if (this._closed) return;

                  if (readRes && readRes.code === 0 && typeof readRes.stdout === "string") {
                    const normalized = readRes.stdout.replace(/\r/g, "");
                    const lines = normalized.endsWith("\n")
                      ? normalized.slice(0, -1).split("\n")
                      : normalized.split("\n");
                    let cols = prev?.cols || 0;
                    let rows = prev?.rows || lines.length;
                    if (infoRes && infoRes.code === 0 && typeof infoRes.stdout === "string") {
                      try {
                        const parsed = JSON.parse(infoRes.stdout);
                        if (typeof parsed?.cols === "number" && parsed.cols > 0) cols = parsed.cols;
                        if (typeof parsed?.rows === "number" && parsed.rows > 0) rows = parsed.rows;
                      } catch (_e) {
                        // Ignore JSON parse hiccup
                      }
                    }

                    const postRec = readOpenWins()[addr];
                    const stillLive = Boolean(postRec?.overlayId) && !postRec?.suspended;
                    if (
                      !stillLive &&
                      !isTypingHere &&
                      prev?.fromLiveOverlay &&
                      prev.cols > 0 &&
                      cols > 0 &&
                      (cols !== prev.cols || rows !== prev.rows)
                    ) {
                      return;
                    }

                    const sig = `${cols}x${rows}\0${lines.join("\n")}`;
                    if (!prev || prev.sig !== sig || (stillLive && !prev.fromLiveOverlay)) {
                      this.termSnapshots.set(addr, {
                        lines,
                        cols,
                        rows,
                        dimsKey,
                        fromLiveOverlay: stillLive,
                        sig,
                        updatedAt: Date.now(),
                      });
                      changed = true;
                    }
                  }
                } catch (_err) {
                  // Ignore transient terminal read error
                }
              })
            );
            if (this._closed) return;
            const hasSuspended =
              (this.zoom || 1.0) < 0.995 ||
              Object.values(readOpenWins()).some((r) => !r?.overlayId || r?.suspended);
            if (changed && (forceNotify || hasSuspended || this.panDrag)) {
              asyncCx.notify();
            }
          } finally {
            this._snapshotBusy = false;
            if (this._snapshotQueued && !this._closed) {
              this._snapshotQueued = false;
              refreshTermSnapshots(asyncCx, true);
            }
          }
        });
      };

      this.refreshTermSnapshotsNow = (tickCx) => refreshTermSnapshots(tickCx, true);

      // Warm initial terminal snapshots right after startup reconcile
      this._trackTimer(
        cx.timer.after(700, (tickCx) => {
          refreshTermSnapshots(tickCx, false);
        })
      );

      // Gentle 2500ms silent cache warm at 100% live zoom (battery-friendly!),
      // ramping to 300ms only when actively typing into a zoomed-out terminal.
      this._trackTimer(
        cx.timer.every(300, (tickCx) => {
          if (isFocusMode()) return;
          const isTypingZoomed = (this.zoom || 1.0) < 0.995 && Boolean(this.activeZoomTerm);
          if (!isTypingZoomed && Date.now() - (this._lastSnapshotAt || 0) < 2500) return;
          refreshTermSnapshots(tickCx, false);
        })
      );

      // Dynamic Cosmic-Horror Event Director heartbeat (180ms balanced cadence; skips Focus Mode & drags;
      // notifies ONLY when an event spawns/changes/despawns or moves >= 0.35 world units)
      this._trackTimer(
        cx.timer.every(180, (tickCx) => {
          if (isFocusMode() || this.panDrag || this.noteDrag || this.winCardDrag || this._camAnimTimer || !this.director) return;
          const stageW = Math.max(480, this.vpW || 1600);
          const stageH = Math.max(320, this.vpH || 1000);
          const spList = spaces() || [];
          const planetCenters = computePlanetPositions(spList, stageW, stageH, readSpacePositions());
          const agList = agents() || [];
          const hasBlocked = agList.some((a) => a && a.status === "blocked");
          const changed = this.director.tick(Date.now(), {
            vpW: stageW,
            vpH: stageH,
            camX: this.camX || 0,
            camY: this.camY || 0,
            zoom: this.zoom || 1.0,
            planetCenters,
            hasBlocked,
          });
          if (changed) {
            tickCx.notify();
          }
        })
      );

      // Gentle 30s clock updater — notifies ONLY when HH:MM changes
      this._trackTimer(
        cx.timer.every(30000, (tickCx) => {
          const next = formatClockHHMM();
          if (next !== this.clockText) {
            this.clockText = next;
            tickCx.notify();
          }
        })
      );
    }

    if (role === "universe" || role === "topbar") {
      this._initAuthority(cx, role);
    }
  }

  _trackTimer(task) {
    if (task) this._timers.push(task);
    return task;
  }

  _handlePendingActions(asyncCx) {
    const actions = drainPendingCosmosActions();
    if (actions.length === 0) return;

    const vp = this.role === "universe" ? { w: this.vpW, h: this.vpH } : getViewportDims();
    const vpW = vp.w;
    const vpH = vp.h;
    const focusMode = isFocusMode();

    for (const action of actions) {
      if (action.type === "spawn-terminal") {
        spawnTerminalInSpace(asyncCx, action.spaceId || "", {
          argv: action.argv,
          name: action.name,
          folder: action.folder,
          task: action.task,
          vpW,
          vpH,
        });
      } else if (action.type === "spawn-space") {
        spawnNewSpace(asyncCx, {
          folder: action.folder,
          machine: action.machine,
          name: action.name,
          atWorld: focusMode ? null : action.atWorld || null,
          vpW,
          vpH,
        });
      } else if (action.type === "browse-space") {
        const targetWorld = focusMode ? null : action.atWorld || null;
        asyncCx.spawn(async (pickCx) => {
          try {
            const folder = await pickFolder({ prompt: "New Space" });
            if (folder && !this._closed) {
              const curVp = getViewportDims();
              spawnNewSpace(pickCx, {
                folder,
                atWorld: targetWorld,
                vpW: curVp.w,
                vpH: curVp.h,
              });
              pickCx.notify();
            }
          } catch (_err) {
            // cancelled
          }
        });
      } else if (action.type === "open-space") {
        const sp = (spaces() || []).find((s) => s.id === action.spaceId);
        if (sp) {
          openSpaceTerminalAsync(asyncCx, sp, vpW, vpH);
        }
      } else if (action.type === "open-tab") {
        const sp = (spaces() || []).find((s) => s.id === action.spaceId);
        const tab = (sp?.tabs || []).find((tb) => tb.id === action.tabId) || null;
        if (sp) {
          openTabTerminalAsync(asyncCx, sp, tab, vpW, vpH);
        }
      } else if (action.type === "drop-note") {
        if (!focusMode) {
          dropNoteInView(vpW, vpH, this.camX || 0, this.camY || 0, this.zoom || 1.0);
        }
      } else if (action.type === "remove-machine") {
        removeMachine(asyncCx, action.machine || "");
      } else if (action.type === "reconnect-machine") {
        reconnectMachine(asyncCx, action.machine || "");
      } else if (action.type === "spawn-agent-machine") {
        spawnAgentOnMachine(asyncCx, action.machine || "", {
          argv: action.argv,
          name: action.name,
          vpW,
          vpH,
        });
      } else if (action.type === "world-zoom" && this.role === "universe" && !focusMode) {
        applyCameraZoomAt(this, action.deltaY || 0, action.x, action.y, asyncCx, action.deltaX || 0);
      } else if (action.type === "reset-view" && this.role === "universe" && !focusMode) {
        cancelCameraAnim(this);
        if (this._camSyncTimer) {
          try {
            this._camSyncTimer.cancel();
          } catch (_err) {
            // ignore
          }
          this._camSyncTimer = null;
        }
        this.camX = 0;
        this.camY = 0;
        this.zoom = 1.0;
        this.activeZoomTerm = null;
        writeCamera(0, 0, 1.0);
        syncLiveOverlaysToCamera({ camX: 0, camY: 0, zoom: 1.0 }, vpW, vpH);
      } else if (action.type === "focus-world-window" && this.role === "universe" && !focusMode) {
        // Controlled smooth pan+zoom glide from Launcher / Fleet / ! blocked badge to an off-screen or zoomed window
        animateCameraToWindow(this, action.kind || "terminal", action.id || "", asyncCx);
      }
    }
  }

  _initAuthority(cx, role) {
    this._gitPolledCwd = "";
    this._lastAgentOrderSig = null;

    const isActiveAuthority = () => {
      const focus = isFocusMode();
      return role === "topbar" ? focus : !focus;
    };

    const syncOrderIfChanged = () => {
      if (!isActiveAuthority()) return;
      const current = agents() || [];
      const sorted = sortAgentsByUrgency(current);
      const curSig = current.map((a) => a.address).join("\0");
      const nextSig = sorted.map((a) => a.address).join("\0");
      if (curSig !== nextSig || nextSig !== this._lastAgentOrderSig) {
        this._lastAgentOrderSig = nextSig;
        if (sorted.length > 0) {
          setAgentOrder(sorted.map((a) => a.address));
        }
      }
    };

    const runGitPoll = () => {
      if (!isActiveAuthority()) return;
      const { cwd } = resolveActiveGitTarget();
      if (!cwd) return;
      this._gitPolledCwd = cwd;
      cx.spawn(async () => {
        await pollGitStatus();
      });
    };

    const runMachinesPoll = () => {
      if (!isActiveAuthority()) return;
      cx.spawn(async () => {
        await pollMachinesList();
      });
    };

    // Immediate startup sync & git poll (~200ms) — never clobber persisted camera!
    this._trackTimer(
      cx.timer.after(200, () => {
        syncOrderIfChanged();
        pruneOpenWindows();
        pruneDeadState();
        runGitPoll();
        if (role === "universe" && !isFocusMode() && !hasMenuButton()) {
          const vp = getViewportDims();
          ensureMenuButtonOnTop(this._measured ? this.vpW : vp.w, this._measured ? this.vpH : vp.h);
        }
      })
    );

    // Initial SSH machines discovery right on startup (~300ms)
    this._trackTimer(
      cx.timer.after(300, () => {
        runMachinesPoll();
      })
    );

    // Quick follow-up at 1.5s once initial cwd settles
    this._trackTimer(
      cx.timer.after(1500, () => {
        if (!isActiveAuthority()) return;
        const gi = readGitInfo();
        const { cwd } = resolveActiveGitTarget();
        if (cwd && (!gi.commitSha || gi.cwd !== cwd)) {
          runGitPoll();
        }
      })
    );

    // 4s maintenance loop: urgency order, dead floating window/state/snapshot cleanup, cwd switch poll
    this._trackTimer(
      cx.timer.every(4000, () => {
        if (!isActiveAuthority()) return;
        syncOrderIfChanged();
        const openWins = pruneOpenWindows();
        pruneDeadState();
        if (role === "universe" && this.termSnapshots?.size > 0) {
          for (const addr of this.termSnapshots.keys()) {
            if (!(addr in openWins)) this.termSnapshots.delete(addr);
          }
          if (this.activeZoomTerm && !(this.activeZoomTerm in openWins)) {
            this.activeZoomTerm = null;
          }
        }
        const { cwd } = resolveActiveGitTarget();
        if (cwd && cwd !== this._gitPolledCwd) {
          runGitPoll();
        }
      })
    );

    // Throttled 15s git + SSH machines poll for active space
    this._trackTimer(
      cx.timer.every(15000, () => {
        runGitPoll();
        runMachinesPoll();
      })
    );

    // Command dispatcher for keys.json & popup actions:
    //   orrery.toggle-launcher, orrery.run-action, orrery.tile-all, orrery.minimize-all,
    //   orrery.toggle-mode, orrery.open-files, orrery.open-changes, orrery.open-fleet, orrery.open-notes
    cx.spawn(async (asyncCx) => {
      for (;;) {
        const cmd = await nextCommand();
        if (!cmd) continue;
        if (!isActiveAuthority()) continue;

        try {
          const vp = role === "universe" && this._measured ? { w: this.vpW, h: this.vpH } : getViewportDims();
          if (cmd === "toggle-launcher") {
            if (!isFocusMode()) {
              toggleLauncherPopup(vp.w, vp.h);
            }
          } else if (cmd === "run-action") {
            this._handlePendingActions(asyncCx);
          } else if (cmd === "tile-all") {
            if (!isFocusMode()) {
              tileAllOpenWindows(vp.w, vp.h);
            }
          } else if (cmd === "minimize-all") {
            if (!isFocusMode()) {
              const res = toggleShowDesktop(vp.w, vp.h);
              if (res === "hidden") this._userMinimized = true;
            }
          } else if (cmd === "toggle-mode") {
            const wasFocus = isFocusMode();
            toggleMode();
            if (wasFocus) {
              asyncCx.spawn(async (c) => {
                await c.sleep(80);
                if (!isFocusMode() && !this._closed) {
                  const curVp = getViewportDims();
                  ensureMenuButtonOnTop(curVp.w, curVp.h);
                }
              });
            }
          } else if (cmd === "open-files") {
            toggleToolSurface("files", vp.w, vp.h);
          } else if (cmd === "open-changes") {
            toggleToolSurface("changes", vp.w, vp.h);
          } else if (cmd === "open-fleet") {
            toggleToolSurface("fleet", vp.w, vp.h);
          } else if (cmd === "open-notes") {
            if (!isFocusMode()) {
              openOrCreateNoteInView(vp.w, vp.h, this.camX || 0, this.camY || 0);
            }
          } else if (cmd === "zoom-out") {
            if (role === "universe" && !isFocusMode()) {
              applyCameraZoomAt(this, -96, Math.round(vp.w / 2), Math.round(vp.h / 2), asyncCx);
            }
          } else if (cmd === "zoom-in") {
            if (role === "universe" && !isFocusMode()) {
              applyCameraZoomAt(this, 96, Math.round(vp.w / 2), Math.round(vp.h / 2), asyncCx);
            }
          } else if (cmd === "zoom-reset") {
            if (role === "universe" && !isFocusMode()) {
              cancelCameraAnim(this);
              if (this._camSyncTimer) {
                try {
                  this._camSyncTimer.cancel();
                } catch (_err) {
                  // ignore
                }
                this._camSyncTimer = null;
              }
              this.camX = 0;
              this.camY = 0;
              this.zoom = 1.0;
              this.activeZoomTerm = null;
              writeCamera(0, 0, 1.0);
              syncLiveOverlaysToCamera({ camX: 0, camY: 0, zoom: 1.0 }, vp.w, vp.h);
            }
          }
        } catch (_err) {
          // Ignore transient command errors cleanly
        }

        asyncCx.notify();
      }
    });
  }

  close(_cx) {
    this._closed = true;
    if (this.role === "launcher") {
      clearLauncherPopupIfMatch(this._overlayId);
    } else if (this.role === "ctxmenu") {
      clearContextPopupIfMatch(this._overlayId);
    } else if (this.role === "menubtn") {
      clearMenuButtonIfMatch(this._overlayId);
    } else if (this._targetKind && this._targetId && this._overlayId) {
      clearWindowOverlayIfMatch(this._targetKind, this._targetId, this._overlayId);
    }

    if (this._noteSaveTimer) {
      try {
        this._noteSaveTimer.cancel();
      } catch (_err) {
        // Ignore already-finished timer
      }
      this._noteSaveTimer = null;
      if (!this._noteDeleted && this.editorState) {
        try {
          const val = this.editorState.value();
          if (this.noteId) {
            updateNoteText(this.noteId, val);
          } else {
            writeNotes(val);
          }
        } catch (_err) {
          // Ignore transient read error on close
        }
      }
    }

    if (this.editorState) {
      try {
        this.editorState.release();
      } catch (_err) {
        // Ignore already released editor
      }
      this.editorState = null;
    }

    for (const fh of ["canvasFocus", "notesFocus", "resizerFocus"]) {
      if (this[fh]) {
        try {
          this[fh].release?.();
        } catch (_err) {
          // Ignore already released handle
        }
        this[fh] = null;
      }
    }

    this.termSnapshots?.clear?.();
    this._keyQueue = [];

    for (const task of this._timers || []) {
      try {
        task.cancel();
      } catch (_err) {
        // Ignore already-finished timer
      }
    }
    this._timers = [];

    for (const key of ["_autoOpenTimer", "_confirmTimer", "_confirmRmTimer", "_camSyncTimer", "_camAnimTimer", "_scaleTimer"]) {
      if (this[key]) {
        try {
          this[key].cancel();
        } catch (_err) {
          // Ignore already-finished timer
        }
        this[key] = null;
      }
    }
  }

  render(cx) {
    const role = props()?.role || this.role || "universe";
    if (role === "menubtn") return renderMenubtn(this, cx);
    if (role === "launcher") return renderLauncher(this, cx);
    if (role === "ctxmenu") return renderCtxmenu(this, cx);
    if (role === "winbar") return renderWinbar(this, cx);
    if (role === "toolwin") return renderToolwin(this, cx);
    if (role === "edge") return renderEdge(this, cx);
    if (role === "resizer") return renderResizer(this, cx);
    if (role === "fleet") return renderFleet(this, cx);
    if (role === "notes") return renderNotes(this, cx);
    if (role === "topbar") return renderTopbar(this, cx);
    if (role === "pane") return renderPane(cx);
    return renderUniverse(this, cx);
  }
}
