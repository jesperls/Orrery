// Orrery Launch Agent & Rename Agent Dialogs (`role: "launch-agent"` and `role: "rename-agent"`).
// Native GPUI `Input` + `InputState` modal dialogs (`kind: "dialog"`) for effortless
// agent callsign assignment on creation (plus optional first task) and 1-step renaming.

import { div } from "gpui-kit";
import { h_flex, Input, InputState, v_flex } from "gpui-base";
import { agents, closeOverlay, panes, props, spaces, terminals, theme, window as win } from "herdr";
import {
  agentName,
  agentProgramName,
  CLEAR,
  dispatchCosmosAction,
  getCustomAgentName,
  getLastAgentKey,
  loadKnownAgents,
  MONO,
  readAgentNames,
  setAgentCustomName,
  setLastAgentKey,
  spaceDisplayName,
  suggestCallsign,
  withAlpha,
} from "../state.js";

function stopProp(_e, cx) {
  cx.stop_propagation();
}

function collectUsedNames() {
  const used = new Set();
  for (const val of Object.values(readAgentNames())) {
    if (typeof val === "string" && val.trim()) used.add(val.trim().toLowerCase());
  }
  for (const sp of spaces() || []) {
    for (const tb of sp?.tabs || []) {
      if (tb?.named && tb.name) used.add(tb.name.trim().toLowerCase());
    }
  }
  for (const ag of agents() || []) {
    if (ag?.tab_name) used.add(String(ag.tab_name).trim().toLowerCase());
  }
  return used;
}

export function initAgentDialog(view, cx, role, pr) {
  view._dialogFocus = cx.focus_handle();

  if (role === "launch-agent") {
    const allSpaces = spaces() || [];
    const activeSpace = allSpaces.find((s) => s.active) ?? allSpaces[0] ?? null;
    view.launchMachine = typeof pr.machine === "string" && pr.machine ? pr.machine : null;
    view.launchSpaceId =
      pr.spaceId && allSpaces.some((s) => s.id === pr.spaceId)
        ? pr.spaceId
        : !view.launchMachine && activeSpace
          ? activeSpace.id
          : "";
    view.selectedAgentKey = pr.preselectKey || getLastAgentKey() || "";
    view.nameValue = typeof pr.initialName === "string" ? pr.initialName : "";
    view.taskValue = "";
    view.nameFocused = true;
    view.taskFocused = false;

    view.nameInput = InputState.new({
      placeholder: "callsign / name (blank = default)",
      value: view.nameValue,
    });
    view.taskInput = InputState.new({
      placeholder: "optional first prompt / task",
      value: "",
    });

    view.nameInput.on("change", (_e, c) => {
      view.nameValue = view.nameInput ? view.nameInput.value() : "";
      c.notify();
    });
    view.nameInput.on("focus", (_e, c) => {
      view.nameFocused = true;
      view.taskFocused = false;
      c.notify();
    });
    view.nameInput.on("blur", (_e, c) => {
      view.nameFocused = false;
      c.notify();
    });
    view.nameInput.on("submit", (_e, c) => {
      submitLaunchDialog(view, c);
    });

    view.taskInput.on("change", (_e, c) => {
      view.taskValue = view.taskInput ? view.taskInput.value() : "";
      c.notify();
    });
    view.taskInput.on("focus", (_e, c) => {
      view.taskFocused = true;
      view.nameFocused = false;
      c.notify();
    });
    view.taskInput.on("blur", (_e, c) => {
      view.taskFocused = false;
      c.notify();
    });
    view.taskInput.on("submit", (_e, c) => {
      submitLaunchDialog(view, c);
    });

    const targetSp = view.launchSpaceId
      ? allSpaces.find((s) => s.id === view.launchSpaceId) || null
      : null;
    const scanMachine = view.launchMachine ?? targetSp?.machine ?? null;
    loadKnownAgents(view, cx, scanMachine);

    try {
      view.nameInput.focus();
    } catch (_err) {
      // ignore focus race
    }
    view._trackTimer?.(
      cx.timer.after(60, () => {
        if (!view._closed) {
          try {
            view.nameInput?.focus();
          } catch (_err) {
            // ignore
          }
        }
      })
    );
    return;
  }

  if (role === "rename-agent") {
    const initial = typeof pr.currentName === "string" ? pr.currentName : "";
    view.nameValue = initial;
    view.nameFocused = true;
    view.nameInput = InputState.new({
      placeholder: "agent / terminal name (blank = reset)",
      value: initial,
    });
    if (initial.length > 0) {
      try {
        view.nameInput.set_selected_range({ start: 0, end: initial.length });
      } catch (_err) {
        // ignore selection range race
      }
    }
    view.nameInput.on("change", (_e, c) => {
      view.nameValue = view.nameInput ? view.nameInput.value() : "";
      c.notify();
    });
    view.nameInput.on("focus", (_e, c) => {
      view.nameFocused = true;
      c.notify();
    });
    view.nameInput.on("blur", (_e, c) => {
      view.nameFocused = false;
      c.notify();
    });
    view.nameInput.on("submit", (_e, c) => {
      submitRenameDialog(view, c);
    });

    try {
      view.nameInput.focus();
    } catch (_err) {
      // ignore
    }
    view._trackTimer?.(
      cx.timer.after(60, () => {
        if (!view._closed) {
          try {
            view.nameInput?.focus();
          } catch (_err) {
            // ignore
          }
        }
      })
    );
  }
}

