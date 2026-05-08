/**
 * CUNY Schedule Builder → .ics Calendar Exporter
 * FIXED: Date parsing and time travel issues
 */

// Inject the floating button once
if (!document.getElementById('cuny-ics-export-btn')) {
  injectExportButton();
}

// Listen for messages from popup.js with better async handling
chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message.action === 'exportCalendar') {
    (async () => {
      try {
        const result = await exportSchedule();
        sendResponse(result);
      } catch (error) {
        console.error('[CUNY ICS] Export error:', error);
        sendResponse({ success: false, message: error.message });
      }
    })();
    return true;
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

  btn.addEventListener('click', async () => {
    const result = await exportSchedule();
    if (!result.success) {
      alert('⚠️ ' + result.message);
    }
  });

  document.body.appendChild(btn);
}

// ──────────────────────────────────────────────────────────────────────────
// MAIN EXPORT
// ──────────────────────────────────────────────────────────────────────────

async function exportSchedule() {
  try {
    await new Promise(resolve => setTimeout(resolve, 500));
    
    const courses = await scrapeScheduleData();
    if (!courses || courses.length === 0) {
      return {
        success: false,
        message: 'No class schedule data found. Make sure your schedule results are visible and "Class Details" is toggled on in the results panel.'
      };
    }
    
    const icsContent = generateICS(courses);
    downloadICS(icsContent, 'cuny_schedule.ics');
    return { success: true, count: courses.length };
  } catch (err) {
    console.error('[CUNY ICS Exporter] Error:', err);
    return { success: false, message: 'Export failed: ' + err.message };
  }
}

// ──────────────────────────────────────────────────────────────────────────
// SCRAPER
// ──────────────────────────────────────────────────────────────────────────

async function scrapeScheduleData() {
  const courses = [];

  const courseBoxes = document.querySelectorAll(
    '#legend_box .course_box, .legend_box .course_box'
  );
  console.log('[CUNY ICS] Found ' + courseBoxes.length + ' course_box elements');

  for (const box of courseBoxes) {
    const course = await parseCourseBox(box);
    if (course) {
      console.log('[CUNY ICS] Parsed course:', course.courseCode, course.startDate, course.endDate);
      courses.push(course);
    }
  }

  if (courses.length === 0) {
    const headers = document.querySelectorAll('h4[aria-label*="running from"], .course_header[aria-label*="running from"]');
    for (const header of headers) {
      const course = await parseCourseFromAriaLabel(
        header.getAttribute('aria-label'),
        header.closest('.course_box')
      );
      if (course) courses.push(course);
    }
  }

  if (courses.length === 0) {
    const timetableCourses = await scrapeFromTimetable();
    courses.push(...timetableCourses);
  }

  return courses;
}

// ──────────────────────────────────────────────────────────────────────────
// FIXED: PROPER DATE PARSING - NO TIME TRAVEL!
// ──────────────────────────────────────────────────────────────────────────

// Get the CURRENT academic year based on the actual term
function getAcademicYearFromTerm(termText) {
  const currentYear = new Date().getFullYear();
  const currentMonth = new Date().getMonth();
  
  // Determine which academic year we're in
  // Academic year runs from Fall (Aug) to Summer (Jul)
  
  if (termText) {
    const termLower = termText.toLowerCase();
    
    // Spring term (Jan-May) belongs to the NEXT calendar year
    // Example: Spring 2025 classes start Jan 2025
    if (termLower.includes('spring')) {
      // Look for year in term text first
      const yearMatch = termText.match(/20\d{2}/);
      if (yearMatch) return parseInt(yearMatch[0]);
      
      // Otherwise, if it's after August, Spring is next year
      if (currentMonth >= 7) return currentYear + 1;
      return currentYear;
    }
    
    // Fall term (Aug-Dec) belongs to the CURRENT calendar year
    if (termLower.includes('fall')) {
      const yearMatch = termText.match(/20\d{2}/);
      if (yearMatch) return parseInt(yearMatch[0]);
      return currentYear;
    }
    
    // Summer term (May-Aug) belongs to current year
    if (termLower.includes('summer')) {
      const yearMatch = termText.match(/20\d{2}/);
      if (yearMatch) return parseInt(yearMatch[0]);
      return currentYear;
    }
  }
  
  // Default based on current month
  if (currentMonth >= 7) { // August or later - Fall term
    return currentYear;
  } else { // January to July - Spring term
    return currentYear;
  }
}

