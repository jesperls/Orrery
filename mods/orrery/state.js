// Shared state, live layout-derived mode queries, floating live terminal & desktop
// app window manager, true automatic tiling engine, Show Desktop stash, urgency
// ordering, sub-agent grouping, git polling, and helpers for the Orrery Desktop Environment.
//
// Mode (`isFocusMode`) and `side-drawer` visibility are derived 100% live from
// `layout()` and NEVER persisted in `shared()`.

import {
  agents,
  closeOverlay,
  exec,
  focused,
  hc,
  knownAgents,
  layout,
  machines,
  openOverlay,
  panes,
  run,
  setAgentOrder,
  setShared,
  shared,
  spaces,
  terminals,
  theme,
} from "herdr";

export const MONO = "JetBrains Mono";
export const CLEAR = "#00000000";

export const GIT_KEY = "orrery.git";
export const MACHINES_KEY = "orrery.machines";
export const OPEN_WINS_KEY = "orrery.openWins";
export const OPEN_TOOLS_KEY = "orrery.openTools";
export const OPEN_NOTES_KEY = "orrery.openNotes";
export const VP_KEY = "orrery.vp";
export const DESKTOP_STASH_KEY = "orrery.desktopStash";
export const NOTES_KEY = "orrery.notes";
export const NOTES_LIST_KEY = "orrery.notesList";
export const MENU_BTN_KEY = "orrery.menuBtn";
export const LAUNCHER_POPUP_KEY = "orrery.launcherPopup";
export const CTX_POPUP_KEY = "orrery.ctxPopup";
export const PENDING_ACTION_KEY = "orrery.pendingAction";
export const CAM_RESET_KEY = "orrery.camReset";
export const CAM_KEY = "orrery.cam";
export const SPACE_POS_KEY = "orrery.spacePos";

export const MIN_ZOOM = 0.30;
export const MAX_ZOOM = 1.0;
export const LIVE_ZOOM_MIN = 0.995; // Native Herdr overlays mount ONLY at 100% so zoomed terminals NEVER SIGWINCH or jump font size!

const EDGE_PX = 5;

export const TOOL_META = {
  files: { id: "files", title: "Files", short: "Files", glyph: "F" },
  changes: { id: "changes", title: "Git Changes", short: "Changes", glyph: "G" },
  fleet: { id: "fleet", title: "Fleet Monitor", short: "Fleet", glyph: "M" },
};

export const TOOL_ORDER = ["files", "changes", "fleet"];

const DEFAULT_GIT = {
  spaceId: "",
  branch: "",
  dirtyCount: 0,
  commitSha: "",
  commitSubject: "",
  cwd: "",
  updatedAt: 0,
};

let localViewport = { w: 1600, h: 1000 };
let localWinGen = Date.now() * 1000;
let gitPollSeq = 0;
let machinesPollSeq = 0;

function nextWinGen() {
  localWinGen += 1;
  return localWinGen;
}

// In-memory timestamp tracker so every running agent shows elapsed time cleanly.
const agentSeenAt = new Map();
const agentStatusSig = new Map();

// --- Theme & Color Helpers ---

export function withAlpha(hex, aa) {
  if (typeof hex !== "string" || !hex.startsWith("#") || hex.length < 7) {
    return CLEAR;
  }
  return `${hex.slice(0, 7)}${aa}`;
}

export function statusColor(status, t) {
  if (status === "blocked") return t.blocked || "#f06449";
  if (status === "done") return t.done || "#5fd4b8";
  if (status === "working") return t.working || "#e8a849";
  return t.idle || t.dim || "#6f788c";
}

export function statusGlyph(status) {
  if (status === "blocked") return "!";
  if (status === "working") return "*";
  if (status === "done") return "o";
  return "·";
}

// --- Viewport Tracking ---

export function setViewportDims(w, h) {
  const rw = Math.max(480, Math.round(w || 0));
  const rh = Math.max(320, Math.round(h || 0));
  localViewport = { w: rw, h: rh };
  const prev = shared(VP_KEY);
  if (
    !prev ||
    typeof prev !== "object" ||
    Math.abs((prev.w || 0) - rw) >= 4 ||
    Math.abs((prev.h || 0) - rh) >= 4
  ) {
    setShared(VP_KEY, { w: rw, h: rh });
  }
}

export function getViewportDims() {
  const raw = shared(VP_KEY);
  if (raw && typeof raw === "object" && raw.w >= 480 && raw.h >= 320) {
    return { w: raw.w, h: raw.h };
  }
  return { ...localViewport };
}

// --- Always-On-Top Bottom-Left `≡` Corner Orb & `kind: "popup"` Overlays ---

const MENU_BTN_W = 36;
const MENU_BTN_H = 36;
const MENU_BTN_INSET = 12;

function readMenuBtnState() {
  const raw = shared(MENU_BTN_KEY);
  if (raw && typeof raw === "object") {
    return {
      overlayId: typeof raw.overlayId === "string" ? raw.overlayId : "",
      y: typeof raw.y === "number" ? raw.y : -1,
    };
  }
  return { overlayId: "", y: -1 };
}

export function hasMenuButton() {
  return Boolean(readMenuBtnState().overlayId);
}

export function closeMenuButton() {
  const cur = readMenuBtnState();
  if (cur.overlayId) {
    try {
      closeOverlay(cur.overlayId);
    } catch (_err) {
      // Ignore already-closed overlay
    }
  }
  if (cur.overlayId || cur.y !== -1) {
    setShared(MENU_BTN_KEY, { overlayId: "", y: -1 });
  }
}

export function clearMenuButtonIfMatch(overlayId) {
  if (!overlayId) return;
  const cur = readMenuBtnState();
  if (cur.overlayId === overlayId) {
    setShared(MENU_BTN_KEY, { overlayId: "", y: -1 });
  }
}

export function ensureMenuButtonOnTop(vpW, vpH) {
  if (isFocusMode()) {
    closeMenuButton();
    return null;
  }
  const vp = getViewportDims();
  const h = Math.max(320, Math.round(vpH || vp.h || 1000));
  const targetY = Math.max(8, h - MENU_BTN_H - MENU_BTN_INSET);

  const prev = readMenuBtnState();
  if (prev.overlayId) {
    try {
      closeOverlay(prev.overlayId);
    } catch (_err) {
      // Ignore already-closed overlay
    }
  }

  const overlayId = openOverlay({
    kind: "window",
    frame: "none",
    key: `orrery-menu-btn-${targetY}`,
    keep: false,
    width: MENU_BTN_W,
    height: MENU_BTN_H,
    at: { x: MENU_BTN_INSET, y: targetY },
    mod: "orrery",
    props: { role: "menubtn" },
  });

  if (overlayId) {
    setShared(MENU_BTN_KEY, { overlayId, y: targetY });
  } else if (prev.overlayId) {
    setShared(MENU_BTN_KEY, { overlayId: "", y: -1 });
  }
  return overlayId || null;
}

function readLauncherState() {
  const raw = shared(LAUNCHER_POPUP_KEY);
  if (raw && typeof raw === "object") {
    return {
      overlayId: typeof raw.overlayId === "string" ? raw.overlayId : "",
      closedAt: typeof raw.closedAt === "number" ? raw.closedAt : 0,
    };
  }
  if (typeof raw === "string") {
    return { overlayId: raw, closedAt: 0 };
  }
  return { overlayId: "", closedAt: 0 };
}

export function isLauncherOpen() {
  return Boolean(readLauncherState().overlayId);
}

export function closeLauncherPopup(recordDismiss = false) {
  const cur = readLauncherState();
  if (cur.overlayId) {
    try {
      closeOverlay(cur.overlayId);
    } catch (_err) {
      // Ignore already-closed overlay
    }
  }
  if (cur.overlayId || recordDismiss) {
    setShared(LAUNCHER_POPUP_KEY, {
      overlayId: "",
      closedAt: recordDismiss ? Date.now() : 0,
    });
  }
}

export function clearLauncherPopupIfMatch(overlayId) {
  if (!overlayId) return;
  const cur = readLauncherState();
  if (cur.overlayId === overlayId) {
    setShared(LAUNCHER_POPUP_KEY, { overlayId: "", closedAt: Date.now() });
  }
}

export function toggleLauncherPopup(vpW, vpH, opts = {}) {
  if (isFocusMode()) {
    closeLauncherPopup(false);
    return false;
  }
  const cur = readLauncherState();
  if (cur.overlayId) {
    closeLauncherPopup(false);
    return false;
  }
  // Guard against native click-outside dismiss immediately followed by button on_click
  if (opts.fromClick && cur.closedAt > 0 && Date.now() - cur.closedAt < 240) {
    setShared(LAUNCHER_POPUP_KEY, { overlayId: "", closedAt: 0 });
    return false;
  }

  closeContextPopup();

  const vp = getViewportDims();
  const w = Math.max(360, Math.round(vpW || vp.w || 1600));
  const h = Math.max(260, Math.round(vpH || vp.h || 1000));
  const popupW = Math.min(310, Math.max(220, w - 24));
  const popupH = Math.min(480, Math.max(180, h - 68));
  const atX = 12;
  const atY = Math.max(12, h - popupH - 56);

  const overlayId = openOverlay({
    kind: "popup",
    frame: "none",
    width: popupW,
    height: popupH,
    at: { x: atX, y: atY },
    mod: "orrery",
    props: { role: "launcher" },
  });

  if (overlayId) {
    setShared(LAUNCHER_POPUP_KEY, { overlayId, closedAt: 0 });
    return true;
  }
  return false;
}

export function closeContextPopup() {
  const prevId = shared(CTX_POPUP_KEY);
  if (typeof prevId === "string" && prevId) {
    try {
      closeOverlay(prevId);
    } catch (_err) {
      // Ignore already-closed overlay
    }
    setShared(CTX_POPUP_KEY, "");
  }
}

export function clearContextPopupIfMatch(overlayId) {
  if (!overlayId) return;
  if (shared(CTX_POPUP_KEY) === overlayId) {
    setShared(CTX_POPUP_KEY, "");
  }
}

export function openContextPopup(spec = {}) {
  closeLauncherPopup(false);
  closeContextPopup();

  const vp = getViewportDims();
  const vpW = Math.max(480, Math.round(spec.vpW || vp.w || 1600));
  const vpH = Math.max(320, Math.round(spec.vpH || vp.h || 1000));
  const kind = spec.kind || "desktop";
  const barH = 8;

  let width = 240;
  let estH = 320;

  if (kind === "space") {
    width = 276;
    const sp = (spaces() || []).find((s) => s.id === spec.spaceId);
    const tabCount = Math.min(6, (sp?.tabs || []).length);
    const hasClose = (spaces() || []).length > 1;
    estH = Math.min(vpH - barH - 20, 290 + tabCount * 28 + (hasClose ? 40 : 0));
  } else if (kind === "machine") {
    width = 272;
    estH = Math.min(vpH - barH - 20, 276);
  } else if (kind === "new-space") {
    width = 274;
    const remoteCount = readMachinesList().filter((m) => !m.isLocal).length;
    estH = Math.min(vpH - 24, 174 + remoteCount * 30);
  } else if (kind === "note") {
    width = 196;
    estH = 112;
  } else if (kind === "taskbar") {
    width = 224;
    estH = spec.targetKind === "terminal" ? 280 : spec.targetKind === "note" ? 182 : 146;
  } else {
    width = 258;
    const isMoved = Boolean(
      (spec.camX || 0) !== 0 || (spec.camY || 0) !== 0 || (spec.zoom && Math.abs(spec.zoom - 1) > 0.01)
    );
    estH = Math.min(vpH - 24, isMoved ? 426 : 394);
  }

  width = Math.min(width, Math.max(180, vpW - 16));
  estH = Math.min(estH, Math.max(96, vpH - 20));

  const rawX = Math.round(spec.x ?? vpW / 2);
  const rawY = Math.round(spec.y ?? vpH / 2);

  const clampedX = Math.max(8, Math.min(vpW - width - 8, rawX));
  const clampedY = Math.max(8, Math.min(vpH - barH - estH - 8, rawY));

  const overlayId = openOverlay({
    kind: "popup",
    frame: "none",
    width,
    height: estH,
    at: "pointer",
    mod: "orrery",
    props: {
      role: "ctxmenu",
      kind,
      spaceId: spec.spaceId || "",
      machineName: spec.machineName || "",
      noteId: spec.noteId || "",
      targetKind: spec.targetKind || "",
      targetId: spec.targetId || "",
      clickX: typeof spec.x === "number" ? Math.round(spec.x) : clampedX,
      clickY: typeof spec.y === "number" ? Math.round(spec.y) : clampedY,
      camX: typeof spec.camX === "number" ? Math.round(spec.camX) : 0,
      camY: typeof spec.camY === "number" ? Math.round(spec.camY) : 0,
      zoom: typeof spec.zoom === "number" ? spec.zoom : 1,
    },
  });

  if (overlayId) {
    setShared(CTX_POPUP_KEY, overlayId);
  }
  return overlayId || null;
}

// --- Cross-Overlay Cosmos Action Queue (coalesces rapid wheel ticks, survives popup dismissal!) ---

export function dispatchCosmosAction(action) {
  if (!action || typeof action !== "object" || !action.type) return;
  const now = Date.now();
  const prev = shared(PENDING_ACTION_KEY);
  const queue = Array.isArray(prev)
    ? prev.filter((item) => item && item.type && now - (item.ts || 0) < 5000)
    : prev && typeof prev === "object" && prev.type && now - (prev.ts || 0) < 5000
      ? [prev]
      : [];

  // Coalesce consecutive world-zoom wheel ticks so rapid scrolling never drops deltas
  const last = queue[queue.length - 1];
  if (action.type === "world-zoom" && last && last.type === "world-zoom") {
    queue[queue.length - 1] = {
      ...action,
      deltaY: (last.deltaY || 0) + (action.deltaY || 0),
      deltaX: (last.deltaX || 0) + (action.deltaX || 0),
      id: nextWinGen(),
      ts: now,
    };
  } else {
    queue.push({ ...action, id: nextWinGen(), ts: now });
  }
  setShared(PENDING_ACTION_KEY, queue.slice(-16));
  run("orrery.run-action");
}

export function drainPendingCosmosActions() {
  const raw = shared(PENDING_ACTION_KEY);
  const now = Date.now();
  const list = Array.isArray(raw)
    ? raw.filter((item) => item && item.type && now - (item.ts || 0) < 5000)
    : raw && typeof raw === "object" && raw.type && now - (raw.ts || 0) < 5000
      ? [raw]
      : [];
  if (raw !== null && raw !== undefined) {
    setShared(PENDING_ACTION_KEY, null);
  }
  return list;
}

export function requestResetView() {
  dispatchCosmosAction({ type: "reset-view" });
  const cur = shared(CAM_RESET_KEY);
  const next = (typeof cur === "number" && Number.isFinite(cur) ? cur : 0) + 1;
  setShared(CAM_RESET_KEY, next);
  return next;
}

export function readCamResetSeq() {
  const cur = shared(CAM_RESET_KEY);
  return typeof cur === "number" && Number.isFinite(cur) ? cur : 0;
}

export function clampZoom(z, snapToOne = true) {
  if (typeof z !== "number" || !Number.isFinite(z)) return 1.0;
  const clamped = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, z));
  if (snapToOne && Math.abs(clamped - 1.0) < 0.022) return 1.0;
  return Math.round(clamped * 1000) / 1000;
}

// Vast unified world-space cosmic bounds centered around home `[0..vpW, 0..vpH]`.
// Always generously larger than `vp / MIN_ZOOM` in every direction so zooming out to 30%
// never exposes past the bounds and panning far away + zooming back in never clips.
export function getWorldBounds(vpW, vpH) {
  const w = Math.max(640, Math.round(vpW || getViewportDims().w || 1600));
  const h = Math.max(420, Math.round(vpH || getViewportDims().h || 1000));
  const halfSpanX = Math.round(Math.max(w * 2.8, (w / MIN_ZOOM) * 0.85));
  const halfSpanY = Math.round(Math.max(h * 2.8, (h / MIN_ZOOM) * 0.85));
  const cx = w * 0.5;
  const cy = h * 0.5;
  return {
    minX: Math.round(cx - halfSpanX),
    maxX: Math.round(cx + halfSpanX),
    minY: Math.round(cy - halfSpanY),
    maxY: Math.round(cy + halfSpanY),
  };
}

// Clamp camera `(camX, camY, zoom)` strictly in world coordinates so the visible
// viewport `[-camX/z .. (vpW-camX)/z]` ALWAYS remains inside `getWorldBounds(vpW, vpH)`.
export function clampCameraToBounds(camX, camY, zoom, vpW, vpH, opts = {}) {
  const w = Math.max(480, vpW || getViewportDims().w || 1600);
  const h = Math.max(320, vpH || getViewportDims().h || 1000);
  const z = clampZoom(zoom, opts.snapToOne !== false);
  const b = getWorldBounds(w, h);
  const minCamX = w - b.maxX * z;
  const maxCamX = -b.minX * z;
  const minCamY = h - b.maxY * z;
  const maxCamY = -b.minY * z;
  const cx = Number.isFinite(camX) ? camX : 0;
  const cy = Number.isFinite(camY) ? camY : 0;
  return {
    camX:
      minCamX > maxCamX
        ? Math.round((minCamX + maxCamX) / 2)
        : Math.round(Math.max(minCamX, Math.min(maxCamX, cx))),
    camY:
      minCamY > maxCamY
        ? Math.round((minCamY + maxCamY) / 2)
        : Math.round(Math.max(minCamY, Math.min(maxCamY, cy))),
    zoom: z,
  };
}

