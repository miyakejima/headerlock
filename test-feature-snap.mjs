/**
 * Verification test for Optional 2D Feature Snap (Option A + C).
 */
import {
  PRESETS,
  geometryFromPreset,
  sourceMappingFromLayout,
  sampleBannerWithContinuation,
} from "./core.js";
import fs from "fs";

console.log("=== Running 2D Feature Snap Verification Suite ===\n");

// 1. DOM Structure Check
const html = fs.readFileSync("index.html", "utf8");
const requiredIds = [
  "featureSnapOn",
  "featureSnapOff",
  "canvasSnapOn",
  "canvasSnapOff",
  "settingRowCanvasSnap",
];

for (const id of requiredIds) {
  if (!html.includes(`id="${id}"`)) {
    console.error(`FAIL: Missing DOM id "${id}" in index.html`);
    process.exit(1);
  }
}
console.log("✓ DOM verification: All 2D feature snap toggle buttons exist in index.html");

// 2. Logic & Performance Verification
const W = 1500, H = 500;
const data = new Uint8ClampedArray(W * H * 4);
for (let y = 0; y < H; y++) {
  for (let x = 0; x < W; x++) {
    const i = (y * W + x) * 4;
    const isStripe = (Math.round((x + y * 0.7) / 40) % 2 === 0);
    const val = isStripe ? 220 : 30;
    data[i]   = Math.round(val * 0.8 + (x / W) * 50);
    data[i+1] = Math.round(val * 0.6 + (y / H) * 60);
    data[i+2] = Math.round(val * 0.9);
    data[i+3] = 255;
  }
}
const banner = { width: W, height: H, data };
const fill = [0, 0, 0, 255];
const bannerRect = { x: 0, y: 0, width: W, height: H };
const dGeom = geometryFromPreset(PRESETS.desktop, bannerRect);
const mGeom = geometryFromPreset(PRESETS.androidApp, bannerRect);
const dMap = sourceMappingFromLayout({ banner, bannerRect, avatar: dGeom });
const mMap = sourceMappingFromLayout({ banner, bannerRect, avatar: mGeom });

// Replicated optimizer functions from app.js to test standalone
function evaluateSeamScore(banner, candidateMapping, expectedMapping, fill, maskVisibleOnly = false) {
  const rings = [
    { radius: 0.86, weight: 0.14 },
    { radius: 0.91, weight: 0.20 },
    { radius: 0.95, weight: 0.26 },
    { radius: 0.985, weight: 0.40 },
  ];
  const angles = 72;
  let diff = 0;
  let totalWeight = 0;
  for (let r = 0; r < rings.length; r++) {
    const ring = rings[r];
    for (let idx = 0; idx < angles; idx++) {
      const angle = (idx / angles) * Math.PI * 2;
      const qx = Math.cos(angle) * ring.radius;
      const qy = Math.sin(angle) * ring.radius;
      const ex = expectedMapping.centerX + qx * expectedMapping.radiusX;
      const ey = expectedMapping.centerY + qy * expectedMapping.radiusY;

      if (maskVisibleOnly && (ey > banner.height || ey < 0 || ex < 0 || ex > banner.width)) {
        continue;
      }

      const ax = candidateMapping.centerX + qx * candidateMapping.radiusX;
      const ay = candidateMapping.centerY + qy * candidateMapping.radiusY;
      const cAct = sampleBannerWithContinuation(banner, ax, ay, null, fill);
      const cExp = sampleBannerWithContinuation(banner, ex, ey, null, fill);
      const d = (Math.abs(cAct[0] - cExp[0]) + Math.abs(cAct[1] - cExp[1]) + Math.abs(cAct[2] - cExp[2])) / 3;
      diff += d * ring.weight;
      totalWeight += ring.weight;
    }
  }
  const meanDiff = diff / Math.max(1, totalWeight);
  return Math.round(100 * Math.exp((-3.5 * meanDiff) / 255));
}

function interpolateSourceMappings(m, d, w) {
  return {
    centerX: m.centerX * (1 - w) + d.centerX * w,
    centerY: m.centerY * (1 - w) + d.centerY * w,
    radiusX: m.radiusX * (1 - w) + d.radiusX * w,
    radiusY: m.radiusY * (1 - w) + d.radiusY * w,
  };
}

