// ═══════════════════════════════════════════════════════════════════════
// Firebase
// ═══════════════════════════════════════════════════════════════════════
firebase.initializeApp({
  apiKey: "AIzaSyDiqeiZw162zVbLeDMJPZE-Yno1Zt7QOwM",
  authDomain: "emily-booking.firebaseapp.com",
  projectId: "emily-booking",
  storageBucket: "emily-booking.firebasestorage.app",
  messagingSenderId: "1086267558961",
  appId: "1:1086267558961:web:a0ccafeb3aee15932f1910",
});
const db = firebase.firestore();

// ═══════════════════════════════════════════════════════════════════════
// State
// ═══════════════════════════════════════════════════════════════════════
let state = {
  view: 'student',
  adminUnlocked: false,
  adminTab: 'config',
  config: {
    name: '', email: '', emailProvider: 'zoho', zoomLink: '',
    title: 'Book a Consultation',
    types: '1-to-1 Tutorial,Professional Discussion',
    durations: '15,30,45',
    emailjsPublicKey: '', emailjsServiceId: '', emailjsTemplateId: '',
  },
  slots: [],
  requests: [],
  studentForm: { name:'', email:'', type:'', slot:'', duration:'', message:'' },
  studentSubmitted: false,
  newSlot: { date:'', start:'', end:'', slotLength: '30' },
  flash: null,
  loaded: false,
};

// ═══════════════════════════════════════════════════════════════════════
// Firebase CRUD
// ═══════════════════════════════════════════════════════════════════════
async function loadFromFirebase() {
  try {
    const cd = await db.collection('settings').doc('config').get();
    if (cd.exists) state.config = { ...state.config, ...cd.data() };
    const ss = await db.collection('slots').get();
    state.slots = ss.docs.map(d => ({ id: d.id, ...d.data() }));
    const rs = await db.collection('requests').orderBy('submittedAt','desc').get();
    state.requests = rs.docs.map(d => ({ id: d.id, ...d.data() }));
  } catch (e) { console.error('Load error:', e); }
  state.loaded = true;
  render();
}

async function saveConfig() {
  try { await db.collection('settings').doc('config').set(state.config); } catch(e) { console.error(e); }
}

async function addSlotToDb(s) {
  try { const r = await db.collection('slots').add(s); return r.id; } catch(e) { console.error(e); return null; }
}

async function removeSlotFromDb(id) {
  try { await db.collection('slots').doc(id).delete(); } catch(e) { console.error(e); }
}

async function clearSlotsForDate(date) {
  try {
    const s = await db.collection('slots').where('date','==',date).get();
    const b = db.batch(); s.docs.forEach(d => b.delete(d.ref)); await b.commit();
  } catch(e) { console.error(e); }
}

async function clearAllSlotsDb() {
  try {
    const s = await db.collection('slots').get();
    const b = db.batch(); s.docs.forEach(d => b.delete(d.ref)); await b.commit();
  } catch(e) { console.error(e); }
}

async function addRequestToDb(r) {
  try { const ref = await db.collection('requests').add(r); return ref.id; } catch(e) { console.error(e); return null; }
}

async function updateRequestInDb(id, data) {
  try { await db.collection('requests').doc(id).update(data); } catch(e) { console.error(e); }
}

// ═══════════════════════════════════════════════════════════════════════
// Helpers
// ═══════════════════════════════════════════════════════════════════════
function fmtDate(d) { return new Date(d+'T00:00:00').toLocaleDateString('en-GB',{weekday:'short',day:'numeric',month:'short'}); }
function fmtTime(t) { const[h,m]=t.split(':');const hr=parseInt(h);return`${hr%12||12}:${m} ${hr>=12?'PM':'AM'}`; }
function genZoom() { return (state.config.zoomLink||'').trim() || `https://zoom.us/j/${Math.floor(1e9+Math.random()*9e9)}`; }

