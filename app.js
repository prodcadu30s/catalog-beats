const $ = (sel) => document.querySelector(sel);

const audio = $("#audio");
const grid = $("#grid");
const empty = $("#empty");
const resultCount = $("#resultCount");

const q = $("#q");
const styleSel = $("#style");
const sortSel = $("#sort");
const bpmMin = $("#bpmMin");
const bpmMax = $("#bpmMax");
const onlyTagged = $("#onlyTagged");
const clearBtn = $("#clear");

let BEATS = [];
let filtered = [];

let currentId = null;
let currentCard = null;

// caches (performance)
const peaksCache = new Map(); // url -> peaks[]
const durationCache = new Map(); // url -> seconds

function fmtTime(sec) {
  if (!isFinite(sec) || sec < 0) return "0:00";
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60).toString().padStart(2, "0");
  return `${m}:${s}`;
}

function normalize(str) {
  return (str ?? "")
    .toString()
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "");
}

function uniq(arr) {
  return [...new Set(arr)];
}

function escapeHtml(s) {
  return (s ?? "")
    .toString()
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function setStats(list) {
  $("#statTotal").textContent = `${list.length}`;
  const styles = uniq(list.map((b) => b.style)).filter(Boolean);
  $("#statStyles").textContent = `${styles.length}`;
  const bpms = list.map((b) => Number(b.bpm)).filter((n) => !isNaN(n));
  if (bpms.length) {
    const min = Math.min(...bpms);
    const max = Math.max(...bpms);
    $("#statBpm").textContent = `${min}–${max}`;
  } else {
    $("#statBpm").textContent = `—`;
  }
}

function buildStyleOptions() {
  const styles = uniq(BEATS.map((b) => b.style).filter(Boolean)).sort((a, b) =>
    a.localeCompare(b)
  );
  styleSel.innerHTML = `
    <option value="">Todos</option>
    ${styles.map((s) => `<option value="${escapeHtml(s)}">${escapeHtml(s)}</option>`).join("")}
  `;
}

function cardHtml(b) {
  const isCurrent = b.id === currentId;
  const playIcon = isCurrent && !audio.paused ? "❚❚" : "▶";

  const hasBasic = !!b.buy_basic_url;
  const hasPremium = !!b.buy_premium_url;
  const hasExclusive = !!b.buy_exclusive_url;

  return `
  <article class="card" id="card-${escapeHtml(b.id)}">
    <div class="card__top">
      <div>
        <h3 class="title">${escapeHtml(b.title)}</h3>
        <div class="meta">
          <span class="badge">${escapeHtml(b.style || "—")}</span>
          <span class="badge">${escapeHtml(String(b.bpm ?? "—"))} BPM</span>
          <span class="badge">Key ${escapeHtml(b.key || "—")}</span>
          ${b.tagged ? `<span class="badge">TAGGED</span>` : ``}
        </div>
      </div>
      <div class="muted">${escapeHtml(b.date || "")}</div>
    </div>

    <div class="player">
      <div class="player__row">
        <button class="play" data-play type="button" aria-label="Tocar/pausar">${playIcon}</button>
        <div class="time">
          <span data-cur>0:00</span> / <span data-dur>—</span>
        </div>
      </div>

      <canvas class="wave" data-wave height="58" aria-label="Waveform"></canvas>
    </div>

    <div class="card__bottom">
      ${hasBasic ? `<button class="buy buy--basic" type="button" data-buy="basic">Basic</button>` : ``}
      ${hasPremium ? `<button class="buy buy--premium" type="button" data-buy="premium">Premium</button>` : ``}
      ${hasExclusive ? `<button class="buy buy--exclusive" type="button" data-buy="exclusive">Exclusive</button>` : ``}
      <button class="small" type="button" data-copy>Copiar infos</button>
    </div>
  </article>
  `;
}

function updateCardUI(card, paused) {
  const playBtn = card.querySelector("[data-play]");
  playBtn.textContent = paused ? "▶" : "❚❚";
}

function stopPlayback() {
  audio.pause();
  audio.removeAttribute("src");
  audio.load();
  currentId = null;
  currentCard = null;
}

/**
 * Lazy load total:
 * - só define audio.src e carrega metadata quando o usuário clica play
 * - waveform só é gerada quando o usuário clica play (primeira vez)
 */
async function togglePlay(beat, card) {
  if (!beat.preview_url) {
    alert("Sem preview configurado.");
    return;
  }

  const same = currentId === beat.id;

  // pause no mesmo beat
  if (same && !audio.paused) {
    audio.pause();
    updateCardUI(card, true);
    return;
  }

  // trocou de beat: reseta UI anterior
  if (!same && currentCard) {
    updateCardUI(currentCard, true);
    // zera progress no canvas anterior (se tiver)
    resetWave(currentCard);
  }

  currentId = beat.id;
  currentCard = card;

  // só seta src quando necessário (sem preload)
  if (!same) {
    audio.preload = "metadata"; // metadata só depois do clique
    audio.src = beat.preview_url;
    audio.load();
  }

  // garantir duração real no card (metadata)
  await ensureDurationOnCard(beat, card);

  // gerar waveform apenas quando o usuário clicar play pela primeira vez
  await ensureWaveformReady(beat, card);

  audio.play().catch(() => {
    alert("Seu navegador bloqueou o play. Clique novamente.");
  });

  updateCardUI(card, false);
}

function getBuyUrl(beat, type) {
  if (type === "basic") return beat.buy_basic_url;
  if (type === "premium") return beat.buy_premium_url;
  if (type === "exclusive") return beat.buy_exclusive_url;
  return null;
}

function sortFiltered() {
  const v = sortSel.value;

  const byRecent = (a, b) => new Date(b.date || 0) - new Date(a.date || 0);
  const byBpmAsc = (a, b) => (Number(a.bpm) || 0) - (Number(b.bpm) || 0);
  const byBpmDesc = (a, b) => (Number(b.bpm) || 0) - (Number(a.bpm) || 0);
  const byTitle = (a, b) => (a.title || "").localeCompare(b.title || "");

  if (v === "bpmAsc") filtered.sort(byBpmAsc);
  else if (v === "bpmDesc") filtered.sort(byBpmDesc);
  else if (v === "title") filtered.sort(byTitle);
  else filtered.sort(byRecent);
}

function applyFilters() {
  const term = normalize(q.value.trim());
  const style = styleSel.value.trim();
  const minB = bpmMin.value ? Number(bpmMin.value) : null;
  const maxB = bpmMax.value ? Number(bpmMax.value) : null;
  const taggedOnly = !!onlyTagged.checked;

  filtered = BEATS.filter((b) => {
    if (style && b.style !== style) return false;
    if (taggedOnly && !b.tagged) return false;

    const bpm = Number(b.bpm);
    if (minB !== null && isFinite(minB) && bpm < minB) return false;
    if (maxB !== null && isFinite(maxB) && bpm > maxB) return false;

    if (!term) return true;

    const hay = normalize([b.title, b.style, b.key, b.bpm, b.id].join(" "));
    return hay.includes(term);
  });

  sortFiltered();
  render();
}

function render() {
  resultCount.textContent = `${filtered.length} resultado(s)`;
  empty.classList.toggle("hidden", filtered.length !== 0);

  grid.innerHTML = filtered.map((b) => cardHtml(b)).join("");

  filtered.forEach((b) => {
    const card = document.getElementById(`card-${b.id}`);
    const play = card.querySelector("[data-play]");
    const wave = card.querySelector("[data-wave]");
    const copy = card.querySelector("[data-copy]");

    // botões de compra
    card.querySelectorAll("[data-buy]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const type = btn.getAttribute("data-buy");
        const url = getBuyUrl(b, type);
        if (!url) {
          alert("Link de compra não configurado.");
          return;
        }
        window.open(url, "_blank", "noopener,noreferrer");
      });
    });

    play.addEventListener("click", () => togglePlay(b, card));

    // seek no waveform (só funciona pro beat atual)
    wave.addEventListener("click", (e) => {
      if (currentId !== b.id || !audio.src || !isFinite(audio.duration)) return;
      const rect = wave.getBoundingClientRect();
      const pct = Math.min(Math.max(0, (e.clientX - rect.left) / rect.width), 1);
      audio.currentTime = audio.duration * pct;
    });

    copy.addEventListener("click", async () => {
      const text = `${b.title} • ${b.style} • ${b.bpm} BPM • ${b.key || ""}`.trim();
      try {
        await navigator.clipboard.writeText(text);
        copy.textContent = "Copiado ✓";
        setTimeout(() => (copy.textContent = "Copiar infos"), 900);
      } catch {
        alert("Não consegui copiar (permissão do navegador).");
      }
    });

    // se já existe duration em cache, mostra sem preload
    const durSpan = card.querySelector("[data-dur]");
    const cached = getDurationCached(b.preview_url);
    if (cached) durSpan.textContent = fmtTime(cached);

    // desenha um placeholder “flat” (sem baixar nada)
    drawWavePlaceholder(wave);
  });

  // se o beat atual sumiu da lista, para
  if (currentId) {
    const current = document.getElementById(`card-${currentId}`);
    if (!current) stopPlayback();
  }
}