export function readCamera() {
  const raw = shared(CAM_KEY);
  if (raw && typeof raw === "object") {
    return {
      camX: typeof raw.camX === "number" && Number.isFinite(raw.camX) ? Math.round(raw.camX) : 0,
      camY: typeof raw.camY === "number" && Number.isFinite(raw.camY) ? Math.round(raw.camY) : 0,
      zoom: clampZoom(typeof raw.zoom === "number" ? raw.zoom : 1.0),
    };
  }
  return { camX: 0, camY: 0, zoom: 1.0 };
}

export function writeCamera(camX, camY, zoom = 1.0) {
  const next = {
    camX: Math.round(Number.isFinite(camX) ? camX : 0),
    camY: Math.round(Number.isFinite(camY) ? camY : 0),
    zoom: clampZoom(zoom),
  };
  const prev = readCamera();
  if (prev.camX !== next.camX || prev.camY !== next.camY || Math.abs(prev.zoom - next.zoom) > 0.001) {
    setShared(CAM_KEY, next);
  }
  return next;
}

export function worldToScreen(wx, wy, cam = null) {
  const c = cam || readCamera();
  const z = c.zoom || 1.0;
  return {
    x: Math.round((wx || 0) * z + (c.camX || 0)),
    y: Math.round((wy || 0) * z + (c.camY || 0)),
  };
}

export function screenToWorld(sx, sy, cam = null) {
  const c = cam || readCamera();
  const z = c.zoom || 1.0;
  return {
    x: Math.round(((sx || 0) - (c.camX || 0)) / z),
    y: Math.round(((sy || 0) - (c.camY || 0)) / z),
  };
}

// --- Custom World Coordinates for Spaces (`orrery.spacePos`) ---

export function readSpacePositions() {
  const raw = shared(SPACE_POS_KEY);
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  const out = {};
  for (const [id, val] of Object.entries(raw)) {
    if (
      id &&
      val &&
      typeof val === "object" &&
      typeof val.x === "number" &&
      Number.isFinite(val.x) &&
      typeof val.y === "number" &&
      Number.isFinite(val.y)
    ) {
      out[id] = { x: Math.round(val.x), y: Math.round(val.y) };
    }
  }
  return out;
}

export function setSpaceWorldPos(spaceId, wx, wy) {
  if (!spaceId) return;
  const cur = readSpacePositions();
  cur[spaceId] = {
    x: Math.round(Number.isFinite(wx) ? wx : 320),
    y: Math.round(Number.isFinite(wy) ? wy : 320),
  };
  setShared(SPACE_POS_KEY, cur);
}

export function readNotes() {
  const raw = shared(NOTES_KEY);
  return typeof raw === "string" ? raw : "";
}

export function writeNotes(text) {
  setShared(NOTES_KEY, typeof text === "string" ? text : "");
}

// --- Physical Floating Scratchpad Note Objects (`orrery.notesList`) ---

function normalizeNoteItem(item, idx = 0) {
  if (!item || typeof item !== "object") return null;
  const id = typeof item.id === "string" && item.id.trim() ? item.id.trim() : `note-${idx + 1}`;
  return {
    id,
    text: typeof item.text === "string" ? item.text : "",
    x: typeof item.x === "number" && Number.isFinite(item.x) ? Math.round(item.x) : 260,
    y: typeof item.y === "number" && Number.isFinite(item.y) ? Math.round(item.y) : 240,
    updatedAt:
      typeof item.updatedAt === "number" && Number.isFinite(item.updatedAt)
        ? item.updatedAt
        : Date.now(),
  };
}

