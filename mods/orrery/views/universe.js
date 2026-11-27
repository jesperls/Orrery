// Orrery Full-Bleed Infinite Spatial Cosmic Canvas (`role: "universe"`).
// Zero bottom taskbar — 100% edge-to-edge living deep space where Spaces, orbiting
// Agents, Note Slates, AND open Terminal / App / Note windows all share ONE continuous
// pannable & scroll-zoomable cosmic world:
//   - Scroll wheel / pinch / trackpad : Smooth proportional zoom (`30%`–`100%`) around cursor;
//     horizontal trackpad swipe or Shift+Scroll pans smoothly across the cosmic arena.
//     Live native overlays mount at 100% zoom; below 100% windows stay spatially coherent
//     pixel-matched cards with direct zoomed-out terminal typing (`hc keys` + live `hc read`).
//   - Click + drag empty space        : Unified world-space pan clamped to cosmic bounds
//   - Double-click empty space        : Reset camera & zoom to 100% home
//   - Bottom-left `≡` orb             : Always-on-top corner trigger (`menubtn.js`, Alt+Space)
//   - Bottom-right whisper HUD        : Minimal transparent status (blocked !, zoom/reset, ssh, tile, clock)

import { div } from "gpui-kit";
import { h_flex } from "gpui-base";
import { agents, focused, hc, panes, run, settings, spaces, terminals, theme, window as win } from "herdr";
import { renderCosmos } from "../cosmos.js";
import {
  agentActivity,
  agentName,
  agentTooltip,
  buildGitBySpace,
  clampCameraToBounds,
  clampZoom,
  cleanAgentName,
  CLEAR,
  closeContextPopup,
  closeLauncherPopup,
  ensureMenuButtonOnTop,
  findDefaultTerminal,
  focusNextBlocked,
  formatClockHHMM,
  getTopSafeMargin,
  getWorldBounds,
  groupSubAgents,
  isFocusMode,
  isNoteVisible,
  LIVE_ZOOM_MIN,
  machineStatusInfo,
  MIN_ZOOM,
  MONO,
  moveNoteObject,
  moveWorldWindowCoords,
  noteTitle,
  openContextPopup,
  openNoteWindow,
  openSpaceTerminalAsync,
  openTabTerminalAsync,
  openTerminalWindow,
  openToolWindow,
  pruneOpenWindows,
  readGitInfo,
  readMachinesList,
  readNotesList,
  readOpenNotes,
  readOpenTools,
  readOpenWins,
  readSpacePositions,
  reconcileOverlaysOnMount,
  scaleWindowByFactor,
  setViewportDims,
  shortFolder,
  sortAgentsByUrgency,
  spaceDisplayName,
  spaceTooltip,
  spawnTerminalInSpace,
  suspendAllLiveOverlays,
  syncLiveOverlaysToCamera,
  tabTooltip,
  tileAllOpenWindows,
  TOOL_META,
  TOOL_ORDER,
  withAlpha,
  writeCamera,
} from "../state.js";

const CLOSE_RED = "#c43e2b";
const PAN_THRESHOLD = 4;
const DRAG_THRESHOLD = 5;

function stopProp(_e, cx) {
  cx.stop_propagation();
}

function dismissPopups() {
  closeLauncherPopup(false);
  closeContextPopup();
}

function cancelSettleTimer(view) {
  if (view._camSyncTimer) {
    try {
      view._camSyncTimer.cancel();
    } catch (_err) {
      // Ignore already-finished timer
    }
    view._camSyncTimer = null;
  }
}

export function cancelCameraAnim(view) {
  if (view._camAnimTimer) {
    try {
      view._camAnimTimer.cancel();
    } catch (_err) {
      // Ignore already-finished timer
    }
    view._camAnimTimer = null;
  }
}

// Compute the minimum camera shift at 100% zoom so a world-space window fits comfortably
// inside the viewport — expands around where the user clicked instead of teleporting to center.
function computeControlledWindowTarget(view, rec, vpW, vpH) {
  const startZoom = typeof view.zoom === "number" && Number.isFinite(view.zoom) ? view.zoom : 1.0;
  const startCamX = view.camX || 0;
  const startCamY = view.camY || 0;
  const topSafe = getTopSafeMargin();
  const wx = rec.wx || 0;
  const wy = rec.wy || 0;
  const ww = Math.min(Math.max(220, vpW - 16), Math.max(220, rec.width || 600));
  const wh = Math.min(Math.max(140, vpH - topSafe - 8), Math.max(140, rec.height || 400));
  const twx = wx + ww / 2;
  const twy = wy + wh / 2;

  // Keep the window's current screen center anchored as it grows to 1.0x, then minimally nudge inside margins
  const scx0 = twx * startZoom + startCamX;
  const scy0 = twy * startZoom + startCamY;
  let idealCamX = scx0 - twx;
  let idealCamY = scy0 - twy;

  const marginX = Math.max(16, Math.min(36, Math.floor((vpW - ww) / 4)));
  const marginTop = Math.max(topSafe, Math.min(36, Math.floor((vpH - wh) / 4)));
  const marginBot = Math.max(16, Math.min(36, Math.floor((vpH - wh) / 4)));

  if (ww <= vpW - marginX * 2) {
    const left = idealCamX + wx;
    const right = left + ww;
    if (left < marginX) idealCamX += marginX - left;
    else if (right > vpW - marginX) idealCamX -= right - (vpW - marginX);
  } else {
    idealCamX = vpW / 2 - twx;
  }

  if (wh <= vpH - marginTop - marginBot) {
    const top = idealCamY + wy;
    const bottom = top + wh;
    if (top < marginTop) idealCamY += marginTop - top;
    else if (bottom > vpH - marginBot) idealCamY -= bottom - (vpH - marginBot);
  } else {
    idealCamY = Math.max(topSafe, (vpH - wh) / 2) - wy;
  }

  const target = clampCameraToBounds(idealCamX, idealCamY, 1.0, vpW, vpH, { snapToOne: true });
  return { target, twx, twy, scx0, scy0 };
}

