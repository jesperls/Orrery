// Orrery Always-On-Top Start / Launcher Menu (`role: "launcher"`, opened as `kind: "popup"`).
// Renders strictly ABOVE all floating `kind: "window"` overlays and dismisses natively on
// Esc or click outside. Provides:
//   - Section 0: OPEN WINDOWS jump list (focus/jump-to-world-window or close)
//   - Section 1: SPACES (live list, click to focus, inline `+` terminal, `×` close,
//     integrated `+ New Space` machine selector, and `+ Add Machine...`)
//   - Section 2: NEW TERMINAL & AGENTS (explicitly named for the active Space)
//   - Section 3: APPS & DESKTOP (Drop Note, Files, Git Changes, Fleet Monitor, Tile Windows,
//     Full-Screen Splits, Settings)

import { div } from "gpui-kit";
import { h_flex, v_flex } from "gpui-base";
import { agents, focused, props, run, spaces, terminals, theme } from "herdr";
import {
  agentName,
  buildGitBySpace,
  cleanAgentName,
  CLEAR,
  closeAndEndTerminal,
  closeLauncherPopup,
  closeNoteWindow,
  closeToolWindow,
  dispatchCosmosAction,
  enterFocusMode,
  getViewportDims,
  isToolVisible,
  LIVE_ZOOM_MIN,
  loadKnownAgents,
  machineStatusInfo,
  MONO,
  noteTitle,
  openAddMachineDialog,
  openNoteWindow,
  openTerminalWindow,
  openToolWindow,
  readCamera,
  readGitInfo,
  readMachinesList,
  readNotesList,
  readOpenNotes,
  readOpenTools,
  readOpenWins,
  spaceDisplayName,
  statusColor,
  tileAllOpenWindows,
  TOOL_META,
  TOOL_ORDER,
  withAlpha,
} from "../state.js";

const CLOSE_RED = "#c43e2b";

function stopProp(_e, cx) {
  cx.stop_propagation();
}

