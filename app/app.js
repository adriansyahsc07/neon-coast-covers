"use strict";
/*
 * Neon Coast Cover Studio — cover renderer and editor wiring.
 * Plain browser script, no modules, no network: every photo is read
 * locally, graded on canvas, and composited into a poster layout.
 */

// ---------- layout geometry (unit space, 0..1 on both axes) ----------

function rect(x, y, w, h, rot) {
  return { x, y, w, h, rot: rot || 0 };
}

const LAYOUTS = {
  // Title band across the top, nine photo cells underneath.
  grid9: {
    label: "Nine-panel grid",
    titleBand: 0.21,
    panels() {
      const top = 0.225, cellW = 1 / 3, cellH = (1 - top) / 3, out = [];
      for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) out.push(rect(c * cellW, top + r * cellH, cellW, cellH));
      return out;
    },
  },
  classic4: {
    label: "Classic four",
    panels() {
      return [rect(0, 0, 0.5, 0.5), rect(0.5, 0, 0.5, 0.5), rect(0, 0.5, 0.5, 0.5), rect(0.5, 0.5, 0.5, 0.5)];
    },
  },
  hero3: {
    label: "Hero + three",
    panels() {
      return [rect(0, 0, 1, 0.6), rect(0, 0.6, 1 / 3, 0.4), rect(1 / 3, 0.6, 1 / 3, 0.4), rect(2 / 3, 0.6, 1 / 3, 0.4)];
    },
  },
  bleed: {
    label: "Full bleed",
    panels() { return [rect(0, 0, 1, 1)]; },
  },
  stack: {
    label: "Snapshot stack",
    panels() {
      return [
        rect(0.05, 0.07, 0.56, 0.6, -0.1),
        rect(0.42, 0.3, 0.54, 0.58, 0.09),
        rect(0.14, 0.52, 0.5, 0.42, -0.05),
      ];
    },
  },
};

// ---------- gradient-map grades ----------
// Each grade is three RGB stops: shadow, midtone, highlight. A pixel's
// luminance picks a point on that ramp, which is the whole trick behind
// the poster look — skies go gold, shadows go purple, skin goes warm.

const GRADES = {
  sunset: { shadow: [26, 10, 58], mid: [255, 94, 58], high: [255, 215, 106] },
  neon: { shadow: [8, 0, 34], mid: [176, 38, 255], high: [142, 246, 255] },
  teal: { shadow: [6, 42, 51], mid: [217, 123, 79], high: [255, 227, 179] },
  noir: { shadow: [8, 8, 14], mid: [118, 122, 140], high: [245, 246, 250] },
};

function rampFor(grade) {
  const g = GRADES[grade];
  const table = new Uint8ClampedArray(256 * 3);
  for (let i = 0; i < 256; i++) {
    const t = i / 255;
    const a = t < 0.5 ? g.shadow : g.mid;
    const b = t < 0.5 ? g.mid : g.high;
    const k = t < 0.5 ? t * 2 : (t - 0.5) * 2;
    for (let ch = 0; ch < 3; ch++) table[i * 3 + ch] = Math.round(a[ch] + (b[ch] - a[ch]) * k);
  }
  return table;
}

const gradeCache = new Map();

function gradedCanvas(img, grade) {
  if (!grade || grade === "none") return img;
  const key = (img.dataset ? img.dataset.key : img.src) + "|" + grade;
  if (gradeCache.has(key)) return gradeCache.get(key);
  const scale = Math.min(1, 1500 / Math.max(img.naturalWidth, img.naturalHeight));
  const c = document.createElement("canvas");
  c.width = Math.max(2, Math.round(img.naturalWidth * scale));
  c.height = Math.max(2, Math.round(img.naturalHeight * scale));
  const cx = c.getContext("2d");
  cx.drawImage(img, 0, 0, c.width, c.height);
  const data = cx.getImageData(0, 0, c.width, c.height);
  const px = data.data, table = rampFor(grade);
  for (let i = 0; i < px.length; i += 4) {
    const lum = Math.max(0, Math.min(255, Math.round(0.2126 * px[i] + 0.7152 * px[i + 1] + 0.0722 * px[i + 2])));
    const base = lum * 3;
    if (grade === "noir") {
      // Keep a whisper of the original hue so noir still feels photographic.
      px[i] = table[base] * 0.88 + px[i] * 0.12;
      px[i + 1] = table[base + 1] * 0.88 + px[i + 1] * 0.12;
      px[i + 2] = table[base + 2] * 0.88 + px[i + 2] * 0.12;
    } else {
      // Blend 82% ramp with 18% original colour for a rich but believable grade.
      px[i] = table[base] * 0.82 + px[i] * 0.18;
      px[i + 1] = table[base + 1] * 0.82 + px[i + 1] * 0.18;
      px[i + 2] = table[base + 2] * 0.82 + px[i + 2] * 0.18;
    }
  }
  cx.putImageData(data, 0, 0);
  gradeCache.set(key, c);
  return c;
}

