// =========================
// Readdit – Script.js (komplett)
// =========================

// --- Tag 12: Reddit-Proxy & Subreddit-Config ---
const REDDIT_PROXY_BASE = "https://reddit-proxy.fbn.workers.dev";
const REDDIT_SUBREDDITS = ["books", "booksuggestions", "buecher"];
const redditVoicesCache = {}; // titleLower -> posts[]

/** =========================
 *  Global config
 *  ========================= */
const SEARCH_RESULTS_COUNT = 10; // ✅ 10 passt gut zum 2-Spalten-Grid (statt 5)
const PREFS_KEY = "readdit:prefs:v1";
const SNOW_KEY = "readdit:snow:v1";

/** =========================
 *  Utilities
 *  ========================= */
function normalizeTitle(t) {
  return String(t || "")
    .toLowerCase()
    .replace(/&/g, "and")
    .replace(/[^a-z0-9]+/g, "")
    .trim();
}

function smartTrim(str, max) {
  const s = String(str || "");
  if (s.length <= max) return s;
  const cut = s.slice(0, max - 1);
  const lastSpace = cut.lastIndexOf(" ");
  return (lastSpace > 40 ? cut.slice(0, lastSpace) : cut).trim() + "…";
}

function uniq(arr) {
  return Array.from(new Set((arr || []).filter(Boolean)));
}