// Parse date with the CORRECT year
function parseDateWithYear(monthDay, termContext) {
  if (!monthDay) return null;
  
  // Get the year from the term context
  let year = getAcademicYearFromTerm(termContext);
  
  // Parse month and day
  const date = new Date(monthDay + ', ' + year);
  
  // Validate the date - if it's way off, adjust
  const now = new Date();
  const yearDiff = Math.abs(date.getFullYear() - now.getFullYear());
  
  if (yearDiff > 2) {
    // Something went wrong - use current year as base
    const fixedYear = now.getFullYear();
    const fixedDate = new Date(monthDay + ', ' + fixedYear);
    
    // If the date is in the past but we're in Fall looking at Spring, add a year
    if (fixedDate < now && now.getMonth() >= 7 && monthDay.toLowerCase().includes('jan')) {
      fixedDate.setFullYear(fixedYear + 1);
    }
    
    return fixedDate;
  }
  
  return date;
}

// Extract term from page context
function getCurrentTerm() {
  // Look for term information in the page
  const termElements = document.querySelectorAll('.term_label, .session_label, .term_name');
  for (const el of termElements) {
    const text = el.textContent;
    if (text.match(/Spring|Summer|Fall|Winter/i)) {
      return text.trim();
    }
  }
  
  // Check URL for term info
  const url = window.location.href;
  if (url.includes('spring')) return 'Spring';
  if (url.includes('summer')) return 'Summer';
  if (url.includes('fall')) return 'Fall';
  
  // Default based on current month
  const month = new Date().getMonth();
  if (month >= 0 && month <= 4) return 'Spring';
  if (month >= 5 && month <= 7) return 'Summer';
  return 'Fall';
}

// ──────────────────────────────────────────────────────────────────────────
// PARSE COURSE BOX - FIXED DATE EXTRACTION
// ──────────────────────────────────────────────────────────────────────────

