// Orrery Windows-Lookalike Floating Terminal Titlebar (`role: "winbar"`, 30px).
// World-synced titlebar:
//   - Left drag     : World-synced 60fps move via `resizer` (`mode: "move"`) — zero coordinate desync!
//   - Double-click  : Maximize full-screen Focus Mode (Alt+O)
//   - Ctrl/Cmd+Scroll : Scale THIS terminal window smoothly (`55%..160%`); click scale pill to reset 100%
//   - Right-click   : Window menu (Minimize, Pin, Reset Size, Snap, Maximize, Close)
//   - Right buttons : ─ (minimize) · □ (maximize) · × (close; 3s ×? confirm on active agents)

import { div } from "gpui-kit";
import { h_flex, Input, InputState } from "gpui-base";
import { agents, focused, openOverlay, panes, props, run, spaces, terminals, theme, window as win } from "herdr";
import {
  agentProgramName,
  closeAndEndTerminal,
  enterFocusMode,
  getCustomAgentName,
  getViewportDims,
  getWindowDimensions,
  getWindowScale,
  minimizeTerminalWindow,
  MONO,
  openContextPopup,
  readGitInfo,
  resetWindowScale,
  scaleWindowByFactor,
  setAgentCustomName,
  statusColor,
  statusGlyph,
  terminalDisplayName,
  withAlpha,
} from "../state.js";

const CLOSE_RED = "#c43e2b";
const FRAME_INSET = 6; // 1px border + 5px edge strip
const DRAG_THRESHOLD = 4;

function stopProp(_e, cx) {
  cx.stop_propagation();
}

