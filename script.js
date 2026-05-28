/**
 * EMILY'S BOOKING SYSTEM - VERSION 7.0
 * New: Calendar invites (.ics), payment/invoices for paid sessions,
 * auto-removal of past slots, silent delete on all requests.
 */

const firebaseConfig = {
  apiKey: "AIzaSyDiqeiZw162zVbLeDMJPZE-Yno1Zt7QOwM",
  authDomain: "emily-booking.firebaseapp.com",
  projectId: "emily-booking",
  storageBucket: "emily-booking.firebasestorage.app",
  messagingSenderId: "1086267558961",
  appId: "1:1086267558961:web:a0ccafeb3aee15932f1910",
  measurementId: "G-NV4BP1T2B9"
};

firebase.initializeApp(firebaseConfig);
const db = firebase.firestore();

let state = {
  view: 'student',
  adminUnlocked: false,
  adminTab: 'requests',
  isLoaded: false,
  flashMessage: null,
  config: {
    name: '', email: '', title: 'Book a Consultation', teamsLink: '', adminPin: '123456789',
    meetingTypes: [], emailjsServiceId: '', emailjsTemplateId: '', emailjsPublicKey: '',
    emailProvider: 'zoho',
    stripeLink: '',
    invoicePrefix: 'INV',
  },
  slots: [],
  requests: [],
  studentForm: { name: '', email: '', type: '', duration: 0, price: 0, slotId: '', message: '' },
  hasSubmitted: false,
  newSlot: { date: '', start: '', end: '', slotLength: '45' },
  tempPin: ''
};

// =============================================================================
// CALENDAR INVITE (.ics)
// =============================================================================

function toICSDateTime(date, time) {
  // Returns YYYYMMDDTHHMMSS — local UK time with TZID declared in the file
  return date.replace(/-/g, '') + 'T' + time.replace(':', '') + '00';
}

function generateICS(req) {
  const endTime = calculateEndTime(req.slotStart, req.duration || 45);
  const uid = (req.id || String(Date.now())) + '@emily-bookings';
  const teamsLink = state.config.teamsLink || '';
  const desc = [
    req.type + ' with ' + req.name,
    teamsLink ? 'Teams: ' + teamsLink : '',
    'Duration: ' + (req.duration || 45) + ' minutes',
  ].filter(Boolean).join('\\n');

  return [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//DNT Emily Bookings//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:REQUEST',
    'BEGIN:VTIMEZONE',
    'TZID:Europe/London',
    'BEGIN:DAYLIGHT',
    'TZOFFSETFROM:+0000',
    'TZOFFSETTO:+0100',
    'TZNAME:BST',
    'DTSTART:19700329T010000',
    'RRULE:FREQ=YEARLY;BYDAY=-1SU;BYMONTH=3',
    'END:DAYLIGHT',
    'BEGIN:STANDARD',
    'TZOFFSETFROM:+0100',
    'TZOFFSETTO:+0000',
    'TZNAME:GMT',
    'DTSTART:19701025T020000',
    'RRULE:FREQ=YEARLY;BYDAY=-1SU;BYMONTH=10',
    'END:STANDARD',
    'END:VTIMEZONE',
    'BEGIN:VEVENT',
    'DTSTART;TZID=Europe/London:' + toICSDateTime(req.slotDate, req.slotStart),
    'DTEND;TZID=Europe/London:' + toICSDateTime(req.slotDate, endTime),
    'SUMMARY:' + req.type + ' — ' + req.name,
    'DESCRIPTION:' + desc,
    'ORGANIZER;CN=' + (state.config.name || 'Emily') + ':MAILTO:' + (state.config.email || ''),
    'ATTENDEE;CN=' + req.name + ':MAILTO:' + req.email,
    'UID:' + uid,
    'STATUS:CONFIRMED',
    'SEQUENCE:0',
    'END:VEVENT',
    'END:VCALENDAR',
  ].join('\r\n');
}

