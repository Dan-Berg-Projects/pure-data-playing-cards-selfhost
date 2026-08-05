/* ========= CONFIG ========= */
// Card scanning uses Google Cloud Vision via a small HTTP Cloud Function.
// Deploy your own from the vision-ocr-fn/ folder (see README) and paste its
// URL here. Manual paste-the-JSON input works without any OCR backend.
const VISION_FN_URL =
  "https://YOUR-REGION-YOUR-PROJECT.cloudfunctions.net/ocrHttp";

/* ========= ELEMENTS ========= */
const ta = document.getElementById("cardInput");
const renderBtn = document.getElementById("renderBtn");
const examplesBtn = document.getElementById("examplesBtn");
const scanBtn = document.getElementById("scanBtn");
const CANVAS = document.getElementById("cardCanvas");

// Render at the device's pixel density so the card isn't upscaled and blurry
// on high-DPI (retina / phone) screens. CSS still controls the display size;
// only the backing store gets sharper. All drawing uses W/H/SCALE below, so it
// scales automatically - no other code needs to change. Capped at 3x.
const DPR = Math.max(1, Math.min(window.devicePixelRatio || 1, 3));
CANVAS.width = 360 * DPR;
CANVAS.height = 528 * DPR;

/* ========= RENDERING ENGINE (unchanged logic that already works well) ========= */
const W = CANVAS.width; // 360 * DPR
const H = CANVAS.height; // 528 * DPR

// Build/version tag - bumped on every handover so the latest deploy can be
// confirmed past the GitHub Pages cache. Shown subtly at the foot of the app.
const APP_VERSION = "v17";
(function () {
  const bt = document.getElementById("buildTag");
  if (bt) bt.textContent = APP_VERSION;
})();

/* ============ ARCADE SOUND (Web Audio, synthesised - no assets) ============ */
const SFX = (function () {
  let ctx = null;
  let enabled = true;
  try { enabled = localStorage.getItem("pdpc_sound") !== "off"; } catch (e) {}
  let lastPeg = 0;

  function ac() {
    if (!ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (AC) { try { ctx = new AC(); } catch (e) { ctx = null; } }
    }
    if (ctx && ctx.state === "suspended") ctx.resume();
    return ctx;
  }
  function tone(freq, dur, type, gain, delay) {
    if (!enabled) return;
    const c = ac();
    if (!c) return;
    const t = c.currentTime + (delay || 0);
    const o = c.createOscillator();
    const g = c.createGain();
    o.type = type || "square";
    o.frequency.setValueAtTime(freq, t);
    g.gain.setValueAtTime(gain || 0.05, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g);
    g.connect(c.destination);
    o.start(t);
    o.stop(t + dur + 0.02);
  }
  return {
    unlock() { ac(); },
    isEnabled() { return enabled; },
    setEnabled(v) {
      enabled = !!v;
      try { localStorage.setItem("pdpc_sound", enabled ? "on" : "off"); } catch (e) {}
      if (enabled) ac();
    },
    peg() {
      const now = (window.performance && performance.now()) || Date.now();
      if (now - lastPeg < 32) return; // throttle so it isn't machine-gun fire
      lastPeg = now;
      tone(380 + Math.random() * 520, 0.045, "square", 0.025);
    },
    drop() { tone(680, 0.09, "triangle", 0.05); },
    land(pts) {
      const base = 480 + Math.min(pts || 0, 100) * 6;
      tone(base, 0.07, "square", 0.06);
      tone(base * 1.5, 0.09, "square", 0.05, 0.07);
    },
    gameOver() {
      tone(440, 0.16, "sawtooth", 0.05, 0);
      tone(330, 0.16, "sawtooth", 0.05, 0.13);
      tone(247, 0.26, "sawtooth", 0.05, 0.26);
    },
    highScore() {
      [523, 659, 784, 1047].forEach((f, i) => tone(f, 0.14, "square", 0.05, i * 0.09));
    },
  };
})();

const suitChar = (s) =>
  ({ clubs: "♣", spades: "♠", hearts: "♥", diamonds: "♦", poo: "💩" }[
    (s || "").toLowerCase()
  ] || "?");

const isBrown = (s) => (s || "").toLowerCase() === "poo";

const isRed = (s) =>
  (s || "").toLowerCase() === "hearts" ||
  (s || "").toLowerCase() === "diamonds";

const suitColor = (s) => {
  if (isBrown(s)) return "#6B3410";
  if (isRed(s)) return "red";
  return "black";
};

/* Poo pip - drawn as a canvas path instead of text character */
/* Shape based on classic poo silhouette - three stacked blobs with swirl */
function drawPooPip(ctx, cx, cy, size) {
  ctx.save();
  ctx.translate(cx, cy);
  const sc = size / 50;
  ctx.scale(sc, sc);
  ctx.translate(-50, -50);
  ctx.beginPath();
  ctx.moveTo(20.684, 100);
  ctx.bezierCurveTo(-6.617, 100, -8.639, 62, 19.673, 60);
  ctx.bezierCurveTo(10.573, 51, 15.629, 34, 29.784, 34);
  ctx.bezierCurveTo(14.617, 11, 47.986, 32, 47.986, 0);
  ctx.bezierCurveTo(63.153, 9, 76.298, 23, 69.22, 34);
  ctx.bezierCurveTo(83.376, 34, 89.444, 51, 79.332, 60);
  ctx.bezierCurveTo(106.633, 62, 105.621, 100, 78.32, 100);
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}

/* Base 240x336 grid → scale up to canvas */
const BASE_W = 240,
  BASE_H = 336;
const SCALE = Math.min(W / BASE_W, H / BASE_H);
const S = (x) => x * SCALE;
const layoutScaled = (list) => list.map(([x, y]) => [S(x), S(y)]);

const LAYOUTS = (() => {
  const B = {
    2: [
      [120, 70],
      [120, 266],
    ],
    3: [
      [120, 70],
      [120, 168],
      [120, 266],
    ],
    4: [
      [72, 86],
      [168, 86],
      [72, 250],
      [168, 250],
    ],
    5: [
      [72, 86],
      [168, 86],
      [120, 168],
      [72, 250],
      [168, 250],
    ],
    6: [
      [72, 86],
      [168, 86],
      [72, 168],
      [168, 168],
      [72, 250],
      [168, 250],
    ],
    7: [
      [72, 86],
      [168, 86],
      [72, 168],
      [168, 168],
      [72, 250],
      [168, 250],
      [120, 140],
    ],
    8: [
      [72, 86],
      [168, 86],
      [72, 168],
      [168, 168],
      [72, 250],
      [168, 250],
      [120, 115],
      [120, 221],
    ],
    9: [
      [72, 86],
      [168, 86],
      [72, 168],
      [168, 168],
      [72, 250],
      [168, 250],
      [120, 115],
      [120, 168],
      [120, 221],
    ],
    10: [
      [72, 70],
      [168, 70],
      [72, 130],
      [168, 130],
      [72, 206],
      [168, 206],
      [72, 266],
      [168, 266],
      [120, 95],
      [120, 240],
    ],
    ace: [[120, 168]],
  };
  return Object.fromEntries(
    Object.entries(B).map(([k, v]) => [k, layoutScaled(v)])
  );
})();

const CARD_SCALE = {
  corner: 26,
  cornerSuit: 24,
  pips: 48,
  faceCenter: 104, // bigger centre letter
  cornerPad: 14,
};

/* Face card SVG images - CC0 Public Domain by Adrian Kennard (RevK) */
/* Court card artwork based on 19th Century Goodall & Son designs    */
/* Source: me.uk/cards | github.com/revk/SVG-playing-cards           */
const FACE_FILE = (rank, suit) => {
  const r = ({ jack: "J", queen: "Q", king: "K" })[rank.toLowerCase()] || "?";
  const s = ({ clubs: "C", diamonds: "D", hearts: "H", spades: "S" })[suit.toLowerCase()] || "?";
  return `faces/${r}${s}.svg`;
};
const faceCache = {};
function loadFaceImage(rank, suit) {
  const key = `${rank}-${suit}`;
  if (faceCache[key]) return Promise.resolve(faceCache[key]);
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => { faceCache[key] = img; resolve(img); };
    img.onerror = () => reject(new Error("Face image not found"));
    img.src = FACE_FILE(rank, suit);
  });
}

// Preload all 12 face-card SVGs as soon as the app loads (small files) so
// pressing Render on a jack/queen/king never has to wait on a network fetch -
// that wait, with the canvas already blanked to white, was the "did it work?"
// pause. Jokers are photos (~650-700KB each) so left on-demand, just cached
// above once loaded, rather than forced on every visitor.
(function preloadFaceImages() {
  ["jack", "queen", "king"].forEach((r) => {
    ["clubs", "diamonds", "hearts", "spades"].forEach((s) => {
      loadFaceImage(r, s).catch(() => {});
    });
  });
})();

/* Examples (file removed, per your decision) */
const EXAMPLES = {
  "Number (8♣)": { rank: "8", suit: "clubs", type: "number" },
  "Face (K♠)": { rank: "king", suit: "spades", type: "face" },
  "Ace (♦)": { rank: "ace", suit: "diamonds", type: "number" },
  Back: {
    type: "back",
    pattern: [
      "· x · x · x · x · x",
      "x · x · x · x · x ·",
      "· x · x · x · x · x",
      "x · x · x · x · x ·",
      "· x · x · x · x · x",
      "x · x · x · x · x ·",
      "· x · x · x · x · x",
      "x · x · x · x · x ·",
      "· x · x · x · x · x",
      "x · x · x · x · x ·",
      "· x · x · x · x · x",
    ],
  },
  Joker: {
    rank: "ERROR",
    suit: "HACKED",
    exploit: "<script>",
    payload: "alert(1)",
    file: "/etc/passwd",
    type: "joker1",
  },
};

// Canonical non-standard cards, matching the printed First Edition deck.
const PATCH_CARD = {
  type: "system_patch",
  help: "scan_to_use",
  version: "1.1",
  card_id: "patch_001",
  rel_chan: "1_ed",
  apply_to: "renderer",
  features: { hidden_mode: true, r_override: "exp", payload: "unlock" },
  checksum: "3fb8e38f",
};
const CREDITS_CARD = {
  type: "credits",
  maker: "DanBerg",
  edition: "first2026",
  developers: [
    "Conk", "Sayawolfram", "FukaRyu", "GodVars", "Klawkwark",
    "TG-Rex1", "MagoNicolas", "Wuby", "Stoobert", "Xantrein",
  ],
};
const JOKER_CARD = {
  rank: "ERROR",
  suit: "HACKED",
  exploit: "<script>",
  payload: "alert(1)",
  file: "/etc/passwd",
  type: "joker1",
};

/* --- helpers for text placement --- */
function drawCornerPair(ctx, rankText, suit, color, pad, cornerFont, suitFont) {
  // top-left
  ctx.save();
  ctx.fillStyle = color;
  ctx.textBaseline = "top";
  ctx.textAlign = "left";
  ctx.font = cornerFont;
  ctx.fillText(rankText, pad, pad);
  const rankW = ctx.measureText(rankText).width;
  if (isBrown(suit)) {
    drawPooPip(ctx, pad + rankW / 2, pad + parseInt(cornerFont, 10) * 1.3, S(CARD_SCALE.cornerSuit) * 0.5);
  } else {
    ctx.font = suitFont;
    ctx.textAlign = "center";
    ctx.fillText(
      suitChar(suit),
      pad + rankW / 2,
      pad + parseInt(cornerFont, 10) * 0.95
    );
  }
  ctx.restore();

  // bottom-right (rotated)
  ctx.save();
  ctx.translate(W - pad, H - pad);
  ctx.rotate(Math.PI);
  ctx.fillStyle = color;
  ctx.textBaseline = "top";
  ctx.textAlign = "left";
  ctx.font = cornerFont;
  ctx.fillText(rankText, 0, 0);
  const rankW2 = ctx.measureText(rankText).width;
  if (isBrown(suit)) {
    drawPooPip(ctx, rankW2 / 2, parseInt(cornerFont, 10) * 1.3, S(CARD_SCALE.cornerSuit) * 0.5);
  } else {
    ctx.font = suitFont;
    ctx.textAlign = "center";
    ctx.fillText(suitChar(suit), rankW2 / 2, parseInt(cornerFont, 10) * 0.95);
  }
  ctx.restore();
}

function drawPipsCentered(ctx, layout, suit, color, pipFont) {
  if (!layout || !layout.length) return;
  const xs = layout.map(([x]) => x);
  const mid = (Math.min(...xs) + Math.max(...xs)) / 2;
  const dx = W / 2 - mid;
  ctx.save();
  ctx.fillStyle = color;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.font = pipFont;
  layout.forEach(([x, y]) => ctx.fillText(suitChar(suit), x + dx, y));
  ctx.restore();
}