export function noteTitle(noteOrText, fallback = "Untitled Note") {
  const raw =
    typeof noteOrText === "string"
      ? noteOrText
      : noteOrText && typeof noteOrText.text === "string"
        ? noteOrText.text
        : "";
  const lines = raw.split(/\r?\n/);
  for (const line of lines) {
    const cleaned = line.replace(/^\s*(?:#+|>|[-*+]\s+\[[ xX]\]|[-*+])\s*/, "").trim();
    if (cleaned) {
      return cleaned.length > 26 ? `${cleaned.slice(0, 25)}~` : cleaned;
    }
  }
  return fallback;
}

export function readNotesList() {
  const raw = shared(NOTES_LIST_KEY);
  if (Array.isArray(raw)) {
    const out = [];
    const seen = new Set();
    for (let i = 0; i < raw.length; i++) {
      const n = normalizeNoteItem(raw[i], i);
      if (n && !seen.has(n.id)) {
        seen.add(n.id);
        out.push(n);
      }
    }
    return out;
  }

  // One-time clean auto-migration from legacy `shared("orrery.notes")` string
  const legacy = readNotes();
  if (legacy.trim().length > 0) {
    const migrated = [
      {
        id: "note-1",
        text: legacy,
        x: 260,
        y: 240,
        updatedAt: Date.now(),
      },
    ];
    setShared(NOTES_LIST_KEY, migrated);
    return migrated;
  }

  return [];
}

export function getNoteById(id) {
  if (!id) return null;
  return readNotesList().find((n) => n.id === id) || null;
}

export function createNoteObject({ x = 260, y = 240, text = "" } = {}) {
  const list = readNotesList();
  let maxNum = 0;
  for (const item of list) {
    const m = /^note-(\d+)$/.exec(item.id);
    if (m) maxNum = Math.max(maxNum, parseInt(m[1], 10) || 0);
  }
  const id = `note-${maxNum + 1}`;
  const note = {
    id,
    text: typeof text === "string" ? text : "",
    x: Math.round(Number.isFinite(x) ? x : 260),
    y: Math.round(Number.isFinite(y) ? y : 240),
    updatedAt: Date.now(),
  };
  setShared(NOTES_LIST_KEY, [...list, note]);
  return note;
}

export function updateNoteText(id, text) {
  if (!id) return null;
  const list = readNotesList();
  const str = typeof text === "string" ? text : "";
  let updated = null;
  const next = list.map((item) => {
    if (item.id !== id) return item;
    updated = { ...item, text: str, updatedAt: Date.now() };
    return updated;
  });
  if (updated) {
    setShared(NOTES_LIST_KEY, next);
  }
  return updated;
}

export function moveNoteObject(id, x, y) {
  if (!id) return null;
  const list = readNotesList();
  const b = getWorldBounds();
  const rx = Math.max(b.minX + 16, Math.min(b.maxX - 180, Math.round(Number.isFinite(x) ? x : 260)));
  const ry = Math.max(b.minY + 16, Math.min(b.maxY - 96, Math.round(Number.isFinite(y) ? y : 240)));
  let updated = null;
  const next = list.map((item) => {
    if (item.id !== id) return item;
    updated = { ...item, x: rx, y: ry, updatedAt: Date.now() };
    return updated;
  });
  if (updated) {
    setShared(NOTES_LIST_KEY, next);
  }
  return updated;
}

export function deleteNoteObject(id, overlayId = null) {
  if (!id) return false;
  closeNoteWindow(id, overlayId);
  const list = readNotesList();
  const next = list.filter((item) => item.id !== id);
  if (next.length !== list.length) {
    setShared(NOTES_LIST_KEY, next);
    return true;
  }
  return false;
}

// --- Git Shared Info ---

export function readGitInfo() {
  const raw = shared(GIT_KEY);
  if (!raw || typeof raw !== "object") return { ...DEFAULT_GIT };
  return { ...DEFAULT_GIT, ...raw };
}

export function buildGitBySpace(allSpaces, gitInfo) {
  const bySpace = {};
  const gi = gitInfo || readGitInfo();
  if (!gi || !gi.spaceId) return bySpace;
  const sp = (allSpaces || []).find((s) => s && s.id === gi.spaceId);
  if (!sp) return bySpace;
  bySpace[gi.spaceId] = {
    branch: gi.branch || sp.branch || "",
    dirtyCount: gi.dirtyCount || 0,
    commitSha: gi.commitSha || "",
    commitSubject: gi.commitSubject || "",
  };
  return bySpace;
}

// --- Live Layout Tree Inspection (Never Persisted) ---

export function findLayoutNode(node, targetId) {
  if (!node || typeof node !== "object") return null;
  if (node.id === targetId) return node;
  if (Array.isArray(node.children)) {
    for (const ch of node.children) {
      const found = findLayoutNode(ch, targetId);
      if (found) return found;
    }
  }
  return null;
}

export function isFocusMode() {
  const root = findLayoutNode(layout(), "root") || layout();
  return root?.active === "focus";
}

export function activeSideDrawer() {
  const node = findLayoutNode(layout(), "side-drawer");
  if (!node || node.hidden) return null;
  if (node.active === "side-changes") return "changes";
  if (node.active === "side-files") return "files";
  return null;
}

export function toggleSideDrawer(childId) {
  const node = findLayoutNode(layout(), "side-drawer");
  const hidden = Boolean(node?.hidden);
  const active = node?.active || "side-files";
  if (!hidden && active === childId) {
    run("layout.hide", { id: "side-drawer" });
  } else {
    run("layout.select", { stack: "side-drawer", child: childId });
    if (hidden) {
      run("layout.show", { id: "side-drawer" });
    }
  }
}

// --- Floating Terminal & Desktop App Window Manager (True World-Space Objects) ---

function clampWinScale(s) {
  if (typeof s !== "number" || !Number.isFinite(s)) return 1.0;
  const c = Math.max(0.55, Math.min(1.6, s));
  return Math.abs(c - 1.0) < 0.03 ? 1.0 : Math.round(c * 100) / 100;
}

function normalizeOpenWinEntry(val) {
  if (!val) return null;
  if (typeof val === "string") {
    return {
      overlayId: val,
      tileMode: "right",
      key: "",
      width: 900,
      height: 640,
      baseW: 900,
      baseH: 640,
      scale: 1.0,
      x: 40,
      y: 16,
      wx: 40,
      wy: 16,
      suspended: false,
    };
  }
  if (typeof val === "object" && (val.overlayId || val.suspended)) {
    const overlayId = typeof val.overlayId === "string" ? val.overlayId : "";
    const width = typeof val.width === "number" && val.width > 0 ? Math.round(val.width) : 900;
    const height = typeof val.height === "number" && val.height > 0 ? Math.round(val.height) : 640;
    const scale = clampWinScale(typeof val.scale === "number" ? val.scale : 1.0);
    const baseW =
      typeof val.baseW === "number" && val.baseW > 0 ? Math.round(val.baseW) : Math.round(width / scale);
    const baseH =
      typeof val.baseH === "number" && val.baseH > 0 ? Math.round(val.baseH) : Math.round(height / scale);
    const x = typeof val.x === "number" && Number.isFinite(val.x) ? Math.round(val.x) : 40;
    const y = typeof val.y === "number" && Number.isFinite(val.y) ? Math.round(val.y) : 16;
    const wx = typeof val.wx === "number" && Number.isFinite(val.wx) ? Math.round(val.wx) : x;
    const wy = typeof val.wy === "number" && Number.isFinite(val.wy) ? Math.round(val.wy) : y;
    return {
      overlayId,
      tileMode: typeof val.tileMode === "string" ? val.tileMode : "right",
      key: typeof val.key === "string" ? val.key : "",
      width,
      height,
      screenW: typeof val.screenW === "number" && val.screenW > 0 ? Math.round(val.screenW) : width,
      screenH: typeof val.screenH === "number" && val.screenH > 0 ? Math.round(val.screenH) : height,
      baseW,
      baseH,
      scale,
      x,
      y,
      wx,
      wy,
      suspended: Boolean(val.suspended) || !overlayId,
    };
  }
  return null;
}

function normalizeToolEntry(val) {
  if (!val) return null;
  if (typeof val === "string") {
    return {
      overlayId: val,
      key: "",
      width: 440,
      height: 600,
      baseW: 440,
      baseH: 600,
      scale: 1.0,
      x: 24,
      y: 32,
      wx: 24,
      wy: 32,
      minimized: false,
      suspended: false,
    };
  }
  if (typeof val === "object") {
    const overlayId = typeof val.overlayId === "string" ? val.overlayId : "";
    const suspended = Boolean(val.suspended);
    const minimized = Boolean(val.minimized) || (!overlayId && !suspended);
    const width = typeof val.width === "number" && val.width > 0 ? Math.round(val.width) : 440;
    const height = typeof val.height === "number" && val.height > 0 ? Math.round(val.height) : 600;
    const scale = clampWinScale(typeof val.scale === "number" ? val.scale : 1.0);
    const baseW =
      typeof val.baseW === "number" && val.baseW > 0 ? Math.round(val.baseW) : Math.round(width / scale);
    const baseH =
      typeof val.baseH === "number" && val.baseH > 0 ? Math.round(val.baseH) : Math.round(height / scale);
    const x = typeof val.x === "number" && Number.isFinite(val.x) ? Math.round(val.x) : 24;
    const y = typeof val.y === "number" && Number.isFinite(val.y) ? Math.round(val.y) : 32;
    const wx = typeof val.wx === "number" && Number.isFinite(val.wx) ? Math.round(val.wx) : x;
    const wy = typeof val.wy === "number" && Number.isFinite(val.wy) ? Math.round(val.wy) : y;
    return {
      overlayId,
      key: typeof val.key === "string" ? val.key : "",
      width,
      height,
      screenW: typeof val.screenW === "number" && val.screenW > 0 ? Math.round(val.screenW) : width,
      screenH: typeof val.screenH === "number" && val.screenH > 0 ? Math.round(val.screenH) : height,
      baseW,
      baseH,
      scale,
      x,
      y,
      wx,
      wy,
      minimized,
      suspended: suspended && !minimized,
    };
  }
  return null;
}

export function normalizeToolKind(kind) {
  if (kind === "changes" || kind === "fleet") return kind;
  return "files";
}

function normalizeNoteWinEntry(val) {
  if (!val) return null;
  if (typeof val === "string") {
    return {
      overlayId: val,
      key: "",
      width: 440,
      height: 340,
      baseW: 440,
      baseH: 340,
      scale: 1.0,
      x: 240,
      y: 120,
      wx: 240,
      wy: 120,
      minimized: false,
      suspended: false,
    };
  }
  if (typeof val === "object") {
    const overlayId = typeof val.overlayId === "string" ? val.overlayId : "";
    const suspended = Boolean(val.suspended);
    const minimized = Boolean(val.minimized) || (!overlayId && !suspended);
    const width = typeof val.width === "number" && val.width > 0 ? Math.round(val.width) : 440;
    const height = typeof val.height === "number" && val.height > 0 ? Math.round(val.height) : 340;
    const scale = clampWinScale(typeof val.scale === "number" ? val.scale : 1.0);
    const baseW =
      typeof val.baseW === "number" && val.baseW > 0 ? Math.round(val.baseW) : Math.round(width / scale);
    const baseH =
      typeof val.baseH === "number" && val.baseH > 0 ? Math.round(val.baseH) : Math.round(height / scale);
    const x = typeof val.x === "number" && Number.isFinite(val.x) ? Math.round(val.x) : 240;
    const y = typeof val.y === "number" && Number.isFinite(val.y) ? Math.round(val.y) : 120;
    const wx = typeof val.wx === "number" && Number.isFinite(val.wx) ? Math.round(val.wx) : x;
    const wy = typeof val.wy === "number" && Number.isFinite(val.wy) ? Math.round(val.wy) : y;
    return {
      overlayId,
      key: typeof val.key === "string" ? val.key : "",
      width,
      height,
      screenW: typeof val.screenW === "number" && val.screenW > 0 ? Math.round(val.screenW) : width,
      screenH: typeof val.screenH === "number" && val.screenH > 0 ? Math.round(val.screenH) : height,
      baseW,
      baseH,
      scale,
      x,
      y,
      wx,
      wy,
      minimized,
      suspended: suspended && !minimized,
    };
  }
  return null;
}

export function readOpenNotes() {
  const raw = shared(OPEN_NOTES_KEY);
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  const existingIds = new Set(readNotesList().map((n) => n.id));
  const out = {};
  for (const [noteId, val] of Object.entries(raw)) {
    if (!existingIds.has(noteId)) continue;
    const entry = normalizeNoteWinEntry(val);
    if (entry) out[noteId] = entry;
  }
  return out;
}

export function isNoteVisible(noteId, notesMap = null) {
  if (!noteId) return false;
  const openNotes = notesMap || readOpenNotes();
  const entry = openNotes[noteId];
  return Boolean(entry && !entry.minimized && (entry.overlayId || entry.suspended));
}

export function getWindowDimensions(winKind, targetId, fallbackW = 600, fallbackH = 400) {
  const cam = readCamera();
  const z = cam.zoom || 1.0;
  if (winKind === "terminal" && targetId) {
    const rec = readOpenWins()[targetId];
    if (rec && rec.width > 0 && rec.height > 0) {
      return {
        width: Math.max(220, Math.round(rec.width * z)),
        height: Math.max(140, Math.round(rec.height * z)),
        rec,
      };
    }
  } else if (winKind === "tool" && targetId) {
    const rec = readOpenTools()[normalizeToolKind(targetId)];
    if (rec && rec.width > 0 && rec.height > 0) {
      return {
        width: Math.max(220, Math.round(rec.width * z)),
        height: Math.max(140, Math.round(rec.height * z)),
        rec,
      };
    }
  } else if (winKind === "note" && targetId) {
    const rec = readOpenNotes()[targetId];
    if (rec && rec.width > 0 && rec.height > 0) {
      return {
        width: Math.max(200, Math.round(rec.width * z)),
        height: Math.max(130, Math.round(rec.height * z)),
        rec,
      };
    }
  }
  return {
    width: Math.max(220, Math.round(fallbackW || 600)),
    height: Math.max(140, Math.round(fallbackH || 400)),
    rec: null,
  };
}

export function getWindowScale(winKind, targetId) {
  if (winKind === "terminal" && targetId) {
    return readOpenWins()[targetId]?.scale ?? 1.0;
  }
  if (winKind === "tool" && targetId) {
    return readOpenTools()[normalizeToolKind(targetId)]?.scale ?? 1.0;
  }
  if (winKind === "note" && targetId) {
    return readOpenNotes()[targetId]?.scale ?? 1.0;
  }
  return 1.0;
}

function buildFramedWindowLayout({
  borderColor = "border",
  isFocused = false,
  background = "background",
  titleH = 28,
  titleProps,
  bodyContent,
  winKind,
  targetId,
  winKey,
  width,
  height,
}) {
  const edgeMeta = { winKind, targetId, winKey, width, height };
  const resolvedBorder = isFocused ? "accent" : borderColor;
  return {
    type: "column",
    border: { width: 1, color: resolvedBorder },
    background,
    resizable: false,
    children: [
      {
        type: "block",
        size: { px: EDGE_PX },
        content: { mod: "orrery", props: { role: "edge", side: "top", ...edgeMeta } },
      },
      {
        type: "row",
        size: { weight: 1 },
        resizable: false,
        children: [
          {
            type: "block",
            size: { px: EDGE_PX },
            content: { mod: "orrery", props: { role: "edge", side: "left", ...edgeMeta } },
          },
          {
            type: "column",
            size: { weight: 1 },
            resizable: false,
            children: [
              {
                type: "block",
                size: { px: titleH },
                content: { mod: "orrery", props: titleProps },
              },
              {
                type: "block",
                size: { weight: 1 },
                content: bodyContent,
              },
            ],
          },
          {
            type: "block",
            size: { px: EDGE_PX },
            content: { mod: "orrery", props: { role: "edge", side: "right", ...edgeMeta } },
          },
        ],
      },
      {
        type: "block",
        size: { px: EDGE_PX },
        content: { mod: "orrery", props: { role: "edge", side: "bottom", ...edgeMeta } },
      },
    ],
  };
}

export function readOpenWins() {
  const raw = shared(OPEN_WINS_KEY);
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  const out = {};
  for (const [addr, val] of Object.entries(raw)) {
    const entry = normalizeOpenWinEntry(val);
    if (addr && entry) out[addr] = entry;
  }
  return out;
}

export function readOpenTools() {
  const raw = shared(OPEN_TOOLS_KEY);
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  const out = {};
  for (const [kind, val] of Object.entries(raw)) {
    const entry = normalizeToolEntry(val);
    if (kind in TOOL_META && entry) out[kind] = entry;
  }
  return out;
}

export function isToolVisible(kind, toolsMap = null) {
  const tool = normalizeToolKind(kind);
  const tools = toolsMap || readOpenTools();
  const entry = tools[tool];
  return Boolean(entry && !entry.minimized && (entry.overlayId || entry.suspended));
}

export function getOpenWindowAddrSet() {
  return new Set(Object.keys(readOpenWins()));
}

function getLoadingMachineSet() {
  const set = new Set();
  for (const m of machines() || []) {
    if (m && m.layout === "loading") {
      set.add(m.name || "");
    }
  }
  return set;
}

export function pruneOpenWindows() {
  const current = readOpenWins();
  const keys = Object.keys(current);
  if (keys.length === 0) return current;

  const loadingMachines = getLoadingMachineSet();
  const liveAddrs = new Set();
  for (const tm of terminals() || []) {
    if (tm?.address) liveAddrs.add(tm.address);
  }
  for (const ag of agents() || []) {
    if (ag?.address) liveAddrs.add(ag.address);
  }
  for (const pn of panes() || []) {
    if (pn?.terminal) liveAddrs.add(pn.terminal);
  }

  let changed = false;
  const next = {};
  for (const addr of keys) {
    const mach = terminalMachineOf(addr);
    // Keep terminals belonging to machines still loading at startup
    if (loadingMachines.has(mach) || liveAddrs.has(addr)) {
      next[addr] = current[addr];
    } else {
      changed = true;
    }
  }
  if (changed) {
    setShared(OPEN_WINS_KEY, next);
  }
  return next;
}

export function pruneDeadState() {
  const loadingMachines = getLoadingMachineSet();

  // 1. Prune closed spaces from SPACE_POS_KEY (skipping loading machines)
  const spPos = readSpacePositions();
  const spIds = Object.keys(spPos);
  if (spIds.length > 0) {
    const liveSpaces = new Set((spaces() || []).map((s) => s?.id).filter(Boolean));
    let spChanged = false;
    const nextPos = {};
    for (const id of spIds) {
      const mach = terminalMachineOf(id);
      if (loadingMachines.has(mach) || liveSpaces.has(id)) {
        nextPos[id] = spPos[id];
      } else {
        spChanged = true;
      }
    }
    if (spChanged) setShared(SPACE_POS_KEY, nextPos);
  }

  // 2. Prune deleted notes from OPEN_NOTES_KEY
  const rawOpenNotes = shared(OPEN_NOTES_KEY);
  if (rawOpenNotes && typeof rawOpenNotes === "object" && !Array.isArray(rawOpenNotes)) {
    const validIds = new Set(readNotesList().map((n) => n.id));
    let notesChanged = false;
    const nextNotes = {};
    for (const [id, val] of Object.entries(rawOpenNotes)) {
      if (validIds.has(id)) {
        nextNotes[id] = val;
      } else {
        notesChanged = true;
      }
    }
    if (notesChanged) setShared(OPEN_NOTES_KEY, nextNotes);
  }

  // 3. Prune dead agents from module-scope elapsed maps
  const liveAgentAddrs = new Set((agents() || []).map((a) => a?.address).filter(Boolean));
  for (const addr of agentSeenAt.keys()) {
    if (!liveAgentAddrs.has(addr)) agentSeenAt.delete(addr);
  }
  for (const addr of agentStatusSig.keys()) {
    if (!liveAgentAddrs.has(addr)) agentStatusSig.delete(addr);
  }
}

export function clearWindowOverlayIfMatch(winKind, targetId, overlayId) {
  if (!overlayId || !targetId) return;
  if (winKind === "terminal") {
    const wins = readOpenWins();
    if (wins[targetId]?.overlayId === overlayId) {
      // Check if terminal still exists; if exited, drop entry, else mark suspended
      const stillAlive =
        (terminals() || []).some((t) => t?.address === targetId) ||
        (panes() || []).some((p) => p?.terminal === targetId);
      if (stillAlive) {
        wins[targetId] = { ...wins[targetId], overlayId: "", suspended: true };
      } else {
        delete wins[targetId];
      }
      setShared(OPEN_WINS_KEY, wins);
    }
  } else if (winKind === "tool") {
    const tool = normalizeToolKind(targetId);
    const tools = readOpenTools();
    if (tools[tool]?.overlayId === overlayId) {
      tools[tool] = { ...tools[tool], overlayId: "", suspended: true };
      setShared(OPEN_TOOLS_KEY, tools);
    }
  } else if (winKind === "note") {
    const notes = readOpenNotes();
    if (notes[targetId]?.overlayId === overlayId) {
      notes[targetId] = { ...notes[targetId], overlayId: "", suspended: true };
      setShared(OPEN_NOTES_KEY, notes);
    }
  }
}

// Reconcile persisted shared() overlay IDs once on fresh universe mount (restart / layout switch)
export function reconcileOverlaysOnMount(vpW, vpH, cam) {
  if (isFocusMode()) return;
  setShared(MENU_BTN_KEY, { overlayId: "", y: -1 });
  setShared(LAUNCHER_POPUP_KEY, { overlayId: "", closedAt: 0 });
  setShared(CTX_POPUP_KEY, "");

  const wins = pruneOpenWindows();
  let winsChanged = false;
  for (const [addr, rec] of Object.entries(wins)) {
    if (rec?.overlayId) {
      wins[addr] = { ...rec, overlayId: "", suspended: true };
      winsChanged = true;
    }
  }
  if (winsChanged) setShared(OPEN_WINS_KEY, wins);

  const tools = readOpenTools();
  let toolsChanged = false;
  for (const [kind, rec] of Object.entries(tools)) {
    if (rec?.overlayId) {
      tools[kind] = { ...rec, overlayId: "", suspended: !rec.minimized };
      toolsChanged = true;
    }
  }
  if (toolsChanged) setShared(OPEN_TOOLS_KEY, tools);

  const notes = readOpenNotes();
  let notesChanged = false;
  for (const [nid, rec] of Object.entries(notes)) {
    if (rec?.overlayId) {
      notes[nid] = { ...rec, overlayId: "", suspended: !rec.minimized };
      notesChanged = true;
    }
  }
  if (notesChanged) setShared(OPEN_NOTES_KEY, notes);

  pruneDeadState();
  syncLiveOverlaysToCamera(cam, vpW, vpH);
  ensureMenuButtonOnTop(vpW, vpH);
}

function clampWindowRect(x, y, width, height, vpW, vpH, minW = 280, minH = 200) {
  const maxW = Math.max(minW, vpW - 16);
  const maxH = Math.max(minH, vpH - 16);
  const cw = Math.max(minW, Math.min(maxW, Math.round(width)));
  const ch = Math.max(minH, Math.min(maxH, Math.round(height)));
  const maxX = Math.max(8, vpW - cw - 8);
  const maxY = Math.max(8, vpH - ch - 8);
  const cx = Math.max(8, Math.min(maxX, Math.round(x)));
  const cy = Math.max(8, Math.min(maxY, Math.round(y)));
  return { x: cx, y: cy, width: cw, height: ch };
}

export function computeTileGeometry(tile, vpW, vpH, custom = null) {
  const w = Math.max(640, Math.round(vpW || getViewportDims().w || 1600));
  const h = Math.max(420, Math.round(vpH || getViewportDims().h || 1000));
  const margin = 16;
  const gap = 12;
  const fullH = Math.max(260, h - 32);

  if (
    custom &&
    typeof custom.width === "number" &&
    typeof custom.height === "number" &&
    typeof custom.x === "number" &&
    typeof custom.y === "number"
  ) {
    const rect = clampWindowRect(custom.x, custom.y, custom.width, custom.height, w, h, 300, 200);
    return {
      tileMode: tile || "custom",
      ...rect,
    };
  }

  if (tile === "left") {
    const availW = w - margin * 2 - gap;
    const rect = clampWindowRect(margin, margin, Math.max(360, Math.floor(availW / 2)), fullH, w, h, 300, 200);
    return { tileMode: "left", ...rect };
  }

  if (tile === "right-half") {
    const availW = w - margin * 2 - gap;
    const leftW = Math.floor(availW / 2);
    const rect = clampWindowRect(margin + leftW + gap, margin, Math.max(360, availW - leftW), fullH, w, h, 300, 200);
    return { tileMode: "right-half", ...rect };
  }

  if (tile === "center") {
    const rect = clampWindowRect(
      Math.round(w * 0.16),
      20,
      Math.max(440, Math.round(w * 0.68)),
      Math.max(260, h - 44),
      w,
      h,
      300,
      200
    );
    return { tileMode: "center", ...rect };
  }

  // Default single-window "right": sleek spacious viewport leaving left cosmos planetoids open.
  const rect = clampWindowRect(
    Math.round(w * 0.42),
    margin,
    Math.max(400, Math.round(w * 0.565)),
    fullH,
    w,
    h,
    300,
    200
  );
  return { tileMode: "right", ...rect };
}

function computeCascadeGeometry(openCount, vpW, vpH) {
  const w = Math.max(640, Math.round(vpW || getViewportDims().w || 1600));
  const h = Math.max(420, Math.round(vpH || getViewportDims().h || 1000));

  // 1st open terminal: comfortable spacious spot on the right, leaving planetoids wide open on the left.
  if (openCount === 0) {
    const winW = Math.min(1240, Math.max(420, Math.round(w * 0.50)));
    const winH = Math.min(920, Math.max(300, Math.round(h * 0.80)));
    const rect = clampWindowRect(
      Math.max(24, w - winW - 24),
      Math.max(16, Math.round((h - winH) * 0.35)),
      winW,
      winH,
      w,
      h,
      300,
      200
    );
    return { tileMode: "right", ...rect };
  }

  // Subsequent terminals: clean, comfortably-sized spatial window without overtaking the whole screen.
  const offset = (openCount % 6) * 32;
  const baseW = Math.min(1020, Math.max(420, Math.round(w * 0.44)));
  const baseH = Math.min(760, Math.max(280, Math.round(h * 0.62)));
  const rawX = Math.round((w - baseW) * 0.5) + offset;
  const rawY = Math.max(24, Math.round((h - baseH) * 0.42)) + offset;
  const rect = clampWindowRect(rawX, rawY, baseW, baseH, w, h, 300, 200);
  return { tileMode: "cascade", ...rect };
}

function openTerminalWindowDirect(addr, opts = {}) {
  if (!addr || isFocusMode()) return null;

  const vp = getViewportDims();
  const vpW = opts.vpW || vp.w;
  const vpH = opts.vpH || vp.h;
  const cam = opts.cam || readCamera();
  const z = cam.zoom || 1.0;

  const openWins = readOpenWins();
  const prev = openWins[addr] || null;
  const hasExplicitRect =
    typeof opts.width === "number" &&
    typeof opts.height === "number" &&
    (typeof opts.x === "number" || typeof opts.at?.x === "number") &&
    (typeof opts.y === "number" || typeof opts.at?.y === "number");
  const hasExplicitWorldPos = typeof opts.wx === "number" && typeof opts.wy === "number";

  const forceMove = Boolean(opts.forceMove || opts.tile || hasExplicitRect || opts.at || prev?.suspended);
  let rawX = 0;
  let rawY = 0;
  let geom;
  if (hasExplicitRect) {
    rawX = typeof opts.x === "number" ? opts.x : opts.at.x;
    rawY = typeof opts.y === "number" ? opts.y : opts.at.y;
    const rect = clampWindowRect(rawX, rawY, opts.width, opts.height, vpW, vpH, 220, 140);
    geom = { tileMode: opts.tile || "custom", ...rect };
  } else if (opts.tile) {
    geom = computeTileGeometry(opts.tile, vpW, vpH, null);
    rawX = geom.x;
    rawY = geom.y;
  } else if (prev && !opts.at) {
    const projX = Math.round(prev.wx * z + cam.camX);
    const projY = Math.round(prev.wy * z + cam.camY);
    const projW = Math.max(220, Math.round(prev.width * z));
    const projH = Math.max(140, Math.round(prev.height * z));
    // Never teleport an already-placed window out of another sector onto the current screen!
    if (!fitsCleanlyInView(projX, projY, projW, projH, vpW, vpH) && !opts.allowTeleport) {
      if (!opts.skipFocus) {
        run("pane.focus", { terminal: addr });
      }
      return prev.overlayId || null;
    }
    rawX = projX;
    rawY = projY;
    const rect = clampWindowRect(projX, projY, projW, projH, vpW, vpH, 220, 140);
    geom = { tileMode: prev.tileMode || "custom", ...rect };
  } else {
    const openCount = Object.keys(openWins).length;
    const base = computeCascadeGeometry(openCount, vpW, vpH);
    const projW = Math.max(220, Math.round((opts.worldW || base.width) * z));
    const projH = Math.max(140, Math.round((opts.worldH || base.height) * z));
    rawX = hasExplicitWorldPos ? Math.round(opts.wx * z + cam.camX) : base.x;
    rawY = hasExplicitWorldPos ? Math.round(opts.wy * z + cam.camY) : base.y;
    const rect = clampWindowRect(rawX, rawY, projW, projH, vpW, vpH, 220, 140);
    geom = { tileMode: hasExplicitWorldPos ? "custom" : base.tileMode, ...rect };
  }

  const clamped =
    opts.at && !hasExplicitRect
      ? clampWindowRect(opts.at.x, opts.at.y, geom.width, geom.height, vpW, vpH, 220, 140)
      : geom;
  const at = { x: clamped.x, y: clamped.y };
  const winW = clamped.width;
  const winH = clamped.height;

  // Preserve opts.wx/wy ONLY when screen position wasn't altered by clampWindowRect
  const worldPos = screenToWorld(at.x, at.y, { camX: cam.camX, camY: cam.camY, zoom: z });
  const wasClamped = Math.abs(at.x - Math.round(rawX)) > 2 || Math.abs(at.y - Math.round(rawY)) > 2;
  const wx = hasExplicitRect && hasExplicitWorldPos && !wasClamped ? Math.round(opts.wx) : worldPos.x;
  const wy = hasExplicitRect && hasExplicitWorldPos && !wasClamped ? Math.round(opts.wy) : worldPos.y;
  const worldW =
    typeof opts.worldW === "number"
      ? Math.round(opts.worldW)
      : prev && z < LIVE_ZOOM_MIN
        ? prev.width
        : Math.max(280, Math.round(winW / z));
  const worldH =
    typeof opts.worldH === "number"
      ? Math.round(opts.worldH)
      : prev && z < LIVE_ZOOM_MIN
        ? prev.height
        : Math.max(180, Math.round(winH / z));
  const isTileSnap = Boolean(opts.tile && opts.tile !== "custom");
  const scale = clampWinScale(
    isTileSnap ? 1.0 : typeof opts.scale === "number" ? opts.scale : prev?.scale ?? 1.0
  );
  const baseW =
    typeof opts.baseW === "number"
      ? Math.round(opts.baseW)
      : opts.resetBase || isTileSnap
        ? worldW
        : prev?.baseW || Math.round(worldW / scale);
  const baseH =
    typeof opts.baseH === "number"
      ? Math.round(opts.baseH)
      : opts.resetBase || isTileSnap
        ? worldH
        : prev?.baseH || Math.round(worldH / scale);

  let overlayKey = prev?.key || `orrery-term-${addr}`;
  if (forceMove || !prev || !prev.overlayId) {
    const prevId = prev?.overlayId || opts.overlayId || null;
    if (prevId) {
      try {
        closeOverlay(prevId);
      } catch (_err) {
        // Ignore already-closed overlay
      }
    }
    overlayKey = `orrery-term-${addr}-${nextWinGen()}`;
  }

  const isFocusedTerm = Boolean(
    typeof opts.isFocused === "boolean"
      ? opts.isFocused
      : !opts.skipFocus || focused()?.terminal === addr
  );

  // When zoomed out below 100%, NEVER mount an unscalable 14px native overlay (which triggers
  // SIGWINCH and explodes font size); place the terminal cleanly in world space as a scaled
  // interactive window card instead!
  if (z < LIVE_ZOOM_MIN && !opts.forceNativeOverlay) {
    openWins[addr] = {
      overlayId: "",
      tileMode: geom.tileMode,
      key: overlayKey,
      width: worldW,
      height: worldH,
      screenW: Math.round(worldW * z),
      screenH: Math.round(worldH * z),
      baseW,
      baseH,
      scale,
      x: Math.round(wx * z + cam.camX),
      y: Math.round(wy * z + cam.camY),
      wx,
      wy,
      suspended: true,
    };
    setShared(OPEN_WINS_KEY, openWins);
    if (!opts.skipFocus) {
      run("pane.focus", { terminal: addr });
    }
    return null;
  }

  const overlayId = openOverlay({
    kind: "window",
    frame: "none",
    key: overlayKey,
    keep: false,
    width: winW,
    height: winH,
    at,
    layout: buildFramedWindowLayout({
      borderColor: "border",
      isFocused: isFocusedTerm,
      background: "background",
      titleH: 30,
      titleProps: { role: "winbar", terminal: addr, tileMode: geom.tileMode },
      bodyContent: { terminal: addr },
      winKind: "terminal",
      targetId: addr,
      winKey: overlayKey,
      width: winW,
      height: winH,
    }),
  });

  if (overlayId) {
    openWins[addr] = {
      overlayId,
      tileMode: geom.tileMode,
      key: overlayKey,
      width: worldW,
      height: worldH,
      screenW: winW,
      screenH: winH,
      baseW,
      baseH,
      scale,
      x: at.x,
      y: at.y,
      wx,
      wy,
      suspended: false,
    };
    setShared(OPEN_WINS_KEY, openWins);
  } else if (prev?.overlayId) {
    openWins[addr] = { ...prev, overlayId: "", suspended: true };
    setShared(OPEN_WINS_KEY, openWins);
  }

  if (!opts.skipFocus) {
    run("pane.focus", { terminal: addr });
  }
  if (!opts.skipMenuRaise) {
    ensureMenuButtonOnTop(vpW, vpH);
  }
  return overlayId;
}

export function openTerminalWindow(addr, opts = {}) {
  if (!addr) return null;
  pruneOpenWindows();
  return openTerminalWindowDirect(addr, opts);
}

export function tileAllOpenWindows(vpW, vpH, opts = {}) {
  if (isFocusMode()) return 0;
  const openWins = pruneOpenWindows();
  const liveTerms = new Set((terminals() || []).map((tm) => tm?.address).filter(Boolean));
  const ordered = Object.keys(openWins).filter((addr) => liveTerms.size === 0 || liveTerms.has(addr));

  for (const extra of opts.extraAddrs || []) {
    if (extra && !ordered.includes(extra)) {
      ordered.push(extra);
    }
  }

  if (ordered.length === 0) return 0;

  const vp = getViewportDims();
  const w = Math.max(640, Math.round(vpW || vp.w || 1600));
  const h = Math.max(420, Math.round(vpH || vp.h || 1000));
  const cam = readCamera();
  const z = cam.zoom || 1.0;
  const prevFocused = opts.focusAddr || focused()?.terminal || null;
  const focusAddr = prevFocused && ordered.includes(prevFocused) ? prevFocused : ordered[0];

  const margin = 16;
  const gap = 12;
  const usableH = Math.max(260, h - margin * 2);
  const placeCell = (addr, x, y, cellW, cellH, tileMode) =>
    openTerminalWindowDirect(addr, {
      vpW: w,
      vpH: h,
      cam,
      tile: tileMode,
      x,
      y,
      width: cellW,
      height: cellH,
      worldW: Math.max(280, Math.round(cellW / z)),
      worldH: Math.max(180, Math.round(cellH / z)),
      scale: 1.0,
      resetBase: true,
      forceMove: true,
      skipFocus: true,
      skipMenuRaise: true,
      isFocused: addr === focusAddr,
    });

  if (ordered.length === 1) {
    const winW = Math.max(400, Math.round(w * 0.56));
    const winX = Math.max(margin, Math.round(w * 0.42));
    placeCell(ordered[0], winX, margin, Math.min(winW, w - winX - margin), usableH, "right");
  } else if (ordered.length === 2) {
    const availW = w - margin * 2 - gap;
    const leftW = Math.floor(availW / 2);
    const rightW = availW - leftW;
    placeCell(ordered[0], margin, margin, leftW, usableH, "left");
    placeCell(ordered[1], margin + leftW + gap, margin, rightW, usableH, "right-half");
  } else if (ordered.length === 3) {
    const availW = w - margin * 2 - gap;
    const leftW = Math.round(availW * 0.52);
    const rightW = availW - leftW;
    const topH = Math.floor((usableH - gap) / 2);
    const botH = usableH - gap - topH;
    placeCell(ordered[0], margin, margin, leftW, usableH, "left");
    placeCell(ordered[1], margin + leftW + gap, margin, rightW, topH, "custom");
    placeCell(ordered[2], margin + leftW + gap, margin + topH + gap, rightW, botH, "custom");
  } else {
    // 4+ open windows: dynamic NxM balanced grid that never overflows viewport height
    const totalW = Math.max(480, w - margin * 2);
    const totalH = Math.max(280, h - margin * 2);
    const cols = Math.max(2, Math.ceil(Math.sqrt(ordered.length)));
    const rows = Math.ceil(ordered.length / cols);
    const colW = Math.max(220, Math.floor((totalW - gap * (cols - 1)) / cols));
    const rowH = Math.max(140, Math.floor((totalH - gap * (rows - 1)) / rows));

    for (let i = 0; i < ordered.length; i++) {
      const col = i % cols;
      const row = Math.floor(i / cols);
      const x = margin + col * (colW + gap);
      const y = margin + row * (rowH + gap);
      const cellW = col === cols - 1 ? Math.max(220, totalW - col * (colW + gap)) : colW;
      const cellH = row === rows - 1 ? Math.max(140, totalH - row * (rowH + gap)) : rowH;
      placeCell(ordered[i], x, y, cellW, cellH, "custom");
    }
  }

  if (focusAddr) {
    run("pane.focus", { terminal: focusAddr });
  }
  ensureMenuButtonOnTop(w, h);
  return ordered.length;
}

export function minimizeTerminalWindow(addr, overlayId = null, _opts = {}) {
  const openWins = readOpenWins();
  const idToClose = overlayId || (addr ? openWins[addr]?.overlayId : null);
  if (idToClose) {
    try {
      closeOverlay(idToClose);
    } catch (_err) {
      // Ignore already-closed overlay
    }
  }
  let removed = false;
  if (addr && addr in openWins) {
    delete openWins[addr];
    removed = true;
  } else if (overlayId) {
    for (const [k, v] of Object.entries(openWins)) {
      if (v?.overlayId === overlayId) {
        delete openWins[k];
        removed = true;
      }
    }
  }
  if (removed) {
    setShared(OPEN_WINS_KEY, openWins);
  }
}

export function closeAllTerminalWindows() {
  const openWins = readOpenWins();
  const entries = Object.values(openWins);
  if (entries.length === 0) return;
  for (const entry of entries) {
    if (entry?.overlayId) {
      try {
        closeOverlay(entry.overlayId);
      } catch (_err) {
        // Ignore already-closed overlay
      }
    }
  }
  setShared(OPEN_WINS_KEY, {});
}

export function minimizeAllWindows() {
  closeAllTerminalWindows();
  const tools = readOpenTools();
  let toolsChanged = false;
  for (const [kind, entry] of Object.entries(tools)) {
    if (entry && !entry.minimized && (entry.overlayId || entry.suspended)) {
      if (entry.overlayId) {
        try {
          closeOverlay(entry.overlayId);
        } catch (_err) {
          // Ignore already-closed overlay
        }
      }
      tools[kind] = { ...entry, overlayId: "", minimized: true, suspended: false };
      toolsChanged = true;
    }
  }
  if (toolsChanged) {
    setShared(OPEN_TOOLS_KEY, tools);
  }

  const openNotes = readOpenNotes();
  let notesChanged = false;
  for (const [noteId, entry] of Object.entries(openNotes)) {
    if (entry && !entry.minimized && (entry.overlayId || entry.suspended)) {
      if (entry.overlayId) {
        try {
          closeOverlay(entry.overlayId);
        } catch (_err) {
          // Ignore already-closed overlay
        }
      }
      openNotes[noteId] = { ...entry, overlayId: "", minimized: true, suspended: false };
      notesChanged = true;
    }
  }
  if (notesChanged) {
    setShared(OPEN_NOTES_KEY, openNotes);
  }
}

export function toggleShowDesktop(vpW, vpH) {
  const vp = getViewportDims();
  const w = vpW || vp.w;
  const h = vpH || vp.h;

  const openWins = pruneOpenWindows();
  const openTermEntries = Object.entries(openWins).map(([addr, rec]) => ({
    addr,
    wx: rec.wx,
    wy: rec.wy,
    width: rec.width,
    height: rec.height,
    baseW: rec.baseW,
    baseH: rec.baseH,
    scale: rec.scale,
    tileMode: rec.tileMode,
  }));
  const openTools = readOpenTools();
  const visibleTools = Object.entries(openTools)
    .filter(([, entry]) => entry && !entry.minimized && (entry.overlayId || entry.suspended))
    .map(([kind]) => kind);
  const openNotes = readOpenNotes();
  const visibleNotes = Object.entries(openNotes)
    .filter(([, entry]) => entry && !entry.minimized && (entry.overlayId || entry.suspended))
    .map(([noteId]) => noteId);

  if (openTermEntries.length > 0 || visibleTools.length > 0 || visibleNotes.length > 0) {
    setShared(DESKTOP_STASH_KEY, {
      terminals: openTermEntries,
      tools: visibleTools,
      notes: visibleNotes,
    });
    minimizeAllWindows();
    return "hidden";
  }

  const rawStash = shared(DESKTOP_STASH_KEY);
  const stashTerms = Array.isArray(rawStash?.terminals) ? rawStash.terminals : [];
  const stashTools = Array.isArray(rawStash?.tools) ? rawStash.tools : [];
  const stashNotes = Array.isArray(rawStash?.notes) ? rawStash.notes : [];
  if (stashTerms.length === 0 && stashTools.length === 0 && stashNotes.length === 0) {
    return "empty";
  }

  setShared(DESKTOP_STASH_KEY, { terminals: [], tools: [], notes: [] });

  const liveAddrs = new Set((terminals() || []).map((tm) => tm?.address).filter(Boolean));
  const normalizedStash = stashTerms
    .map((item) => (typeof item === "string" ? { addr: item } : item))
    .filter((item) => item?.addr && (liveAddrs.size === 0 || liveAddrs.has(item.addr)));

  if (normalizedStash.length > 0) {
    for (const item of normalizedStash) {
      openTerminalWindowDirect(item.addr, {
        vpW: w,
        vpH: h,
        ...(typeof item.wx === "number" ? { wx: item.wx, wy: item.wy } : {}),
        ...(typeof item.width === "number" ? { worldW: item.width, worldH: item.height } : {}),
        ...(typeof item.baseW === "number" ? { baseW: item.baseW, baseH: item.baseH } : {}),
        ...(typeof item.scale === "number" ? { scale: item.scale } : {}),
        skipFocus: true,
        skipMenuRaise: true,
      });
    }
    run("pane.focus", { terminal: normalizedStash[0].addr });
  }

  for (const kind of stashTools) {
    if (kind in TOOL_META) {
      openToolWindow(kind, w, h, { skipMenuRaise: true });
    }
  }

  for (const noteId of stashNotes) {
    if (getNoteById(noteId)) {
      openNoteWindow(noteId, { vpW: w, vpH: h, skipMenuRaise: true });
    }
  }

  ensureMenuButtonOnTop(w, h);
  return "restored";
}

export function closeAndEndTerminal(addr, overlayId = null) {
  minimizeTerminalWindow(addr, overlayId);
  if (!addr) return;
  const paneInfo = (panes() || []).find((p) => p.terminal === addr);
  if (paneInfo?.pane) {
    run("pane.close", { pane: paneInfo.pane });
  } else {
    run("terminal.kill", { terminal: addr });
  }
}

// --- Desktop App / Tool Floating Windows (`files`, `changes`, `fleet`) ---

function defaultToolRect(tool, w, h) {
  if (tool === "fleet") {
    const width = Math.min(700, Math.max(480, Math.round(w * 0.44)));
    const height = Math.min(680, Math.max(420, Math.round(h * 0.68)));
    return {
      width,
      height,
      x: Math.max(20, Math.round((w - width) / 2)),
      y: Math.max(24, Math.round((h - 36 - height) * 0.35)),
    };
  }
  if (tool === "changes") {
    const width = Math.min(500, Math.max(360, Math.round(w * 0.3)));
    const height = Math.min(680, Math.max(400, Math.round(h * 0.72)));
    return {
      width,
      height,
      x: Math.min(Math.max(24, w - width - 24), 64),
      y: Math.max(28, Math.round(h * 0.08)),
    };
  }
  // files
  const width = Math.min(480, Math.max(340, Math.round(w * 0.28)));
  const height = Math.min(680, Math.max(400, Math.round(h * 0.72)));
  return {
    width,
    height,
    x: 24,
    y: Math.max(24, Math.round(h * 0.06)),
  };
}

function toolBodyContent(tool) {
  if (tool === "fleet") return { mod: "orrery", props: { role: "fleet" } };
  return { mod: tool };
}

export function openToolWindow(kind, vpW, vpH, opts = {}) {
  const tool = normalizeToolKind(kind);
  const vp = getViewportDims();
  const w = Math.max(640, Math.round(vpW || vp.w || 1600));
  const h = Math.max(420, Math.round(vpH || vp.h || 1000));
  const cam = opts.cam || readCamera();
  const z = cam.zoom || 1.0;

  const tools = readOpenTools();
  const prev = tools[tool] || null;
  const def = defaultToolRect(tool, w, h);

  const hasExplicitRect = typeof opts.width === "number" && typeof opts.height === "number";
  const rawW = hasExplicitRect ? opts.width : prev ? Math.round(prev.width * z) : Math.round(def.width * z);
  const rawH = hasExplicitRect ? opts.height : prev ? Math.round(prev.height * z) : Math.round(def.height * z);
  const rawX =
    typeof opts.x === "number"
      ? opts.x
      : prev
        ? Math.round(prev.wx * z + cam.camX)
        : def.x;
  const rawY =
    typeof opts.y === "number"
      ? opts.y
      : prev
        ? Math.round(prev.wy * z + cam.camY)
        : def.y;
  const { x, y, width, height } = clampWindowRect(rawX, rawY, rawW, rawH, w, h, 220, 140);

  const worldPos = screenToWorld(x, y, { camX: cam.camX, camY: cam.camY, zoom: z });
  const wasClamped = Math.abs(x - Math.round(rawX)) > 2 || Math.abs(y - Math.round(rawY)) > 2;
  const wx = typeof opts.wx === "number" && !wasClamped ? Math.round(opts.wx) : worldPos.x;
  const wy = typeof opts.wy === "number" && !wasClamped ? Math.round(opts.wy) : worldPos.y;
  const worldW =
    typeof opts.worldW === "number"
      ? Math.round(opts.worldW)
      : z < LIVE_ZOOM_MIN
        ? prev?.width || def.width
        : Math.max(260, Math.round(width / z));
  const worldH =
    typeof opts.worldH === "number"
      ? Math.round(opts.worldH)
      : z < LIVE_ZOOM_MIN
        ? prev?.height || def.height
        : Math.max(180, Math.round(height / z));
  const scale = clampWinScale(typeof opts.scale === "number" ? opts.scale : prev?.scale ?? 1.0);
  const baseW =
    typeof opts.baseW === "number"
      ? Math.round(opts.baseW)
      : opts.resetBase
        ? worldW
        : prev?.baseW || Math.round(worldW / scale);
  const baseH =
    typeof opts.baseH === "number"
      ? Math.round(opts.baseH)
      : opts.resetBase
        ? worldH
        : prev?.baseH || Math.round(worldH / scale);

  const prevId = opts.overlayId || prev?.overlayId || null;
  if (prevId) {
    try {
      closeOverlay(prevId);
    } catch (_err) {
      // Ignore already-closed overlay
    }
  }

  const overlayKey = `orrery-tool-${tool}-${nextWinGen()}`;

  if (z < LIVE_ZOOM_MIN && !opts.forceNativeOverlay && !isFocusMode()) {
    tools[tool] = {
      overlayId: "",
      key: overlayKey,
      width: worldW,
      height: worldH,
      screenW: Math.round(worldW * z),
      screenH: Math.round(worldH * z),
      baseW,
      baseH,
      scale,
      x: Math.round(wx * z + cam.camX),
      y: Math.round(wy * z + cam.camY),
      wx,
      wy,
      minimized: false,
      suspended: true,
    };
    setShared(OPEN_TOOLS_KEY, tools);
    return null;
  }

  const overlayId = openOverlay({
    kind: "window",
    frame: "none",
    key: overlayKey,
    keep: false,
    width,
    height,
    at: { x, y },
    layout: buildFramedWindowLayout({
      borderColor: "border",
      background: "surface",
      titleH: 28,
      titleProps: { role: "toolwin", tool },
      bodyContent: toolBodyContent(tool),
      winKind: "tool",
      targetId: tool,
      winKey: overlayKey,
      width,
      height,
    }),
  });

  if (overlayId) {
    tools[tool] = {
      overlayId,
      key: overlayKey,
      width: worldW,
      height: worldH,
      screenW: width,
      screenH: height,
      baseW,
      baseH,
      scale,
      x,
      y,
      wx,
      wy,
      minimized: false,
      suspended: false,
    };
    setShared(OPEN_TOOLS_KEY, tools);
  } else if (prev?.overlayId) {
    tools[tool] = { ...prev, overlayId: "", suspended: !prev.minimized };
    setShared(OPEN_TOOLS_KEY, tools);
  }
  if (!opts.skipMenuRaise) {
    ensureMenuButtonOnTop(w, h);
  }
  return overlayId;
}

export function minimizeToolWindow(kind, overlayId = null) {
  const tool = normalizeToolKind(kind);
  const tools = readOpenTools();
  const prev = tools[tool] || null;
  const idToClose = overlayId || prev?.overlayId || null;
  if (idToClose) {
    try {
      closeOverlay(idToClose);
    } catch (_err) {
      // Ignore already-closed overlay
    }
  }
  tools[tool] = {
    ...(prev || {}),
    overlayId: "",
    key: prev?.key || "",
    width: prev?.width || 440,
    height: prev?.height || 600,
    x: prev?.x ?? 24,
    y: prev?.y ?? 32,
    wx: prev?.wx ?? prev?.x ?? 24,
    wy: prev?.wy ?? prev?.y ?? 32,
    minimized: true,
    suspended: false,
  };
  setShared(OPEN_TOOLS_KEY, tools);
}

export function closeToolWindow(kind, overlayId = null) {
  const tool = normalizeToolKind(kind);
  const tools = readOpenTools();
  const idToClose = overlayId || tools[tool]?.overlayId || null;
  if (idToClose) {
    try {
      closeOverlay(idToClose);
    } catch (_err) {
      // Ignore already-closed overlay
    }
  }
  if (tool in tools) {
    delete tools[tool];
    setShared(OPEN_TOOLS_KEY, tools);
  }
}

export function closeAllToolWindows() {
  const tools = readOpenTools();
  const entries = Object.entries(tools);
  if (entries.length === 0) return;
  for (const [, entry] of entries) {
    if (entry?.overlayId) {
      try {
        closeOverlay(entry.overlayId);
      } catch (_err) {
        // Ignore already-closed overlay
      }
    }
  }
  setShared(OPEN_TOOLS_KEY, {});
}

export function toggleToolWindow(kind, vpW, vpH) {
  const tool = normalizeToolKind(kind);
  const tools = readOpenTools();
  if (isToolVisible(tool, tools)) {
    minimizeToolWindow(tool, tools[tool].overlayId);
    return false;
  }
  openToolWindow(tool, vpW, vpH);
  return true;
}

// --- Physical Scratchpad Note Floating Windows (`openNoteWindow`) ---

export function openNoteWindow(noteId, opts = {}) {
  if (!noteId) return null;
  const note = getNoteById(noteId);
  if (!note) return null;

  const vp = getViewportDims();
  const w = Math.max(640, Math.round(opts.vpW || vp.w || 1600));
  const h = Math.max(420, Math.round(opts.vpH || vp.h || 1000));
  const cam = opts.cam || readCamera();
  const z = cam.zoom || 1.0;

  const openNotes = readOpenNotes();
  const prev = openNotes[noteId] || null;

  const hasExplicitRect = typeof opts.width === "number" && typeof opts.height === "number";
  const rawW = hasExplicitRect ? opts.width : prev ? Math.round(prev.width * z) : Math.round(440 * z);
  const rawH = hasExplicitRect ? opts.height : prev ? Math.round(prev.height * z) : Math.round(340 * z);
  const prelimW = Math.max(200, Math.min(w - 16, Math.round(rawW)));
  const prelimH = Math.max(130, Math.min(h - 16, Math.round(rawH)));

  let rawX;
  let rawY;
  if (typeof opts.x === "number" && typeof opts.y === "number") {
    rawX = opts.x;
    rawY = opts.y;
  } else if (prev && !opts.forceNear) {
    rawX = Math.round(prev.wx * z + cam.camX);
    rawY = Math.round(prev.wy * z + cam.camY);
  } else if (typeof opts.nearX === "number" && typeof opts.nearY === "number") {
    const rightCandidate = opts.nearX + Math.round(186 * z);
    rawX =
      rightCandidate + prelimW <= w - 12
        ? rightCandidate
        : Math.max(8, opts.nearX - prelimW - 18);
    rawY = opts.nearY - 18;
  } else {
    const idx = Object.keys(openNotes).length;
    rawX = Math.max(24, Math.round((w - prelimW) / 2) + (idx % 4) * 28);
    rawY = Math.max(28, Math.round((h - prelimH) * 0.32) + (idx % 4) * 24);
  }

  const { x, y, width, height } = clampWindowRect(rawX, rawY, prelimW, prelimH, w, h, 200, 130);

  const worldPos = screenToWorld(x, y, { camX: cam.camX, camY: cam.camY, zoom: z });
  const wasClamped = Math.abs(x - Math.round(rawX)) > 2 || Math.abs(y - Math.round(rawY)) > 2;
  const wx = typeof opts.wx === "number" && !wasClamped ? Math.round(opts.wx) : worldPos.x;
  const wy = typeof opts.wy === "number" && !wasClamped ? Math.round(opts.wy) : worldPos.y;
  const worldW =
    typeof opts.worldW === "number"
      ? Math.round(opts.worldW)
      : z < LIVE_ZOOM_MIN
        ? prev?.width || 440
        : Math.max(260, Math.round(width / z));
  const worldH =
    typeof opts.worldH === "number"
      ? Math.round(opts.worldH)
      : z < LIVE_ZOOM_MIN
        ? prev?.height || 340
        : Math.max(180, Math.round(height / z));
  const scale = clampWinScale(typeof opts.scale === "number" ? opts.scale : prev?.scale ?? 1.0);
  const baseW =
    typeof opts.baseW === "number"
      ? Math.round(opts.baseW)
      : opts.resetBase
        ? worldW
        : prev?.baseW || Math.round(worldW / scale);
  const baseH =
    typeof opts.baseH === "number"
      ? Math.round(opts.baseH)
      : opts.resetBase
        ? worldH
        : prev?.baseH || Math.round(worldH / scale);

  const prevId = opts.overlayId || prev?.overlayId || null;
  if (prevId) {
    try {
      closeOverlay(prevId);
    } catch (_err) {
      // Ignore already-closed overlay
    }
  }

  const overlayKey = `orrery-note-${noteId}-${nextWinGen()}`;

  if (z < LIVE_ZOOM_MIN && !opts.forceNativeOverlay && !isFocusMode()) {
    openNotes[noteId] = {
      overlayId: "",
      key: overlayKey,
      width: worldW,
      height: worldH,
      screenW: Math.round(worldW * z),
      screenH: Math.round(worldH * z),
      baseW,
      baseH,
      scale,
      x: Math.round(wx * z + cam.camX),
      y: Math.round(wy * z + cam.camY),
      wx,
      wy,
      minimized: false,
      suspended: true,
    };
    setShared(OPEN_NOTES_KEY, openNotes);
    return null;
  }

  const overlayId = openOverlay({
    kind: "window",
    frame: "none",
    key: overlayKey,
    keep: false,
    width,
    height,
    at: { x, y },
    layout: buildFramedWindowLayout({
      borderColor: "border",
      background: "background",
      titleH: 28,
      titleProps: { role: "toolwin", tool: "note", noteId },
      bodyContent: { mod: "orrery", props: { role: "notes", noteId, autoFocus: Boolean(opts.autoFocus) } },
      winKind: "note",
      targetId: noteId,
      winKey: overlayKey,
      width,
      height,
    }),
  });

  if (overlayId) {
    openNotes[noteId] = {
      overlayId,
      key: overlayKey,
      width: worldW,
      height: worldH,
      screenW: width,
      screenH: height,
      baseW,
      baseH,
      scale,
      x,
      y,
      wx,
      wy,
      minimized: false,
      suspended: false,
    };
    setShared(OPEN_NOTES_KEY, openNotes);
  } else if (prev?.overlayId) {
    openNotes[noteId] = { ...prev, overlayId: "", suspended: !prev.minimized };
    setShared(OPEN_NOTES_KEY, openNotes);
  }
  if (!opts.skipMenuRaise) {
    ensureMenuButtonOnTop(w, h);
  }
  return overlayId;
}

export function minimizeNoteWindow(noteId, overlayId = null) {
  if (!noteId) return;
  const openNotes = readOpenNotes();
  const prev = openNotes[noteId] || null;
  const idToClose = overlayId || prev?.overlayId || null;
  if (idToClose) {
    try {
      closeOverlay(idToClose);
    } catch (_err) {
      // Ignore already-closed overlay
    }
  }
  openNotes[noteId] = {
    ...(prev || {}),
    overlayId: "",
    key: prev?.key || "",
    width: prev?.width || 440,
    height: prev?.height || 340,
    x: prev?.x ?? 240,
    y: prev?.y ?? 120,
    wx: prev?.wx ?? prev?.x ?? 240,
    wy: prev?.wy ?? prev?.y ?? 120,
    minimized: true,
    suspended: false,
  };
  setShared(OPEN_NOTES_KEY, openNotes);
}

export function closeNoteWindow(noteId, overlayId = null) {
  if (!noteId) return;
  const raw = shared(OPEN_NOTES_KEY);
  const openNotes = raw && typeof raw === "object" && !Array.isArray(raw) ? { ...raw } : {};
  const entry = normalizeNoteWinEntry(openNotes[noteId]);
  const idToClose = overlayId || entry?.overlayId || null;
  if (idToClose) {
    try {
      closeOverlay(idToClose);
    } catch (_err) {
      // Ignore already-closed overlay
    }
  }
  if (noteId in openNotes) {
    delete openNotes[noteId];
    setShared(OPEN_NOTES_KEY, openNotes);
  }
}

export function closeAllNoteWindows() {
  const openNotes = readOpenNotes();
  const entries = Object.entries(openNotes);
  if (entries.length === 0) return;
  for (const [, entry] of entries) {
    if (entry?.overlayId) {
      try {
        closeOverlay(entry.overlayId);
      } catch (_err) {
        // Ignore already-closed overlay
      }
    }
  }
  setShared(OPEN_NOTES_KEY, {});
}

export function toggleNoteWindow(noteId, vpW, vpH) {
  if (!noteId) return false;
  const openNotes = readOpenNotes();
  if (isNoteVisible(noteId, openNotes)) {
    minimizeNoteWindow(noteId, openNotes[noteId].overlayId);
    return false;
  }
  openNoteWindow(noteId, { vpW, vpH });
  return true;
}

export function dropNoteInView(vpW, vpH, camX = 0, camY = 0, zoom = 1.0) {
  const vp = getViewportDims();
  const w = Math.max(640, Math.round(vpW || vp.w || 1600));
  const h = Math.max(420, Math.round(vpH || vp.h || 1000));
  const z = typeof zoom === "number" && zoom > 0 ? zoom : 1.0;
  const existing = readNotesList();
  const idx = existing.length;
  const screenX = Math.max(84, Math.min(w - 220, Math.round(w * 0.24) + (idx % 5) * 42));
  const screenY = Math.max(84, Math.min(h - 180, Math.round(h * 0.22) + (idx % 4) * 34));
  const worldX = Math.round((screenX - (camX || 0)) / z);
  const worldY = Math.round((screenY - (camY || 0)) / z);
  const created = createNoteObject({ x: worldX, y: worldY, text: "" });
  if (z >= LIVE_ZOOM_MIN) {
    openNoteWindow(created.id, {
      vpW: w,
      vpH: h,
      nearX: screenX,
      nearY: screenY,
      forceNear: true,
      autoFocus: true,
    });
  }
  return created;
}

export function openOrCreateNoteInView(vpW, vpH, camX = 0, camY = 0) {
  const openNotes = readOpenNotes();
  const visible = Object.entries(openNotes).filter(
    ([, entry]) => entry && !entry.minimized && entry.overlayId
  );
  if (visible.length > 0) {
    for (const [noteId, entry] of visible) {
      minimizeNoteWindow(noteId, entry.overlayId);
    }
    return false;
  }

  const cam = readCamera();
  const z = cam.zoom || 1.0;
  const cx = camX || cam.camX || 0;
  const cy = camY || cam.camY || 0;
  const list = readNotesList();
  if (list.length > 0) {
    const latest = [...list].sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0))[0];
    openNoteWindow(latest.id, {
      vpW,
      vpH,
      nearX: Math.round(latest.x * z + cx),
      nearY: Math.round(latest.y * z + cy),
    });
    return true;
  }

  dropNoteInView(vpW, vpH, cx, cy, z);
  return true;
}

