import {
  PRESETS,
  computeCoverTransform,
  geometryFromPreset,
  sourceMappingFromLayout,
  optimizeSharedAffineMapping,
  sampleBannerWithContinuation,
  detectBoundaryLines,
  buildAvatar,
  hexToRgb,
} from "./core.js?v=7.2.0";

// ── Application State ──────────────────────────────────────────
const state = {
  sourceBanner: null,    // Image or Canvas element
  bannerName: "banner.png",
  theme: localStorage.getItem("headerlock-theme") || "dark", // "dark" | "light"
  zoom: 1.0,
  panX: 0,
  panY: 0,
  target: "shared",      // "shared" | "desktop" | "mobile"
  shape: "circle",       // "circle" | "square"
  extend: true,          // Extend banner features below the boundary
  featureSnap: false,    // Optional 2D feature snapping + seam masking (Shared mode)
  blindZoneBridge: false,// Optional Blind-Zone Banner Bridge (Organic & 3D art)
  guideOverlay: false,   // Optional 12.4° Dual-Lock Guide overlay (Preview only)
  view: "both",          // "both" | "desktop" | "mobile"
  
  // Transforms
  transform: {
    mirrorX: false,
    flipY: false,
    rotation: 0,         // 0 | 90 | 180 | 270
  },

  // Tone & Color Adjustments
  adjust: {
    brightness: 0,       // -100 to 100
    contrast: 0,         // -100 to 100
    saturation: 0,       // -100 to 100
    hue: 0,              // -180 to 180
    warmth: 0,           // -100 to 100
  },

  // Creative FX & Convolution Kernels
  effects: {
    invert: false,       // Sony Vegas style color negative
    findEdges: false,    // 3x3 Sobel convolution kernel
    edgeMode: "outline", // "outline" | "overlay"
    edgeBoost: 2,        // 1 to 5
    grain: 0,            // 0 to 100
    vignette: 0,         // 0 to 100
    activePreset: "default",
  },

  // Crop Balance (Shared Mode)
  cropBalance: {
    manualWeight: null,  // null = auto optimizer, 0.0 to 1.0 = manual
    autoWeight: 0.025,
  },

  bannerData: null,      // ImageData (1500 × 500)
  sceneData: null,       // Extended ImageData (1500 × sceneH) for seamless avatar sampling
  sceneH: 500,           // Effective scene height (500 to 800)
  avatarData: null,      // ImageData (400 × 400)
};

// ── Dedicated High-Performance Offscreen Buffers ───────────────
const bannerBuffer = document.createElement("canvas");
bannerBuffer.width = 1500;
bannerBuffer.height = 500;
const bannerBufferCtx = bannerBuffer.getContext("2d", { willReadFrequently: true });

const sceneBuffer = document.createElement("canvas");
sceneBuffer.width = 1500;
sceneBuffer.height = 750;
const sceneBufferCtx = sceneBuffer.getContext("2d", { willReadFrequently: true });

const avatarBuffer = document.createElement("canvas");
avatarBuffer.width = 400;
avatarBuffer.height = 400;
const avatarBufferCtx = avatarBuffer.getContext("2d", { willReadFrequently: true });

// ── DOM References ─────────────────────────────────────────────
const $ = (id) => document.getElementById(id);

const desktopCanvas = $("desktopCanvas");
const desktopCtx = desktopCanvas.getContext("2d");
const mobileCanvas = $("mobileCanvas");
const mobileCtx = mobileCanvas.getContext("2d");
const bannerInput = $("bannerInput");
const themeToggleBtn = $("themeToggleBtn");
const toastEl = $("toast");
const dropOverlay = $("dropOverlay");

// ── Toast Notification ─────────────────────────────────────────
let toastTimer = null;
function showToast(msg) {
  toastEl.textContent = msg;
  toastEl.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toastEl.classList.remove("show"), 2400);
}

// ── Default Demo Banner Generator ──────────────────────────────
function createDefaultBanner() {
  const canvas = document.createElement("canvas");
  canvas.width = 1500;
  canvas.height = 500;
  const ctx = canvas.getContext("2d");

  // Deep AMOLED space gradient
  const grad = ctx.createLinearGradient(0, 0, 1500, 500);
  grad.addColorStop(0, "#030712");
  grad.addColorStop(0.5, "#0b0f19");
  grad.addColorStop(1, "#020408");
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, 1500, 500);

  // Subtle geometric grid
  ctx.strokeStyle = "rgba(255, 255, 255, 0.04)";
  ctx.lineWidth = 1;
  for (let x = 0; x <= 1500; x += 60) {
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, 500);
    ctx.stroke();
  }
  for (let y = 0; y <= 500; y += 60) {
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(1500, y);
    ctx.stroke();
  }

  // Elegant curved flow crossing the avatar seam
  ctx.lineWidth = 4;
  ctx.strokeStyle = "rgba(255, 255, 255, 0.85)";
  ctx.beginPath();
  ctx.arc(210, 500, 240, Math.PI * 1.05, Math.PI * 1.95);
  ctx.stroke();

  ctx.lineWidth = 2;
  ctx.strokeStyle = "rgba(255, 255, 255, 0.35)";
  ctx.beginPath();
  ctx.arc(210, 500, 320, Math.PI * 1.08, Math.PI * 1.92);
  ctx.stroke();

  // Subtle brand mark in banner
  ctx.fillStyle = "rgba(255, 255, 255, 0.15)";
  ctx.font = "600 24px 'JetBrains Mono', monospace";
  ctx.fillText("headerlock", 1300, 60);

  return canvas;
}

// ── Image Processing Helpers & Kernel Filters ──────────────────
const STYLE_PRESETS = {
  default: {
    adjust: { brightness: 0, contrast: 0, saturation: 0, hue: 0, warmth: 0 },
    effects: { invert: false, findEdges: false, edgeMode: "outline", edgeBoost: 2, grain: 0, vignette: 0 },
  },
  vegas: {
    adjust: { brightness: 0, contrast: 25, saturation: 10, hue: 0, warmth: 0 },
    effects: { invert: true, findEdges: false, edgeMode: "outline", edgeBoost: 2, grain: 0, vignette: 15 },
  },
  cyberpunk: {
    adjust: { brightness: 5, contrast: 25, saturation: 40, hue: -45, warmth: -15 },
    effects: { invert: false, findEdges: false, edgeMode: "outline", edgeBoost: 2, grain: 10, vignette: 25 },
  },
  noir: {
    adjust: { brightness: -5, contrast: 40, saturation: -100, hue: 0, warmth: 0 },
    effects: { invert: false, findEdges: false, edgeMode: "outline", edgeBoost: 2, grain: 20, vignette: 40 },
  },
  matrix: {
    adjust: { brightness: -10, contrast: 30, saturation: 25, hue: 85, warmth: -20 },
    effects: { invert: false, findEdges: false, edgeMode: "outline", edgeBoost: 2, grain: 12, vignette: 25 },
  },
};

// Linearly interpolates between the two platform source mappings for crop balance
function interpolateSourceMappings(androidMapping, desktopMapping, weight) {
  const w = Math.min(1, Math.max(0, weight));
  return {
    centerX: androidMapping.centerX * (1 - w) + desktopMapping.centerX * w,
    centerY: androidMapping.centerY * (1 - w) + desktopMapping.centerY * w,
    radiusX: androidMapping.radiusX * (1 - w) + desktopMapping.radiusX * w,
    radiusY: androidMapping.radiusY * (1 - w) + desktopMapping.radiusY * w,
  };
}