function escapeHtml(str) {
  return String(str || "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function escapeAttr(str) {
  return escapeHtml(str);
}

function safeAuthorName(name) {
  const a = String(name || "").trim();
  if (!a) return "";
  if (a.toLowerCase().includes("unbekannt")) return "";
  return a;
}

function formatYear(y) {
  const n = Number(y);
  return Number.isFinite(n) && n > 0 ? String(n) : "";
}

function looksEnglish(text) {
  const t = (text || "").toLowerCase();
  if (!t) return false;
  const hits = ["the ", "and ", "with ", "from ", "into ", "story ", "won ", "award "]
    .filter(w => t.includes(w)).length;
  return hits >= 2;
}

/** =========================
 *  Text-Engine (3 Textarten)
 *  ========================= */
function subjectToLabel(s) {
  const v = String(s || "").toLowerCase();

  if (v.includes("science fiction") || v.includes("science_fiction") || v.includes("sci-fi") || v.includes("scifi")) return "Sci-Fi";
  if (v.includes("fantasy")) return "Fantasy";
  if (v.includes("mystery") || v.includes("detective")) return "Mystery";
  if (v.includes("thriller") || v.includes("crime")) return "Spannung";
  if (v.includes("romance") || v.includes("love")) return "Romance";
  if (v.includes("classic") || v.includes("classics") || v.includes("literature")) return "Klassiker";
  if (v.includes("history") || v.includes("biography") || v.includes("nonfiction") || v.includes("essays")) return "Sachbuch";
  if (v.includes("philosophy")) return "Philosophie";
  if (v.includes("politic")) return "Politik";
  if (v.includes("space")) return "Space";
  if (v.includes("dystopia")) return "Dystopie";
  if (v.includes("adventure")) return "Abenteuer";

  return "";
}

function pickTopLabels(subjects, max = 3) {
  const labels = (subjects || []).map(subjectToLabel).filter(Boolean);
  return uniq(labels).slice(0, max);
}

/**
 * A) Such-Kurztext (Discovery) – neutral, kurz, ohne CTA
 */
function generateSearchSnippet(meta = {}) {
  const title = meta.title || "Ohne Titel";
  const author = safeAuthorName(meta.authorName);
  const year = formatYear(meta.firstPublishYear);
  const tags = pickTopLabels(meta.subjects, 2);

  const parts = [];
  if (author && year) parts.push(`${author} · ${year}`);
  else if (author) parts.push(`${author}`);
  else if (year) parts.push(`${year}`);

  if (tags.length) parts.push(tags.join(" · "));

  const line = parts.filter(Boolean).join(" · ");
  return line ? line : `Kurzer Überblick zu „${smartTrim(title, 40)}“.`;
}

/**
 * B) Überblick im Modal (Info) – mehr Kontext, ohne Editions (✅ wegen Fun Facts)
 */
function generateOverviewText(meta = {}) {
  const title = meta.title || "Dieses Buch";
  const author = safeAuthorName(meta.authorName);
  const year = formatYear(meta.firstPublishYear);
  const tags = pickTopLabels(meta.subjects, 3);

  const s1 = author ? `„${title}“ von ${author}${year ? ` (${year})` : ""}.` : `„${title}“${year ? ` (${year})` : ""}.`;

  const s2 = tags.length ? `Einordnung: ${tags.join(" · ")}.` : "";

  const s3 = tags.length
    ? `Thematisch wirkt es eher fokussiert als beliebig gemischt.`
    : `Mehr Details findest du in Stimmen, Empfehlungen und Fun Facts.`;

  return smartTrim([s1, s2, s3].filter(Boolean).join(" "), 260);
}

/**
 * C) Empfehlungstext (Begründung) – erklärt warum
 */
function hashString(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function generateRecommendationReason(base, candidate, signals = {}) {
  const baseTitle = base?.title || "deinem Buch";
  const candTitle = candidate?.title || "diesem Titel";
  const candAuthor = safeAuthorName(candidate?.authorName);

  const lines = [];

  if (signals.sameAuthor && candAuthor) {
    lines.push(`Gleiche Autorhandschrift (${candAuthor}) – gut als nächster Schritt.`);
  }

  if (signals.sharedLabels && signals.sharedLabels.length) {
    const top = signals.sharedLabels.slice(0, 2).join(" · ");
    lines.push(`Thematisch nah dran: ${top}.`);
  }

  if (signals.prefsBoost) lines.push(`Trifft deine Genre-Auswahl – daher höher gewichtet.`);
  if (signals.redditBoost) lines.push(`Wird auf Reddit im ähnlichen Kontext erwähnt.`);

  if (!lines.length) {
    const authorPart = candAuthor ? ` von ${candAuthor}` : "";
    lines.push(`Könnte zu „${smartTrim(baseTitle, 40)}“ passen – solider Kandidat${authorPart}.`);
  }

  const suffixes = [
    `Kein Random-Pick, eher kuratiert.`,
    `Wirkt wie eine sinnvolle Anschluss-Lektüre.`,
    `Wenn du in der Richtung bleiben willst, passt das.`,
    `Eher verwandt als zufällig.`
  ];
  const seed = hashString((candTitle || "") + "|" + (candAuthor || ""));
  const suffix = suffixes[seed % suffixes.length];

  return smartTrim(lines.join(" ") + " " + suffix, 220);
}

/** =========================
 *  Reddit
 *  ========================= */
function buildSubredditSearchPath(subreddit, query) {
  const params = new URLSearchParams({
    q: query,
    restrict_sr: "on",
    type: "link",
    sort: "relevance"
  });
  return `/r/${subreddit}/search.json?${params.toString()}`;
}

function calculateRedditScore(post) {
  const ups = post.ups || 0;
  const comments = post.numComments || 0;
  return ups * 0.7 + comments * 0.3;
}

async function fetchReddit(path) {
  const url = `${REDDIT_PROXY_BASE}?url=${encodeURIComponent(path)}`;

  let response;
  try {
    response = await fetch(url);
  } catch (err) {
    console.error("Netzwerkfehler beim Reddit-Proxy:", err);
    return { data: { children: [] } };
  }

  if (!response.ok) return { data: { children: [] } };

  try {
    return await response.json();
  } catch (err) {
    console.error("Konnte Reddit-JSON nicht parsen:", err);
    return { data: { children: [] } };
  }
}

async function searchRedditForQueryAcrossSubreddits(query) {
  const allPosts = [];

  for (const subreddit of REDDIT_SUBREDDITS) {
    const path = buildSubredditSearchPath(subreddit, query);
    const data = await fetchReddit(path);
    const children = data?.data?.children || [];

    const normalized = children.map(child => {
      const d = child.data;
      return {
        id: d.id,
        title: d.title,
        permalink: "https://www.reddit.com" + d.permalink,
        ups: d.ups,
        numComments: d.num_comments,
        subreddit: d.subreddit,
        createdUtc: d.created_utc
      };
    });

    allPosts.push(...normalized);
  }

  const queryLower = query.toLowerCase();
  const filtered = allPosts.filter(post => {
    const titleLower = (post.title || "").toLowerCase();
    const hasSignal = (post.ups || 0) >= 20 || (post.numComments || 0) >= 5;
    const mentionsQuery = titleLower.includes(queryLower);
    return hasSignal && mentionsQuery;
  });

  const withScore = filtered.map(post => ({ ...post, score: calculateRedditScore(post) }));
  withScore.sort((a, b) => b.score - a.score);

  return withScore.slice(0, 5);
}

function formatRelativeTimeFromUnix(createdUtc) {
  if (!createdUtc) return "";
  const now = Date.now();
  const then = createdUtc * 1000;
  const diffMs = now - then;

  const minutes = Math.floor(diffMs / (1000 * 60));
  const hours = Math.floor(diffMs / (1000 * 60 * 60));
  const days = Math.floor(diffMs / (1000 * 60 * 60 * 24));
  const years = Math.floor(days / 365);

  if (years > 0) return `vor ${years} Jahr${years === 1 ? "" : "en"}`;
  if (days > 0) return `vor ${days} Tag${days === 1 ? "" : "en"}`;
  if (hours > 0) return `vor ${hours} Stunde${hours === 1 ? "" : "n"}`;
  if (minutes > 0) return `vor ${minutes} Minute${minutes === 1 ? "" : "n"}`;
  return "gerade eben";
}

function renderVoices(posts) {
  const container =
    document.getElementById("voices-list") ||
    document.querySelector("#tab-voices .voices-list") ||
    document.querySelector("#tab-voices");

  if (!container) return;

  if (!posts.length) {
    container.innerHTML = `<p class="no-voices">Keine Reddit-Stimmen gefunden.</p>`;
    return;
  }

  container.innerHTML = posts.map(post => {
    const when = formatRelativeTimeFromUnix(post.createdUtc);
    const ups = post.ups ?? 0;
    const comments = post.numComments ?? 0;

    return `
      <article class="voice-item">
        <h4>${escapeHtml(post.title)}</h4>
        <p class="meta">
          in r/${escapeHtml(post.subreddit)}
          · 🗳️ ${ups.toLocaleString("de-DE")} Upvotes
          · 💬 ${comments.toLocaleString("de-DE")} Kommentare
          ${when ? "· " + when : ""}
        </p>
        <a href="${post.permalink}" target="_blank" rel="noopener noreferrer">
          Thread auf Reddit öffnen
        </a>
      </article>
    `;
  }).join("");
}

async function loadVoicesForBook(title) {
  const key = String(title || "").toLowerCase();
  const cached = redditVoicesCache[key];
  if (cached) {
    renderVoices(cached);
    return;
  }

  const container =
    document.getElementById("voices-list") ||
    document.querySelector("#tab-voices .voices-list") ||
    document.querySelector("#tab-voices");

  if (container) container.innerHTML = `<p class="loading">Lade Reddit-Stimmen …</p>`;

  const posts = await searchRedditForQueryAcrossSubreddits(title);
  redditVoicesCache[key] = posts;

  renderVoices(posts);
}

/** =========================
 *  OpenLibrary fetch + Work Details
 *  ========================= */
async function fetchOLJson(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`OpenLibrary Fehler: ${res.status}`);
  return res.json();
}

const workDetailsCache = new Map();

function extractWorkDescription(work) {
  const d = work?.description;
  if (!d) return "";
  if (typeof d === "string") return d.trim();
  if (typeof d === "object" && typeof d.value === "string") return d.value.trim();
  return "";
}

function pickWorkSubjects(work, max = 10) {
  const subs = Array.isArray(work?.subjects) ? work.subjects : [];
  return subs.slice(0, max).map(s => String(s));
}

function pickCoverIdFromWork(work) {
  // work.json: "covers": [id, ...]
  const covers = Array.isArray(work?.covers) ? work.covers : [];
  if (covers.length && Number.isFinite(Number(covers[0]))) return Number(covers[0]);
  return null;
}

async function fetchWorkDetails(workKey) {
  if (!workKey) return null;
  if (workDetailsCache.has(workKey)) return workDetailsCache.get(workKey);

  const url = `https://openlibrary.org${workKey}.json`;
  const work = await fetchOLJson(url);
  workDetailsCache.set(workKey, work);
  return work;
}

/** =========================
 *  Covers (Modal)
 *  ========================= */
function coverUrlFromId(coverId, size = "L") {
  if (!coverId) return "";
  return `https://covers.openlibrary.org/b/id/${coverId}-${size}.jpg`;
}

function ensureCoverImgEl() {
  const coverWrap =
    document.querySelector(".modal-cover") ||
    document.querySelector("[data-modal-cover]");

  if (!coverWrap) return null;

  let img = coverWrap.querySelector("img.cover-img");
  if (!img) {
    img = document.createElement("img");
    img.className = "cover-img is-hidden";
    img.alt = "Buchcover";
    coverWrap.appendChild(img);
  }
  return img;
}

function setModalCover({ coverId, title }) {
  const img = ensureCoverImgEl();
  if (!img) return;

  const placeholder =
    document.querySelector(".modal-cover-placeholder") ||
    document.querySelector(".modal-cover .modal-cover-placeholder");

  if (!coverId) {
    img.classList.add("is-hidden");
    img.removeAttribute("src");
    img.alt = title ? `Kein Cover: ${title}` : "Kein Cover";
    if (placeholder) placeholder.style.display = "";
    return;
  }

  img.src = coverUrlFromId(coverId, "L");
  img.alt = title ? `Cover von ${title}` : "Buchcover";
  img.classList.remove("is-hidden");
  if (placeholder) placeholder.style.display = "none";
}

/** =========================
 *  Modal Overview (Variante 2: Description aus Work-Details)
 *  ========================= */
const modalBackdrop = document.querySelector("[data-modal-backdrop]");
const modalTitleEl = document.querySelector(".modal-title");
const modalAuthorEl = document.querySelector(".modal-author");
const modalDescriptionEl = document.querySelector(".modal-description");
const modalCloseButton = document.querySelector("[data-modal-close]");
const modalTabs = document.querySelector(".modal-tabs");
const tabButtons = document.querySelectorAll(".modal-tab");
const tabPanels = document.querySelectorAll(".modal-panel");
let lastFocusedElement = null;

function setActiveTab(name) {
  tabButtons.forEach((button) => {
    const isActive = button.dataset.tab === name;
    button.classList.toggle("is-active", isActive);
    button.setAttribute("aria-selected", String(isActive));
  });

  tabPanels.forEach((panel) => {
    const isActive = panel.id === `tab-${name}` || panel.id === `tab-${name.replace("funfacts","facts")}`;
    panel.hidden = !isActive;
  });
}

function closeModal() {
  if (!modalBackdrop) return;
  modalBackdrop.hidden = true;

  document.body.style.overflow = "";

  if (lastFocusedElement && typeof lastFocusedElement.focus === "function") {
    lastFocusedElement.focus();
  }
}


function buildMetaFromCard(card) {
  const title = card.querySelector("h3")?.textContent || "";
  const authorName = card.querySelector(".author")?.textContent || "";

  const firstPublishYear = card.dataset.olFirstPublishYear ? Number(card.dataset.olFirstPublishYear) : 0;
  const editionCount = card.dataset.olEditionCount ? Number(card.dataset.olEditionCount) : 0;

  const subjects = (card.dataset.olSubjects || "")
    .split(",")
    .map(s => s.trim())
    .filter(Boolean);

  const authorKey = card.dataset.olAuthorKey || "";
  const workKey = card.dataset.olWorkKey || "";

  const coverId = card.dataset.olCoverId ? Number(card.dataset.olCoverId) : null;

  return { title, authorName, firstPublishYear, editionCount, subjects, authorKey, workKey, coverId };
}

function renderOverviewFromWork(meta, work) {
  if (!modalDescriptionEl) return;

  const title = meta.title || "Ohne Titel";
  const author = meta.authorName || "Unbekannte*r Autor*in";
  const year = meta.firstPublishYear ? String(meta.firstPublishYear) : "";

  const desc = extractWorkDescription(work);
  const subjects = pickWorkSubjects(work, 12);
  const labels = pickTopLabels(subjects, 3);

  if (!desc) {
    modalDescriptionEl.textContent = generateOverviewText({
      title,
      authorName: author,
      firstPublishYear: meta.firstPublishYear,
      subjects: meta.subjects
    });
    return;
  }

  // ✅ Überblick ohne Editions (damit Fun Facts “exklusiv” bleiben)
  const facts = [];
  if (year) facts.push(`<span>Erstveröffentlichung: <strong>${escapeHtml(year)}</strong></span>`);
  if (labels.length) facts.push(`<span>Einordnung: <strong>${escapeHtml(labels.join(" · "))}</strong></span>`);

  modalDescriptionEl.innerHTML = `
    <div class="overview-text">
      <p>${escapeHtml(desc)}</p>
      ${facts.length ? `<p class="overview-facts">${facts.join(" · ")}</p>` : ""}
    </div>
  `;
}

async function loadOverviewDetails(meta) {
  if (!modalDescriptionEl) return;
  modalDescriptionEl.textContent = "Lade Details …";

  try {
    const work = await fetchWorkDetails(meta.workKey);

    // Cover: Work kann bessere Cover-IDs haben als Search
    const workCoverId = pickCoverIdFromWork(work);
    setModalCover({ coverId: workCoverId || meta.coverId, title: meta.title });

    renderOverviewFromWork(meta, work);

    // Fun Facts parallel befüllen
    loadFunFacts(meta, work).catch(() => {});
  } catch (e) {
    console.warn("Work-Details konnten nicht geladen werden:", e);
    setModalCover({ coverId: meta.coverId, title: meta.title });

    modalDescriptionEl.textContent = generateOverviewText({
      title: meta.title,
      authorName: meta.authorName,
      firstPublishYear: meta.firstPublishYear,
      subjects: meta.subjects
    });

    // Fun Facts fallback (ohne Work)
    loadFunFacts(meta, null).catch(() => {});
  }
}

function openModalFromCard(card) {
  if (!modalBackdrop) return;

  const meta = buildMetaFromCard(card);

  setActiveTab("overview");

  if (modalTitleEl) modalTitleEl.textContent = meta.title;
  if (modalAuthorEl) modalAuthorEl.textContent = meta.authorName || "Unbekannte*r Autor*in";

  // Cover initial (kann später durch Work-Cover ersetzt werden)
  setModalCover({ coverId: meta.coverId, title: meta.title });

  // Overview: lädt Work-Details + befüllt Facts
  loadOverviewDetails(meta);

  // Stimmen (Reddit)
  loadVoicesForBook(meta.title);

  // Empfehlungen
  loadRecommendationsForBook({
    title: meta.title,
    authorKey: meta.authorKey,
    subjects: meta.subjects,
    workKey: meta.workKey,
    authorName: meta.authorName
  });

  lastFocusedElement = document.activeElement;
  modalBackdrop.hidden = false;
  document.body.style.overflow = "hidden";
  modalCloseButton?.focus();
}

/** =========================
 *  Search
 *  ========================= */
function renderSearchResults(books, resultsContainer) {
  const html = books.map(book => {
    const title = book.title || "Ohne Titel";
    const authorName = (book.author_name && book.author_name[0]) ? book.author_name[0] : "Unbekannte*r Autor*in";

    const firstPublishYear = book.first_publish_year || "";
    const editionCount = book.edition_count || "";

    const authorKey = (book.author_key && book.author_key[0]) ? book.author_key[0] : "";
    const workKey = book.key || ""; // "/works/OL..."

    const rawSubjects =
	  (Array.isArray(book.subject) && book.subject.length ? book.subject :
	   Array.isArray(book.subject_facet) && book.subject_facet.length ? book.subject_facet :
	   []);

	const subjectsArr = rawSubjects.slice(0, 12);

    const subjects = subjectsArr.map(s => String(s).toLowerCase()).join(",");

	const coverId = Number.isFinite(Number(book.cover_i)) ? Number(book.cover_i) : "";

	const coverHtml = coverId
	  ? `<div class="card-cover"><img src="${coverUrl(coverId, "M")}" alt="" loading="lazy" decoding="async"></div>`
	  : `<div class="card-cover" aria-hidden="true"></div>`;

	const year = formatYear(firstPublishYear);

	// Genre-Labels aus deinen Mappings (Sci-Fi, Fantasy, …)
	let labels = pickTopLabels(subjectsArr, 2);

	// Fallback: wenn Mapping nix findet, nimm 1–2 rohe Subjects (gekürzt)
	if (!labels.length) {
	  labels = subjectsArr
	    .slice(0, 2)
	    .map(s => String(s))
	    .map(s => s.split(" -- ")[0])  // OpenLibrary hat manchmal "X -- Y"
	    .map(s => smartTrim(s, 22));
	}

	const metaBits = [];
	if (year) metaBits.push(year);
	if (labels.length) metaBits.push(labels.join(" · "));
	const metaLine = metaBits.join(" · ");

	return `
	  <article class="card"
	    data-ol-work-key="${escapeHtml(workKey)}"
	    data-ol-author-key="${escapeHtml(authorKey)}"
	    data-ol-subjects="${escapeHtml(subjects)}"
	    data-ol-first-publish-year="${escapeHtml(firstPublishYear)}"
	    data-ol-edition-count="${escapeHtml(editionCount)}"
	    data-ol-cover-id="${escapeHtml(coverId)}"
	  >
	    <div class="card-inner has-fav">
	      <button class="fav-btn" type="button"
	        data-fav-toggle
	        data-fav-id="${escapeHtml(workKey)}"
	        data-fav='${escapeAttr(JSON.stringify({
	          workKey,
	          title,
	          author_name: [authorName],
	          cover_i: coverId
	        }))}'
	        aria-label="Zu Favoriten hinzufügen">☆</button>

	      <div class="card-row">
	        ${coverHtml}
	        <div class="card-main">
	          <h3>${escapeHtml(title)}</h3>
	          <p class="author">${escapeHtml(authorName)}</p>
	          ${metaLine ? `<p class="card-meta">${escapeHtml(metaLine)}</p>` : ""}
	        </div>
	      </div>
	    </div>
	  </article>
	`;
  }).join("");

  resultsContainer.innerHTML = html;

  // Tag 19: Favoriten UI aktualisieren
  renderFavorites();
  syncFavButtons();
}

async function handleSearch() {
  const suchfeldEl = document.getElementById("suchfeld");
  const eingabe = suchfeldEl?.value?.trim() || "";
  if (!eingabe) return;

  const resultsContainer = document.getElementById("results");
  if (!resultsContainer) return;

  resultsContainer.innerHTML = `
    <div class="loader-wrapper">
      <div class="loader"></div>
    </div>
  `;

  const url = "https://openlibrary.org/search.json?title=" + encodeURIComponent(eingabe);

  try {
    const data = await fetchOLJson(url);
    const books = (data.docs || []).slice(0, SEARCH_RESULTS_COUNT);

    if (!books.length) {
      resultsContainer.textContent = "Keine Treffer gefunden.";
      return;
    }

    renderSearchResults(books, resultsContainer);
    resultsContainer.scrollIntoView({ behavior: "smooth", block: "start" });
  } catch (err) {
    console.error("Fehler bei der Suche:", err);
    resultsContainer.textContent = "Ups, da ist etwas schiefgelaufen.";
  }
}

/** =========================
 *  Modal UI wiring
 *  ========================= */
(function wireUI() {
  const resultsRoot = document.getElementById("results");
  resultsRoot?.addEventListener("click", (event) => {
  if (event.target.closest("[data-fav-toggle]")) return; // ✅ Stern-Klick: kein Modal
  const card = event.target.closest(".card");
  if (!card) return;
  openModalFromCard(card);
});

  modalCloseButton?.addEventListener("click", closeModal);

  modalBackdrop?.addEventListener("click", (event) => {
    if (event.target === modalBackdrop) closeModal();
  });

  modalTabs?.addEventListener("click", (event) => {
    const button = event.target.closest(".modal-tab");
    if (!button) return;
    const name = button.dataset.tab;
    setActiveTab(name);
  });

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && modalBackdrop && !modalBackdrop.hidden) closeModal();
  });

  // Focus trap (minimal)
  document.addEventListener("keydown", (event) => {
    if (event.key !== "Tab" || !modalBackdrop || modalBackdrop.hidden) return;

    const focusableSelectors = [".modal-tab", "[data-modal-close]"];
    const focusable = modalBackdrop.querySelectorAll(focusableSelectors.join(","));
    const arr = Array.from(focusable).filter(el => !el.hasAttribute("disabled"));
    if (!arr.length) return;

    const first = arr[0];
    const last = arr[arr.length - 1];

    if (event.shiftKey) {
      if (document.activeElement === first) {
        event.preventDefault();
        last.focus();
      }
    } else {
      if (document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }
  });

  // ✅ Suche: IMMER über <form>-Submit (Mobile zuverlässig)
  const searchForm = document.getElementById("searchForm");
  searchForm?.addEventListener("submit", (e) => {
    e.preventDefault();
    handleSearch();
  });
})();