export function toggleToolSurface(kind, vpW, vpH) {
  if (kind === "notes") {
    openOrCreateNoteInView(vpW, vpH, 0, 0);
    return;
  }
  const tool = normalizeToolKind(kind);
  if (isFocusMode() && (tool === "files" || tool === "changes")) {
    toggleSideDrawer(tool === "changes" ? "side-changes" : "side-files");
    return;
  }
  const tools = readOpenTools();
  if (isToolVisible(tool, tools)) {
    closeToolWindow(tool, tools[tool].overlayId);
  } else {
    openToolWindow(tool, vpW, vpH);
  }
}

export function applyWindowResize(winKind, targetId, winX, winY, width, height, targetOverlayId = null) {
  const vp = getViewportDims();
  const cam = readCamera();
  const z = cam.zoom || 1.0;
  const worldPos = screenToWorld(winX, winY, { camX: cam.camX, camY: cam.camY, zoom: z });
  const worldW = Math.max(260, Math.round(width / z));
  const worldH = Math.max(180, Math.round(height / z));

  if (winKind === "note") {
    return openNoteWindow(targetId, {
      vpW: vp.w,
      vpH: vp.h,
      cam,
      x: winX,
      y: winY,
      width,
      height,
      wx: worldPos.x,
      wy: worldPos.y,
      worldW,
      worldH,
      scale: 1.0,
      resetBase: true,
      overlayId: targetOverlayId,
    });
  }
  if (winKind === "tool") {
    return openToolWindow(targetId, vp.w, vp.h, {
      cam,
      x: winX,
      y: winY,
      width,
      height,
      wx: worldPos.x,
      wy: worldPos.y,
      worldW,
      worldH,
      scale: 1.0,
      resetBase: true,
      forceMove: true,
      overlayId: targetOverlayId,
    });
  }
  return openTerminalWindowDirect(targetId, {
    vpW: vp.w,
    vpH: vp.h,
    cam,
    tile: "custom",
    x: winX,
    y: winY,
    width,
    height,
    wx: worldPos.x,
    wy: worldPos.y,
    worldW,
    worldH,
    scale: 1.0,
    resetBase: true,
    forceMove: true,
    overlayId: targetOverlayId,
  });
}