export function animateCameraToWindow(view, kind, id, c) {
  if (!view || !id) return false;
  const rec =
    kind === "terminal"
      ? readOpenWins()[id]
      : kind === "tool"
        ? readOpenTools()[id]
        : kind === "note"
          ? readOpenNotes()[id]
          : null;
  if (!rec) return false;

  const vpW = Math.max(480, view.vpW || 1600);
  const vpH = Math.max(320, view.vpH || 1000);
  const startZoom = typeof view.zoom === "number" && Number.isFinite(view.zoom) ? view.zoom : 1.0;
  const startCamX = view.camX || 0;
  const startCamY = view.camY || 0;
  const { target, twx, twy, scx0, scy0 } = computeControlledWindowTarget(view, rec, vpW, vpH);

  const zoomDelta = Math.abs(target.zoom - startZoom);
  const panDist = Math.hypot(target.camX - startCamX, target.camY - startCamY);

  const landInteractive = (landCx) => {
    view.camX = target.camX;
    view.camY = target.camY;
    view.zoom = target.zoom;
    view.activeZoomTerm = null;
    writeCamera(target.camX, target.camY, target.zoom);
    syncLiveOverlaysToCamera(target, vpW, vpH, {
      focusTerminal: kind === "terminal" ? id : null,
    });
    if (kind === "terminal") {
      if (!readOpenWins()[id]?.overlayId) {
        openTerminalWindow(id, { vpW, vpH, cam: target });
      } else {
        run("pane.focus", { terminal: id });
      }
    } else if (kind === "tool") {
      openToolWindow(id, vpW, vpH, { cam: target });
    } else if (kind === "note") {
      openNoteWindow(id, { vpW, vpH, cam: target, autoFocus: true });
    }
    landCx?.notify?.();
  };

  cancelSettleTimer(view);
  cancelCameraAnim(view);

  if ((zoomDelta < 0.004 && panDist < 4) || !c?.timer?.every) {
    landInteractive(c);
    return true;
  }

  dismissPopups();
  suspendAllLiveOverlays();
  view.activeZoomTerm = null;

  const endScx = twx * target.zoom + target.camX;
  const endScy = twy * target.zoom + target.camY;
  const durationMs = Math.round(Math.max(190, Math.min(340, 175 + panDist * 0.14 + zoomDelta * 210)));
  const startedAt = Date.now();

  view._camAnimTimer = c.timer.every(16, (tickCx) => {
    if (view._closed || isFocusMode()) {
      cancelCameraAnim(view);
      return;
    }
    const elapsed = Date.now() - startedAt;
    const t = Math.min(1, elapsed / durationMs);
    if (t >= 1) {
      cancelCameraAnim(view);
      landInteractive(tickCx);
      return;
    }
    // Cubic ease-out + geometric zoom + straight-line target-window screen glide (zero wobble!)
    const ease = 1 - Math.pow(1 - t, 3);
    const curZ = startZoom * Math.pow(target.zoom / Math.max(0.1, startZoom), ease);
    const curScx = scx0 + (endScx - scx0) * ease;
    const curScy = scy0 + (endScy - scy0) * ease;
    const clamped = clampCameraToBounds(curScx - twx * curZ, curScy - twy * curZ, curZ, vpW, vpH, {
      snapToOne: false,
    });
    view.camX = clamped.camX;
    view.camY = clamped.camY;
    view.zoom = clamped.zoom;
    tickCx.notify();
  });

  return true;
}

function scheduleCameraSync(view, c, delayMs = 180) {
  cancelSettleTimer(view);
  const vpW = Math.max(480, view.vpW || 1600);
  const vpH = Math.max(320, view.vpH || 1000);
  if (c?.timer?.after) {
    view._camSyncTimer = c.timer.after(delayMs, (asyncCx) => {
      view._camSyncTimer = null;
      const cam = { camX: view.camX || 0, camY: view.camY || 0, zoom: view.zoom || 1.0 };
      writeCamera(cam.camX, cam.camY, cam.zoom);
      syncLiveOverlaysToCamera(cam, vpW, vpH);
      asyncCx.notify();
    });
  } else {
    const cam = { camX: view.camX || 0, camY: view.camY || 0, zoom: view.zoom || 1.0 };
    writeCamera(cam.camX, cam.camY, cam.zoom);
    syncLiveOverlaysToCamera(cam, vpW, vpH);
  }
}

export function applyCameraZoomAt(view, deltaY, anchorX, anchorY, c, deltaX = 0, opts = {}) {
  const dy = typeof deltaY === "number" && Number.isFinite(deltaY) ? deltaY : 0;
  const dx = typeof deltaX === "number" && Number.isFinite(deltaX) ? deltaX : 0;
  const isTrackpad = Boolean(opts?.isTrackpad);
  const touchPhase = typeof opts?.touchPhase === "string" ? opts.touchPhase : "";
  const forceMode = opts?.forceMode === "zoom" || opts?.forceMode === "pan" ? opts.forceMode : null;

  // Track smooth trackpad gesture sequences: axis-lock per gesture so diagonal two-finger
  // swipes on macOS never flip mid-stroke between zoom and pan, and filter post-lift inertia tails.
  let gestureMode = forceMode;
  let fastSettle = false;
  if (isTrackpad) {
    const now = Date.now();
    if (!view._wheelGesture) {
      view._wheelGesture = { mode: null, lastAt: 0, accX: 0, accY: 0, endedAt: 0 };
    }
    const g = view._wheelGesture;
    if (touchPhase === "started" || now - g.lastAt > 200) {
      g.mode = null;
      g.accX = 0;
      g.accY = 0;
      g.endedAt = 0;
    }
    g.lastAt = now;

    if (touchPhase === "ended" || touchPhase === "cancelled") {
      g.endedAt = now;
      fastSettle = true;
      if (Math.abs(dy) < 1.5 && Math.abs(dx) < 1.5) {
        if (view._camSyncTimer) scheduleCameraSync(view, c, 90);
        return;
      }
    } else if (g.endedAt > 0 && now - g.endedAt > 0) {
      // macOS post-lift momentum tail: drop tiny decaying ticks so live terminals remount promptly
      fastSettle = true;
      if (Math.abs(dy) < 1.5 && Math.abs(dx) < 1.5) return;
    }

    if (forceMode) {
      g.mode = forceMode;
    } else if (!g.mode) {
      g.accX += Math.abs(dx);
      g.accY += Math.abs(dy);
      if (g.accX + g.accY >= 5) {
        g.mode = g.accX > g.accY * 1.45 ? "pan" : "zoom";
      }
    }
    gestureMode = g.mode || (Math.abs(dx) > Math.abs(dy) * 1.45 ? "pan" : "zoom");
  } else if (!gestureMode) {
    gestureMode = Math.abs(dx) > Math.abs(dy) * 1.25 && Math.abs(dx) >= 0.01 ? "pan" : "zoom";
  }

  if (Math.abs(dy) < 0.01 && Math.abs(dx) < 0.01) return;

  const oldZoom = typeof view.zoom === "number" && Number.isFinite(view.zoom) ? view.zoom : 1.0;
  const oldCamX = view.camX || 0;
  const oldCamY = view.camY || 0;
  const vpW = Math.max(480, view.vpW || 1600);
  const vpH = Math.max(320, view.vpH || 1000);

  // Horizontal pan mode (trackpad two-finger horizontal swipe or Shift+Scroll)
  if (gestureMode === "pan") {
    if (Math.abs(dx) < 0.01 && (!isTrackpad || Math.abs(dy) < 0.01)) return;
    const panDX = Math.max(-240, Math.min(240, dx)) * 1.15;
    const panDY = isTrackpad ? Math.max(-240, Math.min(240, dy)) * 1.15 : 0;
    const clamped = clampCameraToBounds(oldCamX + panDX, oldCamY + panDY, oldZoom, vpW, vpH, {
      snapToOne: false,
    });
    if (clamped.camX === oldCamX && clamped.camY === oldCamY) return;
    dismissPopups();
    cancelSettleTimer(view);
    cancelCameraAnim(view);
    suspendAllLiveOverlays();
    view.camX = clamped.camX;
    view.camY = clamped.camY;
    scheduleCameraSync(view, c, fastSettle ? 100 : 160);
    c?.notify?.();
    return;
  }

  if (Math.abs(dy) < 0.01) return;

  // Continuous proportional zoom tuned for both discrete mouse wheels and 120Hz smooth trackpads
  const clampedDy = Math.max(-240, Math.min(240, dy));
  const sensitivity = isTrackpad ? 0.0032 : 0.0022;
  const factor = Math.exp(clampedDy * sensitivity);
  const zoomingIn = dy > 0;
  const newZoom = clampZoom(oldZoom * factor, zoomingIn);
  if (Math.abs(newZoom - oldZoom) < 0.0001) return;

  const mx = typeof anchorX === "number" ? anchorX : Math.round(vpW / 2);
  const my = typeof anchorY === "number" ? anchorY : Math.round(vpH / 2);

  // Pin the world coordinate under the cursor, clamped strictly to cosmic world bounds
  const worldX = (mx - oldCamX) / oldZoom;
  const worldY = (my - oldCamY) / oldZoom;
  const clamped = clampCameraToBounds(mx - worldX * newZoom, my - worldY * newZoom, newZoom, vpW, vpH, {
    snapToOne: zoomingIn,
  });

  dismissPopups();
  cancelSettleTimer(view);
  cancelCameraAnim(view);
  suspendAllLiveOverlays();

  // Keep camera purely in-memory during active wheel ticks (zero cross-overlay setShared storm)
  view.zoom = clamped.zoom;
  view.camX = clamped.camX;
  view.camY = clamped.camY;
  if (clamped.zoom >= LIVE_ZOOM_MIN) {
    view.activeZoomTerm = null;
  }

  const settleDelay = fastSettle ? 110 : clamped.zoom >= LIVE_ZOOM_MIN ? 180 : 150;
  scheduleCameraSync(view, c, settleDelay);
  c?.notify?.();
}

