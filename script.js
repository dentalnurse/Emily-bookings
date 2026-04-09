/**
 * EMILY'S BOOKING SYSTEM - VERSION 6.1
 * Includes: Meeting Type Manager UI, Persistent Inputs, 
 * and Enhanced Admin Request Cards with Teams Links.
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
  studentForm: { name: '', email: '', type: '', duration: 0, slotId: '', message: '' },
  hasSubmitted: false,
  newSlot: { date: '', start: '', end: '', slotLength: '45' },
  tempPin: '' 
};

// =============================================================================
// 2. EMAIL LOGIC
// =============================================================================

async function sendEmailNotification(requestData, status, reason = "") {
  // 1. Ensure 'message' is extracted here
  const { name, email, type, slotDate, slotStart, duration, message } = requestData;
  const teamsLink = state.config.teamsLink || "Link to follow";
  const formattedDate = formatDate(slotDate);
  const endTimeStr = calculateEndTime(slotStart, duration || 45);
  const formattedTime = `${formatTime(slotStart)} - ${formatTime(endTimeStr)}`;
  const dynamicSubject = `${type} at ${formattedTime} on ${formattedDate}`;

  let targetEmail = email; 
  let targetName = name;   
  let statusMessage = "";
  
  // 2. Format the student note safely
  const studentNote = (message && message.trim()) ? `\n\nStudent Message: ${message}` : "";

  if (status === 'approved') {
    statusMessage = `Hi ${name},\nYour booking for a ${type} at ${formattedTime} on ${formattedDate} is confirmed.\nPlease join here: ${teamsLink}\nLooking forward to speaking with you.\nBest regards,\nEmily Bremner`;
  } else if (status === 'denied') {
    statusMessage = `Hi ${name},\nYour booking request for ${type} on ${formattedDate} has been declined.\nBest regards,\nEmily Bremner`;
  } else if (status === 'cancelled') {
    statusMessage = `Hi ${name},\nApologies, I have had to cancel your ${type} on ${formattedDate}.\nReason: ${reason}.\nPlease feel free to rearrange.\nBest regards,\nEmily Bremner`;
  } else if (status === 'admin_alert') {
    targetEmail = state.config.email;
    targetName = state.config.name;
    statusMessage = `NEW REQUEST RECEIVED:\n\nFrom: ${name} (${email})\nType: ${type}\nWhen: ${formattedDate} at ${formattedTime}${studentNote}`;
  } // Removed the stray semicolon here

  // 3. DEFINE templateParams (This was missing in your shared snippet!)
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
    // 1. Update Database
    await reqRef.update({ status: newStatus });
    loadApplicationData(); 

    // 3. Send email in the background (don't make the user wait for 'await')
    sendEmailNotification(doc.data(), newStatus).catch(err => console.error("Email failed:", err));
  }}

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
  
  // 1. Save to Database
  await db.collection('requests').add(newRequest);
  
  // 2. TRIGGER THE EMAIL TO YOU
  // We don't use 'await' here so the student's screen 
  // updates immediately while the email sends in the background
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
    // 1. Update Database
    await reqRef.update({ status: 'cancelled' });
    loadApplicationData();
    // 3. Background email
    sendEmailNotification(doc.data(), 'cancelled', reason).catch(err => console.error("Email failed:", err));
  }
}

async function deleteRequest(requestId) {
  if (!confirm("Delete record?")) return;
  // Perform delete
  await db.collection('requests').doc(requestId).delete();
  // Refresh data
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
    const name = prompt("Enter meeting name (e.g. Revision Session):");
    const duration = prompt("Enter duration in minutes (e.g. 45):");
    if (name && duration) {
        if (!state.config.meetingTypes) state.config.meetingTypes = [];
        state.config.meetingTypes.push({ name: name, duration: parseInt(duration) });
        await db.collection('settings').doc('config').set(state.config);
        showFlash("Meeting Type Added");
        render();
    }
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
    // Basic validation to ensure HH:MM format
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
    // 1. Identify which meeting type we are editing
    const type = state.config.meetingTypes[index];
    
    // 2. Prompt for a new name and a new duration
    const newName = prompt("Edit Meeting Name:", type.name);
    const newDuration = prompt("Edit Duration (in minutes):", type.duration);
    
    // 3. Check if the user hit 'Cancel' or left it blank
    if (newName !== null && newDuration !== null) {
        // Update the local state first
        state.config.meetingTypes[index] = { 
            name: newName, 
            duration: parseInt(newDuration) 
        };
        
        // 4. Save the updated list back to Firestore
        await db.collection('settings').doc('config').set(state.config);
        
        // 5. Notify the user and refresh the screen
        showFlash("Meeting Type Updated");
        render(); 
    }
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

  // Validation Check for the button
  const isFormValid = f.name.trim().length > 0 && f.email.trim().length > 0 && f.type && f.slotId;

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
    <div class="chips-wrap">${(state.config.meetingTypes || []).map(opt => `
      <button class="chip ${f.type === opt.name ? 'selected' : ''}" onclick="state.studentForm.type='${opt.name}'; state.studentForm.duration=${opt.duration}; render();">${opt.name} (${opt.duration}m)</button>
    `).join('')}</div>
    ${f.type ? Object.keys(groupedSlots).sort().map(date => `
        <div style="margin-top:15px"><div style="font-weight:700;">${formatDate(date)}</div>
        <div class="chips-wrap">${groupedSlots[date].map(slot => {
            const end = calculateEndTime(slot.start, f.duration);
            return `<button class="chip ${f.slotId === slot.id ? 'selected' : ''}" onclick="state.studentForm.slotId='${slot.id}'; render();">${formatTime(slot.start)} – ${formatTime(end)}</button>`;
        }).join('')}</div></div>`).join('') : '<p style="color:gray; margin-top:20px;">Please select a meeting type.</p>'}
<div style="margin-top:20px;">
      <label class="field-label">Additional Message (Optional)</label>
      <textarea 
        placeholder="Anything else I should know before the meeting?" 
        style="width: 100%; padding: 12px; border: 1px solid #ddd; border-radius: 8px; font-family: inherit; resize: vertical;" 
        rows="3"
        oninput="state.studentForm.message=this.value"
      >${f.message || ''}</textarea>
    </div>

    <button 
      class="btn btn-primary btn-full" 
      style="margin-top:20px" 
      ${(f.name.trim() && f.email.trim() && f.type && f.slotId) ? '' : 'disabled'} 
      onclick="submitRequest()"
    >
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
          <div><label class="field-label">Your Email</label><input type="email" placeholder="you@university.ac.uk" value="${esc(c.email)}" oninput="silentSave('config.email',this.value)"></div>
        </div>
        <hr class="divider">
        <div class="section-title">Teams Link</div>
        <div class="personal-teams"><label class="field-label">Personal Teams Link</label><input type="text" value="${esc(c.teamsLink||'')}" oninput="silentSave('config.teamsLink',this.value)"></div>
        
        <hr class="divider">
        <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:10px;">
          <div class="section-title" style="margin:0;">Meeting Types</div>
          <button class="btn btn-primary" style="padding: 5px 12px; font-size:12px;" onclick="addMeetingType()">+ Add New</button>
        </div>
        <div style="background: #f9f9f9; padding: 10px; border-radius: 8px; margin-bottom: 20px; border: 1px solid #eee;">
          ${(c.meetingTypes || []).length === 0 ? '<p style="font-size:13px; color:#888; text-align:center;">No types added.</p>' : 
            c.meetingTypes.map((type, index) => `
            <div style="display:flex; justify-content:space-between; align-items:center; background:white; padding:10px; border-radius:6px; margin-bottom:8px; border:1px solid #eee;">
              <div><span style="font-weight:700;">${esc(type.name)}</span> <span style="font-size:12px; color:#666;">(${type.duration}m)</span></div>
              <div style="display:flex; gap:10px;">
                <button class="btn btn-ghost" style="color:blue; border:none; padding:0;" onclick="editMeetingType(${index})">Edit</button>
                <button class="btn btn-ghost" style="color:red; border:none; padding:0;" onclick="deleteMeetingType(${index})">Delete</button>
              </div>
            </div>
          `).join('')}
        </div>

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
            <option value="45" selected>45 min</option>
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
            ${grouped[date].sort((a,b)=>a.start.localeCompare(b.start)).map(s => `
                <div class="chip" style="display:flex; align-items:center; gap:8px;">
                  ${formatTime(s.start)} – ${formatTime(calculateEndTime(s.start, 45))}
                  <span style="cursor:pointer; color:red;" onclick="deleteSlot('${s.id}')">×</span>
                </div>`).join('')}
          </div>
        </div>`).join('')}
    </div>`;
  } else {
    sub = state.requests.length === 0 ? `<p>No requests yet.</p>` : state.requests.map(req => `
  <div class="request-card" style="border:1px solid #eee; padding:15px; border-radius:12px; margin-bottom:12px; background: white; position:relative;">
    <div style="position:absolute; top:15px; right:15px; background:#fff3e0; color:#ef6c00; padding:2px 8px; border-radius:6px; font-size:12px; font-weight:700;">
      ⏳ ${req.status.toUpperCase()}
    </div>
    
    <div style="font-weight:bold; font-size:16px;">${esc(req.name)}</div>
    <div style="color: #666; font-size: 14px; margin-bottom:10px;">${esc(req.email)}</div>
    
    <div style="font-size: 13px; color: #444; line-height: 1.6;">
      <strong>Type:</strong> ${esc(req.type)} | 
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