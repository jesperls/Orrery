// Orrery Native 8-Way Window Border & Corner Resize Strip (`role: "edge"`).
// Mounted on all 4 sides (5px hairline zones) of every floating terminal, desktop app,
// and Scratchpad Note window in a sleek 3×3 native frame — zero chunky bottom bar.
//
// Sides:
//   - "top"    : [nw 14px] [n flex_1] [ne 14px]
//   - "bottom" : [sw 14px] [s flex_1] [se 14px]
//   - "left"   : [nw  9px] [w flex_1] [sw  9px]  (creates true 14×14 L-shaped corners)
//   - "right"  : [ne  9px] [e flex_1] [se  9px]
//
// Computes exact screen-space `(winX, winY)` directly from `(e.position, e.local_position)`
// so resizing works pixel-accurately even after the user drags the window anywhere on screen.

import { div } from "gpui-kit";
import { h_flex, v_flex } from "gpui-base";
import { openOverlay, props, theme } from "herdr";
import { CLEAR, dispatchCosmosAction, getWindowDimensions, scaleWindowByFactor, withAlpha } from "../state.js";

const EDGE = 5;
const CORNER = 14;
const SIDE_CORNER = 9;
const BORDER_PX = 1;

function applyResizeCursor(el, dir) {
  if (dir === "nw" || dir === "se") return el.cursor_nwse_resize();
  if (dir === "ne" || dir === "sw") return el.cursor_nesw_resize();
  if (dir === "n" || dir === "s") return el.cursor_ns_resize();
  return el.cursor_ew_resize();
}