function downloadICS(req) {
  const ics = generateICS(req);
  const blob = new Blob([ics], { type: 'text/calendar;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'booking-' + req.slotDate + '-' + (req.name || 'session').replace(/\s+/g, '-') + '.ics';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

// =============================================================================
// INVOICE
// =============================================================================

let _invCounter = 1;

function showInvoice(req) {
  const price = req.price || getTypePrice(req.type);
  const prefix = state.config.invoicePrefix || 'INV';
  const invNo = prefix + '-' + new Date().getFullYear() + '-' + String(_invCounter++).padStart(3, '0');
  const issueDate = new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });
  const dueDate = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });
  const endTime = calculateEndTime(req.slotStart, req.duration || 45);
  const stripeLink = state.config.stripeLink || '';
  const esc = escapeHtml;

  const w = window.open('', '_blank');
  w.document.write(`<!DOCTYPE html>
<html>
<head>
<meta charset="UTF-8">
<title>Invoice ${invNo}</title>
<style>
  body{font-family:Georgia,serif;max-width:680px;margin:40px auto;padding:40px;color:#1A1A1A;background:#fff}
  .hdr{display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:48px}
  .brand{font-size:22px;font-weight:700;color:#2D5A3D}
  .brand small{display:block;font-size:13px;font-weight:400;color:#6B6960;margin-top:2px}
  .inv-meta{text-align:right}
  .inv-meta h2{font-size:28px;font-weight:700;color:#2D5A3D;margin-bottom:4px}
  .inv-meta p{font-size:13px;color:#6B6960;margin:2px 0}
  .parties{display:grid;grid-template-columns:1fr 1fr;gap:32px;margin-bottom:40px}
  .party h3{font-size:11px;text-transform:uppercase;letter-spacing:.1em;color:#9E9A90;margin-bottom:8px}
  .party p{font-size:14px;line-height:1.6}
  table{width:100%;border-collapse:collapse;margin-bottom:24px}
  th{text-align:left;font-size:11px;text-transform:uppercase;letter-spacing:.08em;color:#9E9A90;padding:0 0 10px;border-bottom:2px solid #EDEAE4}
  td{padding:14px 0;border-bottom:1px solid #EDEAE4;font-size:14px;vertical-align:top}
  .amt{text-align:right}
  .total td{border-bottom:none;padding-top:20px;font-size:18px;font-weight:700;color:#2D5A3D}
  .pay-box{background:#F0F7F2;border-radius:10px;padding:20px 24px;margin-top:32px}
  .pay-box h3{font-size:14px;font-weight:700;color:#2D5A3D;margin-bottom:8px}
  .pay-box p{font-size:13px;color:#3D7A52;line-height:1.6}
  .pay-box a{color:#2D5A3D;font-weight:700}
  footer{margin-top:40px;font-size:12px;color:#9E9A90;text-align:center;border-top:1px solid #EDEAE4;padding-top:20px}
  @media print{.no-print{display:none}}
</style>
</head>
<body>
<div class="hdr">
  <div class="brand">${esc(state.config.name || 'DNT Training')}<small>Dental Nurse Training</small></div>
  <div class="inv-meta"><h2>INVOICE</h2><p><strong>${invNo}</strong></p><p>Issued: ${issueDate}</p><p>Due: ${dueDate}</p></div>
</div>
<div class="parties">
  <div class="party"><h3>From</h3><p><strong>${esc(state.config.name || 'Emily')}</strong><br>${esc(state.config.email || '')}</p></div>
  <div class="party"><h3>To</h3><p><strong>${esc(req.name)}</strong><br>${esc(req.email)}</p></div>
</div>
<table>
  <thead><tr><th>Description</th><th>Date &amp; Time</th><th>Duration</th><th class="amt">Amount</th></tr></thead>
  <tbody>
    <tr>
      <td>${esc(req.type)}</td>
      <td>${formatDateLong(req.slotDate)}<br><span style="color:#6B6960;font-size:13px">${formatTime(req.slotStart)} &ndash; ${formatTime(endTime)}</span></td>
      <td>${req.duration || 45} min</td>
      <td class="amt">&pound;${price || '0.00'}</td>
    </tr>
  </tbody>
  <tfoot><tr class="total"><td colspan="3" style="text-align:right;padding-right:16px">Total Due</td><td class="amt">&pound;${price || '0.00'}</td></tr></tfoot>
</table>
${stripeLink
  ? `<div class="pay-box"><h3>Pay Online</h3><p>Pay securely here:<br><a href="${esc(stripeLink)}" target="_blank">${esc(stripeLink)}</a></p></div>`
  : `<div class="pay-box"><h3>Payment</h3><p>Please contact <a href="mailto:${esc(state.config.email || '')}">${esc(state.config.name || 'your tutor')}</a> to arrange payment.</p></div>`}
<footer>Thank you &mdash; ${esc(state.config.name || 'DNT Training')}</footer>
<p class="no-print" style="text-align:center;margin-top:32px">
  <button onclick="window.print()" style="padding:10px 24px;background:#2D5A3D;color:white;border:none;border-radius:8px;font-size:14px;font-weight:700;cursor:pointer">Print / Save as PDF</button>
</p>
</body></html>`);
  w.document.close();
}

// =============================================================================
// EMAIL LOGIC
// =============================================================================