// ---------- state ----------

const state = {
  photos: [],            // { img, name, key }
  layout: "grid9",
  grade: "sunset",
  title: "NEON COAST",
  subtitle: "one night in the city",
  titleScale: 1,
  fillAll: false,
  selected: 0,
  grain: 0.35,
  vignette: 0.55,
  aspect: "square",
  slots: [],             // per panel: { photo: index|-1, ox, oy, zoom }
};

function panelList() { return LAYOUTS[state.layout].panels(); }

function ensureSlots() {
  const n = panelList().length;
  while (state.slots.length < n) state.slots.push({ photo: -1, ox: 0.5, oy: 0.5, zoom: 1 });
  state.slots.length = n;
  if (state.selected >= n) state.selected = 0;
}

function autoFill() {
  ensureSlots();
  if (!state.photos.length) return;
  state.slots.forEach((s, i) => { if (s.photo < 0) s.photo = i % state.photos.length; });
}

function photoForSlot(i) {
  if (!state.photos.length) return null;
  if (state.fillAll) return state.photos[0];
  const idx = state.slots[i].photo;
  return idx >= 0 && state.photos[idx] ? state.photos[idx] : null;
}

// ---------- the cover renderer (shared by preview and export) ----------

function drawPhotoCover(ctx, src, dx, dy, dw, dh, slot) {
  const sw = src.width || src.naturalWidth, sh = src.height || src.naturalHeight;
  const scale = Math.max(dw / sw, dh / sh) * slot.zoom;
  const w = sw * scale, h = sh * scale;
  const maxX = Math.max(0, w - dw), maxY = Math.max(0, h - dh);
  const x = dx - slot.ox * maxX, y = dy - slot.oy * maxY;
  ctx.drawImage(src, x, y, w, h);
}

function placeholder(ctx, dx, dy, dw, dh, i) {
  const hues = [[64, 20, 110], [150, 30, 90], [20, 70, 110], [110, 50, 20]];
  const c = hues[i % hues.length];
  const g = ctx.createLinearGradient(dx, dy, dx + dw, dy + dh);
  g.addColorStop(0, `rgb(${c[0]},${c[1]},${c[2]})`);
  g.addColorStop(1, "rgb(12,6,28)");
  ctx.fillStyle = g;
  ctx.fillRect(dx, dy, dw, dh);
  ctx.fillStyle = "rgba(255,255,255,.65)";
  ctx.font = `600 ${Math.max(13, dw * 0.055)}px system-ui, sans-serif`;
  ctx.textAlign = "center"; ctx.textBaseline = "middle";
  ctx.fillText("ADD A PHOTO", dx + dw / 2, dy + dh / 2);
}

function drawPanel(ctx, W, H, p, i) {
  const dx = p.x * W, dy = p.y * H, dw = p.w * W, dh = p.h * H;
  ctx.save();
  if (p.rot) {
    ctx.translate(dx + dw / 2, dy + dh / 2);
    ctx.rotate(p.rot);
    ctx.translate(-dw / 2, -dh / 2);
  } else {
    ctx.translate(dx, dy);
  }
  ctx.beginPath();
  ctx.rect(0, 0, dw, dh);
  ctx.clip();
  const entry = photoForSlot(i);
  if (entry) {
    drawPhotoCover(ctx, gradedCanvas(entry.img, state.grade), 0, 0, dw, dh, state.slots[i]);
  } else {
    placeholder(ctx, 0, 0, dw, dh, i);
  }
  ctx.restore();
  // Frame: thick white keyline like a printed poster, dark outer edge.
  ctx.save();
  if (p.rot) {
    ctx.translate(dx + dw / 2, dy + dh / 2);
    ctx.rotate(p.rot);
    ctx.translate(-dw / 2, -dh / 2);
  } else {
    ctx.translate(dx, dy);
  }
  ctx.lineWidth = Math.max(3, W * 0.006);
  ctx.strokeStyle = "#ffffff";
  ctx.strokeRect(0, 0, dw, dh);
  ctx.lineWidth = Math.max(1.5, W * 0.0022);
  ctx.strokeStyle = "rgba(10,4,24,.9)";
  ctx.strokeRect(-ctx.lineWidth, -ctx.lineWidth, dw + ctx.lineWidth * 2, dh + ctx.lineWidth * 2);
  ctx.restore();
}

