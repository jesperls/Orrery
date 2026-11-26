// Dynamic Cosmic-Horror Event Director for Orrery.
// Every anomaly (Void Eyes, Spacetime Tears, Creeping Tendrils, Passing Wraiths,
// Corrupted Stars) and the slowly wandering Singularity live in PURE WORLD SPACE
// (identical to planetoids, notes, and windows) with smooth world-space interpolation
// computed per tick — guaranteeing 100% spatially rigid scaling & zero jump under zoom.

function randRange(min, max) {
  return min + Math.random() * (max - min);
}

function randInt(min, max) {
  return Math.floor(randRange(min, max + 1));
}

function clamp01(t) {
  return t <= 0 ? 0 : t >= 1 ? 1 : t;
}

function easeInOut(t) {
  const c = clamp01(t);
  return c < 0.5 ? 2 * c * c : 1 - Math.pow(-2 * c + 2, 2) / 2;
}

function pickWeighted(entries) {
  let total = 0;
  for (const e of entries) total += Math.max(0, e.weight);
  if (total <= 0) return entries[0]?.value;
  let r = Math.random() * total;
  for (const e of entries) {
    r -= Math.max(0, e.weight);
    if (r <= 0) return e.value;
  }
  return entries[entries.length - 1]?.value;
}

// Check distance from candidate point (pure world coords) to any foreground planetoid center.
function isClearOfPlanets(wx, wy, planetCenters, minClearance) {
  for (const p of planetCenters) {
    const rx = (p.orbitRx || 140) * 0.55;
    if (Math.hypot(wx - p.x, wy - p.y) < minClearance + rx * 0.45) {
      return false;
    }
  }
  return true;
}

function computeWorldBounds(vpW, vpH) {
  const w = Math.max(640, Math.round(vpW || 1440));
  const h = Math.max(420, Math.round(vpH || 900));
  const halfSpanX = Math.round(Math.max(w * 2.8, (w / 0.30) * 0.85));
  const halfSpanY = Math.round(Math.max(h * 2.8, (h / 0.30) * 0.85));
  return {
    minX: Math.round(w * 0.5 - halfSpanX),
    maxX: Math.round(w * 0.5 + halfSpanX),
    minY: Math.round(h * 0.5 - halfSpanY),
    maxY: Math.round(h * 0.5 + halfSpanY),
  };
}

// Pick an open point in PURE WORLD COORDS inside the currently visible viewport.
function pickOpenSpot({
  vpW,
  vpH,
  camX,
  camY,
  z = 1.0,
  planetCenters,
  activeEvents,
  marginX = 110,
  marginTop = 70,
  marginBottom = 95,
  clearance = 175,
}) {
  const invZ = 1 / Math.max(0.25, z);
  const b = computeWorldBounds(vpW, vpH);
  const worldLeft = -camX * invZ;
  const worldTop = -camY * invZ;
  const worldW = vpW * invZ;
  const worldH = vpH * invZ;

  const padX = Math.max(marginX, 40) * invZ;
  const padTop = Math.max(marginTop, 40) * invZ;
  const padBot = Math.max(marginBottom, 40) * invZ;

  const minX = Math.max(b.minX + 120, worldLeft + padX);
  const maxX = Math.max(minX + 60, Math.min(b.maxX - 120, worldLeft + worldW - padX));
  const minY = Math.max(b.minY + 100, worldTop + padTop);
  const maxY = Math.max(minY + 60, Math.min(b.maxY - 100, worldTop + worldH - padBot));

  let best = null;
  let bestScore = -1;

  for (let attempt = 0; attempt < 26; attempt++) {
    const x = Math.round(randRange(minX, maxX));
    const y = Math.round(randRange(minY, maxY));

    const sx = x * z + camX;
    const sy = y * z + camY;
    // Stay clear of bottom-left `≡` corner and bottom-right whisper HUD
    if (sx < 110 && sy > vpH - 120) continue;
    if (sx > vpW - 260 && sy > vpH - 80) continue;

    let minDist = 9999;
    for (const p of planetCenters) {
      const d = Math.hypot(x - p.x, y - p.y);
      if (d < minDist) minDist = d;
    }
    for (const ev of activeEvents) {
      if (ev.kind === "starburst") continue;
      const d = Math.hypot(x - (ev.curX ?? ev.x), y - (ev.curY ?? ev.y));
      if (d < minDist * 0.9) minDist = d;
    }

    if (isClearOfPlanets(x, y, planetCenters, clearance) && minDist >= 150) {
      return { x, y };
    }

    if (minDist > bestScore) {
      bestScore = minDist;
      best = { x, y };
    }
  }

  return (
    best || {
      x: Math.round(randRange(minX, maxX)),
      y: Math.round(randRange(minY, maxY)),
    }
  );
}