async function sendEmailNotification(requestData, status, reason = "") {
  const { name, email, type, slotDate, slotStart, duration, message } = requestData;
  const teamsLink = state.config.teamsLink || "Link to follow";
  const formattedDate = formatDate(slotDate);
  const endTimeStr = calculateEndTime(slotStart, duration || 45);
  const formattedTime = `${formatTime(slotStart)} - ${formatTime(endTimeStr)}`;
  const dynamicSubject = `${type} at ${formattedTime} on ${formattedDate}`;

  let targetEmail = email;
  let targetName = name;
  let statusMessage = "";

  const studentNote = (message && message.trim()) ? `\n\nStudent Message: ${message}` : "";

  // Build payment line for approved paid sessions
  const price = getTypePrice(type);
  const stripeLink = state.config.stripeLink || '';
  const paymentLine = (status === 'approved' && price)
    ? `\n\nPayment: £${price} is due for this session.${stripeLink ? '\nPay here: ' + stripeLink : '\nPlease arrange payment with your tutor.'}`
    : '';

  if (status === 'approved') {
    statusMessage = `Hi ${name},\nYour booking for a ${type} at ${formattedTime} on ${formattedDate} is confirmed.\nPlease join here: ${teamsLink}${paymentLine}\nLooking forward to speaking with you.\nBest regards,\nEmily Bremner`;
  } else if (status === 'denied') {
    statusMessage = `Hi ${name},\nYour booking request for ${type} on ${formattedDate} has been declined.\nBest regards,\nEmily Bremner`;
  } else if (status === 'cancelled') {
    statusMessage = `Hi ${name},\nApologies, I have had to cancel your ${type} on ${formattedDate}.\nReason: ${reason}.\nPlease feel free to rearrange.\nBest regards,\nEmily Bremner`;
  } else if (status === 'admin_alert') {
    targetEmail = state.config.email;
    targetName = state.config.name;
    statusMessage = `NEW REQUEST RECEIVED:\n\nFrom: ${name} (${email})\nType: ${type}${price ? ' (£' + price + ')' : ''}\nWhen: ${formattedDate} at ${formattedTime}${studentNote}`;
  }

  const templateParams = {
    to_name: targetName,
    to_email: targetEmail,
    subject: dynamicSubject,
    meeting_type: type,
    status: status.toUpperCase(),
    date: formattedDate,
    time: formattedTime,
    teams_link: (status === 'approved' || status === 'admin_alert') ? teamsLink : "N/A",
    message: statusMessage
  };

  try {
    if (!state.config.emailjsServiceId || !state.config.emailjsPublicKey) return;
    await emailjs.send(
      state.config.emailjsServiceId,
      state.config.emailjsTemplateId,
      templateParams,
      state.config.emailjsPublicKey
    );
    console.log("Email sent successfully!");
  } catch (error) {
    console.error("Email failed:", error);
  }
}

// =============================================================================
// DATABASE & LOGIC
// =============================================================================

async function loadApplicationData() {
  try {
    const configDoc = await db.collection('settings').doc('config').get();
    if (configDoc.exists) {
      Object.assign(state.config, configDoc.data());
      state.tempPin = state.config.adminPin;
    }
    const slotSnap = await db.collection('slots').get();
    state.slots = slotSnap.docs.map(doc => ({ id: doc.id, ...doc.data() }));

    // Auto-remove past slots silently
    await cleanupPastSlots();

    const reqSnap = await db.collection('requests').orderBy('submittedAt', 'desc').get();
    state.requests = reqSnap.docs.map(doc => ({ id: doc.id, ...doc.data() }));
    state.isLoaded = true;
    render();
  } catch (error) { state.isLoaded = true; render(); }
}

// Silently remove slots with dates before today from Firestore
async function cleanupPastSlots() {
  const today = getTodayDateString();
  const past = state.slots.filter(s => s.date < today);
  if (past.length === 0) return;
  try {
    const batch = db.batch();
    past.forEach(s => batch.delete(db.collection('slots').doc(s.id)));
    await batch.commit();
    state.slots = state.slots.filter(s => s.date >= today);
  } catch (e) {
    console.error('Cleanup error:', e);
  }
}

async function silentSave(field, value) {
  const keys = field.split('.');
  if (keys[0] === 'config') {
    state.config[keys[1]] = value;
    await db.collection('settings').doc('config').set(state.config);
  }
}

async function updatePin() {
  if (!state.tempPin || state.tempPin.length < 4) {
    showFlash("PIN must be at least 4 digits");
    return;
  }
  state.config.adminPin = state.tempPin;
  await db.collection('settings').doc('config').set(state.config);
  showFlash("PIN Updated Successfully");
  render();
}