export function renderWinbar(view, _cx) {
  const t = theme() ?? {};
  const p = props() ?? {};
  const addr = p.terminal || "";
  const overlayId = p.overlay || null;

  const allAgents = agents() || [];
  const allTerms = terminals() || [];
  const allSpaces = spaces() || [];
  const allPanes = panes() || [];
  const foc = focused();
  const isFocused = Boolean(addr && foc?.terminal === addr);

  const ag = allAgents.find((a) => a.address === addr) ?? null;
  const term = allTerms.find((x) => x.address === addr) ?? null;
  const paneInfo = allPanes.find((x) => x.terminal === addr) ?? null;
  const spId = ag?.space || term?.space || null;
  const sp = (spId ? allSpaces.find((s) => s.id === spId) : allSpaces.find((s) => s.active)) ?? null;
  const gi = readGitInfo();

  const status = ag?.status || term?.status || paneInfo?.status || "idle";
  const sc = statusColor(status, t);
  const sg = statusGlyph(status);
  const isActiveAgent = Boolean(ag) && (status === "working" || status === "blocked");

  const label = terminalDisplayName(addr, { ag, term, pane: paneInfo, allSpaces });
  const progLabel = ag ? agentProgramName(ag) : "";
  const showProgTag = Boolean(progLabel && label.toLowerCase() !== progLabel.toLowerCase());
  const isEditingName = Boolean(view.editingInlineName && view.inlineNameInput);

  const finishInlineRename = (save, c) => {
    if (!view.editingInlineName) return;
    const inp = view.inlineNameInput;
    const nextVal = save && inp ? inp.value() : null;
    view._inlineClosing = true;
    view.editingInlineName = false;
    view.inlineNameInput = null;
    if (inp) {
      try {
        inp.release?.();
      } catch (_err) {
        // ignore
      }
    }
    view._inlineClosing = false;
    if (save && addr) {
      setAgentCustomName(addr, nextVal ?? "", { cx: c });
    }
    if (addr) {
      run("pane.focus", { terminal: addr });
    }
    c?.notify?.();
  };

  const startInlineRename = (c) => {
    if (!addr) return;
    view._pendingMove = null;
    view.lastTitleClickMs = 0;
    if (view.inlineNameInput) {
      try {
        view.inlineNameInput.release?.();
      } catch (_err) {
        // ignore
      }
      view.inlineNameInput = null;
    }
    const existing = getCustomAgentName(addr) || (showProgTag ? label : "");
    const inp = InputState.new({
      placeholder: progLabel || "name",
      value: existing,
    });
    if (existing.length > 0) {
      try {
        inp.set_selected_range({ start: 0, end: existing.length });
      } catch (_err) {
        // ignore
      }
    }
    inp.on("submit", (_ev, evCx) => {
      finishInlineRename(true, evCx);
    });
    inp.on("blur", (_ev, evCx) => {
      if (
        !view._inlineClosing &&
        view.editingInlineName &&
        Date.now() - (view._inlineStartedAt || 0) > 160
      ) {
        finishInlineRename(true, evCx);
      }
    });
    view._inlineStartedAt = Date.now();
    view.inlineNameInput = inp;
    view.editingInlineName = true;
    try {
      inp.focus();
    } catch (_err) {
      // ignore
    }
    if (c?.timer?.after) {
      view._trackTimer?.(
        c.timer.after(24, () => {
          if (!view._closed && view.editingInlineName && view.inlineNameInput === inp) {
            try {
              inp.focus();
            } catch (_err) {
              // ignore
            }
          }
        })
      );
    }
    c?.notify?.();
  };

  const spaceName = sp ? (sp.machine ? `${sp.machine}:${sp.name || "space"}` : sp.name || "space") : "";
  const branch =
    paneInfo?.branch ||
    (gi.spaceId && sp?.id === gi.spaceId && gi.branch) ||
    sp?.branch ||
    "";

  const scale = getWindowScale("terminal", addr);
  const scalePct = Math.round(scale * 100);
  const showScaleBadge = Math.abs(scalePct - 100) >= 3;

  const confirmingClose =
    view.confirmCloseAddr === addr &&
    typeof view.confirmCloseUntil === "number" &&
    Date.now() < view.confirmCloseUntil;

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
        scaleWindowByFactor("terminal", addr, factor, { overlayId });
      });
    } else {
      const factor = view._pendingScaleFactor || 1.0;
      view._pendingScaleFactor = 1.0;
      scaleWindowByFactor("terminal", addr, factor, { overlayId });
    }
  };

  const winCtrl = (idKey, glyph, tip, opts, onClick) =>
    h_flex()
      .id(`orrery-wb-${idKey}-${addr || "t"}`)
      .flex_none()
      .w(opts.width || 34)
      .h_full()
      .items_center()
      .justify_center()
      .when(Boolean(opts.bg), (el) => el.bg(opts.bg))
      .font_family(MONO)
      .text_size(opts.size || 12)
      .line_height("15px")
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
      .on_mouse_down("right", stopProp)
      .on_mouse_down("middle", stopProp)
      .on_click((e, c) => {
        c.stop_propagation();
        onClick(e, c);
      })
      .child(glyph);

  return h_flex()
    .id(`orrery-winbar-${addr || "term"}`)
    .size_full()
    .pl(10)
    .pr(0)
    .gap(8)
    .items_center()
    .justify_between()
    .bg(isFocused ? t.chrome || "#090d17" : withAlpha(t.surface || "#0b101c", "E8"))
    .border_t_1()
    .border_b_1()
    .border_color(
      status === "blocked"
        ? withAlpha(t.blocked || "#f06449", "CC")
        : isFocused
          ? withAlpha(t.accent || "#e8a849", "77")
          : withAlpha(t.border || "#1f2b40", "CC")
    )
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
    // Left: world-synced drag handle; double-click maximizes; right-click opens window menu
    .child(
      h_flex()
        .id(`orrery-wb-title-${addr || "t"}`)
        .flex_1()
        .min_w(0)
        .h_full()
        .gap(6)
        .items_center()
        .overflow_hidden()
        .cursor_grab()
        .tooltip(`drag: move · double-click: maximize · ${modKey.toLowerCase()}+scroll: scale window · right-click: menu`)
        .on_hover((hovered) => {
          if (!hovered) view._pendingMove = null;
        })
        .on_mouse_down_out(() => {
          view._pendingMove = null;
        })
        .on_mouse_down("left", (e, c) => {
          c.stop_propagation();
          if (!addr) return;
          if (!isFocused) {
            run("pane.focus", { terminal: addr });
          }
          const now = Date.now();
          const isDbl =
            e?.click_count === 2 ||
            (typeof view.lastTitleClickMs === "number" &&
              view.lastTitleClickMs > 0 &&
              now - view.lastTitleClickMs < 350);
          if (isDbl) {
            view.lastTitleClickMs = 0;
            view._pendingMove = null;
            enterFocusMode(addr);
            return;
          }
          view.lastTitleClickMs = now;

          const mx = e?.position?.x ?? 0;
          const my = e?.position?.y ?? 0;
          const hasLocal =
            typeof e?.local_position?.x === "number" && typeof e?.local_position?.y === "number";
          const stored = getWindowDimensions("terminal", addr, 800, 600);
          const winX =
            typeof stored.rec?.x === "number"
              ? stored.rec.x
              : hasLocal
                ? Math.max(0, Math.round(mx - e.local_position.x - FRAME_INSET - 10))
                : Math.max(8, Math.round(mx - 120));
          const winY =
            typeof stored.rec?.y === "number"
              ? stored.rec.y
              : hasLocal
                ? Math.max(0, Math.round(my - e.local_position.y - FRAME_INSET))
                : Math.max(8, Math.round(my - 15));

          view._pendingMove = {
            winX,
            winY,
            startW: stored.width,
            startH: stored.height,
            startMouseX: mx,
            startMouseY: my,
            startedAt: now,
          };
        })
        .on_mouse_move((e) => {
          const pm = view._pendingMove;
          if (!pm || !e?.position || !addr) return;
          if (Date.now() - (pm.startedAt || 0) > 900) {
            view._pendingMove = null;
            return;
          }
          if (Math.hypot(e.position.x - pm.startMouseX, e.position.y - pm.startMouseY) < DRAG_THRESHOLD) {
            return;
          }
          view._pendingMove = null;
          view.lastTitleClickMs = 0;
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
              winKind: "terminal",
              targetId: addr,
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
        .on_mouse_down("right", (e, c) => {
          c.stop_propagation();
          view._pendingMove = null;
          if (!addr) return;
          const vp = getViewportDims();
          openContextPopup({
            kind: "taskbar",
            targetKind: "terminal",
            targetId: addr,
            x: e?.position?.x,
            y: e?.position?.y,
            vpW: vp.w,
            vpH: vp.h,
          });
        })
        .child(
          div()
            .id(`orrery-wb-g-${addr || "t"}`)
            .flex_none()
            .font_family(MONO)
            .text_size(11)
            .line_height("15px")
            .font_bold()
            .text_color(isFocused || status === "blocked" ? sc : withAlpha(sc, "99"))
            .when(status === "blocked" || status === "working", (bEl) =>
              bEl.loop("opacity", {
                from: status === "blocked" ? 0.3 : 0.55,
                to: 1.0,
                period: status === "blocked" ? 700 : 1600,
              })
            )
            .child(sg)
        )
        .when(Boolean(ag?.pinned), (pinEl) =>
          pinEl.child(
            div()
              .flex_none()
              .font_family(MONO)
              .text_size(10)
              .line_height("15px")
              .text_color(t.accent || "#e8a849")
              .child("★")
          )
        )
        .when(isEditingName, (edEl) =>
          edEl.child(
            div()
              .id(`orrery-wb-edit-wrap-${addr || "t"}`)
              .flex_none()
              .w(156)
              .h(20)
              .on_mouse_down("left", stopProp)
              .on_mouse_down("right", stopProp)
              .on_mouse_down("middle", stopProp)
              .on_key_down((e, c) => {
                if (e?.key === "escape" || e?.keystroke === "escape") {
                  c.stop_propagation();
                  finishInlineRename(false, c);
                }
              })
              .child(
                Input.new(view.inlineNameInput)
                  .w_full()
                  .h_full()
                  .px(5)
                  .bg(t.background || "#070a12")
                  .border_1()
                  .border_color(t.accent || "#e8a849")
                  .font_family(MONO)
                  .text_size(11)
                  .text_color(t.foreground || "#e4dfd3")
              )
          )
        )
        .when(!isEditingName, (lblEl) =>
          lblEl.child(
            div()
              .id(`orrery-wb-name-${addr || "t"}`)
              .min_w(0)
              .max_w(180)
              .px(3)
              .py(1)
              .font_family(MONO)
              .text_size(11)
              .line_height("15px")
              .when(isFocused, (fEl) => fEl.font_bold())
              .text_color(isFocused ? t.foreground || "#e4dfd3" : t.muted || "#8b93a6")
              .truncate()
              .cursor_text()
              .hover((st) =>
                st
                  .bg(withAlpha(t.accent || "#e8a849", "1C"))
                  .text_color(t.accent || "#e8a849")
              )
              .tooltip("Click to rename inline · Enter to save · Esc to cancel")
              .on_mouse_down("left", (e, c) => {
                c.stop_propagation();
                view._pendingMove = null;
                if (e?.click_count === 1) {
                  startInlineRename(c);
                }
              })
              .child(label)
          )
        )
        .when(showProgTag, (pEl) =>
          pEl.child(
            div()
              .flex_none()
              .font_family(MONO)
              .text_size(10)
              .line_height("14px")
              .text_color(t.dim || "#4d5870")
              .whitespace_nowrap()
              .child(`[${progLabel}]`)
          )
        )
        .when(Boolean(spaceName), (sEl) =>
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
                .text_color(isFocused ? t.muted || "#8b93a6" : t.dim || "#4d5870")
                .truncate()
                .child(spaceName)
            )
        )
        .when(Boolean(branch), (bEl) =>
          bEl.child(
            div()
              .flex_none()
              .max_w(140)
              .font_family(MONO)
              .text_size(11)
              .line_height("15px")
              .text_color(isFocused ? t.done || "#5fd4b8" : withAlpha(t.done || "#5fd4b8", "88"))
              .truncate()
              .child(branch)
          )
        )
    )
    // Right: clickable scale badge (when != 100%) + classic Windows ─ □ × buttons
    .child(
      h_flex()
        .flex_none()
        .h_full()
        .items_center()
        .when(showScaleBadge, (el) =>
          el.child(
            h_flex()
              .id(`orrery-wb-scale-${addr || "t"}`)
              .flex_none()
              .px(6)
              .h(20)
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
                resetWindowScale("terminal", addr, { overlayId });
              })
              .child(`${scalePct}%`)
          )
        )
        .child(
          winCtrl(
            "rename",
            "✎",
            `Rename ${ag ? "agent" : "terminal"} inline (${modKey === "Cmd" ? "Cmd+Shift+R" : "Alt+R"})`,
            { width: 28, size: 11, color: isEditingName ? t.accent || "#e8a849" : t.dim || "#4d5870", hoverColor: t.accent || "#e8a849" },
            (_e, c) => {
              if (isEditingName) {
                finishInlineRename(true, c);
              } else {
                startInlineRename(c);
              }
            }
          )
        )
        .child(
          winCtrl(
            "min",
            "─",
            "Minimize window (re-open from planetoid or ≡ menu)",
            { size: 11, color: isFocused ? t.muted || "#8b93a6" : t.dim || "#4d5870" },
            () => minimizeTerminalWindow(addr, overlayId)
          )
        )
        .child(
          winCtrl(
            "max",
            "□",
            "Maximize full-screen (Alt+O)",
            { size: 11, color: isFocused ? t.muted || "#8b93a6" : t.dim || "#4d5870" },
            () => enterFocusMode(addr)
          )
        )
        .child(
          winCtrl(
            "close",
            confirmingClose ? "×?" : "×",
            confirmingClose ? "Click again to end active agent" : "Close terminal",
            confirmingClose
              ? {
                  width: 38,
                  size: 11,
                  bold: true,
                  color: "#ffffff",
                  bg: CLOSE_RED,
                  hoverBg: CLOSE_RED,
                  hoverColor: "#ffffff",
                }
              : {
                  size: 13,
                  color: isFocused ? t.muted || "#8b93a6" : t.dim || "#4d5870",
                  hoverBg: CLOSE_RED,
                  hoverColor: "#ffffff",
                },
            (_e, c) => {
              if (isActiveAgent && !confirmingClose) {
                view.confirmCloseAddr = addr;
                view.confirmCloseUntil = Date.now() + 3000;
                if (view._confirmTimer) {
                  try {
                    view._confirmTimer.cancel();
                  } catch (_err) {
                    // Ignore finished timer
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
                  // Ignore finished timer
                }
                view._confirmTimer = null;
              }
              view.confirmCloseAddr = "";
              view.confirmCloseUntil = 0;
              closeAndEndTerminal(addr, overlayId);
            }
          )
        )
    );
}