function drawPooPipsCentered(ctx, layout, color, pipSize) {
  if (!layout || !layout.length) return;
  const xs = layout.map(([x]) => x);
  const mid = (Math.min(...xs) + Math.max(...xs)) / 2;
  const dx = W / 2 - mid;
  ctx.save();
  ctx.fillStyle = color;
  const size = pipSize || S(CARD_SCALE.pips) * 0.5;
  layout.forEach(([x, y]) => drawPooPip(ctx, x + dx, y, size));
  ctx.restore();
}

/* ========= CREDITS ========= */
const DIGITAL_SUPPORTERS = [
  "Oly Ritchie", "Raphael", "Fabian Wiberg", "Uglen", "PauliNaumi",
  "Caroline F.", "Thalie", "GodVars", "Rayvn M.", "Russ of Veblen",
  "Lordviper33", "David J Scott", "AlNapp", "RhysWynne", "Paul Browning",
  "Pat Reaney", "DavidAult", "Iris Aurora", "JustGini", "Narrative Engine",
  "SootMonkey", "Jetarullah", "FukaclawRyu", "Stephen Short", "Sarah S.",
  "Jsbaseplayer", "John L", "Sarah Collins", "ShaunLake",
  "JelleJT", "Mark Alford", "Callmesalticidae",
];

function drawCredits(ctx) {
  ctx.clearRect(0, 0, W, H);
  ctx.fillStyle = "#000";
  ctx.fillRect(0, 0, W, H);

  const green = "#46e285";
  const orange = "#ff8800";
  const dim = "#6fb98a";
  const punc = "#828a82";
  const mono = (px) => `${Math.round(S(px))}px ui-monospace, monospace`;

  ctx.textBaseline = "alphabetic";
  ctx.textAlign = "left";

  // header
  ctx.fillStyle = orange;
  ctx.font = mono(13);
  ctx.fillText("// CREDITS", S(20), S(36));

  // digital supporters label
  ctx.fillStyle = dim;
  ctx.font = mono(9);
  ctx.fillText('"digital_supporters": [', S(20), S(58));

  // names in two columns. Nominal coords are a 240-wide grid; the row height
  // is compressed so however many names there are still leave room for the
  // face-art block + footer below, and any single over-long name is shrunk to
  // fit its own column rather than shrinking the whole list.
  const names = DIGITAL_SUPPORTERS;
  const half = Math.ceil(names.length / 2);
  const colX = [22, 122];            // nominal x of each column
  const colW = [94, 106];            // usable nominal width per column
  const startY = 74;                 // nominal y of first name row
  const namesBudgetBottom = 250;     // keep the list clear of the face-art block
  const rowH = Math.min(13, (namesBudgetBottom - startY) / Math.max(1, half - 1));
  const baseFont = Math.min(9, rowH * 0.8);
  names.forEach((n, i) => {
    const col = i < half ? 0 : 1;
    const row = col === 0 ? i : i - half;
    const x = S(colX[col]);
    const y = S(startY + row * rowH);
    const txt = `"${n}"`;
    // shrink just this entry if it would overflow its column
    let fp = baseFont;
    ctx.font = mono(fp);
    while (ctx.measureText(txt + ",").width > S(colW[col]) && fp > 4) {
      fp -= 0.5;
      ctx.font = mono(fp);
    }
    ctx.fillStyle = green;
    ctx.fillText(txt, x, y);
    ctx.fillStyle = punc;
    ctx.fillText(",", x + ctx.measureText(txt).width, y);
  });

  let y = startY + half * rowH;      // nominal
  ctx.fillStyle = dim;
  ctx.font = mono(9);
  ctx.fillText("]", S(20), S(y));

  // face card art credit (compact)
  y += 20;
  ctx.fillStyle = dim;
  ctx.font = mono(9);
  ctx.fillText('"face_card_art": [', S(20), S(y));
  y += 12;
  ctx.fillStyle = green;
  ctx.fillText('  "Adrian Kennard (RevK)",', S(20), S(y));
  y += 11;
  ctx.fillText('  "me.uk/cards"', S(20), S(y));
  y += 12;
  ctx.fillStyle = dim;
  ctx.fillText("]", S(20), S(y));

  // footer follows the content so it can never collide with it
  y += 22;
  ctx.fillStyle = dim;
  ctx.font = mono(9);
  ctx.textAlign = "center";
  ctx.fillText("// Dan Berg 2026", W / 2, S(y));
}

/* Physical credits card (type:"credits") - rendered as-is: the card's own
   JSON, syntax-highlighted like the other data screens. Distinct from the
   typed-"credits" digital-supporters easter egg above. */
function drawCreditsCard(ctx, card) {
  paintCardBase(ctx);
  const ink = "#242424";
  const cx = W / 2;
  ctx.textAlign = "center";
  ctx.textBaseline = "alphabetic";

  ctx.fillStyle = ink;
  fitText(ctx, "Credits", cx, S(62), W - S(44), 48, 700);

  const maker = !card.maker || card.maker === "DanBerg" ? "Dan Berg" : card.maker;
  fitText(ctx, "made by " + maker, cx, S(98), W - S(60), 26, 400);
  ctx.fillStyle = "#6a6a6a";
  fitText(ctx, "First Edition \u00b7 2026", cx, S(124), W - S(60), 20, 400);

  ctx.strokeStyle = "rgba(0,0,0,0.16)";
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(W * 0.26, S(146));
  ctx.lineTo(W * 0.74, S(146));
  ctx.stroke();

  ctx.fillStyle = "#4a4a4a";
  fitText(ctx, "with thanks to", cx, S(172), W - S(60), 20, 400);

  const devs = Array.isArray(card.developers) ? card.developers : [];
  ctx.fillStyle = ink;
  const colX = [W * 0.31, W * 0.69];
  const startY = S(204);
  const rowH = S(30);
  for (let i = 0; i < devs.length; i++) {
    const col = i % 2;
    const row = Math.floor(i / 2);
    fitText(ctx, String(devs[i]), colX[col], startY + row * rowH, W * 0.34, 23, 400);
  }

  ensureScriptFont(() => drawCreditsCard(ctx, card));
}

/* Instructions card - the printed card is plain comment lines, rendered as a
   green code-comment block. */
// Warm-white "paper" base + hairline frame, used by the meta cards
// (instructions, credits) so they read as notes, not deck cards.
function paintCardBase(ctx) {
  ctx.clearRect(0, 0, W, H);
  ctx.fillStyle = "#fbfaf7";
  ctx.fillRect(0, 0, W, H);
  ctx.strokeStyle = "rgba(0,0,0,0.12)";
  ctx.lineWidth = 1;
  ctx.strokeRect(S(6) + 0.5, S(6) + 0.5, W - S(12) - 1, H - S(12) - 1);
}

// Cursive font loads asynchronously; redraw once it's ready.
let scriptFontReady = false;
function scriptFont(px, weight) {
  return `${weight || 400} ${Math.round(S(px))}px "Dancing Script", "Brush Script MT", "Snell Roundhand", cursive`;
}
function ensureScriptFont(redraw) {
  if (scriptFontReady) return;
  try {
    if (document.fonts && document.fonts.load) {
      Promise.all([
        document.fonts.load('700 40px "Dancing Script"'),
        document.fonts.load('400 24px "Dancing Script"'),
      ])
        .then(() => {
          if (!scriptFontReady) {
            scriptFontReady = true;
            if (redraw) redraw();
          }
        })
        .catch(() => {});
    }
  } catch (e) {}
}

// Draw centred text, shrinking the size until it fits maxW (so no overflow
// whatever cursive font ends up loading).
function fitText(ctx, text, cx, y, maxW, basePx, weight) {
  let px = basePx;
  ctx.font = scriptFont(px, weight);
  while (ctx.measureText(text).width > maxW && px > 9) {
    px -= 1;
    ctx.font = scriptFont(px, weight);
  }
  ctx.fillText(text, cx, y);
}

function drawInstructions(ctx) {
  paintCardBase(ctx);
  const ink = "#242424";
  const cx = W / 2;
  const maxW = W - S(44);
  ctx.textAlign = "center";
  ctx.textBaseline = "alphabetic";

  ctx.fillStyle = ink;
  fitText(ctx, "Pure Data", cx, H * 0.32, maxW, 50, 700);
  fitText(ctx, "Playing Cards", cx, H * 0.32 + S(36), maxW, 32, 400);

  ctx.strokeStyle = "rgba(0,0,0,0.18)";
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(W * 0.32, H * 0.5);
  ctx.lineTo(W * 0.68, H * 0.5);
  ctx.stroke();

  fitText(ctx, "First Edition", cx, H * 0.59, maxW, 26, 400);
  ctx.fillStyle = "#5a5a5a";
  fitText(ctx, "render your cards at", cx, H * 0.67, maxW, 22, 400);
  ctx.fillStyle = ink;
  fitText(ctx, "danberg.art/puredata", cx, H * 0.725, maxW, 26, 700);

  ensureScriptFont(() => drawInstructions(ctx));
}

/* ========= SYSTEM PATCH ========= */
let patchActivated = false;

function runGlitchEffect(ctx, callback) {
  // Create fullscreen overlay for dramatic glitch
  const overlay = document.createElement("div");
  overlay.style.cssText = "position:fixed;inset:0;z-index:99999;background:#000;pointer-events:none;";
  const glitchCanvas = document.createElement("canvas");
  glitchCanvas.width = window.innerWidth;
  glitchCanvas.height = window.innerHeight;
  glitchCanvas.style.cssText = "width:100%;height:100%;";
  overlay.appendChild(glitchCanvas);
  document.body.appendChild(overlay);
  const gCtx = glitchCanvas.getContext("2d");
  const gW = glitchCanvas.width;
  const gH = glitchCanvas.height;

  let frame = 0;
  const totalFrames = 40;
  const glitch = () => {
    if (frame >= totalFrames) {
      // Fade out overlay
      overlay.style.transition = "opacity 0.4s";
      overlay.style.opacity = "0";
      setTimeout(() => { overlay.remove(); callback(); }, 400);
      return;
    }

    // Black base with green tint
    gCtx.fillStyle = `rgba(0,0,0,0.3)`;
    gCtx.fillRect(0, 0, gW, gH);

    // Horizontal slice displacement
    for (let i = 0; i < 8 + frame; i++) {
      const y = Math.floor(Math.random() * gH);
      const h = Math.floor(Math.random() * 30) + 5;
      const shift = Math.floor(Math.random() * 80) - 40;
      gCtx.fillStyle = `rgba(0,${100 + Math.random() * 155},0,${0.1 + Math.random() * 0.4})`;
      gCtx.fillRect(shift, y, gW, h);
    }

    // Bright green flash bars
    for (let i = 0; i < 3; i++) {
      gCtx.fillStyle = `rgba(0,255,0,${Math.random() * 0.5})`;
      gCtx.fillRect(0, Math.random() * gH, gW, Math.random() * 3 + 1);
    }

    // Garbled text
    gCtx.fillStyle = `rgba(0,200,80,${0.3 + Math.random() * 0.5})`;
    gCtx.font = `${12 + Math.floor(Math.random() * 16)}px ui-monospace`;
    gCtx.textAlign = "left";
    for (let i = 0; i < 3 + Math.floor(frame / 5); i++) {
      const chars = "01{}:\"system_patchPATCH-001featureunlockhiddenchecksum4fva9dc";
      let garble = "";
      for (let c = 0; c < Math.floor(Math.random() * 30) + 10; c++) {
        garble += chars[Math.floor(Math.random() * chars.length)];
      }
      gCtx.fillText(garble, Math.random() * gW * 0.8, Math.random() * gH);
    }

    // Big flash in the middle frames
    if (frame > 15 && frame < 25 && Math.random() > 0.5) {
      gCtx.fillStyle = `rgba(0,255,0,${0.1 + Math.random() * 0.2})`;
      gCtx.fillRect(0, 0, gW, gH);
    }

    frame++;
    requestAnimationFrame(glitch);
  };
  glitch();
}

/* The patch card, drawn in the deck's own visual grammar: a syntax-
   coloured JSON object (orange keys, green values) on black. */