async function updateRequestStatus(requestId, newStatus) {
  const reqRef = db.collection('requests').doc(requestId);
  const doc = await reqRef.get();

  if (doc.exists) {
    await reqRef.update({ status: newStatus });

    // Auto-download calendar invite for admin when approving
    if (newStatus === 'approved') {
      downloadICS(doc.data());
    }

    loadApplicationData();
    sendEmailNotification(doc.data(), newStatus).catch(err => console.error("Email failed:", err));
  }
}

async function submitRequest() {
  const form = state.studentForm;
  const slot = state.slots.find(s => s.id === form.slotId);
  const newRequest = {
    ...form,
    slotDate: slot.date,
    slotStart: slot.start,
    status: 'pending',
    submittedAt: new Date().toISOString()
  };

  await db.collection('requests').add(newRequest);
  sendEmailNotification(newRequest, 'admin_alert').catch(err => console.error("Admin alert failed:", err));

  state.hasSubmitted = true;
  loadApplicationData();
}

async function handleCancel(requestId) {
  const reason = prompt("Enter reason for cancellation:");
  if (reason === null) return;

  const reqRef = db.collection('requests').doc(requestId);
  const doc = await reqRef.get();

  if (doc.exists) {
    await reqRef.update({ status: 'cancelled' });
    loadApplicationData();
    sendEmailNotification(doc.data(), 'cancelled', reason).catch(err => console.error("Email failed:", err));
  }
}

// Silent delete — no email sent, available on all requests
async function deleteRequest(requestId) {
  if (!confirm("Delete this booking request?\n\nThe learner will NOT be notified.")) return;
  await db.collection('requests').doc(requestId).delete();
  loadApplicationData();
}

async function generateSlots() {
  const ns = state.newSlot;
  if (!ns.date || !ns.start || !ns.end) return showFlash("Fill all fields");
  const slotMin = parseInt(ns.slotLength);
  const [sh, sm] = ns.start.split(':').map(Number);
  const [eh, em] = ns.end.split(':').map(Number);
  let cur = sh * 60 + sm;
  const end = eh * 60 + em;
  while (cur + slotMin <= end) {
    const sH = String(Math.floor(cur / 60)).padStart(2, '0');
    const sM = String(cur % 60).padStart(2, '0');
    await db.collection('slots').add({ date: ns.date, start: `${sH}:${sM}` });
    cur += (slotMin + 10);
  }
  loadApplicationData();
}

async function deleteSlot(id) {
  await db.collection('slots').doc(id).delete();
  loadApplicationData();
}

async function addMeetingType() {
  const name = prompt("Meeting name (e.g. Revision Session):");
  if (!name) return;
  const duration = prompt("Duration in minutes (e.g. 45):");
  if (!duration) return;
  const priceInput = prompt("Price in £ (leave blank if free):");
  const price = priceInput && priceInput.trim() ? parseFloat(priceInput) : 0;

  if (!state.config.meetingTypes) state.config.meetingTypes = [];
  state.config.meetingTypes.push({ name: name.trim(), duration: parseInt(duration), price });
  await db.collection('settings').doc('config').set(state.config);
  showFlash("Meeting Type Added");
  render();
}

async function deleteMeetingType(index) {
  if (confirm("Remove this meeting type?")) {
    state.config.meetingTypes.splice(index, 1);
    await db.collection('settings').doc('config').set(state.config);
    showFlash("Meeting Type Removed");
    render();
  }
}

async function editSlotTime(slotId, currentStart) {
  const newTime = prompt("Enter new start time (HH:MM):", currentStart);
  if (newTime && newTime !== currentStart) {
    if (/^\d{2}:\d{2}$/.test(newTime)) {
      await db.collection('slots').doc(slotId).update({ start: newTime });
      showFlash("Time Updated");
      loadApplicationData();
    } else {
      showFlash("Invalid format. Use HH:MM");
    }
  }
}

async function editMeetingType(index) {
  const type = state.config.meetingTypes[index];
  const newName = prompt("Edit Meeting Name:", type.name);
  const newDuration = prompt("Edit Duration (in minutes):", type.duration);
  const priceInput = prompt("Price in £ (leave blank if free):", type.price || '');

  if (newName !== null && newDuration !== null) {
    const price = priceInput && priceInput.trim() ? parseFloat(priceInput) : 0;
    state.config.meetingTypes[index] = {
      name: newName,
      duration: parseInt(newDuration),
      price
    };
    await db.collection('settings').doc('config').set(state.config);
    showFlash("Meeting Type Updated");
    render();
  }
}

// Get price for a given type name from meetingTypes config
function getTypePrice(typeName) {
  if (!state.config.meetingTypes) return 0;
  const t = state.config.meetingTypes.find(m => m.name === typeName);
  return (t && t.price) ? t.price : 0;
}