function bindControls() {
  [q, styleSel, sortSel, bpmMin, bpmMax, onlyTagged].forEach((el) => {
    el.addEventListener("input", applyFilters);
    el.addEventListener("change", applyFilters);
  });

  clearBtn.addEventListener("click", () => {
    q.value = "";
    styleSel.value = "";
    sortSel.value = "recent";
    bpmMin.value = "";
    bpmMax.value = "";
    onlyTagged.checked = false;
    applyFilters();
  });
}

/* ==========================
   DURAÇÃO REAL (lazy)
   ========================== */

function getDurationCached(url) {
  if (!url) return null;
  if (durationCache.has(url)) return durationCache.get(url);
  const k = `dur:${url}`;
  const v = localStorage.getItem(k);
  if (!v) return null;
  const n = Number(v);
  if (!isFinite(n) || n <= 0) return null;
  durationCache.set(url, n);
  return n;
}

function setDurationCached(url, seconds) {
  if (!url || !isFinite(seconds) || seconds <= 0) return;
  durationCache.set(url, seconds);
  localStorage.setItem(`dur:${url}`, String(seconds));
}

function waitForEvent(target, eventName, timeoutMs = 8000) {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => {
      cleanup();
      reject(new Error(`Timeout esperando ${eventName}`));
    }, timeoutMs);

    function onEvt() {
      cleanup();
      resolve();
    }
    function cleanup() {
      clearTimeout(t);
      target.removeEventListener(eventName, onEvt);
    }

    target.addEventListener(eventName, onEvt, { once: true });
  });
}

