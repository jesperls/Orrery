// Crisp multi-color sculptural ASCII renderer for `orrery`.
// Strict GPUI invariants:
// - Never passes `"transparent"` to `.bg()` (always `"#00000000"`).
// - Always passes pixel strings (e.g. `"16px"`) to `.line_height(...)`.
// - Zero `.rounded*` anywhere.
// - Deterministic unique `.id(...)` on every animated span (`.frames` / `.loop`).

import { div } from "gpui-kit";
import { h_flex, v_flex } from "gpui-base";

export const MONO = "JetBrains Mono";
export const CLEAR = "#00000000";
export const DEFAULT_FONT_SIZE = 13;
export const DEFAULT_LINE_HEIGHT = "16px";

/**
 * Validates `#rgb`, `#rrggbb`, or `#rrggbbaa` colors; never lets `"transparent"` through.
 */
export function safeHex(val, fallback = CLEAR) {
  if (typeof val === "string") {
    const trimmed = val.trim();
    if (trimmed.length >= 4 && trimmed.charCodeAt(0) === 35 && trimmed !== "#") {
      return trimmed;
    }
  }
  return fallback;
}

/**
 * Ensures line-height is always a concrete pixel string like `"16px"`.
 */
export function normalizeLineHeight(lh, fallbackPx = 16) {
  if (typeof lh === "string") {
    const trimmed = lh.trim();
    if (/^\d+(\.\d+)?px$/.test(trimmed)) return trimmed;
    const parsed = Number.parseFloat(trimmed);
    if (Number.isFinite(parsed) && parsed > 0) return `${Math.round(parsed)}px`;
  }
  if (typeof lh === "number" && Number.isFinite(lh) && lh > 0) {
    return `${Math.round(lh)}px`;
  }
  return `${fallbackPx}px`;
}

function resolvePulse(spec) {
  if (!spec || typeof spec !== "object") return null;
  if (spec.loopOpacity && typeof spec.loopOpacity === "object") {
    return {
      from: typeof spec.loopOpacity.from === "number" ? spec.loopOpacity.from : 0.45,
      to: typeof spec.loopOpacity.to === "number" ? spec.loopOpacity.to : 1.0,
      period: Math.max(100, Math.round(Number(spec.loopOpacity.period) || 2400)),
      easing: spec.loopOpacity.easing || "ease-in-out",
    };
  }
  if (!spec.pulse) return null;

  const fallbackPeriod = Math.max(100, Math.round(Number(spec.pulsePeriod) || 2400));

  if (spec.pulse === true) {
    return { from: 0.45, to: 1.0, period: fallbackPeriod, easing: "ease-in-out" };
  }
  if (typeof spec.pulse === "number" && Number.isFinite(spec.pulse)) {
    return {
      from: 0.45,
      to: 1.0,
      period: Math.max(100, Math.round(spec.pulse)),
      easing: "ease-in-out",
    };
  }
  if (typeof spec.pulse === "object") {
    return {
      from: typeof spec.pulse.from === "number" ? spec.pulse.from : 0.45,
      to: typeof spec.pulse.to === "number" ? spec.pulse.to : 1.0,
      period: Math.max(100, Math.round(Number(spec.pulse.period ?? spec.pulsePeriod) || 2400)),
      easing: spec.pulse.easing || "ease-in-out",
    };
  }
  return null;
}