async function parseCourseBox(box) {
  try {
    const courseCode = getText(box, '.course_title');
    if (!courseCode) return null;

    // Get term context
    const termText = getText(box, '.session_label') || getCurrentTerm();
    
    // Check if online class
    const instructionalMethod = getText(box, '.instructional_method_block');
    const isOnline = instructionalMethod.toLowerCase().includes('online') || 
                     instructionalMethod.toLowerCase().includes('asynchronous') ||
                     instructionalMethod.toLowerCase().includes('synchronous');
    
    let rawDays = '', startTime = '', endTime = '';
    
    // Extract meeting times
    const hoursEl = box.querySelector('#hoursInLegend, [id^="hoursInLegend"]');
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

    // Fallback to aria-label
    if (!rawDays || !startTime) {
      const ariaEl = box.querySelector('h4[aria-label], .course_header[aria-label]');
      if (ariaEl) {
        const parsed = extractDaysTimesFromAriaLabel(ariaEl.getAttribute('aria-label'));
        rawDays = parsed.rawDays || rawDays;
        startTime = parsed.startTime || startTime;
        endTime = parsed.endTime || endTime;
      }
    }

    // For online async classes, skip
    if (isOnline && (!rawDays || !startTime)) {
      console.log('[CUNY ICS] Skipping online async class:', courseCode);
      return null;
    }

    // FIXED: Extract dates with proper year handling
    let startDate = null, endDate = null;
    const headerCell = box.querySelector('.header_cell');
    
    if (headerCell) {
      const headerText = headerCell.textContent;
      // Match "Jul 13 - Aug 13" or "Jul 13 – Aug 13"
      const dateRangeMatch = headerText.match(
        /((?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s+\d{1,2})\s*[-–]\s*((?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s+\d{1,2})/i
      );
      
      if (dateRangeMatch) {
        startDate = parseDateWithYear(dateRangeMatch[1].trim(), termText);
        endDate = parseDateWithYear(dateRangeMatch[2].trim(), termText);
        
        // Handle year rollover (e.g., Dec 2024 to Jan 2025)
        if (startDate && endDate && endDate < startDate) {
          endDate.setFullYear(startDate.getFullYear() + 1);
        }
      }
    }

    // Fallback to aria-label dates
    if (!startDate || !endDate) {
      const ariaEl = box.querySelector('h4[aria-label], .course_header[aria-label]');
      if (ariaEl) {
        const parsed = extractDatesFromAriaLabelProper(ariaEl.getAttribute('aria-label'), termText);
        startDate = parsed.startDate;
        endDate = parsed.endDate;
      }
    }

    // Last resort fallback - use reasonable defaults
    if (!startDate || !endDate) {
      const defaultDates = getDefaultDatesForTerm(termText);
      startDate = defaultDates.start;
      endDate = defaultDates.end;
    }

    // Validate dates aren't time-traveling
    const now = new Date();
    if (Math.abs(startDate.getFullYear() - now.getFullYear()) > 2) {
      console.warn('[CUNY ICS] Suspicious year detected, fixing:', startDate);
      // Re-parse with current year context
      const fixedYear = now.getFullYear();
      startDate.setFullYear(fixedYear);
      endDate.setFullYear(fixedYear);
      if (endDate < startDate) endDate.setFullYear(fixedYear + 1);
    }

    // Extract location
    let location = getText(box, '.location_block');
    if (isOnline && (!location || location === '')) {
      location = 'Online - ' + instructionalMethod;
    }

    return {
      courseCode,
      courseTitle: extractCourseTitle(box),
      section: getText(box, '.type_block'),
      classNumber: getText(box, '.crn_value'),
      rawDays: rawDays || 'TBA',
      startTime: startTime || '12:00 AM',
      endTime: endTime || '1:00 AM',
      startDate: startDate,
      endDate: endDate,
      location: location || 'TBD',
      instructor: getText(box, '[title="Instructor(s)"]'),
      college: getText(box, '.campus_block'),
      instrMode: instructionalMethod,
      session: termText,
      isOnline: isOnline,
    };

  } catch (err) {
    console.warn('[CUNY ICS] Error parsing course_box:', err);
    return null;
  }
}

// Helper: Extract dates from aria-label without year jumping
function extractDatesFromAriaLabelProper(ariaLabel, termText) {
  if (!ariaLabel) return { startDate: null, endDate: null };
  
  const text = decodeURIComponent(ariaLabel);
  const match = text.match(
    /running from\s+((?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s+\d{1,2})\s+to\s+((?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s+\d{1,2})/i
  );
  
  if (!match) return { startDate: null, endDate: null };
  
  const startDate = parseDateWithYear(match[1].trim(), termText);
  let endDate = parseDateWithYear(match[2].trim(), termText);
  
  // Handle year wrap (Dec to Jan)
  if (startDate && endDate && endDate < startDate) {
    endDate.setFullYear(startDate.getFullYear() + 1);
  }
  
  return { startDate, endDate };
}

// Get default dates for a term (reasonable defaults)
function getDefaultDatesForTerm(termText) {
  const year = getAcademicYearFromTerm(termText);
  const term = termText.toLowerCase();
  
  if (term.includes('spring')) {
    return {
      start: new Date(year, 0, 15),  // Jan 15
      end: new Date(year, 4, 15)     // May 15
    };
  } else if (term.includes('summer')) {
    return {
      start: new Date(year, 5, 1),   // Jun 1
      end: new Date(year, 7, 15)     // Aug 15
    };
  } else if (term.includes('fall')) {
    return {
      start: new Date(year, 7, 25),  // Aug 25
      end: new Date(year, 11, 20)    // Dec 20
    };
  }
  
  // Default fallback
  return {
    start: new Date(year, 7, 25),
    end: new Date(year, 11, 20)
  };
}

// Helper functions (keep these as they were)
function getText(parent, selector) {
  const el = parent.querySelector(selector);
  return el ? el.textContent.trim() : '';
}

function extractCourseTitle(box) {
  const headerCell = box.querySelector('.header_cell');
  if (headerCell) {
    const divs = headerCell.querySelectorAll('div');
    for (const d of divs) {
      const directText = Array.from(d.childNodes)
        .filter(n => n.nodeType === Node.TEXT_NODE)
        .map(n => n.textContent.trim())
        .join(' ').trim();
      
      const spanText = Array.from(d.querySelectorAll('span:not(.mobileNUmber)'))
        .map(s => s.textContent.trim())
        .join(' ').trim();
      
      const candidate = spanText || directText;
      if (
        candidate.length > 10 &&
        !/^\d|^Jul|^Aug|^Jan|^Feb|^Mar|^Apr|^May|^Jun|^Sep|^Oct|^Nov|^Dec/i.test(candidate) &&
        !/Summer|Spring|Fall|Winter|Five Week|Eight Week|Three Week|Session/i.test(candidate)
      ) {
        return candidate;
      }
    }
  }
  return '';
}

function extractDaysTimesFromAriaLabel(text) {
  if (!text) return { rawDays: '', startTime: '', endTime: '' };
  const decoded = decodeURIComponent(text);
  const match = decoded.match(
    /on\s+([\w,\s]+?)\s+from\s+(\d{1,2}:\d{2}\s*(?:AM|PM))\s+to\s+(\d{1,2}:\d{2}\s*(?:AM|PM))/i
  );
  if (!match) return { rawDays: '', startTime: '', endTime: '' };
  return { rawDays: match[1].trim(), startTime: match[2].trim(), endTime: match[3].trim() };
}

async function parseCourseFromAriaLabel(ariaLabel, box) {
  if (!ariaLabel) return null;
  const text = decodeURIComponent(ariaLabel);

  const codeMatch = text.match(/^([A-Z]{2,5}\s+\d{1,4}[A-Z]?)/);
  if (!codeMatch) return null;

  const courseCode = codeMatch[1];
  const termText = getCurrentTerm();
  const dates = extractDatesFromAriaLabelProper(text, termText);
  const times = extractDaysTimesFromAriaLabel(text);

  if (!dates.startDate || !dates.endDate) return null;

  return {
    courseCode,
    courseTitle: extractTitleFromAriaLabel(text, courseCode),
    section: box ? getText(box, '.type_block') : '',
    classNumber: box ? getText(box, '.crn_value') : '',
    rawDays: times.rawDays || 'TBA',
    startTime: times.startTime || '12:00 AM',
    endTime: times.endTime || '1:00 AM',
    startDate: dates.startDate,
    endDate: dates.endDate,
    location: box ? (box.querySelector('.location_block') || { textContent: '' }).textContent.trim() : '',
    instructor: box ? getText(box, '[title="Instructor(s)"]') : '',
    college: box ? getText(box, '.campus_block') : '',
    instrMode: box ? getText(box, '.instructional_method_block') : '',
    session: termText,
    isOnline: false,
  };
}

function extractTitleFromAriaLabel(text, courseCode) {
  const after = text.slice(courseCode.length).trim();
  const idx = after.toLowerCase().indexOf('running from');
  return idx > -1 ? after.slice(0, idx).trim() : '';
}

async function scrapeFromTimetable() {
  const courses = [];
  const leftToDay = { 0: 'MO', 20: 'TU', 40: 'WE', 60: 'TH', 80: 'FR' };
  const grouped = {};
  const termText = getCurrentTerm();

  const blocks = document.querySelectorAll('.time_block[style]');
  for (const block of blocks) {
    const inner = block.querySelector('.nonmobile');
    if (!inner) continue;
    const lines = inner.textContent.split(/\n|\r/).map(l => l.trim()).filter(Boolean);
    if (lines.length < 2) continue;

    const codeMatch = lines[0].match(/([A-Z]{2,5}\s+\d{1,4}[A-Z]?)/);
    if (!codeMatch) continue;

    const courseCode = codeMatch[1];
    const section = lines[1] || '';
    const location = lines[2] || '';
    const dateSpan = block.querySelector('.tt_dates');
    const dateRange = dateSpan ? dateSpan.textContent.trim() : '';

    const leftMatch = (block.style.left || '').match(/(\d+)/);
    const leftPct = leftMatch ? Math.round(Number(leftMatch[1])) : -1;
    const day = leftToDay[leftPct] || null;

    const key = courseCode + '|' + section;
    if (!grouped[key]) {
      const dateM = dateRange.match(
        /((?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s+\d{1,2})\s*[-–]\s*((?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s+\d{1,2})/i
      );
      
      let startDate = null, endDate = null;
      if (dateM) {
        startDate = parseDateWithYear(dateM[1].trim(), termText);
        endDate = parseDateWithYear(dateM[2].trim(), termText);
        if (startDate && endDate && endDate < startDate) {
          endDate.setFullYear(startDate.getFullYear() + 1);
        }
      }
      
      if (!startDate || !endDate) {
        const defaults = getDefaultDatesForTerm(termText);
        startDate = defaults.start;
        endDate = defaults.end;
      }
      
      grouped[key] = {
        courseCode, courseTitle: '', section, classNumber: '',
        days: day ? [day] : [],
        startTime: '', endTime: '',
        startDate, endDate,
        location, instructor: '', college: '', instrMode: '', session: termText,
        isOnline: location.toLowerCase().includes('online'),
      };
    } else if (day && !grouped[key].days.includes(day)) {
      grouped[key].days.push(day);
    }

    if (!grouped[key].startTime) {
      const ariaEl = document.querySelector('.course_header[aria-label]');
      if (ariaEl) {
        const t = extractDaysTimesFromAriaLabel(ariaEl.getAttribute('aria-label'));
        grouped[key].startTime = t.startTime;
        grouped[key].endTime = t.endTime;
      }
    }
  }

  for (const c of Object.values(grouped)) {
    if (!c.days.length && !c.isOnline) continue;
    if (!c.startTime) {
      c.startTime = '12:00 AM';
      c.endTime = '1:00 AM';
    }
    c.rawDays = c.days.length ? c.days.join(',') : (c.isOnline ? 'TBA' : '');
    courses.push(c);
  }
  return courses;
}

// DAY_MAP and parsing utilities (keep existing)
const DAY_MAP = {
  monday: 'MO', tuesday: 'TU', wednesday: 'WE', thursday: 'TH',
  friday: 'FR', saturday: 'SA', sunday: 'SU',
  mon: 'MO', tue: 'TU', tues: 'TU', wed: 'WE', weds: 'WE',
  thu: 'TH', thur: 'TH', thurs: 'TH', fri: 'FR', sat: 'SA', sun: 'SU',
  mo: 'MO', tu: 'TU', we: 'WE', th: 'TH', fr: 'FR', sa: 'SA', su: 'SU',
};

const JS_DAY_TO_ICAL = ['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA'];

function parseDaysToRRULE(rawDays) {
  if (!rawDays || rawDays === 'TBA') return '';
  const tokens = [];
  const words = rawDays.split(/[\s,/&+]+|(?:\band\b)/i).map(w => w.trim().toLowerCase()).filter(Boolean);
  for (const w of words) {
    const ic = DAY_MAP[w];
    if (ic && !tokens.includes(ic)) tokens.push(ic);
  }
  if (tokens.length === 0) {
    for (const t of rawDays.split(',').map(t => t.trim().toUpperCase())) {
      if (['MO', 'TU', 'WE', 'TH', 'FR', 'SA', 'SU'].includes(t) && !tokens.includes(t)) tokens.push(t);
    }
  }
  return tokens.join(',');
}

function formatICalDateTime(date, timeStr) {
  if (!date || !timeStr) return null;
  const timeMatch = timeStr.match(/(\d{1,2}):(\d{2})\s*(AM|PM)/i);
  if (!timeMatch) return null;
  
  let hours = parseInt(timeMatch[1]);
  const minutes = parseInt(timeMatch[2]);
  const meridian = timeMatch[3].toUpperCase();
  
  if (meridian === 'PM' && hours !== 12) hours += 12;
  if (meridian === 'AM' && hours === 12) hours = 0;
  
  const pad = n => String(n).padStart(2, '0');
  return '' + date.getFullYear() + pad(date.getMonth() + 1) + pad(date.getDate()) +
         'T' + pad(hours) + pad(minutes) + '00';
}

function formatICalDate(date) {
  if (!date) return '';
  const pad = n => String(n).padStart(2, '0');
  return '' + date.getFullYear() + pad(date.getMonth() + 1) + pad(date.getDate());
}

function findFirstMeetingDay(startDate, byDayTokens) {
  if (!startDate || !byDayTokens) return startDate;
  const targets = byDayTokens.split(',');
  const d = new Date(startDate);
  d.setHours(0, 0, 0, 0);
  for (let i = 0; i < 7; i++) {
    if (targets.includes(JS_DAY_TO_ICAL[d.getDay()])) return d;
    d.setDate(d.getDate() + 1);
  }
  return startDate;
}

function escapeICS(str) {
  if (!str) return '';
  return String(str).replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\n/g, '\\n').replace(/\r/g, '');
}

function foldLine(line) {
  if (line.length <= 75) return line;
  const parts = [];
  let rem = line;
  while (rem.length > 75) {
    parts.push(rem.slice(0, 75));
    rem = ' ' + rem.slice(75);
  }
  parts.push(rem);
  return parts.join('\r\n');
}

function generateUID(course) {
  return (course.courseCode.replace(/\s/g, '-') + '-' + (course.classNumber || Date.now()) + '@cuny-vsb');
}

function generateICS(courses) {
  const now = new Date();
  const dtstamp = formatICalDateTime(now, now.getHours() + ':' + now.getMinutes() + ' ' + (now.getHours() >= 12 ? 'PM' : 'AM'));
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
  const byDay = parseDaysToRRULE(course.rawDays);
  
  // Skip if no meeting days (async online)
  if (!byDay) return null;
  
  const firstMeeting = findFirstMeetingDay(course.startDate, byDay);
  const dtstart = formatICalDateTime(firstMeeting, course.startTime);
  const dtend = formatICalDateTime(firstMeeting, course.endTime);
  const until = formatICalDate(course.endDate) + 'T235959Z';
  const summary = [course.courseCode, course.courseTitle].filter(Boolean).join(' - ');

  const descLines = [];
  if (course.college) descLines.push(escapeICS(course.college));
  if (course.classNumber) descLines.push('Class Number: ' + course.classNumber);
  if (course.section) descLines.push('Section: ' + course.section);
  if (course.instructor) descLines.push('Instructor: ' + escapeICS(course.instructor));
  if (course.instrMode) descLines.push('Instruction Mode: ' + escapeICS(course.instrMode));
  if (course.session) descLines.push('Term: ' + escapeICS(course.session));

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

function downloadICS(content, filename) {
  const blob = new Blob([content], { type: 'text/calendar;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.style.display = 'none';
  document.body.appendChild(a);
  a.click();
  setTimeout(() => {
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }, 1000);
}