/** =========================
 *  Greeting bar (Tag 11)
 *  ========================= */
(function greetingBar() {
  const greetingBarEl = document.querySelector(".greeting-bar");
  const greetingClose = document.querySelector(".greeting-close");

  if (greetingClose && greetingBarEl) {
    greetingClose.addEventListener("click", () => {
      greetingBarEl.classList.add("is-hidden");
      localStorage.setItem("greetingDismissed", "true");
    });
  }

  if (localStorage.getItem("greetingDismissed") === "true") {
    greetingBarEl?.classList.add("is-hidden");
  }
})();

/** =========================
 *  Prefs (Slider + Chips)
 *  ========================= */
function getDefaultPrefs() {
  return { style: 50, pace: 50, complexity: 50, genres: [] };
}

function loadPrefs() {
  try {
    const raw = localStorage.getItem(PREFS_KEY);
    if (!raw) return getDefaultPrefs();
    const parsed = JSON.parse(raw);
    return { ...getDefaultPrefs(), ...parsed };
  } catch {
    return getDefaultPrefs();
  }
}

function savePrefs(prefs) {
  localStorage.setItem(PREFS_KEY, JSON.stringify(prefs));
}

function initPrefsUI() {
  const prefs = loadPrefs();

  const sliders = [
    { id: "pref-style", key: "style" },
    { id: "pref-pace", key: "pace" },
    { id: "pref-complexity", key: "complexity" }
  ];

  sliders.forEach(({ id, key }) => {
    const el = document.getElementById(id);
    const valEl = document.querySelector(`[data-pref-value="${key}"]`);
    if (!el) return;

    el.value = String(prefs[key]);
    el.style.setProperty("--value", `${el.value}%`);
    if (valEl) valEl.textContent = String(prefs[key]);

    el.addEventListener("input", () => {
      const v = Number(el.value);
      prefs[key] = v;
      el.style.setProperty("--value", `${v}%`);
      if (valEl) valEl.textContent = String(v);
      savePrefs(prefs);
    });
  });

  const chipButtons = document.querySelectorAll(".chip[data-genre]");
  chipButtons.forEach(btn => {
    const genre = btn.dataset.genre;
    const isActive = prefs.genres.includes(genre);
    btn.classList.toggle("is-active", isActive);
    btn.setAttribute("aria-pressed", String(isActive));

    btn.addEventListener("click", () => {
      const idx = prefs.genres.indexOf(genre);
      if (idx >= 0) prefs.genres.splice(idx, 1);
      else prefs.genres.push(genre);

      const active = prefs.genres.includes(genre);
      btn.classList.toggle("is-active", active);
      btn.setAttribute("aria-pressed", String(active));

      savePrefs(prefs);
    });
  });
}

