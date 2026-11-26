// Orrery terminal right-click context menu (`terminal_menu` in layouts/orrery.json).
// Zero-radius celestial monospace menu; focuses `target.pane` / `target.terminal` before
// focus-scoped actions, supports `terminal.right_click` routing, agent pin, and sub-agent park.

import { View, div } from "gpui-kit";
import { h_flex, v_flex } from "gpui-base";
import { agents, closeOverlay, panes, props, run, terminals, theme } from "herdr";

const MONO = "JetBrains Mono";

export default class OrreryMenu extends View {
  render(_cx) {
    const t = theme() ?? {};
    const p = props() ?? {};
    const target = p.target ?? {};
    const overlay = p.overlay;
    const modelPane = panes().find((x) => x.pane === target.pane) ?? null;
    const agent = agents().find((a) => a.address === target.terminal) ?? null;
    const termInfo = terminals().find((x) => x.address === target.terminal) ?? null;
    const isSubAgent = Boolean(termInfo?.parent);

    const act = (cmd, args) => {
      if (overlay) closeOverlay(overlay);
      run(cmd, args);
    };

    const actFocused = (cmd, args = {}) => {
      if (overlay) closeOverlay(overlay);
      if (modelPane && !modelPane.focused) {
        run("pane.focus", { pane: modelPane.pane });
      } else if (target.terminal) {
        run("pane.focus", { terminal: target.terminal });
      }
      run(cmd, args);
    };

    const row = (id, glyph, label, color, onClick) =>
      h_flex()
        .id(id)
        .w_full()
        .px(8)
        .py(4)
        .gap(8)
        .items_center()
        .cursor_pointer()
        .hover((s) => s.bg(t.hover || "#172236"))
        .on_click(onClick)
        .child(
          div()
            .w(14)
            .font_family(MONO)
            .text_size(11)
            .line_height("15px")
            .text_color(color)
            .child(glyph)
        )
        .child(
          div()
            .font_family(MONO)
            .text_size(12)
            .line_height("16px")
            .text_color(t.foreground || "#e4dfd3")
            .child(label)
        );

    const sep = () => div().w_full().h(1).my(3).bg(t.border || "#1f2b40");

    return v_flex()
      .id("orrery-menu")
      .size_full()
      .p(6)
      .bg(t.popover || "#0e1524")
      .border_1()
      .border_color(t.border || "#1f2b40")
      .overflow_y_scrollbar()
      .child(
        div()
          .px(8)
          .py(4)
          .font_family(MONO)
          .text_size(11)
          .line_height("15px")
          .text_color(t.muted || "#8b93a6")
          .truncate()
          .child(`* ${modelPane?.program?.name || termInfo?.program?.name || target.terminal || "terminal"}`)
      )
      .child(sep())
      .child(row("om-copy", "c", "copy", t.accent || "#e8a849", () => actFocused("terminal.copy")))
      .child(row("om-paste", "v", "paste", t.accent || "#e8a849", () => actFocused("terminal.paste")))
      .child(row("om-search", "/", "search", t.done || "#5fd4b8", () => actFocused("terminal.search")))
      .child(
        h_flex()
          .id("om-rclick")
          .w_full()
          .px(8)
          .py(4)
          .gap(6)
          .items_center()
          .justify_between()
          .child(
            div()
              .font_family(MONO)
              .text_size(11)
              .line_height("15px")
              .text_color(t.muted || "#8b93a6")
              .child("right-click")
          )
          .child(
            h_flex()
              .gap(8)
              .child(
                div()
                  .id("om-rc-app")
                  .px(4)
                  .py(1)
                  .font_family(MONO)
                  .text_size(11)
                  .line_height("15px")
                  .text_color(t.foreground || "#e4dfd3")
                  .cursor_pointer()
                  .hover((s) => s.bg(t.hover || "#172236").text_color(t.accent || "#e8a849"))
                  .tooltip("send right-clicks to the terminal program (shift+right-click for menu)")
                  .on_click(() =>
                    act("terminal.right_click", {
                      to: "program",
                      ...(target.terminal ? { terminal: target.terminal } : {}),
                    })
                  )
                  .child("app")
              )
              .child(
                div()
                  .id("om-rc-menu")
                  .px(4)
                  .py(1)
                  .font_family(MONO)
                  .text_size(11)
                  .line_height("15px")
                  .text_color(t.muted || "#8b93a6")
                  .cursor_pointer()
                  .hover((s) => s.bg(t.hover || "#172236").text_color(t.foreground || "#e4dfd3"))
                  .tooltip("open context menu on right-click")
                  .on_click(() =>
                    act("terminal.right_click", {
                      to: "menu",
                      ...(target.terminal ? { terminal: target.terminal } : {}),
                    })
                  )
                  .child("menu")
              )
          )
      )
      .when(Boolean(agent || isSubAgent), (el) =>
        el
          .child(sep())
          .when(Boolean(agent), (aEl) =>
            aEl.child(
              row(
                "om-pin",
                "^",
                agent.pinned ? "unpin craft" : "pin craft",
                t.accent || "#e8a849",
                () => act("terminal.pin", { terminal: target.terminal, pinned: !agent.pinned })
              )
            )
          )
          .when(isSubAgent, (sEl) =>
            sEl.child(
              row("om-park", "<", "park probe", t.done || "#5fd4b8", () =>
                act("terminal.park", { terminal: target.terminal })
              )
            )
          )
      )
      .when(Boolean(modelPane), (el) =>
        el
          .child(sep())
          .child(
            row("om-sr", "|", "split right", t.done || "#5fd4b8", () =>
              act("pane.split", { pane: modelPane.pane, direction: "right" })
            )
          )
          .child(
            row("om-sd", "-", "split down", t.done || "#5fd4b8", () =>
              act("pane.split", { pane: modelPane.pane, direction: "down" })
            )
          )
          .child(
            row("om-zm", "^", modelPane.zoomed ? "restore zoom" : "zoom pane", t.accent || "#e8a849", () =>
              act("pane.zoom", { pane: modelPane.pane })
            )
          )
          .child(
            row("om-cl", "x", "close pane", t.blocked || "#f06449", () =>
              act("pane.close", { pane: modelPane.pane })
            )
          )
      );
  }
}
