// calendar.js
// Draws the weekly routine grid and detects time clashes.

export const DAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
export const PX_PER_MIN = 1; // 60px per hour
const COURSE_COLORS = ["course-0", "course-1", "course-2", "course-3", "course-4"];

export function fmtTime(min) {
  let h = Math.floor(min / 60);
  const m = min % 60;
  const ap = h >= 12 ? "PM" : "AM";
  h = h % 12 || 12;
  return `${h}:${String(m).padStart(2, "0")} ${ap}`;
}

/** True if two sections have meetings that overlap on the same day. */
export function sectionsConflict(a, b) {
  for (const ma of a.meetings) {
    for (const mb of b.meetings) {
      const shareDay = ma.days.some((d) => mb.days.includes(d));
      if (shareDay && ma.start < mb.end && mb.start < ma.end) return true;
    }
  }
  return false;
}

/** Select a color from the fixed palette by a course's position in the routine. */
export function courseColor(index) {
  return COURSE_COLORS[index % COURSE_COLORS.length];
}

function el(tag, className, text) {
  const e = document.createElement(tag);
  if (className) e.className = className;
  if (text !== undefined) e.textContent = text;
  return e;
}

/** Split overlapping events on one day into side-by-side lanes. */
function layoutDay(events) {
  events.sort((a, b) => a.start - b.start || a.end - b.end);
  let cluster = [];
  let clusterEnd = -1;
  const flush = () => {
    const laneEnds = [];
    for (const ev of cluster) {
      let lane = laneEnds.findIndex((end) => end <= ev.start);
      if (lane === -1) lane = laneEnds.length;
      laneEnds[lane] = ev.end;
      ev.lane = lane;
    }
    for (const ev of cluster) {
      ev.lanes = laneEnds.length;
      ev.clash = cluster.some((o) => o !== ev && o.start < ev.end && ev.start < o.end);
    }
    cluster = [];
  };
  for (const ev of events) {
    if (cluster.length && ev.start >= clusterEnd) flush();
    clusterEnd = cluster.length ? Math.max(clusterEnd, ev.end) : ev.end;
    cluster.push(ev);
  }
  if (cluster.length) flush();
}

/**
 * Render the weekly view into `root`.
 * sections: selected sections. opts.onRemove(sectionId) is called from the x button.
 */
export function renderCalendar(root, sections, opts = {}) {
  root.replaceChildren();

  const courseIndexes = new Map();
  for (const section of sections) {
    if (!courseIndexes.has(section.course)) courseIndexes.set(section.course, courseIndexes.size);
  }

  // Collect events per day
  const perDay = Array.from({ length: 7 }, () => []);
  for (const s of sections) {
    for (const m of s.meetings) {
      for (const d of m.days) {
        perDay[d].push({ section: s, meeting: m, start: m.start, end: m.end });
      }
    }
  }
  const all = perDay.flat();

  // Sun-Thu are always visible; Fri/Sat only appear when used
  const visibleDays = [0, 1, 2, 3, 4];
  if (perDay[5].length) visibleDays.push(5);
  if (perDay[6].length) visibleDays.push(6);

  const startHour = Math.min(8, all.length ? Math.floor(Math.min(...all.map((e) => e.start)) / 60) : 8);
  const endHour = Math.max(18, all.length ? Math.ceil(Math.max(...all.map((e) => e.end)) / 60) : 18);
  const totalPx = (endHour - startHour) * 60 * PX_PER_MIN;

  const cal = el("div", "cal");
  cal.style.setProperty("--cols", visibleDays.length);
  cal.style.setProperty("--grid-h", totalPx + "px");

  // Header row
  const head = el("div", "cal-head");
  head.appendChild(el("div", "cal-corner"));
  for (const d of visibleDays) head.appendChild(el("div", "cal-dayname", DAY_NAMES[d]));
  cal.appendChild(head);

  // Body
  const body = el("div", "cal-body");
  const timeCol = el("div", "time-col");
  for (let h = startHour; h <= endHour; h++) {
    const lab = el("div", "time-label", fmtTime(h * 60));
    lab.style.top = (h - startHour) * 60 * PX_PER_MIN + "px";
    timeCol.appendChild(lab);
  }
  body.appendChild(timeCol);

  for (const d of visibleDays) {
    const col = el("div", "day-col");
    const events = perDay[d];
    layoutDay(events);

    for (const ev of events) {
      const s = ev.section;
      const block = el("div", "event" + (ev.clash ? " clash" : ""));
      block.classList.add(courseColor(courseIndexes.get(s.course)));
      block.style.top = (ev.start - startHour * 60) * PX_PER_MIN + "px";
      block.style.height = (ev.end - ev.start) * PX_PER_MIN - 2 + "px";
      block.style.left = `calc(${(ev.lane / ev.lanes) * 100}% + 2px)`;
      block.style.width = `calc(${100 / ev.lanes}% - 4px)`;

      block.appendChild(el("div", "ev-title", s.course));
      block.appendChild(el("div", "ev-sub", `Sec ${s.section}`));
      block.appendChild(el("div", "ev-meta", `${fmtTime(ev.start)} – ${fmtTime(ev.end)}`));
      if (ev.meeting.room) block.appendChild(el("div", "ev-meta", ev.meeting.room));

      const rm = el("button", "ev-remove", "×");
      rm.type = "button";
      rm.title = `Remove ${s.course} (Sec ${s.section})`;
      rm.setAttribute("aria-label", rm.title);
      rm.addEventListener("click", () => opts.onRemove && opts.onRemove(s.id));
      block.appendChild(rm);

      col.appendChild(block);
    }
    body.appendChild(col);
  }
  cal.appendChild(body);
  root.appendChild(cal);

  // Return conflicting pairs so the page can warn about them
  const pairs = [];
  for (let i = 0; i < sections.length; i++) {
    for (let j = i + 1; j < sections.length; j++) {
      if (sectionsConflict(sections[i], sections[j])) pairs.push([sections[i], sections[j]]);
    }
  }
  return pairs;
}
