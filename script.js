/**
 * EMILY'S BOOKING SYSTEM - VERSION 5.0
 * Fixes: Start/End time display on buttons and duration persistence for emails.
 */

// =============================================================================
// 1. DATA & INITIALIZATION
// =============================================================================
firebase.initializeApp({
  apiKey: "AIzaSyDiqeiZw162zVbLeDMJPZE-Yno1Zt7QOwM",
  authDomain: "emily-booking.firebaseapp.com",
  projectId: "emily-booking",
  storageBucket: "emily-booking.firebasestorage.app",
  messagingSenderId: "1086267558961",
  appId: "1:1086267558961:web:a0ccafeb3aee15932f1910",
});
const db = firebase.firestore();

let state = {
  view: 'student',
  adminUnlocked: false,
  adminTab: 'requests',
  isLoaded: false,
  flashMessage: null,
  config: {
    name: '', email: '', title: 'Book a Consultation', teamsLink: '', adminPin: '123456789',
    meetingTypes: [], emailjsServiceId: '', emailjsTemplateId: '', emailjsPublicKey: ''
  },
  slots: [],
  requests: [],
  studentForm: { name: '', email: '', type: '', duration: 0, slotId: '' },
  hasSubmitted: false,
  newSlot: { date: '', start: '', end: '', slotLength: '45' }
};

// =============================================================================
// 2. EMAIL NOTIFICATION LOGIC
// =============================================================================

async function sendEmailNotification(requestData, status, reason = "") {
  const { name, email, type, slotDate, slotStart, duration } = requestData;
  const teamsLink = state.config.teamsLink || "Link to follow";
  const formattedDate = formatDate(slotDate);
  
  // Use the stored duration or fallback to 45
  const endTimeStr = calculateEndTime(slotStart, duration || 45);
  const formattedTime = `${formatTime(slotStart)} - ${formatTime(endTimeStr)}`;

  let statusMessage = "";
  if (status === 'approved') {
    statusMessage = `Your booking is confirmed for ${formattedDate} at ${formattedTime}. Join here: ${teamsLink}`;
  } else if (status === 'denied') {
    statusMessage = `Your booking request for ${type} on ${formattedDate} has been declined.`;
  } else if (status === 'cancelled') {
    statusMessage = `Your appointment for ${type} on ${formattedDate} has been cancelled. Reason: ${reason}`;
  }

  const templateParams = {
    to_name: name,
    to_email: email,
    meeting_type: type,
    status: status.toUpperCase(),
    date: formattedDate,
    time: formattedTime,
    teams_link: status === 'approved' ? teamsLink : "N/A",
    message: statusMessage
  };

  try {
    if (!state.config.emailjsServiceId || !state.config.emailjsPublicKey) return;
    await emailjs.send(state.config.emailjsServiceId, state.config.emailjsTemplateId, templateParams, state.config.emailjsPublicKey);
  } catch (error) {
    console.error("Email failed:", error);
  }
}

// =============================================================================
// 3. DATABASE & LOGIC
// =============================================================================

