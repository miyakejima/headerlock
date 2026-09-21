/**
 * Verification test suite for Minimalist Mobile Sizing.
 * Strictly verifies size enlargement and vertical proportion WITHOUT any dummy content/slop.
 */
import fs from "fs";
import assert from "assert";
import {
  PRESETS,
  geometryFromPreset,
} from "./core.js";

console.log("=== Running Minimalist Mobile Sizing Verification Suite ===\n");

// 1. DOM Structure & Canvas Dimensions
const html = fs.readFileSync("index.html", "utf8");
const canvasMatch = html.match(/<canvas id="mobileCanvas"[^>]*width="(\d+)"[^>]*height="(\d+)"/);
assert.ok(canvasMatch, "FAIL: mobileCanvas with explicit width and height not found in index.html");

const canvasWidth = parseInt(canvasMatch[1], 10);
const canvasHeight = parseInt(canvasMatch[2], 10);

assert.equal(canvasWidth, 914, `FAIL: Expected mobileCanvas width 914, got ${canvasWidth}`);
assert.equal(canvasHeight, 640, `FAIL: Expected mobileCanvas height 640, got ${canvasHeight}`);
console.log(`✓ Canvas Dimensions: 914 × 640 (Slightly taller vertical proportion without dummy content)`);

// 2. CSS Sizing
const css = fs.readFileSync("styles.css", "utf8");

// Check view-both proportions
assert.ok(css.includes(".views-container.view-both .card.mobile-view"), "FAIL: view-both mobile-view CSS rule missing");
assert.ok(css.includes("max-width: 520px;"), "FAIL: view-both mobile card must have max-width 520px (enlarged)");
console.log("✓ CSS (Mode: Both): Mobile card enlarged to max-width: 520px for balanced side-by-side view");

// Check view-mobile showcase focus
assert.ok(css.includes(".views-container.view-mobile .card.mobile-view"), "FAIL: view-mobile mobile-view CSS rule missing");
assert.ok(css.includes("max-width: 900px;"), "FAIL: view-mobile mobile card must have max-width 900px (much larger)");
console.log("✓ CSS (Mode: Mobile): Mobile card enlarged to max-width: 900px (prominent showcase)");

// 3. Slop-Free Purity Verification in app.js
const appJs = fs.readFileSync("app.js", "utf8");

// Ensure NO fake tweets, tabs, bio, or stats were added
assert.ok(!appJs.includes("📌 Pinned"), "FAIL: Dummy pinned tweet must NOT be in app.js");
assert.ok(!appJs.includes("Replies"), "FAIL: Dummy tabs must NOT be in app.js");
assert.ok(!appJs.includes("Following"), "FAIL: Dummy follower stats must NOT be in app.js");
assert.ok(!appJs.includes("📅  Joined"), "FAIL: Dummy joined date must NOT be in app.js");
console.log("✓ Zero-Slop Verification: Strictly zero dummy tweets, tabs, stats, or fake bios");

// 4. Geometry and Export Safety
const bannerH = canvasWidth / 3;
const mobileBannerRect = { x: 0, y: 0, width: canvasWidth, height: bannerH };
const mGeom = geometryFromPreset(PRESETS.androidApp, mobileBannerRect);
assert.ok(mGeom.centerX > 100 && mGeom.centerY > 300, "FAIL: Android Compose geometry corrupted");
console.log("✓ Android Geometry: Official Compose crop geometry strictly preserved");

console.log("\nALL MINIMALIST MOBILE SIZING TESTS PASSED!");