const ORRERY_ALT_KEYS = new Set(["space", "o", "t", "m", "f", "e", "g", "n", "-", "=", "0", "up", "down"]);
const ORRERY_CTRL_SHIFT_KEYS = new Set(["f", "g", "c"]);

function mapKeyEventToHcKey(e) {
  if (!e) return null;
  const k = typeof e.key === "string" ? e.key.toLowerCase() : "";
  const mods = e.modifiers || {};

  // Never intercept OS/platform shortcuts (Cmd+Q/W/C/H/M on macOS) or Orrery keys.json bindings
  if (mods.platform) return null;
  if (mods.alt && !mods.control && ORRERY_ALT_KEYS.has(k)) return null;
  if (mods.control && mods.shift && !mods.alt && ORRERY_CTRL_SHIFT_KEYS.has(k)) return null;

  // International AltGr (Ctrl+Alt producing a printable character like @, {, }, [, ], \)
  if (mods.control && mods.alt && typeof e.key_char === "string" && e.key_char.length === 1) {
    return e.key_char === " " ? "space" : e.key_char;
  }

  const specialMap = {
    enter: "enter",
    return: "enter",
    escape: "esc",
    backspace: "backspace",
    tab: "tab",
    space: "space",
    up: "up",
    down: "down",
    left: "left",
    right: "right",
    home: "home",
    end: "end",
    pageup: "pageup",
    pagedown: "pagedown",
    delete: "delete",
  };
  if (specialMap[k]) {
    if (mods.control && !mods.shift) return `ctrl+${specialMap[k]}`;
    if (mods.alt && !mods.control) return `alt+${specialMap[k]}`;
    if (
      mods.shift &&
      (k === "enter" ||
        k === "return" ||
        k === "tab" ||
        k === "up" ||
        k === "down" ||
        k === "left" ||
        k === "right" ||
        k === "home" ||
        k === "end" ||
        k === "pageup" ||
        k === "pagedown" ||
        k === "delete")
    ) {
      return `shift+${specialMap[k]}`;
    }
    return specialMap[k];
  }
  if (/^f([1-9]|1[0-2])$/.test(k)) return k;
  if (mods.control && !mods.shift && !mods.alt && k.length === 1) return `ctrl+${k}`;
  if (mods.alt && !mods.control && k.length === 1) return `alt+${k}`;
  if (typeof e.key_char === "string" && e.key_char.length === 1) {
    return e.key_char === " " ? "space" : e.key_char;
  }
  if (!mods.control && !mods.alt && !mods.platform && k.length === 1) {
    return mods.shift ? k.toUpperCase() : k;
  }
  return null;
}

function enqueueZoomTermKeys(view, addr, keys, c) {
  if (!Array.isArray(view._keyQueue)) view._keyQueue = [];
  view._keyQueue.push({ addr, keys });
  if (view._keyBusy) return;
  view._keyBusy = true;
  c.spawn(async (asyncCx) => {
    try {
      while (view._keyQueue.length > 0 && !view._closed) {
        const next = view._keyQueue.shift();
        if (!next || !next.addr || !next.keys?.length) continue;
        // Batch in safe chunks of 64 keys with `--` separator so leading `-` characters never parse as flags
        for (let i = 0; i < next.keys.length && !view._closed; i += 64) {
          const chunk = next.keys.slice(i, i + 64);
          try {
            await hc(["keys", next.addr, "--", ...chunk]);
          } catch (_err) {
            // ignore transient key send error
          }
        }
      }
      if (!view._closed) {
        view.refreshTermSnapshotsNow?.(asyncCx);
      }
    } finally {
      view._keyBusy = false;
    }
  });
}

function sendZoomTermKey(view, addr, e, c) {
  if (!addr || !e) return false;
  const mods = e.modifiers || {};
  const k = typeof e.key === "string" ? e.key.toLowerCase() : "";
  // Support Cmd+V / Ctrl+Shift+V clipboard paste directly into zoomed-out terminal
  if ((mods.platform || (mods.control && mods.shift)) && k === "v") {
    const clip = c?.read_from_clipboard?.();
    if (typeof clip === "string" && clip.length > 0) {
      const cleaned = clip.replace(/\r/g, "");
      const chars = [...cleaned].slice(0, 512).map((ch) => {
        if (ch === "\n") return "enter";
        if (ch === "\t") return "tab";
        if (ch === " ") return "space";
        return ch;
      });
      if (chars.length > 0) {
        enqueueZoomTermKeys(view, addr, chars, c);
        return true;
      }
    }
  }
  const hcKey = mapKeyEventToHcKey(e);
  if (!hcKey) return false;
  enqueueZoomTermKeys(view, addr, [hcKey], c);
  return true;
}

function resetCameraHome(view, c) {
  cancelSettleTimer(view);
  cancelCameraAnim(view);
  view.camX = 0;
  view.camY = 0;
  view.zoom = 1.0;
  view.activeZoomTerm = null;
  writeCamera(0, 0, 1.0);
  syncLiveOverlaysToCamera({ camX: 0, camY: 0, zoom: 1.0 }, view.vpW || 1600, view.vpH || 1000);
  c?.notify?.();
}

function cancelActiveDrag(view, c) {
  if (view.winCardDrag) {
    view.winCardDrag = null;
    c?.notify?.();
    return;
  }
  if (view.noteDrag) {
    view.noteDrag = null;
    c?.notify?.();
    return;
  }
  if (view.panDrag) {
    view.camX = view.panDrag.origCamX;
    view.camY = view.panDrag.origCamY;
    view.panDrag = null;
    writeCamera(view.camX, view.camY, view.zoom || 1.0);
    scheduleCameraSync(view, c, 40);
    c?.notify?.();
  }
}

