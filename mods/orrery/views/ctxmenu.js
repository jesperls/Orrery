// Orrery Always-On-Top Context Menus (`role: "ctxmenu"`, opened as `kind: "popup"`).
// Renders strictly ABOVE all floating windows and dismisses natively on Esc or click outside.
// Supports 6 menu kinds:
//   - "space"     : Rich Space-Relevant Planetoid Menu (live tabs/terminals, + New Terminal,
//                   inline + Launch Agent here, Open Files/Git Changes, Rename, Close Space)
//   - "machine"   : Remote SSH Machine Beacon Menu (+ New Space, Launch Agent, Reconnect, Remove)
//   - "new-space" : Integrated New Space Target Machine Selector
//   - "desktop"   : Empty Cosmos Desktop Menu (Drop Note Here, New Terminal, New Space, Apps,
//                   Reset View, Tile Windows, Show Desktop, Settings)
//   - "note"      : Floating Note Object Menu (Open Note, Delete Note)
//   - "taskbar"   : Floating Window Menu (Minimize/Restore, Reset Scale, Pin, Snap, Maximize, Close)

import { div } from "gpui-kit";
import { h_flex, v_flex } from "gpui-base";
import { agents, props, run, spaces, terminals, theme } from "herdr";
import {
  buildGitBySpace,
  CLEAR,
  closeAndEndTerminal,
  closeContextPopup,
  closeNoteWindow,
  closeToolWindow,
  createNoteObject,
  deleteNoteObject,
  describeTab,
  dispatchCosmosAction,
  enterFocusMode,
  getNoteById,
  getOpenWindowAddrSet,
  getViewportDims,
  getWindowScale,
  isNoteVisible,
  isToolVisible,
  machineStatusInfo,
  minimizeTerminalWindow,
  MONO,
  noteTitle,
  openAddMachineDialog,
  openMachinesSettings,
  openNoteWindow,
  openTerminalWindow,
  openToolWindow,
  readGitInfo,
  readMachinesList,
  readOpenNotes,
  readOpenTools,
  requestResetView,
  resetWindowScale,
  shortFolder,
  spaceDisplayName,
  statusColor,
  syncAgentOrder,
  tileAllOpenWindows,
  toggleNoteWindow,
  toggleShowDesktop,
  toggleToolWindow,
  withAlpha,
} from "../state.js";

const CLOSE_RED = "#c43e2b";

function stopProp(_e, cx) {
  cx.stop_propagation();
}