function letterTitle(ctx, W, H) {
  const layout = LAYOUTS[state.layout];
  const inBand = typeof layout.titleBand === "number";
  const cx = W / 2;
  if (inBand) {
    const bandH = layout.titleBand * H;
    const g = ctx.createLinearGradient(0, 0, 0, bandH);
    g.addColorStop(0, "#1b0b38");
    g.addColorStop(0.7, "#3d1160");
    g.addColorStop(1, "#57194e");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, bandH);
    ctx.fillStyle = "#ffd76a";
    ctx.fillRect(0, bandH - Math.max(3, H * 0.006), W, Math.max(3, H * 0.006));
    const size = bandH * 0.52 * state.titleScale;
    ctx.font = `${size}px AntonLocal, "Arial Black", sans-serif`;
    ctx.textAlign = "center"; ctx.textBaseline = "middle";
    ctx.lineWidth = size * 0.16;
    ctx.strokeStyle = "#12041f";
    ctx.strokeText(state.title.toUpperCase(), cx, bandH * 0.44);
    ctx.fillStyle = "#ffffff";
    ctx.fillText(state.title.toUpperCase(), cx, bandH * 0.44);
    if (state.subtitle) {
      ctx.font = `${bandH * 0.21}px PacificoLocal, cursive`;
      ctx.fillStyle = "#ffb3d9";
      ctx.fillText(state.subtitle, cx, bandH * 0.82);
    }
    return;
  }
  // Bottom-anchored caption over a soft scrim for the other layouts.
  const base = H * 0.965;
  const size = H * 0.085 * state.titleScale * (W > H ? 1.25 : 1);
  const scrim = ctx.createLinearGradient(0, H * 0.68, 0, H);
  scrim.addColorStop(0, "rgba(8,2,20,0)");
  scrim.addColorStop(1, "rgba(8,2,20,.78)");
  ctx.fillStyle = scrim;
  ctx.fillRect(0, H * 0.68, W, H * 0.32);
  ctx.textAlign = "center"; ctx.textBaseline = "alphabetic";
  ctx.font = `${size}px AntonLocal, "Arial Black", sans-serif`;
  ctx.shadowColor = "rgba(0,0,0,.85)";
  ctx.shadowBlur = size * 0.12;
  ctx.shadowOffsetY = size * 0.05;
  ctx.lineWidth = size * 0.18;
  ctx.strokeStyle = "#160428";
  ctx.strokeText(state.title.toUpperCase(), cx, base - (state.subtitle ? size * 0.52 : 0));
  const grad = ctx.createLinearGradient(0, base - size * 1.4, 0, base);
  grad.addColorStop(0, "#ffffff");
  grad.addColorStop(0.55, "#ffe259");
  grad.addColorStop(1, "#ff7518");
  ctx.fillStyle = grad;
  ctx.fillText(state.title.toUpperCase(), cx, base - (state.subtitle ? size * 0.52 : 0));
  ctx.shadowColor = "transparent";
  if (state.subtitle) {
    ctx.font = `${size * 0.42}px PacificoLocal, cursive`;
    ctx.fillStyle = "#ffd7ef";
    ctx.shadowColor = "rgba(0,0,0,.8)";
    ctx.shadowBlur = size * 0.1;
    ctx.fillText(state.subtitle, cx, base);
    ctx.shadowColor = "transparent";
  }
}

// ---------- finish pass: vignette + film grain ----------
// Vignette darkens the corners with a radial falloff so the eye stays on
// the hero panel. Grain is a small seeded noise tile stamped across the
// frame — seeded, so exports and screenshots are perfectly repeatable.

let grainTile = null;
function makeGrainTile() {
  const c = document.createElement("canvas");
  c.width = 256; c.height = 256;
  const cx = c.getContext("2d");
  const data = cx.createImageData(256, 256);
  let seed = 1234567;
  const next = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };
  for (let i = 0; i < data.data.length; i += 4) {
    const v = Math.floor(next() * 255);
    data.data[i] = v; data.data[i + 1] = v; data.data[i + 2] = v; data.data[i + 3] = 255;
  }
  cx.putImageData(data, 0, 0);
  return c;
}