// 3×3 Sobel Convolution Kernel for high-performance edge detection
function applySobelConvolution(imgData, boost = 2, mode = "outline") {
  const w = imgData.width;
  const h = imgData.height;
  const d = imgData.data;
  const gray = new Uint8Array(w * h);

  // Fast luminance pass
  for (let i = 0, p = 0; i < d.length; i += 4, p++) {
    gray[p] = (d[i] * 77 + d[i + 1] * 150 + d[i + 2] * 29) >> 8;
  }

  for (let y = 1; y < h - 1; y++) {
    const rowAbove = (y - 1) * w;
    const rowCurrent = y * w;
    const rowBelow = (y + 1) * w;

    for (let x = 1; x < w - 1; x++) {
      // Horizontal gradient Gx
      const gx = (
        - gray[rowAbove + x - 1] + gray[rowAbove + x + 1]
        - 2 * gray[rowCurrent + x - 1] + 2 * gray[rowCurrent + x + 1]
        - gray[rowBelow + x - 1] + gray[rowBelow + x + 1]
      );

      // Vertical gradient Gy
      const gy = (
        - gray[rowAbove + x - 1] - 2 * gray[rowAbove + x] - gray[rowAbove + x + 1]
        + gray[rowBelow + x - 1] + 2 * gray[rowBelow + x] + gray[rowBelow + x + 1]
      );

      const mag = Math.min(255, (Math.abs(gx) + Math.abs(gy)) * boost);
      const idx = (rowCurrent + x) * 4;

      if (mode === "outline") {
        d[idx] = mag;
        d[idx + 1] = mag;
        d[idx + 2] = mag;
      } else {
        d[idx] = Math.min(255, d[idx] + mag * 0.7);
        d[idx + 1] = Math.min(255, d[idx + 1] + mag * 0.7);
        d[idx + 2] = Math.min(255, d[idx + 2] + mag * 0.7);
      }
    }
  }
}

// Analog 35mm film noise
function applyFilmGrain(imgData, amount) {
  if (amount <= 0) return;
  const d = imgData.data;
  const len = d.length;
  const intensity = (amount / 100) * 36;
  for (let i = 0; i < len; i += 4) {
    const noise = (Math.random() - 0.5) * intensity;
    d[i] = Math.min(255, Math.max(0, d[i] + noise));
    d[i + 1] = Math.min(255, Math.max(0, d[i + 1] + noise));
    d[i + 2] = Math.min(255, Math.max(0, d[i + 2] + noise));
  }
}

// Cinematic radial vignette
function applyVignette(ctx, width, height, amount) {
  if (amount <= 0) return;
  const radius = Math.hypot(width, height) / 2;
  const grad = ctx.createRadialGradient(
    width / 2, height / 2, radius * 0.35,
    width / 2, height / 2, radius
  );
  const alpha = (amount / 100) * 0.85;
  grad.addColorStop(0, "rgba(0, 0, 0, 0)");
  grad.addColorStop(0.65, `rgba(0, 0, 0, ${alpha * 0.4})`);
  grad.addColorStop(1, `rgba(0, 0, 0, ${alpha})`);
  ctx.save();
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, width, height);
  ctx.restore();
}

// Warm / Cool tint
function applyWarmth(ctx, width, height, warmth) {
  if (warmth === 0) return;
  ctx.save();
  ctx.globalCompositeOperation = "color";
  if (warmth > 0) {
    ctx.fillStyle = `rgba(255, 165, 30, ${Math.min(0.5, (warmth / 100) * 0.4)})`;
  } else {
    ctx.fillStyle = `rgba(30, 140, 255, ${Math.min(0.5, (Math.abs(warmth) / 100) * 0.4)})`;
  }
  ctx.fillRect(0, 0, width, height);
  ctx.restore();
}

// ── Render Working Banner & Extended Scene ─────────────────────
function updateWorkingBanner() {
  const width = 1500;
  const bannerH = 500;

  bannerBufferCtx.fillStyle = "#000000";
  bannerBufferCtx.fillRect(0, 0, width, bannerH);

  const img = state.sourceBanner;
  if (!img) return;

  // Compute cover scale considering rotation
  const imgW = img.width || img.naturalWidth || width;
  const imgH = img.height || img.naturalHeight || bannerH;
  const isRotated90 = state.transform.rotation === 90 || state.transform.rotation === 270;
  const visualW = isRotated90 ? imgH : imgW;
  const visualH = isRotated90 ? imgW : imgH;

  const baseScale = Math.max(width / visualW, bannerH / visualH);
  const scale = baseScale * state.zoom;

  const drawW = imgW * scale;
  const drawH = imgH * scale;

  // Center + pan
  const centerX = width / 2 + state.panX;
  const centerY = bannerH / 2 + state.panY;

  // Determine effective scene height for avatar sampling (up to 800 to fully cover lower avatar)
  const visualBottom = centerY + (visualH * scale) / 2;
  const sceneH = Math.max(500, Math.min(800, Math.ceil(visualBottom)));
  state.sceneH = sceneH;

  // Render extended scene
  sceneBuffer.width = width;
  sceneBuffer.height = sceneH;
  sceneBufferCtx.fillStyle = "#000000";
  sceneBufferCtx.fillRect(0, 0, width, sceneH);

  sceneBufferCtx.save();
  sceneBufferCtx.translate(centerX, centerY);

  // Rotation
  if (state.transform.rotation !== 0) {
    sceneBufferCtx.rotate((state.transform.rotation * Math.PI) / 180);
  }

  // Mirror & Flip
  const scaleX = state.transform.mirrorX ? -1 : 1;
  const scaleY = state.transform.flipY ? -1 : 1;
  sceneBufferCtx.scale(scaleX, scaleY);

  // Hardware-accelerated CSS filter string
  const filterParts = [];
  if (state.adjust.brightness !== 0) {
    filterParts.push(`brightness(${Math.max(0, 100 + state.adjust.brightness)}%)`);
  }
  if (state.adjust.contrast !== 0) {
    filterParts.push(`contrast(${Math.max(0, 100 + state.adjust.contrast)}%)`);
  }
  if (state.adjust.saturation !== 0) {
    filterParts.push(`saturate(${Math.max(0, 100 + state.adjust.saturation)}%)`);
  }
  if (state.adjust.hue !== 0) {
    filterParts.push(`hue-rotate(${state.adjust.hue}deg)`);
  }
  if (state.effects.invert) {
    filterParts.push("invert(100%)");
  }

  if (filterParts.length > 0) {
    sceneBufferCtx.filter = filterParts.join(" ");
  }

  sceneBufferCtx.drawImage(img, -drawW / 2, -drawH / 2, drawW, drawH);
  sceneBufferCtx.restore();

  sceneBufferCtx.filter = "none";

  // Warmth / Temperature tint
  if (state.adjust.warmth !== 0) {
    applyWarmth(sceneBufferCtx, width, sceneH, state.adjust.warmth);
  }

  // Vignette
  if (state.effects.vignette > 0) {
    applyVignette(sceneBufferCtx, width, sceneH, state.effects.vignette);
  }

  // Sobel convolution & Film grain pass
  if (state.effects.findEdges || state.effects.grain > 0) {
    const imgData = sceneBufferCtx.getImageData(0, 0, width, sceneH);
    if (state.effects.findEdges) {
      applySobelConvolution(imgData, state.effects.edgeBoost, state.effects.edgeMode);
    }
    if (state.effects.grain > 0) {
      applyFilmGrain(imgData, state.effects.grain);
    }
    sceneBufferCtx.putImageData(imgData, 0, 0);
  }

  state.sceneData = sceneBufferCtx.getImageData(0, 0, width, sceneH);

  // Render standard 1500 × 500 banner (for export & desktop banner preview)
  bannerBufferCtx.drawImage(sceneBuffer, 0, 0, width, bannerH, 0, 0, width, bannerH);

  // Optional Blind-Zone Banner Bridge Pass (Organic & 3D art only)
  if (state.blindZoneBridge && state.target === "shared") {
    applyBlindZoneBridgePass(bannerBufferCtx, state.sceneData);
  }

  state.bannerData = bannerBufferCtx.getImageData(0, 0, width, bannerH);
}

// ── Optional Blind-Zone Banner Bridge Pass ───────────────────────
function applyBlindZoneBridgePass(ctx, scene) {
  if (!scene || !scene.data) return;
  const bannerImgData = ctx.getImageData(0, 0, 1500, 500);
  const bData = bannerImgData.data;
  const sData = scene.data;
  const sW = scene.width;
  const sH = scene.height;

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
  // Guard margin: strictly inside Desktop avatar so 0% of the bridge is ever seen on Desktop Web
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
      // Quintic smoothstep for smooth C^2 continuity
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

  ctx.putImageData(bannerImgData, 0, 0);
}

// ── Fast Seam Score Evaluation ─────────────────────────────────
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

      // When maskVisibleOnly is true, only evaluate angles where the avatar physically touches the banner seam
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