export function applyWindowMove(winKind, targetId, screenX, screenY, width, height, targetOverlayId = null) {
  const vp = getViewportDims();
  const cam = readCamera();
  const z = cam.zoom || 1.0;
  const worldPos = screenToWorld(screenX, screenY, { camX: cam.camX, camY: cam.camY, zoom: z });

  if (winKind === "note") {
    const prev = readOpenNotes()[targetId];
    if (!prev || prev.minimized) return null;
    return openNoteWindow(targetId, {
      vpW: vp.w,
      vpH: vp.h,
      cam,
      x: screenX,
      y: screenY,
      width: width || Math.max(200, Math.round((prev.width || 440) * z)),
      height: height || Math.max(130, Math.round((prev.height || 340) * z)),
      wx: worldPos.x,
      wy: worldPos.y,
      worldW: prev.width,
      worldH: prev.height,
      baseW: prev.baseW,
      baseH: prev.baseH,
      scale: prev.scale,
      overlayId: targetOverlayId,
    });
  }
  if (winKind === "tool") {
    const prev = readOpenTools()[normalizeToolKind(targetId)];
    if (!prev || prev.minimized) return null;
    return openToolWindow(targetId, vp.w, vp.h, {
      cam,
      x: screenX,
      y: screenY,
      width: width || Math.max(220, Math.round((prev.width || 440) * z)),
      height: height || Math.max(140, Math.round((prev.height || 600) * z)),
      wx: worldPos.x,
      wy: worldPos.y,
      worldW: prev.width,
      worldH: prev.height,
      baseW: prev.baseW,
      baseH: prev.baseH,
      scale: prev.scale,
      forceMove: true,
      overlayId: targetOverlayId,
    });
  }
  const prev = readOpenWins()[targetId];
  if (!prev) return null;
  return openTerminalWindowDirect(targetId, {
    vpW: vp.w,
    vpH: vp.h,
    cam,
    tile: "custom",
    x: screenX,
    y: screenY,
    width: width || Math.max(220, Math.round((prev.width || 800) * z)),
    height: height || Math.max(140, Math.round((prev.height || 600) * z)),
    wx: worldPos.x,
    wy: worldPos.y,
    worldW: prev.width,
    worldH: prev.height,
    baseW: prev.baseW,
    baseH: prev.baseH,
    scale: prev.scale,
    forceMove: true,
    overlayId: targetOverlayId,
  });
}