function buildSpan(spanId, spec, defaults) {
  const s = typeof spec === "string" ? { text: spec } : spec && typeof spec === "object" ? spec : {};
  const id = s.id || spanId;
  const color = safeHex(s.color, defaults.color);
  const bg = s.bg ? safeHex(s.bg, CLEAR) : defaults.spanBg;
  const fontSize = typeof s.fontSize === "number" ? s.fontSize : defaults.fontSize;
  const lineHeight = normalizeLineHeight(s.lineHeight ?? defaults.lineHeight, 16);
  const fontFamily = typeof s.fontFamily === "string" && s.fontFamily ? s.fontFamily : defaults.fontFamily;
  const bold = Boolean(s.bold ?? defaults.bold);
  const frames = Array.isArray(s.frames) && s.frames.length > 0 ? s.frames.map((f) => String(f ?? "")) : null;
  const frameMs = Math.max(16, Math.round(Number(s.framesMs ?? s.frameMs) || 480));
  const pulse = resolvePulse(s);

  let el = div()
    .id(id)
    .font_family(fontFamily)
    .text_size(fontSize)
    .line_height(lineHeight)
    .whitespace_nowrap()
    .bg(bg)
    .text_color(color);

  if (bold) {
    el = el.font_bold();
  }
  if (typeof s.opacity === "number" && Number.isFinite(s.opacity)) {
    el = el.opacity(s.opacity);
  }
  if (pulse) {
    el = el.loop("opacity", pulse);
  }

  if (frames) {
    return el.frames(frames, frameMs);
  }

  return el.child(s.text !== undefined && s.text !== null ? String(s.text) : "");
}

/**
 * Renders a multi-line sculptural ASCII composition with per-span colors,
 * per-span opaque background occlusion, native `.frames(...)` sprite cycles,
 * and native `.loop("opacity", ...)` pulsing.
 *
 * Each row in `rowsSpec` may be:
 * - a plain string
 * - an array of span objects `{ text, color, bg?, bold?, frames?, framesMs?, pulse?, pulsePeriod?, opacity?, id? }` (or strings)
 * - an object `{ spans: [...], bg?, id? }`
 * - a single span object `{ text, ... }`
 */
export function renderSculpture(id, rowsSpec, opts = {}) {
  const safeId = typeof id === "string" && id.length > 0 ? id : "orrery-sculpture";
  const rows = Array.isArray(rowsSpec) ? rowsSpec : [];

  const fontSize = typeof opts.fontSize === "number" && Number.isFinite(opts.fontSize) ? opts.fontSize : DEFAULT_FONT_SIZE;
  const lineHeight = normalizeLineHeight(opts.lineHeight ?? DEFAULT_LINE_HEIGHT, 16);
  const fontFamily = typeof opts.fontFamily === "string" && opts.fontFamily ? opts.fontFamily : MONO;
  const defaultColor = safeHex(opts.color, "#e4dfd3");
  const containerBg = opts.bg ? safeHex(opts.bg, CLEAR) : CLEAR;
  const defaultSpanBg = opts.spanBg ? safeHex(opts.spanBg, CLEAR) : CLEAR;
  const bold = Boolean(opts.bold);

  const defaults = {
    fontSize,
    lineHeight,
    fontFamily,
    color: defaultColor,
    spanBg: defaultSpanBg,
    bold,
  };

  const rowEls = rows.map((rowSpec, rowIdx) => {
    const rowId = `${safeId}-r${rowIdx}`;

    if (typeof rowSpec === "string") {
      return buildSpan(rowId, { text: rowSpec }, defaults);
    }

    if (Array.isArray(rowSpec)) {
      const spans = rowSpec.map((span, spanIdx) => buildSpan(`${rowId}-s${spanIdx}`, span, defaults));
      return h_flex().id(rowId).bg(CLEAR).items_center().children(spans);
    }

    if (rowSpec && typeof rowSpec === "object" && Array.isArray(rowSpec.spans)) {
      const rowBg = rowSpec.bg ? safeHex(rowSpec.bg, CLEAR) : CLEAR;
      const spans = rowSpec.spans.map((span, spanIdx) => buildSpan(`${rowId}-s${spanIdx}`, span, defaults));
      return h_flex()
        .id(rowSpec.id || rowId)
        .bg(rowBg)
        .items_center()
        .children(spans);
    }

    return buildSpan(rowId, rowSpec, defaults);
  });

  let container = v_flex().id(safeId).bg(containerBg);
  if (opts.align === "center") {
    container = container.items_center();
  } else if (opts.align === "end") {
    container = container.items_end();
  } else {
    container = container.items_start();
  }

  return container.children(rowEls);
}