function applyVignette(ctx, W, H) {
  if (state.vignette <= 0) return;
  const r = Math.hypot(W, H) / 2;
  const g = ctx.createRadialGradient(W / 2, H / 2, r * 0.42, W / 2, H / 2, r);
  g.addColorStop(0, "rgba(5,0,16,0)");
  g.addColorStop(1, `rgba(5,0,16,${(state.vignette * 0.62).toFixed(3)})`);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, H);
}

function applyGrain(ctx, W, H) {
  if (state.grain <= 0) return;
  if (!grainTile) grainTile = makeGrainTile();
  ctx.save();
  ctx.globalAlpha = state.grain * 0.16;
  ctx.globalCompositeOperation = "overlay";
  for (let y = 0; y < H; y += 256) for (let x = 0; x < W; x += 256) ctx.drawImage(grainTile, x, y);
  ctx.restore();
}

function renderCover(ctx, W, H, forExport) {
  ensureSlots();
  ctx.save();
  ctx.fillStyle = "#0a0618";
  ctx.fillRect(0, 0, W, H);
  const panels = panelList();
  panels.forEach((p, i) => drawPanel(ctx, W, H, p, i));
  // Warm sunset wash over the whole poster ties the panels together.
  const wash = ctx.createLinearGradient(0, 0, 0, H);
  wash.addColorStop(0, "rgba(255,120,60,.10)");
  wash.addColorStop(0.5, "rgba(255,46,136,.05)");
  wash.addColorStop(1, "rgba(20,0,50,.14)");
  ctx.fillStyle = wash;
  ctx.fillRect(0, 0, W, H);
  applyVignette(ctx, W, H);
  letterTitle(ctx, W, H);
  applyGrain(ctx, W, H);
  if (!forExport) {
    // Editor-only: highlight the selected panel.
    const p = panels[state.selected];
    if (p) {
      ctx.save();
      ctx.translate(p.x * W + (p.w * W) / 2, p.y * H + (p.h * H) / 2);
      if (p.rot) ctx.rotate(p.rot);
      ctx.lineWidth = 4;
      ctx.strokeStyle = "#ffd76a";
      ctx.setLineDash([14, 9]);
      ctx.strokeRect(-(p.w * W) / 2, -(p.h * H) / 2, p.w * W, p.h * H);
      ctx.restore();
    }
  }
  ctx.restore();
}

// ---------- photo intake ----------

let keyCounter = 0;

function addImage(img, name) {
  const key = "p" + (++keyCounter) + "-" + name;
  img.dataset.key = key;
  state.photos.push({ img, name, key });
  autoFill();
  refreshThumbs();
  draw();
}

function loadFile(file) {
  const url = URL.createObjectURL(file);
  const img = new Image();
  img.onload = () => addImage(img, file.name);
  img.src = url;
}

function loadSample(name) {
  const found = state.photos.find((p) => p.name === name + ".jpg");
  if (found) return Promise.resolve(found);
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => { addImage(img, name + ".jpg"); resolve(state.photos[state.photos.length - 1]); };
    img.onerror = () => resolve(null);
    img.src = "samples/" + name + ".jpg";
  });
}

// ---------- editor wiring ----------

const stage = document.getElementById("stage");
const stageCtx = stage.getContext("2d");
const ASPECTS = { square: [960, 960], portrait: [864, 1080], wide: [1280, 720] };

function draw() {
  renderCover(stageCtx, stage.width, stage.height, false);
}

function refreshThumbs() {
  const box = document.getElementById("thumbs");
  box.innerHTML = "";
  if (!state.photos.length) {
    box.innerHTML = '<p class="empty-note">No photos yet — add your own or tap a demo photo.</p>';
    return;
  }
  state.photos.forEach((p, i) => {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "thumb" + (state.slots[state.selected] && state.slots[state.selected].photo === i ? " on" : "");
    const im = document.createElement("img");
    im.src = p.img.src;
    im.alt = p.name;
    b.appendChild(im);
    const all = document.createElement("span");
    all.className = "all";
    all.textContent = "ALL";
    all.title = "Fill every panel with this photo";
    all.addEventListener("click", (ev) => {
      ev.stopPropagation();
      state.fillAll = true;
      document.getElementById("fillAll").checked = true;
      state.slots.forEach((s) => { s.photo = i; });
      refreshThumbs(); draw();
    });
    b.appendChild(all);
    b.title = p.name + " — click to place in the selected panel";
    b.addEventListener("click", () => {
      state.slots[state.selected].photo = i;
      if (state.fillAll && i !== 0) { /* keep fillAll semantics simple: placing switches it off */ state.fillAll = false; document.getElementById("fillAll").checked = false; }
      refreshThumbs(); draw();
    });
    box.appendChild(b);
  });
}