function drawPatchCard(ctx) {
  const green = "#00cc55";
  const orange = "#ff8800";
  const punc = "#5a615a";
  const dim = "rgba(0,204,85,0.45)";
  const ink = "rgba(255,255,255,0.88)";

  ctx.clearRect(0, 0, W, H);
  ctx.fillStyle = "#000";
  ctx.fillRect(0, 0, W, H);

  // dashed frame
  ctx.strokeStyle = "rgba(0,204,85,0.30)";
  ctx.lineWidth = 1;
  ctx.setLineDash([S(4), S(4)]);
  ctx.strokeRect(S(12), S(12), W - S(24), H - S(24));
  ctx.setLineDash([]);

  const xL = S(28);
  const mono = (px) => `${Math.round(S(px))}px ui-monospace, monospace`;

  // header row: comment left, version right
  ctx.textBaseline = "alphabetic";
  ctx.textAlign = "left";
  ctx.font = mono(11);
  ctx.fillStyle = dim;
  ctx.fillText("// SYSTEM PATCH", xL, S(42));
  ctx.textAlign = "right";
  ctx.fillStyle = orange;
  ctx.fillText("v1.1", W - xL, S(42));

  // helper: draw a key/value JSON line with aligned colons
  ctx.textAlign = "left";
  const lh = S(24);
  function line(k, v, y, last) {
    let x = S(34);
    ctx.font = mono(13);
    ctx.fillStyle = orange;
    const keyText = `"${k}"`.padEnd(10);
    ctx.fillText(keyText, x, y);
    x += ctx.measureText(keyText).width;
    ctx.fillStyle = punc;
    ctx.fillText(": ", x, y);
    x += ctx.measureText(": ").width;
    ctx.fillStyle = green;
    ctx.fillText(`"${v}"`, x, y);
    x += ctx.measureText(`"${v}"`).width;
    if (!last) {
      ctx.fillStyle = punc;
      ctx.fillText(",", x, y);
    }
  }

  let y = S(92);
  ctx.font = mono(14);
  ctx.fillStyle = punc;
  ctx.fillText("{", xL, y);
  y += lh;
  line("status", "applied", y);
  y += lh;
  line("checksum", "ok", y);
  y += lh;
  line("unlocked", "plinko", y, true);
  y += lh;
  ctx.font = mono(14);
  ctx.fillStyle = punc;
  ctx.fillText("}", xL, y);

  // status check
  y += lh * 2.2;
  ctx.font = mono(12);
  ctx.fillStyle = green;
  ctx.textAlign = "center";
  ctx.fillText("\u2713 patch applied", W / 2, y);

  // call to action - centred so it can't run off an edge
  y += lh * 1.7;
  ctx.font = mono(13);
  ctx.fillStyle = orange;
  ctx.fillText("\u203a flip Plinko on to play", W / 2, y);

  // footer flavour
  ctx.font = mono(9);
  ctx.fillStyle = dim;
  ctx.fillText("3fb8e38f", W / 2, H - S(24));
}

function drawPatchActivation(ctx) {
  if (!patchActivated) {
    patchActivated = true;
    // First time: glitch, then drop straight into Plinko. No switch to flip
    // on - players turn it OFF to stop.
    runGlitchEffect(ctx, () => {
      enablePlinkoMode();
    });
  } else {
    // Already unlocked: just show the patch card. Don't auto-restart Plinko,
    // or turning the toggle off (which re-renders this card) would bounce it
    // straight back on.
    drawPatchCard(ctx);
    showToyButtons();
  }
}

/* ========= TOY BUTTONS (appear after patch) ========= */
let toyBtnsAdded = false;
let plinkoMode = false;

function showToyButtons() {
  if (toyBtnsAdded) return;
  toyBtnsAdded = true;

  const renderRow = renderBtn.parentElement;

  const plinkoToggle = document.createElement("div");
  plinkoToggle.id = "plinkoToggle";
  plinkoToggle.className = "toggle-switch";
  plinkoToggle.setAttribute("role", "switch");
  plinkoToggle.setAttribute("aria-checked", "false");
  plinkoToggle.setAttribute("tabindex", "0");
  plinkoToggle.innerHTML =
    '<span class="toggle-label">Game</span>' +
    '<span class="toggle-track"><span class="toggle-knob"></span></span>' +
    '<span class="toggle-state">OFF</span>';
  const togglePlinko = () => {
    plinkoMode = !plinkoMode;
    plinkoToggle.classList.toggle("on", plinkoMode);
    plinkoToggle.setAttribute("aria-checked", plinkoMode ? "true" : "false");
    plinkoToggle.querySelector(".toggle-state").textContent = plinkoMode ? "ON" : "OFF";
    if (plinkoMode) {
      startPlinkoFromCurrentCard();
    } else {
      stopPlinko();
      try {
        const json = ta.value.trim();
        if (json) renderCard(json);
      } catch {}
    }
  };
  plinkoToggle.addEventListener("click", togglePlinko);
  plinkoToggle.addEventListener("keydown", (e) => {
    if (e.key === " " || e.key === "Enter") { e.preventDefault(); togglePlinko(); }
  });
  renderRow.appendChild(plinkoToggle);
}

/* ========= TOYS ========= */

/* --- ASCII MODE --- */
function runAsciiMode(ctx) {
  let card;
  const raw = ta.value.trim();
  try {
    card = JSON.parse(raw);
  } catch {
    card = { rank: "7", suit: "clubs", type: "number" };
  }

  ctx.clearRect(0, 0, W, H);
  ctx.fillStyle = "#000";
  ctx.fillRect(0, 0, W, H);

  const rank = String(card.rank || "?").toUpperCase().replace(/^ACE$/, "A");
  const suit = String(card.suit || "?").toLowerCase();
  const sChar = ({ clubs: "C", spades: "S", hearts: "H", diamonds: "D", poo: "P" })[suit] || "?";
  const pip = ({ clubs: "%", spades: "^", hearts: "v", diamonds: "<>", poo: "@" })[suit] || "?";

  // Card dimensions in characters - wider to fill canvas
  const cols = 21;
  const rows = 29;

  // Calculate font size to fill the canvas
  const fontSize = Math.floor(Math.min(W / (cols * 0.6), H / (rows * 1.3)));
  const lineHeight = fontSize * 1.15;

  // Build grid
  const grid = [];
  // Top border
  grid.push("+" + "-".repeat(cols - 2) + "+");
  // Rank line
  grid.push("| " + rank.padEnd(2) + " ".repeat(cols - 7) + sChar + " |");
  // Empty line
  grid.push("|" + " ".repeat(cols - 2) + "|");

  if (card.type === "face") {
    const faceArt = {
      jack:  ["     _____     ", "    |     |    ", "    | o o |    ", "    |  -  |    ", "    |_____|    ", "      | |      ", "     _| |_     ", "    |_____|    "],
      queen: ["     _____     ", "    |     |    ", "    | o o |    ", "    |  v  |    ", "    |_____|    ", "     /| |\\     ", "    / | | \\    ", "   /__|_|__\\   "],
      king:  ["     _____     ", "    |     |    ", "    | o o |    ", "    |  =  |    ", "    |_____|    ", "    /|   |\\    ", "   / |   | \\   ", "  /__|___|__\\  "],
    };
    const art = faceArt[card.rank?.toLowerCase()] || faceArt.jack;
    const padTop = Math.floor((rows - 6 - art.length) / 2);
    for (let i = 0; i < padTop; i++) grid.push("|" + " ".repeat(cols - 2) + "|");
    art.forEach((l) => {
      const padded = l.length < cols - 2 ? l.padStart(Math.floor((cols - 2 + l.length) / 2)).padEnd(cols - 2) : l.substring(0, cols - 2);
      grid.push("|" + padded + "|");
    });
    const remaining = rows - grid.length - 3;
    for (let i = 0; i < remaining; i++) grid.push("|" + " ".repeat(cols - 2) + "|");
  } else if (card.type === "back") {
    const patternRows = rows - 6;
    for (let i = 0; i < patternRows; i++) {
      const row = i % 2 === 0
        ? " x . x . x . x . x . x . "
        : " . x . x . x . x . x . x ";
      const trimmed = row.substring(0, cols - 2).padEnd(cols - 2);
      grid.push("|" + trimmed + "|");
    }
  } else {
    // Number card with pips
    const innerRows = rows - 6;
    const innerCols = cols - 4;
    const inner = [];
    for (let i = 0; i < innerRows; i++) inner.push(" ".repeat(innerCols).split(""));

    const count = card.rank?.toLowerCase() === "ace" ? 1 : (parseInt(card.rank) || 1);
    const midR = Math.floor(innerRows / 2);
    const midC = Math.floor(innerCols / 2);
    const topR = Math.floor(innerRows * 0.15);
    const botR = Math.floor(innerRows * 0.85);
    const upR = Math.floor(innerRows * 0.33);
    const loR = Math.floor(innerRows * 0.67);
    const leftC = Math.floor(innerCols * 0.25);
    const rightC = Math.floor(innerCols * 0.75);

    const layouts = {
      1: [[midR, midC]],
      2: [[topR, midC], [botR, midC]],
      3: [[topR, midC], [midR, midC], [botR, midC]],
      4: [[topR, leftC], [topR, rightC], [botR, leftC], [botR, rightC]],
      5: [[topR, leftC], [topR, rightC], [midR, midC], [botR, leftC], [botR, rightC]],
      6: [[topR, leftC], [topR, rightC], [midR, leftC], [midR, rightC], [botR, leftC], [botR, rightC]],
      7: [[topR, leftC], [topR, rightC], [upR, midC], [midR, leftC], [midR, rightC], [botR, leftC], [botR, rightC]],
      8: [[topR, leftC], [topR, rightC], [upR, midC], [midR, leftC], [midR, rightC], [loR, midC], [botR, leftC], [botR, rightC]],
      9: [[topR, leftC], [topR, rightC], [upR, leftC], [upR, rightC], [midR, midC], [loR, leftC], [loR, rightC], [botR, leftC], [botR, rightC]],
      10: [[topR, leftC], [topR, rightC], [upR, leftC], [upR, rightC], [Math.floor(innerRows * 0.25), midC], [loR, leftC], [loR, rightC], [botR, leftC], [botR, rightC], [Math.floor(innerRows * 0.75), midC]],
    };

    const pos = layouts[count] || layouts[1];
    pos.forEach(([r, c]) => {
      if (r >= 0 && r < innerRows && c >= 0 && c < innerCols) {
        inner[r][c] = pip[0];
        if (pip.length > 1 && c + 1 < innerCols) inner[r][c + 1] = pip[1];
      }
    });

    inner.forEach((row) => grid.push("|  " + row.join("") + "  |"));
  }

  // Empty line before bottom
  grid.push("|" + " ".repeat(cols - 2) + "|");
  // Bottom rank
  grid.push("| " + sChar + " ".repeat(cols - 7) + rank.padStart(2) + " |");
  // Bottom border
  grid.push("+" + "-".repeat(cols - 2) + "+");

  // Draw the ASCII art
  const totalHeight = grid.length * lineHeight;
  const startY = (H - totalHeight) / 2 + fontSize;

  ctx.fillStyle = "#00cc55";
  ctx.font = `${fontSize}px ui-monospace`;
  ctx.textAlign = "center";

  grid.forEach((line, i) => {
    ctx.fillText(line, W / 2, startY + i * lineHeight);
  });
}

/* --- CORRUPT MODE --- */
function runCorruptMode(ctx) {
  // Get current card from textarea
  let json = ta.value.trim();
  try {
    JSON.parse(json);
  } catch {
    json = JSON.stringify({ rank: "7", suit: "clubs", type: "number" });
  }

  // First render the card normally
  renderCard(json);

  // Then progressively corrupt it
  let step = 0;
  const maxSteps = 60;
  const corrupt = () => {
    if (step >= maxSteps) return;

    const imgData = ctx.getImageData(0, 0, W, H);
    const d = imgData.data;

    // Increasing corruption per step
    const intensity = Math.floor(step * 3);

    // Pixel corruption
    for (let i = 0; i < intensity * 10; i++) {
      const px = Math.floor(Math.random() * d.length / 4) * 4;
      const ch = Math.floor(Math.random() * 3);
      d[px + ch] = (d[px + ch] + Math.floor(Math.random() * 80) - 40) & 255;
    }

    // Block displacement
    for (let i = 0; i < Math.floor(intensity / 5); i++) {
      const sy = Math.floor(Math.random() * H);
      const sh = Math.floor(Math.random() * 10) + 2;
      const shift = Math.floor(Math.random() * intensity) - intensity / 2;
      const slice = ctx.getImageData(0, sy, W, Math.min(sh, H - sy));
      ctx.putImageData(imgData, 0, 0);
      ctx.putImageData(slice, shift, sy);
    }

    ctx.putImageData(imgData, 0, 0);

    // Scan lines
    if (step > 20) {
      ctx.fillStyle = `rgba(0,0,0,${Math.random() * 0.15})`;
      for (let y = 0; y < H; y += 4) {
        ctx.fillRect(0, y, W, 1);
      }
    }

    // Data overlay - corrupted text appears
    if (step > 30) {
      ctx.fillStyle = `rgba(0,200,80,${Math.random() * 0.6})`;
      ctx.font = `${Math.round(S(8))}px ui-monospace`;
      ctx.textAlign = "left";
      for (let i = 0; i < Math.floor(step / 10); i++) {
        const chars = "0123456789abcdef{}:\",.nullundefined";
        let garble = "";
        for (let c = 0; c < Math.floor(Math.random() * 20) + 5; c++) {
          garble += chars[Math.floor(Math.random() * chars.length)];
        }
        ctx.fillText(garble, Math.random() * W * 0.8, Math.random() * H);
      }
    }

    step++;
    setTimeout(corrupt, 80);
  };

  // Start corruption after a brief pause so the card renders first
  setTimeout(corrupt, 500);
}