export function renderLauncher(view, _cx) {
  const t = theme() ?? {};
  const p = props() ?? {};
  const overlayId = p.overlay || "";
  const vp = getViewportDims();
  const accent = t.accent || "#e8a849";
  const borderCol = t.input || t.border || "#2b3b57";
  const cam = readCamera();

  const allSpaces = spaces() || [];
  const activeSpace = allSpaces.find((sp) => sp.active) ?? allSpaces[0] ?? null;
  const activeSpaceLabel = activeSpace ? spaceDisplayName(activeSpace) : "Space";
  const gitBySpace = buildGitBySpace(allSpaces, readGitInfo());
  const openWins = readOpenWins();
  const openTools = readOpenTools();
  const openNotes = readOpenNotes();
  const notesMap = new Map(readNotesList().map((n) => [n.id, n]));
  const allAgents = agents() || [];
  const allTerms = terminals() || [];
  const agentMap = new Map(allAgents.map((a) => [a.address, a]));
  const termMap = new Map(allTerms.map((tm) => [tm.address, tm]));
  const spaceMap = new Map(allSpaces.map((s) => [s.id, s]));
  const focusedTerminal = focused()?.terminal || null;

  const allMachines = readMachinesList();
  const remoteMachines = allMachines.filter((m) => !m.isLocal);
  const hasMultipleMachines = remoteMachines.length > 0;
  const installedAgents = (view.agentList || []).filter((prog) => prog.installed);

  // Build compact jump list of open world windows (since there is no bottom taskbar)
  const openWindowItems = [];
  for (const addr of Object.keys(openWins)) {
    const ag = agentMap.get(addr) || null;
    const tm = termMap.get(addr) || null;
    const sp = (ag?.space || tm?.space) ? spaceMap.get(ag?.space || tm?.space) || null : null;
    openWindowItems.push({
      kind: "terminal",
      id: addr,
      name: ag ? agentName(ag) : cleanAgentName(tm?.program?.name || tm?.name || "shell"),
      sub: sp ? spaceDisplayName(sp) : ag?.space_name || "",
      status: ag?.status || tm?.status || "idle",
      pinned: Boolean(ag?.pinned),
      focused: focusedTerminal === addr,
    });
  }
  for (const kind of TOOL_ORDER) {
    const rec = openTools[kind];
    if (rec && !rec.minimized) {
      openWindowItems.push({
        kind: "tool",
        id: kind,
        name: TOOL_META[kind].title,
        sub: "app",
        status: "idle",
        pinned: false,
        focused: false,
      });
    }
  }
  for (const [noteId, rec] of Object.entries(openNotes)) {
    if (rec && !rec.minimized && notesMap.has(noteId)) {
      openWindowItems.push({
        kind: "note",
        id: noteId,
        name: noteTitle(notesMap.get(noteId), "Note"),
        sub: "note",
        status: "done",
        pinned: false,
        focused: false,
      });
    }
  }

  const dismiss = () => {
    closeLauncherPopup(false);
  };

  const sectionHeader = (label, rightText = "") =>
    h_flex()
      .w_full()
      .px(12)
      .pt(6)
      .pb(3)
      .items_center()
      .justify_between()
      .child(
        div()
          .font_family(MONO)
          .text_size(9)
          .line_height("12px")
          .font_bold()
          .text_color(t.dim || "#4d5870")
          .child(label)
      )
      .when(Boolean(rightText), (el) =>
        el.child(
          div()
            .font_family(MONO)
            .text_size(9)
            .line_height("12px")
            .text_color(t.dim || "#4d5870")
            .child(rightText)
        )
      );

  const divider = () =>
    div()
      .w_full()
      .h(1)
      .my(4)
      .bg(withAlpha(t.border || "#1f2b40", "CC"));

  const menuRow = (id, label, rightHint, opts, onClick) =>
    h_flex()
      .id(id)
      .w_full()
      .px(12)
      .py(5)
      .gap(8)
      .items_center()
      .justify_between()
      .when(Boolean(opts.active), (el) => el.bg(withAlpha(accent, "16")))
      .font_family(MONO)
      .text_size(11)
      .line_height("15px")
      .text_color(opts.color || (opts.active ? accent : t.foreground || "#e4dfd3"))
      .cursor_pointer()
      .hover((st) =>
        st
          .bg(opts.hoverBg || t.hover || "#172236")
          .text_color(opts.hoverColor || t.foreground || "#e4dfd3")
      )
      .on_mouse_down("left", stopProp)
      .on_click((e, c) => {
        c.stop_propagation();
        onClick(e, c);
      })
      .child(
        div()
          .min_w(0)
          .when(Boolean(opts.bold), (el) => el.font_bold())
          .truncate()
          .child(label)
      )
      .when(Boolean(rightHint), (el) =>
        el.child(
          div()
            .flex_none()
            .font_family(MONO)
            .text_size(10)
            .line_height("14px")
            .text_color(opts.hintColor || t.dim || "#4d5870")
            .whitespace_nowrap()
            .child(rightHint)
        )
      );

  return v_flex()
    .id(`orrery-launcher-popup-${overlayId || "main"}`)
    .size_full()
    .py(5)
    .bg(t.popover || "#0e1524")
    .border_1()
    .border_color(borderCol)
    .overflow_y_scroll()
    .on_mouse_down("left", stopProp)
    .on_mouse_down("right", stopProp)
    .on_mouse_down("middle", stopProp)
    // --- OPEN WINDOWS JUMP LIST (Mission Control replacement for removed taskbar) ---
        .when(openWindowItems.length > 0, (wSec) =>
          wSec
            .child(sectionHeader("OPEN WINDOWS", `${openWindowItems.length} in space`))
            .children(
              openWindowItems.map((item, idx) => {
                const sc =
                  item.kind === "terminal"
                    ? statusColor(item.status, t)
                    : item.kind === "note"
                      ? t.done || "#5fd4b8"
                      : accent;
                return h_flex()
                  .id(`orrery-ln-win-${item.kind}-${item.id || idx}`)
                  .w_full()
                  .pl(10)
                  .pr(6)
                  .py(4)
                  .gap(6)
                  .items_center()
                  .justify_between()
                  .bg(item.focused ? withAlpha(accent, "16") : CLEAR)
                  .hover((st) => st.bg(t.hover || "#172236"))
                  .child(
                    h_flex()
                      .id(`orrery-ln-win-focus-${item.kind}-${item.id || idx}`)
                      .flex_1()
                      .min_w(0)
                      .gap(6)
                      .items_center()
                      .overflow_hidden()
                      .cursor_pointer()
                      .tooltip(`Focus ${item.name}`)
                      .on_mouse_down("left", stopProp)
                      .on_click((_e, c) => {
                        c.stop_propagation();
                        dismiss();
                        const rec =
                          item.kind === "terminal"
                            ? openWins[item.id]
                            : item.kind === "note"
                              ? openNotes[item.id]
                              : openTools[item.id];
                        if (rec && ((cam.zoom || 1.0) < LIVE_ZOOM_MIN || rec.suspended || !rec.overlayId)) {
                          dispatchCosmosAction({ type: "focus-world-window", kind: item.kind, id: item.id });
                        } else if (item.kind === "terminal") {
                          openTerminalWindow(item.id, { vpW: vp.w, vpH: vp.h });
                        } else if (item.kind === "note") {
                          openNoteWindow(item.id, { vpW: vp.w, vpH: vp.h });
                        } else {
                          openToolWindow(item.id, vp.w, vp.h);
                        }
                      })
                      .child(
                        div()
                          .flex_none()
                          .font_family(MONO)
                          .text_size(item.status === "blocked" ? 11 : 8)
                          .line_height("14px")
                          .font_bold()
                          .text_color(sc)
                          .child(item.status === "blocked" ? "!" : "●")
                      )
                      .when(Boolean(item.pinned), (pEl) =>
                        pEl.child(
                          div()
                            .flex_none()
                            .font_family(MONO)
                            .text_size(9)
                            .line_height("14px")
                            .text_color(accent)
                            .child("★")
                        )
                      )
                      .child(
                        div()
                          .min_w(0)
                          .font_family(MONO)
                          .text_size(11)
                          .line_height("15px")
                          .when(item.focused, (fEl) => fEl.font_bold())
                          .text_color(item.focused ? t.foreground || "#e4dfd3" : t.muted || "#8b93a6")
                          .truncate()
                          .child(item.name)
                      )
                      .when(Boolean(item.sub), (sEl) =>
                        sEl.child(
                          div()
                            .flex_none()
                            .max_w(86)
                            .font_family(MONO)
                            .text_size(9)
                            .line_height("14px")
                            .text_color(t.dim || "#4d5870")
                            .truncate()
                            .child(item.sub)
                        )
                      )
                  )
                  .child(
                    h_flex()
                      .id(`orrery-ln-win-x-${item.kind}-${item.id || idx}`)
                      .flex_none()
                      .w(18)
                      .h(18)
                      .items_center()
                      .justify_center()
                      .font_family(MONO)
                      .text_size(11)
                      .line_height("14px")
                      .text_color(t.dim || "#4d5870")
                      .cursor_pointer()
                      .hover((st) => st.bg(CLOSE_RED).text_color("#ffffff"))
                      .tooltip(`Close ${item.name}`)
                      .on_mouse_down("left", stopProp)
                      .on_click((_e, c) => {
                        c.stop_propagation();
                        if (item.kind === "terminal") closeAndEndTerminal(item.id);
                        else if (item.kind === "note") closeNoteWindow(item.id);
                        else closeToolWindow(item.id);
                        c.notify();
                      })
                      .child("×")
                  );
              })
            )
            .child(divider())
        )
        // --- SECTION 1: SPACES ---
        .child(sectionHeader("SPACES", `${allSpaces.length} total`))
        .children(
          allSpaces.map((sp, idx) => {
            const label = spaceDisplayName(sp);
            const gi = gitBySpace[sp.id];
            const branch = gi?.branch || sp.branch || "";
            const tabCount = (sp.tabs || []).length;

            return h_flex()
              .id(`orrery-ln-sp-${sp.id || idx}`)
              .w_full()
              .pl(10)
              .pr(6)
              .py(4)
              .gap(5)
              .items_center()
              .justify_between()
              .bg(sp.active ? withAlpha(accent, "14") : CLEAR)
              .border_l_1()
              .border_color(sp.active ? accent : CLEAR)
              .hover((st) => st.bg(t.hover || "#172236"))
              .child(
                h_flex()
                  .id(`orrery-ln-sp-focus-${sp.id || idx}`)
                  .flex_1()
                  .min_w(0)
                  .gap(5)
                  .items_center()
                  .overflow_hidden()
                  .cursor_pointer()
                  .tooltip(`Select & open ${label}`)
                  .on_mouse_down("left", stopProp)
                  .on_click((_e, c) => {
                    c.stop_propagation();
                    dismiss();
                    dispatchCosmosAction({ type: "open-space", spaceId: sp.id });
                  })
                  .child(
                    div()
                      .flex_none()
                      .font_family(MONO)
                      .text_size(10)
                      .line_height("14px")
                      .text_color(sp.active ? accent : t.dim || "#4d5870")
                      .child(sp.active ? "◆" : "·")
                  )
                  .child(
                    div()
                      .flex_none()
                      .max_w(118)
                      .font_family(MONO)
                      .text_size(11)
                      .line_height("15px")
                      .when(Boolean(sp.active), (el) => el.font_bold())
                      .text_color(sp.active ? t.foreground || "#e4dfd3" : t.muted || "#8b93a6")
                      .truncate()
                      .child(label)
                  )
                  .when(Boolean(branch), (bEl) =>
                    bEl.child(
                      div()
                        .min_w(0)
                        .font_family(MONO)
                        .text_size(10)
                        .line_height("14px")
                        .text_color(t.done || "#5fd4b8")
                        .truncate()
                        .child(branch)
                    )
                  )
                  .child(
                    div()
                      .flex_none()
                      .font_family(MONO)
                      .text_size(9)
                      .line_height("14px")
                      .text_color(t.dim || "#4d5870")
                      .whitespace_nowrap()
                      .child(`${tabCount}t`)
                  )
              )
              .child(
                h_flex()
                  .flex_none()
                  .gap(3)
                  .items_center()
                  .child(
                    h_flex()
                      .id(`orrery-ln-sp-add-${sp.id || idx}`)
                      .w(20)
                      .h(20)
                      .items_center()
                      .justify_center()
                      .font_family(MONO)
                      .text_size(12)
                      .line_height("14px")
                      .font_bold()
                      .text_color(accent)
                      .cursor_pointer()
                      .hover((st) => st.bg(withAlpha(accent, "28")).text_color(t.foreground || "#e4dfd3"))
                      .tooltip(`New terminal in ${label}`)
                      .on_mouse_down("left", stopProp)
                      .on_click((_e, c) => {
                        c.stop_propagation();
                        dismiss();
                        dispatchCosmosAction({ type: "spawn-terminal", spaceId: sp.id });
                      })
                      .child("+")
                  )
                  .when(allSpaces.length > 1, (xEl) =>
                    xEl.child(
                      h_flex()
                        .id(`orrery-ln-sp-close-${sp.id || idx}`)
                        .w(20)
                        .h(20)
                        .items_center()
                        .justify_center()
                        .font_family(MONO)
                        .text_size(12)
                        .line_height("14px")
                        .text_color(t.dim || "#4d5870")
                        .cursor_pointer()
                        .hover((st) => st.bg(CLOSE_RED).text_color("#ffffff"))
                        .tooltip(`Close Space ${label}`)
                        .on_mouse_down("left", stopProp)
                        .on_click((_e, c) => {
                          c.stop_propagation();
                          dismiss();
                          run("space.close", { id: sp.id });
                        })
                        .child("×")
                    )
                  )
              );
          })
        )
        // Integrated + New Space with first-class Machine Selector when multiple machines exist
        .child(
          menuRow(
            "orrery-ln-new-space-toggle",
            "+ New Space",
            hasMultipleMachines
              ? view.showNewSpace
                ? "choose machine ▴"
                : `${remoteMachines.length + 1} machines ▾`
              : view.showNewSpace
                ? "▴"
                : "browse / here ▾",
            { color: accent, bold: true, active: Boolean(view.showNewSpace) },
            (_e, c) => {
              view.showNewSpace = !view.showNewSpace;
              c.notify();
            }
          )
        )
        .when(Boolean(view.showNewSpace), (nsEl) =>
          nsEl.child(
            v_flex()
              .id("orrery-ln-new-space-picker")
              .w_full()
              .py(3)
              .pl(12)
              .pr(8)
              .gap(2)
              .bg(withAlpha(t.surface || "#0b101c", "CC"))
              .border_t_1()
              .border_b_1()
              .border_color(withAlpha(t.border || "#1f2b40", "AA"))
              .child(
                div()
                  .px(4)
                  .py(2)
                  .font_family(MONO)
                  .text_size(9)
                  .line_height("12px")
                  .font_bold()
                  .text_color(t.dim || "#4d5870")
                  .child(hasMultipleMachines ? "SELECT TARGET MACHINE" : "CREATE LOCAL SPACE")
              )
              // Local machine row with both Browse... and quick Here
              .child(
                h_flex()
                  .id("orrery-ln-ns-local")
                  .w_full()
                  .px(4)
                  .py(4)
                  .gap(6)
                  .items_center()
                  .justify_between()
                  .hover((s) => s.bg(t.hover || "#172236"))
                  .child(
                    h_flex()
                      .id("orrery-ln-ns-local-browse")
                      .flex_1()
                      .min_w(0)
                      .gap(6)
                      .items_center()
                      .cursor_pointer()
                      .tooltip("Browse for a folder on this machine")
                      .on_mouse_down("left", stopProp)
                      .on_click((_e, c) => {
                        c.stop_propagation();
                        dismiss();
                        dispatchCosmosAction({ type: "browse-space" });
                      })
                      .child(
                        div()
                          .flex_none()
                          .font_family(MONO)
                          .text_size(8)
                          .line_height("14px")
                          .text_color(t.done || "#5fd4b8")
                          .child("●")
                      )
                      .child(
                        div()
                          .min_w(0)
                          .font_family(MONO)
                          .text_size(11)
                          .line_height("15px")
                          .text_color(t.foreground || "#e4dfd3")
                          .truncate()
                          .child("local (Browse...)")
                      )
                  )
                  .child(
                    div()
                      .id("orrery-ln-ns-local-here")
                      .flex_none()
                      .px(6)
                      .py(1)
                      .border_1()
                      .border_color(withAlpha(accent, "66"))
                      .font_family(MONO)
                      .text_size(10)
                      .line_height("14px")
                      .text_color(accent)
                      .cursor_pointer()
                      .hover((s) => s.bg(withAlpha(accent, "24")).text_color(t.foreground || "#e4dfd3"))
                      .tooltip("New local Space in current folder")
                      .on_mouse_down("left", stopProp)
                      .on_click((_e, c) => {
                        c.stop_propagation();
                        dismiss();
                        dispatchCosmosAction({ type: "spawn-space", machine: "" });
                      })
                      .child("here")
                  )
              )
              // Every remote SSH machine
              .children(
                remoteMachines.map((rm, idx) => {
                  const st = machineStatusInfo(rm, t);
                  return h_flex()
                    .id(`orrery-ln-ns-rm-${rm.name || idx}`)
                    .w_full()
                    .px(4)
                    .py(4)
                    .gap(6)
                    .items_center()
                    .justify_between()
                    .cursor_pointer()
                    .hover((s) => s.bg(t.hover || "#172236"))
                    .tooltip(
                      st.connected
                        ? `Create Space on ${rm.name}`
                        : `Reconnect ${rm.name} (${st.label})`
                    )
                    .on_mouse_down("left", stopProp)
                    .on_click((_e, c) => {
                      c.stop_propagation();
                      dismiss();
                      if (st.connected) {
                        dispatchCosmosAction({ type: "spawn-space", machine: rm.name });
                      } else {
                        dispatchCosmosAction({ type: "reconnect-machine", machine: rm.name });
                      }
                    })
                    .child(
                      h_flex()
                        .flex_1()
                        .min_w(0)
                        .gap(6)
                        .items_center()
                        .child(
                          div()
                            .flex_none()
                            .font_family(MONO)
                            .text_size(8)
                            .line_height("14px")
                            .text_color(st.dotColor)
                            .child("●")
                        )
                        .child(
                          div()
                            .min_w(0)
                            .font_family(MONO)
                            .text_size(11)
                            .line_height("15px")
                            .text_color(
                              st.connected ? t.foreground || "#e4dfd3" : t.muted || "#8b93a6"
                            )
                            .truncate()
                            .child(`ssh:${rm.name}`)
                        )
                    )
                    .child(
                      div()
                        .flex_none()
                        .font_family(MONO)
                        .text_size(9)
                        .line_height("14px")
                        .text_color(st.dotColor)
                        .whitespace_nowrap()
                        .child(st.connected ? "+ space" : st.needsLogin ? "login" : "connect")
                    );
                })
              )
              .child(
                h_flex()
                  .id("orrery-ln-ns-add-machine")
                  .w_full()
                  .px(4)
                  .py(4)
                  .gap(6)
                  .items_center()
                  .cursor_pointer()
                  .hover((s) => s.bg(t.hover || "#172236"))
                  .on_mouse_down("left", stopProp)
                  .on_click((_e, c) => {
                    c.stop_propagation();
                    dismiss();
                    openAddMachineDialog();
                  })
                  .child(
                    div()
                      .font_family(MONO)
                      .text_size(10)
                      .line_height("14px")
                      .text_color(t.done || "#5fd4b8")
                      .child("+ Add SSH Machine...")
                  )
              )
          )
        )
        .when(!view.showNewSpace, (mEl) =>
          mEl.child(
            menuRow(
              "orrery-ln-add-machine",
              "+ Add Machine...",
              hasMultipleMachines ? `${remoteMachines.length} ssh` : "ssh",
              { color: t.done || "#5fd4b8" },
              () => {
                dismiss();
                openAddMachineDialog();
              }
            )
          )
        )
        .child(divider())
        // --- SECTION 2: NEW TERMINAL & AGENTS ---
        .child(sectionHeader("NEW TERMINAL & AGENTS"))
        .child(
          menuRow(
            "orrery-ln-new-term",
            `New Terminal (${activeSpaceLabel})`,
            "",
            { bold: true, color: t.foreground || "#e4dfd3" },
            () => {
              dismiss();
              dispatchCosmosAction({
                type: "spawn-terminal",
                spaceId: activeSpace?.id || "",
              });
            }
          )
        )
        .when(Boolean(view.agentLoading), (lEl) =>
          lEl.child(
            div()
              .px(12)
              .py(3)
              .font_family(MONO)
              .text_size(10)
              .line_height("14px")
              .text_color(t.dim || "#4d5870")
              .child("scanning PATH for agents...")
          )
        )
        .when(!view.agentLoading && Boolean(view.agentError), (errEl) =>
          errEl.child(
            h_flex()
              .w_full()
              .px(12)
              .py(3)
              .gap(8)
              .items_center()
              .child(
                div()
                  .min_w(0)
                  .font_family(MONO)
                  .text_size(10)
                  .line_height("14px")
                  .text_color(t.blocked || "#f06449")
                  .truncate()
                  .child(view.agentError)
              )
              .child(
                div()
                  .id("orrery-ln-ag-retry")
                  .flex_none()
                  .font_family(MONO)
                  .text_size(10)
                  .line_height("14px")
                  .text_color(t.muted || "#8b93a6")
                  .cursor_pointer()
                  .hover((st) => st.text_color(t.foreground || "#e4dfd3"))
                  .on_mouse_down("left", stopProp)
                  .on_click((_e, c) => {
                    c.stop_propagation();
                    loadKnownAgents(view, c, activeSpace?.machine ?? null);
                    c.notify();
                  })
                  .child("retry")
              )
          )
        )
        .when(!view.agentLoading && !view.agentError && installedAgents.length > 0, (agEl) =>
          agEl.child(
            h_flex()
              .w_full()
              .px(12)
              .py(4)
              .gap(5)
              .flex_wrap()
              .items_center()
              .children(
                installedAgents.map((prog) =>
                  div()
                    .id(`orrery-ln-ag-${prog.key}`)
                    .px(7)
                    .py(3)
                    .border_1()
                    .border_color(withAlpha(accent, "66"))
                    .bg(withAlpha(accent, "12"))
                    .font_family(MONO)
                    .text_size(10)
                    .line_height("14px")
                    .text_color(accent)
                    .cursor_pointer()
                    .hover((st) =>
                      st
                        .bg(withAlpha(accent, "2E"))
                        .text_color(t.foreground || "#e4dfd3")
                    )
                    .tooltip(`Launch ${prog.name} in ${activeSpaceLabel}`)
                    .on_mouse_down("left", stopProp)
                    .on_click((_e, c) => {
                      c.stop_propagation();
                      dismiss();
                      dispatchCosmosAction({
                        type: "spawn-terminal",
                        spaceId: activeSpace?.id || "",
                        argv: prog.run,
                        name: prog.name,
                      });
                    })
                    .child(`+ ${prog.name}`)
                )
              )
          )
        )
        .child(divider())
        // --- SECTION 3: APPS & DESKTOP ---
        .child(sectionHeader("APPS & DESKTOP"))
        .child(
          menuRow(
            "orrery-ln-note",
            "Drop Note",
            "",
            { color: accent },
            () => {
              dismiss();
              dispatchCosmosAction({ type: "drop-note" });
            }
          )
        )
        .child(
          menuRow(
            "orrery-ln-files",
            "Files",
            isToolVisible("files", openTools) ? "•" : "Alt+E",
            { active: isToolVisible("files", openTools) },
            () => {
              dismiss();
              openToolWindow("files", vp.w, vp.h);
            }
          )
        )
        .child(
          menuRow(
            "orrery-ln-changes",
            "Git Changes",
            isToolVisible("changes", openTools) ? "•" : "Alt+G",
            { active: isToolVisible("changes", openTools) },
            () => {
              dismiss();
              openToolWindow("changes", vp.w, vp.h);
            }
          )
        )
        .child(
          menuRow(
            "orrery-ln-fleet",
            "Fleet Monitor",
            isToolVisible("fleet", openTools) ? "•" : "Alt+F",
            { active: isToolVisible("fleet", openTools) },
            () => {
              dismiss();
              openToolWindow("fleet", vp.w, vp.h);
            }
          )
        )
        .child(divider())
        .child(
          menuRow("orrery-ln-tile", "Tile Windows", "Alt+T", {}, () => {
            dismiss();
            tileAllOpenWindows(vp.w, vp.h);
          })
        )
        .child(
          menuRow("orrery-ln-focus", "Full-Screen Splits", "Alt+O", {}, () => {
            dismiss();
            enterFocusMode(focusedTerminal);
          })
        )
        .child(
          menuRow("orrery-ln-settings", "Settings", "", {}, () => {
            dismiss();
            run("app.settings");
          })
        );
}