document.addEventListener("DOMContentLoaded", initPrefsUI);

/** =========================
 *  Recommendation Engine (Tag 17)
 *  ========================= */
function normalizeWork(work) {
  const title = work.title || "Ohne Titel";
  const key = work.key || "";
  const coverId = work.cover_id || (work.cover_edition_key ? work.cover_edition_key : null);

  let authorName = "";
  let authorKey = "";

  if (Array.isArray(work.authors) && work.authors[0]) {
    const a = work.authors[0];
    authorName = a?.name || a?.author?.name || "";
    authorKey = a?.key || a?.author?.key || "";
  }

  if (!authorName && Array.isArray(work.author_name) && work.author_name[0]) {
    authorName = work.author_name[0];
  }

  if (!authorName) authorName = "Unbekannte*r Autor*in";

  const subjects = Array.isArray(work.subjects)
    ? work.subjects.map(s => String(s).toLowerCase())
    : (Array.isArray(work.subject) ? work.subject.map(s => String(s).toLowerCase()) : []);

  // year/editioncount sind je nach Endpoint unterschiedlich → optional
  const firstPublishYear = work.first_publish_year || work.first_publish_date || "";
  const editionCount = work.edition_count || "";

  return { title, key, authorName, authorKey, coverId, subjects, firstPublishYear, editionCount };
}