// --- Spatial Infinite World: Suspend, Camera Sync, World-Card Drag & Ctrl+Scroll Scaling ---

export function suspendAllLiveOverlays() {
  const openWins = readOpenWins();
  let winsChanged = false;
  for (const [addr, rec] of Object.entries(openWins)) {
    if (rec?.overlayId) {
      try {
        closeOverlay(rec.overlayId);
      } catch (_err) {
        // Ignore already-closed overlay
      }
      openWins[addr] = { ...rec, overlayId: "", suspended: true };
      winsChanged = true;
    }
  }
  if (winsChanged) setShared(OPEN_WINS_KEY, openWins);

  const openTools = readOpenTools();
  let toolsChanged = false;
  for (const [kind, rec] of Object.entries(openTools)) {
    if (rec?.overlayId && !rec.minimized) {
      try {
        closeOverlay(rec.overlayId);
      } catch (_err) {
        // Ignore already-closed overlay
      }
      openTools[kind] = { ...rec, overlayId: "", suspended: true };
      toolsChanged = true;
    }
  }
  if (toolsChanged) setShared(OPEN_TOOLS_KEY, openTools);

  const openNotes = readOpenNotes();
  let notesChanged = false;
  for (const [noteId, rec] of Object.entries(openNotes)) {
    if (rec?.overlayId && !rec.minimized) {
      try {
        closeOverlay(rec.overlayId);
      } catch (_err) {
        // Ignore already-closed overlay
      }
      openNotes[noteId] = { ...rec, overlayId: "", suspended: true };
      notesChanged = true;
    }
  }
  if (notesChanged) setShared(OPEN_NOTES_KEY, openNotes);
}

function fitsCleanlyInView(sx, sy, sw, sh, vpW, vpH) {
  const slack = 28;
  return sx >= -slack && sy >= -slack && sx + sw <= vpW + slack && sy + sh <= vpH + slack;
}

export function syncLiveOverlaysToCamera(cam, vpW, vpH, opts = {}) {
  if (isFocusMode()) return;
  const vp = getViewportDims();
  const w = Math.max(480, Math.round(vpW || vp.w || 1600));
  const h = Math.max(320, Math.round(vpH || vp.h || 1000));
  const c = writeCamera(cam?.camX ?? 0, cam?.camY ?? 0, cam?.zoom ?? 1.0);
  const z = c.zoom || 1.0;
  const prevFocused = opts.focusTerminal || focused()?.terminal || null;
  let mountedAny = false;

  // Materialize native 1:1 Herdr overlays ONLY at 100% zoom (z >= LIVE_ZOOM_MIN).
  // Below 100%, windows stay spatially coherent float-scaled World Windows on the canvas
  // (zero SIGWINCH, zero font explosion, zero reflow) while terminals remain live-interactive
  // in place via direct keyboard forwarding (`hc keys`) + live `hc read` updates!
  if (z < LIVE_ZOOM_MIN) {
    suspendAllLiveOverlays();
    return;
  }

  // 1. Terminals (clamp margin = 8px matching clampWindowRect; batch suspend writes; mount focused last so it raises on top!)
  const openWins = pruneOpenWindows();
  const suspendedTermAddrs = [];
  const winEntries = Object.entries(openWins).sort(([a], [b]) =>
    a === prevFocused ? 1 : b === prevFocused ? -1 : 0
  );
  for (const [addr, rec] of winEntries) {
    const sx = Math.round(rec.wx * z + c.camX);
    const sy = Math.round(rec.wy * z + c.camY);
    const sw = Math.max(220, Math.round(rec.width * z));
    const sh = Math.max(140, Math.round(rec.height * z));

    if (fitsCleanlyInView(sx, sy, sw, sh, w, h)) {
      const targetX = Math.max(8, Math.min(Math.max(8, w - sw - 8), sx));
      const targetY = Math.max(8, Math.min(Math.max(8, h - sh - 8), sy));
      const alreadySame =
        Boolean(rec.overlayId) &&
        !rec.suspended &&
        Math.abs((rec.x ?? -9999) - targetX) <= 2 &&
        Math.abs((rec.y ?? -9999) - targetY) <= 2 &&
        Math.abs((rec.screenW ?? rec.width) - sw) <= 2 &&
        Math.abs((rec.screenH ?? rec.height) - sh) <= 2;
      if (alreadySame) continue;

      openTerminalWindowDirect(addr, {
        vpW: w,
        vpH: h,
        cam: c,
        x: targetX,
        y: targetY,
        width: sw,
        height: sh,
        wx: rec.wx,
        wy: rec.wy,
        worldW: rec.width,
        worldH: rec.height,
        baseW: rec.baseW,
        baseH: rec.baseH,
        scale: rec.scale,
        forceMove: true,
        skipFocus: true,
        skipMenuRaise: true,
        isFocused: addr === prevFocused,
      });
      mountedAny = true;
    } else if (rec.overlayId) {
      try {
        closeOverlay(rec.overlayId);
      } catch (_err) {
        // Ignore already-closed overlay
      }
      suspendedTermAddrs.push(addr);
    }
  }
  if (suspendedTermAddrs.length > 0) {
    const latest = readOpenWins();
    for (const addr of suspendedTermAddrs) {
      if (latest[addr]) latest[addr] = { ...latest[addr], overlayId: "", suspended: true };
    }
    setShared(OPEN_WINS_KEY, latest);
  }

  // 2. Tools
  const openTools = readOpenTools();
  const suspendedTools = [];
  for (const [kind, rec] of Object.entries(openTools)) {
    if (rec.minimized) continue;
    const sx = Math.round(rec.wx * z + c.camX);
    const sy = Math.round(rec.wy * z + c.camY);
    const sw = Math.max(220, Math.round(rec.width * z));
    const sh = Math.max(140, Math.round(rec.height * z));

    if (fitsCleanlyInView(sx, sy, sw, sh, w, h)) {
      const targetX = Math.max(8, Math.min(Math.max(8, w - sw - 8), sx));
      const targetY = Math.max(8, Math.min(Math.max(8, h - sh - 8), sy));
      const alreadySame =
        Boolean(rec.overlayId) &&
        !rec.suspended &&
        Math.abs((rec.x ?? -9999) - targetX) <= 2 &&
        Math.abs((rec.y ?? -9999) - targetY) <= 2 &&
        Math.abs((rec.screenW ?? rec.width) - sw) <= 2 &&
        Math.abs((rec.screenH ?? rec.height) - sh) <= 2;
      if (alreadySame) continue;

      openToolWindow(kind, w, h, {
        cam: c,
        x: targetX,
        y: targetY,
        width: sw,
        height: sh,
        wx: rec.wx,
        wy: rec.wy,
        worldW: rec.width,
        worldH: rec.height,
        baseW: rec.baseW,
        baseH: rec.baseH,
        scale: rec.scale,
        skipMenuRaise: true,
      });
      mountedAny = true;
    } else if (rec.overlayId) {
      try {
        closeOverlay(rec.overlayId);
      } catch (_err) {
        // Ignore already-closed overlay
      }
      suspendedTools.push(kind);
    }
  }
  if (suspendedTools.length > 0) {
    const latest = readOpenTools();
    for (const kind of suspendedTools) {
      if (latest[kind]) latest[kind] = { ...latest[kind], overlayId: "", suspended: true };
    }
    setShared(OPEN_TOOLS_KEY, latest);
  }

  // 3. Notes
  const openNotes = readOpenNotes();
  const suspendedNotes = [];
  for (const [noteId, rec] of Object.entries(openNotes)) {
    if (rec.minimized) continue;
    const sx = Math.round(rec.wx * z + c.camX);
    const sy = Math.round(rec.wy * z + c.camY);
    const sw = Math.max(200, Math.round(rec.width * z));
    const sh = Math.max(130, Math.round(rec.height * z));

    if (fitsCleanlyInView(sx, sy, sw, sh, w, h)) {
      const targetX = Math.max(8, Math.min(Math.max(8, w - sw - 8), sx));
      const targetY = Math.max(8, Math.min(Math.max(8, h - sh - 8), sy));
      const alreadySame =
        Boolean(rec.overlayId) &&
        !rec.suspended &&
        Math.abs((rec.x ?? -9999) - targetX) <= 2 &&
        Math.abs((rec.y ?? -9999) - targetY) <= 2 &&
        Math.abs((rec.screenW ?? rec.width) - sw) <= 2 &&
        Math.abs((rec.screenH ?? rec.height) - sh) <= 2;
      if (alreadySame) continue;

      openNoteWindow(noteId, {
        vpW: w,
        vpH: h,
        cam: c,
        x: targetX,
        y: targetY,
        width: sw,
        height: sh,
        wx: rec.wx,
        wy: rec.wy,
        worldW: rec.width,
        worldH: rec.height,
        baseW: rec.baseW,
        baseH: rec.baseH,
        scale: rec.scale,
        skipMenuRaise: true,
      });
      mountedAny = true;
    } else if (rec.overlayId) {
      try {
        closeOverlay(rec.overlayId);
      } catch (_err) {
        // Ignore already-closed overlay
      }
      suspendedNotes.push(noteId);
    }
  }
  if (suspendedNotes.length > 0) {
    const latest = readOpenNotes();
    for (const noteId of suspendedNotes) {
      if (latest[noteId]) latest[noteId] = { ...latest[noteId], overlayId: "", suspended: true };
    }
    setShared(OPEN_NOTES_KEY, latest);
  }

  if (mountedAny) {
    if (prevFocused && readOpenWins()[prevFocused]?.overlayId) {
      run("pane.focus", { terminal: prevFocused });
    }
    ensureMenuButtonOnTop(w, h);
  }
}

export function moveWorldWindowCoords(winKind, targetId, wx, wy) {
  const b = getWorldBounds();
  if (winKind === "terminal" && targetId) {
    const wins = readOpenWins();
    const rec = wins[targetId];
    if (!rec) return;
    const rx = Math.max(b.minX + 16, Math.min(b.maxX - Math.min(rec.width || 400, 260), Math.round(wx)));
    const ry = Math.max(b.minY + 16, Math.min(b.maxY - Math.min(rec.height || 240, 160), Math.round(wy)));
    wins[targetId] = { ...rec, wx: rx, wy: ry };
    setShared(OPEN_WINS_KEY, wins);
  } else if (winKind === "tool" && targetId) {
    const tool = normalizeToolKind(targetId);
    const tools = readOpenTools();
    const rec = tools[tool];
    if (!rec) return;
    const rx = Math.max(b.minX + 16, Math.min(b.maxX - Math.min(rec.width || 400, 220), Math.round(wx)));
    const ry = Math.max(b.minY + 16, Math.min(b.maxY - Math.min(rec.height || 240, 140), Math.round(wy)));
    tools[tool] = { ...rec, wx: rx, wy: ry };
    setShared(OPEN_TOOLS_KEY, tools);
  } else if (winKind === "note" && targetId) {
    const notes = readOpenNotes();
    const rec = notes[targetId];
    if (!rec) return;
    const rx = Math.max(b.minX + 16, Math.min(b.maxX - Math.min(rec.width || 360, 200), Math.round(wx)));
    const ry = Math.max(b.minY + 16, Math.min(b.maxY - Math.min(rec.height || 200, 120), Math.round(wy)));
    notes[targetId] = { ...rec, wx: rx, wy: ry };
    setShared(OPEN_NOTES_KEY, notes);
  }
}

export function scaleWindowByFactor(winKind, targetId, factor, opts = {}) {
  if (!targetId) return 1.0;
  const vp = getViewportDims();
  const cam = readCamera();
  const z = cam.zoom || 1.0;
  const materialize = opts.materialize !== false;

  const updateRec = (rec, minW, minH) => {
    const baseW = rec.baseW || rec.width;
    const baseH = rec.baseH || rec.height;
    const maxScaleByVp = Math.min((vp.w - 16) / Math.max(1, baseW), (vp.h - 16) / Math.max(1, baseH));
    const requested = typeof opts.absoluteScale === "number" ? opts.absoluteScale : (rec.scale || 1.0) * factor;
    const nextScale = clampWinScale(Math.min(requested, Math.max(1.0, maxScaleByVp)));
    const newW = Math.max(minW, Math.min(vp.w - 16, Math.round(baseW * nextScale)));
    const newH = Math.max(minH, Math.min(vp.h - 16, Math.round(baseH * nextScale)));
    const dW = newW - rec.width;
    const dH = newH - rec.height;
    const nextWX = Math.round(rec.wx - dW / 2);
    const nextWY = Math.round(rec.wy - dH / 2);
    return {
      ...rec,
      width: newW,
      height: newH,
      baseW,
      baseH,
      scale: nextScale,
      wx: nextWX,
      wy: nextWY,
    };
  };

  if (winKind === "terminal") {
    const wins = readOpenWins();
    const rec = wins[targetId];
    if (!rec) return 1.0;
    const next = updateRec(rec, 300, 200);
    if (materialize && rec.overlayId) {
      const sp = worldToScreen(next.wx, next.wy, { camX: cam.camX, camY: cam.camY, zoom: z });
      openTerminalWindowDirect(targetId, {
        vpW: vp.w,
        vpH: vp.h,
        cam,
        x: sp.x,
        y: sp.y,
        width: Math.round(next.width * z),
        height: Math.round(next.height * z),
        wx: next.wx,
        wy: next.wy,
        worldW: next.width,
        worldH: next.height,
        baseW: next.baseW,
        baseH: next.baseH,
        scale: next.scale,
        forceMove: true,
        overlayId: opts.overlayId || rec.overlayId,
      });
    } else {
      wins[targetId] = next;
      setShared(OPEN_WINS_KEY, wins);
    }
    return next.scale;
  }

  if (winKind === "tool") {
    const tool = normalizeToolKind(targetId);
    const tools = readOpenTools();
    const rec = tools[tool];
    if (!rec) return 1.0;
    const next = updateRec(rec, 280, 200);
    if (materialize && rec.overlayId) {
      const sp = worldToScreen(next.wx, next.wy, { camX: cam.camX, camY: cam.camY, zoom: z });
      openToolWindow(tool, vp.w, vp.h, {
        cam,
        x: sp.x,
        y: sp.y,
        width: Math.round(next.width * z),
        height: Math.round(next.height * z),
        wx: next.wx,
        wy: next.wy,
        worldW: next.width,
        worldH: next.height,
        baseW: next.baseW,
        baseH: next.baseH,
        scale: next.scale,
        overlayId: opts.overlayId || rec.overlayId,
      });
    } else {
      tools[tool] = next;
      setShared(OPEN_TOOLS_KEY, tools);
    }
    return next.scale;
  }

  if (winKind === "note") {
    const notes = readOpenNotes();
    const rec = notes[targetId];
    if (!rec) return 1.0;
    const next = updateRec(rec, 260, 180);
    if (materialize && rec.overlayId) {
      const sp = worldToScreen(next.wx, next.wy, { camX: cam.camX, camY: cam.camY, zoom: z });
      openNoteWindow(targetId, {
        vpW: vp.w,
        vpH: vp.h,
        cam,
        x: sp.x,
        y: sp.y,
        width: Math.round(next.width * z),
        height: Math.round(next.height * z),
        wx: next.wx,
        wy: next.wy,
        worldW: next.width,
        worldH: next.height,
        baseW: next.baseW,
        baseH: next.baseH,
        scale: next.scale,
        overlayId: opts.overlayId || rec.overlayId,
      });
    } else {
      notes[targetId] = next;
      setShared(OPEN_NOTES_KEY, notes);
    }
    return next.scale;
  }

  return 1.0;
}

export function resetWindowScale(winKind, targetId, opts = {}) {
  return scaleWindowByFactor(winKind, targetId, 1.0, { ...opts, absoluteScale: 1.0 });
}

// --- Mode Switching ---

export function enterFocusMode(terminalAddr = null) {
  closeLauncherPopup(false);
  closeContextPopup();
  closeMenuButton();
  closeAllTerminalWindows();
  closeAllToolWindows();
  closeAllNoteWindows();
  run("layout.select", { stack: "root", child: "focus" });
  if (terminalAddr) {
    const isAg = (agents() || []).some((a) => a.address === terminalAddr);
    if (isAg) {
      run("agent.focus", { terminal: terminalAddr });
    } else {
      run("pane.focus", { terminal: terminalAddr });
    }
  }
}

export function enterCosmosMode() {
  run("layout.select", { stack: "root", child: "cosmos" });
  const vp = getViewportDims();
  ensureMenuButtonOnTop(vp.w, vp.h);
}

export function toggleMode() {
  if (isFocusMode()) {
    enterCosmosMode();
  } else {
    enterFocusMode();
  }
}

// --- Terminal & Space Resolution, Explicit Spawning & Description Helpers ---

export function spaceDisplayName(sp) {
  if (!sp) return "space";
  const base = sp.name || "space";
  return sp.machine ? `${sp.machine}:${base}` : base;
}

export function shortFolder(folder) {
  if (!folder || typeof folder !== "string") return "";
  const normalized = folder.replace(/\\/g, "/");
  const isHome = /^\/(home|Users)\/[^/]+/i.test(normalized) || /^[A-Za-z]:\/Users\/[^/]+/i.test(normalized);
  const cleaned = normalized
    .replace(/^\/home\/[^/]+/, "~")
    .replace(/^\/Users\/[^/]+/, "~")
    .replace(/^[A-Za-z]:\/Users\/[^/]+/i, "~");
  if (cleaned.length <= 36) return cleaned;
  const parts = cleaned.split("/").filter(Boolean);
  if (parts.length <= 2) return cleaned;
  return `${isHome ? "~" : "…"}/${parts.slice(-2).join("/")}`;
}