async function loadApplicationData() {
  try {
    const configDoc = await db.collection('settings').doc('config').get();
    if (configDoc.exists) Object.assign(state.config, configDoc.data());
    
    const slotSnap = await db.collection('slots').get();
    state.slots = slotSnap.docs.map(doc => ({ id: doc.id, ...doc.data() }));
    
    const reqSnap = await db.collection('requests').orderBy('submittedAt', 'desc').get();
    state.requests = reqSnap.docs.map(doc => ({ id: doc.id, ...doc.data() }));
    
    state.isLoaded = true;
    render();
  } catch (error) { 
    state.isLoaded = true; render(); 
  }
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

async function handleCancel(requestId) {
  const reason = prompt("Enter reason for cancellation:");
  if (reason === null) return; 

  const reqRef = db.collection('requests').doc(requestId);
  const doc = await reqRef.get();
  if (doc.exists) {
    await sendEmailNotification(doc.data(), 'cancelled', reason);
    await reqRef.update({ status: 'cancelled' });
    showFlash("Cancelled & student notified");
    loadApplicationData();
  }
}

async function deleteRequest(requestId) {
  if (!confirm("Delete record permanently?")) return;
  await db.collection('requests').doc(requestId).delete();
  loadApplicationData();
}

async function generateSlots() {
  const ns = state.newSlot;
  if (!ns.date || !ns.start || !ns.end) return showFlash("Fill all fields");
  const slotMin = parseInt(ns.slotLength);
  const [sh, sm] = ns.start.split(':').map(Number);
  const [eh, em] = ns.end.split(':').map(Number);
  let currentPos = sh * 60 + sm;
  const endPos = eh * 60 + em;
  while (currentPos + slotMin <= endPos) {
    const sH = String(Math.floor(currentPos / 60)).padStart(2, '0');
    const sM = String(currentPos % 60).padStart(2, '0');
    await db.collection('slots').add({ date: ns.date, start: `${sH}:${sM}` });
    currentPos += (slotMin + 10);
  }
  loadApplicationData();
}

async function deleteSlot(id) {
  if(!confirm("Delete?")) return;
  await db.collection('slots').doc(id).delete();
  loadApplicationData();
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
  state.hasSubmitted = true;
  render();
}

// =============================================================================
// 4. INTERFACE
// =============================================================================

function render() {
  const app = document.getElementById('app');
  if (!state.isLoaded) { app.innerHTML = `<div class="loading">Loading...</div>`; return; }
  let html = state.flashMessage ? `<div class="flash">${state.flashMessage}</div>` : "";
  html += `<div class="header"><div class="logo" id="logo-trigger">B</div><h1>${escapeHtml(state.config.title)}</h1><p class="subtitle">with ${escapeHtml(state.config.name)}</p></div>`;
  
  if (state.adminUnlocked) {
    html += `<div class="tabs main-nav">
      <button class="tab ${state.view === 'admin' ? 'active' : ''}" onclick="state.view='admin'; render();">Admin</button>
      <button class="tab ${state.view === 'student' ? 'active' : ''}" onclick="state.view='student'; state.hasSubmitted=false; render();">Student View</button>
    </div>`;
  }
  html += (state.view === 'admin') ? renderAdminView() : renderStudentView();
  app.innerHTML = html;
  setupEventListeners();
}

function renderStudentView() {
  if (state.hasSubmitted) return `<div class="card success-card"><h2>Request Sent!</h2><p>Check email for confirmation.</p><button class="btn btn-ghost" onclick="location.reload()">Back</button></div>`;
  
  const form = state.studentForm;
  const groupedSlots = {};
  const unavailableIds = state.requests.filter(r => r.status === 'pending' || r.status === 'approved').map(r => r.slotId);

  state.slots.filter(s => s.date >= getTodayDateString() && !unavailableIds.includes(s.id))
    .sort((a,b) => a.date.localeCompare(b.date) || a.start.localeCompare(b.start))
    .forEach(s => { if(!groupedSlots[s.date]) groupedSlots[s.date] = []; groupedSlots[s.date].push(s); });

  return `<div class="card">
    <div class="grid-2">
      <input type="text" placeholder="Name" value="${escapeHtml(form.name)}" oninput="state.studentForm.name=this.value">
      <input type="email" placeholder="Email" value="${escapeHtml(form.email)}" oninput="state.studentForm.email=this.value">
    </div>
    <div class="section-title">Meeting Type</div>
    <div class="chips-wrap">${(state.config.meetingTypes || []).map(opt => `
      <button class="chip ${form.type === opt.name ? 'selected' : ''}" onclick="state.studentForm.type='${opt.name}'; state.studentForm.duration=${opt.duration}; render();">${opt.name} (${opt.duration}m)</button>
    `).join('')}</div>
    
    ${form.type ? Object.keys(groupedSlots).sort().map(date => `
        <div style="margin-top:15px"><div style="font-weight:700;">${formatDate(date)}</div><div class="chips-wrap">
          ${groupedSlots[date].map(slot => {
            const end = calculateEndTime(slot.start, form.duration);
            return `<button class="chip ${form.slotId === slot.id ? 'selected' : ''}" onclick="state.studentForm.slotId='${slot.id}'; render();">${formatTime(slot.start)} – ${formatTime(end)}</button>`;
          }).join('')}
        </div></div>`).join('') : '<p style="color:gray; margin-top:20px;">Please select a meeting type.</p>'}
    
    <button class="btn btn-primary btn-full" style="margin-top:20px" ${(form.name && form.email && form.type && form.slotId) ? '' : 'disabled'} onclick="submitRequest()">Submit Request</button>
  </div>`;
}

function renderAdminView() {
  const pendingCount = state.requests.filter(r => r.status === 'pending').length;
  let sub = "";
  if (state.adminTab === 'config') {
    sub = `<div class="section-title">Settings</div>
           <label class="field-label">Teams Link</label>
           <input type="text" value="${state.config.teamsLink}" oninput="state.config.teamsLink=this.value; db.collection('settings').doc('config').set(state.config);">`;
  } else if (state.adminTab === 'slots') {
    sub = `<div class="grid-2"><input type="date" value="${state.newSlot.date}" oninput="state.newSlot.date=this.value"><input type="time" oninput="state.newSlot.start=this.value"></div>
           <button class="btn btn-primary btn-full" onclick="generateSlots()">+ Generate</button>
           <div style="margin-top:20px; max-height:200px; overflow:auto;">
             ${state.slots.map(s => `<div>${s.date} ${s.start} <button onclick="deleteSlot('${s.id}')">X</button></div>`).join('')}
           </div>`;
  } else {
    sub = state.requests.length === 0 ? `<p>No requests.</p>` : state.requests.map(req => `
      <div class="request-card" style="border:1px solid #eee; padding:12px; border-radius:8px; margin-bottom:10px; background:${req.status==='approved'?'#f0fff4':req.status==='denied'?'#fff5f5':'#fff'}">
        <div style="font-weight:bold;">${escapeHtml(req.name)} <span style="font-size:11px; float:right; color:#888;">${req.status.toUpperCase()}</span></div>
        <div style="font-size:13px;">${escapeHtml(req.type)} • ${formatDate(req.slotDate)} @ ${formatTime(req.slotStart)}</div>
        <div style="margin-top:10px; display:flex; gap:8px;">
          ${req.status === 'pending' ? `
            <button class="btn btn-primary" style="background:green; border:none; padding:5px 10px;" onclick="updateRequestStatus('${req.id}','approved')">Approve</button>
            <button class="btn btn-ghost" style="color:red; border-color:red; padding:5px 10px;" onclick="updateRequestStatus('${req.id}','denied')">Deny</button>
          ` : ''}
          ${req.status === 'approved' ? `<button class="btn btn-ghost" style="color:orange; border-color:orange; padding:5px 10px;" onclick="handleCancel('${req.id}')">Cancel</button>` : ''}
          ${(req.status !== 'pending') ? `<button class="btn btn-ghost" style="color:#666; padding:5px 10px;" onclick="deleteRequest('${req.id}')">Delete</button>` : ''}
        </div>
      </div>`).join('');
  }
  return `<div class="tabs sub-nav">
    <button class="tab ${state.adminTab==='config'?'active' : ''}" onclick="state.adminTab='config'; render();">Settings</button>
    <button class="tab ${state.adminTab==='slots'?'active' : ''}" onclick="state.adminTab='slots'; render();">Slots</button>
    <button class="tab ${state.adminTab==='requests'?'active' : ''}" onclick="state.adminTab='requests'; render();">Requests (${pendingCount})</button>
  </div><div class="card">${sub}</div>`;
}

// =============================================================================
// 5. HELPERS
// =============================================================================

function calculateEndTime(startTime, duration) {
  if (!startTime) return "";
  const [h, m] = startTime.split(':').map(Number);
  const d = new Date(); d.setHours(h); d.setMinutes(m + (parseInt(duration) || 45));
  const newH = String(d.getHours()).padStart(2, '0');
  const newM = String(d.getMinutes()).padStart(2, '0');
  return `${newH}:${newM}`;
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
        const pin = prompt("PIN:");
        if (pin === state.config.adminPin) { state.adminUnlocked = true; state.view = 'admin'; render(); }
      }
    });
  }
}

loadApplicationData();