async function ensureDurationOnCard(beat, card) {
  const durSpan = card.querySelector("[data-dur]");
  const cached = getDurationCached(beat.preview_url);
  if (cached) {
    durSpan.textContent = fmtTime(cached);
    return;
  }

  // aguarda metadata (sem baixar tudo)
  try {
    if (!isFinite(audio.duration) || audio.duration === 0) {
      await waitForEvent(audio, "loadedmetadata", 8000);
    }
    if (isFinite(audio.duration) && audio.duration > 0) {
      setDurationCached(beat.preview_url, audio.duration);
      durSpan.textContent = fmtTime(audio.duration);
    } else {
      durSpan.textContent = "—";
    }
  } catch {
    durSpan.textContent = "—";
  }
}

/* ==========================
   WAVEFORM REAL (barras arredondadas)
   - lazy: só baixa/decodifica no click do beat
   ========================== */

function drawWavePlaceholder(canvas) {
  // placeholder leve sem baixar nada
  const dpr = window.devicePixelRatio || 1;
  const w = canvas.clientWidth || 1;
  const h = canvas.clientHeight || 58;

  canvas.width = Math.floor(w * dpr);
  canvas.height = Math.floor(h * dpr);

  const ctx = canvas.getContext("2d");
  ctx.scale(dpr, dpr);
  ctx.clearRect(0, 0, w, h);

  // desenha barras “fake” suaves
  const bars = 90;
  const barW = w / bars;
  const gap = Math.max(1, barW * 0.45);
  const bw = Math.max(1, barW - gap);

  const line = getComputedStyle(document.documentElement).getPropertyValue("--line").trim() || "rgba(255,255,255,.08)";
  const col = "rgba(255,255,255,.10)";

  ctx.fillStyle = col;
  ctx.strokeStyle = line;

  for (let i = 0; i < bars; i++) {
    const x = i * barW;
    const amp = (Math.sin(i * 0.35) * 0.5 + 0.5) * (h * 0.55) + (h * 0.10);
    const y = (h - amp) / 2;
    roundRect(ctx, x, y, bw, amp, 6);
    ctx.fill();
  }
}