export function describeTab(sp, tab, allAgents = null, allTerms = null) {
  const agList = Array.isArray(allAgents) ? allAgents : agents() || [];
  const tmList = Array.isArray(allTerms) ? allTerms : terminals() || [];
  const paneMatch = tab?.id ? (panes() || []).find((p) => p?.terminal && p.tab === tab.id) || null : null;

  const ag = tab?.id ? agList.find((a) => a?.tab === tab.id) || null : null;
  const term =
    (paneMatch?.terminal && tmList.find((tm) => tm?.address === paneMatch.terminal)) ||
    (tab?.id
      ? tmList.find((tm) => tm?.address && !tm.parent && terminalMatchesTab(tm, sp, tab)) ||
        tmList.find((tm) => tm?.address && terminalMatchesTab(tm, sp, tab)) ||
        null
      : null);

  const progName = ag
    ? agentName(ag)
    : term
      ? cleanAgentName(term.program?.name || term.name || "shell")
      : paneMatch?.program?.name
        ? cleanAgentName(paneMatch.program.name)
        : tab?.named && tab.name
          ? tab.name
          : "Terminal";

  let label = progName;
  if (tab?.named && tab.name && tab.name.toLowerCase() !== progName.toLowerCase()) {
    label = `${tab.name} · ${progName}`;
  } else if (tab?.index) {
    label = `${tab.index}. ${progName}`;
  }

  return {
    label,
    program: progName,
    status: ag?.status || tab?.status || term?.status || "idle",
    address: ag?.address || paneMatch?.terminal || term?.address || null,
    agent: ag,
    term,
  };
}

export function tabTooltip(sp, tab, allAgents = null, allTerms = null) {
  const desc = describeTab(sp, tab, allAgents, allTerms);
  const spName = spaceDisplayName(sp);
  const st = desc.status && desc.status !== "idle" ? ` · ${desc.status}` : "";
  const idxPart = tab?.named && tab.name ? tab.name : `Tab ${tab?.index || 1}`;
  return `${idxPart}: ${desc.program}${st}\nSpace: ${spName} · click to open`;
}

function stripMachinePrefix(id) {
  if (typeof id !== "string") return "";
  const slash = id.indexOf("/");
  return slash >= 0 ? id.slice(slash + 1) : id;
}

function terminalMachineOf(addr) {
  if (typeof addr !== "string") return "";
  const slash = addr.indexOf("/");
  return slash >= 0 ? addr.slice(0, slash) : "";
}

function terminalMatchesSpace(tm, sp) {
  if (!tm?.address || !sp?.id) return false;
  if (tm.space === sp.id) return true;
  const spMachine = sp.machine || "";
  if (terminalMachineOf(tm.address) !== spMachine) return false;
  const labelSp = tm.labels?.["herdr.space"];
  return Boolean(labelSp && labelSp === stripMachinePrefix(sp.id));
}

function terminalMatchesTab(tm, sp, tab) {
  if (!tm?.address || !tab?.id) return false;
  if (tm.tab === tab.id) return true;
  const spMachine = sp?.machine || terminalMachineOf(tab.id);
  if (terminalMachineOf(tm.address) !== spMachine) return false;
  const labelTab = tm.labels?.["herdr.tab"];
  return Boolean(labelTab && labelTab === stripMachinePrefix(tab.id));
}

function worldHintNearSpace(spaceId) {
  if (!spaceId) return null;
  const pos = readSpacePositions()[spaceId];
  if (pos && typeof pos.x === "number" && typeof pos.y === "number") {
    return { wx: Math.round(pos.x + 170), wy: Math.round(pos.y - 180) };
  }
  return null;
}

export function spawnTerminalInSpace(cx, spaceId, opts = {}) {
  const allSpaces = spaces() || [];
  const resolvedSpaceId =
    (spaceId && allSpaces.some((s) => s.id === spaceId) ? spaceId : null) ||
    allSpaces.find((s) => s.active)?.id ||
    allSpaces[0]?.id ||
    "";

  const beforeAddrs = new Set((terminals() || []).map((tm) => tm?.address).filter(Boolean));
  const beforePanes = new Set((panes() || []).map((pn) => pn?.terminal).filter(Boolean));

  if (resolvedSpaceId) {
    const targetSp = allSpaces.find((s) => s.id === resolvedSpaceId);
    if (targetSp && !targetSp.active) {
      run("space.select", { id: resolvedSpaceId });
    }
  }

  const args = {};
  if (resolvedSpaceId) args.space = resolvedSpaceId;
  if (opts.argv) args.argv = opts.argv;
  if (opts.name) args.name = opts.name;
  if (opts.folder) args.folder = opts.folder;
  if (opts.task) args.task = opts.task;
  run("tab.new", args);

  if (isFocusMode() || !cx?.spawn) return;
  const vp = getViewportDims();
  const vpW = opts.vpW || vp.w;
  const vpH = opts.vpH || vp.h;

  cx.spawn(async (asyncCx) => {
    for (let i = 0; i < 24; i++) {
      await asyncCx.sleep(130);
      if (isFocusMode()) return;
      const targetSp = (spaces() || []).find((s) => s.id === resolvedSpaceId) || null;
      const tabIds = new Set((targetSp?.tabs || []).map((tb) => tb.id));
      const freshPane =
        tabIds.size > 0
          ? (panes() || []).find((pn) => pn?.terminal && !beforePanes.has(pn.terminal) && tabIds.has(pn.tab))
          : null;
      const terms = terminals() || [];
      const exactTerm =
        targetSp &&
        terms.find((tm) => tm?.address && !beforeAddrs.has(tm.address) && !tm.parent && terminalMatchesSpace(tm, targetSp));
      const addr = freshPane?.terminal || exactTerm?.address || null;
      if (addr) {
        const hint = worldHintNearSpace(resolvedSpaceId);
        openTerminalWindow(addr, { vpW, vpH, ...(hint || {}) });
        asyncCx.notify();
        return;
      }
    }
    if (isFocusMode()) return;
    const targetSp = (spaces() || []).find((s) => s.id === resolvedSpaceId);
    const spTerm = targetSp && findTerminalForSpace(targetSp);
    if (spTerm) {
      const hint = worldHintNearSpace(resolvedSpaceId);
      openTerminalWindow(spTerm, { vpW, vpH, ...(hint || {}) });
      asyncCx.notify();
    }
  });
}

export function spawnNewSpace(cx, opts = {}) {
  const beforeAddrs = new Set((terminals() || []).map((tm) => tm?.address).filter(Boolean));
  const beforePanes = new Set((panes() || []).map((pn) => pn?.terminal).filter(Boolean));
  const beforeSpaces = new Set((spaces() || []).map((sp) => sp?.id).filter(Boolean));

  const args = {};
  if (opts.folder) args.folder = opts.folder;
  if (typeof opts.machine === "string") args.machine = opts.machine;
  if (opts.name) args.name = opts.name;
  if (opts.argv) args.argv = opts.argv;
  if (opts.tab) args.tab = opts.tab;
  run("space.new", args);

  if (isFocusMode() || !cx?.spawn) return;
  const vp = getViewportDims();
  const vpW = opts.vpW || vp.w;
  const vpH = opts.vpH || vp.h;
  const expectedMachine = typeof opts.machine === "string" ? opts.machine : null;

  cx.spawn(async (asyncCx) => {
    let placedSpaceId = "";
    for (let i = 0; i < 28; i++) {
      await asyncCx.sleep(130);
      if (isFocusMode()) return;
      const curSpaces = spaces() || [];
      const newSpace =
        curSpaces.find(
          (sp) =>
            sp?.id &&
            !beforeSpaces.has(sp.id) &&
            (expectedMachine === null || (sp.machine || "") === expectedMachine)
        ) || null;
      if (
        newSpace &&
        !placedSpaceId &&
        opts.atWorld &&
        typeof opts.atWorld.x === "number" &&
        typeof opts.atWorld.y === "number"
      ) {
        placedSpaceId = newSpace.id;
        setSpaceWorldPos(newSpace.id, opts.atWorld.x, opts.atWorld.y);
      }
      if (!newSpace) continue;

      const tabIds = new Set((newSpace.tabs || []).map((tb) => tb.id));
      const freshPane =
        tabIds.size > 0
          ? (panes() || []).find((pn) => pn?.terminal && !beforePanes.has(pn.terminal) && tabIds.has(pn.tab))
          : null;
      const terms = terminals() || [];
      const exactTerm = terms.find(
        (tm) => tm?.address && !beforeAddrs.has(tm.address) && !tm.parent && terminalMatchesSpace(tm, newSpace)
      );
      const addr = freshPane?.terminal || exactTerm?.address || findTerminalForSpace(newSpace);
      if (addr) {
        const openOpts = { vpW, vpH };
        if (opts.atWorld && typeof opts.atWorld.x === "number" && typeof opts.atWorld.y === "number") {
          openOpts.wx = Math.round(opts.atWorld.x + 170);
          openOpts.wy = Math.round(opts.atWorld.y - 180);
        }
        openTerminalWindow(addr, openOpts);
        asyncCx.notify();
        return;
      }
    }
  });
}

export function openSpaceTerminalAsync(cx, sp, vpW, vpH) {
  if (!sp) return;
  const vp = getViewportDims();
  const w = vpW || vp.w;
  const h = vpH || vp.h;
  const hint = worldHintNearSpace(sp.id);
  if (!sp.active) run("space.select", { id: sp.id });
  if (isFocusMode()) return;
  const existing = findTerminalForSpace(sp);
  if (existing) {
    openTerminalWindow(existing, { vpW: w, vpH: h, ...(hint || {}) });
    return;
  }
  if (!cx?.spawn) return;
  cx.spawn(async (asyncCx) => {
    await asyncCx.sleep(160);
    if (isFocusMode()) return;
    const updatedSp = (spaces() || []).find((s) => s.id === sp.id) || sp;
    const addr = findTerminalForSpace(updatedSp);
    if (addr) {
      openTerminalWindow(addr, { vpW: w, vpH: h, ...(hint || {}) });
      asyncCx.notify();
    }
  });
}

export function openTabTerminalAsync(cx, sp, tab, vpW, vpH) {
  const vp = getViewportDims();
  const w = vpW || vp.w;
  const h = vpH || vp.h;
  const hint = worldHintNearSpace(sp?.id);
  if (sp && !sp.active) run("space.select", { id: sp.id });
  if (tab?.id) run("tab.select", { id: tab.id });
  if (isFocusMode()) return;
  const existing = findTerminalForTab(sp, tab);
  if (existing) {
    openTerminalWindow(existing, { vpW: w, vpH: h, ...(hint || {}) });
    return;
  }
  if (!cx?.spawn) return;
  cx.spawn(async (asyncCx) => {
    await asyncCx.sleep(160);
    if (isFocusMode()) return;
    const freshSp = (sp?.id && (spaces() || []).find((s) => s.id === sp.id)) || sp;
    const freshTab = (tab?.id && (freshSp?.tabs || []).find((tb) => tb.id === tab.id)) || tab;
    const addr = findTerminalForTab(freshSp, freshTab);
    if (addr) {
      openTerminalWindow(addr, { vpW: w, vpH: h, ...(hint || {}) });
      asyncCx.notify();
    }
  });
}

export function findTerminalForSpace(sp) {
  if (!sp) return null;
  const foc = focused();
  if (foc?.terminal && foc.space === sp.id) return foc.terminal;

  const allPanes = panes() || [];
  const tabs = Array.isArray(sp.tabs) ? sp.tabs : [];
  const activeTab = tabs.find((tb) => tb.active) ?? tabs[0];
  if (activeTab) {
    const activePane = allPanes.find((p) => p?.terminal && p.tab === activeTab.id);
    if (activePane) return activePane.terminal;
  }
  for (const tb of tabs) {
    const tbPane = allPanes.find((p) => p?.terminal && p.tab === tb.id);
    if (tbPane) return tbPane.terminal;
  }

  const spAgents = sortAgentsByUrgency((agents() || []).filter((a) => a.space === sp.id));
  if (spAgents.length > 0 && spAgents[0].address) return spAgents[0].address;

  const allTerms = terminals() || [];
  if (activeTab) {
    const tabTerm = allTerms.find((tm) => tm?.address && !tm.parent && terminalMatchesTab(tm, sp, activeTab));
    if (tabTerm) return tabTerm.address;
  }

  const spTerm = allTerms.find((tm) => tm?.address && !tm.parent && terminalMatchesSpace(tm, sp));
  if (spTerm) return spTerm.address;

  const anySpTerm = allTerms.find((tm) => tm?.address && terminalMatchesSpace(tm, sp));
  if (anySpTerm) return anySpTerm.address;

  return null;
}

export function findTerminalForTab(sp, tab) {
  if (!tab) return findTerminalForSpace(sp);
  const tabPane = (panes() || []).find((p) => p?.terminal && p.tab === tab.id);
  if (tabPane) return tabPane.terminal;

  const ag = (agents() || []).find((a) => a.tab === tab.id && a.address);
  if (ag) return ag.address;

  const allTerms = terminals() || [];
  const exact = allTerms.find((tm) => tm?.address && !tm.parent && terminalMatchesTab(tm, sp, tab));
  if (exact) return exact.address;

  const anyTabTerm = allTerms.find((tm) => tm?.address && terminalMatchesTab(tm, sp, tab));
  if (anyTabTerm) return anyTabTerm.address;

  return null;
}

export function findDefaultTerminal() {
  const foc = focused();
  if (foc?.terminal) return foc.terminal;

  const sorted = sortAgentsByUrgency(agents() || []);
  if (sorted.length > 0 && sorted[0].address) return sorted[0].address;

  const allSpaces = spaces() || [];
  const activeSp = allSpaces.find((sp) => sp.active) ?? allSpaces[0];
  const spAddr = findTerminalForSpace(activeSp);
  if (spAddr) return spAddr;

  const firstTerm =
    (terminals() || []).find((tm) => tm?.address && !tm.parent) || (terminals() || [])[0];
  if (firstTerm?.address) return firstTerm.address;

  const firstPane = (panes() || []).find((p) => p.terminal);
  return firstPane?.terminal || null;
}

// --- Clean Agent Names, Urgency Ordering, Sub-Agents & Elapsed Time ---

const KNOWN_AGENT_NAMES = {
  antigravity: "Antigravity",
  agy: "Antigravity",
  claude: "Claude",
  "claude-code": "Claude",
  codex: "Codex",
  opencode: "OpenCode",
  pi: "Pi",
  aider: "Aider",
  gemini: "Gemini",
  goose: "Goose",
  amp: "Amp",
  cursor: "Cursor",
  copilot: "Copilot",
};

export function cleanAgentName(raw) {
  if (!raw || typeof raw !== "string") return "Terminal";
  const trimmed = raw.trim();
  if (!trimmed) return "Terminal";
  const key = trimmed.toLowerCase();
  if (KNOWN_AGENT_NAMES[key]) return KNOWN_AGENT_NAMES[key];
  for (const [k, pretty] of Object.entries(KNOWN_AGENT_NAMES)) {
    if (key === k || key.startsWith(`${k} `) || key.startsWith(`${k}-`)) {
      return pretty;
    }
  }
  return trimmed;
}

export function agentName(ag) {
  if (!ag) return "Agent";
  const raw = ag.program?.name || ag.app || ag.title || "Agent";
  return cleanAgentName(raw);
}

const STATUS_RANK = {
  blocked: 0,
  done: 1,
  working: 2,
  idle: 3,
};

export function sortAgentsByUrgency(list) {
  return [...(list || [])].sort((a, b) => {
    const aBlocked = a.status === "blocked" ? 0 : 1;
    const bBlocked = b.status === "blocked" ? 0 : 1;
    if (aBlocked !== bBlocked) return aBlocked - bBlocked;
    if (Boolean(a.pinned) !== Boolean(b.pinned)) return a.pinned ? -1 : 1;
    const ra = STATUS_RANK[a.status] ?? 4;
    const rb = STATUS_RANK[b.status] ?? 4;
    if (ra !== rb) return ra - rb;
    if ((b.seq ?? 0) !== (a.seq ?? 0)) return (b.seq ?? 0) - (a.seq ?? 0);
    return String(a.address || "").localeCompare(String(b.address || ""));
  });
}

export function syncAgentOrder() {
  const sorted = sortAgentsByUrgency(agents());
  setAgentOrder(sorted.map((a) => a.address));
  return sorted;
}

export function focusNextBlocked(view) {
  const blocked = sortAgentsByUrgency(agents()).filter((a) => a.status === "blocked");
  if (blocked.length === 0) return false;
  const idx = (view.blockedCursor || 0) % blocked.length;
  view.blockedCursor = idx + 1;
  const target = blocked[idx];
  if (isFocusMode()) {
    run("agent.focus", { terminal: target.address });
  } else {
    const openWins = readOpenWins();
    const rec = openWins[target.address];
    const cam = readCamera();
    if (rec && ((cam.zoom || 1.0) < LIVE_ZOOM_MIN || rec.suspended || !rec.overlayId)) {
      dispatchCosmosAction({ type: "focus-world-window", kind: "terminal", id: target.address });
    } else {
      openTerminalWindow(target.address);
    }
  }
  return true;
}

export function groupSubAgents(agentList, termList) {
  const byParent = new Map();
  const allSubAgents = [];
  const agentAddrs = new Set((agentList || []).map((a) => a.address).filter(Boolean));
  const terms = Array.isArray(termList) ? termList : terminals();

  for (const term of terms || []) {
    if (!term || !term.parent || !term.address) continue;
    if (term.parent === term.address) continue;
    const parentAddr = agentAddrs.has(term.parent) ? term.parent : null;
    allSubAgents.push(term);
    if (parentAddr) {
      if (!byParent.has(parentAddr)) byParent.set(parentAddr, []);
      byParent.get(parentAddr).push(term);
    }
  }

  return { byParent, allSubAgents };
}