// =============================================================================
// INTERFACE
// =============================================================================

function render() {
  const app = document.getElementById('app');
  if (!state.isLoaded) { app.innerHTML = `<div class="loading"><div class="spinner"></div><p>Loading...</p></div>`; return; }
  let html = state.flashMessage ? `<div class="flash">${state.flashMessage}</div>` : "";

  html += `
    <div class="header">
      <div class="logo" id="logo-trigger">B</div>
      <h1>${escapeHtml(state.config.title)}</h1>
      <p class="subtitle">with ${escapeHtml(state.config.name)}</p>
    </div>`;

  if (state.adminUnlocked) {
    html += `
      <div class="tabs main-nav">
        <button class="tab ${state.view === 'admin' ? 'active' : ''}" onclick="state.view='admin'; render();">Admin</button>
        <button class="tab ${state.view === 'student' ? 'active' : ''}" onclick="state.view='student'; state.hasSubmitted=false; render();">Student View</button>
        <button class="tab" onclick="state.adminUnlocked=false; state.view='student'; render();">🔒 Lock</button>
      </div>`;
  }

  html += (state.view === 'admin') ? renderAdminView() : renderStudentView();
  app.innerHTML = html;
  setupEventListeners();
}

function renderStudentView() {
  if (state.hasSubmitted) {
    const submittedType = state.studentForm.type;
    const price = getTypePrice(submittedType);
    const stripeLink = state.config.stripeLink || '';
    return `<div class="card success-card">
      <div class="success-icon">✓</div>
      <h2>Request Sent!</h2>
      <p>${escapeHtml(state.config.name || 'Your tutor')} will review your request and send a confirmation email with the Teams link once approved.</p>
      ${price ? `<div class="payment-notice">💳 <strong>Payment reminder:</strong> This session costs <strong>£${price}</strong>. You’ll receive payment details in your confirmation email.${stripeLink ? ' You can also <a href="' + escapeHtml(stripeLink) + '" target="_blank">pay now by card</a>.' : ''}</div>` : ''}
      <button class="btn btn-ghost" style="margin-top:20px" onclick="location.reload()">Back</button>
    </div>`;
  }

  const f = state.studentForm;
  const unavailableIds = state.requests
    .filter(r => r.status === 'pending' || r.status === 'approved')
    .map(r => r.slotId);
  const groupedSlots = {};

  state.slots
    .filter(s => s.date >= getTodayDateString() && !unavailableIds.includes(s.id))
    .sort((a, b) => a.date.localeCompare(b.date) || a.start.localeCompare(b.start))
    .forEach(s => { if (!groupedSlots[s.date]) groupedSlots[s.date] = []; groupedSlots[s.date].push(s); });

  const price = getTypePrice(f.type);
  const stripeLink = state.config.stripeLink || '';

  return `<div class="card">
    <div class="grid-2">
      <div>
        <label class="field-label">Name *</label>
        <input type="text" placeholder="Full Name" value="${f.name}"
          oninput="state.studentForm.name=this.value; document.getElementById('book-btn').disabled = !(state.studentForm.name.trim() && state.studentForm.email.trim() && state.studentForm.type && state.studentForm.slotId)">
      </div>
      <div>
        <label class="field-label">Email *</label>
        <input type="email" placeholder="Email Address" value="${f.email}"
          oninput="state.studentForm.email=this.value; document.getElementById('book-btn').disabled = !(state.studentForm.name.trim() && state.studentForm.email.trim() && state.studentForm.type && state.studentForm.slotId)">
      </div>
    </div>

    <div class="section-title">Meeting Type</div>
    <div class="chips-wrap">
      ${(state.config.meetingTypes || []).map(opt => {
        const isPaid = opt.price > 0;
        return `<button class="chip ${isPaid ? 'paid-chip' : ''} ${f.type === opt.name ? 'selected' : ''}"
          onclick="state.studentForm.type='${opt.name.replace(/'/g, "\\'")}'; state.studentForm.duration=${opt.duration}; state.studentForm.price=${opt.price || 0}; render();">
          ${escapeHtml(opt.name)} (${opt.duration}m)${isPaid ? `<span class="price-tag">£${opt.price}</span>` : ''}
        </button>`;
      }).join('')}
    </div>

    ${price ? `<div class="notice notice-purple">💳 <strong>${escapeHtml(f.type)}</strong> costs <strong>£${price}</strong>. Payment details will be included in your confirmation.${stripeLink ? ' <a href="' + escapeHtml(stripeLink) + '" target="_blank">Pay in advance here.</a>' : ''}</div>` : ''}

    ${f.type ? Object.keys(groupedSlots).sort().map(date => `
      <div style="margin-top:15px">
        <div style="font-weight:700;">${formatDate(date)}</div>
        <div class="chips-wrap">${groupedSlots[date].map(slot => {
          const end = calculateEndTime(slot.start, f.duration);
          return `<button class="chip ${f.slotId === slot.id ? 'selected' : ''}"
            onclick="state.studentForm.slotId='${slot.id}'; render();">
            ${formatTime(slot.start)} – ${formatTime(end)}
          </button>`;
        }).join('')}</div>
      </div>`).join('')
    : '<p style="color:gray; margin-top:20px;">Please select a meeting type.</p>'}

    <div style="margin-top:20px;">
      <label class="field-label">Additional Message (Optional)</label>
      <textarea placeholder="Anything else I should know before the meeting?"
        style="width:100%;padding:12px;border:1px solid #ddd;border-radius:8px;font-family:inherit;resize:vertical;"
        rows="3" oninput="state.studentForm.message=this.value">${f.message || ''}</textarea>
    </div>

    <button class="btn btn-primary btn-full" id="book-btn" style="margin-top:20px"
      ${(f.name.trim() && f.email.trim() && f.type && f.slotId) ? '' : 'disabled'}
      onclick="submitRequest()">
      Book Now
    </button>
  </div>`;
}

