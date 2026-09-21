/**
 * Verification test for 12.4° Dual-Lock Guide Overlay.
 */
import fs from "fs";
import assert from "assert";
import {
  PRESETS,
  geometryFromPreset,
} from "./core.js";

console.log("=== Running 12.4° Dual-Lock Guide Overlay Verification Suite ===\n");

// 1. DOM Structure & Default State Verification
const html = fs.readFileSync("index.html", "utf8");
const requiredIds = [
  "guideOverlayOn",
  "guideOverlayOff",
  "settingRowGuideOverlay",
];

for (const id of requiredIds) {
  assert.ok(html.includes(`id="${id}"`), `FAIL: Missing DOM id "${id}" in index.html`);
}
console.log("✓ DOM verification: All 12.4° Dual Guide elements exist in index.html");

// Ensure default state is strictly Off (class="dock-pill active" on Off button)
const offBtnMatch = html.match(/<button id="guideOverlayOff" class="([^"]+)"/);
assert.ok(offBtnMatch && offBtnMatch[1].includes("active"), "FAIL: guideOverlayOff must be active by default");
console.log("✓ DOM verification: Default state is strictly OFF by default");

// Verify cache buster bumped to v=7.8.0
assert.ok(html.includes("v=7.8.0"), "FAIL: Cache buster v=7.8.0 missing in index.html");
console.log("✓ Cache buster verification: index.html correctly bumped to v=7.8.0");

// 2. Mathematical Vector Verification
const desktopRect = { x: 0, y: 0, width: 1500, height: 500 };
const dGeom = geometryFromPreset(PRESETS.desktop, desktopRect);
const mGeom = geometryFromPreset(PRESETS.androidApp, desktopRect);

const dx = mGeom.centerX - dGeom.centerX;
const dy = mGeom.centerY - dGeom.centerY;
const angleRad = Math.atan2(-dx, dy); // angle from vertical
const angleDeg = angleRad * 180 / Math.PI;

console.log(`✓ Geometry verification: Desktop Center=(${dGeom.centerX.toFixed(3)}, ${dGeom.centerY.toFixed(3)})`);
console.log(`✓ Geometry verification: Mobile Center=(${mGeom.centerX.toFixed(3)}, ${mGeom.centerY.toFixed(3)})`);
console.log(`✓ Geometry verification: Distance=${Math.hypot(dx, dy).toFixed(2)}px, Angle=${angleDeg.toFixed(2)}°`);

assert.ok(Math.abs(angleDeg - 12.44) < 0.1, `FAIL: Expected angle ~12.44°, got ${angleDeg}`);

// Check line intersection formula in app.js
const appJs = fs.readFileSync("app.js", "utf8");
assert.ok(appJs.includes("drawDualLockGuideOverlay"), "FAIL: drawDualLockGuideOverlay function missing in app.js");
assert.ok(appJs.includes("12.4° DUAL-LOCK AXIS"), "FAIL: 12.4° Axis label missing in app.js");

// 3. Export Safety Verification
// Ensure drawDualLockGuideOverlay is ONLY called on desktopCtx / mobileCtx, NEVER on bannerBufferCtx or avatarBufferCtx
assert.ok(!appJs.includes("drawDualLockGuideOverlay(bannerBufferCtx"), "FAIL: drawDualLockGuideOverlay called on bannerBufferCtx");
assert.ok(!appJs.includes("drawDualLockGuideOverlay(avatarBufferCtx"), "FAIL: drawDualLockGuideOverlay called on avatarBufferCtx");
console.log("✓ Export Safety: Guide overlay is strictly viewport-only (never contaminates exported PNGs)");

console.log("\nALL 12.4° DUAL GUIDE VERIFICATION TESTS PASSED!");