export function findTabForAgent(ag, allSpaces) {
  if (!ag) return null;
  for (const sp of allSpaces || []) {
    if (sp.id !== ag.space) continue;
    for (const tb of sp.tabs || []) {
      if (tb.id === ag.tab) return tb;
    }
  }
  return null;
}

export function formatElapsed(sinceMs, nowMs = Date.now()) {
  if (typeof sinceMs !== "number" || !Number.isFinite(sinceMs) || sinceMs <= 0) {
    return "";
  }
  const diffSec = Math.max(0, Math.floor((nowMs - sinceMs) / 1000));
  if (diffSec < 60) return `${diffSec}s`;
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `${diffMin}m`;
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return `${diffHr}h`;
  const diffDay = Math.floor(diffHr / 24);
  return `${diffDay}d`;
}

export function agentElapsed(ag, allSpaces, termMap) {
  if (!ag || !ag.address) return "";
  const now = Date.now();
  const sig = `${ag.status}:${ag.seq ?? 0}`;
  if (agentStatusSig.get(ag.address) !== sig) {
    agentStatusSig.set(ag.address, sig);
    const tab = findTabForAgent(ag, allSpaces);
    const term = termMap?.get(ag.address);
    const knownTs =
      (ag.status === "working" && tab?.working_since) ||
      tab?.changed_at ||
      term?.changed_at ||
      term?.started_at ||
      now;
    agentSeenAt.set(ag.address, knownTs);
  }
  const tab = findTabForAgent(ag, allSpaces);
  const since =
    (ag.status === "working" && tab?.working_since) ||
    agentSeenAt.get(ag.address) ||
    tab?.changed_at ||
    now;
  return formatElapsed(since, now);
}

export function agentLocation(ag, allSpaces) {
  if (!ag) return "";
  const sp = (allSpaces || []).find((s) => s.id === ag.space);
  const spName = sp
    ? sp.machine
      ? `${sp.machine}:${sp.name || "space"}`
      : sp.name || "space"
    : ag.space_name || "";
  const tabLabel = ag.tab_name || (ag.tab_index ? String(ag.tab_index) : "");
  return [spName, tabLabel].filter(Boolean).join(" · ");
}

export function agentActivity(ag, termMap) {
  if (!ag) return "";
  const term = termMap?.get(ag.address);
  const report = typeof term?.report === "string" ? term.report.trim() : "";
  if (report) return report;
  const title = typeof ag.title === "string" ? ag.title.trim() : "";
  const name = agentName(ag);
  if (title && title.toLowerCase() !== name.toLowerCase()) return title;
  return "";
}

export function agentTooltip(ag, allSpaces, termMap) {
  const loc = agentLocation(ag, allSpaces);
  const name = agentName(ag);
  const st = ag?.status || "idle";
  const act = agentActivity(ag, termMap);
  const elapsed = agentElapsed(ag, allSpaces, termMap);
  const head = [name, elapsed ? `${st} (${elapsed})` : st, loc].filter(Boolean).join(" · ");
  const body = act ? `\n${act}` : "";
  return `${head}${body}\nclick: open window · right-click: peek`;
}

export function spaceTooltip(sp, gitBySpace) {
  if (!sp) return "";
  const gi = gitBySpace?.[sp.id];
  const branch = gi?.branch || sp.branch || "";
  const dirty = gi?.dirtyCount ? ` · ${gi.dirtyCount} modified` : "";
  const tabCount = (sp.tabs || []).length;
  const tabText = `${tabCount} terminal${tabCount === 1 ? "" : "s"}`;
  const title = spaceDisplayName(sp);
  const lines = [
    `${title}${branch ? ` (${branch}${dirty})` : ""} · ${tabText}`,
    shortFolder(sp.folder || ""),
    "click: open · right-click: space menu · double-click: rename",
  ].filter(Boolean);
  return lines.join("\n");
}

// --- Throttled Git Polling (15s on active space) ---

export function resolveActiveGitTarget() {
  const allSpaces = spaces() || [];
  const foc = focused();
  const activeSpace =
    (foc?.space && allSpaces.find((sp) => sp.id === foc.space)) ||
    allSpaces.find((sp) => sp.active) ||
    allSpaces[0];
  if (!activeSpace) {
    return { spaceId: "", cwd: "", machine: null, fallbackBranch: "" };
  }
  const spaceTabIds = new Set((activeSpace.tabs || []).map((tb) => tb?.id).filter(Boolean));
  const allPanes = panes() || [];
  const focPane =
    allPanes.find((p) => p.focused && spaceTabIds.has(p.tab)) ??
    allPanes.find((p) => spaceTabIds.has(p.tab) && p.cwd) ??
    null;
  const focCwdMatches = Boolean(foc?.cwd) && foc.space === activeSpace.id;
  const cwd = (focCwdMatches ? foc.cwd : "") || focPane?.cwd || activeSpace.folder || "";
  const machine = activeSpace.machine ?? null;
  const fallbackBranch = focPane?.branch || activeSpace.branch || "";
  const spaceId = activeSpace.id || "";
  return { spaceId, cwd, machine, fallbackBranch };
}

export async function pollGitStatus() {
  const { spaceId, cwd, machine, fallbackBranch } = resolveActiveGitTarget();
  if (!cwd) return null;
  if (machine) {
    const machRec = (machines() || []).find((m) => m && m.name === machine);
    if (machRec && machRec.layout !== "ready") return null;
  }
  const seq = ++gitPollSeq;

  try {
    const [statusRes, logRes] = await Promise.all([
      exec("git", ["status", "--porcelain=v1", "-b"], { cwd, on: machine, timeout: 4000 }),
      exec("git", ["log", "-1", "--format=%h\x1f%s"], { cwd, on: machine, timeout: 4000 }).catch(
        () => ({ code: 1, stdout: "", stderr: "" })
      ),
    ]);
    // Drop stale response if another poll started or user switched space/cwd mid-flight
    if (seq !== gitPollSeq) return null;
    const latestTarget = resolveActiveGitTarget();
    if (latestTarget.spaceId !== spaceId || latestTarget.cwd !== cwd) return null;

    if (statusRes.code !== 0) {
      const prev = readGitInfo();
      if (
        prev.spaceId === spaceId &&
        prev.cwd === cwd &&
        !prev.branch &&
        prev.dirtyCount === 0 &&
        !prev.commitSha
      ) {
        return prev;
      }
      const empty = { ...DEFAULT_GIT, spaceId, cwd, updatedAt: Date.now() };
      setShared(GIT_KEY, empty);
      return empty;
    }

    const lines = String(statusRes.stdout || "")
      .split(/\r?\n/)
      .filter((l) => l.length > 0);

    let branch = fallbackBranch;
    let dirtyCount = 0;
    for (const line of lines) {
      if (line.startsWith("## ")) {
        const raw = line.slice(3).trim();
        const cleaned = raw
          .replace(/^No commits yet on /, "")
          .replace(/^Initial commit on /, "")
          .split("...")[0]
          .split(" ")[0]
          .trim();
        if (cleaned && cleaned !== "HEAD") branch = cleaned;
      } else {
        dirtyCount++;
      }
    }

    let commitSha = "";
    let commitSubject = "";
    if (logRes && logRes.code === 0 && logRes.stdout) {
      const [sha, subj] = String(logRes.stdout).trim().split("\x1f");
      commitSha = (sha || "").trim();
      commitSubject = (subj || "").trim();
    }

    const prev = readGitInfo();
    const changed =
      prev.spaceId !== spaceId ||
      prev.cwd !== cwd ||
      prev.branch !== branch ||
      prev.dirtyCount !== dirtyCount ||
      prev.commitSha !== commitSha ||
      prev.commitSubject !== commitSubject;

    if (!changed) return prev;

    const next = {
      spaceId,
      branch,
      dirtyCount,
      commitSha,
      commitSubject,
      cwd,
      updatedAt: Date.now(),
    };
    setShared(GIT_KEY, next);
    return next;
  } catch (_err) {
    return null;
  }
}

// --- Async Installed Agents Loader ---

export function loadKnownAgents(view, cx, machine) {
  const seq = (view.agentSeq = (view.agentSeq || 0) + 1);
  view.agentLoading = true;
  view.agentError = "";
  view.agentMachine = machine ?? null;
  view.agentLoaded = true;

  cx.spawn(async (asyncCx) => {
    try {
      const list = await knownAgents({ on: machine ?? null });
      if (view.agentSeq !== seq) return;
      view.agentLoading = false;
      view.agentList = Array.isArray(list) ? list : [];
      view.agentError = "";
      asyncCx.notify();
    } catch (err) {
      if (view.agentSeq !== seq) return;
      view.agentLoading = false;
      view.agentList = [];
      view.agentError = String(err?.message || err || "could not list agents");
      asyncCx.notify();
    }
  });
}

// --- Multi-Machine SSH Discovery & Management ---

export async function pollMachinesList() {
  const seq = ++machinesPollSeq;
  try {
    const res = await hc(["machine", "ls", "--json"]);
    if (seq !== machinesPollSeq || !res || res.code !== 0) return null;
    const parsed = JSON.parse(res.stdout || "{}");
    const rawList = Array.isArray(parsed?.machines) ? parsed.machines : [];
    const normalized = rawList
      .filter((m) => m && typeof m.name === "string" && m.name.trim() && !m.temporary)
      .map((m) => ({
        name: String(m.name).trim(),
        state: typeof m.state === "string" ? m.state : "unknown",
        host:
          typeof m.target === "string"
            ? m.target
            : typeof m.host === "string"
              ? m.host
              : "",
        via: Boolean(m.via),
        session: typeof m.session === "string" ? m.session : "",
        why: typeof m.why === "string" ? m.why : "",
      }));
    const prev = shared(MACHINES_KEY);
    const prevJson = JSON.stringify(Array.isArray(prev) ? prev : []);
    const nextJson = JSON.stringify(normalized);
    if (prevJson !== nextJson) {
      setShared(MACHINES_KEY, normalized);
    }
    return normalized;
  } catch (_err) {
    return null;
  }
}

export function readMachinesList() {
  const rawHc = shared(MACHINES_KEY);
  const hcList = Array.isArray(rawHc) ? rawHc : [];
  const layoutList = machines() || [];
  const allSpaces = spaces() || [];

  const hcByName = new Map();
  for (const m of hcList) {
    if (m && typeof m.name === "string" && m.name) {
      hcByName.set(m.name, m);
    }
  }

  const layoutByName = new Map();
  let localLayout = "ready";
  for (const m of layoutList) {
    if (!m) continue;
    if (m.name === null || m.name === "") {
      localLayout = m.layout || "ready";
    } else {
      layoutByName.set(m.name, m.layout || "unavailable");
    }
  }

  const spaceCountByName = new Map();
  let localSpaceCount = 0;
  for (const sp of allSpaces) {
    if (!sp) continue;
    if (sp.machine) {
      spaceCountByName.set(sp.machine, (spaceCountByName.get(sp.machine) || 0) + 1);
    } else {
      localSpaceCount++;
    }
  }

  const remoteNames = new Set([
    ...hcByName.keys(),
    ...layoutByName.keys(),
    ...spaceCountByName.keys(),
  ]);

  const result = [
    {
      name: null,
      label: "This computer",
      isLocal: true,
      state: "connected",
      layout: localLayout,
      host: "",
      via: false,
      session: "",
      why: "",
      spaceCount: localSpaceCount,
    },
  ];

  for (const name of [...remoteNames].sort()) {
    const hcRec = hcByName.get(name) || null;
    const hasLiveLayout = layoutByName.has(name);
    const layoutState = hasLiveLayout
      ? layoutByName.get(name)
      : hcRec?.state === "connected"
        ? "ready"
        : "unavailable";
    const inferredState =
      hcRec?.state ||
      (layoutState === "ready" ? "connected" : layoutState === "loading" ? "connecting" : "asleep");
    result.push({
      name,
      label: name,
      isLocal: false,
      state: inferredState,
      layout: layoutState,
      hasLiveLayout,
      host: hcRec?.host || "",
      via: Boolean(hcRec?.via),
      session: hcRec?.session || "",
      why: hcRec?.why || "",
      spaceCount: spaceCountByName.get(name) || 0,
    });
  }

  return result;
}

export function machineStatusInfo(m, t = {}) {
  if (!m || m.isLocal) {
    return {
      dotColor: t.done || "#5fd4b8",
      label: "connected",
      connected: true,
      needsLogin: false,
      loading: false,
      rebuilt: false,
    };
  }
  const st = m.state || "asleep";
  const layoutState = m.layout || "unavailable";
  const rebuilt =
    st === "unreachable" && /^a different core answers there \("[^"]+"\)$/.test(m.why || "");

  if (st === "needs_login") {
    return {
      dotColor: t.blocked || "#f06449",
      label: "needs login",
      connected: false,
      needsLogin: true,
      loading: false,
      rebuilt: false,
    };
  }
  if (rebuilt) {
    return {
      dotColor: t.blocked || "#f06449",
      label: "rebuilt",
      connected: false,
      needsLogin: false,
      loading: false,
      rebuilt: true,
    };
  }
  if (layoutState === "loading" || st === "connecting") {
    return {
      dotColor: t.working || "#e8a849",
      label: "loading",
      connected: false,
      needsLogin: false,
      loading: true,
      rebuilt: false,
    };
  }
  if (layoutState === "ready" || (st === "connected" && !m.hasLiveLayout)) {
    return {
      dotColor: t.done || "#5fd4b8",
      label: "connected",
      connected: true,
      needsLogin: false,
      loading: false,
      rebuilt: false,
    };
  }
  return {
    dotColor: t.dim || "#4d5870",
    label: layoutState === "unavailable" && st === "connected" ? "offline" : st.replace(/_/g, " "),
    connected: false,
    needsLogin: false,
    loading: false,
    rebuilt: false,
  };
}

export function openAddMachineDialog() {
  run("mod.open", { name: "machine-add" });
}

export function openMachinesSettings() {
  run("app.settings", { section: "machines" });
}

export function removeMachine(cx, name) {
  if (!name) return;
  const runRm = async (asyncCx) => {
    let ok = false;
    try {
      const res = await hc(["machine", "rm", name, "--json"]);
      ok = Boolean(res && res.code === 0);
    } catch (_err) {
      // Ignore transient CLI error
    }
    if (ok) {
      const prefix = `${name}/`;
      const spPos = readSpacePositions();
      let spChanged = false;
      for (const id of Object.keys(spPos)) {
        if (id.startsWith(prefix)) {
          delete spPos[id];
          spChanged = true;
        }
      }
      if (spChanged) setShared(SPACE_POS_KEY, spPos);

      const wins = readOpenWins();
      let winChanged = false;
      for (const [addr, rec] of Object.entries(wins)) {
        if (addr.startsWith(prefix)) {
          if (rec?.overlayId) {
            try {
              closeOverlay(rec.overlayId);
            } catch (_e) {
              // ignore
            }
          }
          delete wins[addr];
          winChanged = true;
        }
      }
      if (winChanged) setShared(OPEN_WINS_KEY, wins);
    }
    await pollMachinesList();
    asyncCx?.notify?.();
  };
  if (cx?.spawn) {
    cx.spawn(runRm);
  } else {
    runRm(null);
  }
}

export function reconnectMachine(cx, name) {
  if (!name) return;
  const rec = readMachinesList().find((m) => !m.isLocal && m.name === name) || null;
  const info = machineStatusInfo(rec);

  if (info.needsLogin) {
    const localSpace = (spaces() || []).find((sp) => !sp.machine) || null;
    if (localSpace && cx?.spawn) {
      const vp = getViewportDims();
      spawnTerminalInSpace(cx, localSpace.id, {
        argv: ["hc", "machine", "login", name],
        name: `login:${name}`,
        vpW: vp.w,
        vpH: vp.h,
      });
    } else {
      openMachinesSettings();
    }
    return;
  }

  if (info.rebuilt && rec?.host && cx?.spawn) {
    cx.spawn(async (asyncCx) => {
      try {
        const rmRes = await hc(["machine", "rm", name, "--json"]);
        if (!rmRes || rmRes.code !== 0) {
          openMachinesSettings();
          return;
        }
        const addArgs = ["machine", "add"];
        if (rec.via) addArgs.push("--via", rec.host);
        else addArgs.push(rec.host);
        addArgs.push("--name", name);
        if (rec.session) addArgs.push("--session", rec.session);
        addArgs.push("--json");
        const addRes = await hc(addArgs);
        if (!addRes || addRes.code !== 0) {
          openMachinesSettings();
        }
      } catch (_err) {
        openMachinesSettings();
      }
      await pollMachinesList();
      asyncCx.notify();
    });
    return;
  }

  // Try refreshing first; open Machines settings so user can inspect / reconnect / login.
  openMachinesSettings();
  if (cx?.spawn) {
    cx.spawn(async (asyncCx) => {
      await pollMachinesList();
      asyncCx.notify();
    });
  }
}

export function spawnAgentOnMachine(cx, machineName, opts = {}) {
  const allSpaces = spaces() || [];
  const existing = allSpaces.find((sp) => (sp.machine || null) === (machineName || null)) || null;
  if (existing) {
    spawnTerminalInSpace(cx, existing.id, opts);
    return;
  }
  spawnNewSpace(cx, {
    machine: machineName || "",
    argv: opts.argv,
    tab: opts.name,
    vpW: opts.vpW,
    vpH: opts.vpH,
  });
}

// --- Local Clock Helper (HH:MM) ---

export function formatClockHHMM(now = new Date()) {
  const hh = String(now.getHours()).padStart(2, "0");
  const mm = String(now.getMinutes()).padStart(2, "0");
  return `${hh}:${mm}`;
}
