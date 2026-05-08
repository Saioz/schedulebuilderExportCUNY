/**
 * CUNY Schedule Builder → .ics Calendar Exporter
 * content.js — Targets the actual CUNY VSB (Visual Schedule Builder) DOM structure.
 *
 * The VSB renders class details inside #legend_box > .course_box elements.
 * Each .course_box contains:
 *   - .course_header[aria-label]  → rich text: "CSCI 271 Introduction%20to%20... running from Jul 13  to  Aug 13 on Tue, Wed, Thu from 1:15 PM to 3:55 PM"
 *   - .course_title               → course code e.g. "CSCI 271"
 *   - #hoursInLegend              → "Tue, Wed, Thu : 1:15 PM to 3:55 PM"
 *   - .type_block                 → "LEC 501"
 *   - .crn_value                  → "8322"
 *   - .campus_block               → "John Jay College"
 *   - .instructional_method_block → "In Person"
 *   - .location_block             → "New Building Rm L2.79"
 *   - div[title="Instructor(s)"]  → "Shaobai Kan"
 */

// Inject the floating button once
if (!document.getElementById('cuny-ics-export-btn')) {
  injectExportButton();
}

// Listen for messages from popup.js
chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message.action === 'exportCalendar') {
    const result = exportSchedule();
    sendResponse(result);
  }
  return true;
});

// ──────────────────────────────────────────────────────────────────────────
// BUTTON INJECTION
// ──────────────────────────────────────────────────────────────────────────

function injectExportButton() {
  const btn = document.createElement('button');
  btn.id = 'cuny-ics-export-btn';
  btn.textContent = '📅 Export to Calendar';
  btn.title = 'Download your CUNY schedule as a .ics file';

  Object.assign(btn.style, {
    position:      'fixed',
    bottom:        '24px',
    right:         '24px',
    zIndex:        '999999',
    padding:       '12px 20px',
    background:    '#003366',
    color:         '#ffffff',
    border:        'none',
    borderRadius:  '8px',
    fontSize:      '14px',
    fontWeight:    '600',
    fontFamily:    'system-ui, sans-serif',
    cursor:        'pointer',
    boxShadow:     '0 4px 16px rgba(0,0,0,0.25)',
    transition:    'transform 0.15s, box-shadow 0.15s',
    letterSpacing: '0.3px',
  });

  btn.addEventListener('mouseenter', () => {
    btn.style.transform = 'translateY(-2px)';
    btn.style.boxShadow = '0 6px 20px rgba(0,0,0,0.3)';
  });
  btn.addEventListener('mouseleave', () => {
    btn.style.transform = '';
    btn.style.boxShadow = '0 4px 16px rgba(0,0,0,0.25)';
  });

  btn.addEventListener('click', () => {
    const result = exportSchedule();
    if (!result.success) {
      alert('⚠️ ' + result.message);
    }
  });

  document.body.appendChild(btn);
}

// ──────────────────────────────────────────────────────────────────────────
// MAIN EXPORT
// ──────────────────────────────────────────────────────────────────────────

function exportSchedule() {
  try {
    const courses = scrapeScheduleData();
    if (!courses || courses.length === 0) {
      return {
        success: false,
        message: 'No class schedule data found. Make sure your schedule results are visible and "Class Details" is toggled on in the results panel.'
      };
    }
    const icsContent = generateICS(courses);
    downloadICS(icsContent, 'schedule.ics');
    return { success: true, count: courses.length };
  } catch (err) {
    console.error('[CUNY ICS Exporter] Error:', err);
    return { success: false, message: 'Export failed: ' + err.message };
  }
}

// ──────────────────────────────────────────────────────────────────────────
// PRIMARY SCRAPER
// Reads the #legend_box which holds expanded class detail cards.
// ──────────────────────────────────────────────────────────────────────────