function resetWave(card) {
  const canvas = card.querySelector("[data-wave]");
  if (canvas) drawWavePlaceholder(canvas);
}

function roundRect(ctx, x, y, w, h, r) {
  const radius = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.arcTo(x + w, y, x + w, y + h, radius);
  ctx.arcTo(x + w, y + h, x, y + h, radius);
  ctx.arcTo(x, y + h, x, y, radius);
  ctx.arcTo(x, y, x + w, y, radius);
  ctx.closePath();
}

async function getPeaks(url, bars = 140) {
  // cache em memória
  if (peaksCache.has(url)) return peaksCache.get(url);

  // cache persistente (localStorage)
  const storeKey = `peaks:v1:${url}:bars:${bars}`;
  const stored = localStorage.getItem(storeKey);
  if (stored) {
    try {
      const arr = JSON.parse(stored);
      if (Array.isArray(arr) && arr.length === bars) {
        peaksCache.set(url, arr);
        return arr;
      }
    } catch {}
  }

  // baixa e decodifica (só no click)
  const arrayBuffer = await fetch(url, { cache: "force-cache" }).then(r => r.arrayBuffer());
  const AudioCtx = window.AudioContext || window.webkitAudioContext;
  const ctx = new AudioCtx();

  const audioBuffer = await ctx.decodeAudioData(arrayBuffer.slice(0));
  const channel = audioBuffer.getChannelData(0); // mono

  const blockSize = Math.floor(channel.length / bars);
  const peaks = new Array(bars).fill(0);

  for (let i = 0; i < bars; i++) {
    const start = i * blockSize;
    const end = Math.min(start + blockSize, channel.length);
    let max = 0;
    for (let j = start; j < end; j++) {
      const v = Math.abs(channel[j] || 0);
      if (v > max) max = v;
    }
    peaks[i] = max;
  }

  // normaliza (0..1)
  const maxPeak = Math.max(...peaks) || 1;
  const norm = peaks.map(p => p / maxPeak);

  try { await ctx.close(); } catch {}

  peaksCache.set(url, norm);
  try { localStorage.setItem(storeKey, JSON.stringify(norm)); } catch {}

  return norm;
}

function drawWave(canvas, peaks, progress = 0) {
  const dpr = window.devicePixelRatio || 1;
  const w = canvas.clientWidth;
  const h = canvas.clientHeight || 58;

  canvas.width = Math.floor(w * dpr);
  canvas.height = Math.floor(h * dpr);

  const ctx = canvas.getContext("2d");
  ctx.scale(dpr, dpr);
  ctx.clearRect(0, 0, w, h);

  const bars = peaks.length;
  const barW = w / bars;
  const gap = Math.max(1, barW * 0.55);   // barras finas
  const bw = Math.max(1, barW - gap);
  const radius = Math.min(8, bw * 0.9);

  const accent = getComputedStyle(document.documentElement).getPropertyValue("--accent").trim() || "#7c5cff";

  for (let i = 0; i < bars; i++) {
    const x = i * barW;
    const amp = peaks[i] * (h * 0.88);
    const y = (h - amp) / 2;

    const played = (i / bars) <= progress;
    ctx.globalAlpha = played ? 1 : 0.35;
    ctx.fillStyle = accent;

    roundRect(ctx, x, y, bw, amp, radius);
    ctx.fill();
    ctx.globalAlpha = 1;
  }
}

