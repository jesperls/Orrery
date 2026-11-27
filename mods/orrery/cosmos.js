// Orrery — Full-Screen Living Deep-Space ASCII Cosmos Engine.
// Serene obsidian starfield, hand-crafted planetoids, and orbiting agent spacecraft.
//
// Strict GPUI invariants:
// - Always pass hex colors like `"#00000000"` (`CLEAR`) to `.bg()`.
// - Always pass pixel strings (e.g. `"16px"`) to `.line_height(...)`.
// - Square corners everywhere (no corner rounding helpers).
// - Deterministic unique `.id(...)` on every `.loop`, `.frames`, and `.spring` element.
// - NEVER put two `.loop`s on the same property, and NEVER mix `.spring`/`.transition` with `.loop` on the same node.
// - Always forward fresh `cx` in callbacks and stop left `mouse_down` propagation on every clickable target.

import { div } from "gpui-kit";
import { h_flex, v_flex } from "gpui-base";
import { CLEAR, MONO, renderSculpture, safeHex } from "./ascii.js";

const CELL_W = 7.8;
const CELL_H = 16;
const FONT_SIZE = 13;
const LINE_H = "16px";
const SMALL_FONT = 11;
const SMALL_LINE_H = "14px";
const TINY_FONT = 10;
const TINY_LINE_H = "13px";

// --- Cohesive Deep-Space Palettes ---

const DARK_PAL = {
  canvas: "#06080f",
  orbitDot: "#334769",
  orbitActive: "#7d6338",
  orbitBlocked: "#8c3a2d",
  starDust: "#223047",
  starMid: "#4a6285",
  starWarm: "#a8936a",
  starCool: "#7fa4cf",
  wisp: "#263854",
  binaryGold: "#d9a85b",
  binaryBlue: "#7fa8d8",
  pulsar: "#8db9e6",
  moonNatural: "#8a9cb8",
  // Planetoid 0: The Ringed World
  ringHi: "#f2c36b",
  ringMid: "#c98c42",
  ringDim: "#7a552a",
  bodyHi: "#84a4cc",
  bodyMid: "#4d6a91",
  bodyShade: "#2a3e5c",
  // Planetoid 1: The Little-Prince World
  treeHi: "#6ec492",
  treeMid: "#3f8761",
  trunk: "#9e7a54",
  beacon: "#ffe28a",
  rockHi: "#cca982",
  rockMid: "#8f7154",
  rockShade: "#544130",
  // Planetoid 2: The Observatory Moon
  dish: "#5fd4b8",
  brassHi: "#f2c672",
  brassMid: "#b88a44",
  lunarHi: "#cfd8e6",
  lunarMid: "#8795ab",
  lunarShade: "#4b576e",
  // Planetoid 3: The Crystal Bastion
  spire: "#ffe28a",
  crystalHi: "#7cf2d6",
  crystalMid: "#3ca892",
  facetHi: "#7f92b3",
  facetMid: "#4a5975",
  facetShade: "#273347",
  // Collar & UI
  accent: "#e8a849",
  title: "#e4dfd3",
  titleActive: "#f2be63",
  branch: "#5fd4b8",
  dirty: "#e8a849",
  tabActive: "#f2be63",
  tabInactive: "#7d889e",
  tabAdd: "#53627a",
  remote: "#82add4",
  collarBg: "#06080fe0",
  collarBorder: "#1f2b40",
  collarHover: "#131d30",
  // Agent Spacecraft
  working: "#e8a849",
  workingHi: "#ffe296",
  workingBg: "#171209e6",
  blocked: "#f06449",
  blockedHi: "#ff9b87",
  blockedBg: "#26100ce8",
  done: "#5fd4b8",
  doneHi: "#94f2db",
  doneBg: "#0a1f1be6",
  idle: "#8b96ab",
  idleHi: "#c2cbdb",
  idleBg: "#0c121fe0",
  openTag: "#5fd4b8",
  subProbe: "#8fb7d9",
  muted: "#8b93a6",
  dim: "#4d5870",
  // Cosmic-Horror Anomalies (deep obsidian, muted violet-indigo, eerie crimson-ember, cold eldritch teal)
  voidShadow: "#1b162e",
  voidTendril: "#251e3b",
  voidTendrilHi: "#392e59",
  voidDeep: "#27213e",
  voidRim: "#493d70",
  voidBone: "#9e98ab",
  voidEmber: "#9c3540",
  voidEmberHi: "#c74a54",
  voidEmberGlow: "#e07b5c",
  voidDread: "#b83a44",
  voidDreadHi: "#e8545c",
  voidTeal: "#2d6e6c",
  voidTealHi: "#4ea39e",
  voidObeliskHi: "#6d6687",
  voidObeliskMid: "#3e3759",
  // Multi-Machine Star-System Relay Markers
  machineConnected: "#5fd4b8",
  machineLoading: "#e8a849",
  machineLogin: "#f06449",
  machineOffline: "#4d5870",
  machineBg: "#080d18e6",
};

// --- Utilities ---

function withAlpha(hex, aa) {
  const s = safeHex(hex, "");
  if (s.length < 7) return CLEAR;
  return `${s.slice(0, 7)}${aa}`;
}

function resolvePalette(theme) {
  const base = DARK_PAL;
  if (!theme || typeof theme !== "object") return base;
  return {
    ...base,
    canvas: safeHex(theme.canvas, base.canvas),
    accent: safeHex(theme.accent, base.accent),
    working: safeHex(theme.working || theme.accent, base.working),
    blocked: safeHex(theme.blocked, base.blocked),
    done: safeHex(theme.done, base.done),
    collarBg: withAlpha(safeHex(theme.canvas, base.canvas), "E4"),
    collarBorder: safeHex(theme.border, base.collarBorder),
  };
}

function hashString(str) {
  const s = String(str || "world");
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return Math.abs(h >>> 0);
}

function sanitizeId(str) {
  const raw = String(str || "x");
  const clean = raw.replace(/[^a-zA-Z0-9_-]/g, "_");
  if (clean === raw && clean.length <= 32) return clean;
  return `${clean.slice(0, 24)}_${hashString(raw).toString(36)}`;
}

function cleanCallsign(ag) {
  if (!ag) return "Agent";
  const raw = ag.program?.name || ag.app || ag.title || "Agent";
  const text = String(raw).trim();
  if (!text) return "Agent";
  return text.length > 18 ? `${text.slice(0, 17)}~` : text;
}

function cleanSpaceName(sp) {
  if (!sp) return "space";
  const raw = sp.name || (sp.folder ? String(sp.folder).split("/").filter(Boolean).pop() : "") || "space";
  const text = String(raw).trim() || "space";
  return text.length > 22 ? `${text.slice(0, 21)}~` : text;
}

function cleanTabChipLabel(tb, tIdx) {
  if (tb && tb.named && typeof tb.name === "string") {
    const trimmed = tb.name.trim();
    if (trimmed) {
      return trimmed.length > 10 ? `${trimmed.slice(0, 9)}~` : trimmed;
    }
  }
  return String(tb?.index ?? tIdx + 1);
}

const TAB_STATUS_RANK = { blocked: 0, working: 1, done: 2 };

function resolveTabAgentStatus(tb, spAgents) {
  let best = "";
  let bestRank = 99;
  const consider = (st) => {
    if (st && Object.prototype.hasOwnProperty.call(TAB_STATUS_RANK, st)) {
      const r = TAB_STATUS_RANK[st];
      if (r < bestRank) {
        bestRank = r;
        best = st;
      }
    }
  };
  if (tb && tb.status) consider(tb.status);
  if (tb && tb.id && Array.isArray(spAgents)) {
    for (const ag of spAgents) {
      if (ag && ag.tab === tb.id) {
        consider(ag.status);
      }
    }
  }
  return best;
}

function tabStatusDotColor(status, pal) {
  if (status === "blocked") return pal.blocked;
  if (status === "working") return pal.working;
  if (status === "done") return pal.done;
  return "";
}

function lookupGitForSpace(gitBySpace, sp) {
  if (!sp || !sp.id) return { branch: sp?.branch || "", dirtyCount: 0, commitSha: "", commitSubject: "" };
  let raw = null;
  if (gitBySpace instanceof Map) {
    raw = gitBySpace.has(sp.id) ? gitBySpace.get(sp.id) : null;
  } else if (gitBySpace && typeof gitBySpace === "object" && Object.prototype.hasOwnProperty.call(gitBySpace, sp.id)) {
    raw = gitBySpace[sp.id];
  }
  return {
    branch: (raw && typeof raw.branch === "string" && raw.branch) || sp.branch || "",
    dirtyCount: raw && typeof raw.dirtyCount === "number" && Number.isFinite(raw.dirtyCount) ? raw.dirtyCount : 0,
    commitSha: (raw && typeof raw.commitSha === "string" && raw.commitSha) || "",
    commitSubject: (raw && typeof raw.commitSubject === "string" && raw.commitSubject) || "",
  };
}

function isAddressOpen(openWindowAddrs, addr) {
  if (!addr || !openWindowAddrs) return false;
  if (typeof openWindowAddrs.has === "function") return openWindowAddrs.has(addr);
  if (Array.isArray(openWindowAddrs)) return openWindowAddrs.includes(addr);
  return false;
}