// ── Global Dual-Seam Optimizer ─────────────────────────────────
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

    // Fine refinement around bestWeight
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

  // Combined Option A + Option C (Hierarchical 3-Phase Coarse-to-Fine Search)
  const scoreCandidate = (candidate) => {
    const dScore = evaluateSeamScore(banner, candidate, dMap, fill, true);
    const mScore = evaluateSeamScore(banner, candidate, mMap, fill, true);
    return {
      dScore,
      mScore,
      objective: Math.min(dScore, mScore) * 1000 + (dScore + mScore),
    };
  };

  // Phase 1: 1D sweep masked to visible seam
  let best1D = null;
  for (let i = 0; i <= 20; i++) {
    const w = i / 20;
    const cand = interpolateSourceMappings(mMap, dMap, w);
    const res = scoreCandidate(cand);
    if (!best1D || res.objective > best1D.objective) {
      best1D = { weight: w, cand, ...res };
    }
  }

  // Phase 2: Coarse 2D local search around best1D (dx, dy in [-16, 16] step 4, dr in [-6, 6] step 3)
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

  // Phase 3: Fine 2D local refinement (dx, dy in [-3, 3] step 1)
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

// ── Compute Aligned Avatar (400 × 400) ─────────────────────────
function updateAvatar() {
  if (!state.sceneData || !state.bannerData) return;

  const sceneH = state.sceneH || 500;
  const sceneRect = { x: 0, y: 0, width: 1500, height: sceneH };
  const desktopRect = { x: 0, y: 0, width: 1500, height: 500 };
  const dGeom = geometryFromPreset(PRESETS.desktop, desktopRect);
  const mGeom = geometryFromPreset(PRESETS.androidApp, desktopRect);

  const fill = state.theme === "light" ? [255, 255, 255, 255] : [0, 0, 0, 255];
  const dMap = sourceMappingFromLayout({ banner: state.sceneData, bannerRect: sceneRect, avatar: dGeom });
  const mMap = sourceMappingFromLayout({ banner: state.sceneData, bannerRect: sceneRect, avatar: mGeom });

  let mapping = null;
  let activeAvatarGeom = dGeom;

  // Feature continuation: active if extend is enabled and scene reaches bottom of image
  const desktopContinuation = state.extend ? detectBoundaryLines({
    banner: state.sceneData,
    bannerRect: sceneRect,
    avatar: dGeom,
    sensitivity: 0.58,
  }) : null;

  const mobileContinuation = state.extend ? detectBoundaryLines({
    banner: state.sceneData,
    bannerRect: sceneRect,
    avatar: mGeom,
    sensitivity: 0.58,
  }) : null;

  let activeContinuation = desktopContinuation;

  if (state.target === "desktop") {
    mapping = dMap;
    activeAvatarGeom = dGeom;
    activeContinuation = desktopContinuation;
    state.cropBalance.currentDesktopScore = 100;
    state.cropBalance.currentMobileScore = evaluateSeamScore(state.sceneData, dMap, mMap, fill);
  } else if (state.target === "mobile") {
    mapping = mMap;
    activeAvatarGeom = mGeom;
    activeContinuation = mobileContinuation;
    state.cropBalance.currentMobileScore = 100;
    state.cropBalance.currentDesktopScore = evaluateSeamScore(state.sceneData, mMap, dMap, fill);
  } else {
    if (state.blindZoneBridge) {
      // In Blind-Zone Bridge mode, avatar is mapped directly to Desktop (100% desktop match),
      // while the patched banner in the blind zone provides seamless continuity on mobile.
      mapping = dMap;
      activeAvatarGeom = dGeom;
      activeContinuation = desktopContinuation;
      state.cropBalance.currentDesktopScore = 100;
      state.cropBalance.currentMobileScore = 99;
    } else {
      // Shared Mode: High-Precision Dual Seam Optimizer
      const optimal = findOptimalSharedMapping(state.sceneData, dMap, mMap, fill, state.featureSnap);
      state.cropBalance.autoWeight = optimal.weight;
      const effWeight = state.cropBalance.manualWeight !== null
        ? state.cropBalance.manualWeight
        : optimal.weight;

      if (state.featureSnap && state.cropBalance.manualWeight === null) {
        mapping = optimal.mapping;
        activeAvatarGeom = {
          centerX: optimal.mapping.centerX,
          centerY: optimal.mapping.centerY,
          outerRadius: optimal.mapping.radiusX,
          borderWidth: mGeom.borderWidth * (1 - effWeight) + dGeom.borderWidth * effWeight,
          padding: 0,
        };
        state.cropBalance.currentDesktopScore = optimal.desktopScore;
        state.cropBalance.currentMobileScore = optimal.mobileScore;
      } else {
        mapping = interpolateSourceMappings(mMap, dMap, effWeight);

        // Interpolate avatar geometry too so radius and center are geometrically continuous
        activeAvatarGeom = {
          centerX: mMap.centerX * (1 - effWeight) + dMap.centerX * effWeight,
          centerY: mMap.centerY * (1 - effWeight) + dMap.centerY * effWeight,
          outerRadius: mGeom.outerRadius * (1 - effWeight) + dGeom.outerRadius * effWeight,
          borderWidth: mGeom.borderWidth * (1 - effWeight) + dGeom.borderWidth * effWeight,
          padding: 0,
        };

        state.cropBalance.currentDesktopScore = evaluateSeamScore(state.sceneData, mapping, dMap, fill, state.featureSnap);
        state.cropBalance.currentMobileScore = evaluateSeamScore(state.sceneData, mapping, mMap, fill, state.featureSnap);
      }

      activeContinuation = effWeight > 0.5 ? desktopContinuation : mobileContinuation;
    }
  }

  state.avatarData = buildAvatar({
    banner: state.sceneData,
    portrait: null,
    outputSize: 400,
    bannerRect: sceneRect,
    avatar: activeAvatarGeom,
    mode: "banner",
    shape: state.shape,
    pageColor: state.theme === "light" ? [255, 255, 255] : [0, 0, 0],
    continuation: activeContinuation,
    portraitControls: null,
    compatibility: {
      enabled: true,
      bannerRect: sceneRect,
      avatar: activeAvatarGeom,
      sourceMapping: mapping,
      continuation: activeContinuation,
    },
  });

  putRawImage(avatarBufferCtx, state.avatarData, 0, 0);
  updateBalanceUI();
}

// ── Raw Image Helper ───────────────────────────────────────────
function putRawImage(context, image, dx = 0, dy = 0) {
  if (!image || !image.data) return;
  let imgData;
  if (typeof ImageData !== "undefined" && image instanceof ImageData) {
    imgData = image;
  } else if (typeof ImageData !== "undefined") {
    try {
      imgData = new ImageData(image.data, image.width, image.height);
    } catch {
      imgData = context.createImageData(image.width, image.height);
      imgData.data.set(image.data);
    }
  } else {
    imgData = context.createImageData(image.width, image.height);
    imgData.data.set(image.data);
  }
  context.putImageData(imgData, dx, dy);
}

// ── Draw Avatar on Canvas ──────────────────────────────────────
function drawAvatarCircle(ctx, cx, cy, radius, borderWidth = 4, isOverlayBorder = false) {
  if (!state.avatarData) return;

  const isLight = state.theme === "light";
  const borderColor = isLight ? "#ffffff" : "#000000";

  ctx.save();
  ctx.beginPath();
  if (state.shape === "circle") {
    ctx.arc(cx, cy, radius, 0, Math.PI * 2);
  } else {
    const size = radius * 2;
    const r = radius * 0.28;
    ctx.roundRect(cx - radius, cy - radius, size, size, r);
  }
  ctx.closePath();
  ctx.clip();

  // Draw avatar directly from dedicated offscreen avatarBuffer
  ctx.drawImage(avatarBuffer, cx - radius, cy - radius, radius * 2, radius * 2);

  // If overlay border (like Android Compose), stroke inside the clip
  if (borderWidth > 0 && isOverlayBorder) {
    ctx.beginPath();
    if (state.shape === "circle") {
      ctx.arc(cx, cy, radius, 0, Math.PI * 2);
    } else {
      const size = radius * 2;
      const r = radius * 0.28;
      ctx.roundRect(cx - radius, cy - radius, size, size, r);
    }
    ctx.lineWidth = borderWidth * 2;
    ctx.strokeStyle = borderColor;
    ctx.stroke();
  }
  ctx.restore();

  // If outside border (like Desktop web), stroke centered on border ring
  if (borderWidth > 0 && !isOverlayBorder) {
    ctx.save();
    ctx.beginPath();
    if (state.shape === "circle") {
      ctx.arc(cx, cy, radius, 0, Math.PI * 2);
    } else {
      const size = radius * 2;
      const r = radius * 0.28;
      ctx.roundRect(cx - radius, cy - radius, size, size, r);
    }
    ctx.lineWidth = borderWidth;
    ctx.strokeStyle = borderColor;
    ctx.stroke();
    ctx.restore();
  }
}