async function getAuthorWorks(authorKey, limit = 20) {
  if (!authorKey) return [];
  const url = `https://openlibrary.org/authors/${authorKey}/works.json?limit=${limit}`;
  const data = await fetchOLJson(url);
  return (data?.entries || []).map(normalizeWork);
}

async function getSubjectWorks(subject, limit = 20) {
  if (!subject) return [];
  const safe = encodeURIComponent(subject.toLowerCase().replace(/\s+/g, "_"));
  const url = `https://openlibrary.org/subjects/${safe}.json?limit=${limit}`;
  const data = await fetchOLJson(url);
  return (data?.works || []).map(normalizeWork);
}

function dedupeByKey(items) {
  const map = new Map();
  for (const it of items) {
    if (!it.key) continue;
    if (!map.has(it.key)) map.set(it.key, it);
  }
  return Array.from(map.values());
}

function genreToSubjectHints(genreKey) {
  const map = {
    fantasy: ["fantasy"],
    scifi: ["science_fiction", "sci-fi", "space", "dystopia"],
    mystery: ["mystery", "detective", "crime", "thriller"],
    romance: ["romance", "love"],
    nonfiction: ["nonfiction", "history", "biography", "essays"],
    classics: ["classic", "classics", "literature"]
  };
  return map[genreKey] || [];
}

function calcPrefsScore(candidate, prefs) {
  if (!prefs?.genres?.length) return 0;
  const candSubs = candidate.subjects || [];
  let score = 0;

  for (const g of prefs.genres) {
    const hints = genreToSubjectHints(g);
    const hit = hints.some(h => candSubs.includes(h));
    if (hit) score += 1;
  }
  return Math.min(1, score / Math.max(1, prefs.genres.length));
}

function calcRedditMentionScore(currentTitle, candidateTitle) {
  const cached = redditVoicesCache[currentTitle.toLowerCase()];
  if (!cached || !cached.length) return 0;

  const cand = (candidateTitle || "").toLowerCase();
  if (!cand || cand.length < 4) return 0;

  let best = 0;
  for (const post of cached) {
    const t = (post.title || "").toLowerCase();
    if (t.includes(cand)) {
      best = Math.max(best, post.score || calculateRedditScore(post));
    }
  }
  return best > 0 ? Math.log10(best + 1) : 0;
}

function calcOlBaseScore(candidate) {
  const len = (candidate.title || "").length;
  return 1 + Math.min(0.5, len / 200);
}

function sharedLabels(baseSubjects, candSubjects) {
  const base = new Set(pickTopLabels(baseSubjects, 6));
  const cand = pickTopLabels(candSubjects, 6);
  return cand.filter(x => base.has(x));
}

/** =========================
 *  Language filter (DE/EN)
 *  ========================= */
const editionsLangCache = new Map();
const ALLOWED_LANGS = new Set(["eng", "ger", "deu"]);

function workKeyToId(workKey) {
  return String(workKey || "").split("/").pop();
}

async function getWorkEditionLangs(workKey, limit = 20) {
  if (!workKey) return new Set();
  if (editionsLangCache.has(workKey)) return editionsLangCache.get(workKey);

  const id = workKeyToId(workKey);
  const url = `https://openlibrary.org/works/${id}/editions.json?limit=${limit}`;

  let langs = new Set();
  try {
    const data = await fetchOLJson(url);
    const entries = data?.entries || [];

    for (const ed of entries) {
      const edLangs = ed?.languages || [];
      for (const l of edLangs) {
        const key = (l?.key || "").toLowerCase();
        const code = key.split("/").pop();
        if (code) langs.add(code);
      }
    }
  } catch {
    langs = new Set();
  }

  editionsLangCache.set(workKey, langs);
  return langs;
}

function isAllowedLangSet(langSet) {
  if (!langSet || langSet.size === 0) return true;
  for (const l of langSet) {
    if (ALLOWED_LANGS.has(l)) return true;
  }
  return false;
}

async function filterRecommendationsByLanguage(scoredCandidates, wantCount = 3) {
  const MAX_CHECK = Math.min(15, scoredCandidates.length);
  const picked = [];

  for (let i = 0; i < MAX_CHECK; i++) {
    const c = scoredCandidates[i];
    const langSet = await getWorkEditionLangs(c.key, 20);

    if (isAllowedLangSet(langSet)) {
      picked.push({ ...c, langSet });
      if (picked.length >= wantCount) break;
    }
  }

  if (picked.length < wantCount) {
    return scoredCandidates.slice(0, wantCount).map(c => ({ ...c, langSet: new Set() }));
  }

  return picked;
}

/** =========================
 *  Recommendations render
 *  ========================= */
