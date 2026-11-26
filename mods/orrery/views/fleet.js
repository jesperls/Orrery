// Orrery Desktop App: Fleet Monitor (`role: "fleet"`).
// Full fleet & multi-machine manager listing:
//   - MACHINES            : Local computer + every remote SSH machine (+ add machine, settings,
//                           live status dot, + space, connect/login, 3s rm? remove safeguard)
//   - SPACES              : Grouped by machine when remotes exist, with branch, tab count,
//                           open, + term, rename, and × close
//   - AGENTS & SUB-AGENTS : Urgency-sorted (blocked > pinned > done > working > idle),
//                           working terminal.pin, open/min, peek, 3s kill confirm,
//                           and sub-agent keep / park / peek / ×
//   - SHELLS & TERMINALS  : Every non-agent plain shell/program terminal with Space name,
//                           open/min, peek, and × kill

import { div } from "gpui-kit";
import { h_flex, v_flex } from "gpui-base";
import {
  agents,
  focused,
  panes,
  pickFolder,
  run,
  spaces,
  terminals,
  theme,
} from "herdr";
import {
  agentActivity,
  agentElapsed,
  agentLocation,
  agentName,
  buildGitBySpace,
  cleanAgentName,
  CLEAR,
  closeAndEndTerminal,
  dispatchCosmosAction,
  focusNextBlocked,
  getOpenWindowAddrSet,
  getViewportDims,
  groupSubAgents,
  isFocusMode,
  LIVE_ZOOM_MIN,
  loadKnownAgents,
  machineStatusInfo,
  minimizeTerminalWindow,
  MONO,
  openAddMachineDialog,
  openMachinesSettings,
  openSpaceTerminalAsync,
  openTerminalWindow,
  readCamera,
  readGitInfo,
  readMachinesList,
  readOpenWins,
  reconnectMachine,
  removeMachine,
  sortAgentsByUrgency,
  spaceDisplayName,
  spawnNewSpace,
  spawnTerminalInSpace,
  statusColor,
  statusGlyph,
  syncAgentOrder,
  tileAllOpenWindows,
  withAlpha,
} from "../state.js";

const CLOSE_RED = "#c43e2b";

function stopProp(_e, cx) {
  cx.stop_propagation();
}