function buildWorldWindowsList({
  openWins,
  openTools,
  openNotes,
  allAgents,
  allTerms,
  allSpaces,
  allPanes,
  notesMap,
  focusedTerminal,
  activeZoomTerm = null,
  baseTermFont = 14.0,
  winCardDrag,
  termSnapshots,
  zoom = 1.0,
}) {
  const list = [];
  const agentMap = new Map((allAgents || []).map((a) => [a.address, a]));
  const termMap = new Map((allTerms || []).map((t) => [t.address, t]));
  const paneMap = new Map((allPanes || []).filter((p) => p.terminal).map((p) => [p.terminal, p]));
  const spaceMap = new Map((allSpaces || []).map((s) => [s.id, s]));

  // Render ALL open non-minimized windows on the cosmos canvas as a pixel-aligned live backing layer!
  // When live overlays close on zoom-out or pan, the exact terminal text is ALREADY painted underneath (ZERO blink!).
  for (const [addr, rec] of Object.entries(openWins || {})) {
    if (!rec) continue;
    const isLiveMounted = Boolean(rec.overlayId) && !rec.suspended;
    const ag = agentMap.get(addr) || null;
    const tm = termMap.get(addr) || null;
    const pn = paneMap.get(addr) || null;
    const sp = (ag?.space || tm?.space) ? spaceMap.get(ag?.space || tm?.space) || null : null;
    const title = ag
      ? agentName(ag)
      : cleanAgentName(tm?.program?.name || pn?.program?.name || tm?.name || "shell");
    const subtitle = sp ? spaceDisplayName(sp) : ag?.space_name || "";
    const branch = pn?.branch || sp?.branch || "";
    const folder = shortFolder(pn?.cwd || sp?.folder || "");
    const act = ag ? agentActivity(ag, termMap) : "";
    const draggingThis = Boolean(
      winCardDrag && winCardDrag.moved && winCardDrag.kind === "terminal" && winCardDrag.id === addr
    );

    const snap = termSnapshots?.get?.(addr);
    const screenLines = Array.isArray(snap?.lines) && snap.lines.length > 0 ? snap.lines : [];
    const ptyCols = snap?.cols || 0;
    const ptyRows = snap?.rows || screenLines.length || 0;
    const fallbackLines = [];
    if (act) fallbackLines.push(act);
    if (tm?.title && tm.title !== title) fallbackLines.push(tm.title);
    if (fallbackLines.length === 0) fallbackLines.push(folder || subtitle || "live terminal");

    list.push({
      kind: "terminal",
      id: addr,
      title,
      subtitle: branch || subtitle,
      meta: [subtitle, folder].filter(Boolean).join(" · "),
      screenLines,
      ptyCols,
      ptyRows,
      lines: fallbackLines,
      preview: act || folder,
      status: ag?.status || tm?.status || pn?.status || "idle",
      pinned: Boolean(ag?.pinned),
      focused: Boolean(focusedTerminal && focusedTerminal === addr),
      zoomInputFocused: Boolean(zoom < LIVE_ZOOM_MIN && activeZoomTerm && activeZoomTerm === addr),
      baseTermFont,
      wx: draggingThis ? winCardDrag.curWX : rec.wx,
      wy: draggingThis ? winCardDrag.curWY : rec.wy,
      width: rec.width,
      height: rec.height,
      isLiveMounted: isLiveMounted && !draggingThis,
      liveX: rec.x,
      liveY: rec.y,
      liveW: rec.screenW || Math.max(220, Math.round(rec.width * (zoom || 1.0))),
      liveH: rec.screenH || Math.max(140, Math.round(rec.height * (zoom || 1.0))),
      scale: rec.scale || 1.0,
    });
  }

  for (const kind of TOOL_ORDER) {
    const rec = openTools?.[kind];
    if (!rec || rec.minimized) continue;
    const isLiveMounted = Boolean(rec.overlayId) && !rec.suspended;
    const meta = TOOL_META[kind];
    const draggingThis = Boolean(
      winCardDrag && winCardDrag.moved && winCardDrag.kind === "tool" && winCardDrag.id === kind
    );
    const fleetLines =
      kind === "fleet"
        ? [
            `SPACES (${allSpaces.length})`,
            ...allSpaces.slice(0, 5).map((s) => `  ◆ ${spaceDisplayName(s)}  ${s.branch || ""}`),
            "",
            `AGENTS (${allAgents.length})`,
            ...allAgents.slice(0, 6).map((a) => `  ${a.status === "blocked" ? "!" : "*"} ${agentName(a)}  [${a.status || "idle"}]`),
          ]
        : [
            kind === "changes" ? "live git diff & changes" : "workspace file explorer",
          ];
    list.push({
      kind: "tool",
      id: kind,
      glyph: meta.glyph,
      title: meta.title,
      subtitle: "",
      meta: "desktop app",
      screenLines: fleetLines,
      lines: fleetLines,
      preview: meta.title,
      status: "idle",
      pinned: false,
      focused: false,
      baseTermFont: 13.0,
      wx: draggingThis ? winCardDrag.curWX : rec.wx,
      wy: draggingThis ? winCardDrag.curWY : rec.wy,
      width: rec.width,
      height: rec.height,
      isLiveMounted: isLiveMounted && !draggingThis,
      liveX: rec.x,
      liveY: rec.y,
      liveW: rec.screenW || Math.max(220, Math.round(rec.width * (zoom || 1.0))),
      liveH: rec.screenH || Math.max(140, Math.round(rec.height * (zoom || 1.0))),
      scale: rec.scale || 1.0,
    });
  }

  for (const [noteId, rec] of Object.entries(openNotes || {})) {
    if (!rec || rec.minimized) continue;
    const isLiveMounted = Boolean(rec.overlayId) && !rec.suspended;
    const note = notesMap.get(noteId);
    if (!note) continue;
    const draggingThis = Boolean(
      winCardDrag && winCardDrag.moved && winCardDrag.kind === "note" && winCardDrag.id === noteId
    );
    const rawLines = (note.text || "").replace(/\r/g, "").split("\n").slice(0, 48);
    list.push({
      kind: "note",
      id: noteId,
      glyph: "N",
      title: noteTitle(note, "Note"),
      subtitle: "markdown",
      meta: "scratchpad note",
      screenLines: rawLines.some((l) => l.trim()) ? rawLines : ["(empty note)"],
      lines: rawLines.filter((l) => l.trim()).slice(0, 4),
      preview: rawLines.find((l) => l.trim()) || "Scratchpad note",
      status: "done",
      pinned: false,
      focused: false,
      baseTermFont: 13.0,
      wx: draggingThis ? winCardDrag.curWX : rec.wx,
      wy: draggingThis ? winCardDrag.curWY : rec.wy,
      width: rec.width,
      height: rec.height,
      isLiveMounted: isLiveMounted && !draggingThis,
      liveX: rec.x,
      liveY: rec.y,
      liveW: rec.screenW || Math.max(200, Math.round(rec.width * (zoom || 1.0))),
      liveH: rec.screenH || Math.max(130, Math.round(rec.height * (zoom || 1.0))),
      scale: rec.scale || 1.0,
    });
  }

  return list;
}