function scrapeScheduleData() {
  const courses = [];

  // Strategy 1: .course_box cards inside the legend
  const courseBoxes = document.querySelectorAll(
    '#legend_box .course_box, .legend_box .course_box'
  );
  console.log('[CUNY ICS] Found ' + courseBoxes.length + ' course_box elements');

  for (const box of courseBoxes) {
    const course = parseCourseBox(box);
    if (course) {
      console.log('[CUNY ICS] Parsed course:', course.courseCode, course.rawDays, course.startTime, course.startDate);
      courses.push(course);
    }
  }

  // Strategy 2: standalone h4 aria-labels (if legend_box not found)
  if (courses.length === 0) {
    const headers = document.querySelectorAll('h4[aria-label*="running from"], .course_header[aria-label*="running from"]');
    console.log('[CUNY ICS] Fallback aria-label scan: ' + headers.length + ' headers');
    for (const header of headers) {
      const course = parseCourseFromAriaLabel(
        header.getAttribute('aria-label'),
        header.closest('.course_box')
      );
      if (course) courses.push(course);
    }
  }

  // Strategy 3: timetable visual blocks
  if (courses.length === 0) {
    const timetableCourses = scrapeFromTimetable();
    courses.push(...timetableCourses);
  }

  return courses;
}

// ──────────────────────────────────────────────────────────────────────────
// PARSE A SINGLE .course_box
// ──────────────────────────────────────────────────────────────────────────

