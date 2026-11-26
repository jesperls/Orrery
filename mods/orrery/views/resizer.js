// Orrery Full-Screen 60fps Live Wireframe Move & 8-Way Resize Overlay (`role: "resizer"`).
// Supports two seamless modes:
//   - `mode: "move"`   : Titlebar drag — tracks exact screen `(x, y)` and syncs true world `(wx, wy)`
//   - `mode: "resize"` : 8-way border/corner resize (`n|s|e|w|ne|nw|se|sw`) anchoring opposite edge
// Renders a crisp 1px amber wireframe outline + coordinate/size badge across the full viewport
// (no bottom taskbar reserve!). Commits on left mouse-up; right-click or Escape cancels.

import { div } from "gpui-kit";
import { closeOverlay, props, theme } from "herdr";
import {
  applyWindowMove,
  applyWindowResize,
  CLEAR,
  getViewportDims,
  MONO,
  withAlpha,
} from "../state.js";

const EDGE_MARGIN = 8;
const MOVE_THRESHOLD = 4;

function minDimsForKind(winKind) {
  if (winKind === "note") return { minW: 260, minH: 180 };
  if (winKind === "tool") return { minW: 280, minH: 200 };
  return { minW: 300, minH: 200 };
}

function applyCursor(el, mode, dir) {
  if (mode === "move") return el.cursor_grabbing();
  if (dir === "nw" || dir === "se") return el.cursor_nwse_resize();
  if (dir === "ne" || dir === "sw") return el.cursor_nesw_resize();
  if (dir === "n" || dir === "s") return el.cursor_ns_resize();
  return el.cursor_ew_resize();
}

function computePreviewRect(view, p, overridePos = null) {
  const vp = getViewportDims();
  const vpW = Math.max(480, view.vpW || vp.w || 1600);
  const vpH = Math.max(320, view.vpH || vp.h || 1000);
  const { minW, minH } = minDimsForKind(p.winKind);
  const mode = p.mode === "move" ? "move" : "resize";
  const dir = typeof p.dir === "string" && p.dir ? p.dir : "se";

  const startX =
    typeof p.winX === "number" && Number.isFinite(p.winX)
      ? Math.max(EDGE_MARGIN, Math.round(p.winX))
      : EDGE_MARGIN;
  const startY =
    typeof p.winY === "number" && Number.isFinite(p.winY)
      ? Math.max(EDGE_MARGIN, Math.round(p.winY))
      : EDGE_MARGIN;
  const maxAllowedW = Math.max(minW, vpW - EDGE_MARGIN * 2);
  const maxAllowedH = Math.max(minH, vpH - EDGE_MARGIN * 2);
  const startW = Math.max(minW, Math.min(maxAllowedW, Math.round(p.startW || 600)));
  const startH = Math.max(minH, Math.min(maxAllowedH, Math.round(p.startH || 400)));
  const startMX = typeof p.startMouseX === "number" ? p.startMouseX : 0;
  const startMY = typeof p.startMouseY === "number" ? p.startMouseY : 0;

  const curMX =
    typeof overridePos?.x === "number"
      ? overridePos.x
      : typeof view.curMouseX === "number"
        ? view.curMouseX
        : startMX;
  const curMY =
    typeof overridePos?.y === "number"
      ? overridePos.y
      : typeof view.curMouseY === "number"
        ? view.curMouseY
        : startMY;

  const dx = curMX - startMX;
  const dy = curMY - startMY;
  const movedDist = Math.hypot(dx, dy);
  const maxRight = Math.max(EDGE_MARGIN + minW, vpW - EDGE_MARGIN);
  const maxBottom = Math.max(EDGE_MARGIN + minH, vpH - EDGE_MARGIN);

  if (mode === "move") {
    const newX = Math.max(EDGE_MARGIN, Math.min(Math.max(EDGE_MARGIN, vpW - startW - EDGE_MARGIN), Math.round(startX + dx)));
    const newY = Math.max(EDGE_MARGIN, Math.min(Math.max(EDGE_MARGIN, vpH - startH - EDGE_MARGIN), Math.round(startY + dy)));
    return { newX, newY, newW: startW, newH: startH, mode, dir, movedDist };
  }

  let newX = startX;
  let newY = startY;
  let newW = startW;
  let newH = startH;

  if (dir.includes("e")) {
    const maxW = Math.max(minW, maxRight - startX);
    newW = Math.max(minW, Math.min(maxW, Math.round(startW + dx)));
  }

  if (dir.includes("s")) {
    const maxH = Math.max(minH, maxBottom - startY);
    newH = Math.max(minH, Math.min(maxH, Math.round(startH + dy)));
  }

  if (dir.includes("w")) {
    const rightEdge = Math.min(maxRight, startX + startW);
    const maxW = Math.max(minW, rightEdge - EDGE_MARGIN);
    newW = Math.max(minW, Math.min(maxW, Math.round(startW - dx)));
    newX = Math.max(EDGE_MARGIN, Math.round(rightEdge - newW));
  }

  if (dir.includes("n")) {
    const bottomEdge = Math.min(maxBottom, startY + startH);
    const maxH = Math.max(minH, bottomEdge - EDGE_MARGIN);
    newH = Math.max(minH, Math.min(maxH, Math.round(startH - dy)));
    newY = Math.max(EDGE_MARGIN, Math.round(bottomEdge - newH));
  }

  return { newX, newY, newW, newH, mode, dir, movedDist };
}

