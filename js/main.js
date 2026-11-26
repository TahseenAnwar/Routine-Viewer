// main.js
// Wires the page together: upload -> search -> add -> weekly view.

import { readRoutinePdf } from "./pdfReader.js";
import { renderCalendar, sectionsConflict, fmtTime } from "./calendar.js";

const MAX_RESULTS = 50;
const STORE_SECTIONS = "routine.sections.v1";
const STORE_SELECTED = "routine.selected.v1";

// ---------- State ----------
let allSections = [];      // every section parsed from the PDF
let selectedIds = [];      // ids the user added to the routine

// ---------- Elements ----------
const $ = (id) => document.getElementById(id);
const fileInput = $("pdfInput");
const statusEl = $("status");
const progressEl = $("progress");
const searchInput = $("searchInput");
const resultsEl = $("results");
const resultsInfo = $("resultsInfo");
const calendarEl = $("calendar");
const selectedListEl = $("selectedList");
const warningEl = $("warning");
const clearBtn = $("clearBtn");
const printBtn = $("printBtn");

// ---------- Helpers ----------
function el(tag, className, text) {
  const e = document.createElement(tag);
  if (className) e.className = className;
  if (text !== undefined) e.textContent = text;
  return e;
}

function save() {
  try {
    localStorage.setItem(STORE_SELECTED, JSON.stringify(selectedIds));
  } catch (_) {}
}

function saveSections() {
  try {
    localStorage.setItem(STORE_SECTIONS, JSON.stringify(allSections));
  } catch (_) {}
}

function load() {
  try {
    const s = JSON.parse(localStorage.getItem(STORE_SECTIONS) || "null");
    const sel = JSON.parse(localStorage.getItem(STORE_SELECTED) || "[]");
    if (Array.isArray(s) && s.length) {
      allSections = s;
      selectedIds = sel.filter((id) => s.some((x) => x.id === id));
      setStatus(`Loaded ${s.length} sections from your last upload.`);
    }
  } catch (_) {}
}

function setStatus(msg) {
  statusEl.textContent = msg;
}

const byId = (id) => allSections.find((s) => s.id === id);
const selectedSections = () => selectedIds.map(byId).filter(Boolean);

function meetingText(m) {
  return `${m.dayCode} ${fmtTime(m.start)} – ${fmtTime(m.end)}` + (m.room ? ` · ${m.room}` : "");
}

// ---------- Add / remove ----------
function addSection(id) {
  const s = byId(id);
  if (!s || selectedIds.includes(id)) return;
  // One section per course: swap out any other section of the same course
  const same = selectedSections().find((x) => x.course === s.course);
  if (same) {
    selectedIds = selectedIds.filter((x) => x !== same.id);
    setStatus(`Replaced ${same.course} Sec ${same.section} with Sec ${s.section}.`);
  }
  selectedIds.push(id);
  save();
  refresh();
}

function removeSection(id) {
  selectedIds = selectedIds.filter((x) => x !== id);
  save();
  refresh();
}

