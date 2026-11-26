// Orrery Always-On-Top Bottom-Left Floating `≡` Trigger (`role: "menubtn"`).
// Minimal 36×36 translucent corner orb raised above floating windows — no full-width bottom bar.
// Clicking `≡` (or pressing Alt+Space) opens the always-on-top `kind: "popup"` Start/Launcher Menu.

import { div } from "gpui-kit";
import { h_flex } from "gpui-base";
import { theme } from "herdr";
import {
  CLEAR,
  getViewportDims,
  isLauncherOpen,
  MONO,
  toggleLauncherPopup,
  withAlpha,
} from "../state.js";

function stopProp(_e, cx) {
  cx.stop_propagation();
}

export function renderMenubtn(_view, _cx) {
  const t = theme() ?? {};
  const open = isLauncherOpen();
  const accent = t.accent || "#e8a849";

  return h_flex()
    .id("orrery-menu-btn-root")
    .relative()
    .size_full()
    .items_center()
    .justify_center()
    .bg(open ? withAlpha(accent, "24") : withAlpha(t.chrome || "#090d17", "DC"))
    .border_1()
    .border_color(open ? accent : withAlpha(t.border || "#1f2b40", "CC"))
    // Stop propagation on mouse-down so this floating trigger can NEVER be dragged
    .on_mouse_down("left", stopProp)
    .on_mouse_down("right", stopProp)
    .on_mouse_down("middle", stopProp)
    .child(
      h_flex()
        .id("orrery-menu-btn-trigger")
        .size_full()
        .items_center()
        .justify_center()
        .bg(CLEAR)
        .font_family(MONO)
        .text_size(14)
        .line_height("16px")
        .text_color(open ? accent : t.foreground || "#e4dfd3")
        .cursor_pointer()
        .hover((st) => st.bg(withAlpha(t.hover || "#172236", "EE")).text_color(accent))
        .tooltip("Spaces, Machines, Windows & Apps (Alt+Space)")
        .on_mouse_down("left", stopProp)
        .on_mouse_down("right", stopProp)
        .on_mouse_down("middle", stopProp)
        .on_click((_e, c) => {
          c.stop_propagation();
          const vp = getViewportDims();
          toggleLauncherPopup(vp.w, vp.h, { fromClick: true });
          c.notify();
        })
        .child("≡")
    )
    .when(open, (el) =>
      el.child(
        div()
          .absolute()
          .bottom(0)
          .left(0)
          .right(0)
          .h(2)
          .bg(accent)
      )
    );
}