export function releaseAgentDialog(view) {
  for (const k of ["nameInput", "taskInput", "_dialogFocus"]) {
    if (view[k]) {
      try {
        view[k].release?.();
      } catch (_err) {
        // ignore
      }
      view[k] = null;
    }
  }
}

function resolveSelectedAgent(view) {
  const pr = props() ?? {};
  const installed = (view.agentList || []).filter((p) => p && p.installed);
  if (view.selectedAgentKey === "__shell__") {
    return { key: "__shell__", name: "Shell", run: null, isShell: true };
  }
  const byKey = view.selectedAgentKey
    ? installed.find((p) => p.key === view.selectedAgentKey)
    : null;
  if (byKey) return { ...byKey, isShell: false };
  if (
    view.selectedAgentKey &&
    view.selectedAgentKey === pr.preselectKey &&
    Array.isArray(pr.preselectArgv) &&
    pr.preselectArgv.length > 0
  ) {
    return {
      key: pr.preselectKey,
      name: pr.preselectName || pr.preselectKey,
      run: pr.preselectArgv,
      isShell: false,
    };
  }
  if (installed.length > 0) return { ...installed[0], isShell: false };
  return { key: "__shell__", name: "Shell", run: null, isShell: true };
}

function closeSelf() {
  const ov = props()?.overlay;
  if (ov) {
    try {
      closeOverlay(ov);
    } catch (_err) {
      // ignore
    }
  }
}

function submitLaunchDialog(view, _cx) {
  const chosen = resolveSelectedAgent(view);
  const rawName = (view.nameInput ? view.nameInput.value() : view.nameValue || "").trim();
  const rawTask = (view.taskInput ? view.taskInput.value() : view.taskValue || "").trim();
  const customName = rawName.slice(0, 40);

  if (!chosen.isShell && chosen.key) {
    setLastAgentKey(chosen.key);
  }

  closeSelf();

  if (view.launchMachine) {
    dispatchCosmosAction({
      type: "spawn-agent-machine",
      machine: view.launchMachine,
      ...(chosen.run ? { argv: chosen.run } : {}),
      ...(customName ? { name: customName, customName } : chosen.isShell ? {} : { name: chosen.name }),
      ...(rawTask && !chosen.isShell ? { task: rawTask } : {}),
    });
    return;
  }

  dispatchCosmosAction({
    type: "spawn-terminal",
    spaceId: view.launchSpaceId || "",
    ...(chosen.run ? { argv: chosen.run } : {}),
    ...(customName ? { name: customName, customName } : chosen.isShell ? {} : { name: chosen.name }),
    ...(rawTask && !chosen.isShell ? { task: rawTask } : {}),
  });
}

function submitRenameDialog(view, cx, overrideValue = null) {
  const p = props() ?? {};
  const addr = p.addr || "";
  const tabId = p.tabId || "";
  const raw =
    overrideValue !== null
      ? String(overrideValue)
      : view.nameInput
        ? view.nameInput.value()
        : view.nameValue || "";
  const trimmed = raw.trim().slice(0, 40);

  setAgentCustomName(addr, trimmed, { tabId, cx });
  closeSelf();
}