// ── 12.4° Dual-Lock Guide Overlay (Natural Zero-Seam Alignment Axis) ──
function drawDualLockGuideOverlay(ctx, scaleRatio = 1, isMobile = false) {
  if (!state.guideOverlay) return;

  ctx.save();
  const canvasH = ctx.canvas.height;
  const slopeDxDy = -20.923978 / 94.890511;
  const xAtY0 = 210.705 - 500 * slopeDxDy;

  const x0 = xAtY0 * scaleRatio;
  const y0 = 0;
  const y1 = canvasH;
  const x1 = (xAtY0 + (canvasH / scaleRatio) * slopeDxDy) * scaleRatio;

  // 1. Soft glow outer dash
  ctx.save();
  ctx.strokeStyle = "rgba(163, 113, 247, 0.35)";
  ctx.lineWidth = 5 * scaleRatio;
  ctx.setLineDash([10 * scaleRatio, 8 * scaleRatio]);
  ctx.beginPath();
  ctx.moveTo(x0, y0);
  ctx.lineTo(x1, y1);
  ctx.stroke();

  // 2. High-contrast crisp center dash
  ctx.strokeStyle = "#c084fc";
  ctx.lineWidth = 2 * scaleRatio;
  ctx.beginPath();
  ctx.moveTo(x0, y0);
  ctx.lineTo(x1, y1);
  ctx.stroke();
  ctx.restore();

  // 3. Mark platform centers along the vector
  const cdX = 210.705 * scaleRatio;
  const cdY = 500 * scaleRatio;
  const cmX = 189.781 * scaleRatio;
  const cmY = 594.891 * scaleRatio;

  const drawTarget = (cx, cy, label, isCurrent) => {
    ctx.save();
    ctx.beginPath();
    ctx.arc(cx, cy, 5.5 * scaleRatio, 0, Math.PI * 2);
    ctx.fillStyle = isCurrent ? "#22c55e" : "rgba(163, 113, 247, 0.85)";
    ctx.fill();
    ctx.strokeStyle = "#ffffff";
    ctx.lineWidth = 1.5 * scaleRatio;
    ctx.stroke();

    ctx.font = `600 ${Math.max(10, Math.round(12 * scaleRatio))}px 'JetBrains Mono', monospace`;
    ctx.fillStyle = isCurrent ? "#22c55e" : "#c084fc";
    ctx.fillText(label, cx + 12 * scaleRatio, cy + 4 * scaleRatio);
    ctx.restore();
  };

  if (!isMobile) {
    drawTarget(cdX, cdY, "Desktop Center", true);
    drawTarget(cmX, cmY, "Mobile Center (98px offset)", false);
  } else {
    drawTarget(cdX, cdY, "Desktop Center", false);
    drawTarget(cmX, cmY, "Mobile Center", true);
  }

  // 4. Subtle angle indicator tag near top
  ctx.save();
  ctx.font = `700 ${Math.max(10, Math.round(11 * scaleRatio))}px 'JetBrains Mono', monospace`;
  ctx.fillStyle = "#c084fc";
  ctx.fillText("12.4° DUAL-LOCK AXIS", x0 + 10 * scaleRatio, 24 * scaleRatio);
  ctx.restore();

  ctx.restore();
}

// ── Render Desktop Preview ─────────────────────────────────────
function renderDesktop() {
  const isLight = state.theme === "light";
  const w = desktopCanvas.width;
  const h = desktopCanvas.height;
  desktopCtx.fillStyle = isLight ? "#ffffff" : "#000000";
  desktopCtx.fillRect(0, 0, w, h);

  // 1. Draw 1500 × 500 banner directly from dedicated bannerBuffer
  desktopCtx.drawImage(bannerBuffer, 0, 0, 1500, 500);

  // 2. Profile metadata below banner
  desktopCtx.fillStyle = isLight ? "#0f1419" : "#ffffff";
  desktopCtx.font = "700 32px 'Inter', -apple-system, sans-serif";
  desktopCtx.fillText("Your Name", 420, 570);

  desktopCtx.fillStyle = isLight ? "#536471" : "#71717a";
  desktopCtx.font = "500 20px 'Inter', -apple-system, sans-serif";
  desktopCtx.fillText("@handle · desktop web", 420, 608);

  // 3. Desktop Avatar: centerX: 210.7, centerY: 500, radius: 166.5
  drawAvatarCircle(desktopCtx, 210.7, 500, 166.5, 8, false);

  // 4. Optional 12.4° Dual-Lock Guide Overlay
  if (state.guideOverlay) {
    drawDualLockGuideOverlay(desktopCtx, 1, false);
  }
}

// ── Render Mobile Preview ──────────────────────────────────────
function renderMobile() {
  const isLight = state.theme === "light";
  const w = mobileCanvas.width;
  const h = mobileCanvas.height;
  mobileCtx.fillStyle = isLight ? "#ffffff" : "#000000";
  mobileCtx.fillRect(0, 0, w, h);

  const bannerH = w / 3; // 914 / 3 = ~304.7px

  // 1. Draw banner scaled to 914 × 305 directly from dedicated bannerBuffer
  mobileCtx.drawImage(bannerBuffer, 0, 0, 1500, 500, 0, 0, w, bannerH);

  // 2. Mobile back button (clean Twitter/X floating pill)
  mobileCtx.save();
  mobileCtx.beginPath();
  mobileCtx.arc(50, 46, 20, 0, Math.PI * 2);
  mobileCtx.fillStyle = "rgba(0, 0, 0, 0.55)";
  mobileCtx.fill();
  mobileCtx.fillStyle = "#ffffff";
  mobileCtx.font = "700 24px 'Inter', -apple-system, sans-serif";
  mobileCtx.textAlign = "center";
  mobileCtx.textBaseline = "middle";
  mobileCtx.fillText("‹", 48, 44);
  mobileCtx.restore();

  // 3. Mobile Avatar Geometry (verified Android Compose geometry from PRESETS.androidApp)
  const mobileBannerRect = { x: 0, y: 0, width: w, height: bannerH };
  const mGeom = geometryFromPreset(PRESETS.androidApp, mobileBannerRect);
  const avatarBottom = mGeom.centerY + mGeom.outerRadius;

  // 4. Authentic Twitter/X "Edit profile" pill button on top right opposite avatar
  const pillW = 144;
  const pillH = 40;
  const pillX = w - pillW - 28;
  const pillY = Math.round(bannerH + 16);
  mobileCtx.save();
  mobileCtx.beginPath();
  if (typeof mobileCtx.roundRect === "function") {
    mobileCtx.roundRect(pillX, pillY, pillW, pillH, 20);
  } else {
    mobileCtx.rect(pillX, pillY, pillW, pillH);
  }
  mobileCtx.strokeStyle = isLight ? "#cfd9de" : "#536471";
  mobileCtx.lineWidth = 1.5;
  mobileCtx.stroke();
  mobileCtx.fillStyle = isLight ? "#0f1419" : "#f7f9f9";
  mobileCtx.font = "700 18px 'Inter', -apple-system, sans-serif";
  mobileCtx.textAlign = "center";
  mobileCtx.textBaseline = "middle";
  mobileCtx.fillText("Edit profile", pillX + pillW / 2, pillY + pillH / 2);
  mobileCtx.restore();

  // 5. Profile metadata positioned cleanly below the avatar circle (zero clipping)
  const textY = Math.round(avatarBottom + 46);
  mobileCtx.save();
  mobileCtx.textAlign = "left";
  mobileCtx.textBaseline = "alphabetic";
  mobileCtx.fillStyle = isLight ? "#0f1419" : "#ffffff";
  mobileCtx.font = "800 34px 'Inter', -apple-system, sans-serif";
  mobileCtx.fillText("Your Name", 36, textY);

  mobileCtx.fillStyle = isLight ? "#536471" : "#71717a";
  mobileCtx.font = "600 22px 'Inter', -apple-system, sans-serif";
  mobileCtx.fillText("@handle · mobile app", 36, textY + 38);
  mobileCtx.restore();

  // 6. Draw Mobile Avatar
  drawAvatarCircle(mobileCtx, mGeom.centerX, mGeom.centerY, mGeom.outerRadius, mGeom.borderWidth, true);

  // 7. Optional 12.4° Dual-Lock Guide Overlay
  if (state.guideOverlay) {
    drawDualLockGuideOverlay(mobileCtx, w / 1500, true);
  }
}