function hitPanel(ev) {
  const r = stage.getBoundingClientRect();
  const u = (ev.clientX - r.left) / r.width, v = (ev.clientY - r.top) / r.height;
  const panels = panelList();
  for (let i = panels.length - 1; i >= 0; i--) {
    const p = panels[i];
    if (u >= p.x && u <= p.x + p.w && v >= p.y && v <= p.y + p.h) return i;
  }
  return -1;
}

let drag = null;
stage.addEventListener("pointerdown", (ev) => {
  const i = hitPanel(ev);
  if (i < 0) return;
  state.selected = i;
  syncPanelControls();
  refreshThumbs();
  drag = { x: ev.clientX, y: ev.clientY };
  stage.setPointerCapture(ev.pointerId);
  draw();
});
stage.addEventListener("pointermove", (ev) => {
  if (!drag) return;
  const r = stage.getBoundingClientRect();
  const p = panelList()[state.selected];
  const slot = state.slots[state.selected];
  slot.ox = Math.max(0, Math.min(1, slot.ox - (ev.clientX - drag.x) / r.width / p.w));
  slot.oy = Math.max(0, Math.min(1, slot.oy - (ev.clientY - drag.y) / r.height / p.h));
  drag = { x: ev.clientX, y: ev.clientY };
  draw();
});
stage.addEventListener("pointerup", () => { drag = null; });

function syncPanelControls() {
  const slot = state.slots[state.selected];
  const z = document.getElementById("zoom");
  z.value = slot ? slot.zoom : 1;
  document.getElementById("zoomVal").textContent = (slot ? slot.zoom : 1).toFixed(2) + "×";
}

function bindUi() {
  const fileInput = document.getElementById("fileInput");
  fileInput.addEventListener("change", () => { [...fileInput.files].forEach(loadFile); fileInput.value = ""; });
  document.getElementById("demoBtn").addEventListener("click", async () => {
    await loadSample("boulevard"); await loadSample("pier"); await loadSample("neon-street"); await loadSample("beach-sunset");
    autoFill(); draw();
  });
  document.querySelectorAll("[data-sample]").forEach((b) => b.addEventListener("click", async () => { await loadSample(b.dataset.sample); draw(); }));
  document.getElementById("fillAll").addEventListener("change", (ev) => { state.fillAll = ev.target.checked; draw(); });
  document.querySelectorAll("[data-layout]").forEach((b) => b.addEventListener("click", () => {
    document.querySelectorAll("[data-layout]").forEach((x) => x.classList.toggle("on", x === b));
    state.layout = b.dataset.layout;
    state.selected = 0;
    ensureSlots(); autoFill(); syncPanelControls(); refreshThumbs(); draw();
  }));
  document.querySelectorAll("[data-grade]").forEach((b) => b.addEventListener("click", () => {
    document.querySelectorAll("[data-grade]").forEach((x) => x.classList.toggle("on", x === b));
    state.grade = b.dataset.grade; draw();
  }));
  document.querySelectorAll("[data-aspect]").forEach((b) => b.addEventListener("click", () => {
    document.querySelectorAll("[data-aspect]").forEach((x) => x.classList.toggle("on", x === b));
    state.aspect = b.dataset.aspect;
    const [w, h] = ASPECTS[state.aspect];
    stage.width = w; stage.height = h; draw();
  }));
  document.getElementById("zoom").addEventListener("input", (ev) => {
    state.slots[state.selected].zoom = Number(ev.target.value);
    document.getElementById("zoomVal").textContent = Number(ev.target.value).toFixed(2) + "×";
    draw();
  });
  document.getElementById("centerBtn").addEventListener("click", () => {
    const s = state.slots[state.selected]; s.ox = 0.5; s.oy = 0.5; draw();
  });
  document.getElementById("clearPanelBtn").addEventListener("click", () => {
    state.slots[state.selected].photo = -1; refreshThumbs(); draw();
  });
  document.getElementById("grain").addEventListener("input", (ev) => {
    state.grain = Number(ev.target.value);
    document.getElementById("grainVal").textContent = Math.round(state.grain * 100) + "%";
    draw();
  });
  document.getElementById("vignette").addEventListener("input", (ev) => {
    state.vignette = Number(ev.target.value);
    document.getElementById("vignetteVal").textContent = Math.round(state.vignette * 100) + "%";
    draw();
  });
  document.getElementById("titleInput").addEventListener("input", (ev) => { state.title = ev.target.value || "NEON COAST"; draw(); });
  document.getElementById("subInput").addEventListener("input", (ev) => { state.subtitle = ev.target.value; draw(); });
  document.getElementById("titleSize").addEventListener("input", (ev) => { state.titleScale = Number(ev.target.value); draw(); });
  const wrap = document.getElementById("stageWrap");
  ["dragenter", "dragover"].forEach((t) => wrap.addEventListener(t, (ev) => { ev.preventDefault(); wrap.classList.add("dragging"); }));
  ["dragleave", "drop"].forEach((t) => wrap.addEventListener(t, (ev) => { ev.preventDefault(); wrap.classList.remove("dragging"); }));
  wrap.addEventListener("drop", (ev) => { [...ev.dataTransfer.files].filter((f) => f.type.startsWith("image/")).forEach(loadFile); });
  document.getElementById("expSquare").addEventListener("click", () => exportPng(1080, 1080, "square"));
  document.getElementById("expPortrait").addEventListener("click", () => exportPng(1080, 1350, "portrait"));
  document.getElementById("expWide").addEventListener("click", () => exportPng(1920, 1080, "wide"));
}