function formatElapsedCompact(ag) {
  if (!ag) return "";
  if (typeof ag.elapsed === "string" && ag.elapsed.trim()) return ag.elapsed.trim();
  const since =
    (ag.status === "working" && ag.working_since) ||
    ag.changed_at ||
    ag.started_at ||
    0;
  if (typeof since !== "number" || !Number.isFinite(since) || since <= 0) return "";
  const sec = Math.max(0, Math.floor((Date.now() - since) / 1000));
  if (sec < 60) return `${sec}s`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h`;
  return `${Math.floor(hr / 24)}d`;
}

// --- Organic Multi-Depth Deep-Space Starfield & Wordless Distant Clusters ---

// 58 organically distributed stars across 3 visual tiers spanning an expanded
// sky field (`-600..vpW+600`, `-450..vpH+450`) so panning never hits an empty edge:
//   - "dust" : distant fine dust (`.` / `'`)
//   - "mid"  : cool starlight (`·` / `+`)
//   - "warm" / "cool" : subtle hero stars (`*`) twinkling softly on varied async periods
// 8 scattered "wrong" stars carry a long-cycle `glitch` spec (`.frames`) that stays
// calm ~88% of the time before briefly flickering into `×`, crimson/violet `*`, or
// vanishing `" "` — keeping the sky uncluttered yet subtly alive and uncanny.
const STAR_CATALOG = [
  // Core viewport distant fine dust (15)
  { fx: 0.03, fy: 0.11, ch: ".", tier: "dust" },
  { fx: 0.08, fy: 0.27, ch: "'", tier: "dust" },
  { fx: 0.14, fy: 0.07, ch: ".", tier: "dust", glitch: { kind: "vanish", ms: 470, len: 19, at: [14] } },
  { fx: 0.21, fy: 0.18, ch: "'", tier: "dust" },
  { fx: 0.29, fy: 0.06, ch: ".", tier: "dust" },
  { fx: 0.37, fy: 0.21, ch: "'", tier: "dust" },
  { fx: 0.45, fy: 0.11, ch: ".", tier: "dust", glitch: { kind: "cross", ms: 530, len: 21, at: [17] } },
  { fx: 0.56, fy: 0.09, ch: "'", tier: "dust" },
  { fx: 0.64, fy: 0.19, ch: ".", tier: "dust" },
  { fx: 0.89, fy: 0.11, ch: ".", tier: "dust" },
  { fx: 0.96, fy: 0.25, ch: "'", tier: "dust" },
  { fx: 0.05, fy: 0.48, ch: ".", tier: "dust" },
  { fx: 0.49, fy: 0.52, ch: ".", tier: "dust", glitch: { kind: "vanish", ms: 610, len: 17, at: [11, 12] } },
  { fx: 0.92, fy: 0.54, ch: ".", tier: "dust" },
  { fx: 0.41, fy: 0.87, ch: ".", tier: "dust" },
  // Core viewport mid-stars (11)
  { fx: 0.06, fy: 0.06, ch: "·", tier: "mid" },
  { fx: 0.18, fy: 0.13, ch: "+", tier: "mid", period: 5200, lo: 0.36, hi: 0.84 },
  { fx: 0.31, fy: 0.26, ch: "·", tier: "mid", glitch: { kind: "cross", ms: 430, len: 23, at: [19] } },
  { fx: 0.48, fy: 0.07, ch: "+", tier: "mid", period: 4600, lo: 0.34, hi: 0.82 },
  { fx: 0.61, fy: 0.16, ch: "·", tier: "mid" },
  { fx: 0.93, fy: 0.34, ch: "·", tier: "mid", glitch: { kind: "ember", ms: 590, len: 19, at: [15] } },
  { fx: 0.11, fy: 0.39, ch: "+", tier: "mid", period: 6100, lo: 0.32, hi: 0.78 },
  { fx: 0.58, fy: 0.61, ch: "+", tier: "mid", period: 4950, lo: 0.36, hi: 0.82 },
  { fx: 0.78, fy: 0.59, ch: "·", tier: "mid" },
  { fx: 0.27, fy: 0.83, ch: "+", tier: "mid", period: 5400, lo: 0.34, hi: 0.80 },
  { fx: 0.16, fy: 0.62, ch: "·", tier: "mid", glitch: { kind: "vanish", ms: 510, len: 21, at: [16] } },
  // Core viewport subtle hero stars (10)
  { fx: 0.09, fy: 0.19, ch: "*", tier: "cool", period: 3700, lo: 0.32, hi: 0.92 },
  { fx: 0.25, fy: 0.09, ch: "*", tier: "warm", period: 3150, lo: 0.30, hi: 0.90 },
  { fx: 0.42, fy: 0.16, ch: "*", tier: "cool", period: 4350, lo: 0.28, hi: 0.88 },
  { fx: 0.68, fy: 0.08, ch: "*", tier: "warm", glitch: { kind: "ember", ms: 460, len: 23, at: [18, 19] } },
  { fx: 0.91, fy: 0.23, ch: "*", tier: "cool", period: 4100, lo: 0.30, hi: 0.90 },
  { fx: 0.04, fy: 0.64, ch: "*", tier: "warm", period: 4700, lo: 0.28, hi: 0.86 },
  { fx: 0.38, fy: 0.67, ch: "*", tier: "cool", period: 3550, lo: 0.32, hi: 0.90 },
  { fx: 0.72, fy: 0.57, ch: "*", tier: "warm", period: 2950, lo: 0.34, hi: 0.92 },
  { fx: 0.19, fy: 0.89, ch: "*", tier: "cool", period: 4450, lo: 0.28, hi: 0.88 },
  { fx: 0.51, fy: 0.28, ch: "*", tier: "warm", glitch: { kind: "cross", ms: 640, len: 17, at: [13] } },
  // Expanded outer deep-sky margins (`-600..vpW+600`, `-450..vpH+450`) (22)
  // Far-west sky (panning left)
  { fx: 0, ox: -540, fy: 0.18, ch: ".", tier: "dust" },
  { fx: 0, ox: -440, fy: 0.56, ch: "+", tier: "mid", period: 5600, lo: 0.32, hi: 0.80 },
  { fx: 0, ox: -360, fy: 0.12, ch: "*", tier: "cool", period: 4050, lo: 0.30, hi: 0.88 },
  { fx: 0, ox: -290, fy: 0.82, ch: "'", tier: "dust" },
  { fx: 0, ox: -180, fy: 0.64, ch: "·", tier: "mid" },
  { fx: 0, ox: -120, fy: 0.24, ch: "*", tier: "warm", period: 3650, lo: 0.30, hi: 0.88 },
  // Far-east sky (panning right)
  { fx: 1, ox: 120, fy: 0.14, ch: "·", tier: "mid" },
  { fx: 1, ox: 210, fy: 0.42, ch: "*", tier: "warm", period: 3900, lo: 0.30, hi: 0.90 },
  { fx: 1, ox: 330, fy: 0.19, ch: ".", tier: "dust" },
  { fx: 1, ox: 420, fy: 0.68, ch: "+", tier: "mid", period: 5100, lo: 0.34, hi: 0.82 },
  { fx: 1, ox: 520, fy: 0.31, ch: "*", tier: "cool", period: 4500, lo: 0.28, hi: 0.88 },
  { fx: 1, ox: 270, fy: 0.86, ch: "'", tier: "dust" },
  // Far-north sky (panning up)
  { fx: 0.15, fy: 0, oy: -380, ch: ".", tier: "dust" },
  { fx: 0.34, fy: 0, oy: -250, ch: "*", tier: "cool", period: 4150, lo: 0.30, hi: 0.88 },
  { fx: 0.62, fy: 0, oy: -320, ch: "+", tier: "mid", period: 5300, lo: 0.34, hi: 0.80 },
  { fx: 0.84, fy: 0, oy: -180, ch: "'", tier: "dust" },
  { fx: 1, ox: 240, fy: 0, oy: -240, ch: "*", tier: "warm", period: 3750, lo: 0.30, hi: 0.88 },
  // Far-south sky (panning down)
  { fx: 0.14, fy: 1, oy: 190, ch: "·", tier: "mid" },
  { fx: 0.44, fy: 1, oy: 290, ch: "*", tier: "warm", period: 3500, lo: 0.30, hi: 0.90 },
  { fx: 0.76, fy: 1, oy: 220, ch: ".", tier: "dust" },
  { fx: 0, ox: -260, fy: 1, oy: 260, ch: "+", tier: "mid", period: 5900, lo: 0.32, hi: 0.78 },
  { fx: 1, ox: 290, fy: 1, oy: 310, ch: "*", tier: "cool", period: 4300, lo: 0.28, hi: 0.86 },
];

// 4 wordless, pure-punctuation distant star-clusters / miniature spiral wisps.
const DISTANT_WISPS = [
  {
    id: "wisp-nw",
    fx: 0.06,
    fy: 0.10,
    ox: 0,
    oy: 0,
    period: 7400,
    rows: ["  . · '", " ·  *  .", "  ' · ."],
  },
  {
    id: "wisp-ne",
    fx: 0.56,
    fy: 0.08,
    ox: 0,
    oy: 0,
    period: 8900,
    rows: ["   .  '", "· . * . ·", "   '  ."],
  },
  {
    id: "wisp-se",
    fx: 0.52,
    fy: 0.84,
    ox: 0,
    oy: 0,
    period: 8100,
    rows: [" '  .  ·", ".  ·  '", "  ·  ."],
  },
  {
    id: "wisp-west",
    fx: 0,
    fy: 0.68,
    ox: -230,
    oy: 0,
    period: 9400,
    rows: ["  ·  . '", " .  *  ·", "' .  ·  "],
  },
];

// --- Layer 0 (Unified World Space): Organic Deep-Space Starfield & Unstable "Wrong" Stars ---

function buildWrongStarFrames(ch, glitch) {
  const len = glitch.len || 19;
  const hitSet = new Set(Array.isArray(glitch.at) ? glitch.at : [len - 3]);
  const arr = [];
  for (let i = 0; i < len; i++) {
    if (!hitSet.has(i)) {
      arr.push(ch);
    } else if (glitch.kind === "vanish") {
      arr.push(" ");
    } else if (glitch.kind === "ember") {
      arr.push(i % 2 === 0 ? "×" : "*");
    } else {
      arr.push("×");
    }
  }
  return arr;
}

function hashTileInt(a, b, c) {
  let h = (a * 374761393 + b * 668265263 + c * 2147483647) | 0;
  h = ((h ^ (h >>> 13)) * 1274126177) | 0;
  return (h ^ (h >>> 16)) >>> 0;
}

function renderDeepSpaceBackdrop(vpW, vpH, pal, fgX = 0, fgY = 0, z = 1.0, entropy = {}) {
  const els = [];
  const hasBlocked = Boolean(entropy?.hasBlocked);
  const fTiny = Math.max(3, TINY_FONT * z);
  const lhTiny = `${Math.max(4, 11 * z).toFixed(2)}px`;
  const fSmall = Math.max(3, SMALL_FONT * z);
  const lhSmall = `${Math.max(4, 13 * z).toFixed(2)}px`;

  // Wordless pure-ASCII distant star-clusters & miniature spiral wisps (world-space locked)
  for (let wIdx = 0; wIdx < DISTANT_WISPS.length; wIdx++) {
    const wisp = DISTANT_WISPS[wIdx];
    const wx = vpW * wisp.fx + (wisp.ox || 0);
    const wy = vpH * wisp.fy + (wisp.oy || 0);
    const sx = wx * z + fgX;
    const sy = wy * z + fgY;
    if (sx < -120 || sx > vpW + 120 || sy < -80 || sy > vpH + 80) continue;
    const art = renderSculpture(`orrery-${wisp.id}-art`, wisp.rows, {
      fontSize: fTiny,
      lineHeight: lhTiny,
      color: pal.wisp,
    });
    els.push(
      div()
        .id(`orrery-${wisp.id}`)
        .absolute()
        .left(sx)
        .top(sy)
        .bg(CLEAR)
        .loop("opacity", { from: 0.44, to: 0.84, period: wisp.period, easing: "ease-in-out" })
        .child(art)
    );
  }

  // Multi-depth starfield in unified world coordinates (100% coherent with zoom & pan)
  const tierColor = (tier) => {
    if (tier === "warm") return pal.starWarm;
    if (tier === "cool") return pal.starCool;
    if (tier === "mid") return pal.starMid;
    return pal.starDust;
  };

  for (let i = 0; i < STAR_CATALOG.length; i++) {
    const st = STAR_CATALOG[i];
    const wx = vpW * st.fx + (st.ox || 0);
    const wy = vpH * st.fy + (st.oy || 0);
    const x = wx * z + fgX;
    const y = wy * z + fgY;
    if (x < -20 || x > vpW + 20 || y < -20 || y > vpH + 20) continue;
    const isHero = st.tier === "warm" || st.tier === "cool";
    const isDust = st.tier === "dust";
    const starF = isHero ? fSmall : isDust ? fTiny : fSmall;
    const starLH = isHero ? lhSmall : isDust ? lhTiny : lhSmall;

    if (st.glitch) {
      const glitchColor =
        st.glitch.kind === "ember"
          ? hasBlocked
            ? pal.voidDreadHi
            : pal.voidEmberHi
          : st.glitch.kind === "cross"
            ? hasBlocked
              ? pal.voidDread
              : pal.voidRim
            : tierColor(st.tier);
      const glitchMs = hasBlocked ? Math.max(240, Math.round(st.glitch.ms * 0.78)) : st.glitch.ms;
      const frames = buildWrongStarFrames(st.ch, st.glitch);
      els.push(
        div()
          .id(`orrery-star-${i}`)
          .absolute()
          .left(x)
          .top(y)
          .font_family(MONO)
          .text_size(starF)
          .line_height(starLH)
          .text_color(glitchColor)
          .bg(CLEAR)
          .whitespace_nowrap()
          .frames(frames, glitchMs)
      );
      continue;
    }

    let node = div()
      .id(`orrery-star-${i}`)
      .absolute()
      .left(x)
      .top(y)
      .font_family(MONO)
      .text_size(starF)
      .line_height(starLH)
      .text_color(tierColor(st.tier))
      .bg(CLEAR);

    if (st.period) {
      node = node.loop("opacity", {
        from: st.lo,
        to: st.hi,
        period: st.period,
        easing: "ease-in-out",
      });
    }

    els.push(node.child(st.ch));
  }

  // Multi-LOD tiled outer-space starfield covering the entire cosmic world evenly at every zoom
  // (no top-row cap starvation, zero empty black regions even at 30% zoom far from home!)
  if (z < 0.99 || Math.abs(fgX) > 120 || Math.abs(fgY) > 120) {
    const invZ = 1 / Math.max(0.25, z);
    const wLeft = -fgX * invZ;
    const wTop = -fgY * invZ;
    const wRight = (vpW - fgX) * invZ;
    const wBottom = (vpH - fgY) * invZ;
    const outerGlyphs = [".", "·", "'", "+", "*"];
    const outerTiers = ["dust", "mid", "mid", "cool", "warm"];
    const emitTileStars = (tileSize, perTile, lodTag, minGlyphIdx = 0) => {
      const tx0 = Math.floor(wLeft / tileSize);
      const tx1 = Math.floor(wRight / tileSize);
      const ty0 = Math.floor(wTop / tileSize);
      const ty1 = Math.floor(wBottom / tileSize);
      for (let ty = ty0; ty <= ty1; ty++) {
        for (let tx = tx0; tx <= tx1; tx++) {
          for (let k = 0; k < perTile; k++) {
            const h1 = hashTileInt(tx * 17 + lodTag, ty * 31 + lodTag, k * 7 + 1);
            const h2 = hashTileInt(tx * 23 + lodTag, ty * 19 + lodTag, k * 7 + 2);
            const wx = tx * tileSize + (h1 % tileSize);
            const wy = ty * tileSize + (h2 % tileSize);
            // Skip home region already populated by handcrafted STAR_CATALOG
            if (wx >= -180 && wx <= vpW + 180 && wy >= -160 && wy <= vpH + 160) continue;
            const sx = wx * z + fgX;
            const sy = wy * z + fgY;
            if (sx < -16 || sx > vpW + 16 || sy < -16 || sy > vpH + 16) continue;
            const gi = minGlyphIdx + ((h1 >>> 8) % (outerGlyphs.length - minGlyphIdx));
            const tier = outerTiers[gi];
            const isDust = tier === "dust";
            els.push(
              div()
                .id(`orrery-ostar-${lodTag}-${tx}-${ty}-${k}`)
                .absolute()
                .left(sx)
                .top(sy)
                .font_family(MONO)
                .text_size(isDust ? fTiny : fSmall)
                .line_height(isDust ? lhTiny : lhSmall)
                .text_color(tierColor(tier))
                .bg(CLEAR)
                .child(outerGlyphs[gi])
            );
          }
        }
      }
    };

    // LOD 0: Always visible across 100% of viewport even at 30% zoom (~90–140 evenly spread stars)
    emitTileStars(720, 2, 1, 1);
    // LOD 1: Additional fine dust & mid stars when zoomed closer (`z >= 0.52`)
    if (z >= 0.52) {
      emitTileStars(380, 1, 2, 0);
    }

    // Distant procedural star-clusters across outer 1600x1600 cosmic sectors so deep exploration feels rich
    const WISP_TILE = 1600;
    const wispPatterns = [
      ["  . · '", " ·  *  .", "  ' · ."],
      ["   .  '", "· . * . ·", "   '  ."],
      [" '  .  ·", ".  ·  '", "  ·  ."],
    ];
    const wtx0 = Math.floor(wLeft / WISP_TILE);
    const wtx1 = Math.floor(wRight / WISP_TILE);
    const wty0 = Math.floor(wTop / WISP_TILE);
    const wty1 = Math.floor(wBottom / WISP_TILE);
    for (let ty = wty0; ty <= wty1; ty++) {
      for (let tx = wtx0; tx <= wtx1; tx++) {
        const h1 = hashTileInt(tx * 41 + 7, ty * 53 + 11, 9);
        const h2 = hashTileInt(tx * 29 + 3, ty * 47 + 13, 17);
        const wx = tx * WISP_TILE + 180 + (h1 % (WISP_TILE - 360));
        const wy = ty * WISP_TILE + 180 + (h2 % (WISP_TILE - 360));
        if (wx >= -220 && wx <= vpW + 220 && wy >= -200 && wy <= vpH + 200) continue;
        const sx = wx * z + fgX;
        const sy = wy * z + fgY;
        if (sx < -120 || sx > vpW + 120 || sy < -80 || sy > vpH + 80) continue;
        const rows = wispPatterns[h1 % wispPatterns.length];
        const art = renderSculpture(`orrery-owisp-${tx}-${ty}-art`, rows, {
          fontSize: fTiny,
          lineHeight: lhTiny,
          color: pal.wisp,
        });
        els.push(
          div()
            .id(`orrery-owisp-${tx}-${ty}`)
            .absolute()
            .left(sx)
            .top(sy)
            .bg(CLEAR)
            .opacity(0.64)
            .child(art)
        );
      }
    }
  }

  return els;
}

// --- Layer 1 (Unified World Space): Deep-Space Phenomena & Cosmic-Horror Anomalies ---

function renderBinaryStarPair(vpW, vpH, pal, fgX = 0, fgY = 0, z = 1.0) {
  const cx = vpW * 0.54 * z + fgX;
  const cy = vpH * 0.11 * z + fgY;
  if (cx < -80 || cx > vpW + 80 || cy < -60 || cy > vpH + 60) return [];
  const fSmall = Math.max(3.5, SMALL_FONT * z);
  const lhSmall = `${Math.max(4.5, 13 * z).toFixed(2)}px`;
  const now = Date.now();
  const rx = 22 * z;
  const ry = 9 * z;
  const gx = Math.cos((now / 9600) * Math.PI * 2) * rx;
  const gy = Math.sin((now / 6700) * Math.PI * 2) * ry;

  return [
    div()
      .id("orrery-binary-gold")
      .absolute()
      .left(cx + gx)
      .top(cy + gy)
      .font_family(MONO)
      .text_size(fSmall)
      .line_height(lhSmall)
      .font_bold()
      .text_color(pal.binaryGold)
      .bg(CLEAR)
      .child("*"),
    div()
      .id("orrery-binary-blue")
      .absolute()
      .left(cx - gx)
      .top(cy - gy)
      .font_family(MONO)
      .text_size(fSmall)
      .line_height(lhSmall)
      .text_color(pal.binaryBlue)
      .bg(CLEAR)
      .child("o"),
  ];
}

function renderPulsarBeacon(vpW, vpH, pal, fgX = 0, fgY = 0, z = 1.0) {
  const px = vpW * 0.48 * z + fgX;
  const py = vpH * 0.82 * z + fgY;
  if (px < -80 || px > vpW + 80 || py < -60 || py > vpH + 60) return null;
  const fSmall = Math.max(3.5, SMALL_FONT * z);
  const lhSmall = `${Math.max(4.5, 13 * z).toFixed(2)}px`;

  const glyph = div()
    .id("orrery-pulsar-glyph")
    .font_family(MONO)
    .text_size(fSmall)
    .line_height(lhSmall)
    .text_color(pal.pulsar)
    .bg(CLEAR)
    .whitespace_nowrap()
    .frames(["  ·  ", "  +  ", " -+- ", "  +  ", "  ·  ", "  ·  "], 420);

  return div()
    .id("orrery-pulsar-beacon")
    .absolute()
    .left(px)
    .top(py)
    .bg(CLEAR)
    .loop("opacity", { from: 0.25, to: 0.85, period: 2520, easing: "ease-in-out" })
    .child(glyph);
}

// Anomaly 1: The Wandering Singularity (Unified World-Space Gravitational Churn — ZERO text!)
function renderBlackHole(vpW, vpH, pal, fgX = 0, fgY = 0, z = 1.0, entropy = {}, singularity = null) {
  const bg = pal.canvas;
  const hasBlocked = Boolean(entropy?.hasBlocked);
  const isWorking = Boolean(entropy?.isWorking);
  const cols = 29;
  const rowCount = 11;
  const bhFont = Math.max(3.5, 12 * z);
  const bhLHNum = Math.max(4.5, 15 * z);
  const bhLH = `${bhLHNum.toFixed(2)}px`;
  const bhW = cols * 7.2 * z;
  const bhH = rowCount * bhLHNum;
  const curX = singularity ? (singularity.curX ?? singularity.fromX ?? vpW * 0.76) : vpW * 0.76;
  const curY = singularity ? (singularity.curY ?? singularity.fromY ?? vpH * 0.22) : vpH * 0.22;
  const sx = curX * z + fgX;
  const sy = curY * z + fgY;
  const bhCull = Math.max(bhW, bhH) + 120 * z;
  if (sx < -bhCull || sx > vpW + bhCull || sy < -bhCull || sy > vpH + bhCull) return [];

  // Coprime frame cadences so inner photon ring & outer warped lensing never sync
  const innerMs = hasBlocked ? 170 : isWorking ? 220 : 240;
  const outerMs = hasBlocked ? 430 : 570;

  const emberOuter = hasBlocked ? pal.voidDread : pal.voidEmber;
  const emberMid = hasBlocked ? pal.voidDreadHi : pal.voidEmberHi;
  const emberCore = hasBlocked ? pal.voidDreadHi : pal.voidEmberGlow;
  const outerArcColor = hasBlocked ? pal.voidEmber : pal.voidRim;

  const rows = [
    [
      { text: "        ", color: pal.voidDeep },
      {
        id: "orrery-bh-outer-top",
        frames: [
          "  . - ~ - .  ",
          " . - ~ = - . ",
          "· . - ~ - . ·",
          "  ' · - · '  ",
          " . ~ - = - . ",
          "  . - = ~ .  ",
          " · - ~ - · . ",
        ],
        framesMs: outerMs,
        color: outerArcColor,
      },
      { text: "        ", color: pal.voidDeep },
    ],
    [
      { text: "     ", color: pal.voidDeep },
      { text: ".-'  ", color: pal.voidRim },
      {
        id: "orrery-bh-inner-top",
        frames: [
          ".-~===~-.",
          ".-=~~~=-.",
          ".~=====-.",
          ".-~~~==~.",
          ".=~---~=.",
        ],
        framesMs: innerMs,
        color: emberOuter,
        bg,
      },
      { text: "  '-.", color: pal.voidRim },
      { text: "     ", color: pal.voidDeep },
    ],
    [
      { text: "   ", color: pal.voidDeep },
      { text: ".'  ", color: pal.voidRim },
      {
        id: "orrery-bh-inner-tl",
        frames: ["/~", "/=", "/*", "/-", "/'"],
        framesMs: innerMs,
        color: emberMid,
        bg,
      },
      { text: "           ", color: pal.voidShadow, bg },
      {
        id: "orrery-bh-inner-tr",
        frames: ["-\\", "*\\", "=\\", "~\\", "'\\"],
        framesMs: innerMs,
        color: emberMid,
        bg,
      },
      { text: "  '.", color: pal.voidRim },
      { text: "   ", color: pal.voidDeep },
    ],
    [
      { text: " ", color: pal.voidDeep },
      {
        id: "orrery-bh-outer-ml",
        frames: [".~-~-", "-~-~=", "~-~=-", "=~-~.", "-.~-~", "~=-~-", ".~=~-"],
        framesMs: outerMs,
        color: outerArcColor,
      },
      {
        id: "orrery-bh-inner-ml",
        frames: ["=|", "~|", "*|", "-|", "#|"],
        framesMs: innerMs,
        color: emberMid,
        bg,
      },
      { text: "             ", color: pal.voidShadow, bg },
      {
        id: "orrery-bh-inner-mr",
        frames: ["|-", "|#", "|=", "|*", "|~"],
        framesMs: innerMs,
        color: emberMid,
        bg,
      },
      {
        id: "orrery-bh-outer-mr",
        frames: ["-~-~.", "=-~-~", "-=~-~", ".~-~=", "~-~.-", "-~-=~", "-~=~."],
        framesMs: outerMs,
        color: outerArcColor,
      },
      { text: " ", color: pal.voidDeep },
    ],
    [
      {
        id: "orrery-bh-disk-ul",
        frames: ["~=~==-", "-=~==~", "=~===-", "-~===~", "==~=-~", "~-==~=", "-==~=~"],
        framesMs: outerMs,
        color: pal.voidRim,
      },
      {
        id: "orrery-bh-photon-ul",
        frames: ["((", "(|", "(*", "(=", "(("],
        framesMs: innerMs,
        color: emberCore,
        bg,
        bold: true,
      },
      { text: "             ", color: pal.voidShadow, bg },
      {
        id: "orrery-bh-photon-ur",
        frames: ["))", "|)", "*)", "=)", "))"],
        framesMs: innerMs,
        color: emberCore,
        bg,
        bold: true,
      },
      {
        id: "orrery-bh-disk-ur",
        frames: ["-==~=~", "~==~=-", "-===~=", "~===~-", "~-=~==", "=~==-~", "~=~==-"],
        framesMs: outerMs,
        color: pal.voidRim,
      },
    ],
    [
      {
        id: "orrery-bh-eq-l",
        frames: ["~=~===-", "=~===~-", "-~=====", "==~==~-", "-=~===~"],
        framesMs: innerMs,
        color: hasBlocked ? pal.voidDreadHi : pal.voidBone,
        bold: true,
      },
      { text: "(", color: emberCore, bg, bold: true },
      { text: "             ", color: pal.voidShadow, bg },
      { text: ")", color: emberCore, bg, bold: true },
      {
        id: "orrery-bh-eq-r",
        frames: ["-===~=~", "-~===~=", "=====~-", "-~==~==", "~===~=-"],
        framesMs: innerMs,
        color: hasBlocked ? pal.voidDreadHi : pal.voidBone,
        bold: true,
      },
    ],
    [
      {
        id: "orrery-bh-disk-ll",
        frames: ["-~===~", "=~===-", "-=~==~", "~=~==-", "-==~=~", "~-==~=", "==~=-~"],
        framesMs: outerMs,
        color: pal.voidRim,
      },
      {
        id: "orrery-bh-photon-ll",
        frames: ["(|", "((", "(=", "((", "(*"],
        framesMs: innerMs,
        color: emberCore,
        bg,
        bold: true,
      },
      { text: "             ", color: pal.voidShadow, bg },
      {
        id: "orrery-bh-photon-lr",
        frames: ["|)", "))", "=)", "))", "*)"],
        framesMs: innerMs,
        color: emberCore,
        bg,
        bold: true,
      },
      {
        id: "orrery-bh-disk-lr",
        frames: ["~===~-", "-===~=", "~==~=-", "-==~=~", "~=~==-", "=~==-~", "~-=~=="],
        framesMs: outerMs,
        color: pal.voidRim,
      },
    ],
    [
      { text: " ", color: pal.voidDeep },
      {
        id: "orrery-bh-outer-ll",
        frames: ["'~-~-", "-~-~'", "~-~='", "=~-~'", "-'~-~", "~=-~-", "'~=~-"],
        framesMs: outerMs,
        color: outerArcColor,
      },
      {
        id: "orrery-bh-inner-ll",
        frames: ["~|", "*|", "=|", "#|", "-|"],
        framesMs: innerMs,
        color: emberMid,
        bg,
      },
      { text: "             ", color: pal.voidShadow, bg },
      {
        id: "orrery-bh-inner-lr",
        frames: ["|=", "|~", "|*", "|-", "|#"],
        framesMs: innerMs,
        color: emberMid,
        bg,
      },
      {
        id: "orrery-bh-outer-lr",
        frames: ["-~-~'", "'-~-~", "'=~-~", "'~-~=", "~-~'-", "-~-=~", "-~=~'"],
        framesMs: outerMs,
        color: outerArcColor,
      },
      { text: " ", color: pal.voidDeep },
    ],
    [
      { text: "   ", color: pal.voidDeep },
      { text: "'.  ", color: pal.voidRim },
      {
        id: "orrery-bh-inner-bl",
        frames: ["\\.", "\\-", "\\*", "\\=", "\\~"],
        framesMs: innerMs,
        color: emberMid,
        bg,
      },
      { text: "           ", color: pal.voidShadow, bg },
      {
        id: "orrery-bh-inner-br",
        frames: ["./", "~/ ", "=/", "*/", "-/"].map((s) => s.slice(0, 2)),
        framesMs: innerMs,
        color: emberMid,
        bg,
      },
      { text: "  .'", color: pal.voidRim },
      { text: "   ", color: pal.voidDeep },
    ],
    [
      { text: "     ", color: pal.voidDeep },
      { text: "'-.  ", color: pal.voidRim },
      {
        id: "orrery-bh-inner-bot",
        frames: [
          "'-~===~-'",
          "'-=~~~=-'",
          "'~=====-'",
          "'-~~~==~'",
          "'=~---~='",
        ],
        framesMs: innerMs,
        color: emberOuter,
        bg,
      },
      { text: "  .-'", color: pal.voidRim },
      { text: "     ", color: pal.voidDeep },
    ],
    [
      { text: "        ", color: pal.voidDeep },
      {
        id: "orrery-bh-outer-bot",
        frames: [
          "  ' - ~ - '  ",
          " ' - ~ = - ' ",
          "· ' - ~ - ' ·",
          "  . · - · .  ",
          " ' ~ - = - ' ",
          "  ' - = ~ '  ",
          " · - ~ - · ' ",
        ],
        framesMs: outerMs,
        color: outerArcColor,
      },
      { text: "        ", color: pal.voidDeep },
    ],
  ];

  const sculpture = renderSculpture("orrery-anomaly-bh-art", rows, {
    fontSize: bhFont,
    lineHeight: bhLH,
    color: pal.voidRim,
  });

  const bhBody = div()
    .id("orrery-anomaly-bh-body")
    .absolute()
    .left(-bhW / 2)
    .top(-bhH / 2)
    .bg(CLEAR)
    .loop("opacity", {
      from: hasBlocked ? 0.80 : 0.72,
      to: 0.99,
      period: hasBlocked ? 4700 : 7900,
      easing: "ease-in-out",
    })
    .child(sculpture);

  // 4 trapped matter wisps traveling in unified world scale with the wandering Singularity
  const wispSpecs = [
    { ch: "·", color: emberCore, rx: 64, ry: 22, dirX: 1, dirY: -1, pX: 2310, pY: 1730, pOp: 1370 },
    { ch: "*", color: pal.voidBone, rx: 50, ry: 36, dirX: -1, dirY: 1, pX: 2890, pY: 2110, pOp: 1690 },
    { ch: "'", color: pal.voidRim, rx: 82, ry: 17, dirX: 1, dirY: 1, pX: 3410, pY: 1490, pOp: 1930 },
    { ch: "+", color: emberMid, rx: 42, ry: 30, dirX: -1, dirY: -1, pX: 1970, pY: 2630, pOp: 1180 },
  ];

  const now = Date.now();
  const wispFont = Math.max(3.5, SMALL_FONT * z);
  const wispLH = `${Math.max(4.5, 13 * z).toFixed(2)}px`;
  const groupChildren = [bhBody];
  for (let i = 0; i < wispSpecs.length; i++) {
    const w = wispSpecs[i];
    const speedScale = hasBlocked ? 0.78 : 1.0;
    const wxOff = Math.sin((now / (w.pX * speedScale)) * Math.PI * 2) * w.rx * w.dirX * z;
    const wyOff = Math.cos((now / (w.pY * speedScale)) * Math.PI * 2) * w.ry * w.dirY * z;

    groupChildren.push(
      div()
        .id(`orrery-bh-wisp-${i}-anchor`)
        .absolute()
        .left(wxOff - 4 * z)
        .top(wyOff - 7 * z)
        .font_family(MONO)
        .text_size(wispFont)
        .line_height(wispLH)
        .text_color(w.color)
        .bg(CLEAR)
        .loop("opacity", {
          from: 0.12,
          to: 0.94,
          period: Math.round(w.pOp * speedScale),
          easing: "ease-in-out",
        })
        .child(w.ch)
    );
  }

  return [
    div()
      .id("orrery-anomaly-bh-anchor")
      .absolute()
      .left(sx)
      .top(sy)
      .bg(CLEAR)
      .children(groupChildren),
  ];
}

// --- Dynamic Event-Driven Cosmic-Horror Anomalies (100% Unified World Space!) ---
// Positions `(curX, curY)` are smoothly interpolated in pure world space by `director.js`
// (zero GPUI `left`/`top` transitions!) so zooming shrinks/grows every horror rigidly with the world.

function wrapDynamicMotion(ev, child, { fgX = 0, fgY = 0, z = 1.0 } = {}) {
  const isSpawn = ev.phase === "spawn";
  const isExit = ev.phase === "exit";
  const opTarget = isSpawn || isExit ? 0 : ev.peakOpacity ?? 0.9;
  const opDur = isExit ? ev.fadeOutMs || 900 : ev.fadeInMs || 600;
  const opEasing = isExit ? "ease-in" : "ease-out";
  const wx = typeof ev.curX === "number" ? ev.curX : ev.x || 0;
  const wy = typeof ev.curY === "number" ? ev.curY : ev.y || 0;

  const opWrap = div()
    .id(`orrery-ev-${ev.id}-op`)
    .relative()
    .opacity(opTarget)
    .transition("opacity", { duration: opDur, easing: opEasing })
    .bg(CLEAR)
    .child(child);

  return div()
    .id(`orrery-ev-${ev.id}-anchor`)
    .absolute()
    .left(wx * z + fgX)
    .top(wy * z + fgY)
    .bg(CLEAR)
    .child(opWrap);
}

// Dynamic Event: Stalking Void Eye (unified world-space scale & drift)
function renderDynamicVoidEye(ev, pal, fgX, fgY, z, entropy) {
  const hasBlocked = Boolean(entropy?.hasBlocked);
  const isExit = ev.phase === "exit";
  const isSpawn = ev.phase === "spawn";
  const frameMs = hasBlocked ? 360 : 490;
  const irisColor = hasBlocked ? pal.voidDreadHi : pal.voidEmberHi;
  const rimColor = hasBlocked ? pal.voidEmber : pal.voidRim;
  const pfx = `orrery-ev-${ev.id}`;
  const eyeFont = Math.max(3.5, 12 * z);
  const eyeLH = `${Math.max(4.5, 15 * z).toFixed(2)}px`;

  // Variant 1: Lean, eerie horizontal Slit Watcher (`<--- ( ◎ ) --->`)
  if (ev.variant === 1) {
    const slitStates = isExit
      ? ["slit", "closed", "closed"]
      : isSpawn
        ? ["closed", "slit"]
        : ["slit", "open", "left", "left", "open", "right", "right", "dilate", "dilate", "stare", "slit", "open"];
    const mapS = (tbl) => slitStates.map((s) => tbl[s] ?? tbl.open);
    const rows = [
      [
        {
          id: `${pfx}-s0`,
          frames: mapS({
            closed: "               ",
            slit: "    .-----.    ",
            open: "   .-------.   ",
            left: "   .-------.   ",
            right: "   .-------.   ",
            dilate: "  .---------.  ",
            stare: "   .-------.   ",
          }),
          framesMs: frameMs,
          color: pal.voidDeep,
        },
      ],
      [
        {
          id: `${pfx}-s1-l`,
          frames: mapS({
            closed: " .---",
            slit: " <-- ",
            open: " <--(",
            left: " <--(",
            right: " <--(",
            dilate: " <-( ",
            stare: " <--(",
          }),
          framesMs: frameMs,
          color: rimColor,
          bg: pal.canvas,
        },
        {
          id: `${pfx}-s1-c`,
          frames: mapS({
            closed: "-----",
            slit: " --- ",
            open: "  *  ",
            left: " *   ",
            right: "   * ",
            dilate: "  ◎  ",
            stare: "  ●  ",
          }),
          framesMs: frameMs,
          color: irisColor,
          bg: pal.canvas,
          bold: true,
        },
        {
          id: `${pfx}-s1-r`,
          frames: mapS({
            closed: "---. ",
            slit: " --> ",
            open: ")--> ",
            left: ")--> ",
            right: ")--> ",
            dilate: " )-> ",
            stare: ")--> ",
          }),
          framesMs: frameMs,
          color: rimColor,
          bg: pal.canvas,
        },
      ],
      [
        {
          id: `${pfx}-s2`,
          frames: mapS({
            closed: "               ",
            slit: "    '-----'    ",
            open: "   '-------'   ",
            left: "   '-------'   ",
            right: "   '-------'   ",
            dilate: "  '---------'  ",
            stare: "   '-------'   ",
          }),
          framesMs: frameMs,
          color: pal.voidDeep,
        },
      ],
    ];
    const art = renderSculpture(`${pfx}-art`, rows, {
      fontSize: eyeFont,
      lineHeight: eyeLH,
      color: rimColor,
    });
    return wrapDynamicMotion(ev, art, { fgX, fgY, z });
  }

  // Variant 0: Full 7-row Stalking Void Eye — opens, darts iris, dilates, snaps shut on exit
  const STATES = isExit
    ? ["half", "slit", "closed", "closed"]
    : isSpawn
      ? ["closed", "slit"]
      : [
          "slit",
          "half",
          "center",
          "left",
          "left",
          "center",
          "right",
          "right",
          "wide",
          "stare",
          "stare",
          "half",
          "slit",
          "wide",
          "center",
        ];
  const mapFrames = (table) => STATES.map((st) => table[st] ?? table.center);
  const blank19 = "                   ";

  const rows = [
    [
      {
        id: `${pfx}-r0`,
        frames: mapFrames({
          center: "      .-----.      ",
          left: "      .-----.      ",
          right: "      .-----.      ",
          stare: "      .-----.      ",
          wide: "     .-------.     ",
          half: blank19,
          slit: blank19,
          closed: blank19,
        }),
        framesMs: frameMs,
        color: pal.voidDeep,
      },
    ],
    [
      {
        id: `${pfx}-r1`,
        frames: mapFrames({
          center: "   .-'       '-.   ",
          left: "   .-'       '-.   ",
          right: "   .-'       '-.   ",
          stare: "   .-'       '-.   ",
          wide: "  .-'         '-.  ",
          half: "     .-------.     ",
          slit: blank19,
          closed: blank19,
        }),
        framesMs: frameMs,
        color: rimColor,
      },
    ],
    [
      {
        id: `${pfx}-r2-l`,
        frames: mapFrames({
          center: " .'    ",
          left: " .'    ",
          right: " .'    ",
          stare: " .'    ",
          wide: ".'    .",
          half: " .-'   ",
          slit: "   .---",
          closed: "       ",
        }),
        framesMs: frameMs,
        color: rimColor,
      },
      {
        id: `${pfx}-r2-m`,
        frames: mapFrames({
          center: ".---.",
          left: ".---.",
          right: ".---.",
          stare: ".---.",
          wide: "-----",
          half: ".---.",
          slit: "-----",
          closed: "     ",
        }),
        framesMs: frameMs,
        color: pal.voidBone,
        bg: pal.canvas,
      },
      {
        id: `${pfx}-r2-r`,
        frames: mapFrames({
          center: "    '. ",
          left: "    '. ",
          right: "    '. ",
          stare: "    '. ",
          wide: ".    '.",
          half: "   '-. ",
          slit: "---.   ",
          closed: "       ",
        }),
        framesMs: frameMs,
        color: rimColor,
      },
    ],
    [
      {
        id: `${pfx}-r3-l`,
        frames: mapFrames({
          center: "<    ",
          left: "<    ",
          right: "<    ",
          stare: "<    ",
          wide: "<    ",
          half: "<    ",
          slit: "<  --",
          closed: " .---",
        }),
        framesMs: frameMs,
        color: rimColor,
      },
      {
        id: `${pfx}-r3-il`,
        frames: mapFrames({
          center: " (",
          left: " (",
          right: " (",
          stare: " (",
          wide: "( ",
          half: " (",
          slit: " -",
          closed: "--",
        }),
        framesMs: frameMs,
        color: pal.voidBone,
        bg: pal.canvas,
      },
      {
        id: `${pfx}-r3-pl`,
        frames: mapFrames({
          center: " ",
          left: "*",
          right: " ",
          stare: " ",
          wide: " ",
          half: " ",
          slit: "-",
          closed: "-",
        }),
        framesMs: frameMs,
        color: irisColor,
        bg: pal.canvas,
        bold: true,
      },
      {
        id: `${pfx}-r3-pc`,
        frames: mapFrames({
          center: " * ",
          left: "   ",
          right: "   ",
          stare: " ● ",
          wide: " ◎ ",
          half: " * ",
          slit: " - ",
          closed: "---",
        }),
        framesMs: frameMs,
        color: irisColor,
        bg: pal.canvas,
        bold: true,
      },
      {
        id: `${pfx}-r3-pr`,
        frames: mapFrames({
          center: " ",
          left: " ",
          right: "*",
          stare: " ",
          wide: " ",
          half: " ",
          slit: "-",
          closed: "-",
        }),
        framesMs: frameMs,
        color: irisColor,
        bg: pal.canvas,
        bold: true,
      },
      {
        id: `${pfx}-r3-ir`,
        frames: mapFrames({
          center: ") ",
          left: ") ",
          right: ") ",
          stare: ") ",
          wide: " )",
          half: ") ",
          slit: "- ",
          closed: "--",
        }),
        framesMs: frameMs,
        color: pal.voidBone,
        bg: pal.canvas,
      },
      {
        id: `${pfx}-r3-r`,
        frames: mapFrames({
          center: "    >",
          left: "    >",
          right: "    >",
          stare: "    >",
          wide: "    >",
          half: "    >",
          slit: "--  >",
          closed: "---. ",
        }),
        framesMs: frameMs,
        color: rimColor,
      },
    ],
    [
      {
        id: `${pfx}-r4-l`,
        frames: mapFrames({
          center: " '.    ",
          left: " '.    ",
          right: " '.    ",
          stare: " '.    ",
          wide: "'.    '",
          half: " '-.   ",
          slit: "   '---",
          closed: "       ",
        }),
        framesMs: frameMs,
        color: rimColor,
      },
      {
        id: `${pfx}-r4-m`,
        frames: mapFrames({
          center: "'---'",
          left: "'---'",
          right: "'---'",
          stare: "'---'",
          wide: "-----",
          half: "'---'",
          slit: "-----",
          closed: "     ",
        }),
        framesMs: frameMs,
        color: pal.voidBone,
        bg: pal.canvas,
      },
      {
        id: `${pfx}-r4-r`,
        frames: mapFrames({
          center: "    .' ",
          left: "    .' ",
          right: "    .' ",
          stare: "    .' ",
          wide: "'    .'",
          half: "   .-' ",
          slit: "---'   ",
          closed: "       ",
        }),
        framesMs: frameMs,
        color: rimColor,
      },
    ],
    [
      {
        id: `${pfx}-r5`,
        frames: mapFrames({
          center: "   '-.       .-'   ",
          left: "   '-.       .-'   ",
          right: "   '-.       .-'   ",
          stare: "   '-.       .-'   ",
          wide: "  '-.         .-'  ",
          half: "     '-------'     ",
          slit: blank19,
          closed: blank19,
        }),
        framesMs: frameMs,
        color: rimColor,
      },
    ],
    [
      {
        id: `${pfx}-r6`,
        frames: mapFrames({
          center: "      '-----'      ",
          left: "      '-----'      ",
          right: "      '-----'      ",
          stare: "      '-----'      ",
          wide: "     '-------'     ",
          half: blank19,
          slit: blank19,
          closed: blank19,
        }),
        framesMs: frameMs,
        color: pal.voidDeep,
      },
    ],
  ];

  const sculpture = renderSculpture(`${pfx}-art`, rows, {
    fontSize: eyeFont,
    lineHeight: eyeLH,
    color: rimColor,
  });

  return wrapDynamicMotion(ev, sculpture, { fgX, fgY, z });
}

// Dynamic Event: Spacetime Tear (rips open at random spot, glitches violently, seals shut & vanishes)
function renderDynamicTear(ev, pal, fgX, fgY, z, entropy) {
  const hasBlocked = Boolean(entropy?.hasBlocked);
  const isWorking = Boolean(entropy?.isWorking);
  const bg = pal.canvas;
  const pfx = `orrery-ev-${ev.id}`;
  const isQuietPhase = ev.phase === "spawn" || ev.phase === "exit";
  const ms = hasBlocked ? 145 : 195;

  const coreColor = hasBlocked
    ? pal.voidDreadHi
    : isWorking
      ? pal.voidTealHi
      : pal.voidEmberHi;
  const edgeColor = hasBlocked ? pal.voidDread : pal.voidRim;
  const accentColor = hasBlocked ? pal.voidDreadHi : pal.voidTealHi;

  let rows;
  if (isQuietPhase) {
    // Collapsing / budding hairline crack before ripping wide or sealing shut
    rows =
      ev.variant === 1
        ? [
            [{ text: "    /  ", color: pal.voidDeep }],
            [{ text: "   :   ", color: edgeColor, bg }],
            [{ text: "  /    ", color: pal.voidDeep }],
          ]
        : [
            [{ text: "   .   ", color: pal.voidDeep }],
            [{ text: "   :   ", color: edgeColor, bg }],
            [{ text: "   '   ", color: pal.voidDeep }],
          ];
  } else if (ev.variant === 2) {
    // Variant 2: Fractured void-diamond rupture (uniform 7-char rows)
    rows = [
      [
        {
          id: `${pfx}-d0`,
          frames: ["  /^\\  ", " ░/^\\░ ", "  ///  ", " \\###/ ", "  /^\\  "],
          framesMs: ms,
          color: edgeColor,
        },
      ],
      [
        {
          id: `${pfx}-d1-l`,
          frames: [" ░▒", " / ", " ×!", " \\\\ ", " ▒/"].map((s) => s.slice(0, 3)),
          framesMs: ms,
          color: pal.voidRim,
        },
        {
          id: `${pfx}-d1-c`,
          frames: ["×", "!", "%", "#", "×"],
          framesMs: ms,
          color: coreColor,
          bg,
          bold: true,
        },
        {
          id: `${pfx}-d1-r`,
          frames: ["▒░ ", " \\ ", "!× ", "// ", "\\▒ "],
          framesMs: ms,
          color: pal.voidRim,
        },
      ],
      [
        {
          id: `${pfx}-d2-l`,
          frames: ["×!", "░▒", "#%", " :", "×!"],
          framesMs: ms,
          color: edgeColor,
        },
        {
          id: `${pfx}-d2-c`,
          frames: ["×!×", "#%#", "///", "\\\\\\", "×!×"],
          framesMs: ms,
          color: accentColor,
          bg,
          bold: true,
        },
        {
          id: `${pfx}-d2-r`,
          frames: ["!×", "▒░", "%#", ": ", "!×"],
          framesMs: ms,
          color: edgeColor,
        },
      ],
      [
        {
          id: `${pfx}-d3-l`,
          frames: [" ▒░", " \\ ", " \\\\", " //", " ░\\"],
          framesMs: ms,
          color: pal.voidRim,
        },
        {
          id: `${pfx}-d3-c`,
          frames: ["%", "!", "#", "×", "!"],
          framesMs: ms,
          color: coreColor,
          bg,
          bold: true,
        },
        {
          id: `${pfx}-d3-r`,
          frames: ["░▒ ", " / ", "// ", "\\\\ ", "/░ "],
          framesMs: ms,
          color: pal.voidRim,
        },
      ],
      [
        {
          id: `${pfx}-d4`,
          frames: ["  \\v/  ", "  #%#  ", "  \\\\\\  ", "  ///  ", "  ·:·  "],
          framesMs: ms,
          color: pal.voidDeep,
        },
      ],
    ];
  } else if (ev.variant === 1) {
    // Variant 1: Diagonal jagged reality slash
    rows = [
      [
        {
          id: `${pfx}-sl0`,
          frames: ["    /// ", "   ░▒/  ", "   \\#\\  ", "    /·  ", "   //░  "],
          framesMs: ms,
          color: edgeColor,
        },
      ],
      [
        {
          id: `${pfx}-sl1-l`,
          frames: ["  ░▒", "  \\\\", "  /·", "  ▒/", "  ×!"],
          framesMs: ms,
          color: pal.voidRim,
        },
        {
          id: `${pfx}-sl1-c`,
          frames: ["×", "!", "#", "%", "×"],
          framesMs: ms,
          color: coreColor,
          bg,
          bold: true,
        },
        {
          id: `${pfx}-sl1-r`,
          frames: ["▒░", "//", "· ", "░ ", "!×"],
          framesMs: ms,
          color: pal.voidDeep,
        },
      ],
      [
        {
          id: `${pfx}-sl2-l`,
          frames: [" ×!", " #%", " ░▒", " / ", " !×"],
          framesMs: ms,
          color: edgeColor,
        },
        {
          id: `${pfx}-sl2-c`,
          frames: ["!", "×", "#", "!", "%"],
          framesMs: ms,
          color: accentColor,
          bg,
          bold: true,
        },
        {
          id: `${pfx}-sl2-r`,
          frames: ["!× ", "\\\\ ", "▒░ ", "\\  ", "×! "],
          framesMs: ms,
          color: edgeColor,
        },
      ],
      [
        {
          id: `${pfx}-sl3`,
          frames: [" #%#   ", " ///   ", " \\▒    ", " :\\    ", " ░//   "],
          framesMs: ms,
          color: pal.voidDeep,
        },
      ],
    ];
  } else {
    // Variant 0: Jagged vertical void fissure
    rows = [
      [
        {
          id: `${pfx}-vf0`,
          frames: ["  \\|\\  ", "  ░|░  ", "  /|\\  ", "  #|#  ", "   |   "],
          framesMs: ms,
          color: edgeColor,
        },
      ],
      [
        {
          id: `${pfx}-vf1-l`,
          frames: [" ░▒", " \\|", " ×!", " / ", " ▒|"],
          framesMs: ms,
          color: pal.voidRim,
        },
        {
          id: `${pfx}-vf1-c`,
          frames: ["×", "!", "%", "#", "|"],
          framesMs: ms,
          color: coreColor,
          bg,
          bold: true,
        },
        {
          id: `${pfx}-vf1-r`,
          frames: ["▒░ ", "|/ ", "!× ", " \\ ", "|░ "],
          framesMs: ms,
          color: pal.voidRim,
        },
      ],
      [
        {
          id: `${pfx}-vf2-l`,
          frames: [" ×!", " ░▒", " #%", " \\:", " ▒!"],
          framesMs: ms,
          color: edgeColor,
        },
        {
          id: `${pfx}-vf2-c`,
          frames: ["#", "×", "!", "%", "×"],
          framesMs: ms,
          color: accentColor,
          bg,
          bold: true,
        },
        {
          id: `${pfx}-vf2-r`,
          frames: ["!× ", "▒░ ", "%# ", ":/ ", "!░ "],
          framesMs: ms,
          color: edgeColor,
        },
      ],
      [
        {
          id: `${pfx}-vf3`,
          frames: ["  /|\\  ", "  \\#/  ", "  ░|▒  ", "   |\\  ", "   :   "],
          framesMs: ms,
          color: pal.voidDeep,
        },
      ],
    ];
  }

  const art = renderSculpture(`${pfx}-art`, rows, {
    fontSize: Math.max(3.5, SMALL_FONT * z),
    lineHeight: `${Math.max(4.5, 13 * z).toFixed(2)}px`,
    color: pal.voidDeep,
  });

  return wrapDynamicMotion(ev, art, { fgX, fgY, z });
}

// Dynamic Event: Creeping Abyssal Tendril (reaches in from a random edge, writhes, then retracts off-screen)
function renderDynamicTendril(ev, pal, fgX, fgY, z, entropy) {
  const hasBlocked = Boolean(entropy?.hasBlocked);
  const speedScale = hasBlocked ? 0.80 : 1.0;
  const edge = ev.variant || "left";
  const pfx = `orrery-ev-${ev.id}`;

  const horizontal = edge === "left" || edge === "right";
  const segSpecs =
    edge === "left"
      ? [
          { ox: 0, oy: 0, dir: 1, period: 2600, ms: 460, color: pal.voidTendril, rows: [["~~(  ", " ~(  ", "~~\\  ", " ~(  "], ["  )~ ", "  )\\ ", "  (~ ", "  )/ "]] },
          { ox: 26, oy: 10, dir: -1, period: 3100, ms: 520, color: pal.voidTendrilHi, rows: [[" (~~ ", " /~~ ", " (~  ", " \\~  "], ["  \\~ ", "  )~ ", "  /~ ", "  (~ "]] },
          { ox: 54, oy: 20, dir: 1, period: 3500, ms: 580, color: pal.voidTendril, rows: [["  (~ ", "  \\~ ", "  )~ ", "  /~ "], ["   \\.", "   ).", "   (.", "   /."]] },
          { ox: 80, oy: 28, dir: -1, period: 4100, ms: 640, color: pal.voidDeep, rows: [["   ~:", "   ~'", "   :~", "   .~"], ["    .", "    '", "    ·", "    ."]] },
        ]
      : edge === "right"
        ? [
            { ox: 0, oy: 26, dir: -1, period: 4100, ms: 640, color: pal.voidDeep, rows: [[".    ", "'    ", "·    ", ".    "], [":~   ", "'~   ", "~:   ", "~.   "]] },
            { ox: 24, oy: 18, dir: 1, period: 3500, ms: 580, color: pal.voidTendril, rows: [[" )~  ", " /~  ", " (~  ", " \\~  "], [" (~  ", " \\~  ", " )~  ", " /~  "]] },
            { ox: 50, oy: 10, dir: -1, period: 3100, ms: 520, color: pal.voidTendrilHi, rows: [["  \\~~", "  )~~", "  (~~", "  /~~"], ["   )~", "   \\~", "   (~", "   /~"]] },
            { ox: 78, oy: 0, dir: 1, period: 2600, ms: 460, color: pal.voidTendril, rows: [["  (~~", "  /~~", "  \\~~", "  (~~"], ["   ) ", "   \\ ", "   ( ", "   / "]] },
          ]
        : edge === "bottom"
          ? [
              { ox: 12, oy: 0, dir: 1, period: 3900, ms: 620, color: pal.voidDeep, rows: [["  ·  ", "  .  ", "  '  ", "  .  "], ["  :~ ", "  /~ ", "  \\~ ", "  :~ "]] },
              { ox: 6, oy: 28, dir: -1, period: 3200, ms: 520, color: pal.voidTendril, rows: [[" (~  ", " /~  ", " )~  ", " \\~  "], ["  )~ ", "  \\~ ", "  (~ ", "  /~ "]] },
              { ox: 0, oy: 56, dir: 1, period: 2700, ms: 460, color: pal.voidTendrilHi, rows: [[" (~~ ", " \\~~ ", " )~~ ", " /~~ "], ["  \\~ ", "  )~ ", "  /~ ", "  (~ "]] },
            ]
          : [
              // top edge reaching downward
              { ox: 0, oy: 0, dir: 1, period: 2700, ms: 460, color: pal.voidTendrilHi, rows: [[" (~~ ", " \\~~ ", " )~~ ", " /~~ "], ["  \\~ ", "  )~ ", "  /~ ", "  (~ "]] },
              { ox: 6, oy: 28, dir: -1, period: 3200, ms: 520, color: pal.voidTendril, rows: [[" (~  ", " /~  ", " )~  ", " \\~  "], ["  )~ ", "  \\~ ", "  (~ ", "  /~ "]] },
              { ox: 12, oy: 56, dir: 1, period: 3900, ms: 620, color: pal.voidDeep, rows: [["  :~ ", "  /~ ", "  \\~ ", "  :~ "], ["  ·  ", "  .  ", "  '  ", "  .  "]] },
            ];

  const segNodes = [];
  const tFont = Math.max(3.5, SMALL_FONT * z);
  const tLH = `${Math.max(4.5, 13 * z).toFixed(2)}px`;
  const now = Date.now();
  for (let sIdx = 0; sIdx < segSpecs.length; sIdx++) {
    const seg = segSpecs[sIdx];
    const artRows = seg.rows.map((frameList, rIdx) => [
      {
        id: `${pfx}-s${sIdx}-r${rIdx}`,
        frames: frameList,
        framesMs: Math.round(seg.ms * speedScale),
        color: seg.color,
      },
    ]);
    const art = renderSculpture(`${pfx}-s${sIdx}-art`, artRows, {
      fontSize: tFont,
      lineHeight: tLH,
      color: seg.color,
    });
    const swayAmt = Math.sin((now / (seg.period * speedScale)) * Math.PI * 2) * 5 * seg.dir * z;
    segNodes.push(
      div()
        .id(`${pfx}-s${sIdx}`)
        .absolute()
        .left(seg.ox * z + (horizontal ? 0 : swayAmt))
        .top(seg.oy * z + (horizontal ? swayAmt : 0))
        .bg(CLEAR)
        .child(art)
    );
  }

  const cluster = div().id(`${pfx}-cluster`).relative().bg(CLEAR).children(segNodes);
  return wrapDynamicMotion(ev, cluster, { fgX, fgY, z });
}

// Dynamic Event: Passing Deep-Space Wraith (strictly one-way glide across empty space, then vanishes)
function renderDynamicWraith(ev, pal, fgX, fgY, z, entropy) {
  const hasBlocked = Boolean(entropy?.hasBlocked);
  const pfx = `orrery-ev-${ev.id}`;
  const mainColor = hasBlocked ? pal.voidEmber : pal.voidRim;
  const coreColor = hasBlocked ? pal.voidDreadHi : pal.voidTealHi;

  const rows =
    ev.variant === 0
      ? [
          [{ text: "    . - .    ", color: pal.voidDeep }],
          [
            { text: "  (  ", color: mainColor },
            {
              id: `${pfx}-core`,
              frames: [" ◇ ", " ◈ ", " ◇ ", " · "],
              framesMs: 740,
              color: coreColor,
            },
            { text: "  )  ", color: mainColor },
          ],
          [{ text: "    ' - '    ", color: pal.voidDeep }],
        ]
      : [
          [
            {
              id: `${pfx}-rib0`,
              frames: ["  . ~ · ~ .  ", "  · - ~ - ·  ", "  . ~ - ~ .  "],
              framesMs: 620,
              color: mainColor,
            },
          ],
          [
            {
              id: `${pfx}-rib1`,
              frames: ["~ ·   *   · ~", "· ~   ·   ~ ·", "~ -   +   - ~"],
              framesMs: 530,
              color: pal.voidDeep,
            },
          ],
        ];

  const art = renderSculpture(`${pfx}-art`, rows, {
    fontSize: Math.max(3.5, SMALL_FONT * z),
    lineHeight: `${Math.max(4.5, 13 * z).toFixed(2)}px`,
    color: mainColor,
  });

  return wrapDynamicMotion(ev, art, { fgX, fgY, z });
}

// Dynamic Event: Spontaneous Corrupted Star Collapse (pops up in random sky pocket & vanishes)
function renderDynamicStarburst(ev, pal, fgX, fgY, z, entropy) {
  const hasBlocked = Boolean(entropy?.hasBlocked);
  const pfx = `orrery-ev-${ev.id}`;
  const color =
    ev.variant === 0
      ? hasBlocked
        ? pal.voidDreadHi
        : pal.voidEmberHi
      : ev.variant === 1
        ? pal.voidTealHi
        : pal.voidRim;

  const glyph = div()
    .id(`${pfx}-glyph`)
    .font_family(MONO)
    .text_size(Math.max(3.5, SMALL_FONT * z))
    .line_height(`${Math.max(4.5, 13 * z).toFixed(2)}px`)
    .text_color(color)
    .bg(CLEAR)
    .whitespace_nowrap()
    .frames([" · ", " + ", " × ", " ░ ", " × ", " · ", "   "], hasBlocked ? 220 : 300);

  return wrapDynamicMotion(ev, glyph, { fgX, fgY, z });
}

function renderDynamicAnomalies(events, pal, fgX = 0, fgY = 0, z = 1.0, entropy = {}, vpW = 1440, vpH = 900) {
  if (!Array.isArray(events) || events.length === 0) return [];
  const els = [];
  const pad = 320 * z + 140;
  for (const ev of events) {
    if (!ev || !ev.kind) continue;
    const wx = typeof ev.curX === "number" ? ev.curX : ev.x || 0;
    const wy = typeof ev.curY === "number" ? ev.curY : ev.y || 0;
    const sx = wx * z + fgX;
    const sy = wy * z + fgY;
    if (sx < -pad || sx > vpW + pad || sy < -pad || sy > vpH + pad) continue;
    if (ev.kind === "eye") {
      els.push(renderDynamicVoidEye(ev, pal, fgX, fgY, z, entropy));
    } else if (ev.kind === "tear") {
      els.push(renderDynamicTear(ev, pal, fgX, fgY, z, entropy));
    } else if (ev.kind === "tendril") {
      els.push(renderDynamicTendril(ev, pal, fgX, fgY, z, entropy));
    } else if (ev.kind === "wraith") {
      els.push(renderDynamicWraith(ev, pal, fgX, fgY, z, entropy));
    } else if (ev.kind === "starburst") {
      els.push(renderDynamicStarburst(ev, pal, fgX, fgY, z, entropy));
    }
  }
  return els;
}

// Anomaly 4: Silent Floating Obelisk Halo (ZERO text!)
function renderObeliskHalo(vpW, vpH, pal, fgX = 0, fgY = 0, z = 1.0) {
  const bg = pal.canvas;
  const obFont = Math.max(3.5, 12 * z);
  const obLHNum = Math.max(4.5, 15 * z);
  const obLH = `${obLHNum.toFixed(2)}px`;
  const monoW = 7 * 7.2 * z;
  const monoH = 9 * obLHNum;
  const cx = -210 * z + fgX;
  const cy = vpH * 0.84 * z + fgY;
  const cull = 120 * z + 80;
  if (cx < -cull || cx > vpW + cull || cy < -cull || cy > vpH + cull) return [];
  const ox = cx - monoW / 2;
  const oy = cy - monoH / 2;

  const obeliskRows = [
    [
      { text: "  ", color: pal.voidDeep },
      { text: "/|", color: pal.voidObeliskHi, bg },
      { text: "\\", color: pal.voidObeliskMid, bg },
      { text: "  ", color: pal.voidDeep },
    ],
    [
      { text: " ", color: pal.voidDeep },
      { text: "| ", color: pal.voidObeliskHi, bg },
      { text: "|", color: pal.voidDeep, bg },
      { text: " |", color: pal.voidObeliskMid, bg },
      { text: " ", color: pal.voidDeep },
    ],
    [
      { text: " ", color: pal.voidDeep },
      { text: "| ", color: pal.voidObeliskHi, bg },
      { text: ":", color: pal.voidRim, bg },
      { text: " |", color: pal.voidObeliskMid, bg },
      { text: " ", color: pal.voidDeep },
    ],
    [
      { text: " ", color: pal.voidDeep },
      { text: "|_", color: pal.voidObeliskHi, bg },
      { text: "_", color: pal.voidObeliskMid, bg },
      { text: "_|", color: pal.voidObeliskMid, bg },
      { text: " ", color: pal.voidDeep },
    ],
    [
      { text: "  ", color: pal.voidDeep },
      { text: ".", color: pal.voidDeep },
      {
        id: "orrery-obelisk-gap",
        text: "·",
        color: pal.voidTealHi,
        pulse: { from: 0.20, to: 0.84, period: 5400, easing: "ease-in-out" },
      },
      { text: ".", color: pal.voidDeep },
      { text: "  ", color: pal.voidDeep },
    ],
    [
      { text: " ", color: pal.voidDeep },
      { text: ".-", color: pal.voidObeliskHi, bg },
      { text: "-", color: pal.voidObeliskMid, bg },
      { text: "-.", color: pal.voidObeliskMid, bg },
      { text: " ", color: pal.voidDeep },
    ],
    [
      { text: " ", color: pal.voidDeep },
      { text: "| ", color: pal.voidObeliskHi, bg },
      { text: "|", color: pal.voidDeep, bg },
      { text: " |", color: pal.voidObeliskMid, bg },
      { text: " ", color: pal.voidDeep },
    ],
    [
      { text: " ", color: pal.voidDeep },
      { text: "| ", color: pal.voidObeliskHi, bg },
      { text: ":", color: pal.voidRim, bg },
      { text: " |", color: pal.voidObeliskMid, bg },
      { text: " ", color: pal.voidDeep },
    ],
    [
      { text: "  ", color: pal.voidDeep },
      { text: "\\|", color: pal.voidObeliskMid, bg },
      { text: "/", color: pal.voidDeep, bg },
      { text: "  ", color: pal.voidDeep },
    ],
  ];

  const obeliskArt = renderSculpture("orrery-anomaly-obelisk-art", obeliskRows, {
    fontSize: obFont,
    lineHeight: obLH,
    color: pal.voidObeliskMid,
  });

  const now = Date.now();
  const floatOff = Math.sin((now / 9800) * Math.PI * 2) * 2.5 * z;
  const obeliskNode = div()
    .id("orrery-anomaly-obelisk")
    .absolute()
    .left(ox)
    .top(oy + floatOff)
    .bg(CLEAR)
    .child(obeliskArt);

  // 2 tiny slowly orbiting dark geometric shards `◇` flanking the fractured monolith (world-scaled)
  const shardSpecs = [
    { id: "orrery-obelisk-shard-0", rx: 46, ry: 22, dirX: 1, dirY: -1, periodX: 14200, periodY: 10800, color: pal.voidBone },
    { id: "orrery-obelisk-shard-1", rx: 56, ry: 34, dirX: -1, dirY: 1, periodX: 17600, periodY: 12900, color: pal.voidRim },
  ];

  const shardFont = Math.max(3.5, SMALL_FONT * z);
  const shardLH = `${Math.max(4.5, 13 * z).toFixed(2)}px`;
  const els = [obeliskNode];

  for (const sh of shardSpecs) {
    const sxOff = Math.sin((now / sh.periodX) * Math.PI * 2) * sh.rx * sh.dirX * z;
    const syOff = Math.cos((now / sh.periodY) * Math.PI * 2) * sh.ry * sh.dirY * z;
    els.push(
      div()
        .id(sh.id)
        .absolute()
        .left(cx + sxOff - 4 * z)
        .top(cy + syOff - 6 * z)
        .font_family(MONO)
        .text_size(shardFont)
        .line_height(shardLH)
        .text_color(sh.color)
        .bg(CLEAR)
        .child("◇")
    );
  }

  return els;
}

// --- Layer 2: 4 Distinct Hand-Crafted 9-Line Sculpted Planetoids ---

function buildPlanetoidRows(variant, spId, pal) {
  const bg = pal.canvas;
  const sid = sanitizeId(spId);

  // Variant 0: The Ringed World (symmetrical double-arc sandstone rings + diagonal-lit cerulean sphere)
  if (variant === 0) {
    return {
      cols: 27,
      rows: [
        [
          { text: "         ", color: pal.bodyHi },
          { text: ".---", color: pal.bodyHi, bg },
          { text: "---", color: pal.bodyMid, bg },
          { text: "-.", color: pal.bodyShade, bg },
        ],
        [
          { text: "      ", color: pal.bodyHi },
          { text: ".-' . ", color: pal.bodyHi, bg },
          { text: "  o  ", color: pal.bodyMid, bg },
          { text: " '-.", color: pal.bodyShade, bg },
        ],
        [
          { text: "     ", color: pal.bodyHi },
          { text: "/  o  ", color: pal.bodyHi, bg },
          { text: " .   . ", color: pal.bodyMid, bg },
          { text: "   \\", color: pal.bodyShade, bg },
        ],
        [
          { text: " ", color: pal.ringMid },
          { text: ".~-", color: pal.ringHi },
          { text: "|  .  ", color: pal.bodyHi, bg },
          { text: "  o   ", color: pal.bodyMid, bg },
          { text: " .    |", color: pal.bodyShade, bg },
          { text: "-~.", color: pal.ringDim },
        ],
        [
          { text: "(===", color: pal.ringHi, bg, bold: true },
          { text: "----.", color: pal.ringMid, bg },
          { text: "___", color: pal.ringHi, bg },
          {
            id: `orrery-p0-glint-${sid}`,
            frames: ["===", "=*=", "==="],
            framesMs: 1400,
            color: pal.ringHi,
            bg,
            bold: true,
          },
          { text: "___", color: pal.ringMid, bg },
          { text: ".----", color: pal.ringDim, bg },
          { text: "===)", color: pal.ringDim, bg },
        ],
        [
          { text: " ", color: pal.ringDim },
          { text: "'~-", color: pal.ringMid },
          { text: "|   . ", color: pal.bodyMid, bg },
          { text: "   o  ", color: pal.bodyShade, bg },
          { text: "  .   |", color: pal.bodyShade, bg },
          { text: "-~'", color: pal.ringDim },
        ],
        [
          { text: "     ", color: pal.bodyMid },
          { text: "\\   . ", color: pal.bodyMid, bg },
          { text: "    o   . /", color: pal.bodyShade, bg },
        ],
        [
          { text: "      ", color: pal.bodyMid },
          { text: "'-.  o", color: pal.bodyMid, bg },
          { text: "    . .-'", color: pal.bodyShade, bg },
        ],
        [
          { text: "         ", color: pal.bodyShade },
          { text: "'---", color: pal.bodyMid, bg },
          { text: "----'", color: pal.bodyShade, bg },
        ],
      ],
    };
  }

  // Variant 1: The Little-Prince World (B-612 asteroid + sage tree /\ + pulsing amber beacon *)
  if (variant === 1) {
    return {
      cols: 23,
      rows: [
        [
          { text: "       ", color: pal.treeHi },
          { text: "/\\", color: pal.treeHi, bold: true },
          { text: "      ", color: pal.beacon },
          {
            id: `orrery-p1-beacon-${sid}`,
            frames: ["*", "+", "*", "·"],
            framesMs: 820,
            color: pal.beacon,
            bold: true,
          },
        ],
        [
          { text: "      ", color: pal.treeHi },
          { text: "/^^\\", color: pal.treeHi },
          { text: "     ", color: pal.trunk },
          { text: "|", color: pal.brassHi },
        ],
        [
          { text: "     ", color: pal.treeMid },
          { text: "/____\\", color: pal.treeMid },
          { text: "  ", color: pal.trunk },
          { text: "_|_", color: pal.brassMid },
        ],
        [
          { text: "    ", color: pal.rockHi },
          { text: ".-' ", color: pal.rockHi, bg },
          { text: "||", color: pal.trunk, bg },
          { text: " .----", color: pal.rockMid, bg },
          { text: "'-.", color: pal.rockShade, bg },
        ],
        [
          { text: "   ", color: pal.rockHi },
          { text: "/  o  ", color: pal.rockHi, bg },
          { text: " .   . ", color: pal.rockMid, bg },
          { text: "   \\", color: pal.rockShade, bg },
        ],
        [
          { text: "  ", color: pal.rockHi },
          { text: "|  .  ", color: pal.rockHi, bg },
          { text: " (o)  ", color: pal.rockMid, bg },
          { text: " .   |", color: pal.rockShade, bg },
        ],
        [
          { text: "   ", color: pal.rockMid },
          { text: "\\   . ", color: pal.rockMid, bg },
          { text: "   .   o /", color: pal.rockShade, bg },
        ],
        [
          { text: "    ", color: pal.rockMid },
          { text: "'-.  o", color: pal.rockMid, bg },
          { text: "   . .-'", color: pal.rockShade, bg },
        ],
        [
          { text: "       ", color: pal.rockShade },
          { text: "'---", color: pal.rockMid, bg },
          { text: "----'", color: pal.rockShade, bg },
        ],
      ],
    };
  }

  // Variant 2: The Observatory Moon (cratered lunar sphere + brass dome + blinking radio dish Y)
  if (variant === 2) {
    return {
      cols: 23,
      rows: [
        [
          { text: "         ", color: pal.brassHi },
          { text: ".---.", color: pal.brassHi, bg },
          { text: "  ", color: pal.dish },
          { text: "Y", color: pal.dish, bold: true },
          {
            id: `orrery-p2-sig-${sid}`,
            frames: ["'", "*", "'", " "],
            framesMs: 700,
            color: pal.dish,
          },
        ],
        [
          { text: "        ", color: pal.brassHi },
          { text: "/  ", color: pal.brassHi, bg },
          {
            id: `orrery-p2-lamp-${sid}`,
            frames: ["*", "o", "*"],
            framesMs: 1120,
            color: pal.beacon,
            bg,
            bold: true,
          },
          { text: "  \\", color: pal.brassMid, bg },
          { text: " ", color: pal.dish },
          { text: "|", color: pal.dish },
        ],
        [
          { text: "      ", color: pal.brassMid },
          { text: "_[_______]", color: pal.brassMid, bg },
          { text: "|", color: pal.dish },
        ],
        [
          { text: "    ", color: pal.lunarHi },
          { text: ".-' . ", color: pal.lunarHi, bg },
          { text: "  o  ", color: pal.lunarMid, bg },
          { text: " '-.", color: pal.lunarShade, bg },
        ],
        [
          { text: "   ", color: pal.lunarHi },
          { text: "/ (o) ", color: pal.lunarHi, bg },
          { text: " .   . ", color: pal.lunarMid, bg },
          { text: "   \\", color: pal.lunarShade, bg },
        ],
        [
          { text: "  ", color: pal.lunarHi },
          { text: "|  .  ", color: pal.lunarHi, bg },
          { text: "  .   o", color: pal.lunarMid, bg },
          { text: "  . |", color: pal.lunarShade, bg },
        ],
        [
          { text: "   ", color: pal.lunarMid },
          { text: "\\   o ", color: pal.lunarMid, bg },
          { text: "  ( )  . /", color: pal.lunarShade, bg },
        ],
        [
          { text: "    ", color: pal.lunarMid },
          { text: "'-.  .", color: pal.lunarMid, bg },
          { text: "   o .-'", color: pal.lunarShade, bg },
        ],
        [
          { text: "       ", color: pal.lunarShade },
          { text: "'---", color: pal.lunarMid, bg },
          { text: "----'", color: pal.lunarShade, bg },
        ],
      ],
    };
  }

  // Variant 3: The Crystal Bastion (faceted mineral asteroid + glinting sea-glass crystal & spire)
  return {
    cols: 23,
    rows: [
      [
        { text: "           ", color: pal.spire },
        {
          id: `orrery-p3-spire-${sid}`,
          frames: ["*", "+", "*"],
          framesMs: 820,
          color: pal.spire,
          bold: true,
        },
      ],
      [
        { text: "          ", color: pal.facetHi },
        { text: "/|", color: pal.facetHi },
        { text: "\\", color: pal.facetMid },
      ],
      [
        { text: "         ", color: pal.facetHi },
        { text: "/ ", color: pal.facetHi },
        { text: "|", color: pal.crystalHi },
        { text: " \\", color: pal.facetMid },
      ],
      [
        { text: "     ", color: pal.facetHi },
        { text: ".-'  ", color: pal.facetHi, bg },
        { text: "/|\\", color: pal.crystalHi, bg },
        { text: "  '-.", color: pal.facetMid, bg },
      ],
      [
        { text: "    ", color: pal.facetHi },
        { text: "./  ", color: pal.facetHi, bg },
        {
          id: `orrery-p3-facet-${sid}`,
          frames: ["<>", "<>", "++", "<>"],
          framesMs: 1600,
          color: pal.crystalHi,
          bg,
          bold: true,
        },
        { text: " | ", color: pal.facetMid, bg },
        { text: "<>", color: pal.crystalMid, bg },
        { text: "  \\.", color: pal.facetShade, bg },
      ],
      [
        { text: "   ", color: pal.facetHi },
        { text: "<   .  ", color: pal.facetHi, bg },
        { text: "/ \\  ", color: pal.facetMid, bg },
        { text: "<>", color: pal.crystalHi, bg, bold: true },
        { text: "  >", color: pal.facetShade, bg },
      ],
      [
        { text: "    ", color: pal.facetMid },
        { text: "'\\  ", color: pal.facetMid, bg },
        { text: "<>", color: pal.crystalMid, bg },
        { text: "   .  ./'", color: pal.facetShade, bg },
      ],
      [
        { text: "     ", color: pal.facetMid },
        { text: "'-.  ", color: pal.facetMid, bg },
        { text: "\\ /", color: pal.crystalMid, bg },
        { text: "  .-'", color: pal.facetShade, bg },
      ],
      [
        { text: "        ", color: pal.facetShade },
        { text: "'--", color: pal.facetMid, bg },
        { text: "---'", color: pal.facetShade, bg },
      ],
    ],
  };
}

// --- Spacious Celestial Planetoid Placement (with Multi-Machine Star-System Grouping) ---

function computeRawPlanetSlots(n, vpW, vpH) {
  const topPad = 56;
  const bottomPad = 52; // Breathing room for bottom orbital collar
  const usableH = Math.max(220, vpH - topPad - bottomPad);
  const wide = vpW >= 1120;

  if (n === 0) return [];

  // 1 Space: generously & heroically centered in the open left hemisphere (or center on narrow screens)
  if (n === 1) {
    return [
      {
        x: Math.round(wide ? vpW * 0.21 : vpW * 0.50),
        y: Math.round(topPad + usableH * 0.45),
        orbitRx: Math.round(Math.min(182, wide ? vpW * 0.145 : vpW * 0.34)),
        orbitRy: Math.round(Math.min(126, usableH * 0.25)),
      },
    ];
  }

  // 2 Spaces: stacked diagonally inside the open left ~42% hemisphere (100% visible beside terminal!)
  if (n === 2) {
    return [
      {
        x: Math.round(wide ? vpW * 0.20 : vpW * 0.34),
        y: Math.round(topPad + usableH * 0.28),
        orbitRx: Math.round(Math.min(148, wide ? vpW * 0.12 : vpW * 0.26)),
        orbitRy: Math.round(Math.min(96, usableH * 0.17)),
      },
      {
        x: Math.round(wide ? vpW * 0.23 : vpW * 0.66),
        y: Math.round(topPad + usableH * 0.70),
        orbitRx: Math.round(Math.min(144, wide ? vpW * 0.115 : vpW * 0.26)),
        orbitRy: Math.round(Math.min(94, usableH * 0.17)),
      },
    ];
  }

  // 3 Spaces: graceful crescent arc with guaranteed non-overlapping vertical & horizontal spacing
  if (n === 3) {
    const stepY = Math.max(230, Math.round(usableH * 0.28));
    const midY = Math.round(topPad + usableH * 0.48);
    if (wide) {
      return [
        {
          x: Math.round(Math.max(165, vpW * 0.22)),
          y: Math.round(midY - stepY),
          orbitRx: Math.round(Math.min(132, vpW * 0.105)),
          orbitRy: Math.round(Math.min(82, usableH * 0.14)),
        },
        {
          x: Math.round(Math.max(150, vpW * 0.14)),
          y: midY,
          orbitRx: Math.round(Math.min(132, vpW * 0.105)),
          orbitRy: Math.round(Math.min(82, usableH * 0.14)),
        },
        {
          x: Math.round(Math.max(175, vpW * 0.24)),
          y: Math.round(midY + stepY),
          orbitRx: Math.round(Math.min(132, vpW * 0.105)),
          orbitRy: Math.round(Math.min(82, usableH * 0.14)),
        },
      ];
    }
    const stepX = Math.max(280, Math.round(vpW * 0.28));
    const cx = Math.round(vpW * 0.5);
    return [
      {
        x: Math.round(cx - stepX),
        y: Math.round(topPad + usableH * 0.28),
        orbitRx: Math.round(Math.min(120, vpW * 0.18)),
        orbitRy: Math.round(Math.min(78, usableH * 0.14)),
      },
      {
        x: cx,
        y: Math.round(topPad + usableH * 0.56),
        orbitRx: Math.round(Math.min(120, vpW * 0.18)),
        orbitRy: Math.round(Math.min(78, usableH * 0.14)),
      },
      {
        x: Math.round(cx + stepX),
        y: Math.round(topPad + usableH * 0.28),
        orbitRx: Math.round(Math.min(120, vpW * 0.18)),
        orbitRy: Math.round(Math.min(78, usableH * 0.14)),
      },
    ];
  }

  // 4+ Spaces: prime left column (wide) or clean world-space grid with strict minDx >= 290, minDy >= 235
  // so 4–12+ spaces never overlap even on 1280×720 laptops and smoothly expand into the pannable arena.
  const stepX = Math.max(295, Math.round(vpW * 0.22));
  const stepY = Math.max(235, Math.round(usableH * 0.34));
  const rx = Math.round(Math.min(122, Math.max(96, vpW * 0.088)));
  const ry = Math.round(Math.min(76, Math.max(62, usableH * 0.12)));

  if (!wide) {
    const cols = Math.max(2, Math.min(4, Math.ceil(Math.sqrt(n))));
    const startX = Math.round(vpW * 0.5 - ((cols - 1) * stepX) / 2);
    const startY = Math.round(topPad + 120);
    const out = [];
    for (let i = 0; i < n; i++) {
      const col = i % cols;
      const row = Math.floor(i / cols);
      out.push({
        x: Math.round(startX + col * stepX + (row % 2 === 1 ? 36 : 0)),
        y: Math.round(startY + row * stepY),
        orbitRx: rx,
        orbitRy: ry,
      });
    }
    return out;
  }

  const leftBaseY = Math.round(topPad + usableH * 0.48);
  const positions = [
    { x: Math.round(Math.max(165, vpW * 0.21)), y: Math.round(leftBaseY - stepY), orbitRx: rx, orbitRy: ry },
    { x: Math.round(Math.max(150, vpW * 0.14)), y: leftBaseY, orbitRx: rx, orbitRy: ry },
    { x: Math.round(Math.max(175, vpW * 0.23)), y: Math.round(leftBaseY + stepY), orbitRx: rx, orbitRy: ry },
  ];

  const rest = n - 3;
  const rightStartX = Math.round(Math.max(positions[2].x + stepX, vpW * 0.50));
  const rightCols = Math.max(2, Math.min(4, Math.ceil(Math.sqrt(rest))));
  const rightStartY = Math.round(topPad + Math.max(125, usableH * 0.24));
  for (let i = 0; i < rest; i++) {
    const col = i % rightCols;
    const row = Math.floor(i / rightCols);
    positions.push({
      x: Math.round(rightStartX + col * stepX + (row % 2 === 1 ? 42 : 0)),
      y: Math.round(rightStartY + row * stepY),
      orbitRx: Math.round(Math.min(116, rx)),
      orbitRy: Math.round(Math.min(72, ry)),
    });
  }

  return positions;
}

export function computePlanetPositions(spaceList, vpW, vpH, spacePosMap = null) {
  const n = spaceList.length;
  if (n === 0) return [];

  const applyCustom = (baseList) => {
    if (!spacePosMap || typeof spacePosMap !== "object") return baseList;
    return baseList.map((pos, i) => {
      const spId = spaceList[i]?.id;
      const custom = spId ? spacePosMap[spId] : null;
      if (custom && typeof custom.x === "number" && typeof custom.y === "number") {
        return { ...pos, x: custom.x, y: custom.y };
      }
      return pos;
    });
  };

  const hasRemote = spaceList.some((sp) => Boolean(sp && sp.machine));
  const slots = computeRawPlanetSlots(n, vpW, vpH);
  if (!hasRemote) return applyCustom(slots);

  // Group visually: local spaces stay in prime left hemisphere first, followed by
  // each remote machine's spaces clustered together so star-system connectors stay clean!
  const localIndices = [];
  const remoteByMachine = new Map();
  for (let i = 0; i < n; i++) {
    const m = spaceList[i]?.machine;
    if (!m) {
      localIndices.push(i);
    } else {
      if (!remoteByMachine.has(m)) remoteByMachine.set(m, []);
      remoteByMachine.get(m).push(i);
    }
  }

  const orderedIndices = [...localIndices];
  for (const idxs of remoteByMachine.values()) {
    for (const idx of idxs) orderedIndices.push(idx);
  }

  const out = new Array(n);
  for (let slotIdx = 0; slotIdx < orderedIndices.length; slotIdx++) {
    out[orderedIndices[slotIdx]] = slots[slotIdx];
  }
  return applyCustom(out);
}

function resolveMachineVisualStatus(machineName, machineMetaByName, pal) {
  const meta = machineMetaByName.get(machineName) || null;
  const rawState = String(meta?.state || "").toLowerCase().trim();
  const rawLayout = String(meta?.layout || "").toLowerCase().trim();

  if (
    rawState === "needs_login" ||
    rawState === "needs login" ||
    rawState === "auth_required" ||
    rawState === "error" ||
    rawState === "failed"
  ) {
    return {
      dotColor: pal.machineLogin,
      label: rawState === "error" || rawState === "failed" ? "error" : "needs login",
      badgeSuffix: "needs login",
      why: meta?.why || "",
    };
  }
  if (
    rawState === "asleep" ||
    rawState === "offline" ||
    rawState === "disconnected" ||
    rawState === "unreachable" ||
    rawLayout === "unavailable"
  ) {
    const lbl = rawState || "offline";
    return {
      dotColor: pal.machineOffline,
      label: lbl,
      badgeSuffix: lbl,
      why: meta?.why || "",
    };
  }
  if (rawState === "connecting" || rawState === "loading" || rawLayout === "loading") {
    return {
      dotColor: pal.machineLoading,
      label: "connecting",
      badgeSuffix: "connecting",
      why: meta?.why || "",
    };
  }
  return {
    dotColor: pal.machineConnected,
    label: "connected",
    badgeSuffix: "",
    why: meta?.why || "",
  };
}

function renderMachineStarSystems(spaceList, basePositions, machinesList, fgX, fgY, z, vpW, vpH, pal, handlers) {
  const groups = new Map();
  for (let i = 0; i < spaceList.length; i++) {
    const sp = spaceList[i];
    if (!sp || !sp.machine) continue;
    const mName = String(sp.machine).trim();
    if (!mName) continue;
    if (!groups.has(mName)) groups.set(mName, []);
    groups.get(mName).push({ sp, worldPos: basePositions[i], idx: i });
  }
  if (groups.size === 0) return [];

  const machineMetaByName = new Map();
  if (Array.isArray(machinesList)) {
    for (const m of machinesList) {
      if (m && typeof m.name === "string" && m.name.trim()) {
        machineMetaByName.set(m.name.trim(), m);
      }
    }
  }

  const fSmall = Math.max(4, SMALL_FONT * z);
  const lhSmall = `${Math.max(5.5, 14 * z).toFixed(2)}px`;
  const fTiny = Math.max(3.5, TINY_FONT * z);
  const lhTiny = `${Math.max(5, 13 * z).toFixed(2)}px`;

  const els = [];
  for (const [machineName, entries] of groups.entries()) {
    const mid = sanitizeId(machineName);
    const status = resolveMachineVisualStatus(machineName, machineMetaByName, pal);

    // Pure world-space anchor so relay header & beams scale rigidly with zoom!
    let sumWX = 0;
    let minWorldTop = Infinity;
    for (const entry of entries) {
      sumWX += entry.worldPos.x;
      const topEdge = entry.worldPos.y - Math.max(88, Math.round(entry.worldPos.orbitRy * 0.92));
      if (topEdge < minWorldTop) minWorldTop = topEdge;
    }

    const markerWorldX = sumWX / entries.length;
    const markerWorldY = Math.min(minWorldTop - 22, entries[0].worldPos.y - 108);
    const markerSX = markerWorldX * z + fgX;
    const markerSY = markerWorldY * z + fgY;
    const relayAnchor = { x: markerSX, y: markerSY + 14 * z };

    // Sleek faint dashed orbital connector from the System Relay Marker to each Space on this machine
    const beamColor = withAlpha(status.dotColor, "5C");
    for (const entry of entries) {
      const targetPt = {
        x: entry.worldPos.x * z + fgX,
        y: (entry.worldPos.y - Math.min(74, Math.round(entry.worldPos.orbitRy * 0.72))) * z + fgY,
      };
      if (
        Math.max(relayAnchor.x, targetPt.x) < -60 ||
        Math.min(relayAnchor.x, targetPt.x) > vpW + 60 ||
        Math.max(relayAnchor.y, targetPt.y) < -60 ||
        Math.min(relayAnchor.y, targetPt.y) > vpH + 60
      ) {
        continue;
      }
      const beamDots = renderRelayBeam(
        `orrery-sysrelay-${mid}-${sanitizeId(entry.sp.id || entry.idx)}`,
        relayAnchor,
        targetPt,
        beamColor,
        z
      );
      for (const dot of beamDots) els.push(dot);
    }

    const displayName = machineName.length > 20 ? `${machineName.slice(0, 19)}~` : machineName;
    const estWidth = Math.max(
      48,
      ((displayName.length + (status.badgeSuffix ? status.badgeSuffix.length + 3 : 0)) * 7 + 28) * z
    );
    if (markerSX + estWidth / 2 < -40 || markerSX - estWidth / 2 > vpW + 40 || markerSY < -48 || markerSY > vpH + 48) {
      continue;
    }

    const spCount = entries.length;
    const tipParts = [
      `${machineName} · ${status.label}`,
      `${spCount} ${spCount === 1 ? "space" : "spaces"}`,
    ];
    if (status.why) tipParts.push(status.why);
    const tip = `${tipParts.join(" · ")}\nclick: manage machine · right-click: machine menu`;

    const marker = h_flex()
      .id(`orrery-machine-relay-${mid}`)
      .absolute()
      .left(Math.round(markerSX - estWidth / 2))
      .top(Math.round(markerSY))
      .items_center()
      .gap(Math.max(2, Math.round(5 * z)))
      .px(Math.max(3, Math.round(7 * z)))
      .py(Math.max(1, Math.round(2 * z)))
      .bg(pal.machineBg)
      .border_1()
      .border_color(withAlpha(status.dotColor, "66"))
      .cursor_pointer()
      .hover((s) => s.bg(pal.collarHover).border_color(status.dotColor))
      .tooltip(tip)
      .on_mouse_down("left", (_e, cx) => {
        cx.stop_propagation();
      })
      .on_mouse_down("right", (e, cx) => {
        cx.stop_propagation();
        handlers?.onMachineRightClick?.(machineName, e, cx);
      })
      .on_click((e, cx) => {
        cx.stop_propagation();
        handlers?.onMachineClick?.(machineName, e, cx);
      })
      .child(
        div()
          .id(`orrery-machine-dot-${mid}`)
          .font_family(MONO)
          .text_size(fTiny)
          .line_height(lhTiny)
          .font_bold()
          .text_color(status.dotColor)
          .whitespace_nowrap()
          .child("●")
      )
      .child(
        div()
          .font_family(MONO)
          .text_size(fSmall)
          .line_height(lhSmall)
          .font_bold()
          .text_color(pal.title)
          .whitespace_nowrap()
          .child(displayName)
      )
      .when(Boolean(status.badgeSuffix) && z >= 0.45, (el) =>
        el.child(
          div()
            .font_family(MONO)
            .text_size(fTiny)
            .line_height(lhTiny)
            .text_color(status.dotColor)
            .whitespace_nowrap()
            .child(status.badgeSuffix)
        )
      );

    els.push(marker);
  }

  return els;
}

function renderOrbitRing(idPrefix, cx, cy, rx, ry, color, dotCount = 24, z = 1.0) {
  const dots = [];
  const fTiny = Math.max(3.5, TINY_FONT * z);
  const lhTiny = `${Math.max(4.5, 13 * z).toFixed(2)}px`;
  for (let i = 0; i < dotCount; i++) {
    const angle = (Math.PI * 2 * i) / dotCount;
    const px = Math.round(cx + Math.cos(angle) * rx);
    const py = Math.round(cy + Math.sin(angle) * ry);
    const ch = i % 2 === 0 ? "·" : ".";
    dots.push(
      div()
        .id(`${idPrefix}-od-${i}`)
        .absolute()
        .left(px)
        .top(py)
        .font_family(MONO)
        .text_size(fTiny)
        .line_height(lhTiny)
        .text_color(color)
        .bg(CLEAR)
        .child(ch)
    );
  }
  return dots;
}

function renderRelayBeam(idPrefix, fromPt, toPt, color, z = 1.0) {
  const dots = [];
  const dist = Math.hypot(toPt.x - fromPt.x, toPt.y - fromPt.y);
  const stepPx = Math.max(12, 26 * z);
  const steps = Math.max(4, Math.min(20, Math.floor(dist / stepPx)));
  const fTiny = Math.max(3.5, TINY_FONT * z);
  const lhTiny = `${Math.max(4.5, 13 * z).toFixed(2)}px`;
  for (let i = 1; i < steps; i++) {
    const t = i / steps;
    const px = Math.round(fromPt.x + (toPt.x - fromPt.x) * t);
    const py = Math.round(fromPt.y + (toPt.y - fromPt.y) * t);
    dots.push(
      div()
        .id(`${idPrefix}-rb-${i}`)
        .absolute()
        .left(px)
        .top(py)
        .font_family(MONO)
        .text_size(fTiny)
        .line_height(lhTiny)
        .text_color(color)
        .bg(CLEAR)
        .child(i % 2 === 0 ? "-" : ".")
    );
  }
  return dots;
}

function renderMoonlet(idPrefix, idx, cx, cy, rx, ry, dirtyCount, pal, z = 1.0) {
  const dirX = idx % 2 === 0 ? 1 : -1;
  const dirY = idx % 3 === 0 ? -1 : 1;
  const pxRx = Math.max(24, Math.round(rx * 0.72 * z));
  const pxRy = Math.max(18, Math.round(ry * 0.72 * z));
  const periodX = 11200 + idx * 1900;
  const periodY = 8300 + idx * 1500;
  const moonCh = dirtyCount > 0 ? "*" : "o";
  const moonColor = dirtyCount > 0 ? pal.dirty : pal.moonNatural;
  const fSize = Math.max(4, Math.round(TINY_FONT * z));
  const lH = `${Math.max(5, Math.round(13 * z))}px`;

  const moonGlyph = div()
    .id(`${idPrefix}-moon-glyph`)
    .font_family(MONO)
    .text_size(fSize)
    .line_height(lH)
    .text_color(moonColor)
    .bg(CLEAR)
    .child(moonCh);

  // While zoomed out, anchor cleanly at scaled orbital radius so GPUI `.loop` never resets phase
  if (z < 0.99) {
    const angle = (idx * 2.1) + 0.7;
    const mx = Math.round(cx + Math.cos(angle) * pxRx - Math.round(3 * z));
    const my = Math.round(cy + Math.sin(angle) * pxRy - Math.round(5 * z));
    return div()
      .id(`${idPrefix}-moon-static`)
      .absolute()
      .left(mx)
      .top(my)
      .bg(CLEAR)
      .child(moonGlyph);
  }

  const yOrb = div()
    .id(`${idPrefix}-moon-y`)
    .relative()
    .bg(CLEAR)
    .loop("top", { from: -pxRy * dirY, to: pxRy * dirY, period: periodY, easing: "ease-in-out" })
    .child(moonGlyph);

  return div()
    .id(`${idPrefix}-moon-x`)
    .absolute()
    .left(Math.round(cx - 4))
    .top(Math.round(cy - 6))
    .bg(CLEAR)
    .child(
      div()
        .id(`${idPrefix}-moon-x-loop`)
        .relative()
        .bg(CLEAR)
        .loop("left", { from: pxRx * dirX, to: -pxRx * dirX, period: periodX, easing: "ease-in-out" })
        .child(yOrb)
    );
}

function renderPlanetoid(sp, idx, pos, { isActive, hasBlocked, spAgents = [], gitInfo, pal, handlers, singleSpace, z = 1.0 }) {
  const sid = sanitizeId(sp.id || `sp${idx}`);
  const variant = hashString(sp.id || sp.name || String(idx)) % 4;
  const built = buildPlanetoidRows(variant, sid, pal);

  const fMain = Math.max(3.5, FONT_SIZE * z);
  const lhMainNum = Math.max(4.5, CELL_H * z);
  const lhMain = `${lhMainNum.toFixed(2)}px`;
  const fTitle = Math.max(4, 12 * z);
  const fSmall = Math.max(3.5, SMALL_FONT * z);
  const lhSmall = `${Math.max(4.5, 14 * z).toFixed(2)}px`;
  const fTiny = Math.max(3.5, TINY_FONT * z);
  const lhTiny = `${Math.max(4.5, 13 * z).toFixed(2)}px`;

  const planetW = built.cols * CELL_W * z;
  const planetH = built.rows.length * lhMainNum;
  const scaledRx = Math.max(24, pos.orbitRx * z);
  const scaledRy = Math.max(18, pos.orbitRy * z);
  const els = [];

  // Dotted orbital path ring around the planetoid (scales smoothly with z!)
  const ringColor = hasBlocked ? pal.orbitBlocked : isActive ? pal.orbitActive : pal.orbitDot;
  const ringNodes = renderOrbitRing(
    `orrery-sp-${sid}`,
    pos.x,
    pos.y,
    scaledRx,
    scaledRy,
    ringColor,
    singleSpace ? 28 : 22,
    z
  );
  for (const r of ringNodes) els.push(r);

  // Tiny orbiting natural moon tracing a curved elliptical orbit around every planetoid
  els.push(renderMoonlet(`orrery-sp-${sid}`, idx, pos.x, pos.y, pos.orbitRx, pos.orbitRy, gitInfo.dirtyCount, pal, z));

  // Planetoid sculpture + optional pulsing SOS crown + remote machine beacon
  const tabs = Array.isArray(sp.tabs) ? sp.tabs : [];
  const multiTab = tabs.length > 1;
  const spName = cleanSpaceName(sp);
  const rawSpName = (sp && typeof sp.name === "string" && sp.name.trim()) || spName;
  const tabCountLabel = `${tabs.length} ${tabs.length === 1 ? "tab" : "tabs"}`;
  const spHead = [
    `${sp.machine ? `${sp.machine}:` : ""}${rawSpName}`,
    gitInfo.branch ? `(${gitInfo.branch}${gitInfo.dirtyCount > 0 ? ` · ${gitInfo.dirtyCount}*` : ""})` : "",
  ]
    .filter(Boolean)
    .join(" ");
  const spTip =
    (typeof handlers?.spaceTooltip === "function" && handlers.spaceTooltip(sp)) ||
    `${spHead} · ${tabCountLabel}\nclick: open · right-click: space menu · double-click: rename`;

  const sculpture = renderSculpture(`orrery-planet-${sid}`, built.rows, {
    fontSize: fMain,
    lineHeight: lhMain,
    color: pal.title,
  });

  const planetStack = v_flex()
    .id(`orrery-planet-stack-${sid}`)
    .items_center()
    .bg(CLEAR)
    .when(hasBlocked, (el) =>
      el.child(
        div()
          .id(`orrery-planet-sos-${sid}`)
          .mb(Math.max(1, Math.round(2 * z)))
          .px(Math.max(2, Math.round(5 * z)))
          .py(1)
          .bg(pal.blockedBg)
          .border_1()
          .border_color(pal.blocked)
          .font_family(MONO)
          .text_size(fTiny)
          .line_height(lhTiny)
          .font_bold()
          .text_color(pal.blockedHi)
          .whitespace_nowrap()
          .loop("opacity", { from: 0.35, to: 1.0, period: 650, easing: "ease-in-out" })
          .child("! SOS !")
      )
    )
    .when(Boolean(sp.machine), (el) =>
      el.child(
        div()
          .id(`orrery-planet-ssh-${sid}`)
          .mb(1)
          .px(Math.max(2, Math.round(4 * z)))
          .bg(pal.canvas)
          .font_family(MONO)
          .text_size(fTiny)
          .line_height(lhTiny)
          .text_color(pal.remote)
          .whitespace_nowrap()
          .child(`@${sp.machine}`)
      )
    )
    .child(sculpture);

  const planetHit = div()
    .id(`orrery-planet-hit-${sid}`)
    .bg(CLEAR)
    .cursor_pointer()
    .tooltip(spTip)
    .on_mouse_down("left", (_e, cx) => {
      cx.stop_propagation();
    })
    .on_mouse_down("right", (e, cx) => {
      cx.stop_propagation();
      handlers?.onSpaceRightClick?.(sp, e, cx);
    })
    .on_click((e, cx) => {
      cx.stop_propagation();
      if (e && e.click_count >= 2 && handlers?.onSpaceDoubleClick) {
        handlers.onSpaceDoubleClick(sp, cx);
      } else if (handlers?.onSpaceClick) {
        handlers.onSpaceClick(sp, cx);
      }
    })
    .child(planetStack);

  // Zero-gravity gentle float at 100% live zoom; crisp static anchor while zooming
  const planetInner =
    z >= 0.99
      ? div()
          .id(`orrery-planet-float-${sid}`)
          .relative()
          .bg(CLEAR)
          .loop("top", { from: -5, to: 5, period: 6200 + idx * 1100, easing: "ease-in-out" })
          .child(planetHit)
      : planetHit;

  const extraTop = Math.round(((hasBlocked ? 18 : 0) + (sp.machine ? 14 : 0)) * z);
  els.push(
    div()
      .id(`orrery-planet-anchor-${sid}`)
      .absolute()
      .left(Math.round(pos.x - planetW / 2))
      .top(Math.round(pos.y - planetH / 2 - extraTop))
      .bg(CLEAR)
      .child(planetInner)
  );

  // Crystal-Clear Orbital Collar directly beneath the Planetoid (scales proportionally!)
  const collarW = Math.max(96, Math.round(248 * z));
  const lhTitle = `${Math.max(6, Math.round(15 * z))}px`;

  const titleBtn = h_flex()
    .id(`orrery-collar-title-${sid}`)
    .w_full()
    .min_w(0)
    .items_center()
    .justify_center()
    .overflow_hidden()
    .gap(Math.max(2, Math.round(5 * z)))
    .px(Math.max(2, Math.round(5 * z)))
    .py(Math.max(0, Math.round(1 * z)))
    .bg(CLEAR)
    .cursor_pointer()
    .hover((s) => s.bg(pal.collarHover))
    .tooltip(spTip)
    .on_mouse_down("left", (_e, cx) => {
      cx.stop_propagation();
    })
    .on_click((e, cx) => {
      cx.stop_propagation();
      if (e && e.click_count >= 2 && handlers?.onSpaceDoubleClick) {
        handlers.onSpaceDoubleClick(sp, cx);
      } else if (handlers?.onSpaceClick) {
        handlers.onSpaceClick(sp, cx);
      }
    })
    .when(isActive, (el) =>
      el.child(
        div()
          .flex_none()
          .font_family(MONO)
          .text_size(fTiny)
          .line_height(lhTitle)
          .text_color(hasBlocked ? pal.blockedHi : pal.titleActive)
          .whitespace_nowrap()
          .child("◆")
      )
    )
    .child(
      div()
        .min_w(0)
        .font_family(MONO)
        .text_size(fTitle)
        .line_height(lhTitle)
        .font_bold()
        .text_color(hasBlocked ? pal.blockedHi : isActive ? pal.titleActive : pal.title)
        .truncate()
        .child(spName)
    )
    .when(Boolean(gitInfo.branch) && z >= 0.45, (el) =>
      el.child(
        div()
          .min_w(0)
          .max_w(Math.max(44, Math.round(96 * z)))
          .font_family(MONO)
          .text_size(fSmall)
          .line_height(lhSmall)
          .text_color(pal.branch)
          .truncate()
          .child(gitInfo.branch)
      )
    )
    .when(gitInfo.dirtyCount > 0 && z >= 0.45, (el) =>
      el.child(
        div()
          .flex_none()
          .font_family(MONO)
          .text_size(fSmall)
          .line_height(lhSmall)
          .text_color(pal.dirty)
          .whitespace_nowrap()
          .child(`${gitInfo.dirtyCount}*`)
      )
    );

  // Informative clickable tab chips: active underlined in accent, colored agent status dot, crisp per-tab tooltips
  const tabEls = tabs.map((tb, tIdx) => {
    const tabIdx = tb.index ?? tIdx + 1;
    const label = cleanTabChipLabel(tb, tIdx);
    const activeTab = Boolean(tb.active);
    const tbId = sanitizeId(tb.id || `t${tIdx}`);
    const dotStatus = resolveTabAgentStatus(tb, spAgents);
    const dotColor = tabStatusDotColor(dotStatus, pal);
    const tipStatus = tb.status || dotStatus || "";
    const fallbackTip = `Tab ${tb.named && tb.name ? tb.name : tabIdx} in ${rawSpName}${tipStatus ? ` · ${tipStatus}` : ""}`;
    const tbTip =
      (typeof handlers?.tabTooltip === "function" && handlers.tabTooltip(sp, tb)) ||
      fallbackTip;
    const chipBg = multiTab
      ? activeTab
        ? withAlpha(pal.tabActive, "18")
        : withAlpha(pal.collarHover, "66")
      : CLEAR;

    return h_flex()
      .id(`orrery-tab-${sid}-${tbId}`)
      .items_center()
      .gap(Math.max(1, Math.round(3 * z)))
      .px(Math.max(2, Math.round(4 * z)))
      .py(Math.max(0, Math.round(1 * z)))
      .bg(chipBg)
      .border_b_1()
      .border_color(activeTab ? pal.tabActive : CLEAR)
      .cursor_pointer()
      .hover((s) => s.bg(pal.collarHover).text_color(pal.titleActive))
      .font_family(MONO)
      .text_size(fSmall)
      .line_height(lhSmall)
      .when(activeTab, (el) => el.font_bold())
      .text_color(activeTab ? pal.tabActive : pal.tabInactive)
      .whitespace_nowrap()
      .tooltip(tbTip)
      .on_mouse_down("left", (_e, cx) => {
        cx.stop_propagation();
      })
      .on_click((_e, cx) => {
        cx.stop_propagation();
        if (handlers?.onTabClick) handlers.onTabClick(sp, tb, cx);
      })
      .when(Boolean(dotColor), (el) =>
        el.child(
          div()
            .font_family(MONO)
            .text_size(fTiny)
            .line_height(lhSmall)
            .font_bold()
            .text_color(dotColor)
            .whitespace_nowrap()
            .child("•")
        )
      )
      .child(label);
  });

  tabEls.push(
    div()
      .id(`orrery-tab-new-${sid}`)
      .px(Math.max(2, Math.round(4 * z)))
      .py(Math.max(0, Math.round(1 * z)))
      .bg(CLEAR)
      .border_b_1()
      .border_color(CLEAR)
      .cursor_pointer()
      .hover((s) => s.bg(pal.collarHover).text_color(pal.tabActive))
      .font_family(MONO)
      .text_size(fSmall)
      .line_height(lhSmall)
      .text_color(pal.tabAdd)
      .whitespace_nowrap()
      .tooltip(`New terminal in ${rawSpName}`)
      .on_mouse_down("left", (_e, cx) => {
        cx.stop_propagation();
      })
      .on_click((_e, cx) => {
        cx.stop_propagation();
        if (handlers?.onNewTab) handlers.onNewTab(sp, cx);
      })
      .child("+")
  );

  const collarHairline = hasBlocked ? pal.blocked : isActive ? pal.titleActive : pal.collarBorder;

  const collar = v_flex()
    .id(`orrery-collar-${sid}`)
    .absolute()
    .left(Math.round(pos.x - collarW / 2))
    .top(Math.round(pos.y + planetH / 2 + Math.round(8 * z)))
    .w(collarW)
    .overflow_hidden()
    .items_center()
    .gap(Math.max(1, Math.round(2 * z)))
    .pt(Math.max(2, Math.round(4 * z)))
    .pb(Math.max(1, Math.round(3 * z)))
    .px(Math.max(2, Math.round(6 * z)))
    .bg(pal.collarBg)
    .border_t_1()
    .border_color(collarHairline)
    .on_mouse_down("left", (_e, cx) => {
      cx.stop_propagation();
    })
    .on_mouse_down("right", (e, cx) => {
      cx.stop_propagation();
      handlers?.onSpaceRightClick?.(sp, e, cx);
    })
    .child(titleBtn)
    .when(z >= 0.42, (el) =>
      el.child(
        h_flex()
          .id(`orrery-tabs-${sid}`)
          .flex_wrap()
          .items_center()
          .justify_center()
          .gap(Math.max(2, Math.round(4 * z)))
          .bg(CLEAR)
          .children(tabEls)
      )
    );

  els.push(collar);

  return els;
}

// --- Layer 3: Continuously Orbiting Agent Spacecraft & Sub-Agent Probes ---

function renderAgentCraft(ag, orbitIdx, centerPos, isOpen, pal, handlers, z = 1.0) {
  const aid = sanitizeId(ag.address || `ag${orbitIdx}`);
  const status = ag.status || "idle";
  const name = cleanCallsign(ag);
  const elapsed = formatElapsedCompact(ag);

  const isBlocked = status === "blocked";
  const isWorking = status === "working";
  const isDone = status === "done";

  const mainColor = isBlocked ? pal.blockedHi : isWorking ? pal.workingHi : isDone ? pal.doneHi : pal.idleHi;
  const hullColor = isBlocked ? pal.blocked : isWorking ? pal.working : isDone ? pal.done : pal.idle;
  const hoverBg = isBlocked ? pal.blockedBg : isWorking ? pal.workingBg : isDone ? pal.doneBg : pal.idleBg;
  const spanBg = isBlocked ? pal.blockedBg : CLEAR;

  const fSprite = Math.max(4, Math.round(12 * z));
  const lhSprite = `${Math.max(5, Math.round(15 * z))}px`;
  const fSmall = Math.max(4, Math.round(SMALL_FONT * z));
  const lhSmall = `${Math.max(5, Math.round(14 * z))}px`;
  const fTiny = Math.max(4, Math.round(TINY_FONT * z));
  const lhTiny = `${Math.max(5, Math.round(13 * z))}px`;

  // Clean left-right symmetrical spacecraft sprites so orbital motion looks sleek both left & right
  let craftRows;
  if (isBlocked) {
    craftRows = [
      [
        {
          id: `orrery-ag-sos-${aid}`,
          frames: ["! SOS !", "!  *  !", "! SOS !", "!  +  !"],
          framesMs: 420,
          color: pal.blockedHi,
          bg: spanBg,
          bold: true,
        },
      ],
    ];
  } else if (isWorking) {
    craftRows = [
      [
        {
          id: `orrery-ag-hull-${aid}`,
          frames: ["<*>", "(*)", "<+>", "(*)"],
          framesMs: 320,
          color: pal.workingHi,
          bg: spanBg,
          bold: true,
        },
      ],
    ];
  } else if (isDone) {
    craftRows = [
      [
        { text: "<", color: pal.done, bg: spanBg },
        { text: "o", color: pal.doneHi, bg: spanBg, bold: true },
        { text: ">", color: pal.done, bg: spanBg },
      ],
    ];
  } else {
    craftRows = [
      [
        { text: "<", color: pal.idle, bg: spanBg },
        { text: "·", color: pal.idleHi, bg: spanBg },
        { text: ">", color: pal.idle, bg: spanBg },
      ],
    ];
  }

  const craftArt = renderSculpture(`orrery-ag-art-${aid}`, craftRows, {
    fontSize: fSprite,
    lineHeight: lhSprite,
    color: mainColor,
  });

  const labelRow = h_flex()
    .id(`orrery-ag-lbl-${aid}`)
    .items_center()
    .gap(Math.max(2, Math.round(4 * z)))
    .bg(CLEAR)
    .child(
      div()
        .font_family(MONO)
        .text_size(fSmall)
        .line_height(lhSmall)
        .font_bold()
        .text_color(mainColor)
        .whitespace_nowrap()
        .child(name)
    )
    .when(!isBlocked && Boolean(elapsed) && z >= 0.55, (el) =>
      el.child(
        div()
          .font_family(MONO)
          .text_size(fTiny)
          .line_height(lhTiny)
          .text_color(pal.muted)
          .whitespace_nowrap()
          .child(elapsed)
      )
    )
    .when(isOpen, (el) =>
      el.child(
        div()
          .font_family(MONO)
          .text_size(fSmall)
          .line_height(lhSmall)
          .font_bold()
          .text_color(pal.openTag)
          .whitespace_nowrap()
          .child("•")
      )
    );

  const tip =
    (handlers?.agentTooltip && handlers.agentTooltip(ag)) ||
    `${name} · ${status}${elapsed ? ` (${elapsed})` : ""} · click: open window · right-click: peek`;

  const cardInner = v_flex()
    .id(`orrery-ag-card-${aid}`)
    .items_center()
    .px(Math.max(2, Math.round(5 * z)))
    .py(Math.max(1, Math.round(2 * z)))
    .bg(isBlocked ? pal.blockedBg : CLEAR)
    .border_1()
    .border_color(isBlocked ? pal.blocked : CLEAR)
    .hover((s) => s.border_color(isBlocked ? pal.blocked : isOpen ? pal.openTag : hullColor).bg(hoverBg))
    .child(craftArt)
    .child(labelRow);

  const visual = isBlocked
    ? div()
        .id(`orrery-ag-pulse-${aid}`)
        .bg(CLEAR)
        .loop("opacity", { from: 0.40, to: 1.0, period: 650, easing: "ease-in-out" })
        .child(cardInner)
    : cardInner;

  const clickable = div()
    .id(`orrery-ag-hit-${aid}`)
    .bg(CLEAR)
    .cursor_pointer()
    .tooltip(tip)
    .on_mouse_down("left", (_e, cx) => {
      cx.stop_propagation();
    })
    .on_mouse_down("right", (_e, cx) => {
      cx.stop_propagation();
      if (handlers?.onAgentRightClick) handlers.onAgentRightClick(ag, cx);
    })
    .on_click((_e, cx) => {
      cx.stop_propagation();
      if (handlers?.onAgentClick) handlers.onAgentClick(ag, cx);
    })
    .child(visual);

  const tier = orbitIdx % 2;
  const scale = isBlocked ? 0.72 : 1.0 + tier * 0.24;
  const rx = Math.max(76, Math.round(centerPos.orbitRx * scale));
  const ry = Math.max(54, Math.round(centerPos.orbitRy * scale));

  // While zoomed out, position cleanly at scaled orbital radius (scales 1:1 with Space, ZERO loop jitter!)
  if (z < 0.99) {
    const angle = orbitIdx * 1.85 - 0.65;
    const ax = Math.round(centerPos.x + Math.cos(angle) * rx * z - Math.round(54 * z));
    const ay = Math.round(centerPos.y + Math.sin(angle) * ry * z - Math.round(18 * z));
    return div()
      .id(`orrery-ag-zoomed-${aid}`)
      .absolute()
      .left(ax)
      .top(ay)
      .bg(CLEAR)
      .child(clickable);
  }

  const dirX = orbitIdx % 2 === 0 ? 1 : -1;
  const dirY = orbitIdx % 3 === 0 ? 1 : -1;
  const periodX = isBlocked ? 22000 : 15800 + orbitIdx * 2900;
  const periodY = isBlocked ? 17200 : 11400 + orbitIdx * 2100;

  const yOrb = div()
    .id(`orrery-ag-orby-${aid}`)
    .relative()
    .bg(CLEAR)
    .loop("top", { from: -ry * dirY, to: ry * dirY, period: periodY, easing: "ease-in-out" })
    .child(clickable);

  const xOrb = div()
    .id(`orrery-ag-orbx-${aid}`)
    .relative()
    .bg(CLEAR)
    .loop("left", { from: -rx * dirX, to: rx * dirX, period: periodX, easing: "ease-in-out" })
    .child(yOrb);

  return div()
    .id(`orrery-ag-anchor-${aid}`)
    .absolute()
    .left(Math.round(centerPos.x - 54))
    .top(Math.round(centerPos.y - 18))
    .bg(CLEAR)
    .child(xOrb);
}

function renderSubAgentProbe(sub, subIdx, centerPos, pal, handlers, z = 1.0) {
  const sid = sanitizeId(sub.address || `sub${subIdx}`);
  const rawName = sub.program?.name || sub.app || sub.title || "probe";
  const shortLabel = String(rawName).trim().slice(0, 12) || "probe";
  const rx = Math.max(52, Math.round(centerPos.orbitRx * 0.62));
  const ry = Math.max(38, Math.round(centerPos.orbitRy * 0.62));
  const dirX = subIdx % 2 === 0 ? -1 : 1;
  const dirY = subIdx % 2 === 0 ? 1 : -1;
  const fTiny = Math.max(4, Math.round(TINY_FONT * z));
  const lhTiny = `${Math.max(5, Math.round(13 * z))}px`;

  const probeEl = h_flex()
    .id(`orrery-sub-hit-${sid}`)
    .items_center()
    .gap(Math.max(1, Math.round(3 * z)))
    .px(Math.max(1, Math.round(3 * z)))
    .bg(pal.canvas)
    .cursor_pointer()
    .tooltip(`sub-agent probe: ${shortLabel} · click to open`)
    .on_mouse_down("left", (_e, cx) => {
      cx.stop_propagation();
    })
    .on_mouse_down("right", (_e, cx) => {
      cx.stop_propagation();
    })
    .on_click((_e, cx) => {
      cx.stop_propagation();
      if (handlers?.onSubAgentClick) handlers.onSubAgentClick(sub, cx);
    })
    .child(
      div()
        .id(`orrery-sub-glyph-${sid}`)
        .font_family(MONO)
        .text_size(fTiny)
        .line_height(lhTiny)
        .text_color(pal.subProbe)
        .frames(["+", "o", "+"], 680)
    )
    .child(
      div()
        .font_family(MONO)
        .text_size(fTiny)
        .line_height(lhTiny)
        .text_color(pal.muted)
        .whitespace_nowrap()
        .child(shortLabel)
    );

  if (z < 0.99) {
    const angle = subIdx * 2.3 + 0.9;
    return div()
      .id(`orrery-sub-zoomed-${sid}`)
      .absolute()
      .left(Math.round(centerPos.x + Math.cos(angle) * rx * z - Math.round(24 * z)))
      .top(Math.round(centerPos.y + Math.sin(angle) * ry * z - Math.round(8 * z)))
      .bg(CLEAR)
      .child(probeEl);
  }

  const yOrb = div()
    .id(`orrery-sub-orby-${sid}`)
    .relative()
    .bg(CLEAR)
    .loop("top", { from: -ry * dirY, to: ry * dirY, period: 7100 + subIdx * 1300, easing: "ease-in-out" })
    .child(probeEl);

  const xOrb = div()
    .id(`orrery-sub-orbx-${sid}`)
    .relative()
    .bg(CLEAR)
    .loop("left", { from: -rx * dirX, to: rx * dirX, period: 9700 + subIdx * 1700, easing: "ease-in-out" })
    .child(yOrb);

  return div()
    .id(`orrery-sub-anchor-${sid}`)
    .absolute()
    .left(Math.round(centerPos.x - 24))
    .top(Math.round(centerPos.y - 8))
    .bg(CLEAR)
    .child(xOrb);
}

// --- Layer 4: Minimal Obsidian Field Notes in Space ---
// Sharp, atmospheric dark-obsidian note cards with a 2px void-indigo/teal/amber edge bar,
// crisp `◇`/`◆` header, and up to 3 readable dimmed preview lines — fits the deep-space
// cosmic-horror aesthetic with zero sticky-note cartoon chrome.

function extractNoteLines(note) {
  if (!note || typeof note !== "object") {
    return { title: "untitled", bodyLines: [], hasText: false, tooltipBody: "Empty note" };
  }
  const rawText = typeof note.text === "string" ? note.text : "";
  const cleaned = rawText
    .replace(/\r/g, "")
    .split("\n")
    .map((line) => line.replace(/^\s*(?:#+|>|[-*+]\s+\[[ xX]\]|[-*+])\s*/, "").trim())
    .filter((line) => line.length > 0);

  const explicitTitle = typeof note.title === "string" ? note.title.trim() : "";
  const title = cleaned[0] || explicitTitle || "untitled";
  const bodyLines = cleaned.slice(1, 4);
  const hasText = cleaned.length > 0 || explicitTitle.length > 0;
  const trimmed = rawText.trim();
  const tooltipBody = trimmed
    ? trimmed.length > 160
      ? `${trimmed.slice(0, 158)}..`
      : trimmed
    : "Empty note";

  return { title, bodyLines, hasText, tooltipBody };
}

function renderNoteObject(note, idx, fgX, fgY, pal, handlers, draggingNoteId = null, z = 1.0) {
  const nid = sanitizeId(note.id || `note${idx}`);
  const isOpen = Boolean(note.open);
  const isDragging = Boolean(draggingNoteId && note.id && draggingNoteId === note.id);
  const { title, bodyLines, hasText, tooltipBody } = extractNoteLines(note);

  const cardW = Math.max(64, 176 * z);
  const fTitle = Math.max(4, 11 * z);
  const lhTitle = `${Math.max(5.5, 15 * z).toFixed(2)}px`;
  const fBody = Math.max(3.5, 10 * z);
  const lhBody = `${Math.max(5, 14 * z).toFixed(2)}px`;
  const padX = Math.max(3, 9 * z);
  const padY = Math.max(2, 7 * z);

  const accentBar = isDragging
    ? pal.accent
    : isOpen
      ? pal.done
      : pal.voidRim;
  const borderCol = isDragging
    ? pal.accent
    : isOpen
      ? withAlpha(pal.done, "99")
      : withAlpha(pal.voidRim, "77");
  const bgCol = isDragging ? "#0f1628f2" : "#080c15e4";
  const titleCol = isDragging
    ? pal.titleActive
    : isOpen
      ? pal.doneHi
      : hasText
        ? pal.title
        : pal.dim;

  const tip = `${tooltipBody}\nclick: open · drag: move · right-click: menu`;

  let card = h_flex()
    .id(`orrery-note-card-${nid}`)
    .w(cardW)
    .bg(bgCol)
    .border_1()
    .border_color(borderCol)
    .overflow_hidden();

  if (!isDragging) {
    card = card.hover((s) =>
      s
        .bg("#0d1324f2")
        .border_color(isOpen ? pal.done : pal.accent)
    );
  }

  const content = v_flex()
    .flex_1()
    .min_w(0)
    .px(padX)
    .py(padY)
    .gap(Math.max(1, Math.round(3 * z)))
    .child(
      h_flex()
        .w_full()
        .gap(Math.max(2, Math.round(5 * z)))
        .items_center()
        .child(
          div()
            .flex_none()
            .font_family(MONO)
            .text_size(fBody)
            .line_height(lhTitle)
            .text_color(accentBar)
            .child(isOpen ? "◆" : "◇")
        )
        .child(
          div()
            .min_w(0)
            .font_family(MONO)
            .text_size(fTitle)
            .line_height(lhTitle)
            .when(hasText, (el) => el.font_bold())
            .text_color(titleCol)
            .truncate()
            .child(title)
        )
    )
    .when(bodyLines.length > 0 && z >= 0.45, (el) =>
      el.children(
        bodyLines.map((ln, bIdx) =>
          div()
            .id(`orrery-note-ln-${nid}-${bIdx}`)
            .w_full()
            .font_family(MONO)
            .text_size(fBody)
            .line_height(lhBody)
            .text_color(pal.muted)
            .truncate()
            .child(ln)
        )
      )
    );

  card = card
    .child(
      div()
        .flex_none()
        .w(2)
        .bg(accentBar)
    )
    .child(content);

  let hit = div()
    .id(`orrery-note-hit-${nid}`)
    .bg(CLEAR);

  hit = isDragging ? hit.cursor_grabbing() : hit.cursor_grab().tooltip(tip);

  hit = hit
    .on_mouse_down("left", (e, cx) => {
      cx.stop_propagation();
      handlers?.onNoteMouseDown?.(note, e, cx);
    })
    .on_mouse_down("right", (e, cx) => {
      cx.stop_propagation();
      handlers?.onNoteRightClick?.(note, e, cx);
    })
    .child(card);

  const nx = Math.round((Number(note.x) || 0) * z + fgX);
  const ny = Math.round((Number(note.y) || 0) * z + fgY);

  return div()
    .id(`orrery-note-anchor-${nid}`)
    .absolute()
    .left(nx)
    .top(ny)
    .bg(CLEAR)
    .child(hit);
}

// --- Layer 5: True-Scaling Live-Snapshot World Windows (Zero-Blink Backing & Zoomed Overview) ---
// Always rendered pixel-aligned behind live overlays AND smoothly scaled during zoom/pan so
// terminals NEVER flash blank — displaying real live `hc read` screen text scaled by `z`!

function renderWorldWindowCard(win, pal, fgX, fgY, z, handlers, isDragging = false, platform = "linux") {
  const key = `${win.kind}-${sanitizeId(win.id)}`;
  const useLiveRect = Boolean(win.isLiveMounted) && !isDragging && typeof win.liveX === "number";
  const sx = useLiveRect ? win.liveX : (win.wx || 0) * z + fgX;
  const sy = useLiveRect ? win.liveY : (win.wy || 0) * z + fgY;
  const sw = useLiveRect ? Math.max(84, win.liveW) : Math.max(84, (win.width || 600) * z);
  const sh = useLiveRect ? Math.max(54, win.liveH) : Math.max(54, (win.height || 400) * z);

  // Match `buildFramedWindowLayout` (`1px` border + `5px` edge handles + `30/28px` titlebar +
  // `orrery.json` `"terminal_padding": [12, 10]`) PIXEL FOR PIXEL scaled linearly by `z`!
  const edge = 5 * z;
  const titleH = (win.kind === "terminal" ? 30 : 28) * z;
  const padX = 10 * z;
  const padY = 12 * z;
  const innerW = Math.max(20, sw - 2 - edge * 2);
  const gridLeft = edge + padX;
  const gridTop = edge + titleH + padY;
  const gridW = Math.max(16, sw - 2 - 2 * (edge + padX));
  const gridH = Math.max(12, sh - 2 - gridTop - (edge + padY));

  const titleFont = Math.max(3.5, 11 * z);
  const titleLH = `${Math.max(5, 15 * z).toFixed(2)}px`;
  const subFont = Math.max(3.5, 10 * z);

  const isTerm = win.kind === "terminal";
  const isNote = win.kind === "note";
  const isBlocked = isTerm && win.status === "blocked";
  const isWorking = isTerm && win.status === "working";
  const isDone = isTerm && win.status === "done";
  const isZoomTyping = isTerm && Boolean(win.zoomInputFocused);
  const isFocused = Boolean(win.focused) || isZoomTyping;

  const statusCol = isBlocked
    ? pal.blocked
    : isWorking
      ? pal.working
      : isDone
        ? pal.done
        : isNote
          ? pal.done
          : isTerm
            ? pal.idle
            : pal.accent;

  const borderCol =
    isDragging || isZoomTyping
      ? pal.accent
      : isBlocked
        ? pal.blocked
        : isFocused
          ? pal.accent
          : isNote
            ? withAlpha(pal.done, "99")
            : withAlpha(pal.collarBorder, "EE");

  // Match real Herdr terminal obsidian background (`#070a12`) so live<->scaled handoff is seamless!
  const bodyBg = isDragging ? "#0b111ff6" : "#070a12f6";
  const titleBg = isFocused || isDragging ? "#090d17f8" : "#0b101cf2";
  const glyph = isTerm ? (isBlocked ? "!" : isWorking ? "*" : isDone ? "o" : "·") : win.glyph || "□";
  const scalePct = Math.round((win.scale || 1.0) * 100);
  const showScale = Math.abs(scalePct - 100) >= 3 && z >= 0.45;

  const modKey = platform === "macos" ? "cmd" : "ctrl";
  const tip = [
    win.title || "Window",
    win.subtitle || "",
    win.preview || "",
    isTerm
      ? `${z < 0.995 ? "click: zoom & interact" : "click: focus"} · drag: move in space · ${modKey}+scroll: scale · right-click: menu`
      : `${z < 0.995 ? "click: zoom & open" : "click: open"} · drag: move in space · ${modKey}+scroll: scale · right-click: menu`,
  ]
    .filter(Boolean)
    .join("\n");

  const titleBar = h_flex()
    .id(`orrery-wwin-bar-${key}`)
    .absolute()
    .left(edge)
    .top(edge)
    .w(innerW)
    .h(titleH)
    .px(Math.max(3, 10 * z))
    .gap(Math.max(2, 6 * z))
    .items_center()
    .justify_between()
    .bg(titleBg)
    .border_b_1()
    .border_color(withAlpha(borderCol, "AA"))
    .overflow_hidden()
    .child(
      h_flex()
        .flex_1()
        .min_w(0)
        .gap(Math.max(2, 5 * z))
        .items_center()
        .overflow_hidden()
        .child(
          div()
            .flex_none()
            .font_family(MONO)
            .text_size(titleFont)
            .line_height(titleLH)
            .font_bold()
            .text_color(statusCol)
            .child(glyph)
        )
        .when(Boolean(win.pinned), (el) =>
          el.child(
            div()
              .flex_none()
              .font_family(MONO)
              .text_size(subFont)
              .line_height(titleLH)
              .text_color(pal.accent)
              .child("★")
          )
        )
        .child(
          div()
            .min_w(0)
            .font_family(MONO)
            .text_size(titleFont)
            .line_height(titleLH)
            .font_bold()
            .text_color(isFocused || isDragging ? pal.titleActive : pal.title)
            .truncate()
            .child(win.title || "Window")
        )
        .when(z >= 0.42 && Boolean(win.subtitle), (el) =>
          el.child(
            div()
              .flex_none()
              .max_w(Math.max(48, 130 * z))
              .font_family(MONO)
              .text_size(subFont)
              .line_height(titleLH)
              .text_color(pal.branch)
              .truncate()
              .child(win.subtitle)
          )
        )
    )
    .when(isZoomTyping && z >= 0.40, (el) =>
      el.child(
        div()
          .flex_none()
          .px(Math.max(2, 4 * z))
          .bg(withAlpha(pal.accent, "2E"))
          .font_family(MONO)
          .text_size(subFont)
          .line_height(titleLH)
          .font_bold()
          .text_color(pal.accent)
          .whitespace_nowrap()
          .child("● TYPE")
      )
    )
    .when(showScale, (el) =>
      el.child(
        div()
          .flex_none()
          .px(Math.max(2, 4 * z))
          .bg(withAlpha(pal.accent, "22"))
          .font_family(MONO)
          .text_size(subFont)
          .line_height(titleLH)
          .text_color(pal.accent)
          .whitespace_nowrap()
          .child(`${scalePct}%`)
      )
    )
    .when(z >= 0.42, (el) =>
      el.child(
        h_flex()
          .flex_none()
          .gap(Math.max(4, 14 * z))
          .pr(Math.max(2, 4 * z))
          .items_center()
          .child(
            div()
              .font_family(MONO)
              .text_size(subFont)
              .line_height(titleLH)
              .text_color(pal.dim)
              .child("─")
          )
          .when(isTerm, (mEl) =>
            mEl.child(
              div()
                .font_family(MONO)
                .text_size(subFont)
                .line_height(titleLH)
                .text_color(pal.dim)
                .child("□")
            )
          )
          .child(
            div()
              .font_family(MONO)
              .text_size(subFont)
              .line_height(titleLH)
              .text_color(pal.dim)
              .child("×")
          )
      )
    );

  // Coherent, spatially-stable absolute cell-grid terminal renderer:
  // Uses exact PTY `(cols, rows)` and absolute row positioning `top = idx * rowH` so Taffy
  // flexbox NEVER shrinks/displaces lines, rows NEVER double-space, and width scales 1:1!
  const baseFont = Number(win.baseTermFont) || 14.0;
  const sourceLines =
    Array.isArray(win.screenLines) && win.screenLines.length > 0
      ? win.screenLines
      : Array.isArray(win.lines) && win.lines.length > 0
        ? win.lines
        : [win.meta || "live terminal"];

  let longestLine = 0;
  for (let i = 0; i < sourceLines.length; i++) {
    const ln = sourceLines[i];
    if (typeof ln === "string" && ln.length > longestLine) longestLine = ln.length;
  }
  const ptyRows = Math.max(1, Number(win.ptyRows) || sourceLines.length);
  const ptyCols = isTerm
    ? Math.max(20, Number(win.ptyCols) || longestLine || 80)
    : Math.max(32, Math.min(88, longestLine || 54));

  // Never stretch rowH taller than true scaled cell height (`baseFont * 1.295 * z`),
  // and fit all ptyRows cleanly within gridH.
  const naturalRowH = baseFont * 1.295 * z;
  const rowH = Math.min(naturalRowH, gridH / ptyRows);
  const cellW = gridW / ptyCols;
  // JetBrains Mono advance width is ~0.602 * fontSize in GPUI text layout
  const fontByW = cellW / 0.602;
  const fontByH = rowH / 1.295;
  const termFont = Math.max(2.0, Math.min(baseFont * z, fontByW, fontByH));
  const termLH = `${Math.max(2.6, rowH).toFixed(2)}px`;

  const rowNodes = [];
  for (let idx = 0; idx < sourceLines.length; idx++) {
    const rawLine = sourceLines[idx];
    if (typeof rawLine !== "string" || rawLine.length === 0 || rawLine.trim().length === 0) {
      continue; // Empty rows occupy exact `rowH` via absolute positioning — zero wasted divs!
    }
    const trimmed = rawLine.trimStart();
    const lineColor =
      trimmed.startsWith(">") || trimmed.startsWith("$") || trimmed.startsWith("❯")
        ? pal.titleActive
        : trimmed.startsWith("●") || trimmed.startsWith("◆") || trimmed.startsWith("✓")
          ? pal.branch
          : trimmed.startsWith("!") || trimmed.startsWith("ERROR") || trimmed.startsWith("error")
            ? pal.blockedHi
            : trimmed.startsWith("─") || trimmed.startsWith("│") || trimmed.startsWith("○")
              ? pal.muted
              : pal.title;
    rowNodes.push(
      div()
        .id(`orrery-wwin-ln-${key}-${idx}`)
        .absolute()
        .left(0)
        .top(idx * rowH)
        .w(gridW)
        .h(rowH)
        .font_family(MONO)
        .text_size(termFont)
        .line_height(termLH)
        .text_color(lineColor)
        .whitespace_nowrap()
        .overflow_hidden()
        .child(rawLine)
    );
  }

  const body = div()
    .id(`orrery-wwin-body-${key}`)
    .absolute()
    .left(gridLeft)
    .top(gridTop)
    .w(gridW)
    .h(gridH)
    .overflow_hidden()
    .bg(bodyBg)
    .children(rowNodes);

  let card = div()
    .id(`orrery-wwin-${key}`)
    .absolute()
    .left(sx)
    .top(sy)
    .w(sw)
    .h(sh)
    .bg(bodyBg)
    .border_1()
    .border_color(borderCol)
    .overflow_hidden();

  if (!isDragging) {
    card = card
      .cursor_grab()
      .tooltip(tip)
      .hover((st) => st.border_color(pal.accent));
  } else {
    card = card.cursor_grabbing();
  }

  return card
    .on_mouse_down("left", (e, cx) => {
      cx.stop_propagation();
      handlers?.onWorldWindowMouseDown?.(win, e, cx);
    })
    .on_mouse_down("right", (e, cx) => {
      cx.stop_propagation();
      handlers?.onWorldWindowRightClick?.(win, e, cx);
    })
    .on_scroll_wheel((e, cx) => {
      if (e?.modifiers?.control || e?.modifiers?.platform) {
        cx.stop_propagation();
        handlers?.onWorldWindowScale?.(win, e, cx);
      }
    })
    .child(titleBar)
    .child(body);
}

// --- Public Export: Full-Screen Living Deep-Space Cosmos ---

export function renderCosmos({
  vpW = 1440,
  vpH = 900,
  camX = 0,
  camY = 0,
  zoom = 1.0,
  isPanning = false,
  draggingNoteId = null,
  draggingWinKey = null,
  worldWindows = [],
  spaces = [],
  spacePositions = null,
  machinesList = [],
  agents = [],
  subAgents = [],
  notes = [],
  activeSpaceId = null,
  focusedTerminal = null,
  openWindowAddrs = null,
  gitBySpace = null,
  anomalies = null,
  theme = null,
  platform = "linux",
  handlers = {},
} = {}) {
  const width = Math.max(360, Math.round(Number(vpW) || 1440));
  const height = Math.max(260, Math.round(Number(vpH) || 900));
  const pal = resolvePalette(theme);
  const z = typeof zoom === "number" && Number.isFinite(zoom) ? Math.max(0.3, Math.min(1.0, zoom)) : 1.0;

  // ONE Unified World-Space Projection `(wx * z + fgX, wy * z + fgY)` across ALL layers
  // (stars, clusters, Singularity, Eyes, Tears, Tendrils, Wraiths, Planetoids, Agents, Notes, Windows)
  // so zooming around any cursor point scales the entire universe rigidly as ONE coherent space!
  const fgX = Number.isFinite(Number(camX)) ? Number(camX) : 0;
  const fgY = Number.isFinite(Number(camY)) ? Number(camY) : 0;

  const spaceList = Array.isArray(spaces) ? spaces.filter(Boolean) : [];
  const machineRecords = Array.isArray(machinesList) ? machinesList.filter(Boolean) : [];
  const agentList = Array.isArray(agents) ? agents.filter(Boolean) : [];
  const subList = Array.isArray(subAgents) ? subAgents.filter(Boolean) : [];
  const noteList = Array.isArray(notes) ? notes.filter(Boolean) : [];
  const worldWinList = Array.isArray(worldWindows) ? worldWindows.filter(Boolean) : [];

  // Reactive Cosmos Entropy: subtle ambient agitation when agents are blocked or working
  const blockedCount = agentList.filter((a) => a.status === "blocked").length;
  const workingCount = agentList.filter((a) => a.status === "working").length;
  const entropy = {
    hasBlocked: blockedCount > 0,
    isWorking: workingCount > 0,
    blockedCount,
    workingCount,
  };

  const resolvedActiveId = activeSpaceId || spaceList.find((s) => s.active)?.id || spaceList[0]?.id || null;
  const focusedAddr =
    typeof focusedTerminal === "string"
      ? focusedTerminal
      : focusedTerminal && typeof focusedTerminal === "object"
        ? focusedTerminal.address || null
        : null;

  // Compute foreground planetoid positions projected through exact float world-space camera
  const basePositions = computePlanetPositions(spaceList, width, height, spacePositions);
  const positions = basePositions.map((pos) => ({
    ...pos,
    x: pos.x * z + fgX,
    y: pos.y * z + fgY,
  }));
  const posBySpaceId = new Map();
  let activePos = null;

  for (let i = 0; i < spaceList.length; i++) {
    const sp = spaceList[i];
    const pos = positions[i];
    posBySpaceId.set(sp.id, pos);
    if (sp.id === resolvedActiveId) activePos = pos;
  }

  const focalCenter = activePos || positions[0] || {
    x: Math.round((width >= 1120 ? width * 0.21 : width * 0.50) * z + fgX),
    y: Math.round(height * 0.45 * z + fgY),
    orbitRx: 150,
    orbitRy: 100,
  };

  // Group agents by space (fallback to active space or first space)
  const agentsBySpace = new Map();
  const blockedSpaceIds = new Set();
  const agentPosByAddr = new Map();

  for (const ag of agentList) {
    const targetSpaceId = posBySpaceId.has(ag.space) ? ag.space : resolvedActiveId || spaceList[0]?.id || "__orphan__";
    if (!agentsBySpace.has(targetSpaceId)) agentsBySpace.set(targetSpaceId, []);
    agentsBySpace.get(targetSpaceId).push(ag);
    if (ag.status === "blocked") blockedSpaceIds.add(targetSpaceId);
    agentPosByAddr.set(ag.address, posBySpaceId.get(targetSpaceId) || focalCenter);
  }

  const children = [];

  // LAYER 0: Unified World-Space Starfield, Unstable "Wrong" Stars & Infinite Outer Tiles
  for (const el of renderDeepSpaceBackdrop(width, height, pal, fgX, fgY, z, entropy)) {
    children.push(el);
  }

  // LAYER 1: Unified World-Space Deep-Space Phenomena, Wandering Singularity & Cosmic Horrors
  for (const el of renderBinaryStarPair(width, height, pal, fgX, fgY, z)) {
    children.push(el);
  }
  const pulsarEl = renderPulsarBeacon(width, height, pal, fgX, fgY, z);
  if (pulsarEl) children.push(pulsarEl);
  for (const el of renderBlackHole(width, height, pal, fgX, fgY, z, entropy, anomalies?.singularity || null)) {
    children.push(el);
  }
  for (const el of renderDynamicAnomalies(anomalies?.events || [], pal, fgX, fgY, z, entropy, width, height)) {
    children.push(el);
  }
  for (const el of renderObeliskHalo(width, height, pal, fgX, fgY, z)) {
    children.push(el);
  }

  // LAYER 2 (1.00x * zoom): Foreground Orbital Plane — Multi-Machine Star-System Relays & Planetoids
  for (const el of renderMachineStarSystems(spaceList, basePositions, machineRecords, fgX, fgY, z, width, height, pal, handlers)) {
    children.push(el);
  }

  const planetCullPad = 260 * z + 180;
  if (spaceList.length === 0) {
    const ucW = Math.max(110, Math.round(240 * z));
    children.push(
      v_flex()
        .id("orrery-uncharted")
        .absolute()
        .left(Math.round(focalCenter.x - ucW / 2))
        .top(Math.round(focalCenter.y - 36 * z))
        .w(ucW)
        .items_center()
        .gap(Math.max(2, Math.round(4 * z)))
        .bg(pal.canvas)
        .child(
          div()
            .font_family(MONO)
            .text_size(Math.max(4, FONT_SIZE * z))
            .line_height(`${Math.max(5.5, 16 * z).toFixed(2)}px`)
            .text_color(pal.starMid)
            .child("·  +  ·")
        )
        .child(
          div()
            .font_family(MONO)
            .text_size(Math.max(4, SMALL_FONT * z))
            .line_height(`${Math.max(5.5, 14 * z).toFixed(2)}px`)
            .text_color(pal.muted)
            .child("no spaces yet · right-click to begin")
        )
    );
  } else {
    for (let i = 0; i < spaceList.length; i++) {
      const sp = spaceList[i];
      const pos = positions[i];
      if (
        pos.x < -planetCullPad ||
        pos.x > width + planetCullPad ||
        pos.y < -planetCullPad ||
        pos.y > height + planetCullPad
      ) {
        continue;
      }
      const gitInfo = lookupGitForSpace(gitBySpace, sp);
      const isActive = sp.id === resolvedActiveId;
      const hasBlocked = blockedSpaceIds.has(sp.id);

      const planetNodes = renderPlanetoid(sp, i, pos, {
        isActive,
        hasBlocked,
        spAgents: agentsBySpace.get(sp.id) || [],
        gitInfo,
        pal,
        handlers,
        singleSpace: spaceList.length === 1,
        z,
      });
      for (const node of planetNodes) children.push(node);
    }
  }

  // LAYER 3 (1.00x * zoom): Continuously Orbiting Agent Spacecraft & Sub-Agent Probes
  const orbitCullPad = 320 * z + 180;
  for (const [spId, spAgents] of agentsBySpace.entries()) {
    const centerPos = posBySpaceId.get(spId) || focalCenter;
    if (
      centerPos.x < -orbitCullPad ||
      centerPos.x > width + orbitCullPad ||
      centerPos.y < -orbitCullPad ||
      centerPos.y > height + orbitCullPad
    ) {
      continue;
    }
    for (let k = 0; k < spAgents.length; k++) {
      const ag = spAgents[k];
      const isOpen = isAddressOpen(openWindowAddrs, ag.address) || (focusedAddr && focusedAddr === ag.address);
      children.push(renderAgentCraft(ag, k, centerPos, Boolean(isOpen), pal, handlers, z));
    }
  }

  for (let s = 0; s < subList.length; s++) {
    const sub = subList[s];
    const centerPos =
      (sub.parent && agentPosByAddr.get(sub.parent)) ||
      (sub.space && posBySpaceId.get(sub.space)) ||
      focalCenter;
    if (
      centerPos.x < -orbitCullPad ||
      centerPos.x > width + orbitCullPad ||
      centerPos.y < -orbitCullPad ||
      centerPos.y > height + orbitCullPad
    ) {
      continue;
    }
    children.push(renderSubAgentProbe(sub, s, centerPos, pal, handlers, z));
  }

  // LAYER 4 (1.00x * zoom): Physical Floating Scratchpad Note Slates in Space
  const noteCullW = 220 * z + 60;
  const noteCullH = 140 * z + 60;
  for (let nIdx = 0; nIdx < noteList.length; nIdx++) {
    const note = noteList[nIdx];
    const isDragging = Boolean(draggingNoteId && note.id && draggingNoteId === note.id);
    const nx = (Number(note.x) || 0) * z + fgX;
    const ny = (Number(note.y) || 0) * z + fgY;
    if (!isDragging && (nx < -noteCullW || nx > width + 60 || ny < -noteCullH || ny > height + 60)) {
      continue;
    }
    children.push(renderNoteObject(note, nIdx, fgX, fgY, pal, handlers, draggingNoteId, z));
  }

  // LAYER 5 (1.00x * zoom): Scaled World-Space Window Objects (only when suspended/zoomed/dragging —
  // never duplicate a fake canvas card behind an already-live native overlay!)
  for (const winObj of worldWinList) {
    const wKey = `${winObj.kind}:${winObj.id}`;
    const isDragging = draggingWinKey === wKey;
    if (winObj.isLiveMounted && !isDragging) {
      continue;
    }
    const sx = (winObj.wx || 0) * z + fgX;
    const sy = (winObj.wy || 0) * z + fgY;
    const sw = Math.max(84, (winObj.width || 600) * z);
    const sh = Math.max(54, (winObj.height || 400) * z);
    if (!isDragging && (sx + sw < -40 || sx > width + 40 || sy + sh < -40 || sy > height + 40)) {
      continue;
    }
    children.push(
      renderWorldWindowCard(winObj, pal, fgX, fgY, z, handlers, isDragging, platform)
    );
  }

  const canvas = div()
    .id("orrery-cosmos-canvas")
    .relative()
    .size_full()
    .overflow_hidden()
    .bg(pal.canvas);

  return (isPanning ? canvas.cursor_grabbing() : canvas.cursor_grab())
    .on_mouse_down("left", (e, cx) => {
      if (handlers?.onPanStart) handlers.onPanStart(e, cx);
    })
    .on_mouse_move((e, cx) => {
      if (handlers?.onPanMove) handlers.onPanMove(e, cx);
    })
    .on_mouse_up("left", (e, cx) => {
      if (handlers?.onPanEnd) handlers.onPanEnd(e, cx);
    })
    .on_mouse_down("right", (e, cx) => {
      if (handlers?.onDesktopRightClick) handlers.onDesktopRightClick(e, cx);
    })
    .on_scroll_wheel((e, cx) => {
      if (handlers?.onWheel) handlers.onWheel(e, cx);
    })
    .on_click((e, cx) => {
      if (handlers?.onDesktopClick) handlers.onDesktopClick(e, cx);
    })
    .children(children);
}
