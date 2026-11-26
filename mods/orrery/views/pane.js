// Stark 22px terminal pane header (`pane.header` in focus mode of layouts/orrery.json).
// Crisp 11px monospace: status glyph, program, cwd, branch, +right, +down, zoom/unzoom, x.

import { div } from "gpui-kit";
import { h_flex } from "gpui-base";
import { home, panes, props, run, theme } from "herdr";
import { cleanAgentName, MONO, statusColor, statusGlyph, withAlpha } from "../state.js";

function shortPath(cwd) {
  if (!cwd) return "";
  const norm = String(cwd).replace(/\\/g, "/");
  const homeDir = String(home?.() || "").replace(/\\/g, "/").replace(/\/+$/, "");
  const inHome = Boolean(homeDir) && (norm === homeDir || norm.startsWith(`${homeDir}/`));
  const display = inHome ? `~${norm.slice(homeDir.length)}` : norm;
  const parts = display.split("/").filter(Boolean);
  if (parts.length <= 2) return display;
  return `${inHome ? "~" : "…"}/${parts.slice(-2).join("/")}`;
}

function ctrl(id, label, tip, t, hoverColor, onClick, active = false) {
  return div()
    .id(id)
    .flex_none()
    .px(5)
    .py(1)
    .font_family(MONO)
    .text_size(11)
    .line_height("14px")
    .when(active, (aEl) => aEl.font_bold())
    .text_color(active ? t.accent || "#e8a849" : t.muted || "#8b93a6")
    .cursor_pointer()
    .hover((st) => st.bg(t.hover || "#172236").text_color(hoverColor))
    .tooltip(tip)
    .on_mouse_down("left", (_e, cx) => cx.stop_propagation())
    .on_click((_e, cx) => {
      cx.stop_propagation();
      onClick();
    })
    .child(label);
}

export function renderPane(_cx) {
  const t = theme() ?? {};
  const p = props() ?? {};
  const info = (panes() || []).find((x) => x.pane === p.pane);
  if (!info) {
    return h_flex().size_full().bg(t.surface || "#0b101c");
  }

  const status = info.status;
  const sc = status
    ? statusColor(status, t)
    : info.focused
      ? t.accent || "#e8a849"
      : t.dim || "#4d5870";
  const sg = status ? statusGlyph(status) : info.focused ? ">" : "·";

  const progName = cleanAgentName(info.program?.name || info.mod || "shell");
  const pathLabel = shortPath(info.cwd);
  const rawTitle = (info.title || "").trim();
  const showTitle =
    Boolean(rawTitle) &&
    rawTitle.toLowerCase() !== progName.toLowerCase() &&
    rawTitle !== info.cwd &&
    rawTitle !== pathLabel &&
    !rawTitle.endsWith(pathLabel.replace(/^~/, ""));

  return h_flex()
    .id(`orrery-pane-${info.pane}`)
    .size_full()
    .px(8)
    .gap(8)
    .items_center()
    .justify_between()
    .bg(info.focused ? t.raised || "#131c2e" : t.surface || "#0b101c")
    .border_b_1()
    .border_color(info.focused ? withAlpha(t.accent || "#e8a849", "66") : t.border || "#1f2b40")
    .on_click(() => run("pane.focus", { pane: info.pane }))
    .child(
      h_flex()
        .flex_1()
        .min_w(0)
        .gap(8)
        .items_center()
        .overflow_hidden()
        .child(
          div()
            .id(`orrery-ps-${info.pane}`)
            .flex_none()
            .font_family(MONO)
            .text_size(11)
            .line_height("14px")
            .font_bold()
            .text_color(sc)
            .when(status === "blocked" || status === "working", (el) =>
              el.loop("opacity", {
                from: status === "blocked" ? 0.35 : 0.6,
                to: 1.0,
                period: status === "blocked" ? 800 : 1700,
              })
            )
            .child(sg)
        )
        .child(
          div()
            .flex_none()
            .font_family(MONO)
            .text_size(11)
            .line_height("14px")
            .when(info.focused, (fEl) => fEl.font_bold())
            .text_color(info.focused ? t.foreground || "#e4dfd3" : t.muted || "#8b93a6")
            .whitespace_nowrap()
            .child(progName)
        )
        .when(showTitle, (el) =>
          el.child(
            div()
              .min_w(0)
              .font_family(MONO)
              .text_size(11)
              .line_height("14px")
              .text_color(t.muted || "#8b93a6")
              .truncate()
              .tooltip(rawTitle)
              .child(rawTitle)
          )
        )
        .when(Boolean(pathLabel), (el) =>
          el.child(
            div()
              .min_w(0)
              .font_family(MONO)
              .text_size(11)
              .line_height("14px")
              .text_color(t.dim || "#4d5870")
              .truncate()
              .tooltip(info.cwd)
              .child(pathLabel)
          )
        )
        .when(Boolean(info.branch), (el) =>
          el.child(
            div()
              .flex_none()
              .font_family(MONO)
              .text_size(11)
              .line_height("14px")
              .text_color(t.done || "#5fd4b8")
              .whitespace_nowrap()
              .child(info.branch)
          )
        )
    )
    .child(
      h_flex()
        .flex_none()
        .gap(2)
        .items_center()
        .child(
          ctrl(`orrery-psr-${info.pane}`, "+right", "split right", t, t.done || "#5fd4b8", () =>
            run("pane.split", { pane: info.pane, direction: "right" })
          )
        )
        .child(
          ctrl(`orrery-psd-${info.pane}`, "+down", "split down", t, t.done || "#5fd4b8", () =>
            run("pane.split", { pane: info.pane, direction: "down" })
          )
        )
        .when(Boolean(info.movable || info.zoomed), (zEl) =>
          zEl.child(
            ctrl(
              `orrery-pzm-${info.pane}`,
              info.zoomed ? "unzoom" : "zoom",
              info.zoomed ? "restore zoomed pane" : "zoom pane",
              t,
              t.accent || "#e8a849",
              () => run("pane.zoom", { pane: info.pane }),
              Boolean(info.zoomed)
            )
          )
        )
        .child(
          div()
            .id(`orrery-pcl-${info.pane}`)
            .flex_none()
            .px(6)
            .py(1)
            .font_family(MONO)
            .text_size(12)
            .line_height("14px")
            .text_color(t.muted || "#8b93a6")
            .cursor_pointer()
            .hover((st) => st.bg("#c43e2b").text_color("#ffffff"))
            .tooltip("close pane")
            .on_mouse_down("left", (_e, cx) => cx.stop_propagation())
            .on_click((_e, cx) => {
              cx.stop_propagation();
              run("pane.close", { pane: info.pane });
            })
            .child("×")
        )
    );
}
