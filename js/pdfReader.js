// pdfReader.js
// Reads the course-list PDF and turns it into a list of course sections.
//
// The PDF is a table with these columns (left -> right):
//   Course | Section | Timing | Room No | Dedicated department | Capacity
// Each row is found by anchoring on the Section number, then every other
// text piece is assigned to the nearest row by vertical position and to a
// column by horizontal position.

export const DAY_LETTERS = { S: 0, M: 1, T: 2, W: 3, R: 4, F: 5, A: 6 };

// Horizontal column boundaries (PDF points, from the start of each text piece)
const COL = {
  courseMax: 108,
  sectionMax: 150,
  timingMax: 240,
  roomMax: 415,
  deptMax: 505,
};

const TIMING_RE =
  /^([A-Z]+)\s+(\d{1,2}):(\d{2})\s*([AP]M)\s*-\s*(\d{1,2}):(\d{2})\s*([AP]M)/i;

function toMinutes(h, m, ap) {
  let hour = parseInt(h, 10) % 12;
  if (ap.toUpperCase() === "PM") hour += 12;
  return hour * 60 + parseInt(m, 10);
}

function columnOf(x) {
  if (x < COL.courseMax) return "course";
  if (x < COL.sectionMax) return "section";
  if (x < COL.timingMax) return "timing";
  if (x < COL.roomMax) return "room";
  if (x < COL.deptMax) return "dept";
  return "capacity";
}

/**
 * Pure function: takes pdf.js text items of ONE page and returns rows.
 * Each row: { course, section, days:[0-6], start, end, room, dept, capacity }
 */
export function parsePageItems(items) {
  const pieces = items
    .map((it) => ({
      str: it.str.trim(),
      x: it.transform[4],
      y: it.transform[5],
    }))
    .filter((p) => p.str.length > 0)
    .map((p) => ({ ...p, col: columnOf(p.x) }));

  // Anchors = one section number per row (skips the "Section" header word)
  const anchors = pieces
    .filter((p) => p.col === "section" && /^[A-Za-z0-9]{1,4}$/.test(p.str))
    .sort((a, b) => b.y - a.y);

  if (!anchors.length) return [];

  const rows = anchors.map((a) => ({ anchor: a, cells: [] }));

  for (const p of pieces) {
    if (p.col === "section" && anchors.includes(p)) continue;
    let best = null;
    let bestDist = Infinity;
    for (const r of rows) {
      const d = Math.abs(r.anchor.y - p.y);
      if (d < bestDist) {
        bestDist = d;
        best = r;
      }
    }
    // Pieces far from any row (page headers, footers) are ignored
    if (best && bestDist <= 14) best.cells.push(p);
  }

  const out = [];
  for (const r of rows) {
    const byCol = (c) =>
      r.cells
        .filter((p) => p.col === c)
        .sort((a, b) => b.y - a.y || a.x - b.x) // top to bottom, left to right
        .map((p) => p.str);

    // Course codes can wrap onto two lines, e.g. "LAW0421-" + "101"
    let course = "";
    for (const part of byCol("course")) {
      course += course.endsWith("-") ? part : course ? " " + part : part;
    }
    course = course.replace(/\s+/g, " ").trim();

    const timingText = byCol("timing").join(" ");
    const m = timingText.match(TIMING_RE);
    if (!course || !m) continue; // header rows, TBA rows, etc.

    const days = [...m[1]]
      .map((ch) => DAY_LETTERS[ch])
      .filter((d) => d !== undefined);
    if (!days.length) continue;

    out.push({
      course,
      section: r.anchor.str,
      days,
      dayCode: m[1],
      start: toMinutes(m[2], m[3], m[4]),
      end: toMinutes(m[5], m[6], m[7]),
      room: byCol("room").join(" "),
      dept: byCol("dept").join(" "),
      capacity: byCol("capacity").join(" "),
    });
  }
  return out;
}

/**
 * Groups rows into sections. A section can meet in several rows
 * (e.g. ACT101 section 2 meets on Sunday in one room and Thursday in another).
 */
export function groupSections(rows) {
  const map = new Map();
  for (const r of rows) {
    const id = `${r.course}|${r.section}`;
    if (!map.has(id)) {
      map.set(id, {
        id,
        course: r.course,
        section: r.section,
        dept: r.dept,
        capacity: r.capacity,
        meetings: [],
      });
    }
    const s = map.get(id);
    if (!s.dept && r.dept) s.dept = r.dept;
    // Avoid duplicates if the PDF repeats a row
    const dup = s.meetings.some(
      (m) =>
        m.dayCode === r.dayCode &&
        m.start === r.start &&
        m.end === r.end &&
        m.room === r.room
    );
    if (!dup) {
      s.meetings.push({
        days: r.days,
        dayCode: r.dayCode,
        start: r.start,
        end: r.end,
        room: r.room,
      });
    }
  }
  return [...map.values()];
}

/**
 * Browser entry point: read a File object and return the list of sections.
 * onProgress(done, total) is called after each page.
 */
export async function readRoutinePdf(file, onProgress = () => {}) {
  const pdfjs = await import("../libs/pdf.min.mjs");
  pdfjs.GlobalWorkerOptions.workerSrc = new URL(
    "../libs/pdf.worker.min.mjs",
    import.meta.url
  ).href;

  const data = new Uint8Array(await file.arrayBuffer());
  const pdf = await pdfjs.getDocument({ data }).promise;

  const rows = [];
  for (let p = 1; p <= pdf.numPages; p++) {
    const page = await pdf.getPage(p);
    const content = await page.getTextContent();
    rows.push(...parsePageItems(content.items));
    page.cleanup();
    onProgress(p, pdf.numPages);
  }
  return groupSections(rows);
}
