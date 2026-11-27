// Orrery Windows-Lookalike Desktop App & Note Titlebar (`role: "toolwin"`, 28px).
// World-synced move drag via `resizer` (`mode: "move"`), Ctrl/Cmd+Scroll window scaling,
// and ─ / × controls.

import { div } from "gpui-kit";
import { h_flex } from "gpui-base";
import { agents, openOverlay, props, spaces, theme, window as win } from "herdr";
import {
  closeNoteWindow,
  closeToolWindow,
  getNoteById,
  getViewportDims,
  getWindowDimensions,
  getWindowScale,
  minimizeNoteWindow,
  minimizeToolWindow,
  MONO,
  normalizeToolKind,
  noteTitle,
  openContextPopup,
  resetWindowScale,
  scaleWindowByFactor,
  TOOL_META,
  withAlpha,
} from "../state.js";

const CLOSE_RED = "#c43e2b";
const FRAME_INSET = 6;
const DRAG_THRESHOLD = 4;

function stopProp(_e, cx) {
  cx.stop_propagation();
}

export function renderToolwin(view, _cx) {
  const t = theme() ?? {};
  const p = props() ?? {};
  const isNote = p.tool === "note" || Boolean(p.noteId);
  const noteId = p.noteId || "";
  const tool = isNote ? "note" : normalizeToolKind(p.tool);
  const winKind = isNote ? "note" : "tool";
  const targetId = isNote ? noteId : tool;
  const overlayId = p.overlay || null;

  const allSpaces = spaces() || [];
  const activeSpace = allSpaces.find((sp) => sp.active) ?? allSpaces[0] ?? null;

  let title = "Tool";
  let subtitle = "";

  if (isNote) {
    const note = getNoteById(noteId);
    title = "Note";
    subtitle = noteTitle(note, "untitled");
  } else {
    const meta = TOOL_META[tool] || TOOL_META.files;
    title = meta.title;
    if (tool === "fleet") {
      const agCount = (agents() || []).length;
      subtitle = `${allSpaces.length} space${allSpaces.length === 1 ? "" : "s"} · ${agCount} agent${agCount === 1 ? "" : "s"}`;
    } else if (activeSpace?.name) {
      subtitle = activeSpace.machine
        ? `${activeSpace.machine}:${activeSpace.name}`
        : activeSpace.name;
    }
  }

  const scale = getWindowScale(winKind, targetId);
  const scalePct = Math.round(scale * 100);
  const showScaleBadge = Math.abs(scalePct - 100) >= 3;
  const keySuffix = isNote ? `note-${noteId || "n"}` : tool;
  const modKey = (win()?.platform || "linux") === "macos" ? "Cmd" : "Ctrl";

  const scheduleScale = (deltaY, c) => {
    const clampedDy = Math.max(-160, Math.min(160, deltaY));
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
  };

  return h_flex()
    .id(`orrery-toolwin-${keySuffix}`)
    .size_full()
    .pl(10)
    .pr(0)
    .gap(8)
    .items_center()
    .justify_between()
    .bg(t.chrome || "#090d17")
    .border_b_1()
    .border_color(withAlpha(t.border || "#1f2b40", "CC"))
    .on_mouse_down("left", stopProp)
    .on_mouse_down("right", stopProp)
    .on_mouse_down("middle", stopProp)
    .on_scroll_wheel((e, c) => {
      const dy = typeof e?.delta?.y === "number" ? e.delta.y : 0;
      if (Math.abs(dy) < 0.01) return;
      c.stop_propagation();
      if (e?.modifiers?.control || e?.modifiers?.platform) {
        scheduleScale(dy, c);
      }
    })
    .child(
      h_flex()
        .flex_1()
        .min_w(0)
        .h_full()
        .gap(6)
        .items_center()
        .overflow_hidden()
        .cursor_grab()
        .tooltip(`drag: move · ${modKey.toLowerCase()}+scroll: scale window · right-click: menu`)
        .on_hover((hovered) => {
          if (!hovered) view._pendingMove = null;
        })
        .on_mouse_down_out(() => {
          view._pendingMove = null;
        })
        .on_mouse_down("left", (e, c) => {
          c.stop_propagation();
          if (!targetId) return;
          const mx = e?.position?.x ?? 0;
          const my = e?.position?.y ?? 0;
          const hasLocal =
            typeof e?.local_position?.x === "number" && typeof e?.local_position?.y === "number";
          const stored = getWindowDimensions(winKind, targetId, 440, 400);
          const winX = hasLocal
            ? Math.max(0, Math.round(mx - e.local_position.x - FRAME_INSET - 10))
            : stored.rec?.x ?? Math.max(8, Math.round(mx - 120));
          const winY = hasLocal
            ? Math.max(0, Math.round(my - e.local_position.y - FRAME_INSET))
            : stored.rec?.y ?? Math.max(8, Math.round(my - 14));

          view._pendingMove = {
            winX,
            winY,
            startW: stored.width,
            startH: stored.height,
            startMouseX: mx,
            startMouseY: my,
            startedAt: Date.now(),
          };
        })
        .on_mouse_move((e) => {
          const pm = view._pendingMove;
          if (!pm || !e?.position || !targetId) return;
          if (Date.now() - (pm.startedAt || 0) > 900) {
            view._pendingMove = null;
            return;
          }
          if (Math.hypot(e.position.x - pm.startMouseX, e.position.y - pm.startMouseY) < DRAG_THRESHOLD) {
            return;
          }
          view._pendingMove = null;
          openOverlay({
            kind: "window",
            frame: "none",
            width: 1,
            height: 1,
            at: { x: 0, y: 0 },
            mod: "orrery",
            props: {
              role: "resizer",
              mode: "move",
              winKind,
              targetId,
              targetOverlayId: overlayId,
              winX: pm.winX,
              winY: pm.winY,
              startW: pm.startW,
              startH: pm.startH,
              startMouseX: pm.startMouseX,
              startMouseY: pm.startMouseY,
            },
          });
        })
        .on_mouse_up("left", () => {
          view._pendingMove = null;
        })
        .on_mouse_down("right", (_e, c) => {
          c.stop_propagation();
          view._pendingMove = null;
          if (!targetId) return;
          const vp = getViewportDims();
          openContextPopup({
            kind: "taskbar",
            targetKind: winKind,
            targetId,
            atPointer: true,
            vpW: vp.w,
            vpH: vp.h,
          });
        })
        .child(
          div()
            .flex_none()
            .font_family(MONO)
            .text_size(11)
            .line_height("15px")
            .font_bold()
            .text_color(isNote ? t.done || "#5fd4b8" : t.accent || "#e8a849")
            .child(title)
        )
        .when(Boolean(subtitle), (sEl) =>
          sEl
            .child(
              div()
                .flex_none()
                .font_family(MONO)
                .text_size(11)
                .line_height("15px")
                .text_color(t.dim || "#4d5870")
                .child("·")
            )
            .child(
              div()
                .min_w(0)
                .font_family(MONO)
                .text_size(11)
                .line_height("15px")
                .text_color(t.muted || "#8b93a6")
                .truncate()
                .child(subtitle)
            )
        )
    )
    .child(
      h_flex()
        .flex_none()
        .h_full()
        .items_center()
        .when(showScaleBadge, (el) =>
          el.child(
            h_flex()
              .id(`orrery-tw-scale-${keySuffix}`)
              .flex_none()
              .px(5)
              .h(18)
              .mr(4)
              .items_center()
              .bg(withAlpha(t.accent || "#e8a849", "20"))
              .border_1()
              .border_color(withAlpha(t.accent || "#e8a849", "55"))
              .font_family(MONO)
              .text_size(9)
              .line_height("13px")
              .text_color(t.accent || "#e8a849")
              .cursor_pointer()
              .hover((st) => st.bg(withAlpha(t.accent || "#e8a849", "38")))
              .tooltip(`Window scale ${scalePct}% · ${modKey}+Scroll to adjust · Click to reset to 100%`)
              .on_mouse_down("left", stopProp)
              .on_mouse_down("right", stopProp)
              .on_mouse_down("middle", stopProp)
              .on_click((_e, c) => {
                c.stop_propagation();
                resetWindowScale(winKind, targetId, { overlayId });
              })
              .child(`${scalePct}%`)
          )
        )
        .child(
          h_flex()
            .id(`orrery-toolwin-min-${keySuffix}`)
            .flex_none()
            .w(32)
            .h_full()
            .items_center()
            .justify_center()
            .font_family(MONO)
            .text_size(11)
            .line_height("15px")
            .text_color(t.muted || "#8b93a6")
            .cursor_pointer()
            .hover((st) => st.bg(t.hover || "#172236").text_color(t.foreground || "#e4dfd3"))
            .tooltip(isNote ? "Minimize Note" : `Minimize ${title}`)
            .on_mouse_down("left", stopProp)
            .on_mouse_down("right", stopProp)
            .on_mouse_down("middle", stopProp)
            .on_click((_e, c) => {
              c.stop_propagation();
              if (isNote) {
                minimizeNoteWindow(noteId, overlayId);
              } else {
                minimizeToolWindow(tool, overlayId);
              }
            })
            .child("─")
        )
        .child(
          h_flex()
            .id(`orrery-toolwin-x-${keySuffix}`)
            .flex_none()
            .w(32)
            .h_full()
            .items_center()
            .justify_center()
            .font_family(MONO)
            .text_size(13)
            .line_height("15px")
            .text_color(t.muted || "#8b93a6")
            .cursor_pointer()
            .hover((st) => st.bg(CLOSE_RED).text_color("#ffffff"))
            .tooltip(isNote ? "Close editor (keeps note in space)" : `Close ${title}`)
            .on_mouse_down("left", stopProp)
            .on_mouse_down("right", stopProp)
            .on_mouse_down("middle", stopProp)
            .on_click((_e, c) => {
              c.stop_propagation();
              if (isNote) {
                closeNoteWindow(noteId, overlayId);
              } else {
                closeToolWindow(tool, overlayId);
              }
            })
            .child("×")
        )
    );
}