/* --- PLINKO MODE --- */
let plinkoHighScore = 0;
let plinkoHighCard = ""; // which card the high score was set on
let plinkoCurrentCard = ""; // card the current game is played on
let plinkoAnimId = null;

// Short label for a card, e.g. "7♠" / "A♦" - used on the scoreboard.
function cardShortLabel(card) {
  if (!card || typeof card !== "object") return "";
  const sym = { clubs: "\u2663", spades: "\u2660", hearts: "\u2665", diamonds: "\u2666" };
  const r = String(card.rank || "").toUpperCase();
  const rank = r === "ACE" ? "A" : r;
  return rank + (sym[String(card.suit || "").toLowerCase()] || "");
}
let plinkoDropBtn = null;
let plinkoState = null;

function stopPlinko() {
  if (plinkoAnimId) { cancelAnimationFrame(plinkoAnimId); plinkoAnimId = null; }
  if (plinkoDropBtn) { plinkoDropBtn.style.display = "none"; }
  const scores = document.getElementById("plinkoScores");
  if (scores) scores.hidden = true;
  const dropRow = document.getElementById("plinkoDropRow");
  if (dropRow) dropRow.hidden = true;
  if (typeof lbClose === "function") lbClose();
  plinkoState = null;
}

function isPlayableNumber(card) {
  if (!card || typeof card !== "object") return false;
  if (String(card.type).toLowerCase() !== "number") return false;
  const r = String(card.rank || "").toLowerCase();
  return r === "ace" || /^\d+$/.test(r);
}

function randomNumberCard() {
  const ranks = ["2", "3", "4", "5", "6", "7", "8", "9", "10"];
  const suits = ["clubs", "spades", "hearts", "diamonds"];
  return {
    rank: ranks[Math.floor(Math.random() * ranks.length)],
    suit: suits[Math.floor(Math.random() * suits.length)],
    type: "number",
  };
}

function plinkoGameInProgress() {
  return !!(
    plinkoState &&
    plinkoState.balls &&
    plinkoState.balls.length > 0 &&
    !plinkoState.roundOver
  );
}

function startPlinkoFromCurrentCard() {
  // Warn before discarding a game that's under way.
  if (plinkoGameInProgress()) {
    const ok = window.confirm(
      "Loading a new card will reset your current Plinko game. Continue?"
    );
    if (!ok) return;
  }
  let card;
  try {
    card = JSON.parse(ta.value.trim());
  } catch {
    card = null;
  }
  // Plinko needs a number card. If the current card is a face, back, words,
  // or anything non-numeric, play over a random number card instead.
  if (!isPlayableNumber(card)) card = randomNumberCard();
  plinkoCurrentCard = cardShortLabel(card);
  runPlinkoMode(CANVAS.getContext("2d"), card);
}

// Turn Plinko on automatically (used when the System Patch is applied).
function enablePlinkoMode() {
  showToyButtons();
  plinkoMode = true;
  const tgl = document.getElementById("plinkoToggle");
  if (tgl) {
    tgl.classList.add("on");
    tgl.setAttribute("aria-checked", "true");
    const st = tgl.querySelector(".toggle-state");
    if (st) st.textContent = "ON";
  }
  startPlinkoFromCurrentCard();
  showGameIntro();
}

/* Arcade-style end-of-round scoreboard in the pure-data aesthetic: an opaque
   black panel, monospace, orange labels and bright-green score, with corner
   brackets for an arcade feel. */
function drawScoreboard(ctx, score, high, highCard) {
  const isNewHigh = score >= high && score > 0;
  const pw = S(216);
  const ph = isNewHigh ? S(168) : S(146);
  const px = (W - pw) / 2;
  const py = (H - ph) / 2;
  const orange = "#ff8800";
  const green = "#46e285";
  const dim = "#7c8a7c";
  const mono = (n) => `${Math.round(S(n))}px ui-monospace, monospace`;

  ctx.save();
  ctx.textAlign = "center";
  ctx.textBaseline = "alphabetic";

  // opaque rounded panel + orange border
  const r = S(12);
  ctx.beginPath();
  ctx.moveTo(px + r, py);
  ctx.arcTo(px + pw, py, px + pw, py + ph, r);
  ctx.arcTo(px + pw, py + ph, px, py + ph, r);
  ctx.arcTo(px, py + ph, px, py, r);
  ctx.arcTo(px, py, px + pw, py, r);
  ctx.closePath();
  ctx.fillStyle = "#08090a";
  ctx.fill();
  ctx.lineWidth = S(2);
  ctx.strokeStyle = orange;
  ctx.stroke();

  // arcade corner brackets
  ctx.strokeStyle = green;
  ctx.lineWidth = S(2);
  const b = S(12);
  const ins = S(9);
  [
    [px + ins, py + ins, 1, 1],
    [px + pw - ins, py + ins, -1, 1],
    [px + ins, py + ph - ins, 1, -1],
    [px + pw - ins, py + ph - ins, -1, -1],
  ].forEach(([cx, cy, sx, sy]) => {
    ctx.beginPath();
    ctx.moveTo(cx, cy + sy * b);
    ctx.lineTo(cx, cy);
    ctx.lineTo(cx + sx * b, cy);
    ctx.stroke();
  });

  // title
  ctx.fillStyle = orange;
  ctx.font = `bold ${mono(13)}`;
  ctx.fillText("GAME OVER", W / 2, py + S(30));

  // divider
  ctx.strokeStyle = "rgba(255,136,0,0.35)";
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(px + S(22), py + S(40));
  ctx.lineTo(px + pw - S(22), py + S(40));
  ctx.stroke();

  // SCORE label + big value
  ctx.fillStyle = dim;
  ctx.font = mono(9);
  ctx.fillText("SCORE", W / 2, py + S(58));
  ctx.fillStyle = green;
  ctx.font = `bold ${mono(40)}`;
  ctx.fillText(String(score), W / 2, py + S(102));

  // HIGH row (with the card the record was set on)
  ctx.fillStyle = dim;
  ctx.font = mono(10);
  const highLine = highCard ? `HIGH ${high}  ON ${highCard}` : `HIGH   ${high}`;
  ctx.fillText(highLine, W / 2, py + S(126));

  // new-high banner
  if (isNewHigh) {
    ctx.fillStyle = green;
    ctx.font = `bold ${mono(11)}`;
    ctx.fillText("\u2605 NEW HIGH SCORE \u2605", W / 2, py + S(150));
  }

  ctx.restore();
}

/* ============ GLOBAL LEADERBOARD (Supabase) ============ */
// The leaderboard and bug-report form are OPTIONAL. They talk to a Supabase
// project via its public "publishable" key (safe to ship - row-level security
// guards the data). To enable them, create your own Supabase project and paste
// its URL + publishable key here (see README). Left as placeholders, these
// features simply do nothing; card rendering and scanning are unaffected.
const SUPABASE_URL = "https://YOUR-PROJECT.supabase.co";
const SUPABASE_KEY = "sb_publishable_YOUR_PUBLISHABLE_KEY";

// Best-effort client-side nickname guard (not exhaustive). Server also caps
// length (1-12) and score (<=5000) so forged requests can't store junk values.
const BAD_WORDS = [
  "fuck", "shit", "cunt", "bitch", "nigger", "nigga", "faggot", "retard",
  "rape", "slut", "whore", "dick", "cock", "pussy", "wank", "twat",
];
function cleanNickname(raw) {
  const n = String(raw || "").trim().replace(/\s+/g, " ").slice(0, 12);
  if (!n) return null;
  const low = n.toLowerCase().replace(/[^a-z]/g, "");
  for (const w of BAD_WORDS) if (low.includes(w)) return null;
  return n;
}

function escHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])
  );
}

async function submitScore(nickname, score, card) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/pure_data_scores`, {
    method: "POST",
    headers: {
      apikey: SUPABASE_KEY,
      Authorization: `Bearer ${SUPABASE_KEY}`,
      "Content-Type": "application/json",
      Prefer: "return=minimal",
    },
    body: JSON.stringify({ nickname, score, card: card || null }),
  });
  if (!res.ok) throw new Error("Submit failed (" + res.status + ")");
}

async function fetchLeaderboard() {
  const res = await fetch(
    `${SUPABASE_URL}/rest/v1/pure_data_scores?select=nickname,score,card&order=score.desc,created_at.asc&limit=10`,
    { headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` } }
  );
  if (!res.ok) throw new Error("Could not load leaderboard (" + res.status + ")");
  return res.json();
}

function lbClose() {
  const o = document.getElementById("lbOverlay");
  if (o) o.remove();
}
function lbBuild(inner) {
  lbClose();
  const o = document.createElement("div");
  o.id = "lbOverlay";
  o.className = "lb-overlay";
  o.innerHTML = `<div class="lb-panel">${inner}</div>`;
  document.body.appendChild(o);
  o.addEventListener("click", (e) => { if (e.target === o) lbClose(); });
  return o;
}

function showSubmitOverlay(score, card) {
  const o = lbBuild(`
    <div class="lb-title">SUBMIT SCORE</div>
    <div class="lb-sub">SCORE <b>${score}</b>${card ? "  &middot;  " + escHtml(card) : ""}</div>
    <input id="lbNick" class="lb-input" maxlength="12" placeholder="NICKNAME" autocomplete="off" spellcheck="false" />
    <div class="lb-msg" id="lbMsg"></div>
    <div class="lb-btns">
      <button class="btn" id="lbCancel">CANCEL</button>
      <button class="btn primary" id="lbSend">SUBMIT</button>
    </div>
  `);
  const nick = o.querySelector("#lbNick");
  const msg = o.querySelector("#lbMsg");
  nick.focus();
  o.querySelector("#lbCancel").addEventListener("click", lbClose);
  const send = o.querySelector("#lbSend");
  send.addEventListener("click", async () => {
    const clean = cleanNickname(nick.value);
    if (!clean) { msg.textContent = "Enter a clean nickname (1-12 characters)."; return; }
    send.disabled = true;
    msg.textContent = "Submitting...";
    try {
      await submitScore(clean, score, card);
      showLeaderboardOverlay(clean);
    } catch (e) {
      send.disabled = false;
      msg.textContent = e.message || "Submit failed.";
    }
  });
  nick.addEventListener("keydown", (e) => { if (e.key === "Enter") send.click(); });
}

function lbRenderRows(list, rows, highlightNick) {
  if (!rows.length) { list.textContent = "No scores yet - be the first!"; return; }
  list.innerHTML = rows
    .map((r, i) => {
      const hl = highlightNick && r.nickname === highlightNick ? " lb-hl" : "";
      const rank = String(i + 1).padStart(2, "0");
      const nm = escHtml(String(r.nickname || "").toUpperCase());
      const cd = r.card ? `<span class="lb-card">${escHtml(r.card)}</span>` : "";
      return `<div class="lb-rowline${hl}"><span class="lb-rank">${rank}</span><span class="lb-nm">${nm}</span>${cd}<span class="lb-sc">${r.score}</span></div>`;
    })
    .join("");
}

// One row per card showing that card's record; sorted by best score.
async function fetchCardRecords() {
  const res = await fetch(
    `${SUPABASE_URL}/rest/v1/pure_data_scores?select=nickname,score,card&order=score.desc,created_at.asc&limit=300`,
    { headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` } }
  );
  if (!res.ok) throw new Error("Could not load (" + res.status + ")");
  const rows = await res.json();
  const best = new Map();
  for (const r of rows) {
    if (r.card && !best.has(r.card)) best.set(r.card, r); // first seen = highest
  }
  return Array.from(best.values());
}

async function fetchCardBoard(card) {
  const res = await fetch(
    `${SUPABASE_URL}/rest/v1/pure_data_scores?select=nickname,score,card&card=eq.${encodeURIComponent(card)}&order=score.desc,created_at.asc&limit=10`,
    { headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` } }
  );
  if (!res.ok) throw new Error("Could not load (" + res.status + ")");
  return res.json();
}