// Pick an outer-sky waypoint in PURE WORLD COORDS for the slow wandering Singularity.
function pickSingularityWaypoint({ vpW, vpH, camX, camY, z = 1.0, planetCenters, prev }) {
  const sectors = [
    { fx: 0.78, fy: 0.22 },
    { fx: 0.84, fy: 0.68 },
    { fx: 0.56, fy: 0.16 },
    { fx: 0.62, fy: 0.76 },
    { fx: 0.42, fy: 0.20 },
    { fx: 0.86, fy: 0.40 },
    { fx: 0.46, fy: 0.78 },
  ];

  const invZ = 1 / Math.max(0.25, z);
  const worldLeft = -camX * invZ;
  const worldTop = -camY * invZ;
  const worldW = vpW * invZ;
  const worldH = vpH * invZ;

  let best = null;
  let bestScore = -1;

  for (let attempt = 0; attempt < 18; attempt++) {
    const s = sectors[randInt(0, sectors.length - 1)];
    const jitterX = randRange(-worldW * 0.06, worldW * 0.06);
    const jitterY = randRange(-worldH * 0.06, worldH * 0.06);
    const x = Math.round(
      Math.max(worldLeft + 130 * invZ, Math.min(worldLeft + worldW - 150 * invZ, worldLeft + worldW * s.fx + jitterX))
    );
    const y = Math.round(
      Math.max(worldTop + 95 * invZ, Math.min(worldTop + worldH - 125 * invZ, worldTop + worldH * s.fy + jitterY))
    );

    const moved = prev ? Math.hypot(x - prev.x, y - prev.y) : 300;
    if (moved < 180) continue;

    let minPlanet = 9999;
    for (const p of planetCenters) {
      const d = Math.hypot(x - p.x, y - p.y);
      if (d < minPlanet) minPlanet = d;
    }

    if (minPlanet >= 190) {
      return { x, y };
    }
    if (minPlanet > bestScore) {
      bestScore = minPlanet;
      best = { x, y };
    }
  }

  return best || { x: Math.round(worldLeft + worldW * 0.76), y: Math.round(worldTop + worldH * 0.22) };
}