// ---------- Search ----------
function runSearch() {
  const q = searchInput.value.trim().toLowerCase();
  resultsEl.replaceChildren();

  if (!allSections.length) {
    resultsInfo.textContent = "Upload the routine PDF to start searching.";
    return;
  }
  if (!q) {
    resultsInfo.textContent = `${allSections.length} sections loaded. Type a course code like “CSE” or “ACT101”.`;
    return;
  }

  const tokens = q.split(/\s+/);
  const matches = allSections.filter((s) => {
    const hay = (
      `${s.course} sec ${s.section} ${s.dept} ` +
      s.meetings.map((m) => `${m.dayCode} ${m.room}`).join(" ")
    ).toLowerCase();
    return tokens.every((t) => hay.includes(t));
  });

  resultsInfo.textContent = matches.length
    ? matches.length > MAX_RESULTS
      ? `Showing first ${MAX_RESULTS} of ${matches.length} matches. Refine your search.`
      : `${matches.length} match${matches.length === 1 ? "" : "es"}.`
    : "No matches.";

  const chosen = selectedSections();
  for (const s of matches.slice(0, MAX_RESULTS)) {
    const isAdded = selectedIds.includes(s.id);
    const clash = !isAdded && chosen.filter((c) => c.course !== s.course).some((c) => sectionsConflict(c, s));

    const card = el("li", "result" + (isAdded ? " added" : ""));
    const info = el("div", "result-info");
    const title = el("div", "result-title");
    title.append(el("strong", "", s.course), el("span", "sec", ` · Sec ${s.section}`));
    info.appendChild(title);
    for (const m of s.meetings) info.appendChild(el("div", "result-meta", meetingText(m)));
    const extra = [s.dept && `Dept: ${s.dept}`, s.capacity && `Seats: ${s.capacity}`].filter(Boolean).join(" · ");
    if (extra) info.appendChild(el("div", "result-meta dim", extra));
    if (clash) info.appendChild(el("div", "result-clash", "⚠ Overlaps with your routine"));
    card.appendChild(info);

    const btn = el("button", "btn small " + (isAdded ? "ghost" : "primary"), isAdded ? "Remove" : "Add");
    btn.type = "button";
    btn.addEventListener("click", () => (isAdded ? removeSection(s.id) : addSection(s.id)));
    card.appendChild(btn);
    resultsEl.appendChild(card);
  }
}

// ---------- Rendering ----------
function renderSelectedList() {
  selectedListEl.replaceChildren();
  const list = selectedSections();
  if (!list.length) {
    selectedListEl.appendChild(el("li", "empty", "Nothing added yet."));
    return;
  }
  for (const s of list) {
    const li = el("li", "chip");
    li.append(el("strong", "", s.course), el("span", "", ` Sec ${s.section}`));
    const x = el("button", "chip-x", "×");
    x.type = "button";
    x.title = "Remove";
    x.addEventListener("click", () => removeSection(s.id));
    li.appendChild(x);
    selectedListEl.appendChild(li);
  }
}

function refresh() {
  const list = selectedSections();
  const pairs = renderCalendar(calendarEl, list, { onRemove: removeSection });

  if (pairs.length) {
    warningEl.hidden = false;
    warningEl.textContent =
      "⚠ Time clash: " + pairs.map(([a, b]) => `${a.course} (Sec ${a.section}) and ${b.course} (Sec ${b.section})`).join("; ");
  } else {
    warningEl.hidden = true;
  }

  renderSelectedList();
  clearBtn.disabled = !list.length;
  printBtn.disabled = !list.length;
  runSearch();
}

// ---------- Events ----------
fileInput.addEventListener("change", async () => {
  const file = fileInput.files[0];
  if (!file) return;
  progressEl.hidden = false;
  progressEl.value = 0;
  setStatus(`Reading ${file.name}…`);
  try {
    allSections = await readRoutinePdf(file, (done, total) => {
      progressEl.max = total;
      progressEl.value = done;
      setStatus(`Reading page ${done} of ${total}…`);
    });
    if (!allSections.length) {
      setStatus("No courses found in this PDF. Is it the routine list?");
    } else {
      selectedIds = selectedIds.filter((id) => byId(id));
      saveSections();
      save();
      setStatus(`Done: ${allSections.length} sections found in ${file.name}.`);
    }
  } catch (err) {
    console.error(err);
    setStatus("Could not read that PDF. Open the app through a local server (see README note) and try again.");
  } finally {
    progressEl.hidden = true;
    fileInput.value = "";
    refresh();
  }
});

let timer;
searchInput.addEventListener("input", () => {
  clearTimeout(timer);
  timer = setTimeout(runSearch, 150);
});

clearBtn.addEventListener("click", () => {
  selectedIds = [];
  save();
  refresh();
});

printBtn.addEventListener("click", () => window.print());

// ---------- Start ----------
load();
refresh();