export function renderCtxmenu(view, _cx) {
  const t = theme() ?? {};
  const p = props() ?? {};
  const kind = p.kind || "desktop";
  const overlayId = p.overlay || "";
  const vp = getViewportDims();
  const accent = t.accent || "#e8a849";
  const borderCol = t.input || t.border || "#2b3b57";

  const dismiss = () => {
    closeContextPopup();
  };

  const section = (label) =>
    div()
      .w_full()
      .px(12)
      .pt(5)
      .pb(3)
      .font_family(MONO)
      .text_size(9)
      .line_height("12px")
      .font_bold()
      .text_color(t.dim || "#4d5870")
      .truncate()
      .child(label);

  const divider = () =>
    div()
      .w_full()
      .h(1)
      .my(4)
      .bg(withAlpha(t.border || "#1f2b40", "CC"));

  const row = (id, label, rightHint, opts, onClick) =>
    h_flex()
      .id(id)
      .w_full()
      .px(12)
      .py(5)
      .gap(8)
      .items_center()
      .justify_between()
      .when(Boolean(opts.active), (el) => el.bg(withAlpha(accent, "18")))
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

  const frame = (inner) =>
    v_flex()
      .id(`orrery-ctx-popup-${kind}-${overlayId || "m"}`)
      .size_full()
      .py(5)
      .bg(t.popover || "#0e1524")
      .border_1()
      .border_color(borderCol)
      .overflow_y_scroll()
      .on_mouse_down("left", stopProp)
      .on_mouse_down("right", stopProp)
      .on_mouse_down("middle", stopProp)
      .children(inner);

  // ============================================================
  // 1. RICH SPACE-RELEVANT PLANETOID CONTEXT MENU (`kind: "space"`)
  // ============================================================
  if (kind === "space") {
    const allSpaces = spaces() || [];
    const sp = allSpaces.find((s) => s.id === p.spaceId) || null;
    if (!sp) {
      return frame([
        div()
          .px(12)
          .py(8)
          .font_family(MONO)
          .text_size(11)
          .line_height("15px")
          .text_color(t.dim || "#4d5870")
          .child("Space no longer exists"),
      ]);
    }

    const spLabel = spaceDisplayName(sp);
    const gi = buildGitBySpace(allSpaces, readGitInfo())[sp.id];
    const branch = gi?.branch || sp.branch || "";
    const dirty = gi?.dirtyCount || 0;
    const folderStr = shortFolder(sp.folder || "");
    const allAgents = agents() || [];
    const allTerms = terminals() || [];
    const openAddrs = getOpenWindowAddrSet();
    const tabs = sp.tabs || [];
    const installedAgents = (view.agentList || []).filter((prog) => prog.installed);

    const children = [
      // Space Header
      v_flex()
        .w_full()
        .px(12)
        .pt(3)
        .pb(6)
        .gap(2)
        .border_b_1()
        .border_color(withAlpha(t.border || "#1f2b40", "CC"))
        .child(
          h_flex()
            .w_full()
            .gap(6)
            .items_center()
            .child(
              div()
                .flex_none()
                .font_family(MONO)
                .text_size(11)
                .line_height("15px")
                .text_color(accent)
                .child("◆")
            )
            .child(
              div()
                .min_w(0)
                .font_family(MONO)
                .text_size(11)
                .line_height("15px")
                .font_bold()
                .text_color(t.foreground || "#e4dfd3")
                .truncate()
                .child(spLabel)
            )
            .when(Boolean(branch), (bEl) =>
              bEl.child(
                div()
                  .flex_none()
                  .max_w(110)
                  .font_family(MONO)
                  .text_size(10)
                  .line_height("14px")
                  .text_color(t.done || "#5fd4b8")
                  .truncate()
                  .child(dirty > 0 ? `${branch} (${dirty}*)` : branch)
              )
            )
        )
        .when(Boolean(folderStr), (fEl) =>
          fEl.child(
            div()
              .w_full()
              .font_family(MONO)
              .text_size(10)
              .line_height("13px")
              .text_color(t.dim || "#4d5870")
              .truncate()
              .child(folderStr)
          )
        ),
      section(`TERMINALS IN ${spLabel.toUpperCase()} (${tabs.length})`),
      ...tabs.map((tb, idx) => {
        const desc = describeTab(sp, tb, allAgents, allTerms);
        const sc = statusColor(desc.status, t);
        const dot = desc.status === "blocked" ? "!" : "●";
        const isOpen = Boolean(desc.address && openAddrs.has(desc.address));

        return h_flex()
          .id(`orrery-sctx-tab-${tb.id || idx}`)
          .w_full()
          .pl(12)
          .pr(8)
          .py(4)
          .gap(6)
          .items_center()
          .justify_between()
          .bg(tb.active ? withAlpha(accent, "12") : CLEAR)
          .hover((st) => st.bg(t.hover || "#172236"))
          .child(
            h_flex()
              .id(`orrery-sctx-tab-open-${tb.id || idx}`)
              .flex_1()
              .min_w(0)
              .gap(6)
              .items_center()
              .overflow_hidden()
              .cursor_pointer()
              .on_mouse_down("left", stopProp)
              .on_click((_e, c) => {
                c.stop_propagation();
                dismiss();
                dispatchCosmosAction({
                  type: "open-tab",
                  spaceId: sp.id,
                  tabId: tb.id,
                });
              })
              .child(
                div()
                  .flex_none()
                  .font_family(MONO)
                  .text_size(desc.status === "blocked" ? 11 : 8)
                  .line_height("15px")
                  .font_bold()
                  .text_color(sc)
                  .child(dot)
              )
              .child(
                div()
                  .min_w(0)
                  .font_family(MONO)
                  .text_size(11)
                  .line_height("15px")
                  .when(Boolean(tb.active), (el) => el.font_bold())
                  .text_color(
                    tb.active || isOpen ? t.foreground || "#e4dfd3" : t.muted || "#8b93a6"
                  )
                  .truncate()
                  .child(desc.label)
              )
          )
          .child(
            h_flex()
              .flex_none()
              .gap(5)
              .items_center()
              .when(isOpen, (oEl) =>
                oEl.child(
                  div()
                    .font_family(MONO)
                    .text_size(9)
                    .line_height("14px")
                    .text_color(t.done || "#5fd4b8")
                    .child("open")
                )
              )
              .when(tabs.length > 1, (xEl) =>
                xEl.child(
                  h_flex()
                    .id(`orrery-sctx-tab-x-${tb.id || idx}`)
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
                    .tooltip("Close tab")
                    .on_mouse_down("left", stopProp)
                    .on_click((_e, c) => {
                      c.stop_propagation();
                      run("tab.close", { id: tb.id });
                      c.notify();
                    })
                    .child("×")
                )
              )
          );
      }),
      divider(),
      row(
        "orrery-sctx-new-term",
        `+ New Terminal in ${spLabel}`,
        "",
        { bold: true, color: accent },
        () => {
          dismiss();
          dispatchCosmosAction({ type: "spawn-terminal", spaceId: sp.id });
        }
      ),
      // Inline + Launch Agent here
      v_flex()
        .w_full()
        .px(12)
        .py(4)
        .gap(4)
        .child(
          div()
            .font_family(MONO)
            .text_size(10)
            .line_height("14px")
            .text_color(t.muted || "#8b93a6")
            .child("+ Launch Agent here")
        )
        .when(Boolean(view.agentLoading), (lEl) =>
          lEl.child(
            div()
              .font_family(MONO)
              .text_size(10)
              .line_height("14px")
              .text_color(t.dim || "#4d5870")
              .child("scanning PATH...")
          )
        )
        .when(!view.agentLoading && Boolean(view.agentError), (errEl) =>
          errEl.child(
            div()
              .font_family(MONO)
              .text_size(10)
              .line_height("14px")
              .text_color(t.blocked || "#f06449")
              .child(view.agentError)
          )
        )
        .when(!view.agentLoading && !view.agentError && installedAgents.length === 0, (noneEl) =>
          noneEl.child(
            div()
              .font_family(MONO)
              .text_size(10)
              .line_height("14px")
              .text_color(t.dim || "#4d5870")
              .child("no known agents in PATH")
          )
        )
        .when(!view.agentLoading && installedAgents.length > 0, (agEl) =>
          agEl.child(
            h_flex()
              .w_full()
              .gap(5)
              .flex_wrap()
              .items_center()
              .children(
                installedAgents.map((prog) =>
                  div()
                    .id(`orrery-sctx-ag-${prog.key}`)
                    .px(7)
                    .py(2)
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
                    .tooltip(`Launch ${prog.name} in ${spLabel}`)
                    .on_mouse_down("left", stopProp)
                    .on_click((_e, c) => {
                      c.stop_propagation();
                      dismiss();
                      dispatchCosmosAction({
                        type: "spawn-terminal",
                        spaceId: sp.id,
                        argv: prog.run,
                        name: prog.name,
                      });
                    })
                    .child(prog.name)
                )
              )
          )
        ),
      row("orrery-sctx-files", "Open Files here", "", {}, () => {
        dismiss();
        if (!sp.active) run("space.select", { id: sp.id });
        openToolWindow("files", vp.w, vp.h);
      }),
      row("orrery-sctx-changes", "Open Git Changes", "", {}, () => {
        dismiss();
        if (!sp.active) run("space.select", { id: sp.id });
        openToolWindow("changes", vp.w, vp.h);
      }),
      divider(),
      row("orrery-sctx-rename", "Rename Space", "", {}, () => {
        dismiss();
        run("space.rename", { id: sp.id });
      }),
    ];

    if (allSpaces.length > 1) {
      children.push(
        row(
          "orrery-sctx-close",
          "Close Space",
          "",
          { color: t.blocked || "#f06449", hoverBg: CLOSE_RED, hoverColor: "#ffffff" },
          () => {
            dismiss();
            run("space.close", { id: sp.id });
          }
        )
      );
    }

    return frame(children);
  }

  // ============================================================
  // 1B. REMOTE SSH MACHINE BEACON MENU (`kind: "machine"`)
  // ============================================================
  if (kind === "machine") {
    const mName = p.machineName || "";
    const machine = readMachinesList().find((m) => !m.isLocal && m.name === mName) || {
      name: mName,
      label: mName || "machine",
      isLocal: false,
      state: "unknown",
      layout: "unavailable",
      host: "",
      why: "",
      spaceCount: 0,
    };
    const st = machineStatusInfo(machine, t);
    const installedAgents = (view.agentList || []).filter((prog) => prog.installed);

    const children = [
      v_flex()
        .w_full()
        .px(12)
        .pt(3)
        .pb(6)
        .gap(2)
        .border_b_1()
        .border_color(withAlpha(t.border || "#1f2b40", "CC"))
        .child(
          h_flex()
            .w_full()
            .gap(6)
            .items_center()
            .child(
              div()
                .flex_none()
                .font_family(MONO)
                .text_size(9)
                .line_height("15px")
                .text_color(st.dotColor)
                .child("●")
            )
            .child(
              div()
                .min_w(0)
                .font_family(MONO)
                .text_size(11)
                .line_height("15px")
                .font_bold()
                .text_color(t.foreground || "#e4dfd3")
                .truncate()
                .child(`ssh:${machine.name || "machine"}`)
            )
            .child(
              div()
                .flex_none()
                .font_family(MONO)
                .text_size(10)
                .line_height("14px")
                .text_color(st.dotColor)
                .child(st.label)
            )
        )
        .when(Boolean(machine.host && machine.host !== machine.name), (hEl) =>
          hEl.child(
            div()
              .w_full()
              .font_family(MONO)
              .text_size(10)
              .line_height("13px")
              .text_color(t.dim || "#4d5870")
              .truncate()
              .child(machine.host)
          )
        ),
    ];

    if (st.connected) {
      children.push(
        row(
          "orrery-mctx-new-space",
          `+ New Space on ${machine.name}`,
          "",
          { bold: true, color: accent },
          () => {
            dismiss();
            dispatchCosmosAction({ type: "spawn-space", machine: machine.name });
          }
        ),
        v_flex()
          .w_full()
          .px(12)
          .py(4)
          .gap(4)
          .child(
            div()
              .font_family(MONO)
              .text_size(10)
              .line_height("14px")
              .text_color(t.muted || "#8b93a6")
              .child(`Launch Agent on ${machine.name}`)
          )
          .when(Boolean(view.agentLoading), (lEl) =>
            lEl.child(
              div()
                .font_family(MONO)
                .text_size(10)
                .line_height("14px")
                .text_color(t.dim || "#4d5870")
                .child("scanning remote PATH...")
            )
          )
          .when(!view.agentLoading && Boolean(view.agentError), (errEl) =>
            errEl.child(
              div()
                .font_family(MONO)
                .text_size(10)
                .line_height("14px")
                .text_color(t.blocked || "#f06449")
                .child(view.agentError)
            )
          )
          .when(!view.agentLoading && !view.agentError && installedAgents.length === 0, (noneEl) =>
            noneEl.child(
              div()
                .font_family(MONO)
                .text_size(10)
                .line_height("14px")
                .text_color(t.dim || "#4d5870")
                .child("no known agents found")
            )
          )
          .when(!view.agentLoading && !view.agentError && installedAgents.length > 0, (agEl) =>
            agEl.child(
              h_flex()
                .w_full()
                .gap(5)
                .flex_wrap()
                .items_center()
                .children(
                  installedAgents.map((prog) =>
                    div()
                      .id(`orrery-mctx-ag-${prog.key}`)
                      .px(7)
                      .py(2)
                      .border_1()
                      .border_color(withAlpha(accent, "66"))
                      .bg(withAlpha(accent, "12"))
                      .font_family(MONO)
                      .text_size(10)
                      .line_height("14px")
                      .text_color(accent)
                      .cursor_pointer()
                      .hover((s) =>
                        s.bg(withAlpha(accent, "2E")).text_color(t.foreground || "#e4dfd3")
                      )
                      .on_mouse_down("left", stopProp)
                      .on_click((_e, c) => {
                        c.stop_propagation();
                        dismiss();
                        dispatchCosmosAction({
                          type: "spawn-agent-machine",
                          machine: machine.name,
                          argv: prog.run,
                          name: prog.name,
                        });
                      })
                      .child(prog.name)
                  )
                )
            )
          )
      );
    } else if (st.loading) {
      children.push(
        div()
          .px(12)
          .py(5)
          .font_family(MONO)
          .text_size(10)
          .line_height("14px")
          .text_color(st.dotColor)
          .child(`${machine.name} · ${st.label}...`)
      );
    } else {
      children.push(
        row(
          "orrery-mctx-reconnect",
          st.needsLogin ? `Log In to ${machine.name}` : `Reconnect ${machine.name}`,
          st.label,
          { bold: true, color: st.needsLogin || st.rebuilt ? t.blocked || "#f06449" : accent },
          () => {
            dismiss();
            dispatchCosmosAction({ type: "reconnect-machine", machine: machine.name });
          }
        )
      );
    }

    const confirmingRm =
      Boolean(machine.name) &&
      view.confirmRmMachine === machine.name &&
      typeof view.confirmRmMachineUntil === "number" &&
      Date.now() < view.confirmRmMachineUntil;

    children.push(
      divider(),
      row("orrery-mctx-fleet", "Open Fleet Monitor", "Alt+F", {}, () => {
        dismiss();
        openToolWindow("fleet", vp.w, vp.h);
      }),
      row("orrery-mctx-settings", "Machine Settings", "", {}, () => {
        dismiss();
        openMachinesSettings();
      }),
      divider(),
      row(
        "orrery-mctx-rm",
        confirmingRm ? `Click again to remove ${machine.name}` : "Remove Machine",
        confirmingRm ? "confirm" : "",
        confirmingRm
          ? { bold: true, color: "#ffffff", hoverBg: CLOSE_RED, hoverColor: "#ffffff" }
          : { color: t.blocked || "#f06449", hoverBg: CLOSE_RED, hoverColor: "#ffffff" },
        (_e, c) => {
          if (!machine.name) return;
          if (!confirmingRm) {
            view.confirmRmMachine = machine.name;
            view.confirmRmMachineUntil = Date.now() + 3000;
            if (view._confirmRmTimer) {
              try {
                view._confirmRmTimer.cancel();
              } catch (_err) {
                // ignore
              }
              view._confirmRmTimer = null;
            }
            if (c?.timer?.after) {
              view._confirmRmTimer = c.timer.after(3050, (asyncCx) => {
                view._confirmRmTimer = null;
                view.confirmRmMachine = "";
                view.confirmRmMachineUntil = 0;
                asyncCx.notify();
              });
            }
            c.notify();
            return;
          }
          if (view._confirmRmTimer) {
            try {
              view._confirmRmTimer.cancel();
            } catch (_err) {
              // ignore
            }
            view._confirmRmTimer = null;
          }
          view.confirmRmMachine = "";
          view.confirmRmMachineUntil = 0;
          dismiss();
          dispatchCosmosAction({ type: "remove-machine", machine: machine.name });
        }
      )
    );

    return frame(children);
  }

  // ============================================================
  // 2. FLOATING NOTE CONTEXT MENU (`kind: "note"`)
  // ============================================================
  if (kind === "note") {
    const note = getNoteById(p.noteId);
    const title = noteTitle(note, "UNTITLED").toUpperCase();
    const camX = p.camX || 0;
    const camY = p.camY || 0;
    const noteZoom = typeof p.zoom === "number" && p.zoom > 0 ? p.zoom : 1.0;

    return frame([
      section(`NOTE · ${title}`),
      row(
        "orrery-nctx-open",
        "Open Note",
        "",
        { bold: true, color: accent },
        () => {
          dismiss();
          if (note) {
            openNoteWindow(note.id, {
              vpW: vp.w,
              vpH: vp.h,
              nearX: Math.round(note.x * noteZoom + camX),
              nearY: Math.round(note.y * noteZoom + camY),
            });
          }
        }
      ),
      divider(),
      row(
        "orrery-nctx-del",
        "Delete Note",
        "",
        { color: t.blocked || "#f06449", hoverBg: CLOSE_RED, hoverColor: "#ffffff" },
        () => {
          dismiss();
          if (p.noteId) deleteNoteObject(p.noteId);
        }
      ),
    ]);
  }

  // ============================================================
  // 3. TASKBAR WINDOW CONTEXT MENU (`kind: "taskbar"`)
  // ============================================================
  if (kind === "taskbar") {
    const targetKind = p.targetKind || "terminal";
    const targetId = p.targetId || "";
    const isTerm = targetKind === "terminal";
    const isNote = targetKind === "note";
    const openWins = getOpenWindowAddrSet();
    const openTools = readOpenTools();
    const openNotes = readOpenNotes();
    const isOpen = isTerm
      ? openWins.has(targetId)
      : isNote
        ? isNoteVisible(targetId, openNotes)
        : isToolVisible(targetId, openTools);

    const ag = isTerm ? (agents() || []).find((a) => a.address === targetId) || null : null;
    const winScale = getWindowScale(targetKind, targetId);
    const scalePct = Math.round(winScale * 100);
    const isScaled = Math.abs(scalePct - 100) >= 3;

    const children = [
      section("WINDOW"),
      row(
        "orrery-tbm-toggle",
        isOpen ? "Minimize" : "Restore",
        "",
        { bold: true },
        () => {
          dismiss();
          if (isTerm) {
            if (isOpen) {
              minimizeTerminalWindow(targetId);
            } else {
              openTerminalWindow(targetId, { vpW: vp.w, vpH: vp.h });
            }
          } else if (isNote) {
            toggleNoteWindow(targetId, vp.w, vp.h);
          } else {
            toggleToolWindow(targetId, vp.w, vp.h);
          }
        }
      ),
    ];

    if (isScaled) {
      children.push(
        row(
          "orrery-tbm-reset-scale",
          "Reset Scale (100%)",
          `${scalePct}%`,
          { color: accent },
          () => {
            dismiss();
            resetWindowScale(targetKind, targetId);
          }
        )
      );
    }

    if (isTerm) {
      if (ag) {
        children.push(
          row(
            "orrery-tbm-pin",
            ag.pinned ? "Unpin Agent" : "Pin Agent",
            ag.pinned ? "★" : "",
            { color: ag.pinned ? accent : t.foreground || "#e4dfd3" },
            () => {
              dismiss();
              run("terminal.pin", { terminal: targetId, pinned: !ag.pinned });
              syncAgentOrder();
            }
          )
        );
      }
      children.push(
        row("orrery-tbm-left", "Snap Left", "", {}, () => {
          dismiss();
          openTerminalWindow(targetId, {
            vpW: vp.w,
            vpH: vp.h,
            tile: "left",
            forceMove: true,
          });
        }),
        row("orrery-tbm-right", "Snap Right", "", {}, () => {
          dismiss();
          openTerminalWindow(targetId, {
            vpW: vp.w,
            vpH: vp.h,
            tile: "right-half",
            forceMove: true,
          });
        }),
        row("orrery-tbm-max", "Maximize Full-Screen", "Alt+O", {}, () => {
          dismiss();
          enterFocusMode(targetId);
        })
      );
    }

    children.push(
      divider(),
      row(
        "orrery-tbm-close",
        isNote ? "Close Window" : "Close",
        "",
        isNote ? {} : { color: t.blocked || "#f06449", hoverBg: CLOSE_RED, hoverColor: "#ffffff" },
        () => {
          dismiss();
          if (isTerm) {
            closeAndEndTerminal(targetId);
          } else if (isNote) {
            closeNoteWindow(targetId);
          } else {
            closeToolWindow(targetId);
          }
        }
      )
    );

    if (isNote) {
      children.push(
        row(
          "orrery-tbm-del-note",
          "Delete Note",
          "",
          { color: t.blocked || "#f06449", hoverBg: CLOSE_RED, hoverColor: "#ffffff" },
          () => {
            dismiss();
            deleteNoteObject(targetId);
          }
        )
      );
    }

    return frame(children);
  }

  // ============================================================
  // 4. DEDICATED NEW SPACE MACHINE SELECTOR (`kind: "new-space"` or desktop drill-in)
  // ============================================================
  const remoteMachines = readMachinesList().filter((m) => !m.isLocal);
  const hasMultipleMachines = remoteMachines.length > 0;
  const camX = p.camX || 0;
  const camY = p.camY || 0;
  const zoom = typeof p.zoom === "number" && p.zoom > 0 ? p.zoom : 1.0;
  const clickX = typeof p.clickX === "number" ? p.clickX : Math.round(vp.w / 2);
  const clickY = typeof p.clickY === "number" ? p.clickY : Math.round(vp.h / 2);
  const clickWorld =
    kind === "desktop"
      ? { x: Math.round((clickX - camX) / zoom), y: Math.round((clickY - camY) / zoom) }
      : null;

  if (kind === "new-space" || (kind === "desktop" && view.showNewSpace)) {
    const pickerRows = [];
    if (kind === "desktop") {
      pickerRows.push(
        row(
          "orrery-ctx-ns-back",
          "← Back",
          "",
          { color: t.muted || "#8b93a6" },
          (_e, c) => {
            view.showNewSpace = false;
            c.notify();
          }
        ),
        divider()
      );
    }
    pickerRows.push(
      section("NEW SPACE · CHOOSE MACHINE"),
      row(
        "orrery-ctx-ns-local-browse",
        "● local (Browse folder...)",
        "this pc",
        { bold: true, color: accent },
        () => {
          dismiss();
          dispatchCosmosAction({ type: "browse-space", atWorld: clickWorld });
        }
      ),
      row(
        "orrery-ctx-ns-local-here",
        "● local (Current folder)",
        "here",
        {},
        () => {
          dismiss();
          dispatchCosmosAction({ type: "spawn-space", machine: "", atWorld: clickWorld });
        }
      )
    );

    if (remoteMachines.length > 0) {
      pickerRows.push(divider(), section(`SSH MACHINES (${remoteMachines.length})`));
      for (const rm of remoteMachines) {
        const st = machineStatusInfo(rm, t);
        pickerRows.push(
          row(
            `orrery-ctx-ns-rm-${rm.name}`,
            `● ssh:${rm.name}`,
            st.connected ? "+ space" : st.needsLogin ? "login" : st.label,
            {
              color: st.connected ? t.foreground || "#e4dfd3" : t.muted || "#8b93a6",
              hintColor: st.dotColor,
            },
            () => {
              dismiss();
              if (st.connected) {
                dispatchCosmosAction({ type: "spawn-space", machine: rm.name, atWorld: clickWorld });
              } else {
                dispatchCosmosAction({ type: "reconnect-machine", machine: rm.name });
              }
            }
          )
        );
      }
    }

    pickerRows.push(
      divider(),
      row(
        "orrery-ctx-ns-add-mach",
        "+ Add SSH Machine...",
        "ssh",
        { color: t.done || "#5fd4b8" },
        () => {
          dismiss();
          openAddMachineDialog();
        }
      )
    );

    return frame(pickerRows);
  }

  // ============================================================
  // 5. EMPTY COSMOS DESKTOP MENU (`kind: "desktop"`)
  // ============================================================
  const allSpaces = spaces() || [];
  const activeSpace = allSpaces.find((s) => s.active) ?? allSpaces[0] ?? null;
  const activeSpaceLabel = activeSpace ? spaceDisplayName(activeSpace) : "Space";
  const isMoved = camX !== 0 || camY !== 0 || Math.abs(zoom - 1.0) >= 0.01;

  const desktopItems = [
    section("SPACES & TERMINALS"),
    row(
      "orrery-ctx-drop-note",
      "Drop Note Here",
      "",
      { bold: true, color: accent },
      () => {
        dismiss();
        const worldX = Math.round((clickX - camX) / zoom - 88);
        const worldY = Math.round((clickY - camY) / zoom - 22);
        const created = createNoteObject({ x: worldX, y: worldY, text: "" });
        openNoteWindow(created.id, {
          vpW: vp.w,
          vpH: vp.h,
          nearX: clickX,
          nearY: clickY,
          forceNear: true,
          autoFocus: true,
        });
      }
    ),
    row("orrery-ctx-term", `New Terminal (${activeSpaceLabel})`, "", {}, () => {
      dismiss();
      dispatchCosmosAction({ type: "spawn-terminal", spaceId: activeSpace?.id || "" });
    }),
    row(
      "orrery-ctx-space",
      hasMultipleMachines ? "New Space..." : "New Space (Browse...)",
      hasMultipleMachines ? `${remoteMachines.length + 1} machines ▸` : "",
      { color: hasMultipleMachines ? accent : t.foreground || "#e4dfd3" },
      (_e, c) => {
        if (hasMultipleMachines) {
          view.showNewSpace = true;
          c.notify();
        } else {
          dismiss();
          dispatchCosmosAction({ type: "browse-space", atWorld: clickWorld });
        }
      }
    ),
    row("orrery-ctx-add-mach", "Add Machine...", "ssh", { color: t.done || "#5fd4b8" }, () => {
      dismiss();
      openAddMachineDialog();
    }),
    divider(),
    section("APPS"),
    row("orrery-ctx-files", "Files", "Alt+E", {}, () => {
      dismiss();
      openToolWindow("files", vp.w, vp.h);
    }),
    row("orrery-ctx-changes", "Git Changes", "Alt+G", {}, () => {
      dismiss();
      openToolWindow("changes", vp.w, vp.h);
    }),
    row("orrery-ctx-fleet", "Fleet Monitor", "Alt+F", {}, () => {
      dismiss();
      openToolWindow("fleet", vp.w, vp.h);
    }),
    divider(),
    section("DESKTOP"),
  ];

  if (isMoved) {
    desktopItems.push(
      row(
        "orrery-ctx-reset-view",
        "Reset View (100%)",
        `${Math.round(zoom * 100)}%`,
        { color: t.done || "#5fd4b8" },
        () => {
          dismiss();
          requestResetView();
        }
      )
    );
  }

  desktopItems.push(
    row("orrery-ctx-tile", "Tile Windows", "Alt+T", {}, () => {
      dismiss();
      tileAllOpenWindows(vp.w, vp.h);
    }),
    row("orrery-ctx-desktop", "Show Desktop", "Alt+M", {}, () => {
      dismiss();
      toggleShowDesktop(vp.w, vp.h);
    }),
    row("orrery-ctx-settings", "Settings", "", {}, () => {
      dismiss();
      run("app.settings");
    })
  );

  return frame(desktopItems);
}