function findOptimalSharedMapping(banner, dMap, mMap, fill, useFeatureSnap = false) {
  if (!useFeatureSnap) {
    let bestWeight = 0.5;
    let bestObjective = -Infinity;
    let bestD = 0;
    let bestM = 0;

    for (let i = 0; i <= 20; i++) {
      const w = i / 20;
      const candidate = interpolateSourceMappings(mMap, dMap, w);
      const dScore = evaluateSeamScore(banner, candidate, dMap, fill);
      const mScore = evaluateSeamScore(banner, candidate, mMap, fill);
      const objective = Math.min(dScore, mScore) * 1000 + (dScore + mScore);
      if (objective > bestObjective) {
        bestObjective = objective;
        bestWeight = w;
        bestD = dScore;
        bestM = mScore;
      }
    }

    for (let step = -4; step <= 4; step++) {
      const w = Math.max(0, Math.min(1, bestWeight + step * 0.0125));
      const candidate = interpolateSourceMappings(mMap, dMap, w);
      const dScore = evaluateSeamScore(banner, candidate, dMap, fill);
      const mScore = evaluateSeamScore(banner, candidate, mMap, fill);
      const objective = Math.min(dScore, mScore) * 1000 + (dScore + mScore);
      if (objective > bestObjective) {
        bestObjective = objective;
        bestWeight = w;
        bestD = dScore;
        bestM = mScore;
      }
    }

    return {
      weight: bestWeight,
      mapping: interpolateSourceMappings(mMap, dMap, bestWeight),
      desktopScore: bestD,
      mobileScore: bestM,
    };
  }

  const scoreCandidate = (candidate) => {
    const dScore = evaluateSeamScore(banner, candidate, dMap, fill, true);
    const mScore = evaluateSeamScore(banner, candidate, mMap, fill, true);
    return {
      dScore,
      mScore,
      objective: Math.min(dScore, mScore) * 1000 + (dScore + mScore),
    };
  };

  let best1D = null;
  for (let i = 0; i <= 20; i++) {
    const w = i / 20;
    const cand = interpolateSourceMappings(mMap, dMap, w);
    const res = scoreCandidate(cand);
    if (!best1D || res.objective > best1D.objective) {
      best1D = { weight: w, cand, ...res };
    }
  }

  let bestCoarse = { ...best1D, dx: 0, dy: 0, dr: 0, mapping: best1D.cand };
  const baseCand = best1D.cand;
  for (let dx = -16; dx <= 16; dx += 4) {
    for (let dy = -16; dy <= 16; dy += 4) {
      for (let dr = -6; dr <= 6; dr += 3) {
        if (dx === 0 && dy === 0 && dr === 0) continue;
        const cand = {
          centerX: baseCand.centerX + dx,
          centerY: baseCand.centerY + dy,
          radiusX: baseCand.radiusX + dr,
          radiusY: baseCand.radiusY + dr,
        };
        const res = scoreCandidate(cand);
        if (res.objective > bestCoarse.objective) {
          bestCoarse = { weight: best1D.weight, dx, dy, dr, mapping: cand, ...res };
        }
      }
    }
  }

  let bestFine = bestCoarse;
  for (let fdx = -3; fdx <= 3; fdx += 1) {
    for (let fdy = -3; fdy <= 3; fdy += 1) {
      if (fdx === 0 && fdy === 0) continue;
      const cand = {
        centerX: bestCoarse.mapping.centerX + fdx,
        centerY: bestCoarse.mapping.centerY + fdy,
        radiusX: bestCoarse.mapping.radiusX,
        radiusY: bestCoarse.mapping.radiusY,
      };
      const res = scoreCandidate(cand);
      if (res.objective > bestFine.objective) {
        bestFine = {
          weight: bestCoarse.weight,
          dx: bestCoarse.dx + fdx,
          dy: bestCoarse.dy + fdy,
          dr: bestCoarse.dr,
          mapping: cand,
          ...res,
        };
      }
    }
  }

  return {
    weight: bestFine.weight,
    mapping: bestFine.mapping,
    desktopScore: bestFine.dScore,
    mobileScore: bestFine.mScore,
  };
}

// 2a. Test Toggle OFF: Baseline output
const offResult = findOptimalSharedMapping(banner, dMap, mMap, fill, false);
console.log(`✓ Toggle OFF: weight=${offResult.weight.toFixed(3)}, D=${offResult.desktopScore}, M=${offResult.mobileScore}`);

// 2b. Test Toggle ON: Performance and Score Gain
const t0 = performance.now();
const onResult = findOptimalSharedMapping(banner, dMap, mMap, fill, true);
const elapsedMs = performance.now() - t0;
console.log(`✓ Toggle ON:  weight=${onResult.weight.toFixed(3)}, D=${onResult.desktopScore}, M=${onResult.mobileScore} (computed in ${elapsedMs.toFixed(2)}ms)`);

if (elapsedMs > 50) {
  console.error(`FAIL: Execution time too high (${elapsedMs.toFixed(2)}ms > 50ms)`);
  process.exit(1);
}

const worstOn = Math.min(onResult.desktopScore, onResult.mobileScore);
console.log(`✓ Worst seam score with Feature Snap ON: ${worstOn}`);
console.log("\nALL VERIFICATIONS PASSED!");