async function showLeaderboardOverlay(highlightNick, mode) {
  mode = mode || "overall";
  const o = lbBuild(`
    <div class="lb-title">TOP SCORES</div>
    <div class="lb-tabs">
      <button class="lb-tab${mode === "overall" ? " on" : ""}" id="tabOverall">OVERALL</button>
      <button class="lb-tab${mode !== "overall" ? " on" : ""}" id="tabByCard">BY CARD</button>
    </div>
    <div class="lb-list" id="lbList">loading...</div>
    <div class="lb-btns"><button class="btn primary" id="lbCloseBtn">CLOSE</button></div>
  `);
  o.querySelector("#lbCloseBtn").addEventListener("click", lbClose);
  o.querySelector("#tabOverall").addEventListener("click", () => showLeaderboardOverlay(highlightNick, "overall"));
  o.querySelector("#tabByCard").addEventListener("click", () => showLeaderboardOverlay(highlightNick, "bycard"));
  const list = o.querySelector("#lbList");
  try {
    if (mode === "overall") {
      lbRenderRows(list, await fetchLeaderboard(), highlightNick);
    } else {
      const recs = await fetchCardRecords();
      if (!recs.length) { list.textContent = "No card scores yet."; return; }
      list.innerHTML = recs
        .map((r) => {
          const cd = escHtml(r.card);
          const nm = escHtml(String(r.nickname || "").toUpperCase());
          return `<div class="lb-rowline lb-cardrow" data-card="${cd}"><span class="lb-card lb-cardbig">${cd}</span><span class="lb-nm">${nm}</span><span class="lb-sc">${r.score}</span><span class="lb-chev">›</span></div>`;
        })
        .join("");
      list.querySelectorAll(".lb-cardrow").forEach((row) => {
        row.addEventListener("click", () => showCardBoard(row.getAttribute("data-card")));
      });
    }
  } catch (e) {
    list.textContent = e.message || "Could not load leaderboard.";
  }
}

async function showCardBoard(card) {
  const o = lbBuild(`
    <div class="lb-title">CARD ${escHtml(card)}</div>
    <div class="lb-tabs"><button class="lb-tab" id="backByCard">&lsaquo; all cards</button></div>
    <div class="lb-list" id="lbList">loading...</div>
    <div class="lb-btns"><button class="btn primary" id="lbCloseBtn">CLOSE</button></div>
  `);
  o.querySelector("#lbCloseBtn").addEventListener("click", lbClose);
  o.querySelector("#backByCard").addEventListener("click", () => showLeaderboardOverlay(null, "bycard"));
  const list = o.querySelector("#lbList");
  try {
    lbRenderRows(list, await fetchCardBoard(card), null);
  } catch (e) {
    list.textContent = e.message || "Could not load.";
  }
}

// Intro shown when Game mode is unlocked via the patch card.
function showGameIntro() {
  const o = lbBuild(`
    <div class="lb-title">GAME MODE ACTIVATED</div>
    <div class="lb-intro">
      Drop five balls to rack up a score.<br><br>
      Any card with pips can act as the playing surface - scan or load one,
      then use the <b>Game</b> switch to play.
    </div>
    <div class="lb-btns"><button class="btn primary" id="lbGo">GOT IT</button></div>
  `);
  o.querySelector("#lbGo").addEventListener("click", lbClose);
}