function parseCourseBox(box) {
  try {
    // 1. Course code from .course_title (e.g. "CSCI 271")
    const courseCode = getText(box, '.course_title');
    if (!courseCode) return null;

    // 2. Meeting days & times from #hoursInLegend
    //    Format: "Tue, Wed, Thu : 1:15 PM to 3:55 PM"
    const hoursEl = box.querySelector('#hoursInLegend, [id^="hoursInLegend"]');
    let rawDays = '', startTime = '', endTime = '';

    if (hoursEl) {
      const hoursText = hoursEl.textContent.trim();
      const colonIdx = hoursText.indexOf(':');
      if (colonIdx > -1) {
        rawDays = hoursText.substring(0, colonIdx).trim();
        const timePart = hoursText.substring(colonIdx + 1).trim();
        const timeMatch = timePart.match(
          /(\d{1,2}:\d{2}\s*(?:AM|PM))\s*(?:to|-)\s*(\d{1,2}:\d{2}\s*(?:AM|PM))/i
        );
        if (timeMatch) {
          startTime = timeMatch[1].trim();
          endTime   = timeMatch[2].trim();
        }
      }
    }

    // 3. Fallback: pull days/times from the h4 aria-label (which has full schedule info)
    if (!rawDays || !startTime) {
      const ariaEl = box.querySelector('h4[aria-label], .course_header[aria-label], .course_header h4[aria-label]');
      if (ariaEl) {
        const parsed = extractDaysTimesFromAriaLabel(ariaEl.getAttribute('aria-label'));
        if (!rawDays && parsed.rawDays)     rawDays   = parsed.rawDays;
        if (!startTime && parsed.startTime) startTime = parsed.startTime;
        if (!endTime && parsed.endTime)     endTime   = parsed.endTime;
      }
    }

    if (!rawDays || !startTime || !endTime) return null;

    // 4. Date range
    //    The header_cell has text like "Jul 13 - Aug 13" inside a float:right div
    let startDate = '', endDate = '';
    const headerCell = box.querySelector('.header_cell');
    if (headerCell) {
      const headerText = headerCell.textContent;
      // Match "Jul 13 - Aug 13" or "Jul 13 – Aug 13"
      const dateRangeMatch = headerText.match(
        /((?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s+\d{1,2})\s*[-–]\s*((?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s+\d{1,2})/i
      );
      if (dateRangeMatch) {
        // Grab year from the same area
        const yearMatch = headerText.match(/20\d{2}/);
        const year = yearMatch ? yearMatch[0] : new Date().getFullYear().toString();
        startDate = dateRangeMatch[1].trim() + ', ' + year;
        endDate   = dateRangeMatch[2].trim() + ', ' + year;
      }
    }

    // Fallback: get dates from h4 aria-label
    if (!startDate) {
      const ariaEl = box.querySelector('h4[aria-label], .course_header h4[aria-label]');
      if (ariaEl) {
        const parsed = extractDatesFromAriaLabel(ariaEl.getAttribute('aria-label'));
        startDate = parsed.startDate;
        endDate   = parsed.endDate;
      }
    }

    if (!startDate || !endDate) return null;

    // 5. Course title: the span inside header_cell that holds the full name
    //    It's the span/div AFTER the h4 (course_title), NOT the date div
    let courseTitle = '';
    if (headerCell) {
      // Walk divs in header_cell; find the one with the long name
      const divs = headerCell.querySelectorAll('div');
      for (const d of divs) {
        // Skip divs that are purely the code (h4), date, or session
        const directText = Array.from(d.childNodes)
          .filter(n => n.nodeType === Node.TEXT_NODE)
          .map(n => n.textContent.trim())
          .join(' ').trim();

        // Also check spans inside
        const spanText = Array.from(d.querySelectorAll('span:not(.mobileNUmber)'))
          .map(s => s.textContent.trim())
          .join(' ').trim();

        const candidate = spanText || directText;
        if (
          candidate.length > 10 &&
          !/^\d|^Jul|^Aug|^Jan|^Feb|^Mar|^Apr|^May|^Jun|^Sep|^Oct|^Nov|^Dec/i.test(candidate) &&
          !/Summer|Spring|Fall|Winter|Five Week|Eight Week|Three Week|Session/i.test(candidate) &&
          !/^\s*$/.test(candidate)
        ) {
          courseTitle = candidate;
          break;
        }
      }
    }

    // 6. Other fields
    const section     = getText(box, '.type_block');
    const classNumber = getText(box, '.crn_value');
    const college     = getText(box, '.campus_block');
    const instrMode   = getText(box, '.instructional_method_block');

    const locationEl  = box.querySelector('.location_block');
    const location    = locationEl ? locationEl.textContent.replace(/\s+/g,' ').trim() : '';

    const instructorEl = box.querySelector('[title="Instructor(s)"]');
    const instructor   = instructorEl ? instructorEl.textContent.trim() : '';

    const sessionEl   = box.querySelector('.session_label');
    const session     = sessionEl ? sessionEl.textContent.trim() : '';

    return {
      courseCode,
      courseTitle,
      section,
      classNumber,
      rawDays,
      startTime,
      endTime,
      startDate,
      endDate,
      location,
      instructor,
      college,
      instrMode,
      session,
    };

  } catch (err) {
    console.warn('[CUNY ICS] Error parsing course_box:', err);
    return null;
  }
}

function getText(parent, selector) {
  const el = parent.querySelector(selector);
  return el ? el.textContent.trim() : '';
}

// ──────────────────────────────────────────────────────────────────────────
// ARIA-LABEL PARSER
// aria-label format:
// "CSCI 271 Introduction%20to%20Computing running from Jul 13  to  Aug 13
//  on Tue, Wed, Thu from 1:15 PM to 3:55 PM. Given this timetable..."
// ──────────────────────────────────────────────────────────────────────────

function parseCourseFromAriaLabel(ariaLabel, box) {
  if (!ariaLabel) return null;
  const text = decodeURIComponent(ariaLabel);

  const codeMatch = text.match(/^([A-Z]{2,5}\s+\d{1,4}[A-Z]?)/);
  if (!codeMatch) return null;

  const courseCode    = codeMatch[1];
  const datesInfo     = extractDatesFromAriaLabel(text);
  const timesInfo     = extractDaysTimesFromAriaLabel(text);

  if (!timesInfo.rawDays || !timesInfo.startTime || !datesInfo.startDate) return null;

  return {
    courseCode,
    courseTitle: extractTitleFromAriaLabel(text, courseCode),
    section:     box ? getText(box, '.type_block') : '',
    classNumber: box ? getText(box, '.crn_value')  : '',
    rawDays:     timesInfo.rawDays,
    startTime:   timesInfo.startTime,
    endTime:     timesInfo.endTime,
    startDate:   datesInfo.startDate,
    endDate:     datesInfo.endDate,
    location:    box ? (box.querySelector('.location_block') || {textContent:''}).textContent.trim() : '',
    instructor:  box ? getText(box, '[title="Instructor(s)"]') : '',
    college:     box ? getText(box, '.campus_block') : '',
    instrMode:   box ? getText(box, '.instructional_method_block') : '',
    session:     '',
  };
}

function extractTitleFromAriaLabel(text, courseCode) {
  const after = text.slice(courseCode.length).trim();
  const idx = after.toLowerCase().indexOf('running from');
  return idx > -1 ? after.slice(0, idx).trim() : '';
}

function extractDatesFromAriaLabel(text) {
  const m = text.match(
    /running from\s+((?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s+\d{1,2})\s+to\s+((?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s+\d{1,2})/i
  );
  if (!m) return { startDate: '', endDate: '' };
  const yearMatch = text.match(/20\d{2}/);
  const year = yearMatch ? yearMatch[0] : new Date().getFullYear().toString();
  return { startDate: m[1] + ', ' + year, endDate: m[2] + ', ' + year };
}

function extractDaysTimesFromAriaLabel(text) {
  // "on Tue, Wed, Thu from 1:15 PM to 3:55 PM"
  const m = text.match(
    /on\s+([\w,\s]+?)\s+from\s+(\d{1,2}:\d{2}\s*(?:AM|PM))\s+to\s+(\d{1,2}:\d{2}\s*(?:AM|PM))/i
  );
  if (!m) return { rawDays: '', startTime: '', endTime: '' };
  return { rawDays: m[1].trim(), startTime: m[2].trim(), endTime: m[3].trim() };
}

// ──────────────────────────────────────────────────────────────────────────
// TIMETABLE FALLBACK — reads visual .time_block elements
// ──────────────────────────────────────────────────────────────────────────

function scrapeFromTimetable() {
  const courses = [];
  const leftToDay = { 0:'MO', 20:'TU', 40:'WE', 60:'TH', 80:'FR' };
  const grouped = {};

  const blocks = document.querySelectorAll('.time_block[style]');
  for (const block of blocks) {
    const inner = block.querySelector('.nonmobile');
    if (!inner) continue;
    const lines = inner.textContent.split(/\n|\r/).map(l => l.trim()).filter(Boolean);
    if (lines.length < 2) continue;

    const codeMatch = lines[0].match(/([A-Z]{2,5}\s+\d{1,4}[A-Z]?)/);
    if (!codeMatch) continue;

    const courseCode = codeMatch[1];
    const section    = lines[1] || '';
    const location   = lines[2] || '';
    const dateSpan   = block.querySelector('.tt_dates');
    const dateRange  = dateSpan ? dateSpan.textContent.trim() : '';

    const leftMatch = (block.style.left || '').match(/(\d+)/);
    const leftPct   = leftMatch ? Math.round(Number(leftMatch[1])) : -1;
    const day       = leftToDay[leftPct] || null;

    const key = courseCode + '|' + section;
    if (!grouped[key]) {
      // Infer year from page
      const yearMatch = document.body.textContent.match(/20\d{2}/);
      const year = yearMatch ? yearMatch[0] : new Date().getFullYear().toString();
      const dateM = dateRange.match(
        /((?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s+\d{1,2})\s*[-–]\s*((?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s+\d{1,2})/i
      );
      grouped[key] = {
        courseCode, courseTitle: '', section, classNumber: '',
        days: day ? [day] : [],
        startTime: '', endTime: '',
        startDate: dateM ? dateM[1] + ', ' + year : '',
        endDate:   dateM ? dateM[2] + ', ' + year : '',
        location, instructor: '', college: '', instrMode: '', session: '',
      };
    } else if (day && !grouped[key].days.includes(day)) {
      grouped[key].days.push(day);
    }

    // Try to get times from aria-label on course_header if not yet set
    if (!grouped[key].startTime) {
      const ariaEl = document.querySelector('.course_header[aria-label]');
      if (ariaEl) {
        const t = extractDaysTimesFromAriaLabel(ariaEl.getAttribute('aria-label'));
        grouped[key].startTime = t.startTime;
        grouped[key].endTime   = t.endTime;
      }
    }
  }

  for (const c of Object.values(grouped)) {
    if (!c.days.length || !c.startDate || !c.startTime) continue;
    c.rawDays = c.days.join(',');
    courses.push(c);
  }
  return courses;
}

// ──────────────────────────────────────────────────────────────────────────
// DAYS → RRULE BYDAY
// ──────────────────────────────────────────────────────────────────────────

const DAY_MAP = {
  monday:'MO', tuesday:'TU', wednesday:'WE', thursday:'TH',
  friday:'FR', saturday:'SA', sunday:'SU',
  mon:'MO', tue:'TU', tues:'TU', wed:'WE', weds:'WE',
  thu:'TH', thur:'TH', thurs:'TH', fri:'FR', sat:'SA', sun:'SU',
  mo:'MO', tu:'TU', we:'WE', th:'TH', fr:'FR', sa:'SA', su:'SU',
};

const JS_DAY_TO_ICAL = ['SU','MO','TU','WE','TH','FR','SA'];

function parseDaysToRRULE(rawDays) {
  if (!rawDays) return '';
  const tokens = [];

  const words = rawDays.split(/[\s,/&+]+|(?:\band\b)/i)
    .map(w => w.trim().toLowerCase()).filter(Boolean);

  for (const w of words) {
    const ic = DAY_MAP[w];
    if (ic && !tokens.includes(ic)) tokens.push(ic);
  }

  // Already iCal tokens?
  if (tokens.length === 0) {
    for (const t of rawDays.split(',').map(t => t.trim().toUpperCase())) {
      if (['MO','TU','WE','TH','FR','SA','SU'].includes(t) && !tokens.includes(t)) tokens.push(t);
    }
  }

  // Compressed: TuWeTh
  if (tokens.length === 0) {
    const re = /Mo|Tu|We|Th|Fr|Sa|Su/gi;
    let m;
    while ((m = re.exec(rawDays.replace(/\s/g,''))) !== null) {
      const ic = DAY_MAP[m[0].toLowerCase()];
      if (ic && !tokens.includes(ic)) tokens.push(ic);
    }
  }

  return tokens.join(',');
}

// ──────────────────────────────────────────────────────────────────────────
// DATE / TIME HELPERS
// ──────────────────────────────────────────────────────────────────────────

function parseDate(raw) {
  if (!raw) return null;
  raw = raw.trim();
  const d = new Date(raw);
  if (!isNaN(d)) return d;
  const slash = raw.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (slash) return new Date(Number(slash[3]), Number(slash[1])-1, Number(slash[2]));
  return null;
}

function findFirstMeetingDay(startDate, byDayTokens) {
  if (!startDate || !byDayTokens) return startDate;
  const targets = byDayTokens.split(',');
  const d = new Date(startDate);
  d.setHours(0,0,0,0);
  for (let i = 0; i < 7; i++) {
    if (targets.includes(JS_DAY_TO_ICAL[d.getDay()])) return d;
    d.setDate(d.getDate() + 1);
  }
  return startDate;
}

function parseTime(raw) {
  if (!raw) return null;
  const m = raw.trim().match(/^(\d{1,2}):(\d{2})\s*(AM|PM)$/i);
  if (!m) return null;
  let h = Number(m[1]);
  const mi = Number(m[2]);
  const mer = m[3].toUpperCase();
  if (mer === 'AM' && h === 12) h = 0;
  if (mer === 'PM' && h !== 12) h += 12;
  return { hours: h, minutes: mi };
}

function formatICalDateTime(date, time) {
  if (!date || !time) return null;
  const pad = n => String(n).padStart(2,'0');
  return '' + date.getFullYear() + pad(date.getMonth()+1) + pad(date.getDate()) +
         'T' + pad(time.hours) + pad(time.minutes) + '00';
}

function formatICalDate(date) {
  if (!date) return '';
  const pad = n => String(n).padStart(2,'0');
  return '' + date.getFullYear() + pad(date.getMonth()+1) + pad(date.getDate());
}

// ──────────────────────────────────────────────────────────────────────────
// ICS FORMATTING
// ──────────────────────────────────────────────────────────────────────────

function escapeICS(str) {
  if (!str) return '';
  return String(str)
    .replace(/\\/g,'\\\\').replace(/;/g,'\\;').replace(/,/g,'\\,')
    .replace(/\n/g,'\\n').replace(/\r/g,'');
}

function foldLine(line) {
  if (line.length <= 75) return line;
  const parts = [];
  let rem = line;
  while (rem.length > 75) { parts.push(rem.slice(0,75)); rem = ' ' + rem.slice(75); }
  parts.push(rem);
  return parts.join('\r\n');
}

function generateUID(course) {
  return (course.courseCode.replace(/\s/g,'-') + '-' + (course.classNumber || Date.now()) + '@cuny-vsb');
}

// ──────────────────────────────────────────────────────────────────────────
// ICS GENERATION
// ──────────────────────────────────────────────────────────────────────────

function generateICS(courses) {
  const now = new Date();
  const dtstamp = formatICalDateTime(now, { hours: now.getUTCHours(), minutes: now.getUTCMinutes() });
  const vevents = courses.map(c => buildVEVENT(c, dtstamp)).filter(Boolean);
  if (vevents.length === 0) throw new Error('Could not build any calendar events from the extracted data.');

  return [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//CUNY Schedule Builder Export//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    'X-WR-CALNAME:CUNY Schedule',
    'X-WR-TIMEZONE:America/New_York',
    buildVTIMEZONE(),
    ...vevents,
    'END:VCALENDAR',
  ].join('\r\n');
}

function buildVEVENT(course, dtstamp) {
  const byDay     = parseDaysToRRULE(course.rawDays);
  const startTime = parseTime(course.startTime);
  const endTime   = parseTime(course.endTime);
  const rawStart  = parseDate(course.startDate);
  const rawEnd    = parseDate(course.endDate);

  if (!byDay || !startTime || !endTime || !rawStart || !rawEnd) {
    console.warn('[CUNY ICS] Skipping course — incomplete data:', course);
    return null;
  }

  const firstMeeting = findFirstMeetingDay(rawStart, byDay);
  const dtstart = formatICalDateTime(firstMeeting, startTime);
  const dtend   = formatICalDateTime(firstMeeting, endTime);
  const until   = formatICalDate(rawEnd) + 'T235959Z';
  const summary = [course.courseCode, course.courseTitle].filter(Boolean).join(' - ');

  // Build description to match the reference .ics format
  const descLines = [];
  if (course.college)     descLines.push(escapeICS(course.college));
  if (course.classNumber) descLines.push('Class Number: ' + course.classNumber);
  if (course.section)     descLines.push('Section: ' + course.section);
  if (course.instructor)  descLines.push('Instructor: ' + escapeICS(course.instructor));
  if (course.instrMode)   descLines.push('Instruction Mode: ' + escapeICS(course.instrMode));
  if (course.session)     descLines.push('Term: 2026 Summer Term\\, ' + escapeICS(course.session));
  if (rawStart && rawEnd) {
    const fmt = d => d.toLocaleDateString('en-US', { month:'short', day:'numeric' });
    descLines.push('Dates: ' + fmt(rawStart) + ' - ' + fmt(rawEnd));
  }
  if (course.rawDays && course.startTime && course.endTime) {
    descLines.push('Meets: ' + course.rawDays + '\\, ' + course.startTime + ' to ' + course.endTime);
  }

  const lines = [
    'BEGIN:VEVENT',
    'UID:' + generateUID(course),
    'DTSTAMP:' + dtstamp + 'Z',
    'DTSTART;TZID=America/New_York:' + dtstart,
    'DTEND;TZID=America/New_York:' + dtend,
    'RRULE:FREQ=WEEKLY;UNTIL=' + until + ';BYDAY=' + byDay,
    'SUMMARY:' + escapeICS(summary),
    'LOCATION:' + escapeICS(course.location),
    'DESCRIPTION:' + descLines.join('\\n'),
    'END:VEVENT',
  ];

  return lines.map(foldLine).join('\r\n');
}

function buildVTIMEZONE() {
  return [
    'BEGIN:VTIMEZONE',
    'TZID:America/New_York',
    'BEGIN:DAYLIGHT',
    'TZOFFSETFROM:-0500',
    'TZOFFSETTO:-0400',
    'TZNAME:EDT',
    'DTSTART:19700308T020000',
    'RRULE:FREQ=YEARLY;BYDAY=2SU;BYMONTH=3',
    'END:DAYLIGHT',
    'BEGIN:STANDARD',
    'TZOFFSETFROM:-0400',
    'TZOFFSETTO:-0500',
    'TZNAME:EST',
    'DTSTART:19701101T020000',
    'RRULE:FREQ=YEARLY;BYDAY=1SU;BYMONTH=11',
    'END:STANDARD',
    'END:VTIMEZONE',
  ].join('\r\n');
}

// ──────────────────────────────────────────────────────────────────────────
// DOWNLOAD
// ──────────────────────────────────────────────────────────────────────────

function downloadICS(content, filename) {
  const blob = new Blob([content], { type: 'text/calendar;charset=utf-8' });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href = url; a.download = filename; a.style.display = 'none';
  document.body.appendChild(a);
  a.click();
  setTimeout(() => { document.body.removeChild(a); URL.revokeObjectURL(url); }, 1000);
}