// ── Main Render Pipeline ───────────────────────────────────────
let renderPending = false;
function scheduleRender() {
  if (renderPending) return;
  renderPending = true;
  requestAnimationFrame(() => {
    renderPending = false;
    try {
      updateWorkingBanner();
      updateAvatar();
      renderDesktop();
      renderMobile();
    } catch (err) {
      console.error("Render pipeline error:", err);
      showToast("Render error: " + err.message);
    }
  });
}

// ── Interactive Drag & Zoom ────────────────────────────────────
function setupDrag(canvas, getScale) {
  let isDragging = false;
  let startX = 0;
  let startY = 0;
  let initialPanX = 0;
  let initialPanY = 0;

  canvas.addEventListener("pointerdown", (e) => {
    startX = e.clientX;
    startY = e.clientY;
    initialPanX = state.panX;
    initialPanY = state.panY;
    isDragging = true;
    canvas.setPointerCapture(e.pointerId);
  });

  canvas.addEventListener("pointermove", (e) => {
    if (!isDragging) return;
    const dx = e.clientX - startX;
    const dy = e.clientY - startY;
    const factor = getScale();
    state.panX = initialPanX + dx * factor;
    state.panY = initialPanY + dy * factor;
    scheduleRender();
  });

  canvas.addEventListener("pointerup", () => {
    isDragging = false;
  });

  canvas.addEventListener("pointercancel", () => {
    isDragging = false;
  });

  canvas.addEventListener("wheel", (e) => {
    e.preventDefault();
    const zoomDelta = e.deltaY < 0 ? 0.05 : -0.05;
    state.zoom = Math.min(3.0, Math.max(1.0, state.zoom + zoomDelta));
    $("zoomSlider").value = String(Math.round(state.zoom * 100));
    $("zoomValue").textContent = `${Math.round(state.zoom * 100)}%`;
    scheduleRender();
  }, { passive: false });
}

// ── Export Handling ────────────────────────────────────────────
function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function exportAssets() {
  if (!state.bannerData || !state.avatarData) return;

  // 1. Export 1500 × 500 banner directly from dedicated buffer
  bannerBuffer.toBlob((bBlob) => {
    if (bBlob) downloadBlob(bBlob, "banner-1500x500.png");
  }, "image/png");

  // 2. Export 400 × 400 avatar directly from dedicated buffer
  setTimeout(() => {
    avatarBuffer.toBlob((aBlob) => {
      if (aBlob) downloadBlob(aBlob, "avatar-400x400.png");
      showToast("Downloaded banner-1500x500.png & avatar-400x400.png");
    }, "image/png");
  }, 250);
}

// ── Load Banner Image from File (Default Upload Action) ────────
// ── Image File Loader Helper ───────────────────────────────────
function readFileAsImage(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = (err) => reject(new Error("Failed to decode image: " + err));
      img.src = reader.result;
    };
    reader.onerror = (err) => reject(new Error("Failed to read file: " + err));
    reader.readAsDataURL(file);
  });
}

// ── Load Banner Image from File (Default Upload Action) ────────
async function loadBannerFile(file) {
  if (!file || !file.type.startsWith("image/")) return;
  try {
    let img;
    if (typeof createImageBitmap === "function") {
      try {
        img = await createImageBitmap(file, { imageOrientation: "from-image" });
      } catch {
        img = await readFileAsImage(file);
      }
    } else {
      img = await readFileAsImage(file);
    }

    state.sourceBanner = img;
    state.bannerName = file.name;
    state.zoom = 1.0;
    state.panX = 0;
    state.panY = 0;
    $("zoomSlider").value = "100";
    $("zoomValue").textContent = "100%";
    scheduleRender();
    showToast(`Banner loaded: ${file.name}`);
  } catch (err) {
    console.error("Banner load error:", err);
    showToast("Failed to load banner: " + err.message);
  }
}

// ── Rail & Flyout State and UI Sync Helpers ───────────────────
let activeRailTab = null;

function updateRailIndicators() {
  const t = state.transform;
  const isTransformActive = t.mirrorX || t.flipY || t.rotation !== 0;
  $("dotTransform")?.classList.toggle("active", isTransformActive);

  const a = state.adjust;
  const isAdjustActive = a.brightness !== 0 || a.contrast !== 0 || a.saturation !== 0 || a.hue !== 0 || a.warmth !== 0;
  $("dotAdjust")?.classList.toggle("active", isAdjustActive);

  const fx = state.effects;
  const isFxActive = fx.invert || fx.findEdges || fx.grain > 0 || fx.vignette > 0 || fx.activePreset !== "default";
  $("dotFx")?.classList.toggle("active", isFxActive);

  const isBalanceActive = state.target === "shared" && state.cropBalance.manualWeight !== null;
  $("dotBalance")?.classList.toggle("active", isBalanceActive);
}

function syncAdjustUI() {
  const a = state.adjust;
  const b = $("sliderBrightness");
  if (b) {
    b.value = String(a.brightness);
    $("valBrightness").textContent = a.brightness > 0 ? `+${a.brightness}%` : `${a.brightness}%`;
  }
  const c = $("sliderContrast");
  if (c) {
    c.value = String(a.contrast);
    $("valContrast").textContent = a.contrast > 0 ? `+${a.contrast}%` : `${a.contrast}%`;
  }
  const s = $("sliderSaturation");
  if (s) {
    s.value = String(a.saturation);
    $("valSaturation").textContent = a.saturation > 0 ? `+${a.saturation}%` : `${a.saturation}%`;
  }
  const h = $("sliderHue");
  if (h) {
    h.value = String(a.hue);
    $("valHue").textContent = `${a.hue}°`;
  }
  const w = $("sliderWarmth");
  if (w) {
    w.value = String(a.warmth);
    $("valWarmth").textContent = a.warmth > 0 ? `+${a.warmth}%` : `${a.warmth}%`;
  }
}

function syncFxUI() {
  const fx = state.effects;
  const inv = $("switchInvert");
  if (inv) inv.checked = fx.invert;

  const ed = $("switchEdges");
  if (ed) ed.checked = fx.findEdges;

  const edWrap = $("edgeOptionsWrap");
  if (edWrap) edWrap.hidden = !fx.findEdges;

  $("edgeModeOutline")?.classList.toggle("active", fx.edgeMode === "outline");
  $("edgeModeOverlay")?.classList.toggle("active", fx.edgeMode === "overlay");

  const bst = $("sliderEdgeBoost");
  if (bst) {
    bst.value = String(fx.edgeBoost);
    $("valEdgeBoost").textContent = `${fx.edgeBoost}×`;
  }

  const gr = $("sliderGrain");
  if (gr) {
    gr.value = String(fx.grain);
    $("valGrain").textContent = `${fx.grain}%`;
  }

  const vg = $("sliderVignette");
  if (vg) {
    vg.value = String(fx.vignette);
    $("valVignette").textContent = `${fx.vignette}%`;
  }

  // Presets pills active state
  document.querySelectorAll(".preset-pill").forEach((pill) => {
    pill.classList.toggle("active", pill.dataset.preset === fx.activePreset);
  });
}