async function loadRecommendationsForBook({ title, authorKey, subjects, workKey, authorName }) {
  const list =
    document.getElementById("recommendations-list") ||
    document.querySelector(".recommendations-list") ||
    document.querySelector("#tab-recommendations") ||
    document.querySelector("#tab-empfehlungen");

  if (!list) return;

  const recsTitle = document.getElementById("recs-title");
  if (recsTitle) recsTitle.textContent = title;

  list.innerHTML = `<p class="loading">Lade Empfehlungen …</p>`;

  // Tag 19: Favoriten UI aktualisieren
  renderFavorites();
  syncFavButtons();

  const prefs = loadPrefs();
  const baseMeta = { title, authorName, subjects: subjects || [] };

  const topSubjects = (subjects || []).slice(0, 2);
  let candidates = [];

  try {
    const [authorWorks, subj1, subj2] = await Promise.all([
      getAuthorWorks(authorKey, 20),
      getSubjectWorks(topSubjects[0], 20),
      getSubjectWorks(topSubjects[1], 20)
    ]);
    candidates = [...authorWorks, ...subj1, ...subj2];
  } catch (e) {
    console.warn("Empfehlungen konnten nicht geladen werden:", e);
    list.innerHTML = `<p class="no-voices">Heute keine Empfehlungen verfügbar.</p>`;
    return;
  }

  candidates = dedupeByKey(candidates);

  // ✅ harte Filter: kein gleiches Work, kein gleicher Titel
  const baseNorm = normalizeTitle(title);
  candidates = candidates.filter(c => {
    if (!c.key) return false;
    if (workKey && c.key === workKey) return false;
    if (normalizeTitle(c.title) === baseNorm) return false;
    return true;
  });

  const scored = candidates.map(c => {
    const ol = calcOlBaseScore(c);
    const pref = calcPrefsScore(c, prefs);
    const reddit = calcRedditMentionScore(title, c.title);

    const finalScore = ol * 0.55 + reddit * 0.25 + pref * 0.20;
    return { ...c, ol, pref, reddit, finalScore };
  });

  scored.sort((a, b) => b.finalScore - a.finalScore);

  const filteredTop = await filterRecommendationsByLanguage(scored, 6);

  // ✅ keine doppelten Titel, nimm top 3
  const picked = [];
  const seenTitle = new Set();
  for (const s of filteredTop) {
    const n = normalizeTitle(s.title);
    if (seenTitle.has(n)) continue;
    seenTitle.add(n);
    picked.push(s);
    if (picked.length >= 3) break;
  }

  if (!picked.length) {
    list.innerHTML = `<p class="no-voices">Keine passenden Empfehlungen gefunden.</p>`;
    return;
  }

  list.innerHTML = picked.map(rec => {
    let displayAuthor = rec.authorName;
    const recAuthorSafe = safeAuthorName(displayAuthor);
    if (!recAuthorSafe) displayAuthor = authorName || "Unbekannte*r Autor*in";

    const sameAuthor =
      safeAuthorName(displayAuthor) && safeAuthorName(authorName)
        ? normalizeTitle(displayAuthor) === normalizeTitle(authorName)
        : false;

    const shared = sharedLabels(subjects, rec.subjects);

    const signals = {
      sameAuthor,
      sharedLabels: shared,
      prefsBoost: rec.pref > 0.2,
      redditBoost: rec.reddit > 0
    };

    const reason = generateRecommendationReason(
      baseMeta,
      { title: rec.title, authorName: displayAuthor, subjects: rec.subjects },
      signals
    );

    // ✅ Meta am Card hängen, damit Modal “voll” arbeiten kann (Cover/Overview/Facts)
    return `
	  <article class="card"
	    data-ol-work-key="${escapeHtml(rec.key)}"
	    data-ol-author-key="${escapeHtml(rec.authorKey || authorKey || "")}"
	    data-ol-subjects="${escapeHtml((rec.subjects || []).slice(0, 12).join(","))}"
	    data-ol-first-publish-year="${escapeHtml(rec.firstPublishYear || "")}"
	    data-ol-edition-count="${escapeHtml(rec.editionCount || "")}"
	    data-ol-cover-id="${escapeHtml(rec.coverId || "")}"
	  >
	    <div class="card-inner has-fav">

	      <button class="fav-btn" type="button"
	        data-fav-toggle
	        data-fav-id="${escapeHtml(rec.key)}"
	        data-fav='${escapeAttr(JSON.stringify({
	          workKey: rec.key,
	          title: rec.title,
	          authorName: displayAuthor,
	          coverId: rec.coverId || null
	        }))}'
	        aria-label="Zu Favoriten hinzufügen">☆</button>

	      <h3>${escapeHtml(rec.title)}</h3>
	      <p class="author">${escapeHtml(displayAuthor)}</p>
	      <p class="kurztext">${escapeHtml(reason)}</p>
	    </div>
	  </article>
	`;

  }).join("");

  // Klicks innerhalb Recommendations öffnen ebenfalls Modal
  if (!list.dataset.boundClicks) {
	list.addEventListener("click", (event) => {
	  if (event.target.closest("[data-fav-toggle]")) return; // ✅ Stern-Klick: kein Modal
	  const card = event.target.closest(".card");
	  if (!card) return;
	  openModalFromCard(card);
	});
    list.dataset.boundClicks = "true";
  }
}

/** =========================
 *  Fun Facts (Tag 17) – bewusst “anders” als Overview
 *  ========================= */
function getFunFactsContainer() {
  // Unterstützt mehrere mögliche Strukturen/IDs
  return (
    document.querySelector("#tab-funfacts .funfacts-list") ||
    document.querySelector("#tab-facts .funfacts-list") ||
    document.querySelector("#tab-funfacts") ||
    document.querySelector("#tab-facts")
  );
}

function renderFunFacts(items) {
  const container = getFunFactsContainer();
  if (!container) return;

  // Wenn Container direkt das Panel ist: wir erzeugen UL darin
  let ul = container.matches("ul") ? container : container.querySelector("ul.funfacts-list");
  if (!ul) {
    ul = document.createElement("ul");
    ul.className = "funfacts-list";
    container.innerHTML = "";
    container.appendChild(ul);
  }

  ul.innerHTML = items.map(it => {
    return `
      <li>
        <span class="ff-ico">${it.icon}</span>
        <span class="ff-text">${it.html}</span>
      </li>
    `;
  }).join("");
}

async function loadFunFacts(meta, work) {
  const title = meta.title || "Dieses Buch";
  const year = formatYear(meta.firstPublishYear);
  const workSubjects = work ? pickWorkSubjects(work, 30) : (meta.subjects || []);
  const labels = pickTopLabels(workSubjects, 3);

  // Languages sample
  let langs = new Set();
  try {
    langs = await getWorkEditionLangs(meta.workKey, 20);
  } catch {
    langs = new Set();
  }
  const langArr = Array.from(langs).slice(0, 6);
  const hasDEorEN = langArr.some(l => ["eng", "ger", "deu"].includes(l));

  // Reddit stats (aus Cache; falls noch leer → “kommt gleich”)
  const cached = redditVoicesCache[String(title).toLowerCase()] || [];
  const redditCount = cached.length;
  const upsSum = cached.reduce((a, p) => a + (p.ups || 0), 0);
  const comSum = cached.reduce((a, p) => a + (p.numComments || 0), 0);

  const desc = work ? extractWorkDescription(work) : "";
  const descLangHint = desc ? (looksEnglish(desc) ? "EN" : "unklar") : "";

  const facts = [];

  // ✅ Fun Facts sollen “witzig/leicht” wirken – nicht wie Overview-Meta
  if (year) {
    facts.push({
      icon: "📅",
      html: `Erstveröffentlichung: <strong>${escapeHtml(year)}</strong> – schon ein paar Winter alt.`
    });
  }

  if (work && Array.isArray(work.covers) && work.covers.length) {
    facts.push({
      icon: "🖼️",
      html: `Open Library kennt hier <strong>${work.covers.length}</strong> Cover-Varianten (wir zeigen eins).`
    });
  }

  if (labels.length) {
    facts.push({
      icon: "🏷️",
      html: `Schublade (kuratiert): <strong>${escapeHtml(labels.join(" · "))}</strong>.`
    });
  }

  if (langArr.length) {
    facts.push({
      icon: "🌍",
      html: `Editions-Sprachen (Stichprobe): <strong>${escapeHtml(langArr.join(", "))}</strong>${hasDEorEN ? " (DE/EN dabei)" : ""}.`
    });
  } else {
    facts.push({
      icon: "🌍",
      html: `Sprachen der Editionen sind gerade nicht abrufbar (Open Library zickt manchmal).`
    });
  }

  if (redditCount > 0) {
    facts.push({
      icon: "👀",
      html: `Reddit-Radar: <strong>${redditCount}</strong> Top-Threads im Cache · 🗳️ ${upsSum.toLocaleString("de-DE")} Upvotes · 💬 ${comSum.toLocaleString("de-DE")} Kommentare.`
    });
  } else {
    facts.push({
      icon: "👀",
      html: `Reddit-Radar: Noch nichts im Cache – öffne kurz den “Stimmen”-Tab, dann laden wir nach.`
    });
  }

  const subjCount = Array.isArray(work?.subjects) ? work.subjects.length : (meta.subjects?.length || 0);
  if (subjCount) {
    facts.push({
      icon: "🧩",
      html: `Open Library hat <strong>${subjCount}</strong> Subjects hinterlegt (wir filtern auf die wichtigsten).`
    });
  }

  renderFunFacts(facts);
}