function exportPng(w, h, tag) {
  const c = document.createElement("canvas");
  c.width = w; c.height = h;
  renderCover(c.getContext("2d"), w, h, true);
  const a = document.createElement("a");
  a.download = "neon-coast-cover-" + tag + "-" + w + "x" + h + ".png";
  a.href = c.toDataURL("image/png");
  a.click();
}

// ---------- deterministic screenshot scenes ----------

let shotKind = null;

async function applyShotMode() {
  const q = new URLSearchParams(location.search);
  if (!q.has("shot")) return false;
  const mode = q.get("shot");
  shotKind = mode;
  document.body.classList.add("shot");
  const layout = q.get("layout");
  if (layout && LAYOUTS[layout]) state.layout = layout;
  const grade = q.get("grade");
  if (grade && (GRADES[grade] || grade === "none")) state.grade = grade;
  if (q.get("caption")) { state.title = q.get("caption"); }
  if (q.get("sub")) state.subtitle = q.get("sub");
  const names = (q.get("photo") || "pier").split(",").map((s) => s.trim()).filter(Boolean);
  for (const n of names) await loadSample(n.replace(/\.jpg$/, ""));
  ensureSlots();
  state.slots.forEach((s, i) => { if (state.photos.length) s.photo = i % state.photos.length; });
  if (mode === "editor") {
    document.body.classList.remove("shot");
    document.body.classList.add("shot-editor");
    const [w, h] = [1280, 800];
    stage.width = 960; stage.height = 960;
    state.aspect = "square";
    draw();
  } else {
    const sizes = { square: [1080, 1080], portrait: [1080, 1350], wide: [1920, 1080] };
    const [w, h] = sizes[q.get("size") || "square"] || sizes.square;
    stage.width = w; stage.height = h;
    renderCover(stageCtx, w, h, true);
  }
  document.body.dataset.ready = "1";
  return true;
}

// ---------- boot ----------

(async function boot() {
  bindUi();
  ensureSlots();
  const shot = await applyShotMode();
  if (!shot) {
    await loadSample("pier");
    await loadSample("boulevard");
    autoFill();
  }
  if (document.fonts && document.fonts.ready) {
    try { await document.fonts.load('40px AntonLocal'); await document.fonts.load('30px PacificoLocal'); } catch (e) { /* fallback fonts still render */ }
    await document.fonts.ready;
  }
  if (shotKind === "cover") {
    // Re-render cleanly at export size now the lettering fonts are in —
    // the editor draw would stamp a selection outline on the poster.
    renderCover(stageCtx, stage.width, stage.height, true);
  } else {
    draw();
  }
  document.body.dataset.ready = "1";
})();