export function renderResizer(view, _cx) {
  const t = theme() ?? {};
  const p = props() ?? {};
  const overlayId = p.overlay || "";
  const accent = t.accent || "#e8a849";

  const { newX, newY, newW, newH, mode, dir, movedDist } = computePreviewRect(view, p);

  const cancel = () => {
    if (overlayId) {
      try {
        closeOverlay(overlayId);
      } catch (_err) {
        // Ignore already-closed overlay
      }
    }
  };

  const commit = (overridePos = null) => {
    const finalRect = computePreviewRect(view, p, overridePos);
    cancel();
    if (!p.targetId) return;
    if (finalRect.movedDist < MOVE_THRESHOLD) return;
    if (finalRect.mode === "move") {
      applyWindowMove(
        p.winKind || "terminal",
        p.targetId,
        finalRect.newX,
        finalRect.newY,
        finalRect.newW,
        finalRect.newH,
        p.targetOverlayId || null
      );
    } else {
      applyWindowResize(
        p.winKind || "terminal",
        p.targetId,
        finalRect.newX,
        finalRect.newY,
        finalRect.newW,
        finalRect.newH,
        p.targetOverlayId || null
      );
    }
  };

  const showWireframe = movedDist >= MOVE_THRESHOLD;
  const badgeText = mode === "move" ? `${newX}, ${newY}` : `${newW} × ${newH}`;

  let root = div()
    .id("orrery-resizer-capture")
    .relative()
    .size_full()
    .bg(CLEAR)
    .on_scroll_wheel((_e, c) => c.stop_propagation())
    .on_size_change((sz) => {
      if (sz && sz.width > 120 && sz.height > 120) {
        view.vpW = sz.width;
        view.vpH = sz.height;
      }
    })
    .on_mouse_down("left", (_e, c) => {
      c.stop_propagation();
      if (Date.now() - (view.resizerOpenedAt || 0) > 160) {
        cancel();
      }
    })
    .on_mouse_down("right", (_e, c) => {
      c.stop_propagation();
      cancel();
    })
    .on_mouse_move((e, c) => {
      if (e?.position) {
        view.curMouseX = e.position.x;
        view.curMouseY = e.position.y;
        c.notify();
      }
    })
    .on_mouse_up("left", (e, c) => {
      c.stop_propagation();
      commit(e?.position || null);
    })
    .on_key_down((e, c) => {
      if (e?.key === "escape" || e?.keystroke === "escape") {
        c.stop_propagation();
        cancel();
      } else if (e?.key === "enter" || e?.keystroke === "enter") {
        c.stop_propagation();
        commit();
      }
    })
    .when(showWireframe, (el) =>
      el.child(
        div()
          .id("orrery-resizer-wireframe")
          .absolute()
          .left(newX)
          .top(newY)
          .w(newW)
          .h(newH)
          .border_1()
          .border_color(accent)
          .bg(withAlpha(accent, "12"))
          .child(
            div()
              .id("orrery-resizer-badge")
              .absolute()
              .right(6)
              .bottom(6)
              .px(7)
              .py(2)
              .bg(t.popover || "#0e1524")
              .border_1()
              .border_color(accent)
              .font_family(MONO)
              .text_size(11)
              .line_height("15px")
              .font_bold()
              .text_color(accent)
              .whitespace_nowrap()
              .child(badgeText)
          )
      )
    );

  root = applyCursor(root, mode, dir);
  return view.resizerFocus ? root.track_focus(view.resizerFocus) : root;
}