async function ensureWaveformReady(beat, card) {
  const canvas = card.querySelector("[data-wave]");
  if (!canvas) return;

  // se já tem peaks cacheadas, só desenha
  const url = beat.preview_url;
  const cached = peaksCache.get(url) || (() => {
    const storeKey = `peaks:v1:${url}:bars:140`;
    const stored = localStorage.getItem(storeKey);
    if (!stored) return null;
    try {
      const arr = JSON.parse(stored);
      if (Array.isArray(arr) && arr.length === 140) return arr;
    } catch {}
    return null;
  })();

  if (cached) {
    peaksCache.set(url, cached);
    drawWave(canvas, cached, currentProgress());
    return;
  }

  canvas.classList.add("wave--loading");
  try {
    const peaks = await getPeaks(url, 140);
    drawWave(canvas, peaks, currentProgress());
  } finally {
    canvas.classList.remove("wave--loading");
  }
}

function currentProgress() {
  if (!isFinite(audio.duration) || audio.duration <= 0) return 0;
  return Math.min(Math.max(0, audio.currentTime / audio.duration), 1);
}

/* ==========================
   Atualização de tempo + waveform do beat atual
   ========================== */

audio.addEventListener("timeupdate", () => {
  if (!currentId) return;
  const card = document.getElementById(`card-${currentId}`);
  if (!card) return;

  // tempo
  const cur = card.querySelector("[data-cur]");
  const dur = card.querySelector("[data-dur]");
  cur.textContent = fmtTime(audio.currentTime);
  if (dur.textContent === "—" && isFinite(audio.duration) && audio.duration > 0) {
    dur.textContent = fmtTime(audio.duration);
  }

  // waveform progresso (se já gerou peaks)
  const beat = BEATS.find(b => b.id === currentId);
  if (!beat || !beat.preview_url) return;
  const peaks = peaksCache.get(beat.preview_url);
  if (!peaks) return;

  const canvas = card.querySelector("[data-wave]");
  if (!canvas) return;
  drawWave(canvas, peaks, currentProgress());
});

audio.addEventListener("ended", () => {
  if (!currentId) return;
  const card = document.getElementById(`card-${currentId}`);
  if (!card) return;

  updateCardUI(card, true);

  const beat = BEATS.find(b => b.id === currentId);
  if (!beat || !beat.preview_url) return;

  const peaks = peaksCache.get(beat.preview_url);
  const canvas = card.querySelector("[data-wave]");
  if (peaks && canvas) drawWave(canvas, peaks, 0);
});

audio.addEventListener("pause", () => {
  if (!currentId) return;
  const card = document.getElementById(`card-${currentId}`);
  if (card) updateCardUI(card, true);
});

audio.addEventListener("play", () => {
  if (!currentId) return;
  const card = document.getElementById(`card-${currentId}`);
  if (card) updateCardUI(card, false);
});

async function init() {
  $("#year").textContent = String(new Date().getFullYear());

  const res = await fetch("beats.json", { cache: "no-store" });
  const data = await res.json();

  BEATS = (data.beats || []).map((b) => ({
    ...b,
    id: b.id || normalize(b.title).replace(/\s+/g, "-"),
    bpm: Number(b.bpm),
    tagged: !!b.tagged,
    // compat: se alguém ainda usar buy_url antigo, joga em basic
    buy_basic_url: b.buy_basic_url || b.buy_url || "",
    buy_premium_url: b.buy_premium_url || "",
    buy_exclusive_url: b.buy_exclusive_url || ""
  }));

  setStats(BEATS);
  buildStyleOptions();
  bindControls();
  applyFilters();
}

init().catch((err) => {
  console.error(err);
  alert("Erro ao carregar beats.json. Verifique o arquivo e o formato JSON.");
});