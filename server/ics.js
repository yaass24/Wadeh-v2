'use strict';
/* RFC 5545 iCalendar generation for WADEH commitments.
   Used both for one-off event import (.ics download) and the per-user subscription feed (webcal://). */
const { addMonths, TZ } = require('./db');

const TYPE_LABEL = { installment: 'قسط', bill: 'فاتورة', subscription: 'اشتراك', personal: 'التزام شخصي', savings_group: 'جمعية' };
const sar = (h) => (h / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' ر.س';

function esc(s) { return String(s ?? '').replace(/\\/g, '\\\\').replace(/\r?\n/g, '\\n').replace(/,/g, '\\,').replace(/;/g, '\\;'); }

/* Fold lines at 75 octets (UTF-8 bytes), never splitting a multi-byte character. */
function fold(line) {
  const out = []; let cur = ''; let bytes = 0; let limit = 75;
  for (const ch of line) {
    const b = Buffer.byteLength(ch);
    if (bytes + b > limit) { out.push(cur); cur = ' '; bytes = 1; limit = 75; }
    cur += ch; bytes += b;
  }
  out.push(cur);
  return out.join('\r\n');
}

const utcStamp = (ms) => new Date(ms).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
const localStamp = (iso, hhmm) => iso.replace(/-/g, '') + 'T' + hhmm.replace(':', '') + '00';
function addMinutes(hhmm, mins) { const [h, m] = hhmm.split(':').map(Number); const t = h * 60 + m + mins; return String(Math.floor(t / 60) % 24).padStart(2, '0') + ':' + String(t % 60).padStart(2, '0'); }

const VTIMEZONE = ['BEGIN:VTIMEZONE', 'TZID:' + TZ, 'X-LIC-LOCATION:' + TZ, 'BEGIN:STANDARD', 'TZOFFSETFROM:+0300', 'TZOFFSETTO:+0300', 'TZNAME:+03', 'DTSTART:19700101T000000', 'END:STANDARD', 'END:VTIMEZONE'];

/* Remaining payments for a commitment with a fixed number of payments. */
function remainingCount(c) {
  if (!c.total_payments) return null;
  return Math.max(0, c.total_payments - (c.paid_count || 0));
}

function commitmentEvent(c, { reminderTime = '09:00', withAlarm = true } = {}) {
  const lines = ['BEGIN:VEVENT'];
  lines.push('UID:wadeh-commitment-' + c.id + '@wadeh.app');
  lines.push('DTSTAMP:' + utcStamp(Date.now()));
  lines.push('LAST-MODIFIED:' + utcStamp(c.updated_at || Date.now()));
  lines.push('SEQUENCE:' + (c.sequence || 0));
  lines.push('DTSTART;TZID=' + TZ + ':' + localStamp(c.due_date, reminderTime));
  lines.push('DTEND;TZID=' + TZ + ':' + localStamp(c.due_date, addMinutes(reminderTime, 30)));
  if (c.recurrence === 'monthly') {
    const rem = remainingCount(c);
    lines.push('RRULE:FREQ=MONTHLY' + (rem ? ';COUNT=' + rem : ''));
  }
  const label = TYPE_LABEL[c.type] || 'التزام';
  // Privacy (per the Figma "مزامنة التقويم" screen): only the commitment name appears — never the amount.
  lines.push('SUMMARY:' + esc(c.title));
  let desc = `${label} من واضح`;
  if (c.type === 'savings_group' && c.total_payments) desc += `\nعدد الأشهر: ${c.total_payments}` + (c.payout_index ? `\nشهر الاستلام: ${c.payout_index}` : '');
  if (c.notes) desc += `\n${c.notes}`;
  desc += '\nتذكير فقط — لا يتم أي خصم تلقائي.';
  lines.push('DESCRIPTION:' + esc(desc));
  lines.push('CATEGORIES:' + esc('واضح,' + label));
  lines.push('STATUS:CONFIRMED', 'TRANSP:TRANSPARENT');
  if (withAlarm) {
    const days = Number(c.reminder_days || 0);
    lines.push('BEGIN:VALARM', 'ACTION:DISPLAY', 'DESCRIPTION:' + esc(`تذكير: ${c.title} مستحق`), 'TRIGGER:' + (days > 0 ? `-P${days}D` : '-PT0M'), 'END:VALARM');
  }
  lines.push('END:VEVENT');
  return lines;
}

function billEvent(b, { reminderTime = '09:00' } = {}) {
  return ['BEGIN:VEVENT', 'UID:wadeh-bill-' + b.id + '@wadeh.app', 'DTSTAMP:' + utcStamp(Date.now()),
    'DTSTART;TZID=' + TZ + ':' + localStamp(b.due_date, reminderTime), 'DTEND;TZID=' + TZ + ':' + localStamp(b.due_date, addMinutes(reminderTime, 30)),
    'SUMMARY:' + esc(`فاتورة ${b.biller}`),
    'DESCRIPTION:' + esc(`فاتورة ${b.biller}\nتذكير فقط من واضح.`),
    'STATUS:CONFIRMED', 'TRANSP:TRANSPARENT',
    'BEGIN:VALARM', 'ACTION:DISPLAY', 'DESCRIPTION:' + esc(`فاتورة ${b.biller} مستحقة`), 'TRIGGER:-P1D', 'END:VALARM', 'END:VEVENT'];
}

function calendar(events, { name = 'واضح | الالتزامات', feed = false } = {}) {
  const head = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//WADEH//Commitments 1.0//AR', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH',
    'X-WR-CALNAME:' + esc(name), 'X-WR-TIMEZONE:' + TZ, 'X-WR-CALDESC:' + esc('التزامات واضح القادمة — كل شيء أوضح.')];
  if (feed) head.push('REFRESH-INTERVAL;VALUE=DURATION:PT1H', 'X-PUBLISHED-TTL:PT1H', 'COLOR:#173A65');
  const all = [...head, ...VTIMEZONE, ...events.flat(), 'END:VCALENDAR'];
  return all.map(fold).join('\r\n') + '\r\n';
}

module.exports = { commitmentEvent, billEvent, calendar, fold, esc, addMonths };