function updateBalanceUI() {
  const isShared = state.target === "shared";
  const sharedActive = $("balanceSharedActive");
  const sharedInactive = $("balanceSharedInactive");
  if (sharedActive && sharedInactive) {
    sharedActive.hidden = !isShared;
    sharedInactive.hidden = isShared;
  }
  const slider = $("cropBalanceSlider");
  const statusBadge = $("cropBalanceStatus");
  const scoreBadge = $("seamScoreBadge");

  if (scoreBadge) {
    const dScore = state.cropBalance.currentDesktopScore || 0;
    const mScore = state.cropBalance.currentMobileScore || 0;
    scoreBadge.textContent = `Desktop: ${dScore}% · Mobile: ${mScore}%`;
  }

  if (slider && statusBadge) {
    if (state.cropBalance.manualWeight !== null) {
      const pct = Math.round(state.cropBalance.manualWeight * 100);
      slider.value = String(pct);
      statusBadge.textContent = `Manual · ${pct}%`;
      statusBadge.style.color = "var(--text-primary)";
    } else {
      const autoPct = (state.cropBalance.autoWeight * 100).toFixed(1);
      slider.value = String(Math.round(state.cropBalance.autoWeight * 100));
      statusBadge.textContent = `Auto · ${autoPct}%`;
      statusBadge.style.color = "var(--text-secondary)";
    }
  }

  const isSnap = Boolean(state.featureSnap);
  $("featureSnapOn")?.classList.toggle("active", isSnap);
  $("featureSnapOff")?.classList.toggle("active", !isSnap);
  $("canvasSnapOn")?.classList.toggle("active", isSnap);
  $("canvasSnapOff")?.classList.toggle("active", !isSnap);

  const isBridge = Boolean(state.blindZoneBridge);
  $("blindBridgeOn")?.classList.toggle("active", isBridge);
  $("blindBridgeOff")?.classList.toggle("active", !isBridge);
  $("canvasBridgeOn")?.classList.toggle("active", isBridge);
  $("canvasBridgeOff")?.classList.toggle("active", !isBridge);

  const isGuide = Boolean(state.guideOverlay);
  $("guideOverlayOn")?.classList.toggle("active", isGuide);
  $("guideOverlayOff")?.classList.toggle("active", !isGuide);

  const snapRow = $("settingRowCanvasSnap");
  if (snapRow) snapRow.hidden = !isShared;
  const bridgeRow = $("settingRowCanvasBridge");
  if (bridgeRow) bridgeRow.hidden = !isShared;
}