/** =========================
 *  Snow (Tag 18) – mehr Schnee + Toggle als Switch
 *  ========================= */
function getSnowEnabled() {
  const raw = localStorage.getItem(SNOW_KEY);
  if (raw === null) return true; // default ON
  return raw === "true";
}

function setSnowEnabled(v) {
  localStorage.setItem(SNOW_KEY, String(Boolean(v)));
}

function ensureSnowLayer() {
  let layer = document.querySelector(".snow-layer");
  if (!layer) {
    layer = document.createElement("div");
    layer.className = "snow-layer";
    document.body.appendChild(layer);
  }
  return layer;
}

function clearSnow() {
  const layer = document.querySelector(".snow-layer");
  if (layer) layer.innerHTML = "";
}

function spawnSnowflakes(amount = 90) {
  const layer = ensureSnowLayer();
  layer.innerHTML = "";

  const w = window.innerWidth;
  const h = window.innerHeight;

  for (let i = 0; i < amount; i++) {
    const flake = document.createElement("div");
    flake.className = "snowflake";

    // Position
    const left = Math.random() * w;
    const size = 2 + Math.random() * 5.5;       // ✅ mehr Varianz
    const opacity = 0.35 + Math.random() * 0.65;

    // Dauer
    const fallDur = 7 + Math.random() * 12;     // ✅ etwas schneller/lebendiger
    const swayDur = 2.5 + Math.random() * 4.5;

    // Delay
    const delay = -Math.random() * fallDur;

    flake.style.left = `${left}px`;
    flake.style.width = `${size}px`;
    flake.style.height = `${size}px`;
    flake.style.opacity = `${opacity}`;
    flake.style.animationDuration = `${fallDur}s, ${swayDur}s`;
    flake.style.animationDelay = `${delay}s, ${-Math.random() * swayDur}s`;

    // kleine “Tiefe”: weiter hinten = kleiner + transparenter
    if (size < 4) flake.style.filter = "drop-shadow(0 1px 2px rgba(0,0,0,0.10))";

    layer.appendChild(flake);
  }
}

function ensureSnowToggle() {
  let wrap = document.querySelector(".snow-toggle");
  if (wrap) return wrap;

  wrap = document.createElement("div");
  wrap.className = "snow-toggle";
  wrap.innerHTML = `
    <label class="snow-toggle__label">
      <span class="snow-toggle__text">❄️ Schnee</span>
      <input class="snow-toggle__input" type="checkbox" />
      <span class="snow-toggle__pill" aria-hidden="true"></span>
    </label>
  `;
  document.body.appendChild(wrap);

  const input = wrap.querySelector(".snow-toggle__input");
  input.checked = getSnowEnabled();

  input.addEventListener("change", () => {
    const on = input.checked;
    setSnowEnabled(on);
    if (on) spawnSnowflakes(getSnowflakeCount());
    else clearSnow();
  });

  return wrap;
}

function getSnowflakeCount() {
  // ✅ automatisch “mehr” auf großen Screens
  const base = 90;
  const extra = Math.round((window.innerWidth * window.innerHeight) / 400000);
  return Math.min(180, base + extra * 10);
}

function initSnow() {
  ensureSnowToggle();

  if (getSnowEnabled()) {
    spawnSnowflakes(getSnowflakeCount());
  } else {
    clearSnow();
  }

  // Bei Resize neu “dichten” (aber nicht zu aggressiv)
  let t = null;
  window.addEventListener("resize", () => {
    if (!getSnowEnabled()) return;
    clearTimeout(t);
    t = setTimeout(() => spawnSnowflakes(getSnowflakeCount()), 250);
  });
}

document.addEventListener("DOMContentLoaded", initSnow);

// =========================
// Tag 19: Favoriten / Merkliste
// =========================

const FAVORITES_KEY = "readdit:favorites";

function safeJsonParse(value, fallback) {
  try { return JSON.parse(value); } catch { return fallback; }
}

function getFavorites() {
  const parsed = safeJsonParse(localStorage.getItem(FAVORITES_KEY), []);
  return Array.isArray(parsed) ? parsed : [];
}

function saveFavorites(favs) {
  localStorage.setItem(FAVORITES_KEY, JSON.stringify(favs));
}

function isFavorite(id) {
  return getFavorites().some(f => f.id === id);
}

/**
 * Normalisiert ein OpenLibrary-"doc"/"book"-Objekt zu einem stabilen Favorite.
 * Erwartet mindestens: key ("/works/OL...") ODER workKey.
 */
function normalizeToFavorite(book) {
  const id =
    book?.workKey ||
    book?.key ||
    book?.work_key ||
    book?.olid ||
    book?.id;

  if (!id) return null;

  const title = book?.title ?? "Unbekannter Titel";

  // häufige Felder bei OL docs:
  const author =
    (Array.isArray(book?.author_name) ? book.author_name[0] : null) ||
    book?.author ||
    book?.authorName ||
    "Unbekannt";

  const coverId =
    book?.cover_i ??
    book?.coverId ??
    null;

  return { id, title, author, coverId };
}

function toggleFavorite(bookLike) {
  const fav = normalizeToFavorite(bookLike);
  if (!fav) return;

  const favs = getFavorites();
  const idx = favs.findIndex(f => f.id === fav.id);

  if (idx >= 0) {
    favs.splice(idx, 1);
  } else {
    favs.unshift(fav); // neu oben
  }

  saveFavorites(favs);
  renderFavorites();
  syncFavButtons(); // Sterne in Results/Recommendations aktualisieren
}

function coverUrl(coverId, size = "M") {
  if (!coverId) return "";
  return `https://covers.openlibrary.org/b/id/${coverId}-${size}.jpg`;
}

function renderFavorites() {
  const host = document.getElementById("favoritesList");
  if (!host) return;

  const favs = getFavorites();

  if (!favs.length) {
    host.innerHTML = `<p class="fav-empty">Noch keine Favoriten. Tippe auf ☆ bei einem Buch.</p>`;
    return;
  }

  host.innerHTML = favs.map(f => {
    const img = f.coverId
	  ? `<img class="fav-cover-img" src="${coverUrl(f.coverId, "M")}" alt="" loading="lazy" decoding="async" />`
	  : "";

    return `
      <article class="card" data-fav-card data-fav-id="${escapeHtml(f.id)}">
        <div class="card-inner has-fav">
          <button class="fav-btn is-active" type="button"
            data-fav-toggle
            data-fav-id="${escapeHtml(f.id)}"
            data-fav='${escapeAttr(JSON.stringify(f))}'
            aria-label="Aus Favoriten entfernen">★</button>

          <h3>${escapeHtml(f.title)}</h3>
          <p class="author">${escapeHtml(f.author)}</p>

          ${img ? `<div class="fav-cover">${img}</div>` : ""}
        </div>
      </article>
    `;
  }).join("");

  // Tag 19: Favoriten-Buttons nach Render korrekt setzen
  syncFavButtons();
}