export function createCosmicDirector() {
  let seq = 1;
  let lastMajorKind = "";
  const events = [];

  const now0 = Date.now();
  let nextMajorAt = now0 + randInt(1100, 1900); // First anomaly appears shortly after load
  let nextStarAt = now0 + randInt(2800, 5600);

  // Wandering Singularity state in pure world coordinates
  let singularity = null;
  let nextBhMoveAt = now0 + randInt(14000, 22000);

  function spawnEvent(kind, now, ctx) {
    const { vpW, vpH, camX, camY, z = 1.0, planetCenters, hasBlocked } = ctx;
    const invZ = 1 / Math.max(0.25, z);
    const worldLeft = -camX * invZ;
    const worldTop = -camY * invZ;
    const worldW = vpW * invZ;
    const worldH = vpH * invZ;
    const id = seq++;

    if (kind === "eye") {
      const spot = pickOpenSpot({
        vpW,
        vpH,
        camX,
        camY,
        z,
        planetCenters,
        activeEvents: events,
        marginX: 150,
        marginTop: 95,
        marginBottom: 120,
        clearance: 185,
      });

      const screenX = spot.x * z + camX;
      const screenY = spot.y * z + camY;
      const dirX = screenX > vpW * 0.62 ? -1 : screenX < vpW * 0.35 ? 1 : Math.random() < 0.5 ? 1 : -1;
      const dirY = screenY > vpH * 0.60 ? -1 : screenY < vpH * 0.35 ? 1 : Math.random() < 0.5 ? 1 : -1;
      const dx = Math.round(dirX * randRange(140, 280));
      const dy = Math.round(dirY * randRange(50, 130));

      const variant = Math.random() < 0.66 ? 0 : 1; // 0 = full Void Eye, 1 = narrow Slit Watcher
      const fadeInMs = hasBlocked ? 950 : 1350;
      const holdMs = randInt(hasBlocked ? 6500 : 8000, hasBlocked ? 10500 : 13000);
      const fadeOutMs = 1550;
      const totalMs = 160 + holdMs + fadeOutMs;

      events.push({
        id,
        kind: "eye",
        variant,
        x: spot.x,
        y: spot.y,
        curX: spot.x,
        curY: spot.y,
        dx,
        dy,
        phase: "spawn",
        spawnedAt: now,
        activeAt: now + 160,
        exitAt: now + 160 + holdMs,
        endsAt: now + totalMs,
        fadeInMs,
        moveMs: holdMs + fadeOutMs,
        fadeOutMs,
        peakOpacity: hasBlocked ? 0.94 : 0.86,
      });
      return;
    }

    if (kind === "tear") {
      const spot = pickOpenSpot({
        vpW,
        vpH,
        camX,
        camY,
        z,
        planetCenters,
        activeEvents: events,
        marginX: 100,
        marginTop: 75,
        marginBottom: 100,
        clearance: 165,
      });

      const variant = randInt(0, 2); // 0 = vertical fissure, 1 = diagonal slash, 2 = diamond rupture
      const dx = Math.round(randRange(-24, 24));
      const dy = Math.round(randRange(-16, 16));
      const fadeInMs = 340;
      const holdMs = randInt(hasBlocked ? 4200 : 3800, hasBlocked ? 7400 : 6800);
      const fadeOutMs = 920;

      events.push({
        id,
        kind: "tear",
        variant,
        x: spot.x,
        y: spot.y,
        curX: spot.x,
        curY: spot.y,
        dx,
        dy,
        phase: "spawn",
        spawnedAt: now,
        activeAt: now + 160,
        exitAt: now + 160 + holdMs,
        endsAt: now + 160 + holdMs + fadeOutMs,
        fadeInMs,
        moveMs: holdMs + fadeOutMs,
        fadeOutMs,
        peakOpacity: hasBlocked ? 0.98 : 0.92,
      });
      return;
    }

    if (kind === "tendril") {
      const edges = ["left", "right", "bottom", "top"];
      const edge = edges[randInt(0, edges.length - 1)];
      let x = 0;
      let y = 0;
      let dx = 0;
      let dy = 0;

      if (edge === "left") {
        x = Math.round(worldLeft - 110);
        y = Math.round(worldTop + randRange(worldH * 0.14, worldH * 0.72));
        dx = randInt(108, 148);
        dy = randInt(-18, 18);
      } else if (edge === "right") {
        x = Math.round(worldLeft + worldW + 20);
        y = Math.round(worldTop + randRange(worldH * 0.14, worldH * 0.74));
        dx = -randInt(115, 155);
        dy = randInt(-18, 18);
      } else if (edge === "bottom") {
        x = Math.round(worldLeft + randRange(worldW * 0.18, worldW * 0.86));
        y = Math.round(worldTop + worldH + 18);
        dx = randInt(-20, 20);
        dy = -randInt(98, 132);
      } else {
        x = Math.round(worldLeft + randRange(worldW * 0.14, worldW * 0.86));
        y = Math.round(worldTop - 105);
        dx = randInt(-20, 20);
        dy = randInt(96, 128);
      }

      const fadeInMs = 2200;
      const holdMs = randInt(5800, 9400);
      const fadeOutMs = 2300;

      events.push({
        id,
        kind: "tendril",
        variant: edge,
        x,
        y,
        curX: x,
        curY: y,
        dx,
        dy,
        phase: "spawn",
        spawnedAt: now,
        activeAt: now + 160,
        exitAt: now + 160 + holdMs,
        endsAt: now + 160 + holdMs + fadeOutMs,
        fadeInMs,
        moveMs: 2400, // Smooth creep in; retracts on exit
        fadeOutMs,
        peakOpacity: hasBlocked ? 0.92 : 0.84,
      });
      return;
    }

    if (kind === "wraith") {
      const fromLeft = Math.random() < 0.5;
      const startX = fromLeft
        ? worldLeft + randRange(worldW * 0.08, worldW * 0.34)
        : worldLeft + randRange(worldW * 0.66, worldW * 0.92);
      const startY = worldTop + randRange(worldH * 0.12, worldH * 0.76);
      const travelX = (fromLeft ? 1 : -1) * randRange(320, 540);
      const travelY = randRange(-110, 110);

      const variant = Math.random() < 0.5 ? 0 : 1; // 0 = hollow geometric halo, 1 = drifting dark void-ribbon
      const fadeInMs = 2100;
      const holdMs = randInt(8500, 12500);
      const fadeOutMs = 2400;

      const rx = Math.round(startX);
      const ry = Math.round(startY);
      events.push({
        id,
        kind: "wraith",
        variant,
        x: rx,
        y: ry,
        curX: rx,
        curY: ry,
        dx: Math.round(travelX),
        dy: Math.round(travelY),
        phase: "spawn",
        spawnedAt: now,
        activeAt: now + 160,
        exitAt: now + 160 + holdMs,
        endsAt: now + 160 + holdMs + fadeOutMs,
        fadeInMs,
        moveMs: holdMs + fadeOutMs,
        fadeOutMs,
        peakOpacity: hasBlocked ? 0.72 : 0.56,
      });
      return;
    }

    if (kind === "starburst") {
      const spot = pickOpenSpot({
        vpW,
        vpH,
        camX,
        camY,
        z,
        planetCenters,
        activeEvents: events,
        marginX: 60,
        marginTop: 50,
        marginBottom: 70,
        clearance: 130,
      });
      const holdMs = randInt(2400, 4400);
      const fadeOutMs = 600;
      events.push({
        id,
        kind: "starburst",
        variant: randInt(0, 2),
        x: spot.x,
        y: spot.y,
        curX: spot.x,
        curY: spot.y,
        dx: 0,
        dy: 0,
        phase: "spawn",
        spawnedAt: now,
        activeAt: now + 140,
        exitAt: now + 140 + holdMs,
        endsAt: now + 140 + holdMs + fadeOutMs,
        fadeInMs: 260,
        moveMs: holdMs,
        fadeOutMs,
        peakOpacity: 0.92,
      });
    }
  }

  function tick(now, { vpW = 1440, vpH = 900, camX = 0, camY = 0, zoom = 1.0, planetCenters = [], hasBlocked = false } = {}) {
    let changed = false;
    const z = typeof zoom === "number" && zoom > 0 ? zoom : 1.0;

    // 1. Initialize or smoothly advance the wandering Singularity in pure world coords
    if (!singularity) {
      const safeW = Math.max(640, vpW || 1440);
      const safeH = Math.max(420, vpH || 900);
      const startX = Math.round(safeW * 0.76);
      const startY = Math.round(safeH * 0.22);
      singularity = {
        fromX: startX,
        fromY: startY,
        toX: startX,
        toY: startY,
        curX: startX,
        curY: startY,
        startedAt: now,
        moveMs: 22000,
      };
      changed = true;
    } else {
      const t = clamp01((now - singularity.startedAt) / Math.max(1, singularity.moveMs));
      const e = easeInOut(t);
      const nx = singularity.fromX + (singularity.toX - singularity.fromX) * e;
      const ny = singularity.fromY + (singularity.toY - singularity.fromY) * e;
      if (Math.hypot(nx - singularity.curX, ny - singularity.curY) >= 0.35) {
        singularity.curX = nx;
        singularity.curY = ny;
        changed = true;
      }

      if (now >= nextBhMoveAt) {
        const target = pickSingularityWaypoint({
          vpW,
          vpH,
          camX,
          camY,
          z,
          planetCenters,
          prev: { x: singularity.curX, y: singularity.curY },
        });
        singularity = {
          fromX: singularity.curX,
          fromY: singularity.curY,
          toX: target.x,
          toY: target.y,
          curX: singularity.curX,
          curY: singularity.curY,
          startedAt: now,
          moveMs: hasBlocked ? 15000 : randInt(20000, 28000),
        };
        nextBhMoveAt = now + randInt(hasBlocked ? 20000 : 28000, hasBlocked ? 30000 : 42000);
        changed = true;
      }
    }

    // 2. Advance existing event lifecycles, world-space drift & prune finished anomalies
    for (let i = events.length - 1; i >= 0; i--) {
      const ev = events[i];
      if (now >= ev.endsAt) {
        events.splice(i, 1);
        changed = true;
        continue;
      }
      if (ev.phase === "spawn" && now >= ev.activeAt) {
        ev.phase = "active";
        changed = true;
      } else if (ev.phase === "active" && now >= ev.exitAt) {
        ev.phase = "exit";
        changed = true;
      }

      if (ev.dx || ev.dy) {
        let p = 0;
        if (ev.kind === "tendril") {
          if (ev.phase === "exit") {
            p = 1 - easeInOut((now - ev.exitAt) / Math.max(1, ev.fadeOutMs));
          } else if (now > ev.activeAt) {
            p = easeInOut((now - ev.activeAt) / Math.max(1, ev.moveMs));
          }
        } else if (now > ev.activeAt) {
          const raw = clamp01((now - ev.activeAt) / Math.max(1, ev.moveMs));
          p = ev.kind === "wraith" || ev.kind === "tear" ? raw : easeInOut(raw);
        }
        const nx = ev.x + (ev.dx || 0) * p;
        const ny = ev.y + (ev.dy || 0) * p;
        if (Math.hypot(nx - (ev.curX ?? ev.x), ny - (ev.curY ?? ev.y)) >= 0.35) {
          ev.curX = nx;
          ev.curY = ny;
          changed = true;
        }
      }
    }

    // 3. Spawn major cosmic-horror anomalies (Eye, Tear, Tendril, Wraith) unpredictably
    const majorActive = events.filter((e) => e.kind !== "starburst");
    const maxMajor = hasBlocked ? 3 : 2;
    if (now >= nextMajorAt) {
      if (majorActive.length < maxMajor) {
        const activeKinds = new Set(majorActive.map((e) => e.kind));
        const pool = [
          { value: "tear", weight: activeKinds.has("tear") ? 0 : lastMajorKind === "tear" ? 1.4 : 3.4 },
          { value: "eye", weight: activeKinds.has("eye") ? 0 : lastMajorKind === "eye" ? 1.0 : 2.8 },
          { value: "tendril", weight: activeKinds.has("tendril") ? 0 : lastMajorKind === "tendril" ? 1.1 : 2.5 },
          { value: "wraith", weight: activeKinds.has("wraith") ? 0 : lastMajorKind === "wraith" ? 0.8 : 2.1 },
        ].filter((item) => item.weight > 0);

        if (pool.length > 0) {
          const chosen = pickWeighted(pool);
          lastMajorKind = chosen;
          spawnEvent(chosen, now, { vpW, vpH, camX, camY, z, planetCenters, hasBlocked });
          changed = true;
        }
      }
      nextMajorAt = now + randInt(hasBlocked ? 3200 : 5200, hasBlocked ? 7200 : 12200);
    }

    // 4. Spawn subtle spontaneous corrupted star bursts in random spots
    const starActive = events.filter((e) => e.kind === "starburst");
    if (now >= nextStarAt) {
      if (starActive.length < (hasBlocked ? 2 : 1)) {
        spawnEvent("starburst", now, { vpW, vpH, camX, camY, z, planetCenters, hasBlocked });
        changed = true;
      }
      nextStarAt = now + randInt(hasBlocked ? 3000 : 4800, hasBlocked ? 6500 : 10800);
    }

    return changed;
  }

  function getState() {
    return {
      singularity: singularity ? { ...singularity } : null,
      events: events.map((ev) => ({ ...ev })),
    };
  }

  return {
    tick,
    getState,
  };
}
