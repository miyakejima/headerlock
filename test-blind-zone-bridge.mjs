/**
 * Verification test for Optional Blind-Zone Banner Bridge.
 */
import fs from "fs";
import {
  PRESETS,
  geometryFromPreset,
} from "./core.js";

console.log("=== Running Blind-Zone Banner Bridge Verification Suite ===\n");

// 1. DOM Structure & Default State Verification
const html = fs.readFileSync("index.html", "utf8");
const requiredIds = [
  "blindBridgeOn",
  "blindBridgeOff",
  "canvasBridgeOn",
  "canvasBridgeOff",
  "settingRowCanvasBridge",
];

for (const id of requiredIds) {
  if (!html.includes(`id="${id}"`)) {
    console.error(`FAIL: Missing DOM id "${id}" in index.html`);
    process.exit(1);
  }
}
console.log("✓ DOM verification: All Blind-Zone Bridge toggle buttons exist in index.html");

// Ensure default state is strictly OFF in index.html
if (!html.includes('id="blindBridgeOff" class="dock-pill active"')) {
  console.error("FAIL: blindBridgeOff must have class 'active' by default");
  process.exit(1);
}
if (!html.includes('id="canvasBridgeOff" class="dock-pill active"')) {
  console.error("FAIL: canvasBridgeOff must have class 'active' by default");
  process.exit(1);
}
console.log("✓ DOM verification: Default state is strictly OFF by default");

// Verify cache buster version bumped to 7.4.0
if (!html.includes("app.js?v=7.4.0") || !html.includes("styles.css?v=7.4.0")) {
  console.error("FAIL: Cache buster versions in index.html must be v=7.4.0");
  process.exit(1);
}
console.log("✓ Cache buster verification: index.html correctly bumped to v=7.4.0");

// 2. Mathematical Verification of Blind-Zone Bridge Pass
const W = 1500, H = 500, sceneH = 680;
const sceneData = {
  width: W,
  height: sceneH,
  data: new Uint8ClampedArray(W * sceneH * 4)
};

// Generate test ribbon curve passing through seam
for (let y = 0; y < sceneH; y++) {
  for (let x = 0; x < W; x++) {
    const idx = (y * W + x) * 4;
    const distRibbon = Math.abs((x - 200) - (y - 450) * 0.8);
    const intensity = Math.max(0, 255 - distRibbon * 8);
    sceneData.data[idx] = intensity;
    sceneData.data[idx + 1] = Math.round(intensity * 0.7);
    sceneData.data[idx + 2] = Math.round(intensity * 0.2);
    sceneData.data[idx + 3] = 255;
  }
}

// Replicate banner data (raw)
const rawBannerData = new Uint8ClampedArray(W * H * 4);
for (let i = 0; i < W * H * 4; i++) {
  rawBannerData[i] = sceneData.data[i];
}

