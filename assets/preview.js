import { extractFramePalette, paletteFromColor } from "./frame-palette.js";
import { MATERIAL_PROFILES, createHolographicRenderer } from "./holo-engine.js";
import { computeOpticalState, expandFoilColors } from "./optical-state.js";

const STATIC_PAYLOAD = {
  schemaVersion: 5,
  launchPolicy: "public-mobile-web",
  artAlt: "暖橙色日落天空下的城市建筑与树木剪影，一只飞鸟掠过中央高楼旁。",
  backAlt: null,
  backgroundUrl: "./background.webp",
  subjectUrl: "./subject.webp",
  backUrl: null,
  warnings: [],
  presentation: {
    version: 2,
    frame: { style: "narrow", width: 0.65, color: "#785233", colorMode: "image" },
    radius: { outer: 5.8, inner: 5.15 },
    surface: { color: "#17100c", accent: "#f1bd62", material: "spectral-lines" },
    foil: {
      enabled: true,
      target: "background",
      colors: ["#ff5470", "#ffcc66", "#50e3c2", "#5cb8ff", "#8f7cff", "#ef7dff"],
      intensity: 0.78,
    },
    texture: { kind: "micro-grain", target: "background", intensity: 0.48 },
    sparkle: { enabled: false, target: "background", intensity: 0 },
    glare: { enabled: true, target: "surface", intensity: 0.62 },
    depth: {
      parallaxX: 1.45,
      parallaxY: 1.25,
      lift: 19,
      shadowOpacity: 0.18,
      shadowBlur: 16,
      rimIntensity: 0.12,
    },
    motion: { maxX: 14, maxY: 14, scale: 1.024, smoothing: 0.18 },
    constraints: { keepInsideFrame: true },
  },
};
const id = "static";
const card = document.getElementById("card");
const front = card.querySelector(".front");
const canvas = document.getElementById("material-canvas");
const background = document.getElementById("background");
const subject = document.getElementById("subject");
const subjectShadow = document.getElementById("subject-shadow");
const back = document.getElementById("back");
const backImage = document.getElementById("back-image");
const flipButton = document.getElementById("flip");
const toolbar = document.getElementById("toolbar");
const errorPanel = document.getElementById("render-error");
const reduceMotion = matchMedia("(prefers-reduced-motion: reduce)");
let config;
let renderer;
let resizeObserver;
let diagnosticsTimer;
let flipped = false;
let point = { x: 50, y: 50 };

const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
const pct = value => `${value}%`;
const set = (name, value) => card.style.setProperty(name, String(value));
const setFacePalette = (element, palette) => {
  element.style.setProperty("--frame-color", palette.base);
  element.style.setProperty("--frame-highlight", palette.highlight);
  element.style.setProperty("--frame-shadow", palette.shadow);
};
const applyFramePalette = (element, image, frame) => {
  const palette = (frame.colorMode ?? "fixed") === "image" ? extractFramePalette(image, frame.color) : paletteFromColor(frame.color);
  setFacePalette(element, palette);
};

function showError(error) {
  renderer?.dispose();
  renderer = undefined;
  resizeObserver?.disconnect();
  card.hidden = true;
  toolbar.hidden = true;
  errorPanel.hidden = false;
  errorPanel.textContent = `Holographic preview unavailable: ${error instanceof Error ? error.message : String(error)}`;
}

function write(x, y, driveRenderer = true) {
  if (!config || !renderer) return;
  const presentation = config.presentation;
  const recipe = MATERIAL_PROFILES[presentation.surface.material];
  const nx = reduceMotion.matches ? 0.48 : (x - 50) / 50;
  const ny = reduceMotion.matches ? -0.36 : (y - 50) / 50;
  const distance = Math.min(1, Math.hypot(nx, ny));
  const state = computeOpticalState(presentation, nx, ny, recipe);
  set("--rotate-x", reduceMotion.matches ? "0deg" : `${state.rotateX}deg`);
  set("--rotate-y", reduceMotion.matches ? "0deg" : `${state.rotateY}deg`);
  set("--card-scale", reduceMotion.matches ? 1 : state.scale);
  set("--subject-x", pct(nx * presentation.depth.parallaxX));
  set("--subject-y", pct(ny * presentation.depth.parallaxY));
  set("--subject-z", `${distance * presentation.depth.lift}px`);
  if (driveRenderer) {
    set("--tilt-duration", `${Math.round(presentation.motion.smoothing * 1000)}ms`);
    set("--tilt-ease", "cubic-bezier(.2,.75,.22,1)");
    renderer.setPointer(nx, ny, true);
  }
  clearTimeout(diagnosticsTimer);
  diagnosticsTimer = setTimeout(() => {
    console.info(`Holographic diagnostics: ${JSON.stringify(renderer?.diagnostics() ?? null)}`);
  }, 500);
}