export function renderUniverse(view, _cx) {
  const t = theme() ?? {};
  const w = win() ?? { platform: "linux", buttons: false, maximized: false };
  const vpW = Math.max(480, view.vpW || 1600);
  const vpH = Math.max(320, view.vpH || 1000);

  const camX = view.camX || 0;
  const camY = view.camY || 0;
  const zoom = typeof view.zoom === "number" && Number.isFinite(view.zoom) ? view.zoom : 1.0;
  const isMoved = camX !== 0 || camY !== 0 || Math.abs(zoom - 1.0) >= 0.01;
  const isPanning = Boolean(view.panDrag);
  const isDraggingAny = Boolean(view.noteDrag || view.panDrag || view.winCardDrag);
  const draggingNoteId = view.noteDrag?.moved ? view.noteDrag.id : null;
  const draggingWinKey = view.winCardDrag?.moved
    ? `${view.winCardDrag.kind}:${view.winCardDrag.id}`
    : null;

  const allSpaces = spaces() || [];
  const activeSpace = allSpaces.find((sp) => sp.active) ?? allSpaces[0] ?? null;
  const allAgents = sortAgentsByUrgency(agents() || []);
  const allTerms = terminals() || [];
  const allPanes = panes() || [];
  const termMap = new Map(allTerms.map((x) => [x.address, x]));
  const { allSubAgents } = groupSubAgents(allAgents, allTerms);
  const foc = focused();
  const focusedTerminal = foc?.terminal || null;

  const openWins = readOpenWins();
  const openWindowAddrs = new Set(Object.keys(openWins));
  const activeZoomTerm =
    view.activeZoomTerm && view.activeZoomTerm in openWins ? view.activeZoomTerm : null;
  const openTools = readOpenTools();
  const rawNotes = readNotesList();
  const notesMap = new Map(rawNotes.map((n) => [n.id, n]));
  const openNotes = readOpenNotes();
  const gitInfo = readGitInfo();
  const gitBySpace = buildGitBySpace(allSpaces, gitInfo);
  const remoteMachines = readMachinesList().filter((m) => !m.isLocal);
  const connectedRemotes = remoteMachines.filter((m) => machineStatusInfo(m, t).connected).length;
  const anyNeedsLogin = remoteMachines.some((m) => machineStatusInfo(m, t).needsLogin);
  const anyLoadingRemote = remoteMachines.some((m) => machineStatusInfo(m, t).loading);
  const remoteStatusColor = anyNeedsLogin
    ? t.blocked || "#f06449"
    : anyLoadingRemote
      ? t.working || "#e8a849"
      : connectedRemotes > 0
        ? t.done || "#5fd4b8"
        : t.dim || "#4d5870";
  const remoteTooltip = remoteMachines
    .map((m) => `${m.name}: ${machineStatusInfo(m, t).label}`)
    .concat("Click to open Fleet Monitor")
    .join("\n");

  const blockedCount = allAgents.filter((a) => a.status === "blocked").length;
  const openWinCount = Object.keys(openWins).length;
  const clockStr = view.clockText || formatClockHHMM();

  // Build live Note Objects array for cosmos.js (reflecting 60fps in-memory drag coordinates!)
  const cosmosNotes = rawNotes.map((n) => {
    const draggingThis = Boolean(view.noteDrag && view.noteDrag.id === n.id && view.noteDrag.moved);
    return {
      id: n.id,
      title: noteTitle(n, ""),
      text: n.text || "",
      x: draggingThis ? view.noteDrag.curX : n.x,
      y: draggingThis ? view.noteDrag.curY : n.y,
      open: isNoteVisible(n.id, openNotes),
    };
  });

  // Build live World-Space Window Cards (always backing every open window for zero-blink zoom/pan!)
  const appSettings = settings?.() ?? {};
  const baseTermFont = Number(appSettings?.font_size) || 14.0;
  const worldWindows = buildWorldWindowsList({
    openWins,
    openTools,
    openNotes,
    allAgents,
    allTerms,
    allSpaces,
    allPanes,
    notesMap,
    focusedTerminal,
    activeZoomTerm,
    baseTermFont,
    winCardDrag: view.winCardDrag,
    termSnapshots: view.termSnapshots,
    zoom,
  });

  const bounds = getWorldBounds(vpW, vpH);
  const clampWX = (wx, padR = 220) => Math.max(bounds.minX + 16, Math.min(bounds.maxX - padR, Math.round(wx)));
  const clampWY = (wy, padB = 140) => Math.max(bounds.minY + 16, Math.min(bounds.maxY - padB, Math.round(wy)));

  const handlePointerMove = (e, c) => {
    if (!e?.position) return;

    if (view.winCardDrag) {
      const wd = view.winCardDrag;
      const dx = e.position.x - wd.startMouseX;
      const dy = e.position.y - wd.startMouseY;
      if (!wd.moved && Math.hypot(dx, dy) >= DRAG_THRESHOLD) {
        wd.moved = true;
      }
      if (wd.moved) {
        const z = view.zoom || 1.0;
        const nextWX = clampWX(wd.origWX + dx / z, 220);
        const nextWY = clampWY(wd.origWY + dy / z, 140);
        if (nextWX !== wd.curWX || nextWY !== wd.curWY) {
          wd.curWX = nextWX;
          wd.curWY = nextWY;
          c?.notify?.();
        }
      }
      return;
    }

    if (view.noteDrag) {
      const nd = view.noteDrag;
      const dx = e.position.x - nd.startMouseX;
      const dy = e.position.y - nd.startMouseY;
      if (!nd.moved && Math.hypot(dx, dy) >= DRAG_THRESHOLD) {
        nd.moved = true;
      }
      if (nd.moved) {
        const z = view.zoom || 1.0;
        const nextX = clampWX(nd.origX + dx / z, 200);
        const nextY = clampWY(nd.origY + dy / z, 100);
        if (nextX !== nd.curX || nextY !== nd.curY) {
          nd.curX = nextX;
          nd.curY = nextY;
          c?.notify?.();
        }
      }
      return;
    }

    if (view.panDrag) {
      const pd = view.panDrag;
      const dx = e.position.x - pd.startX;
      const dy = e.position.y - pd.startY;
      if (!pd.moved && Math.hypot(dx, dy) >= PAN_THRESHOLD) {
        pd.moved = true;
        cancelSettleTimer(view);
        suspendAllLiveOverlays();
      }
      if (pd.moved) {
        const clamped = clampCameraToBounds(pd.origCamX + dx, pd.origCamY + dy, view.zoom || 1.0, vpW, vpH, {
          snapToOne: false,
        });
        const nextCamX = clamped.camX;
        const nextCamY = clamped.camY;
        if (nextCamX !== view.camX || nextCamY !== view.camY) {
          view.camX = nextCamX;
          view.camY = nextCamY;
          c?.notify?.();
        }
      }
    }
  };

  const handlePointerUp = (e, c) => {
    if (view.winCardDrag) {
      const wd = view.winCardDrag;
      const z = view.zoom || 1.0;
      if (wd.moved && e?.position) {
        wd.curWX = clampWX(wd.origWX + (e.position.x - wd.startMouseX) / z, 220);
        wd.curWY = clampWY(wd.origWY + (e.position.y - wd.startMouseY) / z, 140);
      }
      view.winCardDrag = null;
      if (wd.moved) {
        moveWorldWindowCoords(wd.kind, wd.id, wd.curWX, wd.curWY);
        scheduleCameraSync(view, c, 40);
      } else {
        // Controlled minimal zoom+pan onto the window if zoomed out or clipped, triggering full live interactive mode
        const rec =
          wd.kind === "terminal"
            ? openWins[wd.id]
            : wd.kind === "tool"
              ? openTools[wd.id]
              : openNotes[wd.id];
        const sx = rec ? Math.round(rec.wx * z + (view.camX || 0)) : 0;
        const sy = rec ? Math.round(rec.wy * z + (view.camY || 0)) : 0;
        const sw = rec ? Math.round((rec.width || 600) * z) : 0;
        const sh = rec ? Math.round((rec.height || 400) * z) : 0;
        const isClipped = Boolean(rec) && (sx < 12 || sy < 12 || sx + sw > vpW - 12 || sy + sh > vpH - 12);
        if (rec && (z < LIVE_ZOOM_MIN || isClipped || rec.suspended || !rec.overlayId)) {
          animateCameraToWindow(view, wd.kind, wd.id, c);
        } else if (wd.kind === "terminal") {
          openTerminalWindow(wd.id, { vpW, vpH });
        } else if (wd.kind === "tool") {
          openToolWindow(wd.id, vpW, vpH);
        } else if (wd.kind === "note") {
          openNoteWindow(wd.id, { vpW, vpH });
        }
      }
      c?.notify?.();
      return;
    }

    if (view.noteDrag) {
      const nd = view.noteDrag;
      const z = view.zoom || 1.0;
      if (nd.moved && e?.position) {
        nd.curX = clampWX(nd.origX + (e.position.x - nd.startMouseX) / z, 200);
        nd.curY = clampWY(nd.origY + (e.position.y - nd.startMouseY) / z, 100);
      }
      view.noteDrag = null;
      if (nd.moved) {
        moveNoteObject(nd.id, nd.curX, nd.curY);
      } else {
        const screenX = Math.round(nd.origX * z + (view.camX || 0));
        const screenY = Math.round(nd.origY * z + (view.camY || 0));
        openNoteWindow(nd.id, { vpW, vpH, nearX: screenX, nearY: screenY });
      }
      c?.notify?.();
      return;
    }

    if (view.panDrag) {
      const pd = view.panDrag;
      view.panDrag = null;
      if (pd.moved) {
        view.lastEmptyClickMs = 0;
        view.lastEmptyClickPos = null;
        const z = view.zoom || 1.0;
        writeCamera(view.camX || 0, view.camY || 0, z);
        scheduleCameraSync(view, c, 120);
      } else {
        dismissPopups();
      }
      c?.notify?.();
    }
  };

  const cosmosHandlers = {
    onWheel: (e, evCx) => {
      const dy = typeof e?.delta?.y === "number" ? e.delta.y : 0;
      const dx = typeof e?.delta?.x === "number" ? e.delta.x : 0;
      const isTrackpad = !e?.delta_lines;
      const touchPhase = typeof e?.touch_phase === "string" ? e.touch_phase : "";
      const mods = e?.modifiers || {};
      if (Math.abs(dy) < 0.01 && Math.abs(dx) < 0.01 && touchPhase !== "ended" && touchPhase !== "cancelled") {
        return;
      }
      if (mods.control || mods.platform) {
        applyCameraZoomAt(view, dy, e?.position?.x, e?.position?.y, evCx, 0, {
          isTrackpad,
          touchPhase,
          forceMode: "zoom",
        });
      } else if (mods.shift && Math.abs(dx) < 0.01) {
        applyCameraZoomAt(view, 0, e?.position?.x, e?.position?.y, evCx, dy, {
          isTrackpad,
          touchPhase,
          forceMode: "pan",
        });
      } else {
        applyCameraZoomAt(view, dy, e?.position?.x, e?.position?.y, evCx, dx, {
          isTrackpad,
          touchPhase,
        });
      }
    },
    onSpaceClick: (sp, evCx) => {
      dismissPopups();
      if (!sp) return;
      openSpaceTerminalAsync(evCx, sp, vpW, vpH);
      evCx?.notify?.();
    },
    onSpaceDoubleClick: (sp, _evCx) => {
      if (sp?.id) run("space.rename", { id: sp.id });
    },
    onSpaceRightClick: (sp, e, evCx) => {
      if (!sp?.id) return;
      evCx?.stop_propagation?.();
      view.panDrag = null;
      view.noteDrag = null;
      view.winCardDrag = null;
      openContextPopup({
        kind: "space",
        spaceId: sp.id,
        x: e?.position?.x ?? Math.round(vpW / 2),
        y: e?.position?.y ?? Math.round(vpH / 2),
        vpW,
        vpH,
      });
    },
    onTabClick: (sp, tab, evCx) => {
      dismissPopups();
      openTabTerminalAsync(evCx, sp, tab, vpW, vpH);
      evCx?.notify?.();
    },
    onNewTab: (sp, evCx) => {
      dismissPopups();
      spawnTerminalInSpace(evCx, sp?.id || "", { vpW, vpH });
      evCx?.notify?.();
    },
    onAgentClick: (ag, evCx) => {
      dismissPopups();
      if (!ag?.address) return;
      openTerminalWindow(ag.address, { vpW, vpH });
      const rec = readOpenWins()[ag.address];
      const curZ = view.zoom || 1.0;
      const sx = rec ? Math.round(rec.wx * curZ + (view.camX || 0)) : 0;
      const sy = rec ? Math.round(rec.wy * curZ + (view.camY || 0)) : 0;
      const sw = rec ? Math.round((rec.width || 600) * curZ) : 0;
      const sh = rec ? Math.round((rec.height || 400) * curZ) : 0;
      const clipped = Boolean(rec) && (sx < 12 || sy < 12 || sx + sw > vpW - 12 || sy + sh > vpH - 12);
      if (rec && (curZ < LIVE_ZOOM_MIN || clipped || rec.suspended || !rec.overlayId)) {
        animateCameraToWindow(view, "terminal", ag.address, evCx);
      }
      evCx?.notify?.();
    },
    onAgentRightClick: (ag, _evCx) => {
      if (!ag?.address) return;
      run("terminal.peek", { terminal: ag.address });
    },
    onSubAgentClick: (sub, evCx) => {
      dismissPopups();
      if (!sub?.address) return;
      openTerminalWindow(sub.address, { vpW, vpH, tile: "center" });
      const rec = readOpenWins()[sub.address];
      if (rec && ((view.zoom || 1.0) < LIVE_ZOOM_MIN || rec.suspended || !rec.overlayId)) {
        animateCameraToWindow(view, "terminal", sub.address, evCx);
      }
      evCx?.notify?.();
    },
    onWorldWindowMouseDown: (winObj, e, evCx) => {
      if (!winObj?.id) return;
      dismissPopups();
      cancelSettleTimer(view);
      cancelCameraAnim(view);
      view.canvasFocus?.focus?.();
      view.panDrag = null;
      view.noteDrag = null;
      view.winCardDrag = {
        kind: winObj.kind,
        id: winObj.id,
        startMouseX: e?.position?.x ?? 0,
        startMouseY: e?.position?.y ?? 0,
        origWX: winObj.wx,
        origWY: winObj.wy,
        curWX: winObj.wx,
        curWY: winObj.wy,
        moved: false,
      };
      evCx?.notify?.();
    },
    onWorldWindowRightClick: (winObj, e, evCx) => {
      if (!winObj?.id) return;
      evCx?.stop_propagation?.();
      view.panDrag = null;
      view.noteDrag = null;
      view.winCardDrag = null;
      openContextPopup({
        kind: "taskbar",
        targetKind: winObj.kind,
        targetId: winObj.id,
        x: e?.position?.x ?? Math.round(vpW / 2),
        y: e?.position?.y ?? Math.round(vpH / 2),
        vpW,
        vpH,
      });
    },
    onWorldWindowScale: (winObj, e, evCx) => {
      const dy = typeof e?.delta?.y === "number" ? e.delta.y : 0;
      if (!winObj?.id || Math.abs(dy) < 0.01) return;
      const clampedDy = Math.max(-160, Math.min(160, dy));
      const factor = Math.exp(clampedDy * 0.0018);
      scaleWindowByFactor(winObj.kind, winObj.id, factor, { materialize: false });
      evCx?.notify?.();
    },
    onPanStart: (e, evCx) => {
      cancelSettleTimer(view);
      cancelCameraAnim(view);
      view.canvasFocus?.focus?.();
      view.noteDrag = null;
      view.winCardDrag = null;
      if (view.activeZoomTerm) {
        view.activeZoomTerm = null;
      }
      const now = Date.now();
      const px = e?.position?.x ?? 0;
      const py = e?.position?.y ?? 0;
      const prevPos = view.lastEmptyClickPos;
      const closeEnough = !prevPos || Math.hypot(px - prevPos.x, py - prevPos.y) <= 12;
      const isDoubleClick =
        e?.click_count === 2 ||
        (closeEnough &&
          typeof view.lastEmptyClickMs === "number" &&
          view.lastEmptyClickMs > 0 &&
          now - view.lastEmptyClickMs < 350);
      if (isDoubleClick) {
        view.lastEmptyClickMs = 0;
        view.lastEmptyClickPos = null;
        dismissPopups();
        view.panDrag = null;
        if (isMoved) {
          resetCameraHome(view, evCx);
        }
        return;
      }
      view.lastEmptyClickMs = now;
      view.lastEmptyClickPos = { x: px, y: py };
      dismissPopups();
      view.panDrag = {
        startX: px,
        startY: py,
        origCamX: view.camX || 0,
        origCamY: view.camY || 0,
        moved: false,
      };
      evCx?.notify?.();
    },
    onPanMove: (e, evCx) => handlePointerMove(e, evCx),
    onPanEnd: (e, evCx) => handlePointerUp(e, evCx),
    onNoteMouseDown: (note, e, evCx) => {
      if (!note?.id) return;
      dismissPopups();
      cancelSettleTimer(view);
      cancelCameraAnim(view);
      view.canvasFocus?.focus?.();
      view.panDrag = null;
      view.winCardDrag = null;
      view.noteDrag = {
        id: note.id,
        startMouseX: e?.position?.x ?? 0,
        startMouseY: e?.position?.y ?? 0,
        origX: note.x,
        origY: note.y,
        curX: note.x,
        curY: note.y,
        moved: false,
      };
      evCx?.notify?.();
    },
    onNoteRightClick: (note, e, evCx) => {
      if (!note?.id) return;
      evCx?.stop_propagation?.();
      view.panDrag = null;
      view.noteDrag = null;
      view.winCardDrag = null;
      openContextPopup({
        kind: "note",
        noteId: note.id,
        x: e?.position?.x ?? Math.round(vpW / 2),
        y: e?.position?.y ?? Math.round(vpH / 2),
        camX,
        camY,
        zoom,
        vpW,
        vpH,
      });
    },
    onDesktopClick: (_e, _evCx) => {
      dismissPopups();
    },
    onDesktopRightClick: (e, evCx) => {
      evCx?.stop_propagation?.();
      view.panDrag = null;
      view.noteDrag = null;
      view.winCardDrag = null;
      openContextPopup({
        kind: "desktop",
        x: e?.position?.x ?? Math.round(vpW / 2),
        y: e?.position?.y ?? Math.round(vpH / 2),
        camX,
        camY,
        zoom,
        vpW,
        vpH,
      });
    },
    onMachineClick: (_machineName, _e, evCx) => {
      dismissPopups();
      openToolWindow("fleet", vpW, vpH);
      evCx?.notify?.();
    },
    onMachineRightClick: (machineName, e, evCx) => {
      if (!machineName) return;
      evCx?.stop_propagation?.();
      view.panDrag = null;
      view.noteDrag = null;
      view.winCardDrag = null;
      openContextPopup({
        kind: "machine",
        machineName,
        x: e?.position?.x ?? Math.round(vpW / 2),
        y: e?.position?.y ?? Math.round(vpH / 2),
        vpW,
        vpH,
      });
    },
    agentTooltip: (ag) => agentTooltip(ag, allSpaces, termMap),
    spaceTooltip: (sp) => spaceTooltip(sp, gitBySpace),
    tabTooltip: (sp, tab) => tabTooltip(sp, tab, allAgents, allTerms),
  };

  const hudBtn = (id, label, tip, onClick, opts = {}) =>
    h_flex()
      .id(id)
      .flex_none()
      .px(opts.px ?? 7)
      .py(3)
      .items_center()
      .justify_center()
      .bg(opts.bg || withAlpha(t.chrome || "#090d17", "A8"))
      .when(Boolean(opts.borderColor), (el) => el.border_1().border_color(opts.borderColor))
      .font_family(MONO)
      .text_size(opts.size ?? 10)
      .line_height("14px")
      .when(Boolean(opts.bold), (el) => el.font_bold())
      .text_color(opts.color || t.muted || "#8b93a6")
      .cursor_pointer()
      .hover((st) =>
        st
          .bg(opts.hoverBg || withAlpha(t.hover || "#172236", "E6"))
          .text_color(opts.hoverColor || t.foreground || "#e4dfd3")
      )
      .tooltip(tip)
      .on_mouse_down("left", stopProp)
      .on_click((e, c) => {
        c.stop_propagation();
        onClick(e, c);
      })
      .child(label);

  const zoomPct = Math.round(zoom * 100);

  return div()
    .id("orrery-universe")
    .relative()
    .size_full()
    .overflow_hidden()
    .bg(t.canvas || "#06080f")
    .when(Boolean(view.canvasFocus), (el) => el.track_focus(view.canvasFocus))
    .on_key_down((e, c) => {
      if ((isDraggingAny || view._camAnimTimer) && (e?.key === "escape" || e?.keystroke === "escape")) {
        c.stop_propagation();
        cancelCameraAnim(view);
        if (isDraggingAny) cancelActiveDrag(view, c);
        return;
      }
      if ((view.zoom || 1.0) < LIVE_ZOOM_MIN && activeZoomTerm) {
        if (sendZoomTermKey(view, activeZoomTerm, e, c)) {
          c.stop_propagation();
        }
      }
    })
    .on_mouse_move((e, c) => handlePointerMove(e, c))
    .on_mouse_up("left", (e, c) => handlePointerUp(e, c))
    .on_size_change((sz, sizeCx) => {
      if (!sz || sz.width < 120 || sz.height < 120) return;
      const changed =
        !view._measured ||
        Math.abs(sz.width - (view.vpW || 0)) >= 2 ||
        Math.abs(sz.height - (view.vpH || 0)) >= 2;
      view.vpW = sz.width;
      view.vpH = sz.height;
      view._measured = true;
      setViewportDims(sz.width, sz.height);

      // Reconcile persisted overlay records & restored camera ONCE on startup mount
      if (!view._didReconcile && !isFocusMode() && sz.width >= 300 && sz.height >= 200) {
        view._didReconcile = true;
        const clamped = clampCameraToBounds(view.camX || 0, view.camY || 0, view.zoom || 1.0, sz.width, sz.height);
        view.camX = clamped.camX;
        view.camY = clamped.camY;
        view.zoom = clamped.zoom;
        reconcileOverlaysOnMount(sz.width, sz.height, clamped);
      } else if (changed && !isFocusMode()) {
        const clamped = clampCameraToBounds(view.camX || 0, view.camY || 0, view.zoom || 1.0, sz.width, sz.height, {
          snapToOne: false,
        });
        view.camX = clamped.camX;
        view.camY = clamped.camY;
        view.zoom = clamped.zoom;
        ensureMenuButtonOnTop(sz.width, sz.height);
        scheduleCameraSync(view, sizeCx, 120);
      }

      // Smart 1-shot auto-open on first real measure ONLY when zero persisted windows exist
      if (
        !view._didAutoOpen &&
        !view._userMinimized &&
        !isFocusMode() &&
        sz.width >= 300 &&
        sz.height >= 200
      ) {
        view._didAutoOpen = true;
        if (sizeCx?.timer?.after) {
          view._autoOpenTimer = sizeCx.timer.after(180, (asyncCx) => {
            view._autoOpenTimer = null;
            if (isFocusMode() || view._userMinimized || view._closed) return;
            const liveOpen = pruneOpenWindows();
            if (Object.keys(liveOpen).length > 0) {
              ensureMenuButtonOnTop(view.vpW || sz.width, view.vpH || sz.height);
              return;
            }
            const addr = findDefaultTerminal();
            if (!addr) {
              ensureMenuButtonOnTop(view.vpW || sz.width, view.vpH || sz.height);
              return;
            }
            const curW = Math.max(480, view.vpW || sz.width);
            const curH = Math.max(320, view.vpH || sz.height);
            openTerminalWindow(addr, { vpW: curW, vpH: curH });
            asyncCx.notify();
          });
        }
      }

      if (changed) {
        sizeCx.notify();
      }
    })
    // Full-bleed edge-to-edge infinite spatial cosmic desktop (ZERO bottom taskbar!)
    .child(
      div()
        .id("orrery-cosmos-stage")
        .absolute()
        .top(0)
        .left(0)
        .right(0)
        .bottom(0)
        .overflow_hidden()
        .child(
          renderCosmos({
            vpW,
            vpH,
            camX,
            camY,
            zoom,
            isPanning,
            draggingNoteId,
            draggingWinKey,
            worldWindows,
            notes: cosmosNotes,
            spaces: allSpaces,
            spacePositions: readSpacePositions(),
            machinesList: remoteMachines,
            agents: allAgents,
            subAgents: allSubAgents,
            activeSpaceId: activeSpace?.id || null,
            focusedTerminal,
            openWindowAddrs,
            gitBySpace,
            anomalies: view.director?.getState?.() || null,
            theme: t,
            platform: w.platform || "linux",
            handlers: cosmosHandlers,
          })
        )
    )
    // Minimal floating bottom-right corner whisper HUD (no full-width bar chrome!)
    .child(
      h_flex()
        .id("orrery-corner-hud")
        .absolute()
        .right(12)
        .bottom(10)
        .gap(5)
        .items_center()
        .bg(CLEAR)
        .when(blockedCount > 0, (bEl) =>
          bEl.child(
            h_flex()
              .id("orrery-hud-blocked")
              .flex_none()
              .px(8)
              .py(3)
              .items_center()
              .bg(withAlpha(t.blocked || "#f06449", "28"))
              .border_1()
              .border_color(withAlpha(t.blocked || "#f06449", "99"))
              .font_family(MONO)
              .text_size(10)
              .line_height("14px")
              .font_bold()
              .text_color(t.blocked || "#f06449")
              .cursor_pointer()
              .hover((st) => st.bg(withAlpha(t.blocked || "#f06449", "44")))
              .tooltip("Blocked agent needs attention — click to jump")
              .loop("opacity", { from: 0.45, to: 1.0, period: 750 })
              .on_mouse_down("left", stopProp)
              .on_click((_e, c) => {
                dismissPopups();
                focusNextBlocked(view);
                c.notify();
              })
              .child(`! ${blockedCount}`)
          )
        )
        .child(
          h_flex()
            .id("orrery-hud-zoom-group")
            .flex_none()
            .items_center()
            .bg(withAlpha(t.chrome || "#090d17", "A8"))
            .border_1()
            .border_color(
              isMoved
                ? withAlpha(t.done || "#5fd4b8", "66")
                : withAlpha(t.border || "#1f2b40", "AA")
            )
            .child(
              hudBtn(
                "orrery-hud-zoom-out",
                "−",
                `Zoom out cosmos (${w.platform === "macos" ? "Cmd+Shift+-" : "Alt+-"} or scroll)`,
                (_e, c) => {
                  dismissPopups();
                  applyCameraZoomAt(view, -96, Math.round(vpW / 2), Math.round(vpH / 2), c, 0, {
                    forceMode: "zoom",
                  });
                },
                {
                  px: 6,
                  bg: CLEAR,
                  color: zoom <= MIN_ZOOM + 0.005 ? t.dim || "#4d5870" : t.muted || "#8b93a6",
                }
              )
            )
            .child(
              hudBtn(
                "orrery-hud-zoom-reset",
                isMoved ? `${zoomPct}% · reset` : `${zoomPct}%`,
                isMoved
                  ? `Reset cosmos zoom & pan to 100% home (${w.platform === "macos" ? "Cmd+Shift+0" : "Alt+0"} or double-click space)`
                  : `Cosmos zoom 100% · click − / + or two-finger scroll empty space`,
                (_e, c) => {
                  dismissPopups();
                  if (isMoved) {
                    resetCameraHome(view, c);
                  }
                },
                {
                  px: 6,
                  bg: CLEAR,
                  color: isMoved ? t.done || "#5fd4b8" : t.dim || "#4d5870",
                }
              )
            )
            .child(
              hudBtn(
                "orrery-hud-zoom-in",
                "+",
                `Zoom in cosmos (${w.platform === "macos" ? "Cmd+Shift+=" : "Alt+="} or scroll)`,
                (_e, c) => {
                  dismissPopups();
                  applyCameraZoomAt(view, 96, Math.round(vpW / 2), Math.round(vpH / 2), c, 0, {
                    forceMode: "zoom",
                  });
                },
                {
                  px: 6,
                  bg: CLEAR,
                  color: zoom >= LIVE_ZOOM_MIN ? t.dim || "#4d5870" : t.muted || "#8b93a6",
                }
              )
            )
        )
        .when(remoteMachines.length > 0, (mEl) =>
          mEl.child(
            hudBtn(
              "orrery-hud-machines",
              `● ${connectedRemotes}/${remoteMachines.length} ssh`,
              remoteTooltip,
              (_e, c) => {
                dismissPopups();
                openToolWindow("fleet", vpW, vpH);
                c.notify();
              },
              { color: remoteStatusColor }
            )
          )
        )
        .when(openWinCount >= 2, (tEl) =>
          tEl.child(
            hudBtn(
              "orrery-hud-tile",
              "tile",
              "Tile open windows in view (Alt+T)",
              (_e, c) => {
                dismissPopups();
                tileAllOpenWindows(vpW, vpH);
                c.notify();
              }
            )
          )
        )
        .child(
          div()
            .id("orrery-hud-clock")
            .flex_none()
            .px(6)
            .py(3)
            .bg(withAlpha(t.chrome || "#090d17", "88"))
            .font_family(MONO)
            .text_size(10)
            .line_height("14px")
            .text_color(t.dim || "#4d5870")
            .whitespace_nowrap()
            .child(clockStr)
        )
        .when(Boolean(w.buttons), (wEl) =>
          wEl
            .child(hudBtn("orrery-win-min", "─", "Minimize app window", () => run("window.minimize")))
            .child(
              hudBtn(
                "orrery-win-max",
                w.maximized ? "❐" : "□",
                w.maximized ? "Restore app window" : "Maximize app window",
                () => run("window.maximize")
              )
            )
            .child(
              hudBtn("orrery-win-close", "×", "Close app window", () => run("window.close"), {
                size: 12,
                hoverBg: CLOSE_RED,
                hoverColor: "#ffffff",
              })
            )
        )
    )
    // Bulletproof Full-Screen Drag Capture Shield ABOVE cosmos during pan, note drag, or world-card drag
    .when(isDraggingAny, (el) =>
      el.child(
        div()
          .id("orrery-drag-shield")
          .absolute()
          .top(0)
          .left(0)
          .right(0)
          .bottom(0)
          .bg(CLEAR)
          .cursor_grabbing()
          .on_scroll_wheel((_e, c) => c.stop_propagation())
          .on_mouse_move((e, c) => handlePointerMove(e, c))
          .on_mouse_up("left", (e, c) => {
            c.stop_propagation();
            handlePointerUp(e, c);
          })
          .on_mouse_down("left", (e, c) => {
            c.stop_propagation();
            handlePointerUp(e, c);
          })
          .on_mouse_down("right", (_e, c) => {
            c.stop_propagation();
            cancelActiveDrag(view, c);
          })
      )
    );
}