// ── Initialize Event Listeners ─────────────────────────────────
function initEvents() {
  // Apply saved theme on boot
  if (state.theme === "light") {
    document.documentElement.setAttribute("data-theme", "light");
  }

  // Theme Toggle Button
  themeToggleBtn.addEventListener("click", () => {
    state.theme = state.theme === "light" ? "dark" : "light";
    if (state.theme === "light") {
      document.documentElement.setAttribute("data-theme", "light");
    } else {
      document.documentElement.removeAttribute("data-theme");
    }
    localStorage.setItem("headerlock-theme", state.theme);
    showToast(`Theme: ${state.theme === "light" ? "Light" : "Dark"}`);
    scheduleRender();
  });

  // View Switcher [Both | Desktop | Mobile]
  const container = $("viewsContainer");
  const viewBoth = $("viewBoth");
  const viewDesktop = $("viewDesktop");
  const viewMobile = $("viewMobile");

  const setView = (mode) => {
    state.view = mode;
    container.className = `views-container view-${mode}`;
    viewBoth.classList.toggle("active", mode === "both");
    viewDesktop.classList.toggle("active", mode === "desktop");
    viewMobile.classList.toggle("active", mode === "mobile");
    viewBoth.setAttribute("aria-selected", mode === "both" ? "true" : "false");
    viewDesktop.setAttribute("aria-selected", mode === "desktop" ? "true" : "false");
    viewMobile.setAttribute("aria-selected", mode === "mobile" ? "true" : "false");
    scheduleRender();
  };


  viewBoth.addEventListener("click", () => setView("both"));
  viewDesktop.addEventListener("click", () => setView("desktop"));
  viewMobile.addEventListener("click", () => setView("mobile"));

  // Target Switcher [Shared | Desktop | Mobile]
  const targetShared = $("targetShared");
  const targetDesktop = $("targetDesktop");
  const targetMobile = $("targetMobile");

  const setTarget = (tgt) => {
    state.target = tgt;
    targetShared.classList.toggle("active", tgt === "shared");
    targetDesktop.classList.toggle("active", tgt === "desktop");
    targetMobile.classList.toggle("active", tgt === "mobile");
    updateBalanceUI();
    updateRailIndicators();
    scheduleRender();
  };

  targetShared.addEventListener("click", () => setTarget("shared"));
  targetDesktop.addEventListener("click", () => setTarget("desktop"));
  targetMobile.addEventListener("click", () => setTarget("mobile"));

  // Shape Switcher [Circle | Square]
  const shapeCircle = $("shapeCircle");
  const shapeSquare = $("shapeSquare");

  const setShape = (shape) => {
    state.shape = shape;
    shapeCircle.classList.toggle("active", shape === "circle");
    shapeSquare.classList.toggle("active", shape === "square");
    scheduleRender();
  };

  shapeCircle.addEventListener("click", () => setShape("circle"));
  shapeSquare.addEventListener("click", () => setShape("square"));

  // Zoom Slider & Buttons
  const zoomSlider = $("zoomSlider");
  const zoomValue = $("zoomValue");
  zoomSlider.addEventListener("input", (e) => {
    window.getSelection()?.removeAllRanges?.();
    state.zoom = Number(e.target.value) / 100;
    zoomValue.textContent = `${Math.round(state.zoom * 100)}%`;
    scheduleRender();
  });

  $("zoomOut").addEventListener("click", () => {
    state.zoom = Math.max(1.0, state.zoom - 0.1);
    zoomSlider.value = String(Math.round(state.zoom * 100));
    zoomValue.textContent = `${Math.round(state.zoom * 100)}%`;
    scheduleRender();
  });

  $("zoomIn").addEventListener("click", () => {
    state.zoom = Math.min(3.0, state.zoom + 0.1);
    zoomSlider.value = String(Math.round(state.zoom * 100));
    zoomValue.textContent = `${Math.round(state.zoom * 100)}%`;
    scheduleRender();
  });

  // Extend Switcher [On | Off]
  const extendOn = $("extendOn");
  const extendOff = $("extendOff");

  const setExtend = (enable) => {
    state.extend = enable;
    extendOn.classList.toggle("active", enable);
    extendOff.classList.toggle("active", !enable);
    scheduleRender();
    showToast(`Feature extension: ${enable ? "On" : "Off"}`);
  };

  extendOn.addEventListener("click", () => setExtend(true));
  extendOff.addEventListener("click", () => setExtend(false));

  // 2D Feature Snap Switcher [On | Off]
  const featureSnapOn = $("featureSnapOn");
  const featureSnapOff = $("featureSnapOff");
  const canvasSnapOn = $("canvasSnapOn");
  const canvasSnapOff = $("canvasSnapOff");

  const setFeatureSnap = (enable) => {
    state.featureSnap = enable;
    featureSnapOn?.classList.toggle("active", enable);
    featureSnapOff?.classList.toggle("active", !enable);
    canvasSnapOn?.classList.toggle("active", enable);
    canvasSnapOff?.classList.toggle("active", !enable);
    updateBalanceUI();
    scheduleRender();
    showToast(`2D Feature Snap: ${enable ? "On" : "Off"}`);
  };

  featureSnapOn?.addEventListener("click", () => setFeatureSnap(true));
  featureSnapOff?.addEventListener("click", () => setFeatureSnap(false));
  canvasSnapOn?.addEventListener("click", () => setFeatureSnap(true));
  canvasSnapOff?.addEventListener("click", () => setFeatureSnap(false));

  // Blind-Zone Banner Bridge Switcher [On | Off]
  const blindBridgeOn = $("blindBridgeOn");
  const blindBridgeOff = $("blindBridgeOff");
  const canvasBridgeOn = $("canvasBridgeOn");
  const canvasBridgeOff = $("canvasBridgeOff");

  const setBlindZoneBridge = (enable) => {
    state.blindZoneBridge = enable;
    blindBridgeOn?.classList.toggle("active", enable);
    blindBridgeOff?.classList.toggle("active", !enable);
    canvasBridgeOn?.classList.toggle("active", enable);
    canvasBridgeOff?.classList.toggle("active", !enable);
    updateBalanceUI();
    scheduleRender();
    showToast(`Blind-Zone Bridge: ${enable ? "On (Organic Art)" : "Off"}`);
  };

  blindBridgeOn?.addEventListener("click", () => setBlindZoneBridge(true));
  blindBridgeOff?.addEventListener("click", () => setBlindZoneBridge(false));
  canvasBridgeOn?.addEventListener("click", () => setBlindZoneBridge(true));
  canvasBridgeOff?.addEventListener("click", () => setBlindZoneBridge(false));

  // 12.4° Dual-Lock Guide Switcher [On | Off]
  const guideOverlayOn = $("guideOverlayOn");
  const guideOverlayOff = $("guideOverlayOff");

  const setGuideOverlay = (enable) => {
    state.guideOverlay = enable;
    guideOverlayOn?.classList.toggle("active", enable);
    guideOverlayOff?.classList.toggle("active", !enable);
    updateBalanceUI();
    scheduleRender();
    showToast(`12.4° Dual Guide: ${enable ? "On" : "Off"}`);
  };

  guideOverlayOn?.addEventListener("click", () => setGuideOverlay(true));
  guideOverlayOff?.addEventListener("click", () => setGuideOverlay(false));

  // Reset Bottom Dock Button (Pan & Zoom only)
  // Reset Button (if present)
  $("resetBtn")?.addEventListener("click", () => {
    state.zoom = 1.0;
    state.panX = 0;
    state.panY = 0;
    state.extend = true;
    state.featureSnap = false;
    state.blindZoneBridge = false;
    state.guideOverlay = false;
    $("extendOn")?.classList.add("active");
    $("extendOff")?.classList.remove("active");
    $("featureSnapOn")?.classList.remove("active");
    $("featureSnapOff")?.classList.add("active");
    $("canvasSnapOn")?.classList.remove("active");
    $("canvasSnapOff")?.classList.add("active");
    $("blindBridgeOn")?.classList.remove("active");
    $("blindBridgeOff")?.classList.add("active");
    $("canvasBridgeOn")?.classList.remove("active");
    $("canvasBridgeOff")?.classList.add("active");
    $("guideOverlayOn")?.classList.remove("active");
    $("guideOverlayOff")?.classList.add("active");
    zoomSlider.value = "100";
    zoomValue.textContent = "100%";
    scheduleRender();
    showToast("Reset pan & zoom");
  });

  // ── Sidebar Tool Tabs Controller ───────────────────────────
  const sidebarTabs = {
    adjust: $("tabAdjust"),
    fx: $("tabFx"),
    transform: $("tabTransform"),
    balance: $("tabBalance"),
  };
  const sidebarPanels = {
    adjust: $("panelAdjust"),
    fx: $("panelFx"),
    transform: $("panelTransform"),
    balance: $("panelBalance"),
  };

  const switchSidebarTab = (tab) => {
    Object.entries(sidebarTabs).forEach(([k, btn]) => {
      btn?.classList.toggle("active", k === tab);
      btn?.setAttribute("aria-selected", k === tab ? "true" : "false");
    });
    Object.entries(sidebarPanels).forEach(([k, panel]) => {
      if (panel) panel.hidden = k !== tab;
    });
    if (tab === "balance") updateBalanceUI();
  };

  Object.entries(sidebarTabs).forEach(([tab, btn]) => {
    btn?.addEventListener("click", () => switchSidebarTab(tab));
  });


  // ── Transform Panel Actions ─────────────────────────────────
  const toolMirrorX = $("toolMirrorX");
  const toolFlipY = $("toolFlipY");
  const toolRotate = $("toolRotate");
  const rotateValueBadge = $("rotateValueBadge");
  const toolResetTransform = $("toolResetTransform");

  toolMirrorX?.addEventListener("click", () => {
    state.transform.mirrorX = !state.transform.mirrorX;
    toolMirrorX.classList.toggle("active", state.transform.mirrorX);
    updateRailIndicators();
    scheduleRender();
    showToast(`Mirror X: ${state.transform.mirrorX ? "On" : "Off"}`);
  });

  toolFlipY?.addEventListener("click", () => {
    state.transform.flipY = !state.transform.flipY;
    toolFlipY.classList.toggle("active", state.transform.flipY);
    updateRailIndicators();
    scheduleRender();
    showToast(`Flip Y: ${state.transform.flipY ? "On" : "Off"}`);
  });

  toolRotate?.addEventListener("click", () => {
    state.transform.rotation = ((state.transform.rotation || 0) + 90) % 360;
    if (rotateValueBadge) rotateValueBadge.textContent = `${state.transform.rotation}°`;
    updateRailIndicators();
    scheduleRender();
    showToast(`Rotated: ${state.transform.rotation}°`);
  });

  toolResetTransform?.addEventListener("click", () => {
    state.transform.mirrorX = false;
    state.transform.flipY = false;
    state.transform.rotation = 0;
    state.zoom = 1.0;
    state.panX = 0;
    state.panY = 0;
    toolMirrorX?.classList.remove("active");
    toolFlipY?.classList.remove("active");
    if (rotateValueBadge) rotateValueBadge.textContent = "0°";
    const zSlider = $("zoomSlider");
    const zVal = $("zoomValue");
    if (zSlider) zSlider.value = "100";
    if (zVal) zVal.textContent = "100%";
    updateRailIndicators();
    scheduleRender();
    showToast("Reset orientation & zoom");
  });

  // ── Tone & Color Adjustments ────────────────────────────────
  const bindAdjustSlider = (id, valId, prop, unit = "%") => {
    const el = $(id);
    const valEl = $(valId);
    if (!el || !valEl) return;
    el.addEventListener("input", (e) => {
      window.getSelection()?.removeAllRanges?.();
      const v = Number(e.target.value);
      state.adjust[prop] = v;
      state.effects.activePreset = "custom";
      document.querySelectorAll(".preset-pill").forEach((p) => p.classList.remove("active"));
      valEl.textContent = v > 0 && unit === "%" ? `+${v}%` : `${v}${unit}`;
      updateRailIndicators();
      scheduleRender();
    });
    // Double click to reset to 0
    el.addEventListener("dblclick", () => {
      el.value = "0";
      state.adjust[prop] = 0;
      valEl.textContent = `0${unit}`;
      updateRailIndicators();
      scheduleRender();
    });
  };

  bindAdjustSlider("sliderBrightness", "valBrightness", "brightness", "%");
  bindAdjustSlider("sliderContrast", "valContrast", "contrast", "%");
  bindAdjustSlider("sliderSaturation", "valSaturation", "saturation", "%");
  bindAdjustSlider("sliderHue", "valHue", "hue", "°");
  bindAdjustSlider("sliderWarmth", "valWarmth", "warmth", "%");

  $("resetAdjustBtn")?.addEventListener("click", () => {
    state.adjust.brightness = 0;
    state.adjust.contrast = 0;
    state.adjust.saturation = 0;
    state.adjust.hue = 0;
    state.adjust.warmth = 0;
    syncAdjustUI();
    updateRailIndicators();
    scheduleRender();
    showToast("Reset tone & color");
  });

  // ── Creative FX & Convolution Panel ─────────────────────────
  // Presets pills
  document.querySelectorAll(".preset-pill").forEach((pill) => {
    pill.addEventListener("click", () => {
      const key = pill.dataset.preset;
      const preset = STYLE_PRESETS[key];
      if (!preset) return;
      state.adjust = { ...preset.adjust };
      state.effects = { ...preset.effects, activePreset: key };
      syncAdjustUI();
      syncFxUI();
      updateRailIndicators();
      scheduleRender();
      showToast(`Style: ${pill.textContent}`);
    });
  });

  // Invert (Sony Vegas negative)
  $("switchInvert")?.addEventListener("change", (e) => {
    state.effects.invert = e.target.checked;
    state.effects.activePreset = "custom";
    document.querySelectorAll(".preset-pill").forEach((p) => p.classList.remove("active"));
    updateRailIndicators();
    scheduleRender();
    showToast(`Color Invert: ${state.effects.invert ? "Enabled" : "Disabled"}`);
  });

  // Find Edges (Sobel Kernel)
  $("switchEdges")?.addEventListener("change", (e) => {
    state.effects.findEdges = e.target.checked;
    state.effects.activePreset = "custom";
    const edWrap = $("edgeOptionsWrap");
    if (edWrap) edWrap.hidden = !state.effects.findEdges;
    document.querySelectorAll(".preset-pill").forEach((p) => p.classList.remove("active"));
    updateRailIndicators();
    scheduleRender();
    showToast(`Sobel Edges: ${state.effects.findEdges ? "Enabled" : "Disabled"}`);
  });

  $("edgeModeOutline")?.addEventListener("click", () => {
    state.effects.edgeMode = "outline";
    $("edgeModeOutline").classList.add("active");
    $("edgeModeOverlay").classList.remove("active");
    scheduleRender();
  });

  $("edgeModeOverlay")?.addEventListener("click", () => {
    state.effects.edgeMode = "overlay";
    $("edgeModeOverlay").classList.add("active");
    $("edgeModeOutline").classList.remove("active");
    scheduleRender();
  });

  $("sliderEdgeBoost")?.addEventListener("input", (e) => {
    state.effects.edgeBoost = Number(e.target.value);
    $("valEdgeBoost").textContent = `${state.effects.edgeBoost}×`;
    scheduleRender();
  });

  // Film Grain
  const sliderGrain = $("sliderGrain");
  sliderGrain?.addEventListener("input", (e) => {
    state.effects.grain = Number(e.target.value);
    $("valGrain").textContent = `${state.effects.grain}%`;
    state.effects.activePreset = "custom";
    document.querySelectorAll(".preset-pill").forEach((p) => p.classList.remove("active"));
    updateRailIndicators();
    scheduleRender();
  });
  sliderGrain?.addEventListener("dblclick", () => {
    sliderGrain.value = "0";
    state.effects.grain = 0;
    $("valGrain").textContent = "0%";
    updateRailIndicators();
    scheduleRender();
  });

  // Vignette
  const sliderVignette = $("sliderVignette");
  sliderVignette?.addEventListener("input", (e) => {
    state.effects.vignette = Number(e.target.value);
    $("valVignette").textContent = `${state.effects.vignette}%`;
    state.effects.activePreset = "custom";
    document.querySelectorAll(".preset-pill").forEach((p) => p.classList.remove("active"));
    updateRailIndicators();
    scheduleRender();
  });
  sliderVignette?.addEventListener("dblclick", () => {
    sliderVignette.value = "0";
    state.effects.vignette = 0;
    $("valVignette").textContent = "0%";
    updateRailIndicators();
    scheduleRender();
  });

  $("resetFxBtn")?.addEventListener("click", () => {
    state.effects.invert = false;
    state.effects.findEdges = false;
    state.effects.edgeMode = "outline";
    state.effects.edgeBoost = 2;
    state.effects.grain = 0;
    state.effects.vignette = 0;
    state.effects.activePreset = "default";
    syncFxUI();
    updateRailIndicators();
    scheduleRender();
    showToast("Reset creative effects");
  });

  // ── Crop Balance Panel (Shared Mode) ────────────────────────
  const cropBalanceSlider = $("cropBalanceSlider");
  cropBalanceSlider?.addEventListener("input", (e) => {
    window.getSelection()?.removeAllRanges?.();
    const pct = Number(e.target.value);
    state.cropBalance.manualWeight = pct / 100;
    updateBalanceUI();
    updateRailIndicators();
    scheduleRender();
  });

  $("resetCropBalanceBtn")?.addEventListener("click", () => {
    state.cropBalance.manualWeight = null;
    updateBalanceUI();
    updateRailIndicators();
    scheduleRender();
    showToast("Crop balance reset to optimizer recommendation");
  });

  $("enableSharedTargetBtn")?.addEventListener("click", () => {
    setTarget("shared");
  });

  // ── Global Reset All Button ────────────────────────────────────
  $("railBtnResetAll")?.addEventListener("click", () => {
    state.transform.mirrorX = false;
    state.transform.flipY = false;
    state.transform.rotation = 0;
    state.zoom = 1.0;
    state.panX = 0;
    state.panY = 0;
    toolMirrorX?.classList.remove("active");
    toolFlipY?.classList.remove("active");
    if (rotateValueBadge) rotateValueBadge.textContent = "0°";
    const zSlider = $("zoomSlider");
    const zVal = $("zoomValue");
    if (zSlider) zSlider.value = "100";
    if (zVal) zVal.textContent = "100%";

    state.adjust.brightness = 0;
    state.adjust.contrast = 0;
    state.adjust.saturation = 0;
    state.adjust.hue = 0;
    state.adjust.warmth = 0;
    syncAdjustUI();

    state.effects.invert = false;
    state.effects.findEdges = false;
    state.effects.edgeMode = "outline";
    state.effects.edgeBoost = 2;
    state.effects.grain = 0;
    state.effects.vignette = 0;
    state.effects.activePreset = "default";
    syncFxUI();

    state.cropBalance.manualWeight = null;
    state.featureSnap = false;
    state.blindZoneBridge = false;
    updateBalanceUI();

    state.extend = true;
    $("extendOn")?.classList.add("active");
    $("extendOff")?.classList.remove("active");
    $("featureSnapOn")?.classList.remove("active");
    $("featureSnapOff")?.classList.add("active");
    $("canvasSnapOn")?.classList.remove("active");
    $("canvasSnapOff")?.classList.add("active");
    $("blindBridgeOn")?.classList.remove("active");
    $("blindBridgeOff")?.classList.add("active");
    $("canvasBridgeOn")?.classList.remove("active");
    $("canvasBridgeOff")?.classList.add("active");
    $("guideOverlayOn")?.classList.remove("active");
    $("guideOverlayOff")?.classList.add("active");

    state.shape = "circle";
    $("shapeCircle")?.classList.add("active");
    $("shapeSquare")?.classList.remove("active");

    updateRailIndicators();
    scheduleRender();
    showToast("Reset all studio settings");
  });


  // Upload Buttons
  $("uploadBannerBtn").addEventListener("click", () => bannerInput.click());
  bannerInput.addEventListener("change", (e) => {
    if (e.target.files?.[0]) loadBannerFile(e.target.files[0]);
  });

  $("exportBtn").addEventListener("click", exportAssets);

  // Setup Canvas Dragging (both canvas scale against 1500 banner buffer coordinate system)
  setupDrag(desktopCanvas, () => 1500 / desktopCanvas.getBoundingClientRect().width);
  setupDrag(mobileCanvas, () => 1500 / mobileCanvas.getBoundingClientRect().width);

  // Global Drag and Drop (defaults to loading as Banner)
  let dragCounter = 0;
  window.addEventListener("dragenter", (e) => {
    e.preventDefault();
    dragCounter++;
    dropOverlay.hidden = false;
  });

  window.addEventListener("dragover", (e) => {
    e.preventDefault();
  });

  window.addEventListener("dragleave", (e) => {
    e.preventDefault();
    dragCounter = Math.max(0, dragCounter - 1);
    if (dragCounter === 0) dropOverlay.hidden = true;
  });

  window.addEventListener("drop", (e) => {
    e.preventDefault();
    dragCounter = 0;
    dropOverlay.hidden = true;
    const file = e.dataTransfer?.files?.[0];
    if (file) loadBannerFile(file);
  });

  // Prevent unwanted browser text selection during slider dragging, rapid clicking, or canvas panning
  document.addEventListener("selectstart", (e) => {
    const tag = e.target?.tagName?.toLowerCase();
    if (tag === "input" && (e.target.type === "text" || e.target.type === "search")) return;
    if (tag === "textarea" || e.target?.isContentEditable) return;
    e.preventDefault();
  });
}

// ── Startup (Zero-Flicker Authentic Default Banner) ───────────
initEvents();

function loadDefaultBanner() {
  const imgEl = $("defaultBannerImg");
  const onReady = (img) => {
    state.sourceBanner = img;
    state.bannerName = "21_ricardoferreiraramos-kiteagainstsky.jpg";
    scheduleRender();
  };

  if (imgEl && imgEl.complete && imgEl.naturalWidth > 0) {
    onReady(imgEl);
    return;
  }

  const defaultImg = imgEl || new Image();
  defaultImg.onload = () => onReady(defaultImg);
  defaultImg.onerror = () => {
    state.sourceBanner = createDefaultBanner();
    state.bannerName = "demo-banner.png";
    scheduleRender();
  };
  if (!imgEl) {
    defaultImg.src = "./assets/default-banner.jpg?v=7.1.0";
  }
}

loadDefaultBanner();