export function renderLaunchAgentDialog(view, _cx) {
  const t = theme() ?? {};
  const accent = t.accent || "#e8a849";
  const borderCol = t.input || t.border || "#2b3b57";
  const allSpaces = spaces() || [];
  const installed = (view.agentList || []).filter((p) => p && p.installed);
  const chosen = resolveSelectedAgent(view);
  const targetSpace = view.launchSpaceId
    ? allSpaces.find((s) => s.id === view.launchSpaceId) ?? allSpaces[0] ?? null
    : allSpaces.find((s) => s.active) ?? allSpaces[0] ?? null;

  const targetLabel = view.launchMachine
    ? `ssh:${view.launchMachine}`
    : targetSpace
      ? spaceDisplayName(targetSpace)
      : "active space";

  const applySuggestion = (c) => {
    const pick = suggestCallsign(chosen.name, collectUsedNames());
    view.nameValue = pick;
    try {
      view.nameInput?.set_value(pick);
      view.nameInput?.focus();
    } catch (_err) {
      // ignore
    }
    c.notify();
  };

  const chip = (id, label, selected, onClick, opts = {}) =>
    h_flex()
      .id(id)
      .flex_none()
      .px(8)
      .py(3)
      .items_center()
      .bg(selected ? withAlpha(accent, "28") : withAlpha(t.background || "#070a12", "CC"))
      .border_1()
      .border_color(selected ? accent : withAlpha(t.border || "#1f2b40", "CC"))
      .font_family(MONO)
      .text_size(11)
      .line_height("15px")
      .when(selected, (el) => el.font_bold())
      .text_color(selected ? accent : opts.color || t.muted || "#8b93a6")
      .cursor_pointer()
      .hover((st) => st.bg(withAlpha(accent, "20")).text_color(t.foreground || "#e4dfd3"))
      .on_mouse_down("left", stopProp)
      .on_click((e, c) => {
        c.stop_propagation();
        onClick(e, c);
      })
      .child(label);

  const actionBtn = (id, label, primary, onClick) =>
    h_flex()
      .id(id)
      .flex_none()
      .px(12)
      .py(5)
      .items_center()
      .justify_center()
      .bg(primary ? withAlpha(accent, "26") : t.raised || "#131c2e")
      .border_1()
      .border_color(primary ? accent : withAlpha(t.border || "#1f2b40", "EE"))
      .font_family(MONO)
      .text_size(11)
      .line_height("15px")
      .when(primary, (el) => el.font_bold())
      .text_color(primary ? accent : t.muted || "#8b93a6")
      .cursor_pointer()
      .hover((st) =>
        st
          .bg(primary ? withAlpha(accent, "3D") : t.hover || "#172236")
          .text_color(t.foreground || "#e4dfd3")
      )
      .on_mouse_down("left", stopProp)
      .on_click((e, c) => {
        c.stop_propagation();
        onClick(e, c);
      })
      .child(label);

  let root = v_flex()
    .id("orrery-launch-agent-dialog")
    .size_full()
    .p(16)
    .gap(10)
    .bg(t.popover || "#0e1524")
    .border_1()
    .border_color(borderCol)
    .on_mouse_down("left", stopProp)
    .on_mouse_down("right", stopProp)
    .on_mouse_down("middle", stopProp)
    .on_key_down((e, c) => {
      if (e?.key === "escape" || e?.keystroke === "escape") {
        c.stop_propagation();
        closeSelf();
      } else if (e?.key === "tab" && !chosen.isShell) {
        c.stop_propagation();
        if (view.nameFocused) {
          view.taskInput?.focus?.();
        } else {
          view.nameInput?.focus?.();
        }
      }
    })
    // Header
    .child(
      h_flex()
        .w_full()
        .items_center()
        .justify_between()
        .pb(6)
        .border_b_1()
        .border_color(withAlpha(t.border || "#1f2b40", "CC"))
        .child(
          h_flex()
            .min_w(0)
            .gap(8)
            .items_center()
            .child(
              div()
                .flex_none()
                .font_family(MONO)
                .text_size(12)
                .line_height("16px")
                .font_bold()
                .text_color(accent)
                .child("LAUNCH AGENT")
            )
            .child(
              div()
                .min_w(0)
                .font_family(MONO)
                .text_size(11)
                .line_height("15px")
                .text_color(t.done || "#5fd4b8")
                .truncate()
                .child(`· ${targetLabel}`)
            )
        )
        .child(
          div()
            .flex_none()
            .font_family(MONO)
            .text_size(10)
            .line_height("14px")
            .text_color(t.dim || "#4d5870")
            .child("Esc")
        )
    )
    // Optional Space Picker (when multiple spaces exist and not pinned to a remote machine)
    .when(!view.launchMachine && allSpaces.length > 1, (el) =>
      el.child(
        v_flex()
          .w_full()
          .gap(4)
          .child(
            div()
              .font_family(MONO)
              .text_size(9)
              .line_height("12px")
              .font_bold()
              .text_color(t.dim || "#4d5870")
              .child("SPACE")
          )
          .child(
            h_flex()
              .id("orrery-la-spaces")
              .w_full()
              .gap(5)
              .overflow_x_scroll()
              .children(
                allSpaces.map((sp) =>
                  chip(
                    `orrery-la-sp-${sp.id}`,
                    spaceDisplayName(sp),
                    sp.id === (targetSpace?.id || ""),
                    (_e, c) => {
                      const prevMach = targetSpace?.machine ?? null;
                      view.launchSpaceId = sp.id;
                      if ((sp.machine ?? null) !== prevMach) {
                        loadKnownAgents(view, c, sp.machine ?? null);
                      }
                      c.notify();
                    }
                  )
                )
              )
          )
      )
    )
    // Agent Selector
    .child(
      v_flex()
        .w_full()
        .gap(5)
        .child(
          div()
            .font_family(MONO)
            .text_size(9)
            .line_height("12px")
            .font_bold()
            .text_color(t.dim || "#4d5870")
            .child("PROGRAM")
        )
        .when(Boolean(view.agentLoading), (lEl) =>
          lEl.child(
            div()
              .font_family(MONO)
              .text_size(11)
              .line_height("15px")
              .text_color(t.dim || "#4d5870")
              .child("scanning PATH for installed agents...")
          )
        )
        .when(!view.agentLoading, (okEl) =>
          okEl.child(
            h_flex()
              .w_full()
              .gap(5)
              .flex_wrap()
              .items_center()
              .children(
                installed.map((prog) =>
                  chip(
                    `orrery-la-ag-${prog.key}`,
                    prog.name,
                    !chosen.isShell && chosen.key === prog.key,
                    (_e, c) => {
                      view.selectedAgentKey = prog.key;
                      try {
                        view.nameInput?.focus();
                      } catch (_err) {
                        // ignore
                      }
                      c.notify();
                    }
                  )
                )
              )
              .child(
                chip(
                  "orrery-la-ag-shell",
                  "Shell",
                  chosen.isShell,
                  (_e, c) => {
                    view.selectedAgentKey = "__shell__";
                    try {
                      view.nameInput?.focus();
                    } catch (_err) {
                      // ignore
                    }
                    c.notify();
                  },
                  { color: t.dim || "#4d5870" }
                )
              )
          )
        )
    )
    // Callsign / Name Input
    .child(
      v_flex()
        .w_full()
        .gap(4)
        .child(
          h_flex()
            .w_full()
            .items_center()
            .justify_between()
            .child(
              div()
                .font_family(MONO)
                .text_size(9)
                .line_height("12px")
                .font_bold()
                .text_color(t.dim || "#4d5870")
                .child("NAME / CALLSIGN")
            )
            .child(
              div()
                .id("orrery-la-suggest")
                .px(5)
                .py(1)
                .font_family(MONO)
                .text_size(10)
                .line_height("13px")
                .text_color(t.done || "#5fd4b8")
                .cursor_pointer()
                .hover((st) => st.bg(t.hover || "#172236").text_color(t.foreground || "#e4dfd3"))
                .tooltip("Fill a random unused celestial callsign")
                .on_mouse_down("left", stopProp)
                .on_click((_e, c) => {
                  c.stop_propagation();
                  applySuggestion(c);
                })
                .child("↻ suggest")
            )
        )
        .when(Boolean(view.nameInput), (el) =>
          el.child(
            Input.new(view.nameInput)
              .w_full()
              .h(34)
              .px(8)
              .bg(t.background || "#070a12")
              .border_1()
              .border_color(view.nameFocused ? accent : withAlpha(t.border || "#1f2b40", "EE"))
              .font_family(MONO)
              .text_size(12)
              .text_color(t.foreground || "#e4dfd3")
          )
        )
    )
    // Optional First Task / Prompt (only for agents)
    .when(!chosen.isShell, (tEl) =>
      tEl.child(
        v_flex()
          .w_full()
          .gap(4)
          .child(
            div()
              .font_family(MONO)
              .text_size(9)
              .line_height("12px")
              .font_bold()
              .text_color(t.dim || "#4d5870")
              .child("INITIAL TASK (OPTIONAL · TAB)")
          )
          .when(Boolean(view.taskInput), (el) =>
            el.child(
              Input.new(view.taskInput)
                .w_full()
                .h(34)
                .px(8)
                .bg(t.background || "#070a12")
                .border_1()
                .border_color(view.taskFocused ? accent : withAlpha(t.border || "#1f2b40", "EE"))
                .font_family(MONO)
                .text_size(11.5)
                .text_color(t.foreground || "#e4dfd3")
            )
          )
      )
    )
    // Footer
    .child(
      h_flex()
        .w_full()
        .pt(4)
        .items_center()
        .justify_between()
        .child(
          div()
            .font_family(MONO)
            .text_size(10)
            .line_height("14px")
            .text_color(t.dim || "#4d5870")
            .child("Enter: launch")
        )
        .child(
          h_flex()
            .gap(8)
            .items_center()
            .child(actionBtn("orrery-la-cancel", "Cancel", false, () => closeSelf()))
            .child(
              actionBtn(
                "orrery-la-go",
                `Launch ${chosen.name} ↵`,
                true,
                (_e, c) => submitLaunchDialog(view, c)
              )
            )
        )
    );

  return view._dialogFocus ? root.track_focus(view._dialogFocus) : root;
}

