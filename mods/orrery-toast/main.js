// Orrery notification toast (`toast` in layouts/orrery.json).
// Zero-radius celestial monospace slip with propagation-safe `x` dismiss.

import { View, div } from "gpui-kit";
import { h_flex, v_flex } from "gpui-base";
import { closeOverlay, props, run, theme } from "herdr";

const MONO = "JetBrains Mono";
const CLEAR = "#00000000";

function withAlpha(hex, aa) {
  if (typeof hex !== "string" || !hex.startsWith("#") || hex.length < 7) {
    return CLEAR;
  }
  return `${hex.slice(0, 7)}${aa}`;
}

function levelInfo(level, t) {
  switch (level) {
    case "error":
      return { glyph: "!", color: t.blocked || "#f06449" };
    case "warning":
      return { glyph: "~", color: t.accent || "#e8a849" };
    case "success":
      return { glyph: "o", color: t.done || "#5fd4b8" };
    default:
      return { glyph: "*", color: t.working || "#e8a849" };
  }
}

export default class OrreryToast extends View {
  render(_cx) {
    const t = theme() ?? {};
    const p = props() ?? {};
    const st = levelInfo(p.level, t);

    return h_flex()
      .id("orrery-toast")
      .relative()
      .size_full()
      .px(12)
      .py(8)
      .gap(10)
      .items_center()
      .bg(t.popover || "#0e1524")
      .border_1()
      .border_color(withAlpha(st.color, "88"))
      .overflow_hidden()
      .cursor_pointer()
      .hover((s) => s.bg(t.hover || "#172236"))
      .on_click(() => {
        if (p.action?.name) run(p.action.name, p.action.args ?? {});
        if (p.overlay) closeOverlay(p.overlay);
      })
      .child(
        div()
          .id("orrery-toast-glyph")
          .flex_none()
          .font_family(MONO)
          .text_size(12)
          .line_height("16px")
          .font_bold()
          .text_color(st.color)
          .loop("opacity", { from: 0.45, to: 1.0, period: 1200 })
          .child(st.glyph)
      )
      .child(
        v_flex()
          .flex_1()
          .min_w(0)
          .gap(2)
          .child(
            div()
              .font_family(MONO)
              .text_size(12)
              .line_height("16px")
              .text_color(t.foreground || "#e4dfd3")
              .truncate()
              .child(p.title || "transmission")
          )
          .when(Boolean(p.body), (el) =>
            el.child(
              div()
                .font_family(MONO)
                .text_size(11)
                .line_height("15px")
                .text_color(t.muted || "#8b93a6")
                .truncate()
                .child(p.body)
            )
          )
      )
      .child(
        div()
          .id("orrery-toast-close")
          .flex_none()
          .px(5)
          .py(2)
          .font_family(MONO)
          .text_size(12)
          .line_height("16px")
          .text_color(t.dim || "#4d5870")
          .cursor_pointer()
          .hover((s) => s.text_color(t.foreground || "#e4dfd3"))
          .on_mouse_down("left", (_e, cx) => cx.stop_propagation())
          .on_click((_e, cx) => {
            cx.stop_propagation();
            if (p.overlay) closeOverlay(p.overlay);
          })
          .child("x")
      );
  }
}
