/**
 * EMILY'S BOOKING SYSTEM - FINAL VERSION
 * Features: meetingTypes Array, Request Status Management, and Slot Availability Logic
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
  adminTab: 'config',
  isLoaded: false,
  flashMessage: null,
  
  config: {
    name: '', 
    email: '', 
    title: 'Book a Consultation', 
    teamsLink: '',
    adminPin: '123456789',
    meetingTypes: [], // Reads Array of Maps from Firestore
  },

  slots: [],
  requests: [],
  studentForm: { name: '', email: '', type: '', duration: 0, slotId: '', message: '' },
  hasSubmitted: false,

  newSlot: { 
    date: '', 
    start: '', 
    end: '', 
    slotLength: '45' 
  }
};

// =============================================================================
// 2. DATABASE & LOGIC
// =============================================================================

async function loadApplicationData() {
  try {
    const configDoc = await db.collection('settings').doc('config').get();
    if (configDoc.exists) {
      Object.assign(state.config, configDoc.data());
    }

    const slotSnap = await db.collection('slots').get();
    state.slots = slotSnap.docs.map(doc => ({ id: doc.id, ...doc.data() }));

    const reqSnap = await db.collection('requests').orderBy('submittedAt', 'desc').get();
    state.requests = reqSnap.docs.map(doc => ({ id: doc.id, ...doc.data() }));

    state.isLoaded = true;
    render();
  } catch (error) { 
    console.error("Load error:", error); 
    state.isLoaded = true;
    render();
  }
}

async function generateSlots() {
  const ns = state.newSlot;
  if (!ns.date || !ns.start || !ns.end) return showFlash("Please fill all fields");

  const slotMin = parseInt(ns.slotLength);
  const buffer = 10;
  const [sh, sm] = ns.start.split(':').map(Number);
  const [eh, em] = ns.end.split(':').map(Number);
  
  let currentPos = sh * 60 + sm;
  const endPos = eh * 60 + em;
  let count = 0;

  while (currentPos + slotMin <= endPos) {
    const sH = String(Math.floor(currentPos / 60)).padStart(2, '0');
    const sM = String(currentPos % 60).padStart(2, '0');
    const endTotal = currentPos + slotMin;
    const eH = String(Math.floor(endTotal / 60)).padStart(2, '0');
    const eM = String(endTotal % 60).padStart(2, '0');

    const slotData = { date: ns.date, start: `${sH}:${sM}`, end: `${eH}:${eM}` };
    await db.collection('slots').add(slotData);
    currentPos = endTotal + buffer;
    count++;
  }
  showFlash(`Generated ${count} slots`);
  loadApplicationData(); // Refresh the list
}

async function deleteSlot(id) {
  if(!confirm("Delete this slot?")) return;
  await db.collection('slots').doc(id).delete();
  loadApplicationData();
}

async function updateRequestStatus(requestId, newStatus) {
  try {
    await db.collection('requests').doc(requestId).update({ status: newStatus });
    showFlash(`Request ${newStatus}`);
    await loadApplicationData(); // Refresh list and slot availability
  } catch (e) {
    showFlash("Error updating request");
  }
}

async function submitRequest() {
  const form = state.studentForm;
  const slot = state.slots.find(s => s.id === form.slotId);
  const newRequest = {
    name: form.name, email: form.email, type: form.type, duration: form.duration,
    slotId: form.slotId, // CRITICAL: Link the request to the specific slot ID
    slotDate: slot.date, slotStart: slot.start, slotEnd: slot.end,
    status: 'pending', submittedAt: new Date().toISOString()
  };
  await db.collection('requests').add(newRequest);
  state.hasSubmitted = true;
  await loadApplicationData(); // Refresh to hide the slot immediately
}

// =============================================================================
// 3. INTERFACE (Rendering)
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
    </div>
  `;

  if (state.adminUnlocked) {
    html += `
      <div class="tabs main-nav">
        <button class="tab ${state.view === 'admin' ? 'active' : ''}" onclick="state.view='admin'; render();">Admin</button>
        <button class="tab ${state.view === 'student' ? 'active' : ''}" onclick="state.view='student'; state.hasSubmitted=false; render();">Student View</button>
        <button class="tab" onclick="state.adminUnlocked=false; state.view='student'; render();">🔒 Lock</button>
      </div>
    `;
  }

  html += (state.view === 'admin') ? renderAdminView() : renderStudentView();
  app.innerHTML = html;
  setupEventListeners();

  html += `
      <div class="tabs sub-nav">
        <button class="tab ${state.adminTab === 'config' ? 'active' : ''}" onclick="state.adminTab='config'; render();">Settings</button>
        <button class="tab ${state.adminTab === 'slots' ? 'active' : ''}" onclick="state.adminTab='slots'; render();">Availability</button>
        <button class="tab ${state.adminTab === 'requests' ? 'active' : ''}" onclick="state.adminTab='requests'; render();">Requests</button>
      </div>`;
}

function renderStudentView() {
  if (state.hasSubmitted) return `<div class="card success-card"><h2>Request Sent!</h2><p>Your slot is now reserved pending approval.</p><button class="btn btn-ghost" onclick="location.reload()">Back</button></div>`;
  
  const form = state.studentForm;
  const groupedSlots = {};

  // LOGIC: Filter out slots that have 'pending' or 'approved' requests
  const unavailableSlotIds = state.requests
    .filter(req => req.status === 'pending' || req.status === 'approved')
    .map(req => req.slotId);

  state.slots
    .filter(s => s.date >= getTodayDateString() && !unavailableSlotIds.includes(s.id))
    .sort((a, b) => a.date.localeCompare(b.date) || a.start.localeCompare(b.start))
    .forEach(slot => {
      if (!groupedSlots[slot.date]) groupedSlots[slot.date] = [];
      groupedSlots[slot.date].push(slot);
    });

  return `
    <div class="card">
      <div class="section-title">Your Details</div>
      <div class="grid-2">
        <input type="text" placeholder="Name" value="${form.name}" oninput="state.studentForm.name=this.value">
        <input type="email" placeholder="Email" value="${form.email}" oninput="state.studentForm.email=this.value">
      </div>

      <div class="section-title">Meeting Type</div>
      <div class="chips-wrap">
        ${(state.config.meetingTypes || []).map(opt => `
          <button class="chip ${form.type === opt.name ? 'selected' : ''}" 
            onclick="state.studentForm.type='${opt.name}'; state.studentForm.duration=${opt.duration}; render();">
            ${opt.name} (${opt.duration}m)
          </button>
        `).join('')}
      </div>

      <div class="section-title">Select a Time Slot *</div>
      ${!form.type ? '<p style="color:gray; font-size:14px;">Please select a meeting type first.</p>' : ''}
      
      ${Object.keys(groupedSlots).length === 0 ? '<p style="color:gray;">No slots available.</p>' : 
        Object.keys(groupedSlots).sort().map(date => {
          if (!form.type) return ''; 
          return `
          <div style="margin-bottom:20px">
            <div style="font-weight:700; margin-bottom:10px;">${formatDate(date)}</div>
            <div class="chips-wrap">
              ${groupedSlots[date].map(slot => {
                const endTime = calculateEndTime(slot.start, form.duration);
                return `
                <button class="chip ${form.slotId === slot.id ? 'selected' : ''}" 
                  onclick="state.studentForm.slotId='${slot.id}'; render();">
                  ${formatTime(slot.start)} – ${formatTime(endTime)}
                </button>`;
              }).join('')}
            </div>
          </div>`;
        }).join('')
      }

      <button class="btn btn-primary btn-full" style="margin-top:20px"
        ${(form.name && form.email && form.type && form.slotId) ? '' : 'disabled'}
        onclick="submitRequest()">Submit Booking Request</button>
    </div>
  `;
}

function renderAdminView() {
  const config = state.config;
  let subView = "";

  if (state.adminTab === 'config') {
    subView = `
      <div class="section-title">Security</div>
      <label class="field-label">Admin PIN</label>
      <input type="password" value="${config.adminPin}" oninput="state.config.adminPin=this.value; db.collection('settings').doc('config').set(state.config);">
      <hr class="divider">
      <div class="section-title">Teams Link</div>
      <input type="text" value="${config.teamsLink || ''}" oninput="state.config.teamsLink=this.value; db.collection('settings').doc('config').set(state.config);">
    `;
  } else if (state.adminTab === 'requests') {
    if (state.requests.length === 0) {
      subView = `<p style="text-align:center; color:gray; padding:20px;">No requests found.</p>`;
    } else if (state.adminTab === 'slots') {
    subView = `
      <div class="section-title">Generate Availability</div>
      <div class="grid-2">
        <input type="date" oninput="state.newSlot.date=this.value" min="${getTodayDateString()}">
        <select onchange="state.newSlot.slotLength=this.value">
          <option value="15">15 min</option>
          <option value="30">30 min</option>
          <option value="45" selected>45 min</option>
        </select>
      </div>
      <div class="grid-2" style="margin-top:10px">
        <input type="time" oninput="state.newSlot.start=this.value">
        <input type="time" oninput="state.newSlot.end=this.value">
      </div>
      <button class="btn btn-primary btn-full" style="margin-top:10px" onclick="generateSlots()">+ Generate Slots</button>
      
      <hr class="divider">
      <div class="section-title">Current Slots</div>
      ${state.slots.map(s => `
        <div style="display:flex; justify-content:space-between; padding:5px; border-bottom:1px solid #eee;">
          <span>${s.date} (${s.start})</span>
          <button onclick="deleteSlot('${s.id}')" style="color:red; background:none; border:none; cursor:pointer;">Delete</button>
        </div>
      `).join('')}
    `;
  }else {
      subView = state.requests.map(req => `
        <div class="request-card" style="border:1px solid #eee; padding:15px; border-radius:8px; margin-bottom:10px; background: ${req.status === 'approved' ? '#f0fff4' : req.status === 'denied' ? '#fff5f5' : '#fff'}">
          <div style="display:flex; justify-content:space-between; align-items:flex-start;">
            <div>
              <div style="font-weight:bold;">${escapeHtml(req.name)}</div>
              <div style="font-size:13px; color:#666;">${escapeHtml(req.email)}</div>
            </div>
            <div style="font-size:10px; font-weight:bold; text-transform:uppercase; color:${req.status==='approved'?'green':req.status==='denied'?'red':'orange'}">${req.status}</div>
          </div>
          <div style="margin-top:10px; font-size:14px;">
            <strong>${escapeHtml(req.type)}</strong> • ${formatDate(req.slotDate)} @ ${formatTime(req.slotStart)}
          </div>
          ${req.status === 'pending' ? `
            <div style="margin-top:15px; display:flex; gap:10px;">
              <button class="btn btn-primary" style="padding:5px 15px; font-size:12px; background:green; border:none;" onclick="updateRequestStatus('${req.id}', 'approved')">Approve</button>
              <button class="btn btn-ghost" style="padding:5px 15px; font-size:12px; color:red; border:1px solid red;" onclick="updateRequestStatus('${req.id}', 'denied')">Deny</button>
            </div>
          ` : ''}
        </div>
      `).join('');
    }
  }

  return `
    <div class="tabs sub-nav">
      <button class="tab ${state.adminTab === 'config' ? 'active' : ''}" onclick="state.adminTab='config'; render();">Settings</button>
      <button class="tab ${state.adminTab === 'requests' ? 'active' : ''}" onclick="state.adminTab='requests'; render();">Requests</button>
    </div>
    <div class="card" style="max-height: 500px; overflow-y: auto;">${subView}</div>
  `;
}

function calculateEndTime(startTime, durationMinutes) {
  const [hours, minutes] = startTime.split(':').map(Number);
  const date = new Date();
  date.setHours(hours);
  date.setMinutes(minutes + parseInt(durationMinutes));
  return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
}

function formatDate(d) { return new Date(d+'T00:00:00').toLocaleDateString('en-GB',{weekday:'short', day:'numeric', month:'short'}); }
function formatTime(t) { const[h,m]=t.split(':'); const hr=parseInt(h); return`${hr%12||12}:${m} ${hr>=12?'PM':'AM'}`; }
function getTodayDateString() { return new Date().toISOString().split('T')[0]; }
function escapeHtml(s) { const d=document.createElement('div'); d.textContent=s; return d.innerHTML; }
function showFlash(m) { state.flashMessage=m; render(); setTimeout(()=>{state.flashMessage=null;render();},3000); }

function setupEventListeners() {
  const logo = document.getElementById('logo-trigger');
  if (logo) {
    logo.replaceWith(logo.cloneNode(true)); 
    document.getElementById('logo-trigger').addEventListener('click', (e) => {
      if (e.detail === 3) {
        const pin = prompt("Enter Admin PIN:");
        if (pin === state.config.adminPin) { state.adminUnlocked = true; state.view = 'admin'; render(); }
        else { showFlash("Incorrect PIN"); }
      }
    });
  }
}

loadApplicationData();