export function renderEdge(view, _cx) {
  const t = theme() ?? {};
  const p = props() ?? {};
  const side = p.side || "bottom";
  const winKind = p.winKind || "terminal";
  const targetId = p.targetId || "";
  const overlayId = p.overlay || "";

  const accent = t.accent || "#e8a849";
  const hoverTint = withAlpha(accent, "30");

  const startResize = (dir, zone, e, c) => {
    c.stop_propagation();

    const mx = e?.position?.x ?? 0;
    const my = e?.position?.y ?? 0;
    const hasLocal =
      typeof e?.local_position?.x === "number" && typeof e?.local_position?.y === "number";
    const lx = hasLocal ? e.local_position.x : 0;
    const ly = hasLocal ? e.local_position.y : 0;

    const stored = getWindowDimensions(winKind, targetId, p.width, p.height);
    let curW = stored.width;
    let curH = stored.height;

    // Cross-check with measured edge dimensions when available
    if ((side === "top" || side === "bottom") && view.edgeW > 120) {
      curW = Math.max(240, Math.round(view.edgeW + BORDER_PX * 2));
    } else if ((side === "left" || side === "right") && view.edgeH > 120) {
      curH = Math.max(180, Math.round(view.edgeH + EDGE * 2 + BORDER_PX * 2));
    }

    let winX = stored.rec?.x ?? 8;
    let winY = stored.rec?.y ?? 8;

    if (hasLocal) {
      if (side === "top" || side === "bottom") {
        if (side === "top") {
          winY = Math.round(my - ly - BORDER_PX);
        } else {
          const winBottom = my + (EDGE - ly) + BORDER_PX;
          winY = Math.round(winBottom - curH);
        }

        if (zone === "start") {
          winX = Math.round(mx - lx - BORDER_PX);
        } else if (zone === "mid") {
          winX = Math.round(mx - lx - CORNER - BORDER_PX);
        } else {
          const winRight = mx + (CORNER - lx) + BORDER_PX;
          winX = Math.round(winRight - curW);
        }
      } else {
        if (side === "left") {
          winX = Math.round(mx - lx - BORDER_PX);
        } else {
          const winRight = mx + (EDGE - lx) + BORDER_PX;
          winX = Math.round(winRight - curW);
        }

        if (zone === "start") {
          winY = Math.round(my - ly - EDGE - BORDER_PX);
        } else if (zone === "mid") {
          winY = Math.round(my - ly - EDGE - SIDE_CORNER - BORDER_PX);
        } else {
          const winBottom = my + (SIDE_CORNER - ly) + EDGE + BORDER_PX;
          winY = Math.round(winBottom - curH);
        }
      }
    }

    openOverlay({
      kind: "window",
      frame: "none",
      width: 1,
      height: 1,
      at: { x: 0, y: 0 },
      mod: "orrery",
      props: {
        role: "resizer",
        dir,
        winKind,
        targetId,
        targetOverlayId: overlayId,
        winX: Math.max(0, winX),
        winY: Math.max(0, winY),
        startW: curW,
        startH: curH,
        startMouseX: mx,
        startMouseY: my,
      },
    });
  };

  const makeZone = (idSuffix, dir, zone, horizontal) => {
    let el = div()
      .id(`orrery-edge-${side}-${idSuffix}-${winKind}-${targetId || "w"}`)
      .bg(CLEAR)
      .hover((st) => st.bg(hoverTint))
      .on_mouse_down("left", (e, c) => startResize(dir, zone, e, c));

    if (horizontal) {
      el = zone === "mid" ? el.flex_1().h_full() : el.flex_none().w(CORNER).h_full();
    } else {
      el = zone === "mid" ? el.flex_1().w_full() : el.flex_none().w_full().h(SIDE_CORNER);
    }
    return applyResizeCursor(el, dir);
  };

  const onSizeChange = (sz) => {
    if (!sz) return;
    if (sz.width > 0) view.edgeW = sz.width;
    if (sz.height > 0) view.edgeH = sz.height;
  };

  const onWheel = (e, c) => {
    const dy = typeof e?.delta?.y === "number" ? e.delta.y : 0;
    const dx = typeof e?.delta?.x === "number" ? e.delta.x : 0;
    if (Math.abs(dy) < 0.01 && Math.abs(dx) < 0.01) return;
    c.stop_propagation();
    if (e?.modifiers?.control || e?.modifiers?.platform) {
      if (Math.abs(dy) < 0.01) return;
      const clampedDy = Math.max(-160, Math.min(160, dy));
      const step = Math.exp(clampedDy * 0.0018);
      view._pendingScaleFactor = (view._pendingScaleFactor || 1.0) * step;
      if (view._scaleTimer) {
        try {
          view._scaleTimer.cancel();
        } catch (_err) {
          // Ignore finished timer
        }
        view._scaleTimer = null;
      }
      if (c?.timer?.after) {
        view._scaleTimer = c.timer.after(110, () => {
          view._scaleTimer = null;
          const factor = view._pendingScaleFactor || 1.0;
          view._pendingScaleFactor = 1.0;
          scaleWindowByFactor(winKind, targetId, factor, { overlayId });
        });
      } else {
        const factor = view._pendingScaleFactor || 1.0;
        view._pendingScaleFactor = 1.0;
        scaleWindowByFactor(winKind, targetId, factor, { overlayId });
      }
    } else {
      dispatchCosmosAction({
        type: "world-zoom",
        deltaY: dy,
        deltaX: dx,
        x: e?.position?.x,
        y: e?.position?.y,
      });
    }
  };

  if (side === "top") {
    return h_flex()
      .id(`orrery-edge-top-${winKind}-${targetId || "w"}`)
      .size_full()
      .bg(CLEAR)
      .on_size_change(onSizeChange)
      .on_scroll_wheel(onWheel)
      .child(makeZone("nw", "nw", "start", true))
      .child(makeZone("n", "n", "mid", true))
      .child(makeZone("ne", "ne", "end", true));
  }

  if (side === "bottom") {
    return h_flex()
      .id(`orrery-edge-bot-${winKind}-${targetId || "w"}`)
      .size_full()
      .bg(CLEAR)
      .on_size_change(onSizeChange)
      .on_scroll_wheel(onWheel)
      .child(makeZone("sw", "sw", "start", true))
      .child(makeZone("s", "s", "mid", true))
      .child(makeZone("se", "se", "end", true));
  }

  if (side === "left") {
    return v_flex()
      .id(`orrery-edge-left-${winKind}-${targetId || "w"}`)
      .size_full()
      .bg(CLEAR)
      .on_size_change(onSizeChange)
      .on_scroll_wheel(onWheel)
      .child(makeZone("nw", "nw", "start", false))
      .child(makeZone("w", "w", "mid", false))
      .child(makeZone("sw", "sw", "end", false));
  }

  // right
  return v_flex()
    .id(`orrery-edge-right-${winKind}-${targetId || "w"}`)
    .size_full()
    .bg(CLEAR)
    .on_size_change(onSizeChange)
    .on_scroll_wheel(onWheel)
    .child(makeZone("ne", "ne", "start", false))
    .child(makeZone("e", "e", "mid", false))
    .child(makeZone("se", "se", "end", false));
}