function renderAdminView() {
  const c = state.config;
  const esc = escapeHtml;
  const pc = state.requests.filter(r => r.status === 'pending').length;
  let sub = "";

  if (state.adminTab === 'config') {
    sub = `
    <div class="card">
      <div class="section-title">Your Details</div>
      <div class="grid-2">
        <div><label class="field-label">Your Name</label><input type="text" placeholder="Dr. Smith" value="${esc(c.name)}" oninput="silentSave('config.name',this.value)"></div>
        <div><label class="field-label">Your Email</label><input type="email" placeholder="you@dentalnurse.training" value="${esc(c.email)}" oninput="silentSave('config.email',this.value)"></div>
      </div>
      <hr class="divider">
      <div class="section-title">Teams Link</div>
      <input type="text" value="${esc(c.teamsLink || '')}" oninput="silentSave('config.teamsLink',this.value)" placeholder="https://teams.microsoft.com/l/meetup-join/...">

      <hr class="divider">
      <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:10px;">
        <div class="section-title" style="margin:0;">Meeting Types</div>
        <button class="btn btn-primary" style="padding:5px 12px; font-size:12px;" onclick="addMeetingType()">+ Add New</button>
      </div>
      <div style="background:#f9f9f9; padding:10px; border-radius:8px; margin-bottom:20px; border:1px solid #eee;">
        ${(c.meetingTypes || []).length === 0
          ? '<p style="font-size:13px;color:#888;text-align:center;">No types added.</p>'
          : c.meetingTypes.map((type, index) => `
            <div style="display:flex; justify-content:space-between; align-items:center; background:white; padding:10px; border-radius:6px; margin-bottom:8px; border:1px solid #eee;">
              <div>
                <span style="font-weight:700;">${esc(type.name)}</span>
                <span style="font-size:12px;color:#666;"> (${type.duration}m)</span>
                ${type.price ? `<span class="price-tag">£${type.price}</span>` : '<span style="font-size:12px;color:#aaa;margin-left:6px;">Free</span>'}
              </div>
              <div style="display:flex; gap:10px;">
                <button class="btn btn-ghost" style="color:blue;border:none;padding:0;" onclick="editMeetingType(${index})">Edit</button>
                <button class="btn btn-ghost" style="color:red;border:none;padding:0;" onclick="deleteMeetingType(${index})">Delete</button>
              </div>
            </div>`).join('')}
      </div>

      <hr class="divider">
      <div class="section-title">Payments (Revision &amp; Mock OSCEs)</div>
      <p style="color:var(--text-soft);font-size:13px;margin-bottom:16px;line-height:1.5">Prices are set per meeting type above. Add your Stripe link here and it will appear in invoices and confirmation emails.</p>
      <div class="grid-2">
        <div>
          <label class="field-label">Stripe Payment Link</label>
          <input type="text" placeholder="https://buy.stripe.com/..." value="${esc(c.stripeLink || '')}" oninput="silentSave('config.stripeLink',this.value)">
        </div>
        <div>
          <label class="field-label">Invoice Number Prefix</label>
          <input type="text" placeholder="INV" value="${esc(c.invoicePrefix || 'INV')}" oninput="silentSave('config.invoicePrefix',this.value)">
        </div>
      </div>
      <div class="notice"><strong>Stripe tip:</strong> Go to your <a href="https://dashboard.stripe.com" target="_blank">Stripe dashboard</a> &rarr; Payment Links &rarr; Create. Paste the URL above. It’ll appear in approval emails and on invoices.</div>

      <hr class="divider">
      <div class="section-title">Auto-Email (EmailJS)</div>
      <div style="margin-bottom:16px"><label class="field-label">Public Key</label><input type="text" value="${esc(c.emailjsPublicKey || '')}" oninput="silentSave('config.emailjsPublicKey',this.value)"></div>
      <div class="grid-2">
        <div><label class="field-label">Service ID</label><input type="text" value="${esc(c.emailjsServiceId || '')}" oninput="silentSave('config.emailjsServiceId',this.value)"></div>
        <div><label class="field-label">Template ID</label><input type="text" value="${esc(c.emailjsTemplateId || '')}" oninput="silentSave('config.emailjsTemplateId',this.value)"></div>
      </div>
      <hr class="divider">
      <div class="section-title">Security</div>
      <label class="field-label">New Admin PIN</label>
      <div style="display:flex; gap:10px;">
        <input type="password" style="flex-grow:1" value="${state.tempPin}" oninput="state.tempPin=this.value">
        <button class="btn btn-primary" onclick="updatePin()">Update PIN</button>
      </div>
    </div>`;

  } else if (state.adminTab === 'slots') {
    const grouped = {};
    state.slots.forEach(s => { if (!grouped[s.date]) grouped[s.date] = []; grouped[s.date].push(s); });
    sub = `<div class="card">
      <div class="section-title">Add Availability</div>
      <p style="color:var(--text-soft);font-size:13px;margin-bottom:16px;">Past dates are removed automatically each time the page loads.</p>
      <div class="grid-2">
        <div><label class="field-label">Date</label><input type="date" min="${getTodayDateString()}" oninput="state.newSlot.date=this.value"></div>
        <div><label class="field-label">Length</label>
          <select onchange="state.newSlot.slotLength=this.value">
            <option value="15">15 min</option>
            <option value="30">30 min</option>
            <option value="45" selected>45 min</option>
            <option value="60">60 min</option>
          </select>
        </div>
      </div>
      <div class="grid-2" style="margin-top:10px">
        <div><label class="field-label">Starts</label><input type="time" oninput="state.newSlot.start=this.value"></div>
        <div><label class="field-label">Ends</label><input type="time" oninput="state.newSlot.end=this.value"></div>
      </div>
      <button class="btn btn-primary btn-full" style="margin-top:15px" onclick="generateSlots()">+ Generate Slots</button>
      <hr class="divider">
      ${Object.keys(grouped).sort().map(date => `
        <div style="margin-top:20px;">
          <div style="font-weight:700; display:flex; justify-content:space-between;">
            ${formatDate(date)}
            <button class="btn btn-ghost" style="font-size:11px;color:var(--red);" onclick="if(confirm('Remove all slots for this day?')) state.slots.filter(s=>s.date==='${date}').forEach(s=>deleteSlot(s.id))">
              Remove Day
            </button>
          </div>
          <div class="chips-wrap" style="margin-top:10px;">
            ${grouped[date].sort((a, b) => a.start.localeCompare(b.start)).map(s => `
              <div class="chip">
                ${formatTime(s.start)} – ${formatTime(calculateEndTime(s.start, 45))}
                <span style="cursor:pointer;color:red;margin-left:4px;" onclick="deleteSlot('${s.id}')">×</span>
              </div>`).join('')}
          </div>
        </div>`).join('')}
    </div>`;

  } else {
    // Requests tab
    sub = state.requests.length === 0 ? `<div class="empty"><div class="icon">📨</div><p>No requests yet.</p></div>` :
      state.requests.map(req => {
        const price = req.price || getTypePrice(req.type);
        const statusLabel = req.status === 'pending' ? '⏳ PENDING'
          : req.status === 'approved' ? '✓ APPROVED'
          : req.status === 'cancelled' ? '✕ CANCELLED'
          : req.status.toUpperCase();
        const statusColor = req.status === 'pending' ? '#ef6c00'
          : req.status === 'approved' ? 'var(--green)'
          : 'var(--red)';
        const statusBg = req.status === 'pending' ? '#fff3e0'
          : req.status === 'approved' ? 'var(--green-soft)'
          : 'var(--red-soft)';

        return `
        <div class="request-card" style="position:relative;">
          <div style="display:flex;justify-content:space-between;align-items:flex-start;flex-wrap:wrap;gap:8px;margin-bottom:10px;">
            <div>
              <div style="font-weight:bold;font-size:16px;">${escapeHtml(req.name)}</div>
              <div style="color:#666;font-size:14px;">${escapeHtml(req.email)}</div>
            </div>
            <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;">
              <span style="background:${statusBg};color:${statusColor};padding:3px 10px;border-radius:6px;font-size:12px;font-weight:700;">${statusLabel}</span>
              ${price ? `<span class="badge badge-purple">£${price}</span>` : ''}
              <button class="btn btn-danger" style="padding:4px 10px;font-size:12px;" onclick="deleteRequest('${req.id}')" title="Delete without notifying learner">🗑 Delete</button>
            </div>
          </div>

          <div style="font-size:13px;color:#444;line-height:1.8;margin-bottom:10px;">
            <strong>Type:</strong> ${escapeHtml(req.type)} &nbsp;|&nbsp;
            <strong>Date:</strong> ${formatDate(req.slotDate)} &nbsp;|&nbsp;
            <strong>Time:</strong> ${formatTime(req.slotStart)} &ndash; ${formatTime(calculateEndTime(req.slotStart, req.duration || 45))} &nbsp;|&nbsp;
            <strong>Duration:</strong> ${req.duration || 45} min
          </div>

          ${req.message ? `<div class="request-message">"${escapeHtml(req.message)}"</div>` : ''}

          ${state.config.teamsLink && req.status === 'approved' ? `
            <div class="zoom-link">
              <strong>Teams:</strong> <a href="${escapeHtml(state.config.teamsLink)}" target="_blank">${escapeHtml(state.config.teamsLink)}</a>
            </div>` : ''}

          ${price && req.status === 'approved' ? `
            <div class="payment-notice">
              💳 Payment due: <strong>£${price}</strong>
              ${state.config.stripeLink ? ` &mdash; <a href="${escapeHtml(state.config.stripeLink)}" target="_blank">Stripe link</a>` : ''}
            </div>` : ''}

          <div style="display:flex;gap:10px;flex-wrap:wrap;margin-top:12px;">
            ${req.status === 'pending' ? `
              <button class="btn btn-success" onclick="updateRequestStatus('${req.id}','approved')">✓ Approve &amp; Send</button>
              <button class="btn btn-danger" onclick="updateRequestStatus('${req.id}','denied')">✕ Deny</button>
            ` : ''}
            ${req.status === 'approved' ? `
              <button class="btn btn-ghost" onclick="downloadICS(state.requests.find(r=>r.id==='${req.id}'))">📅 Calendar Invite</button>
              ${price ? `<button class="btn btn-purple" onclick="showInvoice(state.requests.find(r=>r.id==='${req.id}'))">📄 Invoice</button>` : ''}
              <button class="btn btn-ghost" style="color:orange;" onclick="handleCancel('${req.id}')">Cancel</button>
            ` : ''}
          </div>
        </div>`;
      }).join('');
  }

  return `
    <div class="tabs sub-nav">
      <button class="tab ${state.adminTab === 'config' ? 'active' : ''}" onclick="state.adminTab='config'; render();">⚙ Settings</button>
      <button class="tab ${state.adminTab === 'slots' ? 'active' : ''}" onclick="state.adminTab='slots'; render();">📅 Availability</button>
      <button class="tab ${state.adminTab === 'requests' ? 'active' : ''}" onclick="state.adminTab='requests'; render();">📨 Requests (${pc})</button>
    </div>
    ${sub}`;
}