function syncFavButtons() {
  document.querySelectorAll("[data-fav-toggle][data-fav-id]").forEach(btn => {
    const id = btn.getAttribute("data-fav-id");
    const active = isFavorite(id);
    btn.classList.toggle("is-active", active);
    btn.textContent = active ? "★" : "☆";
    btn.setAttribute("aria-label", active ? "Aus Favoriten entfernen" : "Zu Favoriten hinzufügen");
  });
}

// Event Delegation: klick auf Stern toggle, ohne Card/Modal-Click zu triggern
document.addEventListener("click", (e) => {
  const btn = e.target.closest("[data-fav-toggle]");
  if (!btn) return;

  e.preventDefault();
  e.stopPropagation();

  const raw = btn.getAttribute("data-fav");
  const data = safeJsonParse(raw, null);

  if (data) toggleFavorite(data);
});

document.addEventListener("DOMContentLoaded", () => {
  renderFavorites();
  syncFavButtons();
});

// =========================
// Tag 20 – Santa Easter Egg (PNG only)
// =========================
const SANTA_EGG_KEY = "readdit:santaEgg:last";

function showSantaToast(text = "Santa bringt Geschenke 🎁") {
  const t = document.createElement("div");
  t.className = "santa-toast";
  t.innerHTML = `🎅 <span>${escapeHtml(text)}</span>`;
  document.body.appendChild(t);
  setTimeout(() => t.remove(), 2400);
}

function ensureSantaEl() {
  let el = document.querySelector(".santa-egg");
  if (el) return el;

  el = document.createElement("div");
  el.className = "santa-egg";
  el.innerHTML = `
    <img
      src="assets/santa/santa-sleigh.png"
      alt="Santa im Schlitten"
      class="santa-egg__img"
      loading="eager"
      decoding="async"
    />
  `;

  document.body.appendChild(el);
  return el;
}

function playSantaJingle() {
  const ctx = new (window.AudioContext || window.webkitAudioContext)();
  const master = ctx.createGain();
  master.connect(ctx.destination);
  master.gain.value = 0.28; // 🔊 etwas lauter

  const notes = {
    E5: 659.25,
    G5: 783.99,
    C5: 523.25,
    D5: 587.33,
    F5: 698.46,
    A5: 880.0,
    B4: 493.88,
    G4: 392.0,
    C6: 1046.5
  };

  const melody = [
    ["E5", 0.3], ["E5", 0.3], ["E5", 0.6],
    ["E5", 0.3], ["E5", 0.3], ["E5", 0.6],

    ["E5", 0.3], ["G5", 0.3], ["C5", 0.4], ["D5", 0.4],
    ["E5", 0.8],

    ["F5", 0.3], ["F5", 0.3], ["F5", 0.4], ["F5", 0.3],
    ["F5", 0.3], ["E5", 0.3], ["E5", 0.3], ["E5", 0.3],

    ["E5", 0.3], ["D5", 0.3], ["D5", 0.3], ["E5", 0.3],
    ["D5", 0.6], ["G4", 0.6],
  ];

  let t = ctx.currentTime;

  melody.forEach(([note, duration]) => {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();

    osc.type = "triangle";
    osc.frequency.value = notes[note];

    gain.gain.setValueAtTime(0, t);
    gain.gain.linearRampToValueAtTime(0.32, t + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + duration);

    osc.connect(gain);
    gain.connect(master);

    osc.start(t);
    osc.stop(t + duration);

    t += duration + 0.02;
  });

  setTimeout(() => ctx.close(), (t - ctx.currentTime + 0.5) * 1000);
}

function dropSantaGifts(totalMs = 4200, everyMs = 220) {
  const gifts = ["🎁", "🧸", "🍪", "🎄", "📚"];
  const start = Date.now();

  const timer = setInterval(() => {
    const elapsed = Date.now() - start;
    if (elapsed > totalMs) {
      clearInterval(timer);
      return;
    }

    const burst = Math.random() < 0.35 ? 2 : 1;

    for (let i = 0; i < burst; i++) {
      const g = document.createElement("div");
      g.className = "santa-gift";
      g.textContent = gifts[Math.floor(Math.random() * gifts.length)];

      g.style.left = Math.random() * 100 + "vw";
      g.style.animationDelay = "0s";
      g.style.fontSize = (18 + Math.random() * 14) + "px";

      document.body.appendChild(g);
      setTimeout(() => g.remove(), 4200);
    }
  }, everyMs);
}

function triggerSanta(reason = "Santa bringt Geschenke 🎁") {
  // cooldown: max 1x pro 20s
  const last = Number(localStorage.getItem(SANTA_EGG_KEY) || "0");
  const now = Date.now();
  if (now - last < 20000) return;
  localStorage.setItem(SANTA_EGG_KEY, String(now));

  const el = ensureSantaEl();

  // ✅ Animation zuverlässig neu starten
  el.classList.remove("is-flying");
  void el.offsetWidth;
  el.classList.add("is-flying");

  showSantaToast(reason);
  playSantaJingle();

  // ✅ Geschenk-Regen über die Flugzeit (muss zu CSS passen)
  const FLIGHT_MS = 8000;
  setTimeout(() => dropSantaGifts(FLIGHT_MS - 600, 220), 450);

  // ✅ Cleanup
  setTimeout(() => el.classList.remove("is-flying"), FLIGHT_MS + 150);
}

function initSantaEasterEgg() {
  const KONAMI = [
    "ArrowUp","ArrowUp","ArrowDown","ArrowDown",
    "ArrowLeft","ArrowRight","ArrowLeft","ArrowRight",
    "b","a"
  ];
  let konamiPos = 0;

  const MAGIC = "hohoho";
  let typed = "";

  document.addEventListener("keydown", (e) => {
    // Konami
    const k = e.key.length === 1 ? e.key.toLowerCase() : e.key;
    const expected = KONAMI[konamiPos];
    if (k === expected || e.key === expected) konamiPos++;
    else konamiPos = 0;

    if (konamiPos >= KONAMI.length) {
      konamiPos = 0;
      triggerSanta("Konami! 🎮 Santa bringt Geschenke 🎁");
      return;
    }

    // "hohoho"
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    if (e.key && e.key.length === 1) {
      typed = (typed + e.key.toLowerCase()).slice(-10);
      if (typed.includes(MAGIC)) {
        typed = "";
        triggerSanta("Ho ho ho! 🎁");
      }
    }
  });

  const logo = document.querySelector(".logo");
  logo?.addEventListener("dblclick", () =>
    triggerSanta("Doppelklick entdeckt 👀🎅")
  );
}

document.addEventListener("DOMContentLoaded", initSantaEasterEgg);

// 🔔 Debug / Easter Egg Hook (nur für DevTools-Konsole)
window.triggerSanta = triggerSanta;