export function renderFleet(view, _cx) {
  const t = theme() ?? {};
  const vp = getViewportDims();
  const accent = t.accent || "#e8a849";
  const focusMode = isFocusMode();
  const openWinsMap = readOpenWins();
  const cam = readCamera();

  const focusOrOpenTerm = (addr, isAgent = false) => {
    if (!addr) return;
    if (focusMode) {
      run(isAgent ? "agent.focus" : "pane.focus", { terminal: addr });
      return;
    }
    const rec = openWinsMap[addr];
    if (rec && ((cam.zoom || 1.0) < LIVE_ZOOM_MIN || rec.suspended || !rec.overlayId)) {
      dispatchCosmosAction({ type: "focus-world-window", kind: "terminal", id: addr });
    } else {
      openTerminalWindow(addr, { vpW: vp.w, vpH: vp.h });
    }
  };

  const allSpaces = spaces() || [];
  const spaceMap = new Map(allSpaces.map((sp) => [sp.id, sp]));
  const activeSpace = allSpaces.find((sp) => sp.active) ?? allSpaces[0] ?? null;
  const allAgents = sortAgentsByUrgency(agents() || []);
  const agentAddrs = new Set(allAgents.map((a) => a.address).filter(Boolean));
  const allTerms = terminals() || [];
  const termMap = new Map(allTerms.map((x) => [x.address, x]));
  const allPanes = panes() || [];
  const paneByTerm = new Set(allPanes.map((p) => p?.terminal).filter(Boolean));
  const { byParent, allSubAgents } = groupSubAgents(allAgents, allTerms);
  const openAddrs = getOpenWindowAddrSet();
  const foc = focused();
  const gitBySpace = buildGitBySpace(allSpaces, readGitInfo());

  const machinesList = readMachinesList();
  const remoteMachines = machinesList.filter((m) => !m.isLocal);
  const readyRemotes = remoteMachines.filter((m) => machineStatusInfo(m, t).connected);
  const hasRemotes = remoteMachines.length > 0;

  // Non-agent, non-subagent plain shells & terminals (zsh, bash, nvim, etc.)
  const plainShells = allTerms.filter(
    (tm) => tm?.address && !agentAddrs.has(tm.address) && !tm.parent
  );
  // Any sub-agent whose parent isn't a known agent (e.g., spawned from a plain shell)
  const parentedSubAddrs = new Set();
  for (const list of byParent.values()) {
    for (const s of list) {
      if (s?.address) parentedSubAddrs.add(s.address);
    }
  }
  const orphanSubs = allSubAgents.filter((s) => s?.address && !parentedSubAddrs.has(s.address));

  const blockedCount = allAgents.filter((a) => a.status === "blocked").length;
  const installedAgents = (view.agentList || []).filter((p) => p.installed);

  const summaryParts = [
    `${allSpaces.length} space${allSpaces.length === 1 ? "" : "s"}`,
    `${allAgents.length} agent${allAgents.length === 1 ? "" : "s"}`,
  ];
  if (plainShells.length > 0) {
    summaryParts.push(`${plainShells.length} shell${plainShells.length === 1 ? "" : "s"}`);
  }
  if (remoteMachines.length > 0) {
    summaryParts.push(`${remoteMachines.length} ssh`);
  }

  const actionChip = (id, label, tip, opts, onClick) =>
    div()
      .id(id)
      .flex_none()
      .px(6)
      .py(2)
      .border_1()
      .border_color(opts.border || withAlpha(t.border || "#1f2b40", "CC"))
      .when(Boolean(opts.bg), (el) => el.bg(opts.bg))
      .font_family(MONO)
      .text_size(10)
      .line_height("14px")
      .when(Boolean(opts.bold), (el) => el.font_bold())
      .text_color(opts.color || t.muted || "#8b93a6")
      .cursor_pointer()
      .hover((st) =>
        st
          .bg(opts.hoverBg || t.hover || "#172236")
          .text_color(opts.hoverColor || t.foreground || "#e4dfd3")
      )
      .tooltip(tip)
      .on_mouse_down("left", stopProp)
      .on_click((e, c) => {
        c.stop_propagation();
        onClick(e, c);
      })
      .child(label);

  const sectionHeader = (title, rightText = "", rightControls = null) =>
    h_flex()
      .w_full()
      .pb(4)
      .border_b_1()
      .border_color(withAlpha(t.border || "#1f2b40", "99"))
      .items_center()
      .justify_between()
      .gap(8)
      .child(
        div()
          .font_family(MONO)
          .text_size(10)
          .line_height("14px")
          .font_bold()
          .text_color(t.dim || "#4d5870")
          .child(title)
      )
      .when(Boolean(rightControls), (el) => el.child(rightControls))
      .when(!rightControls && Boolean(rightText), (el) =>
        el.child(
          div()
            .font_family(MONO)
            .text_size(10)
            .line_height("14px")
            .text_color(t.dim || "#4d5870")
            .child(rightText)
        )
      );

  const handleKill = (addr, isActive, c) => {
    const confirming =
      view.confirmCloseAddr === addr &&
      typeof view.confirmCloseUntil === "number" &&
      Date.now() < view.confirmCloseUntil;
    if (isActive && !confirming) {
      view.confirmCloseAddr = addr;
      view.confirmCloseUntil = Date.now() + 3000;
      if (view._confirmTimer) {
        try {
          view._confirmTimer.cancel();
        } catch (_err) {
          // ignore
        }
        view._confirmTimer = null;
      }
      if (c?.timer?.after) {
        view._confirmTimer = c.timer.after(3050, (asyncCx) => {
          view._confirmTimer = null;
          view.confirmCloseAddr = "";
          view.confirmCloseUntil = 0;
          asyncCx.notify();
        });
      }
      c.notify();
      return;
    }
    if (view._confirmTimer) {
      try {
        view._confirmTimer.cancel();
      } catch (_err) {
        // ignore
      }
      view._confirmTimer = null;
    }
    view.confirmCloseAddr = "";
    view.confirmCloseUntil = 0;
    closeAndEndTerminal(addr);
    c.notify();
  };

  const handleRemoveMachine = (machineName, c) => {
    const confirming =
      view.confirmRmMachine === machineName &&
      typeof view.confirmRmMachineUntil === "number" &&
      Date.now() < view.confirmRmMachineUntil;
    if (!confirming) {
      view.confirmRmMachine = machineName;
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
    removeMachine(c, machineName);
    c.notify();
  };

  const renderSpaceRow = (sp, idx) => {
    const gi = gitBySpace[sp.id];
    const branch = gi?.branch || sp.branch || "";
    const dirty = gi?.dirtyCount || 0;
    const spTitle = hasRemotes ? sp.name || "space" : spaceDisplayName(sp);
    const tabCount = (sp.tabs || []).length;

    return h_flex()
      .id(`orrery-fl-sp-${sp.id || idx}`)
      .w_full()
      .px(8)
      .py(6)
      .gap(8)
      .items_center()
      .justify_between()
      .bg(sp.active ? t.raised || "#131c2e" : withAlpha(t.background || "#070a12", "66"))
      .border_l_1()
      .border_color(sp.active ? accent : CLEAR)
      .hover((st) => st.bg(withAlpha(t.hover || "#172236", "BB")))
      .child(
        h_flex()
          .id(`orrery-fl-sp-body-${sp.id || idx}`)
          .flex_1()
          .min_w(0)
          .gap(7)
          .items_center()
          .overflow_hidden()
          .cursor_pointer()
          .on_mouse_down("left", stopProp)
          .on_click((_e, c) => {
            c.stop_propagation();
            if (focusMode) {
              run("space.select", { id: sp.id });
            } else {
              openSpaceTerminalAsync(c, sp, vp.w, vp.h);
            }
            c.notify();
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
              .font_family(MONO)
              .text_size(11)
              .line_height("15px")
              .when(Boolean(sp.active), (el) => el.font_bold())
              .text_color(sp.active ? t.foreground || "#e4dfd3" : t.muted || "#8b93a6")
              .whitespace_nowrap()
              .child(spTitle)
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
                .child(dirty > 0 ? `${branch} (${dirty}*)` : branch)
            )
          )
          .child(
            div()
              .flex_none()
              .font_family(MONO)
              .text_size(10)
              .line_height("14px")
              .text_color(t.dim || "#4d5870")
              .whitespace_nowrap()
              .child(`${tabCount}t`)
          )
      )
      .child(
        h_flex()
          .flex_none()
          .gap(4)
          .items_center()
          .child(
            actionChip(
              `orrery-fl-sp-open-${sp.id || idx}`,
              focusMode ? "focus" : "open",
              focusMode
                ? `Switch to ${spaceDisplayName(sp)}`
                : `Focus & open terminal in ${spaceDisplayName(sp)}`,
              { color: t.foreground || "#e4dfd3" },
              (_e, c) => {
                if (focusMode) {
                  run("space.select", { id: sp.id });
                } else {
                  openSpaceTerminalAsync(c, sp, vp.w, vp.h);
                }
                c.notify();
              }
            )
          )
          .child(
            actionChip(
              `orrery-fl-sp-tab-${sp.id || idx}`,
              "+ term",
              `New terminal in ${spaceDisplayName(sp)}`,
              { color: accent },
              (_e, c) => {
                spawnTerminalInSpace(c, sp.id, { vpW: vp.w, vpH: vp.h });
                c.notify();
              }
            )
          )
          .child(
            actionChip(
              `orrery-fl-sp-ren-${sp.id || idx}`,
              "rename",
              `Rename Space ${spaceDisplayName(sp)}`,
              {},
              () => run("space.rename", { id: sp.id })
            )
          )
          .when(allSpaces.length > 1, (xEl) =>
            xEl.child(
              actionChip(
                `orrery-fl-sp-close-${sp.id || idx}`,
                "×",
                `Close Space ${spaceDisplayName(sp)}`,
                { hoverBg: CLOSE_RED, hoverColor: "#ffffff" },
                (_e, c) => {
                  run("space.close", { id: sp.id });
                  c.notify();
                }
              )
            )
          )
      );
  };

  const renderSubAgentRow = (sub, sIdx, keyPrefix = "sub") => {
    const subOpen = openAddrs.has(sub.address);
    const subHasPane = paneByTerm.has(sub.address);
    const subSc = statusColor(sub.status, t);
    const subName = cleanAgentName(sub.program?.name || sub.name || "sub-agent");

    return h_flex()
      .id(`orrery-fl-${keyPrefix}-${sub.address || sIdx}`)
      .w_full()
      .pl(20)
      .pr(8)
      .py(4)
      .gap(8)
      .items_center()
      .justify_between()
      .bg(withAlpha(t.background || "#070a12", "44"))
      .hover((st) => st.bg(withAlpha(t.hover || "#172236", "88")))
      .child(
        h_flex()
          .id(`orrery-fl-${keyPrefix}-body-${sub.address || sIdx}`)
          .flex_1()
          .min_w(0)
          .gap(6)
          .items_center()
          .overflow_hidden()
          .cursor_pointer()
          .on_mouse_down("left", stopProp)
          .on_click((_e, c) => {
            c.stop_propagation();
            focusOrOpenTerm(sub.address, false);
            c.notify();
          })
          .child(
            div()
              .flex_none()
              .font_family(MONO)
              .text_size(10)
              .line_height("14px")
              .text_color(t.dim || "#4d5870")
              .child("└")
          )
          .child(
            div()
              .flex_none()
              .font_family(MONO)
              .text_size(10)
              .line_height("14px")
              .font_bold()
              .text_color(subSc)
              .child(statusGlyph(sub.status))
          )
          .child(
            div()
              .min_w(0)
              .font_family(MONO)
              .text_size(10)
              .line_height("14px")
              .text_color(t.muted || "#8b93a6")
              .truncate()
              .child(subName)
          )
      )
      .child(
        h_flex()
          .flex_none()
          .gap(4)
          .items_center()
          .child(
            actionChip(
              `orrery-fl-${keyPrefix}-open-${sub.address || sIdx}`,
              focusMode ? "focus" : subOpen ? "min" : "open",
              focusMode
                ? "Focus sub-agent"
                : subOpen
                  ? "Minimize sub-agent window"
                  : "Open sub-agent window",
              { color: !focusMode && subOpen ? accent : t.foreground || "#e4dfd3" },
              (_e, c) => {
                if (focusMode) {
                  run("pane.focus", { terminal: sub.address });
                } else if (subOpen) {
                  minimizeTerminalWindow(sub.address);
                } else {
                  focusOrOpenTerm(sub.address, false);
                }
                c.notify();
              }
            )
          )
          .child(
            subHasPane
              ? actionChip(
                  `orrery-fl-${keyPrefix}-park-${sub.address || sIdx}`,
                  "park",
                  "Remove pane and send sub-agent back under parent",
                  { color: t.muted || "#8b93a6" },
                  (_e, c) => {
                    run("terminal.park", { terminal: sub.address });
                    c.notify();
                  }
                )
              : actionChip(
                  `orrery-fl-${keyPrefix}-keep-${sub.address || sIdx}`,
                  "keep",
                  "Promote sub-agent into its own kept tab/pane",
                  { color: t.done || "#5fd4b8" },
                  (_e, c) => {
                    run("terminal.keep", { terminal: sub.address });
                    c.notify();
                  }
                )
          )
          .child(
            actionChip(
              `orrery-fl-${keyPrefix}-peek-${sub.address || sIdx}`,
              "peek",
              "Peek sub-agent",
              {},
              () => run("terminal.peek", { terminal: sub.address })
            )
          )
          .child(
            actionChip(
              `orrery-fl-${keyPrefix}-kill-${sub.address || sIdx}`,
              "×",
              "Close sub-agent",
              { hoverBg: CLOSE_RED, hoverColor: "#ffffff" },
              (_e, c) => {
                closeAndEndTerminal(sub.address);
                c.notify();
              }
            )
          )
      );
  };

  // Build grouped Spaces children when remote machines exist
  const spaceChildren = [];
  if (!hasRemotes) {
    allSpaces.forEach((sp, idx) => spaceChildren.push(renderSpaceRow(sp, idx)));
  } else {
    for (const m of machinesList) {
      const groupSpaces = allSpaces.filter((sp) => (sp.machine || null) === (m.name || null));
      if (groupSpaces.length === 0) continue;
      const st = machineStatusInfo(m, t);
      spaceChildren.push(
        h_flex()
          .id(`orrery-fl-spgrp-${m.isLocal ? "local" : m.name}`)
          .w_full()
          .pt(4)
          .pb(1)
          .px(4)
          .gap(6)
          .items_center()
          .child(
            div()
              .font_family(MONO)
              .text_size(8)
              .line_height("12px")
              .text_color(st.dotColor)
              .child("●")
          )
          .child(
            div()
              .font_family(MONO)
              .text_size(9)
              .line_height("12px")
              .font_bold()
              .text_color(t.dim || "#4d5870")
              .child(m.isLocal ? "THIS COMPUTER" : `SSH · ${m.name.toUpperCase()}`)
          )
      );
      groupSpaces.forEach((sp, idx) => spaceChildren.push(renderSpaceRow(sp, idx)));
    }
  }

  return v_flex()
    .id("orrery-fleet-app")
    .size_full()
    .bg(t.surface || "#0b101c")
    .on_mouse_down("left", stopProp)
    .on_mouse_down("right", stopProp)
    .on_mouse_down("middle", stopProp)
    // Top Toolbar
    .child(
      h_flex()
        .flex_none()
        .w_full()
        .h(34)
        .px(10)
        .gap(8)
        .items_center()
        .justify_between()
        .bg(t.chrome || "#090d17")
        .border_b_1()
        .border_color(t.border || "#1f2b40")
        .child(
          h_flex()
            .flex_1()
            .min_w(0)
            .gap(8)
            .items_center()
            .overflow_hidden()
            .child(
              div()
                .min_w(0)
                .font_family(MONO)
                .text_size(11)
                .line_height("15px")
                .text_color(t.muted || "#8b93a6")
                .truncate()
                .child(summaryParts.join(" · "))
            )
            .when(blockedCount > 0, (bEl) =>
              bEl.child(
                div()
                  .id("orrery-fleet-blocked-pill")
                  .flex_none()
                  .px(7)
                  .py(1)
                  .bg(withAlpha(t.blocked || "#f06449", "24"))
                  .border_1()
                  .border_color(t.blocked || "#f06449")
                  .font_family(MONO)
                  .text_size(10)
                  .line_height("14px")
                  .font_bold()
                  .text_color(t.blocked || "#f06449")
                  .cursor_pointer()
                  .hover((st) => st.bg(withAlpha(t.blocked || "#f06449", "3D")))
                  .tooltip("Jump to blocked agent")
                  .loop("opacity", { from: 0.45, to: 1.0, period: 800 })
                  .on_mouse_down("left", stopProp)
                  .on_click((_e, c) => {
                    c.stop_propagation();
                    focusNextBlocked(view);
                    c.notify();
                  })
                  .child(`! ${blockedCount} blocked`)
              )
            )
        )
        .child(
          h_flex()
            .flex_none()
            .gap(5)
            .items_center()
            .child(
              actionChip(
                "orrery-fleet-add-agent",
                "+ agent",
                "Launch coding agent",
                {
                  color: view.showAgentPicker ? accent : t.foreground || "#e4dfd3",
                  border: view.showAgentPicker ? accent : undefined,
                },
                (_e, c) => {
                  view.showAgentPicker = !view.showAgentPicker;
                  if (view.showAgentPicker) {
                    view.showNewSpace = false;
                    loadKnownAgents(view, c, activeSpace?.machine ?? null);
                  }
                  c.notify();
                }
              )
            )
            .child(
              actionChip(
                "orrery-fleet-add-space",
                "+ space",
                "Create a new space",
                {
                  color: view.showNewSpace ? accent : t.foreground || "#e4dfd3",
                  border: view.showNewSpace ? accent : undefined,
                },
                (_e, c) => {
                  view.showNewSpace = !view.showNewSpace;
                  if (view.showNewSpace) view.showAgentPicker = false;
                  c.notify();
                }
              )
            )
            .when(!focusMode, (tEl) =>
              tEl.child(
                actionChip(
                  "orrery-fleet-tile",
                  "tile",
                  "Tile all open terminal windows (Alt+T)",
                  { color: t.muted || "#8b93a6" },
                  (_e, c) => {
                    tileAllOpenWindows(vp.w, vp.h);
                    c.notify();
                  }
                )
              )
            )
        )
    )
    // Inline +agent drawer inside Fleet Monitor
    .when(Boolean(view.showAgentPicker), (el) =>
      el.child(
        h_flex()
          .flex_none()
          .w_full()
          .px(10)
          .py(7)
          .gap(8)
          .flex_wrap()
          .items_center()
          .bg(t.raised || "#131c2e")
          .border_b_1()
          .border_color(t.border || "#1f2b40")
          .child(
            div()
              .font_family(MONO)
              .text_size(10)
              .line_height("14px")
              .text_color(t.dim || "#4d5870")
              .child(
                activeSpace ? `LAUNCH IN ${spaceDisplayName(activeSpace).toUpperCase()}:` : "LAUNCH:"
              )
          )
          .when(Boolean(view.agentLoading), (lEl) =>
            lEl.child(
              div()
                .font_family(MONO)
                .text_size(11)
                .line_height("15px")
                .text_color(t.dim || "#4d5870")
                .child("scanning PATH...")
            )
          )
          .when(!view.agentLoading && Boolean(view.agentError), (eEl) =>
            eEl
              .child(
                div()
                  .font_family(MONO)
                  .text_size(11)
                  .line_height("15px")
                  .text_color(t.blocked || "#f06449")
                  .child(view.agentError)
              )
              .child(
                actionChip(
                  "orrery-fleet-agent-retry",
                  "retry",
                  "Re-scan PATH for coding agents",
                  { color: t.muted || "#8b93a6" },
                  (_e, c) => {
                    loadKnownAgents(view, c, activeSpace?.machine ?? null);
                    c.notify();
                  }
                )
              )
          )
          .when(!view.agentLoading && !view.agentError && (view.agentMachine ?? null) !== (activeSpace?.machine ?? null), (mEl) =>
            mEl.child(
              actionChip(
                "orrery-fleet-agent-rescan",
                "rescan host",
                `Active space switched host — scan ${activeSpace?.machine || "local"} PATH`,
                { color: t.done || "#5fd4b8" },
                (_e, c) => {
                  loadKnownAgents(view, c, activeSpace?.machine ?? null);
                  c.notify();
                }
              )
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
                    .child("no known agents in PATH")
                )
              )
              .children(
                installedAgents.map((prog) =>
                  actionChip(
                    `orrery-fleet-launch-${prog.key}`,
                    prog.name,
                    `Launch ${prog.name} in ${activeSpace ? spaceDisplayName(activeSpace) : "active space"}`,
                    { color: accent },
                    (_e, c) => {
                      view.showAgentPicker = false;
                      spawnTerminalInSpace(c, activeSpace?.id || "", {
                        argv: prog.run,
                        name: prog.name,
                        vpW: vp.w,
                        vpH: vp.h,
                      });
                      c.notify();
                    }
                  )
                )
              )
          )
      )
    )
    // Inline +space drawer inside Fleet Monitor
    .when(Boolean(view.showNewSpace), (el) =>
      el.child(
        h_flex()
          .flex_none()
          .w_full()
          .px(10)
          .py(7)
          .gap(8)
          .flex_wrap()
          .items_center()
          .bg(t.raised || "#131c2e")
          .border_b_1()
          .border_color(t.border || "#1f2b40")
          .child(
            div()
              .font_family(MONO)
              .text_size(10)
              .line_height("14px")
              .text_color(t.dim || "#4d5870")
              .child("NEW SPACE:")
          )
          .child(
            actionChip(
              "orrery-fleet-sp-browse",
              "Browse folder...",
              "Pick a local folder for a new space",
              { color: accent },
              (_e, c) => {
                c.spawn(async (asyncCx) => {
                  try {
                    const folder = await pickFolder({ prompt: "New Space" });
                    if (folder) {
                      view.showNewSpace = false;
                      spawnNewSpace(asyncCx, { folder, machine: "", vpW: vp.w, vpH: vp.h });
                      asyncCx.notify();
                    }
                  } catch (_err) {
                    // cancelled
                  }
                });
              }
            )
          )
          .child(
            actionChip(
              "orrery-fleet-sp-here",
              "This computer",
              "Create local space in current folder",
              { color: t.foreground || "#e4dfd3" },
              (_e, c) => {
                view.showNewSpace = false;
                spawnNewSpace(c, { machine: "", vpW: vp.w, vpH: vp.h });
                c.notify();
              }
            )
          )
          .children(
            readyRemotes.map((rm) =>
              actionChip(
                `orrery-fleet-sp-rm-${rm.name}`,
                `ssh:${rm.name}`,
                `New space on ${rm.name}`,
                { color: t.done || "#5fd4b8" },
                (_e, c) => {
                  view.showNewSpace = false;
                  spawnNewSpace(c, { machine: rm.name, vpW: vp.w, vpH: vp.h });
                  c.notify();
                }
              )
            )
          )
          .child(
            actionChip(
              "orrery-fleet-sp-add-mach",
              "+ add machine...",
              "Connect a remote SSH machine",
              { color: t.muted || "#8b93a6" },
              (_e, c) => {
                view.showNewSpace = false;
                openAddMachineDialog();
                c.notify();
              }
            )
          )
      )
    )
    // Main Scrollable Table Body
    .child(
      v_flex()
        .id("orrery-fleet-scroll")
        .flex_1()
        .min_h(0)
        .w_full()
        .p(10)
        .gap(14)
        .overflow_y_scroll()
        // --- SECTION 1: MACHINES ---
        .child(
          v_flex()
            .w_full()
            .gap(3)
            .child(
              sectionHeader(
                "MACHINES",
                "",
                h_flex()
                  .gap(5)
                  .items_center()
                  .child(
                    actionChip(
                      "orrery-fl-mach-add",
                      "+ add machine",
                      "Add a remote SSH machine (Herdr wizard)",
                      { color: t.done || "#5fd4b8", border: withAlpha(t.done || "#5fd4b8", "77") },
                      () => openAddMachineDialog()
                    )
                  )
                  .child(
                    actionChip(
                      "orrery-fl-mach-settings",
                      "settings",
                      "Open Machines settings",
                      {},
                      () => openMachinesSettings()
                    )
                  )
              )
            )
            .children(
              machinesList.map((m, idx) => {
                const st = machineStatusInfo(m, t);
                const key = m.isLocal ? "local" : m.name || String(idx);
                const confirmingRm =
                  !m.isLocal &&
                  view.confirmRmMachine === m.name &&
                  typeof view.confirmRmMachineUntil === "number" &&
                  Date.now() < view.confirmRmMachineUntil;
                const hostDetail = m.host && m.host !== m.name ? m.host : "";
                const tipLines = [
                  m.isLocal ? "This computer (local host)" : `SSH machine: ${m.name}`,
                  hostDetail ? `Target: ${hostDetail}` : "",
                  `Status: ${st.label}`,
                  m.why ? `Detail: ${m.why}` : "",
                ].filter(Boolean);

                return h_flex()
                  .id(`orrery-fl-mach-${key}`)
                  .w_full()
                  .px(8)
                  .py(6)
                  .gap(8)
                  .items_center()
                  .justify_between()
                  .bg(withAlpha(t.background || "#070a12", m.isLocal ? "66" : "88"))
                  .border_l_1()
                  .border_color(st.dotColor)
                  .hover((s) => s.bg(withAlpha(t.hover || "#172236", "BB")))
                  .tooltip(tipLines.join("\n"))
                  .child(
                    h_flex()
                      .flex_1()
                      .min_w(0)
                      .gap(7)
                      .items_center()
                      .overflow_hidden()
                      .child(
                        div()
                          .flex_none()
                          .font_family(MONO)
                          .text_size(9)
                          .line_height("14px")
                          .text_color(st.dotColor)
                          .child("●")
                      )
                      .child(
                        div()
                          .flex_none()
                          .font_family(MONO)
                          .text_size(11)
                          .line_height("15px")
                          .font_bold()
                          .text_color(t.foreground || "#e4dfd3")
                          .whitespace_nowrap()
                          .child(m.label)
                      )
                      .when(Boolean(hostDetail), (hEl) =>
                        hEl.child(
                          div()
                            .min_w(0)
                            .font_family(MONO)
                            .text_size(10)
                            .line_height("14px")
                            .text_color(t.dim || "#4d5870")
                            .truncate()
                            .child(hostDetail)
                        )
                      )
                      .child(
                        div()
                          .flex_none()
                          .font_family(MONO)
                          .text_size(10)
                          .line_height("14px")
                          .text_color(st.connected ? t.done || "#5fd4b8" : st.dotColor)
                          .whitespace_nowrap()
                          .child(st.label)
                      )
                      .child(
                        div()
                          .flex_none()
                          .font_family(MONO)
                          .text_size(10)
                          .line_height("14px")
                          .text_color(t.dim || "#4d5870")
                          .whitespace_nowrap()
                          .child(`${m.spaceCount}sp`)
                      )
                  )
                  .child(
                    h_flex()
                      .flex_none()
                      .gap(4)
                      .items_center()
                      .when(st.connected, (cEl) =>
                        cEl.child(
                          actionChip(
                            `orrery-fl-mach-sp-${key}`,
                            "+ space",
                            m.isLocal
                              ? "Create a new Space on this computer"
                              : `Create a new Space on ${m.name}`,
                            { color: accent },
                            (_e, c) => {
                              spawnNewSpace(c, {
                                machine: m.isLocal ? "" : m.name,
                                vpW: vp.w,
                                vpH: vp.h,
                              });
                              c.notify();
                            }
                          )
                        )
                      )
                      .when(!m.isLocal && !st.connected && !st.loading, (rEl) =>
                        rEl.child(
                          actionChip(
                            `orrery-fl-mach-conn-${key}`,
                            st.needsLogin ? "login" : "connect",
                            st.needsLogin
                              ? `Run hc machine login ${m.name}`
                              : `Reconnect / inspect ${m.name}`,
                            {
                              color: st.needsLogin || st.rebuilt ? t.blocked || "#f06449" : accent,
                              border:
                                st.needsLogin || st.rebuilt
                                  ? withAlpha(t.blocked || "#f06449", "88")
                                  : undefined,
                            },
                            (_e, c) => {
                              reconnectMachine(c, m.name);
                              c.notify();
                            }
                          )
                        )
                      )
                      .when(!m.isLocal, (rmEl) =>
                        rmEl.child(
                          actionChip(
                            `orrery-fl-mach-rm-${key}`,
                            confirmingRm ? "rm?" : "×",
                            confirmingRm
                              ? `Click again to forget ${m.name} (remote terminals keep running)`
                              : `Remove ${m.name} from Herdr`,
                            confirmingRm
                              ? {
                                  bold: true,
                                  color: "#ffffff",
                                  bg: CLOSE_RED,
                                  border: CLOSE_RED,
                                  hoverBg: CLOSE_RED,
                                  hoverColor: "#ffffff",
                                }
                              : { hoverBg: CLOSE_RED, hoverColor: "#ffffff" },
                            (_e, c) => handleRemoveMachine(m.name, c)
                          )
                        )
                      )
                  );
              })
            )
            .when(!hasRemotes, (hintEl) =>
              hintEl.child(
                div()
                  .px(8)
                  .py(3)
                  .font_family(MONO)
                  .text_size(10)
                  .line_height("14px")
                  .text_color(t.dim || "#4d5870")
                  .child("No remote SSH machines added — click + add machine to connect a server.")
              )
            )
        )
        // --- SECTION 2: SPACES ---
        .child(
          v_flex()
            .w_full()
            .gap(3)
            .child(sectionHeader("SPACES", `${allSpaces.length} total`))
            .children(spaceChildren)
        )
        // --- SECTION 3: AGENTS & SUB-AGENTS ---
        .child(
          v_flex()
            .w_full()
            .gap(3)
            .child(sectionHeader("AGENTS", allAgents.length ? `${allAgents.length} active` : ""))
            .when(allAgents.length === 0, (emptyEl) =>
              emptyEl.child(
                div()
                  .py(6)
                  .px(4)
                  .font_family(MONO)
                  .text_size(11)
                  .line_height("15px")
                  .text_color(t.dim || "#4d5870")
                  .child("No agents running. Click + agent above to launch one.")
              )
            )
            .children(
              allAgents.map((ag, idx) => {
                const sc = statusColor(ag.status, t);
                const sg = ag.status === "blocked" ? "!" : "●";
                const isOpen = openAddrs.has(ag.address);
                const isFocused = foc?.terminal === ag.address;
                const elapsed = agentElapsed(ag, allSpaces, termMap);
                const loc = agentLocation(ag, allSpaces);
                const act = agentActivity(ag, termMap);
                const subs = byParent.get(ag.address) || [];
                const isActive = ag.status === "working" || ag.status === "blocked";
                const confirming =
                  view.confirmCloseAddr === ag.address &&
                  typeof view.confirmCloseUntil === "number" &&
                  Date.now() < view.confirmCloseUntil;

                return v_flex()
                  .id(`orrery-fleet-ag-grp-${ag.address || idx}`)
                  .w_full()
                  .gap(2)
                  .child(
                    h_flex()
                      .w_full()
                      .px(8)
                      .py(6)
                      .gap(8)
                      .items_center()
                      .justify_between()
                      .bg(
                        isFocused
                          ? t.raised || "#131c2e"
                          : ag.status === "blocked"
                            ? withAlpha(t.blocked || "#f06449", "14")
                            : ag.pinned
                              ? withAlpha(accent, "0D")
                              : withAlpha(t.background || "#070a12", "88")
                      )
                      .border_l_1()
                      .border_color(
                        ag.status === "blocked"
                          ? t.blocked || "#f06449"
                          : ag.pinned || isOpen
                            ? accent
                            : CLEAR
                      )
                      .hover((st) => st.bg(withAlpha(t.hover || "#172236", "BB")))
                      // Left info (click to open / raise!)
                      .child(
                        v_flex()
                          .id(`orrery-fl-ag-body-${ag.address || idx}`)
                          .flex_1()
                          .min_w(0)
                          .gap(2)
                          .cursor_pointer()
                          .on_mouse_down("left", stopProp)
                          .on_click((_e, c) => {
                            c.stop_propagation();
                            focusOrOpenTerm(ag.address, true);
                            c.notify();
                          })
                          .child(
                            h_flex()
                              .gap(7)
                              .items_center()
                              .overflow_hidden()
                              .child(
                                div()
                                  .id(`orrery-fl-g-${ag.address || idx}`)
                                  .flex_none()
                                  .font_family(MONO)
                                  .text_size(ag.status === "blocked" ? 11 : 9)
                                  .line_height("15px")
                                  .font_bold()
                                  .text_color(sc)
                                  .when(ag.status === "blocked" || ag.status === "working", (bEl) =>
                                    bEl.loop("opacity", {
                                      from: ag.status === "blocked" ? 0.3 : 0.5,
                                      to: 1.0,
                                      period: ag.status === "blocked" ? 700 : 1600,
                                    })
                                  )
                                  .child(sg)
                              )
                              .child(
                                div()
                                  .flex_none()
                                  .font_family(MONO)
                                  .text_size(11)
                                  .line_height("15px")
                                  .font_bold()
                                  .text_color(t.foreground || "#e4dfd3")
                                  .whitespace_nowrap()
                                  .child(agentName(ag))
                              )
                              .when(Boolean(ag.pinned), (pEl) =>
                                pEl.child(
                                  div()
                                    .flex_none()
                                    .font_family(MONO)
                                    .text_size(10)
                                    .line_height("14px")
                                    .font_bold()
                                    .text_color(accent)
                                    .child("★ pinned")
                                )
                              )
                              .when(Boolean(loc), (lEl) =>
                                lEl.child(
                                  div()
                                    .min_w(0)
                                    .font_family(MONO)
                                    .text_size(10)
                                    .line_height("14px")
                                    .text_color(t.muted || "#8b93a6")
                                    .truncate()
                                    .child(loc)
                                )
                              )
                              .when(Boolean(elapsed), (eEl) =>
                                eEl.child(
                                  div()
                                    .flex_none()
                                    .font_family(MONO)
                                    .text_size(10)
                                    .line_height("14px")
                                    .text_color(t.dim || "#4d5870")
                                    .whitespace_nowrap()
                                    .child(elapsed)
                                )
                              )
                          )
                          .when(Boolean(act), (aEl) =>
                            aEl.child(
                              div()
                                .min_w(0)
                                .pl(14)
                                .font_family(MONO)
                                .text_size(10)
                                .line_height("14px")
                                .text_color(t.dim || "#4d5870")
                                .truncate()
                                .child(act)
                            )
                          )
                      )
                      // Right actions
                      .child(
                        h_flex()
                          .flex_none()
                          .gap(4)
                          .items_center()
                          .child(
                            actionChip(
                              `orrery-fl-open-${ag.address || idx}`,
                              focusMode ? "focus" : isOpen ? "min" : "open",
                              focusMode
                                ? "Focus agent pane"
                                : isOpen
                                  ? "Minimize floating window"
                                  : "Open floating window",
                              {
                                color: !focusMode && isOpen ? accent : t.foreground || "#e4dfd3",
                              },
                              (_e, c) => {
                                if (focusMode) {
                                  run("agent.focus", { terminal: ag.address });
                                } else if (isOpen) {
                                  minimizeTerminalWindow(ag.address);
                                } else {
                                  focusOrOpenTerm(ag.address, true);
                                }
                                c.notify();
                              }
                            )
                          )
                          .child(
                            actionChip(
                              `orrery-fl-peek-${ag.address || idx}`,
                              "peek",
                              "Quick peek terminal",
                              {},
                              () => run("terminal.peek", { terminal: ag.address })
                            )
                          )
                          .child(
                            actionChip(
                              `orrery-fl-pin-${ag.address || idx}`,
                              ag.pinned ? "unpin" : "pin",
                              ag.pinned ? "Unpin agent" : "Pin agent to top of Fleet",
                              {
                                color: ag.pinned ? accent : t.muted || "#8b93a6",
                                border: ag.pinned ? withAlpha(accent, "88") : undefined,
                              },
                              (_e, c) => {
                                run("terminal.pin", {
                                  terminal: ag.address,
                                  pinned: !ag.pinned,
                                });
                                syncAgentOrder();
                                c.notify();
                              }
                            )
                          )
                          .child(
                            actionChip(
                              `orrery-fl-kill-${ag.address || idx}`,
                              confirming ? "×?" : "×",
                              confirming ? "Click again to kill active agent" : "Close & end agent",
                              confirming
                                ? {
                                    bold: true,
                                    color: "#ffffff",
                                    bg: CLOSE_RED,
                                    border: CLOSE_RED,
                                    hoverBg: CLOSE_RED,
                                    hoverColor: "#ffffff",
                                  }
                                : {
                                    hoverBg: CLOSE_RED,
                                    hoverColor: "#ffffff",
                                  },
                              (_e, c) => handleKill(ag.address, isActive, c)
                            )
                          )
                      )
                  )
                  // Indented Sub-Agents (with real keep / park / peek / ×!)
                  .when(subs.length > 0, (subEl) =>
                    subEl.children(subs.map((sub, sIdx) => renderSubAgentRow(sub, sIdx, "sub")))
                  );
              })
            )
            .when(orphanSubs.length > 0, (oEl) =>
              oEl.children(orphanSubs.map((sub, sIdx) => renderSubAgentRow(sub, sIdx, "osub")))
            )
        )
        // --- SECTION 4: SHELLS & TERMINALS (non-agent plain terminals!) ---
        .child(
          v_flex()
            .w_full()
            .gap(3)
            .child(
              sectionHeader(
                "SHELLS & TERMINALS",
                plainShells.length ? `${plainShells.length} running` : ""
              )
            )
            .when(plainShells.length === 0, (emptyEl) =>
              emptyEl.child(
                div()
                  .py(4)
                  .px(4)
                  .font_family(MONO)
                  .text_size(10)
                  .line_height("14px")
                  .text_color(t.dim || "#4d5870")
                  .child("No plain shell terminals running.")
              )
            )
            .children(
              plainShells.map((tm, idx) => {
                const isOpen = openAddrs.has(tm.address);
                const isFocused = foc?.terminal === tm.address;
                const rawName = tm.program?.name || tm.name || "shell";
                const shellName = rawName === "shell" ? "shell" : cleanAgentName(rawName);
                const sp = tm.space ? spaceMap.get(tm.space) || null : null;
                const spName = sp ? spaceDisplayName(sp) : "";
                const sc = statusColor(tm.status || "idle", t);

                return h_flex()
                  .id(`orrery-fl-sh-${tm.address || idx}`)
                  .w_full()
                  .px(8)
                  .py(5)
                  .gap(8)
                  .items_center()
                  .justify_between()
                  .bg(
                    isFocused
                      ? t.raised || "#131c2e"
                      : withAlpha(t.background || "#070a12", "66")
                  )
                  .border_l_1()
                  .border_color(isOpen ? accent : CLEAR)
                  .hover((st) => st.bg(withAlpha(t.hover || "#172236", "BB")))
                  .child(
                    h_flex()
                      .id(`orrery-fl-sh-body-${tm.address || idx}`)
                      .flex_1()
                      .min_w(0)
                      .gap(7)
                      .items_center()
                      .overflow_hidden()
                      .cursor_pointer()
                      .on_mouse_down("left", stopProp)
                      .on_click((_e, c) => {
                        c.stop_propagation();
                        focusOrOpenTerm(tm.address, false);
                        c.notify();
                      })
                      .child(
                        div()
                          .flex_none()
                          .font_family(MONO)
                          .text_size(8)
                          .line_height("14px")
                          .text_color(isOpen ? t.done || "#5fd4b8" : sc)
                          .child("●")
                      )
                      .child(
                        div()
                          .flex_none()
                          .font_family(MONO)
                          .text_size(11)
                          .line_height("15px")
                          .when(isFocused, (el) => el.font_bold())
                          .text_color(
                            isFocused ? t.foreground || "#e4dfd3" : t.muted || "#8b93a6"
                          )
                          .whitespace_nowrap()
                          .child(shellName)
                      )
                      .when(Boolean(spName), (sEl) =>
                        sEl.child(
                          div()
                            .min_w(0)
                            .font_family(MONO)
                            .text_size(10)
                            .line_height("14px")
                            .text_color(t.dim || "#4d5870")
                            .truncate()
                            .child(spName)
                        )
                      )
                  )
                  .child(
                    h_flex()
                      .flex_none()
                      .gap(4)
                      .items_center()
                      .child(
                        actionChip(
                          `orrery-fl-sh-open-${tm.address || idx}`,
                          focusMode ? "focus" : isOpen ? "min" : "open",
                          focusMode
                            ? "Focus terminal pane"
                            : isOpen
                              ? "Minimize terminal window"
                              : "Open terminal window",
                          { color: !focusMode && isOpen ? accent : t.foreground || "#e4dfd3" },
                          (_e, c) => {
                            if (focusMode) {
                              run("pane.focus", { terminal: tm.address });
                            } else if (isOpen) {
                              minimizeTerminalWindow(tm.address);
                            } else {
                              focusOrOpenTerm(tm.address, false);
                            }
                            c.notify();
                          }
                        )
                      )
                      .child(
                        actionChip(
                          `orrery-fl-sh-peek-${tm.address || idx}`,
                          "peek",
                          "Quick peek terminal",
                          {},
                          () => run("terminal.peek", { terminal: tm.address })
                        )
                      )
                      .child(
                        actionChip(
                          `orrery-fl-sh-kill-${tm.address || idx}`,
                          "×",
                          "Close & end terminal",
                          { hoverBg: CLOSE_RED, hoverColor: "#ffffff" },
                          (_e, c) => {
                            closeAndEndTerminal(tm.address);
                            c.notify();
                          }
                        )
                      )
                  );
              })
            )
        )
    );
}
