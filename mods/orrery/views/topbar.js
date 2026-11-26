// Orrery Focus-Mode Topbar (`role: "topbar"`, 28px, `window_drag: true`).
// Full native multi-pane Herdr ergonomics with 1-click `cosmos` return:
//   Left  : cosmos · Space switcher + branch · crisp tabs (hide / x / hidden(N))
//   Right : ! N blocked jump · +agent · files · changes · chart/void · settings · min / max / x

import { div } from "gpui-kit";
import { h_flex } from "gpui-base";
import { agents, layout, run, settings, spaces, theme, window as win } from "herdr";
import {
  activeSideDrawer,
  CLEAR,
  enterCosmosMode,
  focusNextBlocked,
  getViewportDims,
  isToolVisible,
  loadKnownAgents,
  MONO,
  openAddMachineDialog,
  openContextPopup,
  readMachinesList,
  sortAgentsByUrgency,
  statusColor,
  statusGlyph,
  toggleSideDrawer,
  toggleToolSurface,
} from "../state.js";

function stopDrag(_e, cx) {
  cx.stop_propagation();
}

export function renderTopbar(view, _cx) {
  const t = theme() ?? {};
  const w = win() ?? { platform: "linux", buttons: false, maximized: false };
  const allSpaces = spaces() || [];
  const activeSpace = allSpaces.find((sp) => sp.active) ?? allSpaces[0];
  const allTabs = activeSpace?.tabs ?? [];
  const activeTabs = allTabs.filter((tb) => !tb.settled);
  const settledTabs = allTabs.filter((tb) => tb.settled);
  const showSettled = Boolean(view.showSettled) && settledTabs.length > 0;

  const allAgents = sortAgentsByUrgency(agents() || []);
  const blockedCount = allAgents.filter((a) => a.status === "blocked").length;

  const drawer = activeSideDrawer();
  const filesActive = drawer === "files";
  const changesActive = drawer === "changes";
  const fleetActive = isToolVisible("fleet");
  const agentOpen = Boolean(view.showAgentPicker);
  const isMac = w.platform === "macos";
  const tlX = layout()?.traffic_lights?.[0] ?? 12;
  const uiZoom = settings()?.zoom || 1;
  const leftPad =
    isMac && w.titlebar === "none" && !w.fullscreen
      ? Math.max(10, Math.round((tlX + 64) / uiZoom))
      : 10;
  const modShift = isMac ? "Cmd+Shift" : "Ctrl+Shift";
  const showSpaces = Boolean(view.showSpaceSwitcher);
  const installedAgents = (view.agentList || []).filter((p) => p.installed);

  const spaceLabel = activeSpace
    ? activeSpace.machine
      ? `${activeSpace.machine}:${activeSpace.name || "space"}`
      : activeSpace.name || "space"
    : "orrery";

  const textCtrl = (id, label, active, tip, onClick, hoverColor = null) =>
    div()
      .id(id)
      .flex_none()
      .px(6)
      .py(2)
      .border_b_1()
      .border_color(active ? t.accent || "#e8a849" : CLEAR)
      .font_family(MONO)
      .text_size(11)
      .line_height("15px")
      .text_color(active ? t.accent || "#e8a849" : t.muted || "#8b93a6")
      .cursor_pointer()
      .hover((st) => st.bg(t.hover || "#172236").text_color(hoverColor || t.foreground || "#e4dfd3"))
      .tooltip(tip)
      .on_mouse_down("left", stopDrag)
      .on_click(onClick)
      .child(label);

  const sep = () =>
    div()
      .flex_none()
      .px(2)
      .font_family(MONO)
      .text_size(11)
      .line_height("15px")
      .text_color(t.dim || "#4d5870")
      .child("|");

  return h_flex()
    .id("orrery-topbar")
    .size_full()
    .pl(leftPad)
    .pr(w.buttons ? 0 : 10)
    .gap(8)
    .items_center()
    .justify_between()
    .bg(t.chrome || "#090d17")
    .border_b_1()
    .border_color(t.border || "#1f2b40")
    // Left cluster: cosmos · space switcher + branch · tabs
    .child(
      h_flex()
        .id("orrery-topbar-left")
        .flex_1()
        .min_w(0)
        .gap(6)
        .items_center()
        .overflow_x_scroll()
        .child(
          div()
            .id("orrery-tb-cosmos")
            .flex_none()
            .px(8)
            .py(2)
            .border_1()
            .border_color(t.accent || "#e8a849")
            .font_family(MONO)
            .text_size(11)
            .line_height("14px")
            .font_bold()
            .text_color(t.accent || "#e8a849")
            .cursor_pointer()
            .hover((st) => st.bg(t.hover || "#172236").text_color(t.foreground || "#e4dfd3"))
            .tooltip("return to cosmos star-chart (Alt+O)")
            .on_mouse_down("left", stopDrag)
            .on_click((_e, c) => {
              view.showSpaceSwitcher = false;
              enterCosmosMode();
              c.notify();
            })
            .child("cosmos")
        )
        .child(sep())
        .when(Boolean(activeSpace), (el) =>
          el.child(
            h_flex()
              .id("orrery-tb-space")
              .flex_none()
              .gap(6)
              .items_center()
              .cursor_pointer()
              .tooltip(
                "click: spaces & machines · right-click: next space · double-click: rename"
              )
              .on_mouse_down("left", stopDrag)
              .on_mouse_down("right", (_e, c) => {
                c.stop_propagation();
                run("space.next");
              })
              .on_click((e, c) => {
                if (e?.click_count === 2) {
                  view.showSpaceSwitcher = false;
                  run("space.rename", { id: activeSpace.id });
                  c.notify();
                } else {
                  view.showSpaceSwitcher = !view.showSpaceSwitcher;
                  c.notify();
                }
              })
              .child(
                div()
                  .font_family(MONO)
                  .text_size(11)
                  .line_height("15px")
                  .text_color(t.accent || "#e8a849")
                  .child(">")
              )
              .child(
                div()
                  .max_w(160)
                  .font_family(MONO)
                  .text_size(11)
                  .line_height("15px")
                  .font_bold()
                  .text_color(t.foreground || "#e4dfd3")
                  .truncate()
                  .child(spaceLabel)
              )
              .when(Boolean(activeSpace.branch), (bEl) =>
                bEl.child(
                  div()
                    .max_w(110)
                    .font_family(MONO)
                    .text_size(11)
                    .line_height("15px")
                    .text_color(t.done || "#5fd4b8")
                    .truncate()
                    .child(activeSpace.branch)
                )
              )
          )
        )
        .when(showSpaces, (el) =>
          el
            .children(
              allSpaces
                .filter((sp) => !sp.active)
                .map((sp) =>
                  div()
                    .id(`orrery-tb-sp-${sp.id}`)
                    .flex_none()
                    .px(6)
                    .py(2)
                    .font_family(MONO)
                    .text_size(11)
                    .line_height("15px")
                    .text_color(t.muted || "#8b93a6")
                    .cursor_pointer()
                    .hover((st) => st.bg(t.hover || "#172236").text_color(t.accent || "#e8a849"))
                    .on_mouse_down("left", stopDrag)
                    .on_click((_e, c) => {
                      run("space.select", { id: sp.id });
                      view.showSpaceSwitcher = false;
                      c.notify();
                    })
                    .child(sp.machine ? `${sp.machine}:${sp.name}` : sp.name || "space")
                )
            )
            .child(
              div()
                .id("orrery-tb-new-space")
                .flex_none()
                .px(6)
                .py(2)
                .font_family(MONO)
                .text_size(10)
                .line_height("15px")
                .text_color(t.accent || "#e8a849")
                .cursor_pointer()
                .hover((st) => st.bg(t.hover || "#172236").text_color(t.foreground || "#e4dfd3"))
                .tooltip("Create new Space (shows machine selector if SSH remotes exist)")
                .on_mouse_down("left", stopDrag)
                .on_click((_e, c) => {
                  view.showSpaceSwitcher = false;
                  const remotes = readMachinesList().filter((m) => !m.isLocal);
                  if (remotes.length > 0) {
                    const vp = getViewportDims();
                    openContextPopup({ kind: "new-space", atPointer: true, vpW: vp.w, vpH: vp.h });
                  } else {
                    run("space.new", { machine: "" });
                  }
                  c.notify();
                })
                .child("+space")
            )
            .child(
              div()
                .id("orrery-tb-add-machine")
                .flex_none()
                .px(6)
                .py(2)
                .font_family(MONO)
                .text_size(10)
                .line_height("15px")
                .text_color(t.done || "#5fd4b8")
                .cursor_pointer()
                .hover((st) => st.bg(t.hover || "#172236").text_color(t.foreground || "#e4dfd3"))
                .tooltip("Add remote SSH machine")
                .on_mouse_down("left", stopDrag)
                .on_click((_e, c) => {
                  view.showSpaceSwitcher = false;
                  openAddMachineDialog();
                  c.notify();
                })
                .child("+machine")
            )
        )
        .child(sep())
        .children(
          activeTabs.map((tb) => {
            const sc = statusColor(tb.status, t);
            const hasStatus =
              tb.status === "blocked" || tb.status === "working" || tb.status === "done";
            const sg = hasStatus ? statusGlyph(tb.status) : "";
            const label = tb.named ? tb.name : String(tb.index);

            return h_flex()
              .id(`orrery-tab-${tb.id}`)
              .flex_none()
              .px(6)
              .py(2)
              .gap(5)
              .items_center()
              .border_b_1()
              .border_color(
                tb.active
                  ? t.accent || "#e8a849"
                  : tb.status === "blocked"
                    ? t.blocked || "#f06449"
                    : CLEAR
              )
              .cursor_pointer()
              .hover((st) => st.bg(t.hover || "#172236"))
              .tooltip("click: select · double-click: rename · middle-click: close")
              .on_mouse_down("left", stopDrag)
              .on_mouse_down("middle", (_e, c) => {
                c.stop_propagation();
                run("tab.close", { id: tb.id });
              })
              .on_click((e) => {
                if (e?.click_count === 2) {
                  run("tab.rename", { id: tb.id });
                } else {
                  run("tab.select", { id: tb.id });
                }
              })
              .when(Boolean(sg), (gEl) =>
                gEl.child(
                  div()
                    .id(`orrery-tg-${tb.id}`)
                    .font_family(MONO)
                    .text_size(11)
                    .line_height("15px")
                    .font_bold()
                    .text_color(sc)
                    .when(tb.status === "blocked", (bEl) =>
                      bEl.loop("opacity", { from: 0.35, to: 1.0, period: 800 })
                    )
                    .child(sg)
                )
              )
              .child(
                div()
                  .font_family(MONO)
                  .text_size(11)
                  .line_height("15px")
                  .when(tb.active, (aEl) => aEl.font_bold())
                  .text_color(tb.active ? t.foreground || "#e4dfd3" : t.muted || "#8b93a6")
                  .whitespace_nowrap()
                  .child(label)
              )
              .when(Boolean(tb.zoomed), (zEl) =>
                zEl.child(
                  div()
                    .font_family(MONO)
                    .text_size(10)
                    .line_height("14px")
                    .text_color(t.accent || "#e8a849")
                    .tooltip("zoomed pane")
                    .child("zoom")
                )
              )
              .when(tb.panes > 1, (pEl) =>
                pEl.child(
                  div()
                    .font_family(MONO)
                    .text_size(10)
                    .line_height("14px")
                    .text_color(t.dim || "#4d5870")
                    .child(`${tb.panes}p`)
                )
              )
              .when(activeTabs.length > 1, (sEl) =>
                sEl.child(
                  div()
                    .id(`orrery-settle-${tb.id}`)
                    .px(3)
                    .font_family(MONO)
                    .text_size(10)
                    .line_height("14px")
                    .text_color(t.dim || "#4d5870")
                    .hover((st) => st.text_color(t.accent || "#e8a849"))
                    .tooltip("hide tab (keeps running)")
                    .on_mouse_down("left", stopDrag)
                    .on_click((_e, c) => {
                      c.stop_propagation();
                      run("tab.settle", { id: tb.id });
                    })
                    .child("hide")
                )
              )
                .child(
                  div()
                    .id(`orrery-tclose-${tb.id}`)
                    .px(4)
                    .font_family(MONO)
                    .text_size(12)
                    .line_height("15px")
                    .text_color(t.dim || "#4d5870")
                    .hover((st) => st.bg("#c43e2b").text_color("#ffffff"))
                    .tooltip("close tab")
                    .on_mouse_down("left", stopDrag)
                    .on_click((_e, c) => {
                      c.stop_propagation();
                      run("tab.close", { id: tb.id });
                    })
                    .child("×")
                );
          })
        )
        .when(settledTabs.length > 0, (el) =>
          el.child(
            div()
              .id("orrery-settled-toggle")
              .flex_none()
              .px(6)
              .py(2)
              .border_b_1()
              .border_color(showSettled ? t.accent || "#e8a849" : CLEAR)
              .font_family(MONO)
              .text_size(11)
              .line_height("15px")
              .text_color(showSettled ? t.accent || "#e8a849" : t.muted || "#8b93a6")
              .cursor_pointer()
              .hover((st) => st.bg(t.hover || "#172236").text_color(t.accent || "#e8a849"))
              .tooltip("hidden tabs · click to reveal")
              .on_mouse_down("left", stopDrag)
              .on_click((_e, c) => {
                view.showSettled = !view.showSettled;
                c.notify();
              })
              .child(`hidden(${settledTabs.length})`)
          )
        )
        .when(showSettled, (el) =>
          el.children(
            settledTabs.map((tb) => {
              const label = tb.named ? tb.name : String(tb.index);
              return h_flex()
                .id(`orrery-wake-${tb.id}`)
                .flex_none()
                .px(5)
                .py(2)
                .gap(4)
                .items_center()
                .cursor_pointer()
                .hover((st) => st.bg(t.hover || "#172236"))
                .tooltip("restore hidden tab")
                .on_mouse_down("left", stopDrag)
                .on_mouse_down("middle", (_e, c) => {
                  c.stop_propagation();
                  run("tab.close", { id: tb.id });
                })
                .on_click((_e, c) => {
                  run("tab.unsettle", { id: tb.id });
                  run("tab.select", { id: tb.id });
                  view.showSettled = false;
                  c.notify();
                })
                .child(
                  div()
                    .font_family(MONO)
                    .text_size(11)
                    .line_height("15px")
                    .text_color(t.accent || "#e8a849")
                    .child(label)
                )
                .child(
                  div()
                    .id(`orrery-settledx-${tb.id}`)
                    .px(3)
                    .font_family(MONO)
                    .text_size(12)
                    .line_height("15px")
                    .text_color(t.dim || "#4d5870")
                    .hover((st) => st.bg("#c43e2b").text_color("#ffffff"))
                    .on_mouse_down("left", stopDrag)
                    .on_click((_e, c) => {
                      c.stop_propagation();
                      run("tab.close", { id: tb.id });
                    })
                    .child("×")
                );
            })
          )
        )
        .child(
          div()
            .id("orrery-new-tab")
            .flex_none()
            .px(6)
            .py(2)
            .font_family(MONO)
            .text_size(12)
            .line_height("16px")
            .text_color(t.muted || "#8b93a6")
            .cursor_pointer()
            .hover((st) => st.bg(t.hover || "#172236").text_color(t.foreground || "#e4dfd3"))
            .tooltip("new shell tab in active space")
            .on_mouse_down("left", stopDrag)
            .on_click(() => run("tab.new", activeSpace ? { space: activeSpace.id } : {}))
            .child("+")
        )
    )
    // Right cluster: ! N · +agent · fleet · files · changes · settings · min / max / x
    .child(
      h_flex()
        .id("orrery-topbar-right")
        .flex_none()
        .h_full()
        .gap(3)
        .items_center()
        .when(blockedCount > 0, (el) =>
          el.child(
            div()
              .id("orrery-tb-blocked")
              .flex_none()
              .px(6)
              .py(2)
              .font_family(MONO)
              .text_size(11)
              .line_height("15px")
              .font_bold()
              .text_color(t.blocked || "#f06449")
              .cursor_pointer()
              .tooltip("jump to next blocked agent")
              .loop("opacity", { from: 0.4, to: 1.0, period: 800 })
              .on_mouse_down("left", stopDrag)
              .on_click(() => focusNextBlocked(view))
              .child(`! ${blockedCount}`)
          )
        )
        .when(agentOpen, (el) =>
          el.child(
            h_flex()
              .id("orrery-tb-agent-strip")
              .flex_none()
              .max_w(420)
              .overflow_x_scroll()
              .gap(6)
              .px(6)
              .items_center()
              .border_l_1()
              .border_r_1()
              .border_color(t.border || "#1f2b40")
              .on_mouse_down("left", stopDrag)
              .when(Boolean(view.agentLoading), (lEl) =>
                lEl.child(
                  div()
                    .font_family(MONO)
                    .text_size(11)
                    .line_height("15px")
                    .text_color(t.dim || "#4d5870")
                    .child("scanning...")
                )
              )
              .when(Boolean(!view.agentLoading && view.agentError), (eEl) =>
                eEl
                  .child(
                    div()
                      .font_family(MONO)
                      .text_size(11)
                      .line_height("15px")
                      .text_color(t.blocked || "#f06449")
                      .child("err")
                  )
                  .child(
                    div()
                      .id("orrery-tba-retry")
                      .font_family(MONO)
                      .text_size(11)
                      .line_height("15px")
                      .text_color(t.muted || "#8b93a6")
                      .cursor_pointer()
                      .hover((st) => st.text_color(t.foreground || "#e4dfd3"))
                      .on_mouse_down("left", stopDrag)
                      .on_click((_e, c) => {
                        loadKnownAgents(view, c, activeSpace?.machine ?? null);
                        c.notify();
                      })
                      .child("retry")
                  )
              )
              .when(!view.agentLoading && !view.agentError, (okEl) =>
                okEl
                  .when(installedAgents.length === 0, (noneEl) =>
                    noneEl.child(
                      div()
                        .font_family(MONO)
                        .text_size(11)
                        .line_height("15px")
                        .text_color(t.dim || "#4d5870")
                        .child("none in PATH")
                    )
                  )
                  .children(
                    installedAgents.map((prog) =>
                      h_flex()
                        .id(`orrery-tba-${prog.key}`)
                        .gap(3)
                        .items_center()
                        .child(
                          div()
                            .id(`orrery-tba-tab-${prog.key}`)
                            .font_family(MONO)
                            .text_size(11)
                            .line_height("15px")
                            .text_color(t.accent || "#e8a849")
                            .cursor_pointer()
                            .hover((st) => st.text_color(t.foreground || "#e4dfd3"))
                            .tooltip(`launch ${prog.name} in new tab`)
                            .on_mouse_down("left", stopDrag)
                            .on_click((_e, c) => {
                              view.showAgentPicker = false;
                              run(
                                "tab.new",
                                activeSpace
                                  ? { space: activeSpace.id, argv: prog.run, name: prog.name }
                                  : { argv: prog.run, name: prog.name }
                              );
                              c.notify();
                            })
                            .child(prog.name)
                        )
                        .child(
                          div()
                            .id(`orrery-tba-split-${prog.key}`)
                            .font_family(MONO)
                            .text_size(10)
                            .line_height("14px")
                            .text_color(t.dim || "#4d5870")
                            .cursor_pointer()
                            .hover((st) => st.text_color(t.done || "#5fd4b8"))
                            .tooltip(`split right with ${prog.name}`)
                            .on_mouse_down("left", stopDrag)
                            .on_click((_e, c) => {
                              view.showAgentPicker = false;
                              run("pane.split", { direction: "right", argv: prog.run });
                              c.notify();
                            })
                            .child("+right")
                        )
                    )
                  )
              )
              .child(
                div()
                  .id("orrery-tba-close")
                  .px(3)
                  .font_family(MONO)
                  .text_size(12)
                  .line_height("15px")
                  .text_color(t.dim || "#4d5870")
                  .cursor_pointer()
                  .hover((st) => st.text_color(t.foreground || "#e4dfd3"))
                  .on_mouse_down("left", stopDrag)
                  .on_click((_e, c) => {
                    view.showAgentPicker = false;
                    c.notify();
                  })
                  .child("×")
              )
          )
        )
        .child(
          textCtrl(
            "orrery-tb-agent",
            "+agent",
            agentOpen,
            "launch installed coding agent",
            (_e, c) => {
              view.showAgentPicker = !view.showAgentPicker;
              if (view.showAgentPicker) {
                loadKnownAgents(view, c, activeSpace?.machine ?? null);
              }
              c.notify();
            }
          )
        )
        .child(
          textCtrl(
            "orrery-tb-fleet",
            "fleet",
            fleetActive,
            "toggle Fleet Monitor & Machines (Alt+F)",
            () => {
              const vp = getViewportDims();
              toggleToolSurface("fleet", vp.w, vp.h);
            }
          )
        )
        .child(
          textCtrl(
            "orrery-tb-files",
            "files",
            filesActive,
            "toggle files drawer (Alt+E)",
            () => toggleSideDrawer("side-files")
          )
        )
        .child(
          textCtrl(
            "orrery-tb-changes",
            "changes",
            changesActive,
            `toggle git changes drawer (Alt+G / ${modShift}+G)`,
            () => toggleSideDrawer("side-changes")
          )
        )
        .child(
          textCtrl("orrery-tb-settings", "settings", false, "settings", () => run("app.settings"))
        )
        .when(Boolean(w.buttons), (wEl) =>
          wEl
            .child(sep())
            .child(
              h_flex()
                .id("orrery-tb-wmin")
                .flex_none()
                .w(30)
                .h_full()
                .items_center()
                .justify_center()
                .font_family(MONO)
                .text_size(11)
                .line_height("15px")
                .text_color(t.muted || "#8b93a6")
                .cursor_pointer()
                .hover((st) => st.bg(t.hover || "#172236").text_color(t.foreground || "#e4dfd3"))
                .tooltip("minimize window")
                .on_mouse_down("left", stopDrag)
                .on_click(() => run("window.minimize"))
                .child("─")
            )
            .child(
              h_flex()
                .id("orrery-tb-wmax")
                .flex_none()
                .w(30)
                .h_full()
                .items_center()
                .justify_center()
                .font_family(MONO)
                .text_size(11)
                .line_height("15px")
                .text_color(t.muted || "#8b93a6")
                .cursor_pointer()
                .hover((st) => st.bg(t.hover || "#172236").text_color(t.foreground || "#e4dfd3"))
                .tooltip(w.maximized ? "restore window" : "maximize window")
                .on_mouse_down("left", stopDrag)
                .on_click(() => run("window.maximize"))
                .child(w.maximized ? "❐" : "□")
            )
            .child(
              h_flex()
                .id("orrery-tb-wclose")
                .flex_none()
                .w(30)
                .h_full()
                .items_center()
                .justify_center()
                .font_family(MONO)
                .text_size(13)
                .line_height("15px")
                .text_color(t.muted || "#8b93a6")
                .cursor_pointer()
                .hover((st) => st.bg("#c43e2b").text_color("#ffffff"))
                .tooltip("close window")
                .on_mouse_down("left", stopDrag)
                .on_click(() => run("window.close"))
                .child("×")
            )
        )
    );
}