export function renderRenameAgentDialog(view, _cx) {
  const t = theme() ?? {};
  const p = props() ?? {};
  const accent = t.accent || "#e8a849";
  const borderCol = t.input || t.border || "#2b3b57";
  const addr = p.addr || "";
  const ag = addr ? (agents() || []).find((a) => a.address === addr) || null : null;
  const tm = addr ? (terminals() || []).find((x) => x.address === addr) || null : null;
  const pn = addr ? (panes() || []).find((x) => x.terminal === addr) || null : null;
  const progLabel =
    p.programName ||
    (ag ? agentProgramName(ag) : tm?.program?.name || pn?.program?.name || "Terminal");
  const hasExistingCustom = Boolean(getCustomAgentName(addr) || (p.currentName && p.currentName !== progLabel));
  const curDisplay = ag ? agentName(ag) : p.currentName || progLabel;

  const applySuggestion = (c) => {
    const pick = suggestCallsign(progLabel, collectUsedNames());
    view.nameValue = pick;
    try {
      view.nameInput?.set_value(pick);
      view.nameInput?.focus();
    } catch (_err) {
      // ignore
    }
    c.notify();
  };

  const actionBtn = (id, label, primary, onClick) =>
    h_flex()
      .id(id)
      .flex_none()
      .px(11)
      .py(5)
      .items_center()
      .justify_center()
      .bg(primary ? withAlpha(accent, "26") : t.raised || "#131c2e")
      .border_1()
      .border_color(primary ? accent : withAlpha(t.border || "#1f2b40", "EE"))
      .font_family(MONO)
      .text_size(11)
      .line_height("15px")
      .when(primary, (el) => el.font_bold())
      .text_color(primary ? accent : t.muted || "#8b93a6")
      .cursor_pointer()
      .hover((st) =>
        st
          .bg(primary ? withAlpha(accent, "3D") : t.hover || "#172236")
          .text_color(t.foreground || "#e4dfd3")
      )
      .on_mouse_down("left", stopProp)
      .on_click((e, c) => {
        c.stop_propagation();
        onClick(e, c);
      })
      .child(label);

  let root = v_flex()
    .id("orrery-rename-agent-dialog")
    .size_full()
    .p(16)
    .gap(10)
    .bg(t.popover || "#0e1524")
    .border_1()
    .border_color(borderCol)
    .on_mouse_down("left", stopProp)
    .on_mouse_down("right", stopProp)
    .on_mouse_down("middle", stopProp)
    .on_key_down((e, c) => {
      if (e?.key === "escape" || e?.keystroke === "escape") {
        c.stop_propagation();
        closeSelf();
      }
    })
    .child(
      h_flex()
        .w_full()
        .items_center()
        .justify_between()
        .pb(6)
        .border_b_1()
        .border_color(withAlpha(t.border || "#1f2b40", "CC"))
        .child(
          h_flex()
            .min_w(0)
            .gap(8)
            .items_center()
            .child(
              div()
                .flex_none()
                .font_family(MONO)
                .text_size(12)
                .line_height("16px")
                .font_bold()
                .text_color(accent)
                .child(ag ? "RENAME AGENT" : "RENAME TERMINAL")
            )
            .child(
              div()
                .min_w(0)
                .font_family(MONO)
                .text_size(10)
                .line_height("14px")
                .text_color(t.dim || "#4d5870")
                .truncate()
                .child(`· ${progLabel}`)
            )
        )
        .child(
          div()
            .flex_none()
            .font_family(MONO)
            .text_size(10)
            .line_height("14px")
            .text_color(t.dim || "#4d5870")
            .child("Esc")
        )
    )
    .child(
      v_flex()
        .w_full()
        .gap(5)
        .child(
          h_flex()
            .w_full()
            .items_center()
            .justify_between()
            .child(
              div()
                .font_family(MONO)
                .text_size(9)
                .line_height("12px")
                .font_bold()
                .text_color(t.dim || "#4d5870")
                .child(`CALLSIGN (NOW: ${curDisplay.toUpperCase()})`)
            )
            .child(
              div()
                .id("orrery-ra-suggest")
                .px(5)
                .py(1)
                .font_family(MONO)
                .text_size(10)
                .line_height("13px")
                .text_color(t.done || "#5fd4b8")
                .cursor_pointer()
                .hover((st) => st.bg(t.hover || "#172236").text_color(t.foreground || "#e4dfd3"))
                .tooltip("Fill a random unused celestial callsign")
                .on_mouse_down("left", stopProp)
                .on_click((_e, c) => {
                  c.stop_propagation();
                  applySuggestion(c);
                })
                .child("↻ suggest")
            )
        )
        .when(Boolean(view.nameInput), (el) =>
          el.child(
            Input.new(view.nameInput)
              .w_full()
              .h(34)
              .px(8)
              .bg(t.background || "#070a12")
              .border_1()
              .border_color(view.nameFocused ? accent : withAlpha(t.border || "#1f2b40", "EE"))
              .font_family(MONO)
              .text_size(12.5)
              .text_color(t.foreground || "#e4dfd3")
          )
        )
    )
    .child(
      h_flex()
        .w_full()
        .pt(4)
        .items_center()
        .justify_between()
        .child(
          h_flex()
            .gap(6)
            .items_center()
            .when(hasExistingCustom, (rEl) =>
              rEl.child(
                actionBtn("orrery-ra-reset", "Reset", false, (_e, c) =>
                  submitRenameDialog(view, c, "")
                )
              )
            )
            .when(!hasExistingCustom, (hEl) =>
              hEl.child(
                div()
                  .font_family(MONO)
                  .text_size(10)
                  .line_height("14px")
                  .text_color(t.dim || "#4d5870")
                  .child(
                    (win()?.platform || "linux") === "macos"
                      ? "Cmd+Shift+R anytime"
                      : "Alt+R anytime"
                  )
              )
            )
        )
        .child(
          h_flex()
            .gap(8)
            .items_center()
            .child(actionBtn("orrery-ra-cancel", "Cancel", false, () => closeSelf()))
            .child(
              actionBtn("orrery-ra-save", "Save ↵", true, (_e, c) => submitRenameDialog(view, c))
            )
        )
    );

  return view._dialogFocus ? root.track_focus(view._dialogFocus) : root;
}