// =============================================================================
// HELPERS
// =============================================================================

function calculateEndTime(startTime, duration) {
  if (!startTime) return "";
  const [h, m] = startTime.split(':').map(Number);
  const d = new Date(); d.setHours(h); d.setMinutes(m + (parseInt(duration) || 45));
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}
function formatDate(d) { return new Date(d + 'T00:00:00').toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' }); }
function formatDateLong(d) { return new Date(d + 'T00:00:00').toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }); }
function formatTime(t) { if (!t) return ""; const [h, m] = t.split(':'); const hr = parseInt(h); return `${hr % 12 || 12}:${m} ${hr >= 12 ? 'PM' : 'AM'}`; }
function getTodayDateString() { return new Date().toISOString().split('T')[0]; }
function escapeHtml(s) { if (!s) return ""; const d = document.createElement('div'); d.textContent = s; return d.innerHTML; }
function showFlash(m) { state.flashMessage = m; render(); setTimeout(() => { state.flashMessage = null; render(); }, 3000); }

function setupEventListeners() {
  const logo = document.getElementById('logo-trigger');
  if (logo) {
    logo.replaceWith(logo.cloneNode(true));
    document.getElementById('logo-trigger').addEventListener('click', (e) => {
      if (e.detail === 3) {
        const pin = prompt("Admin PIN:");
        if (pin === state.config.adminPin) { state.adminUnlocked = true; state.view = 'admin'; render(); }
      }
    });
  }
}

loadApplicationData();
