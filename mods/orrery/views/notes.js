// Orrery Physical Scratchpad Note Editor (`role: "notes"`).
// Native GPUI markdown editor bound to a specific physical Note Object (`props.noteId`)
// stored in `shared("orrery.notesList")`. Opens directly into clean Markdown editing right
// beneath its Windows-style titlebar, with a quiet 24px bottom status strip (`lines · chars · clear · delete`).

import { div } from "gpui-kit";
import { Editor, h_flex, v_flex } from "gpui-base";
import { props, theme } from "herdr";
import {
  deleteNoteObject,
  getNoteById,
  MONO,
  readNotes,
  updateNoteText,
  withAlpha,
  writeNotes,
} from "../state.js";

const CLOSE_RED = "#c43e2b";

function stopProp(_e, cx) {
  cx.stop_propagation();
}

export function renderNotes(view, _cx) {
  const t = theme() ?? {};
  const p = props() ?? {};
  const noteId = p.noteId || view.noteId || "";
  const overlayId = p.overlay || null;

  const noteRec = noteId ? getNoteById(noteId) : null;
  if (noteId && !noteRec) {
    return v_flex()
      .id(`orrery-notes-missing-${noteId}`)
      .size_full()
      .bg(t.background || "#070a12")
      .on_mouse_down("left", stopProp)
      .on_mouse_down("right", stopProp)
      .on_mouse_down("middle", stopProp);
  }

  const storedText = noteId ? noteRec?.text || "" : readNotes();
  const text = view.editorState ? view.editorState.value() : storedText;
  const lines = text ? text.split("\n").length : 0;
  const chars = text.length;

  let editorWrap = div()
    .id(`orrery-notes-editor-wrap-${noteId || "legacy"}`)
    .flex_1()
    .min_h(0)
    .w_full()
    .bg(t.background || "#070a12")
    .on_mouse_down("left", stopProp)
    .on_mouse_down("right", stopProp)
    .on_mouse_down("middle", stopProp)
    .when(Boolean(view.editorState), (edEl) =>
      edEl.child(Editor.new(view.editorState).size_full())
    );

  if (view.notesFocus) {
    editorWrap = editorWrap.track_focus(view.notesFocus);
  }

  return v_flex()
    .id(`orrery-notes-app-${noteId || "legacy"}`)
    .size_full()
    .bg(t.background || "#070a12")
    .on_mouse_down("left", stopProp)
    .on_mouse_down("right", stopProp)
    .on_mouse_down("middle", stopProp)
    // Native Markdown Editor body right beneath the titlebar
    .child(editorWrap)
    // Super-slim, quiet 24px bottom status strip
    .child(
      h_flex()
        .id(`orrery-notes-status-${noteId || "legacy"}`)
        .flex_none()
        .w_full()
        .h(24)
        .px(10)
        .gap(8)
        .items_center()
        .justify_between()
        .bg(t.surface || "#0b101c")
        .border_t_1()
        .border_color(withAlpha(t.border || "#1f2b40", "CC"))
        .child(
          div()
            .min_w(0)
            .font_family(MONO)
            .text_size(10)
            .line_height("14px")
            .text_color(t.dim || "#4d5870")
            .truncate()
            .child(
              chars > 0
                ? `${lines} line${lines === 1 ? "" : "s"} · ${chars} chars`
                : "empty · first line becomes title"
            )
        )
        .child(
          h_flex()
            .flex_none()
            .gap(4)
            .items_center()
            .when(chars > 0, (el) =>
              el.child(
                div()
                  .id(`orrery-notes-clear-${noteId || "legacy"}`)
                  .px(6)
                  .py(1)
                  .font_family(MONO)
                  .text_size(10)
                  .line_height("14px")
                  .text_color(t.dim || "#4d5870")
                  .cursor_pointer()
                  .hover((st) => st.bg(t.hover || "#172236").text_color(t.accent || "#e8a849"))
                  .tooltip("Clear note text")
                  .on_mouse_down("left", stopProp)
                  .on_click((_e, c) => {
                    c.stop_propagation();
                    if (view._noteSaveTimer) {
                      try {
                        view._noteSaveTimer.cancel();
                      } catch (_err) {
                        // ignore
                      }
                      view._noteSaveTimer = null;
                    }
                    if (view.editorState) {
                      view.editorState.set_value("");
                    }
                    if (noteId) {
                      updateNoteText(noteId, "");
                    } else {
                      writeNotes("");
                    }
                    c.notify();
                  })
                  .child("clear")
              )
            )
            .when(Boolean(noteId), (el) =>
              el.child(
                div()
                  .id(`orrery-notes-delete-${noteId}`)
                  .px(6)
                  .py(1)
                  .font_family(MONO)
                  .text_size(10)
                  .line_height("14px")
                  .text_color(t.dim || "#4d5870")
                  .cursor_pointer()
                  .hover((st) => st.bg(CLOSE_RED).text_color("#ffffff"))
                  .tooltip("Delete note from space")
                  .on_mouse_down("left", stopProp)
                  .on_click((_e, c) => {
                    c.stop_propagation();
                    view._noteDeleted = true;
                    if (view._noteSaveTimer) {
                      try {
                        view._noteSaveTimer.cancel();
                      } catch (_err) {
                        // ignore
                      }
                      view._noteSaveTimer = null;
                    }
                    deleteNoteObject(noteId, overlayId);
                  })
                  .child("delete")
              )
            )
        )
    );
}