function openCompose(to,subj,body) {
  const p=state.config.emailProvider,s=encodeURIComponent(subj),b=encodeURIComponent(body);
  const u={
    zoho:`https://mail.zoho.com/zm/#/compose?to=${encodeURIComponent(to)}&subject=${s}&body=${b}`,
    gmail:`https://mail.google.com/mail/?view=cm&to=${encodeURIComponent(to)}&su=${s}&body=${b}`,
    outlook:`https://outlook.live.com/mail/0/deeplink/compose?to=${encodeURIComponent(to)}&subject=${s}&body=${b}`,
    mailto:`mailto:${to}?subject=${s}&body=${b}`,
  };
  window.open(u[p]||u.mailto,'_blank');
}

function sendEmailJS(to,subj,body) {
  const c=state.config;
  if(!c.emailjsPublicKey||!c.emailjsServiceId||!c.emailjsTemplateId) return Promise.resolve(false);
  return emailjs.send(c.emailjsServiceId,c.emailjsTemplateId,{
    to_email:to,subject:subj,message:body,from_name:c.name||'Booking System',
  },c.emailjsPublicKey).then(()=>true).catch(e=>{console.error('EmailJS:',e);return false;});
}

function flash(msg) { state.flash=msg;render();setTimeout(()=>{state.flash=null;render();},2500); }
function today() { return new Date().toISOString().split('T')[0]; }
function futureSlots() { const t=today();return state.slots.filter(s=>s.date>=t).sort((a,b)=>a.date.localeCompare(b.date)||a.start.localeCompare(b.start)); }
function types() { return state.config.types.split(',').map(s=>s.trim()).filter(Boolean); }
function durations() { return state.config.durations.split(',').map(s=>s.trim()).filter(Boolean); }
function pendingCount() { return state.requests.filter(r=>r.status==='pending').length; }
function update(c) { Object.assign(state,c);render(); }

function silentSave(path,val) {
  const p=path.split('.');let o=state;
  for(let i=0;i<p.length-1;i++) o=o[p[i]];
  o[p[p.length-1]]=val;
  if(path.startsWith('config.')) saveConfig();
}

function updateHeader() {
  const h=document.querySelector('.header h1'),s=document.querySelector('.header .subtitle');
  if(h) h.textContent=state.config.title||'Book a Consultation';
  if(s) s.textContent=state.config.name?'with '+state.config.name:'Set up your booking page';
}

function updateSubmitBtn() {
  const f=state.studentForm,b=document.getElementById('submit-btn');
  if(b) b.disabled=!(f.name&&f.email&&f.type&&f.slot&&f.duration);
}

function esc(s) { if(!s)return'';const d=document.createElement('div');d.textContent=s;return d.innerHTML; }

// ═══════════════════════════════════════════════════════════════════════
// Actions
// ═══════════════════════════════════════════════════════════════════════
async function addSlot() {
  const ns=state.newSlot;
  if(!ns.date||!ns.start||!ns.end||!ns.slotLength) return;
  const slotMin=parseInt(ns.slotLength),buffer=10;
  const[sh,sm]=ns.start.split(':').map(Number),[eh,em]=ns.end.split(':').map(Number);
  let cur=sh*60+sm;const endMin=eh*60+em;let added=0;

  while(cur+slotMin<=endMin){
    const sH=String(Math.floor(cur/60)).padStart(2,'0'),sM=String(cur%60).padStart(2,'0');
    const ec=cur+slotMin,eH=String(Math.floor(ec/60)).padStart(2,'0'),eM=String(ec%60).padStart(2,'0');
    const slot={date:ns.date,start:`${sH}:${sM}`,end:`${eH}:${eM}`};
    const id=await addSlotToDb(slot);
    if(id) state.slots.push({id,...slot});
    cur=ec+buffer;added++;
  }
  state.newSlot={date:'',start:'',end:'',slotLength:ns.slotLength};
  render();flash(added+' slot'+(added!==1?'s':'')+' added');
}

async function removeSlot(id) { await removeSlotFromDb(id);state.slots=state.slots.filter(s=>s.id!==id);render(); }

async function clearDay(date) { await clearSlotsForDate(date);state.slots=state.slots.filter(s=>s.date!==date);render(); }

async function clearAll() { if(!confirm('Clear all slots?'))return;await clearAllSlotsDb();state.slots=[];render(); }