function apply(presentation) {
  const recipe = MATERIAL_PROFILES[presentation.surface.material];
  if (!recipe) throw new Error(`Unknown material: ${presentation.surface.material}`);
  const foilColors = expandFoilColors(presentation.foil.colors, presentation.surface.accent);
  const fallbackPalette = paletteFromColor(presentation.frame.color);
  const variables = {
    "--outer-radius": pct(presentation.radius.outer),
    "--inner-radius": pct(presentation.radius.inner),
    "--frame-width": pct(presentation.frame.width),
    "--frame-color": fallbackPalette.base,
    "--frame-highlight": fallbackPalette.highlight,
    "--frame-shadow": fallbackPalette.shadow,
    "--surface": presentation.surface.color,
    "--accent": presentation.surface.accent,
    "--foil-a": foilColors[0], "--foil-b": foilColors[1], "--foil-c": foilColors[2],
    "--foil-d": foilColors[3], "--foil-e": foilColors[4], "--foil-f": foilColors[5],
    "--shadow-opacity": presentation.depth.shadowOpacity,
    "--shadow-blur": `${presentation.depth.shadowBlur}px`,
    "--tilt-duration": `${Math.round(presentation.motion.smoothing * 1000)}ms`,
    "--flip-y": "0deg",
  };
  Object.entries(variables).forEach(([name, value]) => set(name, value));
  card.classList.add(`frame-${presentation.frame.style}`);
}

function reset() {
  point = { x: 50, y: 50 };
  set("--tilt-duration", "1200ms");
  set("--tilt-ease", "cubic-bezier(.18,1.38,.32,1)");
  write(50, 50, false);
  renderer?.releasePointer();
}
function flip() {
  if (!config?.backUrl) return;
  flipped = !flipped;
  set("--flip-y", flipped ? "180deg" : "0deg");
  back.setAttribute("aria-hidden", String(!flipped));
}
function syncReducedMotion() {
  renderer?.setReducedMotion(reduceMotion.matches);
  if (reduceMotion.matches) write(74, 32, false);
}

if (!id) {
  showError("Invalid preview link.");
} else {
Promise.resolve(STATIC_PAYLOAD)
  .then(async payload => {
    config = payload;
    background.src = payload.backgroundUrl;
    background.alt = payload.artAlt;
    card.setAttribute("aria-label", payload.artAlt);
    subject.src = subjectShadow.src = payload.subjectUrl;
    let backPaletteReady = Promise.resolve();
    if (payload.backUrl) {
      back.hidden = false;
      backImage.src = payload.backUrl;
      backImage.alt = payload.backAlt || "";
      flipButton.hidden = false;
      setFacePalette(back, paletteFromColor(payload.presentation.frame.color));
      backPaletteReady = backImage.decode().then(() => applyFramePalette(back, backImage, payload.presentation.frame)).catch(() => undefined);
    }
    await Promise.all([background.decode(), subject.decode(), subjectShadow.decode()]);
    apply(payload.presentation);
    applyFramePalette(front, background, payload.presentation.frame);
    await backPaletteReady;
    renderer = createHolographicRenderer({ canvas, image: background, presentation: payload.presentation, onError: showError });
    resizeObserver = new ResizeObserver(() => renderer?.resize());
    resizeObserver.observe(canvas);
    await renderer.ready();
    syncReducedMotion();
    write(50, 50, false);
    globalThis.__holoPreviewDiagnostics = () => renderer?.diagnostics() ?? null;
    card.hidden = false;
    toolbar.hidden = false;
    console.info(`WebGL2 holographic renderer initialized: ${payload.presentation.surface.material}`);
  })
  .catch(showError);
}

card.addEventListener("pointermove", event => {
  const rect = card.getBoundingClientRect();
  point = { x: clamp((event.clientX - rect.left) / rect.width * 100, 0, 100), y: clamp((event.clientY - rect.top) / rect.height * 100, 0, 100) };
  write(point.x, point.y);
});
card.addEventListener("pointerleave", reset);
card.addEventListener("pointercancel", reset);
card.addEventListener("blur", reset);
card.addEventListener("keydown", event => {
  if ((event.key === "Enter" || event.key === " ") && config?.backUrl) { event.preventDefault(); flip(); return; }
  if (event.key === "Home") { event.preventDefault(); reset(); return; }
  const delta = { x: 0, y: 0 };
  if (event.key === "ArrowLeft") delta.x = -8; else if (event.key === "ArrowRight") delta.x = 8;
  else if (event.key === "ArrowUp") delta.y = -8; else if (event.key === "ArrowDown") delta.y = 8; else return;
  event.preventDefault();
  point = { x: clamp(point.x + delta.x, 0, 100), y: clamp(point.y + delta.y, 0, 100) };
  write(point.x, point.y);
});
document.getElementById("reset").addEventListener("click", reset);
flipButton.addEventListener("click", flip);
reduceMotion.addEventListener("change", syncReducedMotion);
document.addEventListener("visibilitychange", () => renderer?.setPaused(document.hidden));
window.addEventListener("pagehide", () => {
  globalThis.__holoPreviewDiagnostics = undefined;
  clearTimeout(diagnosticsTimer);
  renderer?.dispose();
}, { once: true });