// ---- Report a bug ----
async function submitBugReport(message, contact) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/bug_reports`, {
    method: "POST",
    headers: {
      apikey: SUPABASE_KEY,
      Authorization: `Bearer ${SUPABASE_KEY}`,
      "Content-Type": "application/json",
      Prefer: "return=minimal",
    },
    body: JSON.stringify({ message, contact: contact || null }),
  });
  if (!res.ok) throw new Error("Could not send (" + res.status + ")");
}

function showBugReport() {
  const o = lbBuild(`
    <div class="lb-title">REPORT A BUG</div>
    <div class="lb-sub">Spotted something broken? Tell us.</div>
    <textarea id="bugMsg" class="lb-textarea" maxlength="2000" placeholder="What happened?" spellcheck="true"></textarea>
    <input id="bugContact" class="lb-input2" maxlength="200" placeholder="Email or @handle (optional)" autocomplete="off" />
    <div class="lb-msg" id="bugErr"></div>
    <div class="lb-btns">
      <button class="btn" id="bugCancel">CANCEL</button>
      <button class="btn primary" id="bugSend">SEND</button>
    </div>
  `);
  const msg = o.querySelector("#bugMsg");
  const contact = o.querySelector("#bugContact");
  const err = o.querySelector("#bugErr");
  msg.focus();
  o.querySelector("#bugCancel").addEventListener("click", lbClose);
  const send = o.querySelector("#bugSend");
  send.addEventListener("click", async () => {
    const m = msg.value.trim();
    if (!m) { err.textContent = "Please describe the bug first."; return; }
    send.disabled = true;
    err.textContent = "Sending...";
    try {
      await submitBugReport(m.slice(0, 2000), contact.value.trim().slice(0, 200));
      const panel = o.querySelector(".lb-panel");
      panel.innerHTML =
        '<div class="lb-title">THANK YOU</div>' +
        '<div class="lb-intro">Your report was sent. Cheers for helping.</div>' +
        '<div class="lb-btns"><button class="btn primary" id="bugDone">CLOSE</button></div>';
      panel.querySelector("#bugDone").addEventListener("click", lbClose);
    } catch (e) {
      send.disabled = false;
      err.textContent = e.message || "Send failed - please try again.";
    }
  });
}

// Load the digital credits card as if it were scanned (another way in,
// besides typing "credits"). Exits Game mode first if it's on.
function loadCreditsCard() {
  if (plinkoMode) {
    plinkoMode = false;
    const tgl = document.getElementById("plinkoToggle");
    if (tgl) {
      tgl.classList.remove("on");
      tgl.setAttribute("aria-checked", "false");
      const st = tgl.querySelector(".toggle-state");
      if (st) st.textContent = "OFF";
    }
    stopPlinko();
  }
  // Same digital-supporters easter egg as typing "credits" in the box - not
  // the printed developer-credits card (that's the physical card's own JSON,
  // shown when the physical card itself is scanned).
  ta.value = "credits";
  drawCredits(CANVAS.getContext("2d"));
}

(function () {
  const bb = document.getElementById("bugBtn");
  if (bb) bb.addEventListener("click", showBugReport);
  const cb = document.getElementById("creditsBtn");
  if (cb) cb.addEventListener("click", loadCreditsCard);
})();

function runPlinkoMode(ctx, card) {  // Stop any existing game
  if (plinkoAnimId) { cancelAnimationFrame(plinkoAnimId); plinkoAnimId = null; }

  // Make sure the card is currently rendered on the canvas, then snapshot it
  // so we can show it behind the Plinko playfield each frame.
  try { renderCard(JSON.stringify(card)); } catch {}
  const cardSnapshot = document.createElement("canvas");
  cardSnapshot.width = CANVAS.width;
  cardSnapshot.height = CANVAS.height;
  cardSnapshot.getContext("2d").drawImage(CANVAS, 0, 0);

  const rank = String(card.rank || "7").toLowerCase();
  const suit = String(card.suit || "clubs").toLowerCase();
  const color = suitColor(suit);

  // Get pip positions for this card
  const layout = LAYOUTS[rank] || LAYOUTS["7"];
  if (!layout || !layout.length) {
    ctx.clearRect(0, 0, W, H);
    ctx.fillStyle = "#111";
    ctx.fillRect(0, 0, W, H);
    ctx.textAlign = "center";
    ctx.fillStyle = "#00cc55";
    ctx.font = `${Math.round(S(12))}px ui-monospace`;
    ctx.fillText("need a number card for plinko", W / 2, H / 2);
    return;
  }

  // Centre pegs
  const xs = layout.map(([x]) => x);
  const mid = (Math.min(...xs) + Math.max(...xs)) / 2;
  const ddx = W / 2 - mid;
  const pegs = layout.map(([x, y]) => [x + ddx, y]);

  // Physics
  const pegRadius = S(12);
  const ballRadius = S(7);
  const gravity = 0.18;
  const bounceFactor = 0.55;
  const friction = 0.995;

  // Slots — shifted up so suit-colored score labels can sit BENEATH the buckets
  const slotCount = 7;
  const slotWidth = W / slotCount;
  const slotY = H - S(60);
  const slotScores = [10, 25, 50, 100, 50, 25, 10];
  const slotFloor = H - S(28);

  // Launcher - moves left/right (25% faster than before)
  let launcherX = W / 2;
  let launcherDir = 2.156;
  const launcherY = S(18);
  // Carries fractional physics sub-steps across frames (see SPEED below).
  let stepAcc = 0;

  // Game state
  plinkoState = {
    balls: [],
    landed: [],
    ballsRemaining: 5,
    score: 0,
    popups: [],
    roundOver: false,
  };
  const st = plinkoState;

  // Show score chips + drop row
  const scoresEl = document.getElementById("plinkoScores");
  const dropRow = document.getElementById("plinkoDropRow");
  if (scoresEl) scoresEl.hidden = false;
  if (dropRow) dropRow.hidden = false;

  // Create or reuse drop button (in its own row below the canvas)
  if (!plinkoDropBtn) {
    plinkoDropBtn = document.createElement("button");
    plinkoDropBtn.id = "plinkoDropBtn";
    plinkoDropBtn.className = "btn primary";
    plinkoDropBtn.style.background = "#ff8800";
    plinkoDropBtn.style.borderColor = "#ff8800";
    plinkoDropBtn.style.color = "#000";
    plinkoDropBtn.style.fontWeight = "600";
    plinkoDropBtn.style.letterSpacing = "1px";
    plinkoDropBtn.style.padding = "12px 28px";
  }
  if (dropRow && plinkoDropBtn.parentNode !== dropRow) {
    dropRow.appendChild(plinkoDropBtn);
  }
  plinkoDropBtn.textContent = "DROP BALL";
  plinkoDropBtn.disabled = false;
  plinkoDropBtn.style.display = "inline-block";

  // Fresh click handler
  const newBtn = plinkoDropBtn.cloneNode(true);
  plinkoDropBtn.parentNode.replaceChild(newBtn, plinkoDropBtn);
  plinkoDropBtn = newBtn;

  // Submit-score button (hidden until the round is over), then Leaderboard
  // button (always available). Both live in the drop row.
  let subBtn = document.getElementById("plinkoSubmitBtn");
  if (!subBtn) {
    subBtn = document.createElement("button");
    subBtn.id = "plinkoSubmitBtn";
    subBtn.className = "btn primary";
    subBtn.textContent = "SUBMIT SCORE";
  }
  if (dropRow && subBtn.parentNode !== dropRow) dropRow.appendChild(subBtn);
  subBtn.style.display = "none";
  const newSub = subBtn.cloneNode(true);
  subBtn.parentNode.replaceChild(newSub, subBtn);
  newSub.addEventListener("click", () => showSubmitOverlay(st.score, plinkoCurrentCard));

  let lbBtn = document.getElementById("plinkoLbBtn");
  if (!lbBtn) {
    lbBtn = document.createElement("button");
    lbBtn.id = "plinkoLbBtn";
    lbBtn.className = "btn";
    lbBtn.textContent = "LEADERBOARD";
    lbBtn.addEventListener("click", () => showLeaderboardOverlay());
  }
  if (dropRow && lbBtn.parentNode !== dropRow) dropRow.appendChild(lbBtn);

  // Sound on/off toggle, sits with the score chips
  let sndBtn = document.getElementById("plinkoSoundBtn");
  if (!sndBtn) {
    sndBtn = document.createElement("button");
    sndBtn.id = "plinkoSoundBtn";
    sndBtn.className = "snd-btn";
    sndBtn.type = "button";
    const syncSnd = () => {
      sndBtn.textContent = SFX.isEnabled() ? "SFX ON" : "SFX OFF";
      sndBtn.classList.toggle("off", !SFX.isEnabled());
    };
    syncSnd();
    sndBtn.addEventListener("click", () => {
      SFX.setEnabled(!SFX.isEnabled());
      syncSnd();
    });
    const scoresEl = document.getElementById("plinkoScores");
    if (scoresEl) scoresEl.appendChild(sndBtn);
  }

  plinkoDropBtn.addEventListener("click", () => {
    if (st.roundOver) {
      // Reset
      st.balls = [];
      st.landed = [];
      st.ballsRemaining = 5;
      st.score = 0;
      st.popups = [];
      st.roundOver = false;
      plinkoDropBtn.textContent = "DROP BALL";
      plinkoDropBtn.disabled = false;
      const sb = document.getElementById("plinkoSubmitBtn");
      if (sb) sb.style.display = "none";
      return;
    }
    if (st.ballsRemaining <= 0) return;
    st.ballsRemaining--;
    if (st.ballsRemaining <= 0) plinkoDropBtn.disabled = true;

    // Drop from current launcher position
    st.balls.push({
      x: launcherX,
      y: launcherY + S(10),
      vx: (Math.random() - 0.5) * 0.5,
      vy: 0,
      active: true,
      trail: [],
    });
    SFX.drop();
  });

  function draw() {
    // Draw the card snapshot as the background — no tint, card shows normally
    ctx.clearRect(0, 0, W, H);
    ctx.drawImage(cardSnapshot, 0, 0, W, H);

    // Move launcher
    launcherX += launcherDir;
    if (launcherX > W - S(30)) launcherDir = -Math.abs(launcherDir);
    if (launcherX < S(30)) launcherDir = Math.abs(launcherDir);

    // Draw launcher — suit-colored
    ctx.strokeStyle = color;
    ctx.lineWidth = 2;
    // Rail
    ctx.beginPath();
    ctx.moveTo(S(20), launcherY);
    ctx.lineTo(W - S(20), launcherY);
    ctx.stroke();
    // Carriage
    ctx.fillStyle = color;
    ctx.fillRect(launcherX - S(12), launcherY - S(4), S(24), S(8));
    // Nozzle
    ctx.fillStyle = color;
    ctx.fillRect(launcherX - S(3), launcherY + S(2), S(6), S(10));
    // Indicator dot (white so it stands out against the carriage)
    ctx.beginPath();
    ctx.arc(launcherX, launcherY, S(3), 0, Math.PI * 2);
    ctx.fillStyle = "#fff";
    ctx.fill();
    ctx.strokeStyle = color;
    ctx.lineWidth = 1;
    ctx.stroke();

    // Draw pegs as suit symbols
    pegs.forEach(([px, py]) => {
      ctx.fillStyle = color;
      if (isBrown(suit)) {
        drawPooPip(ctx, px, py, pegRadius * 1.8);
      } else {
        ctx.font = `${Math.round(pegRadius * 2)}px ui-monospace`;
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText(suitChar(suit), px, py);
      }
    });

    // Draw slot dividers — stop at the floor so score labels beneath sit clean
    ctx.strokeStyle = color;
    ctx.lineWidth = 1.5;
    for (let i = 0; i <= slotCount; i++) {
      const sx = i * slotWidth;
      ctx.beginPath();
      ctx.moveTo(sx, slotY);
      ctx.lineTo(sx, slotFloor);
      ctx.stroke();
    }
    // Clean white band behind the score row so the card's corner pips
    // (e.g. the rotated rank/suit in the bottom corner) can't bleed into the
    // labels and make them unreadable. Invisible against the white card.
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, slotFloor, W, H - slotFloor);

    // Slot floor
    ctx.strokeStyle = color;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(0, slotFloor);
    ctx.lineTo(W, slotFloor);
    ctx.stroke();
    // Slot labels — large, BENEATH the buckets, suit-colored
    ctx.font = `bold ${Math.round(S(14))}px ui-monospace`;
    ctx.textAlign = "center";
    ctx.textBaseline = "top";
    for (let i = 0; i < slotCount; i++) {
      // nudge the two edge labels inward so they clear the card border
      let lx = i * slotWidth + slotWidth / 2;
      if (i === 0) lx += S(6);
      if (i === slotCount - 1) lx -= S(6);
      ctx.fillStyle = color;
      ctx.fillText(String(slotScores[i]), lx, slotFloor + S(4));
    }

    // Draw walls — only down to the bucket floor so suit-colored labels below sit clean
    ctx.strokeStyle = color;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(0, launcherY);
    ctx.lineTo(0, slotFloor);
    ctx.moveTo(W, launcherY);
    ctx.lineTo(W, slotFloor);
    ctx.stroke();

    // Draw landed balls (sitting in slots) — suit-colored
    st.landed.forEach((lb) => {
      ctx.beginPath();
      ctx.arc(lb.x, lb.y, ballRadius, 0, Math.PI * 2);
      ctx.fillStyle = color;
      ctx.fill();
      ctx.strokeStyle = "#fff";
      ctx.lineWidth = 1;
      ctx.stroke();
    });

    // Physics runs sub-steps per frame for speed without tunnelling. SPEED is
    // the average sub-steps/frame; a carried accumulator allows a fractional
    // value (1.75 = half the previous 3.5).
    const SPEED = 1.75;
    stepAcc += SPEED;
    const steps = Math.floor(stepAcc);
    stepAcc -= steps;
    for (let step = 0; step < steps; step++) {
      // Ball-to-ball collisions: equal-mass elastic response.
      for (let i = 0; i < st.balls.length; i++) {
        const a = st.balls[i];
        if (!a.active) continue;
        for (let j = i + 1; j < st.balls.length; j++) {
          const b = st.balls[j];
          if (!b.active) continue;
          const dx = b.x - a.x;
          const dy = b.y - a.y;
          const dist = Math.hypot(dx, dy);
          const minDist = ballRadius * 2;
          if (dist > 0 && dist < minDist) {
            const nx = dx / dist;
            const ny = dy / dist;
            const overlap = (minDist - dist) / 2;
            a.x -= nx * overlap;
            a.y -= ny * overlap;
            b.x += nx * overlap;
            b.y += ny * overlap;
            const vn = (b.vx - a.vx) * nx + (b.vy - a.vy) * ny;
            if (vn < 0) {
              const imp = (-(1 + bounceFactor) * vn) / 2;
              a.vx -= imp * nx;
              a.vy -= imp * ny;
              b.vx += imp * nx;
              b.vy += imp * ny;
            }
          }
        }
      }

      // Move + resolve each active ball
      st.balls.forEach((ball) => {
        if (!ball.active) return;

        ball.vy += gravity;
        ball.vx *= friction;
        ball.x += ball.vx;
        ball.y += ball.vy;

        ball.trail.push([ball.x, ball.y]);
        if (ball.trail.length > 18) ball.trail.shift();

        // Peg collision
        pegs.forEach(([px, py]) => {
          const bx = ball.x - px;
          const by = ball.y - py;
          const dist = Math.sqrt(bx * bx + by * by);
          const minDist = pegRadius + ballRadius;
          if (dist < minDist && dist > 0) {
            const nx = bx / dist;
            const ny = by / dist;
            ball.x = px + nx * minDist;
            ball.y = py + ny * minDist;
            const dot = ball.vx * nx + ball.vy * ny;
            ball.vx -= 2 * dot * nx;
            ball.vy -= 2 * dot * ny;
            ball.vx *= bounceFactor;
            ball.vy *= bounceFactor;
            ball.vx += (Math.random() - 0.5) * 1.2;
            SFX.peg();
          }
        });

        // Wall bounce
        if (ball.x < ballRadius) { ball.x = ballRadius; ball.vx = Math.abs(ball.vx) * bounceFactor; }
        if (ball.x > W - ballRadius) { ball.x = W - ballRadius; ball.vx = -Math.abs(ball.vx) * bounceFactor; }

        // Landed in slot - rests where it lands (not snapped to centre)
        if (ball.y >= slotFloor - ballRadius) {
          ball.active = false;
          const lx = Math.max(ballRadius, Math.min(W - ballRadius, ball.x));
          const slotIdx = Math.min(slotCount - 1, Math.max(0, Math.floor(lx / slotWidth)));
          const pts = slotScores[slotIdx];
          st.score += pts;
          SFX.land(pts);
          // Rest at the landing x; stack on top of any ball already there.
          let landY = slotFloor - ballRadius;
          st.landed.forEach((lb) => {
            if (Math.abs(lb.x - lx) < ballRadius * 1.8) {
              landY = Math.min(landY, lb.y - ballRadius * 1.8);
            }
          });
          st.landed.push({ x: lx, y: landY });
          st.popups.push({ x: lx, y: slotY - S(10), pts, fade: 40 });
        }
      });
    }

    // Draw active balls once per frame (after the physics sub-steps)
    st.balls.forEach((ball) => {
      if (!ball.active) return;
      if (ball.trail.length > 1) {
        ctx.strokeStyle = "rgba(255,255,255,0.1)";
        ctx.lineWidth = ballRadius * 0.8;
        ctx.lineCap = "round";
        ctx.beginPath();
        ctx.moveTo(ball.trail[0][0], ball.trail[0][1]);
        ball.trail.forEach(([tx, ty]) => ctx.lineTo(tx, ty));
        ctx.stroke();
      }
      ctx.beginPath();
      ctx.arc(ball.x, ball.y, ballRadius, 0, Math.PI * 2);
      ctx.fillStyle = color;
      ctx.fill();
      ctx.strokeStyle = "#fff";
      ctx.lineWidth = 1.5;
      ctx.stroke();
    });

    // Score popups — suit-colored
    st.popups = st.popups.filter((p) => {
      p.fade--;
      if (p.fade <= 0) return false;
      ctx.globalAlpha = p.fade / 40;
      ctx.fillStyle = color;
      ctx.font = `bold ${Math.round(S(12))}px ui-monospace`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(`+${p.pts}`, p.x, p.y - (40 - p.fade) * 1.2);
      ctx.globalAlpha = 1;
      return true;
    });

    // Update score display in the DOM (outside the canvas)
    const scoreEl = document.getElementById("plinkoScoreVal");
    const highEl = document.getElementById("plinkoHighVal");
    if (scoreEl) scoreEl.textContent = st.score;
    if (highEl) highEl.textContent = plinkoHighScore;
    const ballsEl = document.getElementById("plinkoBallsVal");
    if (ballsEl) ballsEl.textContent = st.ballsRemaining;

    // Round over check
    const allDone = st.ballsRemaining <= 0 && st.balls.length > 0 && st.balls.every((b) => !b.active);
    if (allDone && !st.roundOver) {
      st.roundOver = true;
      const newHigh = st.score > plinkoHighScore && st.score > 0;
      if (newHigh) {
        plinkoHighScore = st.score;
        plinkoHighCard = plinkoCurrentCard;
      }
      plinkoDropBtn.textContent = "AGAIN";
      plinkoDropBtn.disabled = false;
      const sb = document.getElementById("plinkoSubmitBtn");
      if (sb) sb.style.display = "inline-block";
      if (newHigh) SFX.highScore(); else SFX.gameOver();
    }

    if (st.roundOver) {
      drawScoreboard(ctx, st.score, plinkoHighScore, plinkoHighCard);
    }

    plinkoAnimId = requestAnimationFrame(draw);
  }

  draw();
}

/* Main render */
function renderCard(json) {
  const card = JSON.parse(json);
  // Always show what we actually rendered in the black code box, so the card
  // it snapped to is visible (joker, patch, back, credits, number/face alike).
  try { ta.value = JSON.stringify(card, null, 2); } catch (e) {}
  const ctx = CANVAS.getContext("2d");
  ctx.clearRect(0, 0, W, H);
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, W, H);

  if (card.type === "back" && Array.isArray(card.pattern)) {
    drawBackPattern(ctx, card.pattern, {
      mode: "cover",
      inset: S(10),
      color: "#0b2f66",
    });
    return;
  }
  if (String(card.type).toLowerCase() === "system_patch") {
    drawPatchActivation(ctx);
    return;
  }
  if (String(card.type).toLowerCase() === "credits") {
    drawCreditsCard(ctx, card);
    return;
  }
  if (String(card.type).toLowerCase() === "instructions") {
    drawInstructions(ctx);
    return;
  }
  if (card.type && String(card.type).toLowerCase().startsWith("joker")) {
    drawJoker(ctx, card);
    return;
  }
  if (String(card.type).toLowerCase() === "face") {
    drawFace(ctx, card.rank, card.suit);
    return;
  }
  if (String(card.type).toLowerCase() === "number") {
    drawNumber(ctx, card.rank, card.suit);
    return;
  }

  // Sandbox fallback: a card with a rank and suit but no recognised type
  // still renders as a number card, so experiments like {"rank":"12",
  // "suit":"diamonds"} just work.
  if (card.rank != null && card.suit) {
    drawNumber(ctx, card.rank, card.suit);
    return;
  }

  ctx.fillStyle = "#333";
  ctx.font = `${Math.round(S(22))}px ui-monospace`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText("Invalid card", W / 2, H / 2);
}

/* Sandbox: build a centred grid of pip positions for any count (e.g. 12, 38).
   Standard 1-10 use the hand-tuned LAYOUTS; anything else gets a grid so the
   pips actually render in the middle of the card, not just the corners. */
const PIP_AREA = { x0: 46, x1: 194, y0: 64, y1: 272 }; // base 240x336 coords
function gridLayout(n) {
  const cols = Math.ceil(Math.sqrt(n));
  const rows = Math.ceil(n / cols);
  const { x0, x1, y0, y1 } = PIP_AREA;
  const cw = (x1 - x0) / cols;
  const ch = (y1 - y0) / rows;
  const cx = (x0 + x1) / 2;
  const pts = [];
  for (let i = 0; i < n; i++) {
    const r = Math.floor(i / cols);
    const c = i % cols;
    const rowCount = r === rows - 1 ? n - r * cols : cols;
    const rowStartX = cx - (rowCount * cw) / 2 + cw / 2;
    pts.push([rowStartX + c * cw, y0 + ch / 2 + r * ch]);
  }
  return { layout: layoutScaled(pts), cellBase: Math.min(cw, ch) };
}

function drawNumber(ctx, rank, suit) {
  const color = suitColor(suit);
  const cornerFont = `${Math.round(S(CARD_SCALE.corner))}px ui-monospace`;
  const suitSmall = `${Math.round(S(CARD_SCALE.cornerSuit))}px ui-monospace`;
  const pad = S(CARD_SCALE.cornerPad);

  const rankText = String(rank).toUpperCase().replace(/^ACE$/, "A");
  drawCornerPair(ctx, rankText, suit, color, pad, cornerFont, suitSmall);

  // Standard ranks use the tuned layouts; any other positive number gets a
  // generated grid, with pip size shrinking to fit the count.
  const key = String(rank).toLowerCase();
  let layout, pipPx;
  if (LAYOUTS[key]) {
    layout = LAYOUTS[key];
    pipPx = S(CARD_SCALE.pips);
  } else {
    const n = parseInt(rank, 10);
    if (Number.isFinite(n) && n > 0) {
      const g = gridLayout(Math.min(n, 200)); // cap silly inputs
      layout = g.layout;
      pipPx = Math.min(S(CARD_SCALE.pips), S(g.cellBase * 0.62));
    } else {
      layout = [];
      pipPx = S(CARD_SCALE.pips);
    }
  }

  if (isBrown(suit)) {
    drawPooPipsCentered(ctx, layout, color, pipPx * 0.5);
  } else {
    drawPipsCentered(ctx, layout, suit, color, `${Math.round(pipPx)}px ui-monospace`);
  }
}

function drawFace(ctx, rank, suit) {
  const color = suitColor(suit);
  const cornerFont = `${Math.round(S(CARD_SCALE.corner))}px ui-monospace`;
  const suitSmall = `${Math.round(S(CARD_SCALE.cornerSuit))}px ui-monospace`;
  const centerFont = `${Math.round(S(CARD_SCALE.faceCenter))}px ui-monospace`;
  const pad = S(CARD_SCALE.cornerPad);
  const letter = (rank || "?")[0].toUpperCase().replace("A", "A");

  // Try loading the traditional face card image
  loadFaceImage(rank, suit)
    .then((img) => {
      // Draw the full traditional card onto the canvas
      ctx.clearRect(0, 0, W, H);
      ctx.fillStyle = "#fff";
      ctx.fillRect(0, 0, W, H);
      ctx.drawImage(img, 0, 0, W, H);
    })
    .catch(() => {
      // Fallback: draw the letter if SVG not available
      drawCornerPair(ctx, letter, suit, color, pad, cornerFont, suitSmall);
      ctx.fillStyle = color;
      ctx.font = centerFont;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(letter, W / 2, H / 2);
    });
}

// Try each URL in turn; resolve with the first image that loads.
// Cached by the url list so a repeat render of the same joker doesn't
// re-run the png-then-jpg probe over the network every time.
const anyImageCache = {};
function loadAnyImage(urls) {
  const key = urls.join("|");
  if (anyImageCache[key]) return Promise.resolve(anyImageCache[key]);
  return new Promise((resolve, reject) => {
    let i = 0;
    const tryNext = () => {
      if (i >= urls.length) return reject(new Error("no image"));
      const img = new Image();
      img.onload = () => { anyImageCache[key] = img; resolve(img); };
      img.onerror = () => { i++; tryNext(); };
      img.src = urls[i];
    };
    tryNext();
  });
}

// Joker: if a CC0 joker SVG is present in faces/ (e.g. faces/joker1.svg,
// faces/joker2.svg or faces/joker.svg) it is used - matching the face-card
// artwork. Otherwise we fall back to the drawn jester below.
function drawJoker(ctx, card) {
  const type = String(card && card.type ? card.type : "joker").toLowerCase();
  loadAnyImage([
    `faces/${type}.png`, `faces/${type}.jpg`, `faces/${type}.jpeg`, `faces/${type}.svg`,
    "faces/joker.png", "faces/joker.jpg", "faces/joker.jpeg", "faces/joker.svg",
  ])
    .then((img) => {
      ctx.clearRect(0, 0, W, H);
      ctx.fillStyle = "#fff";
      ctx.fillRect(0, 0, W, H);
      // "contain": preserve the image's aspect ratio, centred on the card,
      // so a joker image of any proportions isn't stretched.
      const iw = img.width || img.naturalWidth || W;
      const ih = img.height || img.naturalHeight || H;
      const scale = Math.min(W / iw, H / ih);
      const dw = iw * scale;
      const dh = ih * scale;
      ctx.drawImage(img, (W - dw) / 2, (H - dh) / 2, dw, dh);
    })
    .catch(() => drawJokerArt(ctx));
}

function drawJokerArt(ctx) {
  ctx.clearRect(0, 0, W, H);
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, W, H);

  const red = "#c0202a";
  const black = "#161616";
  const gold = "#e3b424";
  const cx = W / 2;
  const faceR = S(46);
  const faceY = H * 0.47;
  const capBaseY = faceY - faceR * 0.45;

  // ---- Cap: three lobes + bells ----
  const tips = [
    { x: cx - faceR * 1.95, y: capBaseY - S(34) },
    { x: cx, y: capBaseY - S(86) },
    { x: cx + faceR * 1.95, y: capBaseY - S(34) },
  ];
  function lobe(ax, ay, bx, by, tip, col) {
    ctx.beginPath();
    ctx.moveTo(ax, ay);
    ctx.quadraticCurveTo((ax + tip.x) / 2 - S(8), (ay + tip.y) / 2 - S(6), tip.x, tip.y);
    ctx.quadraticCurveTo((bx + tip.x) / 2 + S(8), (by + tip.y) / 2 - S(6), bx, by);
    ctx.closePath();
    ctx.fillStyle = col;
    ctx.fill();
  }
  // outer lobes (red), then centre lobe (black) on top
  lobe(cx - faceR * 0.9, capBaseY, cx - S(2), capBaseY - S(6), tips[0], red);
  lobe(cx + S(2), capBaseY - S(6), cx + faceR * 0.9, capBaseY, tips[2], red);
  lobe(cx - faceR * 0.55, capBaseY - S(4), cx + faceR * 0.55, capBaseY - S(4), tips[1], black);

  // bells
  tips.forEach((tp) => {
    ctx.beginPath();
    ctx.arc(tp.x, tp.y, S(8), 0, Math.PI * 2);
    ctx.fillStyle = gold;
    ctx.fill();
    ctx.strokeStyle = black;
    ctx.lineWidth = S(1.5);
    ctx.stroke();
  });

  // cap band across the brow
  ctx.beginPath();
  ctx.moveTo(cx - faceR, capBaseY);
  ctx.quadraticCurveTo(cx, capBaseY + S(12), cx + faceR, capBaseY);
  ctx.quadraticCurveTo(cx, capBaseY - S(4), cx - faceR, capBaseY);
  ctx.closePath();
  ctx.fillStyle = black;
  ctx.fill();

  // ---- Face ----
  ctx.beginPath();
  ctx.arc(cx, faceY, faceR, 0, Math.PI * 2);
  ctx.fillStyle = "#fff";
  ctx.fill();
  ctx.strokeStyle = black;
  ctx.lineWidth = S(2.5);
  ctx.stroke();

  // eyes
  ctx.fillStyle = black;
  ctx.beginPath(); ctx.arc(cx - faceR * 0.36, faceY - S(3), S(5), 0, Math.PI * 2); ctx.fill();
  ctx.beginPath(); ctx.arc(cx + faceR * 0.36, faceY - S(3), S(5), 0, Math.PI * 2); ctx.fill();
  // rosy nose
  ctx.beginPath(); ctx.arc(cx, faceY + S(9), S(4.5), 0, Math.PI * 2); ctx.fillStyle = red; ctx.fill();
  // grin
  ctx.beginPath();
  ctx.strokeStyle = black;
  ctx.lineWidth = S(2.5);
  ctx.arc(cx, faceY + S(4), faceR * 0.52, 0.18 * Math.PI, 0.82 * Math.PI);
  ctx.stroke();

  // ---- Ruff collar ----
  const collarY = faceY + faceR + S(10);
  const scallops = 7;
  const cw = (faceR * 2.6) / scallops;
  const cstartX = cx - (cw * scallops) / 2;
  for (let i = 0; i < scallops; i++) {
    ctx.beginPath();
    ctx.arc(cstartX + cw * i + cw / 2, collarY, cw * 0.62, Math.PI, 2 * Math.PI);
    ctx.fillStyle = i % 2 ? red : black;
    ctx.fill();
  }
  ctx.fillStyle = black;
  ctx.fillRect(cstartX, collarY - S(2), cw * scallops, S(5));

  // ---- Labels ----
  ctx.fillStyle = red;
  ctx.font = `bold ${Math.round(S(30))}px ui-monospace, monospace`;
  ctx.textAlign = "center";
  ctx.textBaseline = "alphabetic";
  ctx.fillText("JOKER", cx, H - S(46));

  // small corner tags (like a rank index), upright top-left + rotated bottom-right
  ctx.font = `bold ${Math.round(S(13))}px ui-monospace, monospace`;
  ctx.textAlign = "left";
  ctx.textBaseline = "top";
  ctx.fillText("JKR", S(13), S(13));
  ctx.save();
  ctx.translate(W - S(13), H - S(13));
  ctx.rotate(Math.PI);
  ctx.fillText("JKR", 0, 0);
  ctx.restore();
}

function drawBackPattern(
  ctx,
  pattern,
  { mode = "cover", inset = S(14), color = "#08326a" } = {}
) {
  const rows = pattern.map((r) => r.trim().split(/\s+/));
  const R = rows.length,
    C = Math.max(...rows.map((r) => r.length));
  const left = inset,
    top = inset,
    right = W - inset,
    bottom = H - inset;
  const Wd = right - left,
    Hd = bottom - top;
  const cell =
    mode === "cover" ? Math.max(Wd / C, Hd / R) : Math.min(Wd / C, Hd / R);
  const totalW = cell * C,
    totalH = cell * R;
  const ox = left + (Wd - totalW) / 2,
    oy = top + (Hd - totalH) / 2;

  ctx.save();
  ctx.strokeStyle = color;
  ctx.fillStyle = color;
  ctx.lineWidth = Math.max(1, cell * 0.08);
  for (let r = 0; r < R; r++) {
    for (let c = 0; c < rows[r].length; c++) {
      const t = rows[r][c];
      const cx = ox + c * cell + cell / 2;
      const cy = oy + r * cell + cell / 2;
      drawToken(ctx, t, cx, cy, cell * 0.5);
    }
  }
  ctx.restore();
}
function drawToken(ctx, t, cx, cy, s) {
  if (t === "x" || t === "X") {
    ctx.beginPath();
    ctx.moveTo(cx - s, cy - s);
    ctx.lineTo(cx + s, cy + s);
    ctx.moveTo(cx + s, cy - s);
    ctx.lineTo(cx - s, cy + s);
    ctx.stroke();
  } else if (t === "·" || t === ".") {
    ctx.beginPath();
    ctx.arc(cx, cy, s * 0.2, 0, Math.PI * 2);
    ctx.fill();
  } else if (t === "o" || t === "O") {
    ctx.beginPath();
    ctx.lineWidth = Math.max(1, s * 0.1);
    ctx.arc(cx, cy, s * 0.3, 0, Math.PI * 2);
    ctx.stroke();
  } else if (t === "-") {
    ctx.beginPath();
    ctx.moveTo(cx - s * 0.4, cy);
    ctx.lineTo(cx + s * 0.4, cy);
    ctx.stroke();
  }
}

/* ========= CAMERA OVERLAY ========= */
let overlayEl = null,
  videoEl = null,
  stream = null,
  facing = "environment";

function buildOverlay() {
  if (overlayEl) return overlayEl;

  overlayEl = document.createElement("div");
  overlayEl.id = "camOverlay";
  overlayEl.innerHTML = `
    <div id="camBox">
      <video id="video" playsinline autoplay muted></video>
      <div id="camStatus">Starting camera…</div>
      <div id="camButtons">
        <button id="flipBtn" class="btn">Flip Camera</button>
        <button id="captureBtn" class="btn primary">Capture</button>
        <button id="cancelBtn" class="btn">Cancel</button>
      </div>
    </div>
  `;
  document.body.appendChild(overlayEl);

  videoEl = overlayEl.querySelector("#video");
  const flipBtn = overlayEl.querySelector("#flipBtn");
  const captureBtn = overlayEl.querySelector("#captureBtn");
  const cancelBtn = overlayEl.querySelector("#cancelBtn");

  flipBtn.addEventListener("click", async () => {
    facing = facing === "environment" ? "user" : "environment";
    await startStream();
  });

  cancelBtn.addEventListener("click", stopCameraOverlay);

  captureBtn.addEventListener("click", async () => {
    try {
      if (!videoEl || !videoEl.videoWidth || videoEl.readyState < 2) {
        alert("Camera still loading - give it a second, then try again.");
        return;
      }
      const b64 = snapshotToBase64();
      // Reassure them something's happening while the OCR round-trip runs -
      // otherwise the frozen frame just sits there with no sign of life.
      captureBtn.disabled = true;
      setCamStatus("Reading card…");
      await processImageBase64(b64);
      stopCameraOverlay();
    } catch (e) {
      console.error("Capture/OCR error:", e);
      alert(e && e.message ? e.message : "Scan failed - please try again.");
      // leave the camera open so they can retry without reopening
    } finally {
      captureBtn.disabled = false;
      setCamStatus("");
    }
  });

  return overlayEl;
}

function setCamStatus(msg) {
  const el = overlayEl && overlayEl.querySelector("#camStatus");
  if (!el) return;
  el.textContent = msg || "";
  el.style.display = msg ? "flex" : "none";
}

let camOpening = false;
async function openCamera() {
  if (camOpening) return; // ignore a rapid second click while opening
  camOpening = true;
  try {
    buildOverlay();
    overlayEl.style.display = "flex";
    setCamStatus("Starting camera…");
    // Bring the overlay into view: scroll our own document to the top, and ask
    // the host page (if embedded) to scroll the iframe to the top too, so the
    // camera popup appears high on screen instead of below the fold.
    try { window.scrollTo(0, 0); } catch {}
    try { parent?.postMessage?.({ type: "purecode:camera-open" }, "*"); } catch {}
    await startStream();
  } finally {
    camOpening = false;
  }
}
function stopCameraOverlay() {
  overlayEl.style.display = "none";
  if (stream) {
    stream.getTracks().forEach((t) => t.stop());
    stream = null;
  }
}

/* Stream helpers */
function snapshotToBase64() {
  const c = document.createElement("canvas");
  const w = videoEl.videoWidth,
    h = videoEl.videoHeight;
  c.width = w;
  c.height = h;
  c.getContext("2d").drawImage(videoEl, 0, 0, w, h);
  return c.toDataURL("image/jpeg", 0.92);
}

async function startStream() {
  // Stop existing tracks
  if (stream) {
    stream.getTracks().forEach((t) => t.stop());
    stream = null;
  }
  setCamStatus("Starting camera…");

  const constraints = { video: { facingMode: facing } };
  try {
    stream = await navigator.mediaDevices.getUserMedia(constraints);
  } catch (e) {
    // Safari sometimes needs plain true
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        video: true,
        audio: false,
      });
    } catch (e2) {
      setCamStatus("Can't reach the camera - check permissions, then Flip or reopen.");
      return;
    }
  }
  videoEl.srcObject = stream;
  // Explicitly kick playback: some browsers (notably iOS Safari) won't start
  // the video from srcObject alone, which is what made it feel like the first
  // tap did nothing.
  try { await videoEl.play(); } catch (e) {}
  // Clear the "Starting…" overlay as soon as real frames arrive.
  const clear = () => setCamStatus("");
  videoEl.addEventListener("playing", clear, { once: true });
  videoEl.addEventListener("loadeddata", clear, { once: true });
  setTimeout(clear, 2500);
}

/* ========= OCR + SNAPPING ========= */
function normalizeScanned(s) {
  return s
    .replace(/[“”„‟]/g, '"')
    .replace(/[‘’‚‛]/g, "'")
    .replace(/—|–/g, "-")
    .replace(/[™©®]/g, '"') // common confusion → quote
    .replace(/[{(]\s*/g, "{")
    .replace(/\s*[)}]/g, "}")
    .replace(/\u00A0/g, " ")
    .replace(/[^\S\r\n]+/g, " ")
    .replace(/(\r\n|\r)/g, "\n")
    .trim();
}

function trySnapToDeck(text) {
  // We only ever allow the 53 possibilities when the source is camera.
  // Very tolerant: look for tokens anywhere.
  const t = text.toLowerCase();

  const ranks = [
    "ace",
    "2",
    "3",
    "4",
    "5",
    "6",
    "7",
    "8",
    "9",
    "10",
    "jack",
    "queen",
    "king",
  ];
  const suits = ["clubs", "spades", "hearts", "diamonds"];

  // quick find
  const rank = ranks.find(
    (r) => t.includes(`"${r}"`) || t.includes(`:${r}`) || t.includes(` ${r}`)
  );
  const suit = suits.find(
    (s) => t.includes(`"${s}"`) || t.includes(`:${s}`) || t.includes(` ${s}`)
  );

  // Instructions card (plain comment text, not JSON)
  if (
    t.includes("puredata") ||
    t.includes("pure data playing cards") ||
    (t.includes("danberg.art") && t.includes("render"))
  ) {
    return JSON.stringify({ type: "instructions" }, null, 2);
  }

  // Physical credits card
  if (
    t.includes("credits") &&
    (t.includes("developers") || t.includes("danberg") || t.includes("edition"))
  ) {
    return JSON.stringify(CREDITS_CARD, null, 2);
  }

  // System Patch card detection (fuzzy, tolerant of OCR errors).
  // Tokens taken from the actual printed patch card.
  const patchTokens = [
    "system_patch", "system patch",
    "patch_001", "patch 001",
    "scan_to_use", "scan to use",
    "hidden_mode", "hidden mode",
    "r_override", "r override",
    "3fb8e38f",
    "rel_chan", "rel chan",
    "1_ed",
    "apply_to", "renderer",
  ];
  const patchHits = patchTokens.filter((tok) => t.includes(tok)).length;
  if (patchHits >= 3 || t.includes("system_patch") || t.includes("system patch")) {
    return JSON.stringify(PATCH_CARD, null, 2);
  }

  // Joker (two printed variants; both render the same joker visual)
  if (
    t.includes("joker") || t.includes("hacked") ||
    t.includes("exploit") || t.includes("/etc/passwd")
  ) {
    const which = t.includes("alert(2)") || t.includes("joker2") ? "joker2" : "joker1";
    return JSON.stringify(
      { ...JOKER_CARD, type: which, payload: which === "joker2" ? "alert(2)" : "alert(1)" },
      null,
      2
    );
  }

  if (t.includes("type") && t.includes("back")) {
    return JSON.stringify(EXAMPLES["Back"], null, 2);
  }

  if (rank && suit) {
    const isFace = ["jack", "queen", "king"].includes(rank);
    const type = isFace ? "face" : "number";
    const rankOut = rank === "ace" ? "ace" : rank;
    return JSON.stringify({ rank: rankOut, suit, type }, null, 2);
  }

  // Partially obscured card: if there's a genuine card signal (the key names
  // "rank"/"suit", or a quoted rank/suit value), make a best guess and fill in
  // whatever couldn't be read, rather than failing outright.
  const rankQuoted = ranks.find((r) => t.includes(`"${r}"`));
  const suitQuoted = suits.find((s) => t.includes(`"${s}"`));
  const looksLikeCard =
    t.includes("rank") || t.includes("suit") || !!rankQuoted || !!suitQuoted;
  if (looksLikeCard) {
    const r = rank || rankQuoted || "ace";
    const s = suit || suitQuoted || "spades";
    const isFace = ["jack", "queen", "king"].includes(r);
    return JSON.stringify(
      { rank: r === "ace" ? "ace" : r, suit: s, type: isFace ? "face" : "number" },
      null,
      2
    );
  }

  // No card signal at all (blank frame, a face, random text) → no detection.
  return null;
}

function safeJsonGuess(text) {
  // Try to coerce into a basic object with best-effort defaults
  try {
    const j = JSON.parse(text);
    return j;
  } catch {
    // Extract tokens loosely
    const t = text.toLowerCase();
    let rank = (/\"(ace|[2-9]|10|jack|queen|king)\"/.exec(t) || [])[1] || "8";
    let suit =
      (/\"(clubs|spades|hearts|diamonds)\"/.exec(t) || [])[1] || "clubs";
    const isFace = ["jack", "queen", "king"].includes(rank);
    const type = isFace ? "face" : "number";
    return { rank, suit, type };
  }
}

async function processImageBase64(b64) {
  // Send to Vision backend
  let res;
  try {
    res = await fetch(VISION_FN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ image: b64 }),
    });
  } catch (e) {
    throw new Error("could not reach the OCR service (network or CORS)");
  }
  if (!res.ok) throw new Error("OCR service returned status " + res.status);
  let data;
  try {
    data = await res.json();
  } catch {
    throw new Error("OCR service sent an unexpected (non-JSON) response");
  }
  const text = normalizeScanned(String(data.text || ""));
  if (!text.trim()) {
    throw new Error(
      "Couldn't read anything there - line up a Pure Data card in the frame and try again."
    );
  }
  const snapped = trySnapToDeck(text);
  if (!snapped) {
    throw new Error(
      "Couldn't find a card there - line up a Pure Data card in the frame and try again."
    );
  }

  // Put the scanned code into the editor. On desktop the box is already open
  // (see index.html) so it's seen instantly; on mobile it stays collapsed -
  // the code is there, correct, whenever they choose to expand it.
  ta.value = snapped;

  // Auto-render straight away - no need to click Render.
  try {
    const card = JSON.parse(snapped);
    if (plinkoMode && String(card.type).toLowerCase() !== "system_patch") {
      startPlinkoFromCurrentCard();
    } else {
      renderCard(snapped);
    }
  } catch {
    // not valid JSON - leave it in the editor for the user to fix
  }
}

/* ========= UI WIRES ========= */
renderBtn.addEventListener("click", () => {
  try {
    const json = ta.value.trim();
    if (!json) return alert("Paste or type a card JSON first.");

    // Easter egg: type "credits" to see backer credits
    if (json.toLowerCase() === "credits") {
      drawCredits(CANVAS.getContext("2d"));
      return;
    }

    // If plinko mode is on, rebuild the board with the new card
    if (plinkoMode) {
      startPlinkoFromCurrentCard();
      return;
    }

    renderCard(json);
  } catch (e) {
    alert("Invalid JSON");
    console.error(e);
  }
});

/* Examples: cycle through the full standard deck - every number and face
   card in all four suits, plus a back. No jokers, patch, or credits.
   Shuffled so each click gives a fresh card until the set is exhausted. */
const EXAMPLE_DECK = (() => {
  const suits = ["clubs", "spades", "hearts", "diamonds"];
  const numbers = ["ace", "2", "3", "4", "5", "6", "7", "8", "9", "10"];
  const faces = ["jack", "queen", "king"];
  const deck = [];
  suits.forEach((suit) => {
    numbers.forEach((rank) => deck.push({ rank, suit, type: "number" }));
    faces.forEach((rank) => deck.push({ rank, suit, type: "face" }));
  });
  // include the card back several times so it turns up roughly 1 in 10
  for (let i = 0; i < 5; i++) deck.push(EXAMPLES["Back"]);
  return deck;
})();

let exampleQueue = [];
function nextExample() {
  if (exampleQueue.length === 0) {
    exampleQueue = EXAMPLE_DECK.slice();
    for (let i = exampleQueue.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [exampleQueue[i], exampleQueue[j]] = [exampleQueue[j], exampleQueue[i]];
    }
  }
  return exampleQueue.pop();
}

examplesBtn.addEventListener("click", () => {
  ta.value = JSON.stringify(nextExample(), null, 2);
});

scanBtn.addEventListener("click", async () => {
  // Prevent mobile keyboard auto-opening at this moment
  ta.blur();
  await openCamera();
});

/* No initial render; editor starts empty per your request */