async function approveRequest(id) {
  const r=state.requests.find(r=>r.id===id);if(!r)return;
  const zoom=genZoom();r.status='approved';r.zoomLink=zoom;
  await updateRequestInDb(id,{status:'approved',zoomLink:zoom});
  const subj=`Booking Confirmed: ${r.type} on ${fmtDate(r.slotDate)} at ${fmtTime(r.slotStart)}`;
  const body=`Hi ${r.name},\n\nYour ${r.type} has been confirmed.\n\nDate: ${fmtDate(r.slotDate)}\nTime: ${fmtTime(r.slotStart)} – ${fmtTime(r.slotEnd)}\nDuration: ${r.duration} minutes\n\nZoom Link: ${zoom}\n\nPlease join a few minutes early. Looking forward to speaking with you.\n\nBest regards,\n${state.config.name}`;
  sendEmailJS(r.email,subj,body).then(sent=>{
    if(sent)flash('Approved — email sent automatically');
    else{openCompose(r.email,subj,body);flash('Approved — compose opened');}
  });
  render();
}

async function declineRequest(id) {
  const r=state.requests.find(r=>r.id===id);if(!r)return;
  r.status='declined';
  await updateRequestInDb(id,{status:'declined'});
  const subj=`Booking Update: ${r.type} on ${fmtDate(r.slotDate)}`;
  const body=`Hi ${r.name},\n\nUnfortunately, I'm unable to accommodate your ${r.type} request for ${fmtDate(r.slotDate)} at ${fmtTime(r.slotStart)}.\n\nPlease feel free to book another available slot.\n\nBest regards,\n${state.config.name}`;
  sendEmailJS(r.email,subj,body).then(sent=>{
    if(sent)flash('Declined — email sent');
    else{openCompose(r.email,subj,body);flash('Declined — compose opened');}
  });
  render();
}

async function submitStudentRequest() {
  const f=state.studentForm,slot=state.slots.find(s=>s.id===f.slot);
  if(!slot||!f.name||!f.email||!f.type||!f.duration) return;
  const req={name:f.name,email:f.email,type:f.type,duration:f.duration,slotDate:slot.date,slotStart:slot.start,slotEnd:slot.end,message:f.message,status:'pending',submittedAt:new Date().toISOString(),zoomLink:null};
  const id=await addRequestToDb(req);
  if(id) state.requests.unshift({id,...req});
  if(state.config.email){
    const subj=`New Booking Request: ${req.type} from ${req.name}`;
    const body=`New booking request received:\n\nStudent: ${req.name} (${req.email})\nType: ${req.type}\nDuration: ${req.duration} min\nRequested Slot: ${fmtDate(req.slotDate)}, ${fmtTime(req.slotStart)} – ${fmtTime(req.slotEnd)}\nMessage: ${req.message||'(none)'}\n\nPlease log in to your booking dashboard to approve or decline.`;
    sendEmailJS(state.config.email,subj,body);
  }
  state.studentSubmitted=true;render();
}

