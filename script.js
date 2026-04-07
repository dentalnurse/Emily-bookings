/**
 * EMILY'S BOOKING SYSTEM
 * Includes: PIN Protection, Teams Integration, and Grouped Date Layout
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
    name: '', email: '', title: 'Book a Consultation', meetingLink: '',
    adminPin: '123456789',
    meetingTypes: [
      { name: 'Introduction Call', duration: 15 },
      { name: '1-to-1', duration: 45},
      { name: 'Professional Discussion', duration: 45 }
    ],
    emailjsPublicKey: '', emailjsServiceId: '', emailjsTemplateId: '',
  },

  slots: [],
  requests: [],
  studentForm: { name: '', email: '', type: '', duration: '', slotId: '', message: '' },
  hasSubmitted: false
};

// =============================================================================
// 2. DATABASE & LOGIC
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
  } catch (error) { console.error("Load error:", error); }
}

async function saveSettings() {
  await db.collection('settings').doc('config').set(state.config);
}

async function submitRequest() {
  const form = state.studentForm;
  const slot = state.slots.find(s => s.id === form.slotId);
  const newRequest = {
    name: form.name, email: form.email, type: form.type, duration: form.duration,
    slotDate: slot.date, slotStart: slot.start, slotEnd: slot.end,
    status: 'pending', submittedAt: new Date().toISOString()
  };
  await db.collection('requests').add(newRequest);
  state.hasSubmitted = true;
  render();
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
}

function renderStudentView() {
  if (state.hasSubmitted) return `<div class="card success-card"><h2>Request Sent!</h2><button class="btn btn-ghost" onclick="location.reload()">Back</button></div>`;
  
  const form = state.studentForm;
  
  // Group slots by date
  const groupedSlots = {};
  state.slots
    .filter(s => s.date >= getTodayDateString())
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
        ${state.config.meetingTypes.map(item => `
          <button class="chip ${form.type === item.name ? 'selected' : ''}" 
            onclick="state.studentForm.type='${item.name}'; state.studentForm.duration='${item.duration}'; render();">
            ${item.name} (${item.duration}m)
          </button>
        `).join('')}
      </div>

      <div class="section-title">Select a Time Slot *</div>
      ${!form.type ? '<p style="color:gray; font-size:14px;">Please select a meeting type first to see available times.</p>' : ''}
      
      ${Object.keys(groupedSlots).length === 0 ? '<p>No slots available.</p>' : 
        Object.keys(groupedSlots).sort().map(date => {
          // Only show slots if a type is selected, otherwise it's confusing
          if (!form.type) return ''; 

          return `
          <div style="margin-bottom:20px">
            <div style="font-weight:700; font-size:15px; margin-bottom:10px;">${formatDate(date)}</div>
            <div class="chips-wrap">
              ${groupedSlots[date].map(slot => {
                // DYNAMIC CALCULATION:
                // We take the slot start time and add the selected duration
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

/**
 * HELPER: Calculates end time based on start time (HH:mm) and duration (minutes)
 */
function calculateEndTime(startTime, durationMinutes) {
  const [hours, minutes] = startTime.split(':').map(Number);
  const date = new Date();
  date.setHours(hours);
  date.setMinutes(minutes + parseInt(durationMinutes));
  
  const newHours = String(date.getHours()).padStart(2, '0');
  const newMinutes = String(date.getMinutes()).padStart(2, '0');
  return `${newHours}:${newMinutes}`;
}

function renderAdminView() {
  const config = state.config;
  let subView = "";

  if (state.adminTab === 'config') {
    subView = `
      <div class="section-title">Security</div>
      <label class="field-label">Admin PIN</label>
      <input type="password" value="${config.adminPin}" oninput="state.config.adminPin=this.value; saveSettings();">
      <hr class="divider">
      <div class="section-title">Meeting Types</div>
      ${config.meetingTypes.map((type, index) => `
        <div class="admin-row" style="display:flex; gap:10px; margin-bottom:10px;">
          <input type="text" value="${type.name}" oninput="state.config.meetingTypes[${index}].name=this.value; saveSettings();" style="flex:2">
          <input type="number" value="${type.duration}" oninput="state.config.meetingTypes[${index}].duration=this.value; saveSettings();" style="flex:1">
          <button class="btn-danger" onclick="state.config.meetingTypes.splice(${index},1); saveSettings(); render();">×</button>
        </div>
      `).join('')}
      <button class="btn btn-ghost" onclick="state.config.meetingTypes.push({name:'New Type', duration:30}); render();">+ Add Type</button>
      <hr class="divider">
      <div class="section-title">Teams Link</div>
      <input type="text" value="${config.meetingLink}" oninput="state.config.meetingLink=this.value; saveSettings();">
    `;
  }

  return `
    <div class="tabs sub-nav">
      <button class="tab ${state.adminTab === 'config' ? 'active' : ''}" onclick="state.adminTab='config'; render();">Settings</button>
      <button class="tab ${state.adminTab === 'requests' ? 'active' : ''}" onclick="state.adminTab='requests'; render();">Requests</button>
    </div>
    <div class="card">${subView}</div>
  `;
}

// =============================================================================
// 4. HELPERS
// =============================================================================

function formatDate(d) { return new Date(d+'T00:00:00').toLocaleDateString('en-GB',{weekday:'short', day:'numeric', month:'short'}); }
function formatTime(t) { const[h,m]=t.split(':'); const hr=parseInt(h); return`${hr%12||12}:${m} ${hr>=12?'PM':'AM'}`; }
function getTodayDateString() { return new Date().toISOString().split('T')[0]; }
function escapeHtml(s) { const d=document.createElement('div'); d.textContent=s; return d.innerHTML; }
function showFlash(m) { state.flashMessage=m; render(); setTimeout(()=>{state.flashMessage=null;render();},3000); }

function setupEventListeners() {
  const logo = document.getElementById('logo-trigger');
  if (logo) {
    logo.replaceWith(logo.cloneNode(true)); // Clean listeners
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