/**
 * EMILY'S BOOKING SYSTEM - VERSION 5.9
 * Fix: Restored "Cancel" button for Approved requests.
 * Fix: Persistent Student Inputs.
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
    emailProvider: 'zoho'
  },
  slots: [],
  requests: [],
  studentForm: { name: '', email: '', type: '', duration: 0, slotId: '' },
  hasSubmitted: false,
  newSlot: { date: '', start: '', end: '', slotLength: '45' },
  tempPin: '' 
};

// =============================================================================
// 2. EMAIL LOGIC
// =============================================================================

async function sendEmailNotification(requestData, status, reason = "") {
  const { name, email, type, slotDate, slotStart, duration } = requestData;
  const teamsLink = state.config.teamsLink || "Link to follow";
  const formattedDate = formatDate(slotDate);
  const endTimeStr = calculateEndTime(slotStart, duration || 45);
  const formattedTime = `${formatTime(slotStart)} - ${formatTime(endTimeStr)}`;
  const dynamicSubject = `${type} at ${formattedTime} on ${formattedDate}`;

  let targetEmail = email; 
  let targetName = name;   
  let statusMessage = "";
  

  if (status === 'approved') {
    statusMessage = `Your booking for a ${type} at ${formattedTime} on ${formattedDate}.\nPlease join here: ${teamsLink}`;
  } else if (status === 'denied') {
    statusMessage = `Your booking request for ${type} on ${formattedDate} has been declined.`;
  } else if (status === 'cancelled') {
    statusMessage = `Your appointment for ${type} on ${formattedDate} has been cancelled. Reason: ${reason}`;
  } else if (status === 'admin_alert') {
    targetEmail = state.config.email;
    targetName = state.config.name;
    statusMessage = `NEW REQUEST RECEIVED:\n\nFrom: ${name} (${email})\nType: ${type}\nWhen: ${formattedDate} @ ${formattedTime}`;
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
    await emailjs.send(state.config.emailjsServiceId, state.config.emailjsTemplateId, templateParams, state.config.emailjsPublicKey);
  } catch (error) { console.error("Email failed:", error); }
}

// =============================================================================
// 3. DATABASE & LOGIC
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
    const reqSnap = await db.collection('requests').orderBy('submittedAt', 'desc').get();
    state.requests = reqSnap.docs.map(doc => ({ id: doc.id, ...doc.data() }));
    state.isLoaded = true;
    render();
  } catch (error) { state.isLoaded = true; render(); }
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
    await sendEmailNotification(doc.data(), newStatus);
    showFlash(`Request ${newStatus}`);
    loadApplicationData(); 
  }
}

async function submitRequest() {
  const form = state.studentForm;
  const slot = state.slots.find(s => s.id === form.slotId);
  const newRequest = { ...form, slotDate: slot.date, slotStart: slot.start, status: 'pending', submittedAt: new Date().toISOString() };
  await db.collection('requests').add(newRequest);
  if (state.config.email) await sendEmailNotification(newRequest, 'admin_alert');
  state.hasSubmitted = true;
  render();
}

async function handleCancel(requestId) {
  const reason = prompt("Enter reason for cancellation:");
  if (reason === null) return; 
  const reqRef = db.collection('requests').doc(requestId);
  const doc = await reqRef.get();
  if (doc.exists) {
    await sendEmailNotification(doc.data(), 'cancelled', reason);
    await reqRef.update({ status: 'cancelled' });
    showFlash("Cancelled and student notified");
    loadApplicationData();
  }
}

async function deleteRequest(requestId) {
  if (!confirm("Delete record?")) return;
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

// =============================================================================
// 4. INTERFACE
// =============================================================================

function render() {
  const app = document.getElementById('app');
  if (!state.isLoaded) { app.innerHTML = `<div class="loading">Loading...</div>`; return; }
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
  if (state.hasSubmitted) return `<div class="card success-card" style="text-align:center;"><h2>Request Sent!</h2><p>Check email for confirmation.</p><button class="btn btn-ghost" onclick="location.reload()">Back</button></div>`;
  const f = state.studentForm;
  const groupedSlots = {};
  const unavailableIds = state.requests.filter(r => r.status === 'pending' || r.status === 'approved').map(r => r.slotId);

  state.slots.filter(s => s.date >= getTodayDateString() && !unavailableIds.includes(s.id))
    .sort((a,b) => a.date.localeCompare(b.date) || a.start.localeCompare(b.start))
    .forEach(s => { if(!groupedSlots[s.date]) groupedSlots[s.date] = []; groupedSlots[s.date].push(s); });

  return `<div class="card">
    <div class="grid-2">
      <input type="text" placeholder="Name" value="${escapeHtml(f.name)}" oninput="state.studentForm.name=this.value">
      <input type="email" placeholder="Email" value="${escapeHtml(f.email)}" oninput="state.studentForm.email=this.value">
    </div>
    <div class="section-title">Meeting Type</div>
    <div class="chips-wrap">${(state.config.meetingTypes || []).map(opt => `
      <button class="chip ${f.type === opt.name ? 'selected' : ''}" onclick="state.studentForm.type='${opt.name}'; state.studentForm.duration=${opt.duration}; render();">${opt.name} (${opt.duration}m)</button>
    `).join('')}</div>
    ${f.type ? Object.keys(groupedSlots).sort().map(date => `
        <div style="margin-top:15px"><div style="font-weight:700;">${formatDate(date)}</div>
        <div class="chips-wrap">${groupedSlots[date].map(slot => {
            const end = calculateEndTime(slot.start, f.duration);
            return `<button class="chip ${f.slotId === slot.id ? 'selected' : ''}" onclick="state.studentForm.slotId='${slot.id}'; render();">${formatTime(slot.start)} – ${formatTime(end)}</button>`;
        }).join('')}</div></div>`).join('') : '<p style="color:gray; margin-top:20px;">Please select a meeting type.</p>'}
    <button class="btn btn-primary btn-full" style="margin-top:20px" ${(f.name && f.email && f.type && f.slotId) ? '' : 'disabled'} onclick="submitRequest()">Submit Request</button>
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
          <div><label class="field-label">Your Email</label><input type="email" placeholder="you@university.ac.uk" value="${esc(c.email)}" oninput="silentSave('config.email',this.value)"></div>
        </div>
        <div class="grid-2">
          <div><label class="field-label">Email Provider</label><select onchange="silentSave('config.emailProvider',this.value)">
            <option value="zoho" ${c.emailProvider==='zoho'?'selected':''}>Zoho Mail</option>
            <option value="gmail" ${c.emailProvider==='gmail'?'selected':''}>Gmail</option>
            <option value="outlook" ${c.emailProvider==='outlook'?'selected':''}>Outlook</option>
            <option value="mailto" ${c.emailProvider==='mailto'?'selected':''}>Other</option></select></div>
          <div><label class="field-label">Page Title</label><input type="text" value="${esc(c.title)}" oninput="silentSave('config.title',this.value)"></div>
        </div>
        <hr class="divider">
        <div class="section-title">Teams Link</div>
        <div class="personal-teams"><label class="field-label">Personal Teams Link</label><input type="text" value="${esc(c.teamsLink||'')}" oninput="silentSave('config.teamsLink',this.value)"></div>
        <hr class="divider">
        <div class="section-title">Auto-Email (EmailJS)</div>
        <div style="margin-bottom:16px"><label class="field-label">Public Key</label><input type="text" value="${esc(c.emailjsPublicKey||'')}" oninput="silentSave('config.emailjsPublicKey',this.value)"></div>
        <div class="grid-2">
          <div><label class="field-label">Service ID</label><input type="text" value="${esc(c.emailjsServiceId||'')}" oninput="silentSave('config.emailjsServiceId',this.value)"></div>
          <div><label class="field-label">Template ID</label><input type="text" value="${esc(c.emailjsTemplateId||'')}" oninput="silentSave('config.emailjsTemplateId',this.value)"></div>
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
      <div class="grid-2">
        <div><label class="field-label">Date</label><input type="date" oninput="state.newSlot.date=this.value"></div>
        <div><label class="field-label">Length</label>
          <select onchange="state.newSlot.slotLength=this.value">
            <option value="15">15 min</option>
            <option value="45"selected>45 min</option>
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
            <button class="btn btn-ghost" style="font-size:11px;" onclick="if(confirm('Remove day?')) state.slots.filter(s=>s.date==='${date}').forEach(s=>deleteSlot(s.id))">
              Remove Day
            </button>
          </div>
          <div class="chips-wrap" style="margin-top:10px;">
            ${grouped[date].sort((a,b)=>a.start.localeCompare(b.start)).map(s => {
              // Calculate the end time based on the default 45 min or a specific duration
              const endTime = calculateEndTime(s.start, 45); 
              return `
                <div class="chip" style="display:flex; align-items:center; gap:8px;">
                  ${formatTime(s.start)} – ${formatTime(endTime)}
                  <span style="cursor:pointer; color:red;" onclick="deleteSlot('${s.id}')">×</span>
                </div>`;
            }).join('')}
    </div>
  </div>`).join('')}
    </div>`;
  } else {
    sub = state.requests.length === 0 ? `<p>No requests yet.</p>` : state.requests.map(req => `
  <div class="request-card" style="border:1px solid #eee; padding:15px; border-radius:12px; margin-bottom:12px; background: white; position:relative;">
    <div style="position:absolute; top:15px; right:15px; background:#fff3e0; color:#ef6c00; padding:2px 8px; border-radius:6px; font-size:12px; font-weight:700;">
      ⏳ ${req.status.toUpperCase()}
    </div>
    
    <div style="font-weight:bold; font-size:16px;">${escapeHtml(req.name)}</div>
    <div style="color: #666; font-size: 14px; margin-bottom:10px;">${escapeHtml(req.email)}</div>
    
    <div style="font-size: 13px; color: #444; line-height: 1.6;">
      <strong>Type:</strong> ${escapeHtml(req.type)} | 
      <strong>Date:</strong> ${formatDate(req.slotDate)} | 
      <strong>Time:</strong> ${formatTime(req.slotStart)}
    </div>

    ${state.config.teamsLink ? `
      <div style="margin-top: 8px; font-size: 12px;">
        <strong>Teams Link:</strong> 
        <a href="${state.config.teamsLink}" target="_blank" style="color: #0078d4; text-decoration: none; word-break: break-all;">
          ${state.config.teamsLink}
        </a>
      </div>
    ` : ''}

    <div style="margin-top:15px; display:flex; gap:10px;">
      ${req.status === 'pending' ? `
        <button class="btn btn-primary" onclick="updateRequestStatus('${req.id}','approved')">Approve</button>
        <button class="btn btn-ghost" onclick="updateRequestStatus('${req.id}','denied')">Deny</button>
      ` : `
        ${req.status === 'approved' ? `<button class="btn btn-ghost" style="color:orange;" onclick="handleCancel('${req.id}')">Cancel</button>` : ''}
        <button class="btn btn-ghost" onclick="deleteRequest('${req.id}')">Delete</button>
      `}
    </div>
  </div>`).join('');
  }

  return `
    <div class="tabs sub-nav">
      <button class="tab ${state.adminTab==='config'?'active':''}" onclick="state.adminTab='config'; render();">⚙ Settings</button>
      <button class="tab ${state.adminTab==='slots'?'active':''}" onclick="state.adminTab='slots'; render();">📅 Availability</button>
      <button class="tab ${state.adminTab==='requests'?'active':''}" onclick="state.adminTab='requests'; render();">📨 Requests (${pc})</button>
    </div>
    ${sub}`;
}

// =============================================================================
// 5. HELPERS
// =============================================================================

function calculateEndTime(startTime, duration) {
  if (!startTime) return "";
  const [h, m] = startTime.split(':').map(Number);
  const d = new Date(); d.setHours(h); d.setMinutes(m + (parseInt(duration) || 45));
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}
function formatDate(d) { return new Date(d+'T00:00:00').toLocaleDateString('en-GB',{weekday:'short', day:'numeric', month:'short'}); }
function formatTime(t) { if(!t) return ""; const[h,m]=t.split(':'); const hr=parseInt(h); return`${hr%12||12}:${m} ${hr>=12?'PM':'AM'}`; }
function getTodayDateString() { return new Date().toISOString().split('T')[0]; }
function escapeHtml(s) { if(!s) return ""; const d=document.createElement('div'); d.textContent=s; return d.innerHTML; }
function showFlash(m) { state.flashMessage=m; render(); setTimeout(()=>{state.flashMessage=null;render();},3000); }

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