// ═══════════════════════════════════════════════════════════════════════
// Render
// ═══════════════════════════════════════════════════════════════════════
function render() {
  const app=document.getElementById('app');
  if(!state.loaded) return;
  const c=state.config,pc=pendingCount(),fs=futureSlots(),sf=state.studentForm;
  let html='';

  if(state.flash) html+=`<div class="flash">${state.flash}</div>`;

  html+=`<div class="header"><div class="logo" id="logo">B</div>
    <h1>${esc(c.title||'Book a Consultation')}</h1>
    <p class="subtitle">${c.name?'with '+esc(c.name):'Set up your booking page'}</p></div>`;

  if(state.adminUnlocked){
    html+=`<div class="tabs" style="max-width:380px;margin:0 auto 28px">
      <button class="tab ${state.view==='admin'?'active':''}" onclick="update({view:'admin'})">Admin</button>
      <button class="tab ${state.view==='student'?'active':''}" onclick="state.studentSubmitted=false;update({view:'student'})">Student View</button>
      <button class="tab" onclick="update({adminUnlocked:false,view:'student'})">🔒 Lock</button></div>`;
  }

  // ═══ ADMIN ═══
  if(state.view==='admin'&&state.adminUnlocked){
    html+=`<div class="tabs">
      <button class="tab ${state.adminTab==='config'?'active':''}" onclick="update({adminTab:'config'})">⚙ Settings</button>
      <button class="tab ${state.adminTab==='slots'?'active':''}" onclick="update({adminTab:'slots'})">📅 Availability</button>
      <button class="tab ${state.adminTab==='requests'?'active':''}" onclick="update({adminTab:'requests'})">📨 Requests${pc?' ('+pc+')':''}</button></div>`;

    // Config
    if(state.adminTab==='config'){
      html+=`<div class="card">
        <div class="section-title">Your Details</div>
        <div class="grid-2">
          <div><label class="field-label">Your Name</label><input type="text" placeholder="Dr. Smith" value="${esc(c.name)}" oninput="silentSave('config.name',this.value)" onblur="updateHeader()"></div>
          <div><label class="field-label">Your Email</label><input type="email" placeholder="you@university.ac.uk" value="${esc(c.email)}" oninput="silentSave('config.email',this.value)"></div>
        </div>
        <div class="grid-2">
          <div><label class="field-label">Email Provider (fallback)</label><select onchange="silentSave('config.emailProvider',this.value)">
            <option value="zoho" ${c.emailProvider==='zoho'?'selected':''}>Zoho Mail</option>
            <option value="gmail" ${c.emailProvider==='gmail'?'selected':''}>Gmail</option>
            <option value="outlook" ${c.emailProvider==='outlook'?'selected':''}>Outlook</option>
            <option value="mailto" ${c.emailProvider==='mailto'?'selected':''}>Other</option></select></div>
          <div><label class="field-label">Page Title</label><input type="text" value="${esc(c.title)}" oninput="silentSave('config.title',this.value)" onblur="updateHeader()"></div>
        </div>
        <hr class="divider">
        <div class="section-title">Booking Options</div>
        <div style="margin-bottom:16px"><label class="field-label">Meeting Types (comma-separated)</label><input type="text" placeholder="1-to-1 Tutorial, Professional Discussion" value="${esc(c.types)}" oninput="silentSave('config.types',this.value)"></div>
        <div style="margin-bottom:16px"><label class="field-label">Duration Options in minutes (comma-separated)</label><input type="text" placeholder="15, 30, 45" value="${esc(c.durations)}" oninput="silentSave('config.durations',this.value)"></div>
        <div class="personal-zoom"><label class="field-label">Personal Zoom Link (optional)</label><input type="text" placeholder="https://zoom.us/j/your-meeting-id" value="${esc(c.zoomLink||'')}" oninput="silentSave('config.zoomLink',this.value)"></div>
        <hr class="divider">
        <div class="section-title">Auto-Email (EmailJS)</div>
        <p style="color:var(--text-soft);font-size:13px;margin-bottom:16px;line-height:1.5">Sends emails automatically. Free = 200/month.</p>
        <div style="margin-bottom:16px"><label class="field-label">Public Key</label><input type="text" placeholder="e.g. xK3mN9pQ2..." value="${esc(c.emailjsPublicKey||'')}" oninput="silentSave('config.emailjsPublicKey',this.value)"></div>
        <div class="grid-2">
          <div><label class="field-label">Service ID</label><input type="text" placeholder="e.g. service_abc123" value="${esc(c.emailjsServiceId||'')}" oninput="silentSave('config.emailjsServiceId',this.value)"></div>
          <div><label class="field-label">Template ID</label><input type="text" placeholder="e.g. template_xyz789" value="${esc(c.emailjsTemplateId||'')}" oninput="silentSave('config.emailjsTemplateId',this.value)"></div>
        </div>
        ${(c.emailjsPublicKey&&c.emailjsServiceId&&c.emailjsTemplateId)?'<div style="margin-top:12px"><span class="badge badge-green">✓ EmailJS connected</span></div>':'<div style="margin-top:12px"><span class="badge badge-amber">⏳ Not configured</span></div>'}
        <div class="notice"><strong>EmailJS Setup:</strong><br>1. <a href="https://www.emailjs.com" target="_blank">emailjs.com</a> → sign up<br>2. Email Services → Add → connect Zoho → copy <strong>Service ID</strong><br>3. Email Templates → Create → To: <code>{{to_email}}</code>, Subject: <code>{{subject}}</code>, Body: <code>{{message}}</code> → copy <strong>Template ID</strong><br>4. Account → copy <strong>Public Key</strong></div>
      </div>`;
    }

    // Slots
    if(state.adminTab==='slots'){
      html+=`<div class="card">
        <div class="section-title">Add Availability</div>
        <p style="color:var(--text-soft);font-size:13px;margin-bottom:16px;line-height:1.5">Pick a date and time range. Slots auto-generate with 10-min buffers between each.</p>
        <div class="grid-2">
          <div><label class="field-label">Date</label><input type="date" value="${state.newSlot.date}" min="${today()}" oninput="state.newSlot.date=this.value"></div>
          <div><label class="field-label">Slot Length</label><select onchange="state.newSlot.slotLength=this.value">
            <option value="15" ${state.newSlot.slotLength==='15'?'selected':''}>15 min</option>
            <option value="20" ${state.newSlot.slotLength==='20'?'selected':''}>20 min</option>
            <option value="30" ${state.newSlot.slotLength==='30'?'selected':''}>30 min</option>
            <option value="45" ${state.newSlot.slotLength==='45'?'selected':''}>45 min</option>
            <option value="60" ${state.newSlot.slotLength==='60'?'selected':''}>60 min</option></select></div>
        </div>
        <div class="row" style="margin-bottom:16px">
          <div style="flex:1;min-width:120px"><label class="field-label">Day Starts</label><input type="time" value="${state.newSlot.start}" oninput="state.newSlot.start=this.value"></div>
          <div style="flex:1;min-width:120px"><label class="field-label">Day Ends</label><input type="time" value="${state.newSlot.end}" oninput="state.newSlot.end=this.value"></div>
          <button class="btn btn-primary" onclick="addSlot()">+ Generate Slots</button>
        </div>
        <hr class="divider">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px">
          <div class="section-title" style="margin-bottom:0">Your Slots (${fs.length})</div>
          ${fs.length>0?'<button class="btn btn-danger" style="font-size:12px;padding:6px 14px" onclick="clearAll()">Clear All</button>':''}
        </div>`;
      if(fs.length===0){
        html+=`<div class="empty"><div class="icon">📅</div><p>No slots yet.</p></div>`;
      } else {
        const bd={};fs.forEach(s=>{if(!bd[s.date])bd[s.date]=[];bd[s.date].push(s);});
        Object.keys(bd).sort().forEach(date=>{
          html+=`<div style="margin-bottom:16px"><div style="font-weight:700;font-size:14px;margin-bottom:8px;display:flex;justify-content:space-between;align-items:center"><span>${fmtDate(date)}</span><button class="btn btn-danger" style="font-size:11px;padding:4px 10px" onclick="clearDay('${date}')">Remove Day</button></div><div class="chips-wrap">`;
          bd[date].forEach(s=>{html+=`<div class="chip"><span style="font-weight:500">${fmtTime(s.start)} – ${fmtTime(s.end)}</span><span class="remove" onclick="removeSlot('${s.id}')">×</span></div>`;});
          html+=`</div></div>`;
        });
      }
      html+=`</div>`;
    }

    // Requests
    if(state.adminTab==='requests'){
      html+=`<div class="card"><div class="section-title">Booking Requests</div>`;
      if(state.requests.length===0){
        html+=`<div class="empty"><div class="icon">📨</div><p>No requests yet.</p></div>`;
      } else {
        state.requests.forEach(r=>{
          const bc=r.status==='pending'?'badge-amber':r.status==='approved'?'badge-green':'badge-red';
          const bl=r.status==='pending'?'⏳ Pending':r.status==='approved'?'✓ Approved':'✕ Declined';
          html+=`<div class="request-card"><div class="request-header"><div><div style="font-weight:700;font-size:16px">${esc(r.name)}</div><div style="color:var(--text-soft);font-size:13px">${esc(r.email)}</div></div><span class="badge ${bc}">${bl}</span></div>
            <div class="request-meta"><span><strong>Type:</strong> ${esc(r.type)}</span><span><strong>Date:</strong> ${fmtDate(r.slotDate)}</span><span><strong>Time:</strong> ${fmtTime(r.slotStart)} – ${fmtTime(r.slotEnd)}</span><span><strong>Duration:</strong> ${r.duration} min</span></div>`;
          if(r.message) html+=`<div class="request-message">"${esc(r.message)}"</div>`;
          if(r.status==='approved'&&r.zoomLink) html+=`<div class="zoom-link">Zoom: <a href="${esc(r.zoomLink)}" target="_blank">${esc(r.zoomLink)}</a></div>`;
          if(r.status==='pending') html+=`<div class="btn-row"><button class="btn btn-success" onclick="approveRequest('${r.id}')">✓ Approve & Send Zoom</button><button class="btn btn-danger" onclick="declineRequest('${r.id}')">✕ Decline</button></div>`;
          html+=`</div>`;
        });
      }
      html+=`</div>`;
    }
  }

  // ═══ STUDENT ═══
  if(state.view==='student'){
    if(state.studentSubmitted){
      html+=`<div class="card success-card"><div class="success-icon">✓</div><h2>Request Submitted</h2>
        <p>${c.name||'Your tutor'} will review your request and send a confirmation with a Zoom link once approved.</p>
        <button class="btn btn-ghost" onclick="state.studentSubmitted=false;state.studentForm={name:'',email:'',type:'',slot:'',duration:'',message:''};render()">Book Another</button></div>`;
    } else {
      html+=`<div class="card">`;
      if(!c.name) html+=`<div class="notice notice-warn">This booking page hasn't been fully set up yet. Please check back later.</div>`;

      html+=`<div class="section-title">Your Details</div>
        <div class="grid-2">
          <div><label class="field-label">Your Name *</label><input type="text" placeholder="Jane Doe" value="${esc(sf.name)}" oninput="silentSave('studentForm.name',this.value);updateSubmitBtn()"></div>
          <div><label class="field-label">Your Email *</label><input type="email" placeholder="jane@uni.ac.uk" value="${esc(sf.email)}" oninput="silentSave('studentForm.email',this.value);updateSubmitBtn()"></div>
        </div>`;

      html+=`<div class="section-title">Meeting Type *</div><div class="chips-wrap">`;
      types().forEach(t=>{html+=`<button class="chip ${sf.type===t?'selected':''}" onclick="state.studentForm.type='${esc(t)}';render()">${esc(t)}</button>`;});
      html+=`</div>`;

      html+=`<div class="section-title">Duration *</div><div class="chips-wrap">`;
      durations().forEach(d=>{html+=`<button class="chip ${sf.duration===d?'selected':''}" onclick="state.studentForm.duration='${d}';render()">${d} min</button>`;});
      html+=`</div>`;

      html+=`<div class="section-title">Select a Time Slot *</div>`;
      if(fs.length===0){
        html+=`<div class="empty"><p>No available slots at the moment. Please check back later.</p></div>`;
      } else {
        const bd={};fs.forEach(s=>{if(!bd[s.date])bd[s.date]=[];bd[s.date].push(s);});
        Object.keys(bd).sort().forEach(date=>{
          html+=`<div style="margin-bottom:16px"><div style="font-weight:600;font-size:14px;margin-bottom:8px;color:var(--text)">${fmtDate(date)}</div><div class="chips-wrap">`;
          bd[date].forEach(s=>{html+=`<button class="chip ${sf.slot===s.id?'selected':''}" onclick="state.studentForm.slot='${s.id}';render()">${fmtTime(s.start)} – ${fmtTime(s.end)}</button>`;});
          html+=`</div></div>`;
        });
      }

      html+=`<div class="section-title">Message (optional)</div>
        <textarea placeholder="What would you like to discuss?" oninput="silentSave('studentForm.message',this.value)">${esc(sf.message)}</textarea>`;

      const ok=sf.name&&sf.email&&sf.type&&sf.slot&&sf.duration;
      html+=`<div style="margin-top:24px"><button class="btn btn-primary btn-full" id="submit-btn" ${ok?'':"disabled"} onclick="submitStudentRequest()">Submit Booking Request</button></div></div>`;
    }
  }

  html+=`<div class="footer">Powered by your booking dashboard</div>`;
  app.innerHTML=html;

  const logo=document.getElementById('logo');
  if(logo) logo.addEventListener('click',function(e){
    if(e.detail===3){state.adminUnlocked=true;state.view='admin';render();flash('Admin mode unlocked');}
  });
}

// Boot
loadFromFirebase();