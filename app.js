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

function fmtTime(sec) {
  if (!isFinite(sec)) return "0:00";
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
          <span data-cur>0:00</span> / <span data-dur>0:00</span>
        </div>
      </div>

      <div class="bar" data-bar role="progressbar" aria-label="Progresso">
        <div class="fill" data-fill></div>
      </div>
    </div>

    <div class="card__bottom">
      <button class="buy" type="button" data-buy>Comprar (Pix / Cartão)</button>
      <button class="small" type="button" data-copy>Copiar infos</button>
    </div>
  </article>
  `;
}

function updateCardUI(card, paused, reset = false) {
  const playBtn = card.querySelector("[data-play]");
  const fill = card.querySelector("[data-fill]");
  const cur = card.querySelector("[data-cur]");
  const dur = card.querySelector("[data-dur]");

  if (reset) {
    fill.style.width = "0%";
    cur.textContent = "0:00";
    dur.textContent = "0:00";
  }

  playBtn.textContent = paused ? "▶" : "❚❚";
}

function stopPlayback() {
  audio.pause();
  audio.src = "";
  currentId = null;
  currentCard = null;
}

function togglePlay(beat, card) {
  if (!beat.preview_url) {
    alert("Sem preview configurado.");
    return;
  }

  const same = currentId === beat.id;

  if (same && !audio.paused) {
    audio.pause();
    updateCardUI(card, true);
    return;
  }

  if (!same && currentCard) {
    updateCardUI(currentCard, true, true);
  }

  currentId = beat.id;
  currentCard = card;

  if (!same) audio.src = beat.preview_url;

  audio.play().catch(() => {
    alert("Seu navegador bloqueou o play. Clique novamente.");
  });

  updateCardUI(card, false);
}

function seekFromBar(e, beat) {
  if (currentId !== beat.id || !audio.src) return;
  const rect = e.currentTarget.getBoundingClientRect();
  const x = Math.min(Math.max(0, e.clientX - rect.left), rect.width);
  const pct = x / rect.width;
  if (isFinite(audio.duration)) audio.currentTime = audio.duration * pct;
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
    const bar = card.querySelector("[data-bar]");
    const buy = card.querySelector("[data-buy]");
    const copy = card.querySelector("[data-copy]");

    play.addEventListener("click", () => togglePlay(b, card));
    bar.addEventListener("click", (e) => seekFromBar(e, b));
    buy.addEventListener("click", () => {
      if (!b.buy_url) {
        alert("Sem link de compra configurado.");
        return;
      }
      window.open(b.buy_url, "_blank", "noopener,noreferrer");
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
  });

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

// Atualiza barra/tempo no card atual
audio.addEventListener("timeupdate", () => {
  if (!currentId) return;
  const card = document.getElementById(`card-${currentId}`);
  if (!card) return;

  const fill = card.querySelector("[data-fill]");
  const cur = card.querySelector("[data-cur]");
  const dur = card.querySelector("[data-dur]");

  const d = audio.duration;
  const t = audio.currentTime;

  cur.textContent = fmtTime(t);
  dur.textContent = fmtTime(d);

  if (isFinite(d) && d > 0) fill.style.width = `${(t / d) * 100}%`;
});

audio.addEventListener("ended", () => {
  if (!currentId) return;
  const card = document.getElementById(`card-${currentId}`);
  if (card) updateCardUI(card, true, true);
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