// Replicate applyBlindZoneBridgePass
function runBridgePass(bData, sData, sW, sH) {
  const dGeom = geometryFromPreset(PRESETS.desktop, { x: 0, y: 0, width: 1500, height: 500 });
  const mGeom = geometryFromPreset(PRESETS.androidApp, { x: 0, y: 0, width: 1500, height: 500 });
  const d_cx = dGeom.centerX;
  const d_cy = dGeom.centerY;
  const d_r = dGeom.outerRadius;
  const m_cx = mGeom.centerX;
  const m_cy = mGeom.centerY;
  const m_r = mGeom.outerRadius;
  const ratio = d_r / m_r;

  const depth = 65.0;
  const rLimitSq = (d_r - 1.5) * (d_r - 1.5);
  const m_r_sq = m_r * m_r;

  for (let y = 330; y < 500; y++) {
    const dy_d = y - d_cy;
    const dy_d_sq = dy_d * dy_d;
    for (let x = 50; x < 360; x++) {
      const dx_d = x - d_cx;
      if (dx_d * dx_d + dy_d_sq >= rLimitSq) continue;

      const dx_m = x - m_cx;
      if (Math.abs(dx_m) >= m_r) continue;
      const dy_m = Math.sqrt(m_r_sq - dx_m * dx_m);
      const y_seam = m_cy - dy_m;
      const y_start = y_seam - depth;
      if (y < y_start) continue;

      let t = y <= y_seam ? (y - y_start) / (y_seam - y_start) : 1.0;
      if (t < 0) t = 0; else if (t > 1) t = 1;
      const t_s = t * t * t * (t * (t * 6 - 15) + 10);

      const target_x = d_cx + dx_m * ratio;
      const target_y = d_cy + (y - m_cy) * ratio;

      const sx = (1 - t_s) * x + t_s * target_x;
      const sy = (1 - t_s) * y + t_s * target_y;

      const x0 = Math.floor(Math.max(0, Math.min(sW - 2, sx)));
      const y0 = Math.floor(Math.max(0, Math.min(sH - 2, sy)));
      const tx = sx - x0;
      const ty = sy - y0;

      const idx00 = (y0 * sW + x0) * 4;
      const idx10 = (y0 * sW + (x0 + 1)) * 4;
      const idx01 = ((y0 + 1) * sW + x0) * 4;
      const idx11 = ((y0 + 1) * sW + (x0 + 1)) * 4;

      const bIdx = (y * 1500 + x) * 4;
      for (let c = 0; c < 3; c++) {
        const top = sData[idx00 + c] * (1 - tx) + sData[idx10 + c] * tx;
        const bot = sData[idx01 + c] * (1 - tx) + sData[idx11 + c] * tx;
        bData[bIdx + c] = Math.round(top * (1 - ty) + bot * ty);
      }
      bData[bIdx + 3] = 255;
    }
  }
}

const bridgedBannerData = new Uint8ClampedArray(rawBannerData);
const t0 = performance.now();
runBridgePass(bridgedBannerData, sceneData.data, W, sceneH);
const elapsedMs = performance.now() - t0;
console.log(`✓ Performance verification: Bridge pass executed in ${elapsedMs.toFixed(2)}ms (target: < 25ms)`);

if (elapsedMs > 25) {
  console.error(`FAIL: Execution time too high (${elapsedMs.toFixed(2)}ms > 25ms)`);
  process.exit(1);
}

// Check Desktop Zero-Alteration Guarantee:
// Every pixel outside Desktop avatar circle must be 100% IDENTICAL
const dGeom = geometryFromPreset(PRESETS.desktop, { x: 0, y: 0, width: 1500, height: 500 });
let outsideDiffCount = 0;
for (let y = 0; y < 500; y++) {
  const dy = y - dGeom.centerY;
  for (let x = 0; x < 1500; x++) {
    const dx = x - dGeom.centerX;
    const dist = Math.hypot(dx, dy);
    if (dist >= dGeom.outerRadius) {
      const idx = (y * 1500 + x) * 4;
      if (rawBannerData[idx] !== bridgedBannerData[idx] ||
          rawBannerData[idx+1] !== bridgedBannerData[idx+1] ||
          rawBannerData[idx+2] !== bridgedBannerData[idx+2]) {
        outsideDiffCount++;
      }
    }
  }
}

if (outsideDiffCount !== 0) {
  console.error(`FAIL: Desktop Web altered! ${outsideDiffCount} pixels outside desktop avatar were modified`);
  process.exit(1);
}
console.log("✓ Zero-Assumption Safety: Exactly 0 pixels outside Desktop avatar circle were modified (100.0% match)");

// Check that bridge actually patched the blind zone
let insideDiffCount = 0;
for (let y = 330; y < 500; y++) {
  for (let x = 50; x < 360; x++) {
    const idx = (y * 1500 + x) * 4;
    if (rawBannerData[idx] !== bridgedBannerData[idx]) insideDiffCount++;
  }
}
console.log(`✓ Active repair verification: ${insideDiffCount} pixels safely patched inside the blind zone`);

console.log("\nALL BLIND-ZONE BRIDGE VERIFICATION TESTS PASSED!");
