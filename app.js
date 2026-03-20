/* =========================================================
   Danışan Ağı — Supabase Entegrasyonlu Yönetim Paneli
   Roller: Admin, Uzman (Expert), Danışan (Client)
   ========================================================= */

/* global supabase */

// ==================== SUPABASE CLIENT ====================
var SUPABASE_URL = "https://zolgyykgbibamtezfpnl.supabase.co";
var SUPABASE_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InpvbGd5eWtnYmliYW10ZXpmcG5sIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzI4MDYwODMsImV4cCI6MjA4ODM4MjA4M30.zJvvb0Hsza3OOXKAe5wU1jHbbFe0UoVkvOtgJI7fw6Q";

var sb = supabase.createClient(SUPABASE_URL, SUPABASE_KEY);
var currentUser = null;
var currentProfile = null;
var editingId = null;
var pendingFile = null; // dosya paylaşımı için bekleyen dosya

// ==================== INIT ====================
(function init() {
  checkSession();
})();

function showScreen(id) {
  ["loginScreen", "appShell"].forEach(function(s) {
    var el = document.getElementById(s);
    if (s === id) {
      if (s === "appShell") { el.classList.add("active"); el.style.display = ""; }
      else el.style.display = "flex";
    } else {
      if (s === "appShell") { el.classList.remove("active"); }
      else el.style.display = "none";
    }
  });
}

function showConfigScreen() {
  showScreen("configScreen");
}

async function checkSession() {
  try {
    var result = await sb.auth.getSession();
    var session = result.data.session;
    if (session) {
      currentUser = session.user;
      await loadProfile();
      showApp();
    } else {
      showScreen("loginScreen");
    }
  } catch (e) {
    showScreen("loginScreen");
  }
}

// ==================== LOGIN / LOGOUT ====================
// ==================== LOGIN LOG SYSTEM ====================
var _cachedIp = null;
var _ipApis = [
  'https://api.ipify.org?format=json',
  'https://api64.ipify.org?format=json',
  'https://ipapi.co/json',
  'https://api.db-ip.com/v2/free/self'
];
function _tryFetchIp(urls, idx) {
  if (idx >= urls.length) return;
  fetch(urls[idx]).then(function(r) { return r.json(); }).then(function(d) {
    _cachedIp = d.ip || d.ipAddress || null;
  }).catch(function() { _tryFetchIp(urls, idx + 1); });
}
_tryFetchIp(_ipApis, 0);

async function fetchIpDirect() {
  for (var i = 0; i < _ipApis.length; i++) {
    try {
      var r = await fetch(_ipApis[i]);
      var d = await r.json();
      var ip = d.ip || d.ipAddress || null;
      if (ip) { _cachedIp = ip; return ip; }
    } catch(e) {}
  }
  return null;
}

async function logLoginEvent(userId, eventType) {
  try {
    if (!_cachedIp) await fetchIpDirect();
    await sb.from("login_logs").insert({
      user_id: userId,
      event_type: eventType,
      timestamp: new Date().toISOString(),
      ip_address: _cachedIp,
      user_agent: navigator.userAgent || null
    });
  } catch (e) { /* silent fail — log should not block UX */ }
}

async function handleLogin() {
  var email = document.getElementById("loginEmail").value.trim();
  var password = document.getElementById("loginPassword").value.trim();
  var errEl = document.getElementById("loginError");

  if (!email || !password) {
    errEl.textContent = "Lütfen e-posta ve şifre girin.";
    errEl.style.display = "block";
    return;
  }

  errEl.style.display = "none";

  try {
    var result = await sb.auth.signInWithPassword({ email: email, password: password });
    if (result.error) {
      errEl.textContent = result.error.message === "Invalid login credentials"
        ? "E-posta veya şifre hatalı."
        : result.error.message;
      errEl.style.display = "block";
      return;
    }
    currentUser = result.data.user;
    await loadProfile();
    // Log login event for all users
    await logLoginEvent(currentUser.id, "login");
    showApp();
  } catch (e) {
    errEl.textContent = "Bağlantı hatası: " + e.message;
    errEl.style.display = "block";
  }
}

async function handleLogout() {
  // Log logout event before signing out
  if (currentUser) {
    await logLoginEvent(currentUser.id, "logout");
  }
  if (sb) await sb.auth.signOut();
  currentUser = null;
  currentProfile = null;
  showScreen("loginScreen");
  document.getElementById("loginEmail").value = "";
  document.getElementById("loginPassword").value = "";
  document.getElementById("loginError").style.display = "none";
}

// Log logout on page close/navigate away (for experts)
window.addEventListener("beforeunload", function() {
  if (currentProfile && currentProfile.role === "expert" && currentUser && sb) {
    var url = sb.supabaseUrl + "/rest/v1/login_logs";
    var token = sb.supabaseKey;
    try {
      var session = JSON.parse(localStorage.getItem("sb-" + sb.supabaseUrl.split("//")[1].split(".")[0] + "-auth-token") || "{}");
      var accessToken = session.access_token || token;
      // Use sync XHR as last resort for page close (sendBeacon can't set auth headers)
      var xhr = new XMLHttpRequest();
      xhr.open("POST", url, false); // sync
      xhr.setRequestHeader("Content-Type", "application/json");
      xhr.setRequestHeader("apikey", token);
      xhr.setRequestHeader("Authorization", "Bearer " + accessToken);
      xhr.setRequestHeader("Prefer", "return=minimal");
      xhr.send(JSON.stringify({
        user_id: currentUser.id,
        event_type: "logout",
        timestamp: new Date().toISOString(),
        user_agent: navigator.userAgent || null
      }));
    } catch(e) { /* silent */ }
  }
});

async function loadProfile() {
  var result = await sb.from("profiles").select("*").eq("id", currentUser.id).single();
  if (result.error) {
    showToast("Profil bulunamadı: " + result.error.message);
    await handleLogout();
    return;
  }
  currentProfile = result.data;
}

// ==================== SHOW APP ====================
function showApp() {
  showScreen("appShell");
  var p = currentProfile;

  document.getElementById("topbarAvatar").textContent = getInitials(p.full_name);
  document.getElementById("topbarName").textContent = p.full_name;
  var roleTag = document.getElementById("topbarRole");
  roleTag.textContent = p.role === "admin" ? "Admin" : p.role === "expert" ? "Uzman" : "Danışan";
  roleTag.className = "role-tag " + p.role;

  if (p.role === "admin") renderAdminView();
  else if (p.role === "expert") renderExpertView();
  else renderClientView();
}

// ==================== ADMIN VIEW ====================
async function renderAdminView() {
  var main = document.getElementById("mainContent");
  main.innerHTML = '<div class="empty-state"><div class="loading-spinner"></div><p>Yükleniyor...</p></div>';

  var expertsRes = await sb.from("profiles").select("*").eq("role", "expert").order("full_name");
  var clientsRes = await sb.from("profiles").select("*").eq("role", "client").order("full_name");
  var assignRes = await sb.from("assignments").select("*");
  var notesRes = await sb.from("notes").select("*");
  var sessionsRes = await sb.from("scheduled_sessions").select("*").order("session_date").order("start_time");

  var experts = expertsRes.data || [];
  var clients = clientsRes.data || [];
  var assignments = assignRes.data || [];
  var notes = notesRes.data || [];
  var scheduledSessions = sessionsRes.data || [];

  var totalExperts = experts.length;
  var totalClients = clients.length;
  var totalNotes = notes.length;
  var assignedClients = new Set(assignments.map(function(a) { return a.client_id; })).size;

  main.innerHTML =
    '<div class="stats-grid">' +
      '<div class="stat-card"><div class="stat-value">' + totalExperts + '</div><div class="stat-label">Uzman</div></div>' +
      '<div class="stat-card"><div class="stat-value">' + totalClients + '</div><div class="stat-label">Danışan</div></div>' +
      '<div class="stat-card"><div class="stat-value">' + totalNotes + '</div><div class="stat-label">Seans Notu</div></div>' +
      '<div class="stat-card"><div class="stat-value">' + assignedClients + '</div><div class="stat-label">Atanmış Danışan</div></div>' +
    '</div>' +
    '<div class="tab-nav">' +
      '<button class="tab-btn active" onclick="switchAdminTab(\'experts\',this)">Uzmanlar</button>' +
      '<button class="tab-btn" onclick="switchAdminTab(\'clients\',this)">Danışanlar</button>' +
      '<button class="tab-btn" onclick="switchAdminTab(\'notes\',this)">Seans Notları</button>' +
      '<button class="tab-btn" onclick="switchAdminTab(\'calendar\',this)">Takvim</button>' +
    '</div>' +
    '<div id="adminTabContent"></div>';

  // Store data for tab rendering
  window._adminData = { experts: experts, clients: clients, assignments: assignments, notes: notes, scheduledSessions: scheduledSessions };
  renderAdminExpertsTab();
}

function switchAdminTab(tab, btn) {
  document.querySelectorAll(".tab-btn").forEach(function(b) { b.classList.remove("active"); });
  btn.classList.add("active");
  if (tab === "experts") renderAdminExpertsTab();
  else if (tab === "clients") renderAdminClientsTab();
  else if (tab === "calendar") renderAdminCalendarTab();
  else renderAdminNotesTab();
}

function renderAdminExpertsTab() {
  var d = window._adminData;
  var container = document.getElementById("adminTabContent");

  var html =
    '<div class="page-header">' +
      '<h2 class="section-title">Uzman Yönetimi</h2>' +
      '<button class="btn btn-primary" onclick="openAddExpert()">' +
        '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 5v14"/><path d="M5 12h14"/></svg>' +
        'Uzman Ekle</button>' +
    '</div>' +
    '<div class="search-bar">' +
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/></svg>' +
      '<input type="text" placeholder="Uzman ara..." oninput="filterList(this.value,\'expertsList\')">' +
    '</div>' +
    '<div class="user-list" id="expertsList">';

  d.experts.forEach(function(expert) {
    var clientCount = d.assignments.filter(function(a) { return a.expert_id === expert.id; }).length;
    var contractInfo = '';
    if (expert.contract_start || expert.contract_end) {
      var cs = expert.contract_start ? formatSessionDate(expert.contract_start) : '?';
      var ce = expert.contract_end ? formatSessionDate(expert.contract_end) : '?';
      contractInfo = '<div class="user-card-detail" style="font-size:11px;color:var(--color-text-faint);">Sözleşme: ' + cs + ' – ' + ce + '</div>';
    }
    var ibanInfo = '';
    if (expert.iban) {
      var formattedIban = expert.iban.replace(/(\w{4})/g, '$1 ').trim();
      ibanInfo = '<div class="user-card-detail" style="font-size:11px;color:var(--color-text-faint);">IBAN: ' + esc(formattedIban) + '</div>';
    }
    var workModelInfo = '';
    if (expert.work_model) {
      var wmLabel = expert.work_model === 'contract' ? 'S\u00F6zle\u015Fmeli' : 'Komisyonlu';
      var feeLabel = expert.monthly_fee ? ' — ' + formatCurrency(parseFloat(expert.monthly_fee)) + '/ay' : '';
      workModelInfo = '<div class="user-card-detail" style="font-size:11px;color:var(--color-text-faint);">Model: ' + wmLabel + feeLabel + '</div>';
    }
    var areasHtml = '';
    if (expert.areas_of_expertise) {
      var areasList = expert.areas_of_expertise.split(',').map(function(a) { return a.trim(); }).filter(function(a) { return a; });
      if (areasList.length > 0) {
        areasHtml = '<div class="expert-areas">' + areasList.map(function(a) { return '<span class="area-tag">' + esc(a) + '</span>'; }).join('') + '</div>';
      }
    }
    var capacityHtml = '';
    if (expert.client_capacity != null) {
      var capRatio = clientCount + '/' + expert.client_capacity;
      var capClass = clientCount >= expert.client_capacity ? 'capacity-full' : (clientCount >= expert.client_capacity * 0.8 ? 'capacity-warning' : 'capacity-ok');
      capacityHtml = '<span class="capacity-badge ' + capClass + '">' + capRatio + '</span>';
    }
    html +=
      '<div class="user-card" data-name="' + expert.full_name.toLowerCase() + '">' +
        '<div class="user-card-avatar expert-avatar">' + getInitials(expert.full_name) + '</div>' +
        '<div class="user-card-info">' +
          '<div class="user-card-name">' + esc(expert.full_name) + capacityHtml + '</div>' +
          '<div class="user-card-detail">' + esc(expert.specialty || "Belirtilmemiş") + ' — ' + clientCount + ' danışan</div>' +
          areasHtml +
          contractInfo +
          workModelInfo +
          ibanInfo +
        '</div>' +
        '<div class="user-card-actions">' +
          '<button class="btn btn-ghost btn-sm" onclick="openMessaging(\'' + escAttr(expert.id) + '\',\'' + escAttr(expert.full_name) + '\')" title="Mesaj">' +
            '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg></button>' +
          '<button class="btn btn-ghost btn-sm" onclick="openAssignClients(\'' + expert.id + '\')" title="Danışan Ata">' +
            '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><line x1="19" y1="8" x2="19" y2="14"/><line x1="22" y1="11" x2="16" y2="11"/></svg></button>' +
          '<button class="btn btn-ghost btn-sm" onclick="openEditExpert(\'' + expert.id + '\')" title="Düzenle">' +
            '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z"/></svg></button>' +
          '<button class="btn btn-ghost btn-sm" onclick="confirmDelete(\'' + expert.id + '\',\'' + escAttr(expert.full_name) + '\',\'expert\')" title="Sil" style="color:var(--color-error);">' +
            '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 6h18"/><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"/><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"/></svg></button>' +
        '</div>' +
      '</div>';
  });

  html += '</div>';
  container.innerHTML = html;
}

function renderAdminClientsTab() {
  var d = window._adminData;
  var container = document.getElementById("adminTabContent");

  var html =
    '<div class="page-header">' +
      '<h2 class="section-title">Danışan Yönetimi</h2>' +
      '<button class="btn btn-primary" onclick="openAddClient()">' +
        '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 5v14"/><path d="M5 12h14"/></svg>' +
        'Danışan Ekle</button>' +
    '</div>' +
    '<div class="search-bar">' +
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/></svg>' +
      '<input type="text" placeholder="Danışan ara..." oninput="filterList(this.value,\'clientsList\')">' +
    '</div>' +
    '<div class="user-list" id="clientsList">';

  d.clients.forEach(function(client) {
    var assignment = d.assignments.find(function(a) { return a.client_id === client.id; });
    var expert = assignment ? d.experts.find(function(e) { return e.id === assignment.expert_id; }) : null;
    var expertName = expert ? expert.full_name : "Atanmamış";
    var detailParts = [];
    if (client.age) detailParts.push(client.age + ' yaş');
    if (client.gender) detailParts.push(client.gender);
    if (client.session_fee) detailParts.push(client.session_fee);
    var detailLine = detailParts.length > 0 ? '<div class="user-card-detail" style="font-size:11px;color:var(--color-text-faint);">' + esc(detailParts.join(' • ')) + '</div>' : '';
    html +=
      '<div class="user-card" data-name="' + client.full_name.toLowerCase() + '">' +
        '<div class="user-card-avatar">' + getInitials(client.full_name) + '</div>' +
        '<div class="user-card-info">' +
          '<div class="user-card-name">' + esc(client.full_name) + '</div>' +
          '<div class="user-card-detail">Uzman: ' + esc(expertName) + '</div>' +
          detailLine +
        '</div>' +
        '<div class="user-card-actions">' +
          '<button class="btn btn-ghost btn-sm" onclick="openAdminClientDetail(\'' + client.id + '\')" title="Detay">' +
            '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg></button>' +
          '<button class="btn btn-ghost btn-sm" onclick="openEditClient(\'' + client.id + '\')" title="Düzenle">' +
            '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z"/></svg></button>' +
          '<button class="btn btn-ghost btn-sm" onclick="confirmDelete(\'' + client.id + '\',\'' + escAttr(client.full_name) + '\',\'client\')" title="Sil" style="color:var(--color-error);">' +
            '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 6h18"/><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"/><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"/></svg></button>' +
        '</div>' +
      '</div>';
  });

  html += '</div>';
  container.innerHTML = html;
}

async function openAdminClientDetail(clientId) {
  var d = window._adminData;
  var client = d.clients.find(function(c) { return c.id === clientId; });
  if (!client) return;
  var assignment = d.assignments.find(function(a) { return a.client_id === clientId; });
  var expert = assignment ? d.experts.find(function(e) { return e.id === assignment.expert_id; }) : null;

  // Show loading first
  var overlay = document.getElementById('adminClientDetailModal');
  if (!overlay) {
    overlay = document.createElement('div');
    overlay.id = 'adminClientDetailModal';
    overlay.className = 'modal-overlay';
    document.body.appendChild(overlay);
  }
  overlay.innerHTML = '<div class="modal"><div class="empty-state"><div class="loading-spinner"></div><p>Yükleniyor...</p></div></div>';
  overlay.classList.add('active');
  overlay.onclick = function(e) { if (e.target === overlay) closeModal('adminClientDetailModal'); };

  // Load progress data
  var progressData = await loadProgressData(clientId);

  var html = '<div class="modal"><div class="modal-header"><h3 class="modal-title">' + esc(client.full_name) + ' — Detay</h3>' +
    '<button class="modal-close" onclick="closeModal(\'adminClientDetailModal\')">' +
    '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg></button></div>';

  // Progress summary
  html += '<h4 style="font-family:var(--font-display);font-size:var(--text-sm);font-weight:600;margin-bottom:var(--space-3);">İlerleme Özeti</h4>';
  html += renderProgressDashboard(progressData);

  html += '<div style="display:grid;gap:var(--space-3);">';

  function row(label, value) {
    return '<div style="display:flex;justify-content:space-between;padding:var(--space-2) 0;border-bottom:1px solid var(--color-border);">' +
      '<span style="font-weight:500;color:var(--color-text-muted);font-size:var(--text-sm);">' + label + '</span>' +
      '<span style="font-size:var(--text-sm);text-align:right;max-width:60%;">' + (value ? esc(String(value)) : '<em style="color:var(--color-text-faint);">Belirtilmemiş</em>') + '</span></div>';
  }

  html += row('E-posta', client.email);
  html += row('Telefon', client.phone);
  html += row('Atanan Uzman', expert ? expert.full_name : 'Atanmamış');
  html += row('Yaş', client.age);
  html += row('Cinsiyet', client.gender);
  html += row('Medeni Durum', client.marital_status);
  html += row('Seans Ücreti', client.session_fee);
  html += row('Uygun Saatler', client.available_hours);
  html += row('Önceki Terapi', client.previous_therapy);
  html += row('İlaç Kullanımı', client.medication_use);

  if (client.pre_interview_summary) {
    html += '<div style="padding:var(--space-2) 0;"><div style="font-weight:500;color:var(--color-text-muted);font-size:var(--text-sm);margin-bottom:var(--space-1);">Ön Görüşme Özeti</div>' +
      '<div style="font-size:var(--text-sm);background:var(--color-bg-subtle);padding:var(--space-3);border-radius:var(--radius-md);white-space:pre-wrap;">' + esc(client.pre_interview_summary) + '</div></div>';
  } else {
    html += row('Ön Görüşme Özeti', null);
  }

  html += '</div><div class="modal-footer"><button class="btn btn-secondary" onclick="closeModal(\'adminClientDetailModal\')">Kapat</button>' +
    '<button class="btn btn-primary" onclick="closeModal(\'adminClientDetailModal\');openEditClient(\'' + clientId + '\')">Düzenle</button></div></div>';

  overlay.innerHTML = html;
}

async function renderAdminNotesTab() {
  var container = document.getElementById("adminTabContent");
  var d = window._adminData;

  container.innerHTML = '<div class="empty-state"><div class="loading-spinner"></div><p>Yükleniyor...</p></div>';

  // Fetch structured notes too
  var structRes = await sb.from("structured_notes").select("*").order("created_at", { ascending: false });
  var structuredNotes = structRes.data || [];

  var html = '<h2 class="section-title">Tüm Seans Notları</h2>';

  // Combine all notes
  var allNotes = [];
  d.notes.forEach(function(note) {
    allNotes.push({ type: 'free', date: note.created_at, content: note.content, expert_id: note.expert_id, client_id: note.client_id });
  });
  structuredNotes.forEach(function(note) {
    var content = '';
    if (note.note_type === 'soap') {
      content = (note.subjective ? 'S: ' + note.subjective + '\n' : '') + (note.objective ? 'O: ' + note.objective + '\n' : '') + (note.assessment ? 'A: ' + note.assessment + '\n' : '') + (note.plan ? 'P: ' + note.plan : '');
    } else if (note.note_type === 'risk') {
      content = 'Risk Seviyesi: ' + (note.risk_level || '?') + '\n' + (note.risk_details || '');
    } else if (note.note_type === 'plan') {
      content = (note.goals ? 'Hedefler: ' + note.goals + '\n' : '') + (note.interventions ? 'Müdahaleler: ' + note.interventions + '\n' : '') + (note.next_session_goals ? 'Sonraki Seans: ' + note.next_session_goals : '');
    }
    allNotes.push({ type: note.note_type, date: note.created_at, content: content, expert_id: note.expert_id, client_id: note.client_id, session_date: note.session_date, risk_level: note.risk_level });
  });

  if (allNotes.length === 0) {
    html += '<div class="empty-state"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M12 20h9"/><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z"/></svg><h3>Henüz not yok</h3><p>Uzmanlar seans notları eklediğinde burada görünecektir.</p></div>';
  } else {
    var sorted = allNotes.sort(function(a, b) { return new Date(b.date) - new Date(a.date); });
    sorted.forEach(function(note) {
      var expert = d.experts.find(function(e) { return e.id === note.expert_id; });
      var client = d.clients.find(function(c) { return c.id === note.client_id; });
      var badgeClass = 'note-type-free';
      var badgeLabel = 'Serbest';
      if (note.type === 'soap') { badgeClass = 'note-type-soap'; badgeLabel = 'SOAP'; }
      else if (note.type === 'risk') { badgeClass = 'note-type-risk'; badgeLabel = 'Risk'; }
      else if (note.type === 'plan') { badgeClass = 'note-type-plan'; badgeLabel = 'Tedavi Planı'; }
      html +=
        '<div class="note-item">' +
          '<div class="note-date">' +
            '<span class="note-type-badge ' + badgeClass + '">' + badgeLabel + '</span> ' +
            '<strong>' + esc(expert ? expert.full_name : "?") + '</strong> → <strong>' + esc(client ? client.full_name : "?") + '</strong> — ' + formatDate(note.date) +
          '</div>' +
          '<div class="note-text" style="white-space:pre-wrap;">' + esc(note.content) + '</div>' +
        '</div>';
    });
  }

  container.innerHTML = html;
}

// ==================== ADMIN CALENDAR TAB ====================
function renderAdminCalendarTab() {
  var d = window._adminData;
  var container = document.getElementById("adminTabContent");
  var today = new Date().toISOString().split("T")[0];

  var html =
    '<div class="page-header">' +
      '<h2 class="section-title">Takvim</h2>' +
      '<button class="btn btn-primary" onclick="openAddSession()">' +
        '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect width="18" height="18" x="3" y="4" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>' +
        'Seans Planla</button>' +
    '</div>';

  if (!d.scheduledSessions || d.scheduledSessions.length === 0) {
    html += '<div class="empty-state"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><rect width="18" height="18" x="3" y="4" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg><h3>Planlanmış seans yok</h3><p>Yeni bir seans planlamak için "Seans Planla" butonuna tıklayın.</p></div>';
  } else {
    var sorted = d.scheduledSessions.slice().sort(function(a, b) {
      return (a.session_date + a.start_time).localeCompare(b.session_date + b.start_time);
    });

    html += '<div class="session-list">';
    sorted.forEach(function(sess) {
      var expert = d.experts.find(function(e) { return e.id === sess.expert_id; });
      var client = d.clients.find(function(c) { return c.id === sess.client_id; });
      var isPast = sess.session_date < today;
      var statusClass = sess.status === "completed" ? "session-status-completed" : sess.status === "cancelled" ? "session-status-cancelled" : "session-status-planned";
      var statusLabel = sess.status === "completed" ? "Tamamlandı" : sess.status === "cancelled" ? "İptal" : "Planlandı";

      html +=
        '<div class="session-card' + (isPast ? " session-past" : "") + '">' +
          '<div class="session-card-date">' +
            '<div class="session-day">' + formatSessionDate(sess.session_date) + '</div>' +
            '<div class="session-time">' + sess.start_time.substring(0, 5) + ' – ' + sess.end_time.substring(0, 5) + '</div>' +
          '</div>' +
          '<div class="session-card-info">' +
            '<div class="session-names">' +
              '<span class="session-expert">' + esc(expert ? expert.full_name : "?") + '</span>' +
              '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M5 12h14"/><path d="m12 5 7 7-7 7"/></svg>' +
              '<span class="session-client">' + esc(client ? client.full_name : "?") + '</span>' +
            '</div>' +
            (sess.notes ? '<div class="session-notes-preview">' + esc(sess.notes) + '</div>' : '') +
          '</div>' +
          '<div class="session-card-right">' +
            '<span class="session-status ' + statusClass + '">' + statusLabel + '</span>' +
            '<div class="session-actions">' +
              '<button class="btn btn-ghost btn-sm" onclick="openEditSession(' + sess.id + ')" title="Düzenle">' +
                '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z"/></svg></button>' +
              '<button class="btn btn-ghost btn-sm" onclick="confirmDeleteSession(' + sess.id + ')" title="Sil" style="color:var(--color-error);">' +
                '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 6h18"/><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"/><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"/></svg></button>' +
            '</div>' +
          '</div>' +
        '</div>';
    });
    html += '</div>';
  }

  container.innerHTML = html;
}

// ==================== SESSION MODAL (ADMIN) ====================
var editingSessionId = null;

function openAddSession() {
  editingSessionId = null;
  document.getElementById("sessionModalTitle").textContent = "Seans Planla";
  document.getElementById("sessionDate").value = "";
  document.getElementById("sessionStartTime").value = "";
  document.getElementById("sessionEndTime").value = "";
  document.getElementById("sessionNotes").value = "";
  document.getElementById("sessionStatus").value = "planned";
  populateSessionExpertSelect("");
  populateSessionClientSelect("", "");
  openModal("sessionModal");
}

function openEditSession(id) {
  var d = window._adminData;
  var sess = (d.scheduledSessions || []).find(function(s) { return s.id === id; });
  if (!sess) return;
  editingSessionId = id;
  document.getElementById("sessionModalTitle").textContent = "Seans Düzenle";
  document.getElementById("sessionDate").value = sess.session_date;
  document.getElementById("sessionStartTime").value = sess.start_time.substring(0, 5);
  document.getElementById("sessionEndTime").value = sess.end_time.substring(0, 5);
  document.getElementById("sessionNotes").value = sess.notes || "";
  document.getElementById("sessionStatus").value = sess.status || "planned";
  populateSessionExpertSelect(sess.expert_id);
  populateSessionClientSelect(sess.expert_id, sess.client_id);
  openModal("sessionModal");
}

function populateSessionExpertSelect(selectedId) {
  var select = document.getElementById("sessionExpertSelect");
  select.innerHTML = '<option value="">Uzman seçiniz</option>';
  (window._adminData ? window._adminData.experts : []).forEach(function(e) {
    var sel = e.id === selectedId ? " selected" : "";
    select.innerHTML += '<option value="' + e.id + '"' + sel + '>' + esc(e.full_name) + '</option>';
  });
}

function populateSessionClientSelect(expertId, selectedClientId) {
  var select = document.getElementById("sessionClientSelect");
  var d = window._adminData;
  var clients = d ? d.clients : [];

  // If expert is selected, ideally filter by assigned clients; fall back to all clients
  if (expertId && d) {
    var assignedIds = d.assignments.filter(function(a) { return a.expert_id === expertId; }).map(function(a) { return a.client_id; });
    var filtered = clients.filter(function(c) { return assignedIds.indexOf(c.id) !== -1; });
    // If expert has no assigned clients, show all
    if (filtered.length > 0) clients = filtered;
  }

  select.innerHTML = '<option value="">Danışan seçiniz</option>';
  clients.forEach(function(c) {
    var sel = c.id === selectedClientId ? " selected" : "";
    select.innerHTML += '<option value="' + c.id + '"' + sel + '>' + esc(c.full_name) + '</option>';
  });
}

async function saveSession() {
  var expertId = document.getElementById("sessionExpertSelect").value;
  var clientId = document.getElementById("sessionClientSelect").value;
  var date = document.getElementById("sessionDate").value;
  var startTime = document.getElementById("sessionStartTime").value;
  var endTime = document.getElementById("sessionEndTime").value;
  var notes = document.getElementById("sessionNotes").value.trim();
  var status = document.getElementById("sessionStatus").value;

  if (!expertId || !clientId || !date || !startTime || !endTime) {
    showToast("Uzman, danışan, tarih ve saat zorunludur.");
    return;
  }

  if (startTime >= endTime) {
    showToast("Bitiş saati başlangıç saatinden sonra olmalıdır.");
    return;
  }

  var payload = {
    expert_id: expertId,
    client_id: clientId,
    session_date: date,
    start_time: startTime,
    end_time: endTime,
    notes: notes || null,
    status: status,
    updated_at: new Date().toISOString()
  };

  var res;
  if (editingSessionId) {
    res = await sb.from("scheduled_sessions").update(payload).eq("id", editingSessionId);
  } else {
    res = await sb.from("scheduled_sessions").insert(payload);
  }

  if (res.error) {
    showToast("Hata: " + res.error.message);
    return;
  }

  showToast(editingSessionId ? "Seans güncellendi" : "Seans planlandı");
  closeModal("sessionModal");
  renderAdminView();
}

function confirmDeleteSession(id) {
  document.getElementById("confirmMessage").textContent = "Bu seansı silmek istediğinize emin misiniz?";
  document.getElementById("confirmDeleteBtn").onclick = function() { deleteSession(id); };
  openModal("confirmModal");
}

async function deleteSession(id) {
  var res = await sb.from("scheduled_sessions").delete().eq("id", id);
  if (res.error) {
    showToast("Hata: " + res.error.message);
    closeModal("confirmModal");
    return;
  }
  closeModal("confirmModal");
  showToast("Seans silindi");
  renderAdminView();
}

// ==================== EXPERT CRUD ====================
function openAddExpert() {
  editingId = null;
  document.getElementById("expertModalTitle").textContent = "Uzman Ekle";
  document.getElementById("expertName").value = "";
  document.getElementById("expertEmail").value = "";
  document.getElementById("expertPassword").value = "";
  document.getElementById("expertSpecialty").value = "";
  document.getElementById("expertAreas").value = "";
  document.getElementById("expertPhone").value = "";
  document.getElementById("expertClientCapacity").value = "";
  document.getElementById("expertContractStart").value = "";
  document.getElementById("expertContractEnd").value = "";
  document.getElementById("expertIban").value = "";
  document.getElementById("expertWorkModel").value = "";
  document.getElementById("expertMonthlyFee").value = "";
  document.getElementById("expertPassword").style.display = "";
  document.getElementById("expertPasswordHint").style.display = "";
  document.getElementById("expertEmail").disabled = false;
  openModal("expertModal");
}

function openEditExpert(id) {
  var expert = window._adminData.experts.find(function(e) { return e.id === id; });
  if (!expert) return;
  editingId = id;
  document.getElementById("expertModalTitle").textContent = "Uzman Düzenle";
  document.getElementById("expertName").value = expert.full_name;
  document.getElementById("expertEmail").value = expert.email;
  document.getElementById("expertEmail").disabled = true;
  document.getElementById("expertPassword").style.display = "none";
  document.getElementById("expertPasswordHint").style.display = "none";
  document.getElementById("expertSpecialty").value = expert.specialty || "";
  document.getElementById("expertAreas").value = expert.areas_of_expertise || "";
  document.getElementById("expertPhone").value = expert.phone || "";
  document.getElementById("expertClientCapacity").value = expert.client_capacity != null ? expert.client_capacity : "";
  document.getElementById("expertContractStart").value = expert.contract_start || "";
  document.getElementById("expertContractEnd").value = expert.contract_end || "";
  document.getElementById("expertIban").value = expert.iban || "";
  document.getElementById("expertWorkModel").value = expert.work_model || "";
  document.getElementById("expertMonthlyFee").value = expert.monthly_fee != null ? expert.monthly_fee : "";
  openModal("expertModal");
}

async function getAuthToken() {
  var session = await sb.auth.getSession();
  return session.data.session ? session.data.session.access_token : "";
}

async function saveExpert() {
  var name = document.getElementById("expertName").value.trim();
  var email = document.getElementById("expertEmail").value.trim();
  var password = document.getElementById("expertPassword").value.trim();
  var specialty = document.getElementById("expertSpecialty").value.trim();
  var areas = document.getElementById("expertAreas").value.trim();
  var phone = document.getElementById("expertPhone").value.trim();
  var capacityVal = document.getElementById("expertClientCapacity").value;
  var clientCapacity = capacityVal !== "" ? parseInt(capacityVal) : null;
  var contractStart = document.getElementById("expertContractStart").value || null;
  var contractEnd = document.getElementById("expertContractEnd").value || null;
  var expertIban = document.getElementById("expertIban").value.trim().replace(/\s/g, "").toUpperCase();
  var workModel = document.getElementById("expertWorkModel").value || null;
  var monthlyFeeVal = document.getElementById("expertMonthlyFee").value;
  var monthlyFee = monthlyFeeVal !== "" ? parseFloat(monthlyFeeVal) : null;

  if (!name || !email || !specialty) {
    showToast("Ad, e-posta ve uzmanlık alanı zorunludur.");
    return;
  }

  if (editingId) {
    // Update profile (direct Supabase — no auth conflict)
    var upd = await sb.from("profiles").update({
      full_name: name,
      specialty: specialty,
      areas_of_expertise: areas || null,
      phone: phone,
      client_capacity: clientCapacity,
      contract_start: contractStart,
      contract_end: contractEnd,
      iban: expertIban || null,
      work_model: workModel,
      monthly_fee: monthlyFee,
      updated_at: new Date().toISOString()
    }).eq("id", editingId);

    if (upd.error) { showToast("Hata: " + upd.error.message); return; }
    showToast("Uzman güncellendi");
  } else {
    if (!password || password.length < 6) {
      showToast("Şifre en az 6 karakter olmalıdır.");
      return;
    }
    // Create user via serverless API (service_role on backend)
    var token = await getAuthToken();
    var res = await fetch("/api/create-user", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": "Bearer " + token
      },
      body: JSON.stringify({
        email: email,
        password: password,
        full_name: name,
        role: "expert",
        specialty: specialty,
        areas_of_expertise: areas || null,
        phone: phone,
        client_capacity: clientCapacity,
        work_model: workModel,
        monthly_fee: monthlyFee
      })
    });
    var data = await res.json();
    if (!res.ok || !data.success) {
      showToast(data.error || "Uzman eklenemedi.");
      return;
    }
    showToast("Uzman eklendi");
  }

  closeModal("expertModal");
  renderAdminView();
}

// ==================== CLIENT CRUD ====================
function openAddClient() {
  editingId = null;
  document.getElementById("clientModalTitle").textContent = "Danışan Ekle";
  document.getElementById("clientName").value = "";
  document.getElementById("clientEmail").value = "";
  document.getElementById("clientPassword").value = "";
  document.getElementById("clientPhone").value = "";
  document.getElementById("clientPassword").style.display = "";
  document.getElementById("clientPasswordHint").style.display = "";
  document.getElementById("clientEmail").disabled = false;
  document.getElementById("clientAge").value = "";
  document.getElementById("clientGender").value = "";
  document.getElementById("clientMaritalStatus").value = "";
  document.getElementById("clientSessionFee").value = "";
  document.getElementById("clientAvailableHours").value = "";
  document.getElementById("clientPreviousTherapy").value = "";
  document.getElementById("clientMedicationUse").value = "";
  document.getElementById("clientPreInterviewSummary").value = "";
  populateExpertSelect("");
  openModal("clientModal");
}

function openEditClient(id) {
  var client = window._adminData.clients.find(function(c) { return c.id === id; });
  if (!client) return;
  editingId = id;
  document.getElementById("clientModalTitle").textContent = "Danışan Düzenle";
  document.getElementById("clientName").value = client.full_name;
  document.getElementById("clientEmail").value = client.email;
  document.getElementById("clientEmail").disabled = true;
  document.getElementById("clientPassword").style.display = "none";
  document.getElementById("clientPasswordHint").style.display = "none";
  document.getElementById("clientPhone").value = client.phone || "";
  document.getElementById("clientAge").value = client.age || "";
  document.getElementById("clientGender").value = client.gender || "";
  document.getElementById("clientMaritalStatus").value = client.marital_status || "";
  document.getElementById("clientSessionFee").value = client.session_fee || "";
  document.getElementById("clientAvailableHours").value = client.available_hours || "";
  document.getElementById("clientPreviousTherapy").value = client.previous_therapy || "";
  document.getElementById("clientMedicationUse").value = client.medication_use || "";
  document.getElementById("clientPreInterviewSummary").value = client.pre_interview_summary || "";

  var assignment = window._adminData.assignments.find(function(a) { return a.client_id === id; });
  populateExpertSelect(assignment ? assignment.expert_id : "");
  openModal("clientModal");
}

function populateExpertSelect(selectedId) {
  var select = document.getElementById("clientExpertSelect");
  select.innerHTML = '<option value="">Uzman seçiniz</option>';
  (window._adminData ? window._adminData.experts : []).forEach(function(e) {
    var sel = e.id === selectedId ? " selected" : "";
    select.innerHTML += '<option value="' + e.id + '"' + sel + '>' + esc(e.full_name) + '</option>';
  });
}

async function saveClient() {
  var name = document.getElementById("clientName").value.trim();
  var email = document.getElementById("clientEmail").value.trim();
  var password = document.getElementById("clientPassword").value.trim();
  var phone = document.getElementById("clientPhone").value.trim();
  var expertId = document.getElementById("clientExpertSelect").value || null;
  var age = document.getElementById("clientAge").value ? parseInt(document.getElementById("clientAge").value) : null;
  var gender = document.getElementById("clientGender").value || null;
  var maritalStatus = document.getElementById("clientMaritalStatus").value || null;
  var sessionFee = document.getElementById("clientSessionFee").value.trim() || null;
  var availableHours = document.getElementById("clientAvailableHours").value.trim() || null;
  var previousTherapy = document.getElementById("clientPreviousTherapy").value || null;
  var medicationUse = document.getElementById("clientMedicationUse").value || null;
  var preInterviewSummary = document.getElementById("clientPreInterviewSummary").value.trim() || null;

  if (!name || !email) {
    showToast("Ad ve e-posta zorunludur.");
    return;
  }

  if (editingId) {
    var upd = await sb.from("profiles").update({
      full_name: name,
      phone: phone,
      age: age,
      gender: gender,
      marital_status: maritalStatus,
      session_fee: sessionFee,
      available_hours: availableHours,
      previous_therapy: previousTherapy,
      medication_use: medicationUse,
      pre_interview_summary: preInterviewSummary,
      updated_at: new Date().toISOString()
    }).eq("id", editingId);

    if (upd.error) { showToast("Hata: " + upd.error.message); return; }

    // Update assignment
    await sb.from("assignments").delete().eq("client_id", editingId);
    if (expertId) {
      await sb.from("assignments").insert({ expert_id: expertId, client_id: editingId });
    }
    showToast("Danışan güncellendi");
  } else {
    if (!password || password.length < 6) {
      showToast("Şifre en az 6 karakter olmalıdır.");
      return;
    }
    // Create user via serverless API (service_role on backend)
    var token = await getAuthToken();
    var res = await fetch("/api/create-user", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": "Bearer " + token
      },
      body: JSON.stringify({
        email: email,
        password: password,
        full_name: name,
        role: "client",
        phone: phone,
        expert_id: expertId,
        age: age,
        gender: gender,
        marital_status: maritalStatus,
        session_fee: sessionFee,
        available_hours: availableHours,
        previous_therapy: previousTherapy,
        medication_use: medicationUse,
        pre_interview_summary: preInterviewSummary
      })
    });
    var data = await res.json();
    if (!res.ok || !data.success) {
      showToast(data.error || "Danışan eklenemedi.");
      return;
    }
    showToast("Danışan eklendi");
  }

  closeModal("clientModal");
  renderAdminView();
}

// ==================== DELETE ====================
function confirmDelete(id, name, type) {
  document.getElementById("confirmMessage").textContent =
    '"' + name + '" ' + (type === "expert" ? "adlı uzmanı" : "adlı danışanı") + ' silmek istediğinize emin misiniz?';
  document.getElementById("confirmDeleteBtn").onclick = function() { deleteUser(id, type); };
  openModal("confirmModal");
}

async function deleteUser(id, type) {
  // Delete via serverless API (also removes auth user)
  var token = await getAuthToken();
  var res = await fetch("/api/delete-user", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": "Bearer " + token
    },
    body: JSON.stringify({ user_id: id })
  });
  var data = await res.json();
  if (!res.ok || !data.success) {
    showToast(data.error || "Silinemedi.");
    closeModal("confirmModal");
    return;
  }
  closeModal("confirmModal");
  showToast(type === "expert" ? "Uzman silindi" : "Danışan silindi");
  renderAdminView();
}

// ==================== ASSIGN CLIENTS ====================
async function openAssignClients(expertId) {
  var d = window._adminData;
  var expert = d.experts.find(function(e) { return e.id === expertId; });
  if (!expert) return;

  document.getElementById("assignModalTitle").textContent = expert.full_name + " — Danışan Ata";
  var container = document.getElementById("assignClientsList");
  var expertAssignments = d.assignments.filter(function(a) { return a.expert_id === expertId; });
  var assignedIds = expertAssignments.map(function(a) { return a.client_id; });

  var html = "";
  d.clients.forEach(function(client) {
    var isAssigned = assignedIds.indexOf(client.id) !== -1;
    html +=
      '<label style="display:flex;align-items:center;gap:var(--space-3);padding:var(--space-3);border-radius:var(--radius-lg);cursor:pointer;transition:background 0.15s;"' +
      ' onmouseenter="this.style.background=\'var(--color-surface-2)\'" onmouseleave="this.style.background=\'transparent\'">' +
        '<input type="checkbox" ' + (isAssigned ? "checked" : "") + ' onchange="toggleAssignment(\'' + expertId + '\',\'' + client.id + '\',this.checked)"' +
        ' style="width:18px;height:18px;accent-color:var(--color-primary);">' +
        '<div class="user-card-avatar" style="width:32px;height:32px;font-size:var(--text-xs);">' + getInitials(client.full_name) + '</div>' +
        '<div>' +
          '<div style="font-weight:500;font-size:var(--text-sm);">' + esc(client.full_name) + '</div>' +
          '<div style="font-size:var(--text-xs);color:var(--color-text-muted);">' + esc(client.email) + '</div>' +
        '</div>' +
      '</label>';
  });

  if (d.clients.length === 0) {
    html = '<p style="text-align:center;color:var(--color-text-muted);padding:var(--space-6);font-size:var(--text-sm);">Henüz danışan bulunmuyor.</p>';
  }

  container.innerHTML = html;
  openModal("assignModal");
}

async function toggleAssignment(expertId, clientId, isChecked) {
  if (isChecked) {
    // Remove old assignment for this client
    await sb.from("assignments").delete().eq("client_id", clientId);
    // Add new
    await sb.from("assignments").insert({ expert_id: expertId, client_id: clientId });
  } else {
    await sb.from("assignments").delete().match({ expert_id: expertId, client_id: clientId });
  }
  // Refresh admin data in background
  var assignRes = await sb.from("assignments").select("*");
  if (window._adminData) window._adminData.assignments = assignRes.data || [];
}

// ==================== EXPERT VIEW ====================
async function renderExpertView() {
  var main = document.getElementById("mainContent");
  main.innerHTML = '<div class="empty-state"><div class="loading-spinner"></div><p>Yükleniyor...</p></div>';

  var assignRes = await sb.from("assignments").select("*, client:client_id(id, full_name, email, phone)").eq("expert_id", currentProfile.id);
  var assignments = assignRes.data || [];

  // Load upcoming sessions for this expert
  var today = new Date().toISOString().split("T")[0];
  var sessionsRes = await sb.from("scheduled_sessions")
    .select("*, client:client_id(id, full_name)")
    .eq("expert_id", currentProfile.id)
    .gte("session_date", today)
    .order("session_date")
    .order("start_time");
  var upcomingSessions = sessionsRes.data || [];

  var html =
    '<div class="page-header">' +
      '<h2 class="page-title">Danışanlarım</h2>' +
      '<span class="badge badge-online">Çevrimiçi</span>' +
    '</div>';

  if (assignments.length === 0) {
    html += '<div class="empty-state"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/></svg><h3>Henüz danışanınız yok</h3><p>Admin tarafından size danışan atandığında burada görünecektir.</p></div>';
  } else {
    window._expertClients = assignments;
    html += '<div class="user-list" id="expertClientList">';
    for (var i = 0; i < assignments.length; i++) {
      var a = assignments[i];
      var client = a.client;
      var notesRes = await sb.from("notes").select("id").eq("expert_id", currentProfile.id).eq("client_id", client.id);
      var noteCount = (notesRes.data || []).length;
      html +=
        '<div class="user-card">' +
          '<div class="user-card-avatar">' + getInitials(client.full_name) + '</div>' +
          '<div class="user-card-info">' +
            '<div class="user-card-name">' + esc(client.full_name) + '</div>' +
            '<div class="user-card-detail">' + noteCount + ' seans notu</div>' +
          '</div>' +
          '<div class="user-card-actions">' +
            '<button class="btn btn-primary btn-sm" onclick="startVideoCall(\'' + escAttr(client.id) + '\',\'' + escAttr(client.full_name) + '\')">' +
              '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="m22 8-6 4 6 4V8Z"/><rect width="14" height="12" x="2" y="6" rx="2"/></svg> Görüşme</button>' +
            '<button class="btn btn-ghost btn-sm" onclick="showClientDetail(\'' + client.id + '\')">' +
              '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 20h9"/><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z"/></svg> Notlar</button>' +
          '</div>' +
        '</div>';
    }
    html += '</div>';
  }

  // Upcoming sessions section
  html += '<div class="upcoming-sessions-section">';
  html += '<h3 class="section-title" style="margin-top:var(--space-8);">Yaklaşan Seanslar</h3>';

  if (upcomingSessions.length === 0) {
    html += '<p class="no-sessions-msg">Yaklaşan planlanmış seans bulunmuyor.</p>';
  } else {
    html += '<div class="session-list session-list-compact">';
    upcomingSessions.forEach(function(sess) {
      var clientName = sess.client ? sess.client.full_name : "?";
      var statusClass = sess.status === "completed" ? "session-status-completed" : sess.status === "cancelled" ? "session-status-cancelled" : "session-status-planned";
      var statusLabel = sess.status === "completed" ? "Tamamlandı" : sess.status === "cancelled" ? "İptal" : "Planlandı";
      html +=
        '<div class="session-card session-card-compact">' +
          '<div class="session-card-date">' +
            '<div class="session-day">' + formatSessionDate(sess.session_date) + '</div>' +
            '<div class="session-time">' + sess.start_time.substring(0, 5) + ' – ' + sess.end_time.substring(0, 5) + '</div>' +
          '</div>' +
          '<div class="session-card-info">' +
            '<div class="session-names"><span class="session-client">' + esc(clientName) + '</span></div>' +
            (sess.notes ? '<div class="session-notes-preview">' + esc(sess.notes) + '</div>' : '') +
          '</div>' +
          '<span class="session-status ' + statusClass + '">' + statusLabel + '</span>' +
        '</div>';
    });
    html += '</div>';
  }

  html += '</div>';
  html += '<div id="clientDetailView" class="detail-view"></div>';
  main.innerHTML = html;
}

async function showClientDetail(clientId) {
  var clientRes = await sb.from("profiles").select("*").eq("id", clientId).single();
  var client = clientRes.data;
  if (!client) return;

  var expertClientList = document.getElementById("expertClientList");
  if (expertClientList) expertClientList.style.display = "none";
  var upcomingSection = document.querySelector(".upcoming-sessions-section");
  if (upcomingSection) upcomingSection.style.display = "none";
  var adminMsgSection = document.querySelector(".admin-message-section");
  if (adminMsgSection) adminMsgSection.style.display = "none";
  document.querySelector(".page-header").style.display = "none";
  var detailEl = document.getElementById("clientDetailView");
  detailEl.classList.add("active");
  detailEl.innerHTML = '<div class="empty-state"><div class="loading-spinner"></div><p>Yükleniyor...</p></div>';

  // Load all data in parallel
  var notesRes = await sb.from("notes").select("*").eq("expert_id", currentProfile.id).eq("client_id", clientId).order("created_at", { ascending: false });
  var notes = notesRes.data || [];

  var structuredNotes = await loadStructuredNotes(clientId);
  var progressData = await loadProgressData(clientId);
  var moodEntries = await loadMoodEntries(clientId, 30);
  var homeworkList = await loadHomework(clientId);

  // Shared journals
  var journalRes = await sb.from("journal_entries").select("*").eq("client_id", clientId).eq("is_shared", true).order("created_at", { ascending: false });
  var sharedJournals = journalRes.data || [];

  // Build client info section
  var infoItems = [];
  if (client.age) infoItems.push({l:'Yaş', v: client.age});
  if (client.gender) infoItems.push({l:'Cinsiyet', v: client.gender});
  if (client.marital_status) infoItems.push({l:'Medeni Durum', v: client.marital_status});
  if (client.session_fee) infoItems.push({l:'Seans Ücreti', v: client.session_fee});
  if (client.available_hours) infoItems.push({l:'Uygun Saatler', v: client.available_hours});
  if (client.previous_therapy) infoItems.push({l:'Önceki Terapi', v: client.previous_therapy});
  if (client.medication_use) infoItems.push({l:'İlaç Kullanımı', v: client.medication_use});

  var infoHtml = '';
  if (infoItems.length > 0 || client.pre_interview_summary) {
    infoHtml = '<div style="background:var(--color-surface-2);border-radius:var(--radius-md);padding:var(--space-4);margin-bottom:var(--space-4);">' +
      '<h3 class="section-title" style="font-size:var(--text-sm);margin-bottom:var(--space-3);">Danışan Bilgileri</h3>' +
      '<div style="display:grid;grid-template-columns:1fr 1fr;gap:var(--space-2);">';
    infoItems.forEach(function(item) {
      infoHtml += '<div style="font-size:var(--text-sm);"><span style="color:var(--color-text-muted);">' + item.l + ':</span> ' + esc(String(item.v)) + '</div>';
    });
    infoHtml += '</div>';
    if (client.pre_interview_summary) {
      infoHtml += '<div style="margin-top:var(--space-3);font-size:var(--text-sm);"><span style="color:var(--color-text-muted);">Ön Görüşme Özeti:</span>' +
        '<div style="margin-top:var(--space-1);white-space:pre-wrap;">' + esc(client.pre_interview_summary) + '</div></div>';
    }
    infoHtml += '</div>';
  }

  var html =
    '<button class="back-btn" onclick="backToExpertList()">' +
      '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="m12 19-7-7 7-7"/><path d="M19 12H5"/></svg> Geri Dön</button>' +
    '<div class="detail-header">' +
      '<div class="detail-avatar">' + getInitials(client.full_name) + '</div>' +
      '<div class="detail-info"><h2>' + esc(client.full_name) + '</h2><p>' + esc(client.email) + (client.phone ? ' — ' + esc(client.phone) : '') + '</p></div>' +
      '<button class="btn btn-primary btn-sm" onclick="startVideoCall(\'' + escAttr(client.id) + '\',\'' + escAttr(client.full_name) + '\')" style="margin-left:auto;">' +
        '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="m22 8-6 4 6 4V8Z"/><rect width="14" height="12" x="2" y="6" rx="2"/></svg> Görüşme</button>' +
    '</div>' +
    infoHtml;

  // ---- Progress Dashboard ----
  html += '<h3 class="section-title">İlerleme Özeti</h3>';
  html += renderProgressDashboard(progressData);

  // ---- Mood Chart (30 days) ----
  html += '<div style="background:var(--color-surface);border:1px solid var(--color-divider);border-radius:var(--radius-lg);padding:var(--space-4);margin-bottom:var(--space-4);">' +
    '<h3 class="section-title" style="font-size:var(--text-sm);margin-bottom:var(--space-3);">Duygu Grafiği (Son 30 Gün)</h3>' +
    renderMoodChart(moodEntries) +
  '</div>';

  // ---- Tabbed Notes Section ----
  html += '<div class="notes-section">' +
    '<h3 class="section-title">Seans Notları</h3>' +
    '<div class="note-tabs">' +
      '<button class="note-tab-btn active" data-tab="free" onclick="switchNoteTab(\'free\')">Serbest Not</button>' +
      '<button class="note-tab-btn" data-tab="soap" onclick="switchNoteTab(\'soap\')">SOAP Notu</button>' +
      '<button class="note-tab-btn" data-tab="risk" onclick="switchNoteTab(\'risk\')">Risk Değerlendirme</button>' +
      '<button class="note-tab-btn" data-tab="plan" onclick="switchNoteTab(\'plan\')">Tedavi Planı</button>' +
    '</div>';

  // Free note tab
  html += '<div class="note-tab-content" id="noteTab_free" style="display:block;">' +
    '<div class="note-input-area">' +
      '<textarea id="newNoteText" placeholder="Yeni seans notu yazın..."></textarea>' +
      '<button class="btn btn-primary" onclick="addNote(\'' + clientId + '\')">Ekle</button>' +
    '</div>' +
  '</div>';

  // SOAP tab
  html += '<div class="note-tab-content" id="noteTab_soap" style="display:none;">' +
    renderStructuredNoteForm('soap') +
    '<div style="text-align:right;margin-top:var(--space-3);"><button class="btn btn-primary" onclick="saveSoapNote(\'' + clientId + '\')">SOAP Notu Kaydet</button></div>' +
  '</div>';

  // Risk tab
  html += '<div class="note-tab-content" id="noteTab_risk" style="display:none;">' +
    renderStructuredNoteForm('risk') +
    '<div style="text-align:right;margin-top:var(--space-3);"><button class="btn btn-primary" onclick="saveRiskNote(\'' + clientId + '\')">Risk Notu Kaydet</button></div>' +
  '</div>';

  // Plan tab
  html += '<div class="note-tab-content" id="noteTab_plan" style="display:none;">' +
    renderStructuredNoteForm('plan') +
    '<div style="text-align:right;margin-top:var(--space-3);"><button class="btn btn-primary" onclick="savePlanNote(\'' + clientId + '\')">Tedavi Planı Kaydet</button></div>' +
  '</div>';

  // Combined note timeline
  html += '<h4 style="font-family:var(--font-display);font-size:var(--text-sm);font-weight:600;margin-top:var(--space-6);margin-bottom:var(--space-3);">Tüm Notlar</h4>';
  html += renderNoteTimeline(notes, structuredNotes);
  html += '</div>';

  // ---- Homework Section ----
  html += '<div style="margin-top:var(--space-6);">' +
    '<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:var(--space-4);">' +
      '<h3 class="section-title" style="margin-bottom:0;">Ödevler</h3>' +
      '<button class="btn btn-primary btn-sm" onclick="toggleHomeworkForm(\'' + clientId + '\')">Ödev Ver</button>' +
    '</div>' +
    '<div id="homeworkFormArea" style="display:none;background:var(--color-surface-2);padding:var(--space-4);border-radius:var(--radius-lg);margin-bottom:var(--space-4);">' +
      '<div class="form-group"><label>Başlık</label><input type="text" id="hwTitle" class="form-input" placeholder="Ödev başlığı"></div>' +
      '<div class="form-group"><label>Açıklama</label><textarea id="hwDesc" class="form-input" rows="2" placeholder="Ödev açıklaması..."></textarea></div>' +
      '<div class="form-group"><label>Son Tarih</label><input type="date" id="hwDueDate" class="form-input"></div>' +
      '<div style="text-align:right;"><button class="btn btn-primary btn-sm" onclick="submitHomework(\'' + clientId + '\')">Kaydet</button></div>' +
    '</div>';

  if (homeworkList.length === 0) {
    html += '<p style="color:var(--color-text-muted);font-size:var(--text-sm);text-align:center;padding:var(--space-4);">Henüz ödev atanmamış.</p>';
  } else {
    homeworkList.forEach(function(hw) {
      var statusClass = hw.status === 'completed' ? 'homework-status-completed' : 'homework-status-pending';
      var statusLabel = hw.status === 'completed' ? 'Tamamlandı' : 'Bekliyor';
      html += '<div class="homework-card">' +
        '<div class="homework-header">' +
          '<span class="homework-title">' + esc(hw.title) + '</span>' +
          '<div style="display:flex;gap:var(--space-2);align-items:center;">' +
            '<span class="homework-status ' + statusClass + '">' + statusLabel + '</span>' +
            '<button class="btn btn-ghost btn-sm" onclick="deleteHomework(' + hw.id + ').then(function(){showClientDetail(\'' + clientId + '\')})" title="Sil" style="color:var(--color-error);padding:var(--space-1);">' +
              '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 6h18"/><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"/><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"/></svg></button>' +
          '</div>' +
        '</div>' +
        (hw.description ? '<div class="homework-desc">' + esc(hw.description) + '</div>' : '') +
        (hw.due_date ? '<div class="homework-due">Son tarih: ' + formatSessionDate(hw.due_date) + '</div>' : '') +
        (hw.client_response ? '<div class="homework-response" style="border-top:1px solid var(--color-divider);margin-top:var(--space-2);padding-top:var(--space-2);"><div style="font-size:var(--text-xs);color:var(--color-text-muted);margin-bottom:var(--space-1);">Danışan Yanıtı:</div><div style="font-size:var(--text-sm);">' + esc(hw.client_response) + '</div></div>' : '') +
      '</div>';
    });
  }
  html += '</div>';

  // ---- Shared Journals Section ----
  html += '<div style="margin-top:var(--space-6);">' +
    '<h3 class="section-title">Paylaşılan Günlükler</h3>';

  if (sharedJournals.length === 0) {
    html += '<p style="color:var(--color-text-muted);font-size:var(--text-sm);text-align:center;padding:var(--space-4);">Danışan henüz paylaşılan günlük yazmamış.</p>';
  } else {
    sharedJournals.forEach(function(j) {
      html += '<div class="journal-entry">' +
        '<div class="journal-header">' +
          '<span class="journal-title">' + esc(j.title || 'Başlıksız') + '</span>' +
          '<span class="journal-date">' + formatDate(j.created_at) + '</span>' +
        '</div>' +
        '<div class="journal-content">' + esc(j.content) + '</div>' +
      '</div>';
    });
  }
  html += '</div>';

  detailEl.innerHTML = html;
}

// Helper to toggle homework form
function toggleHomeworkForm(clientId) {
  var form = document.getElementById('homeworkFormArea');
  form.style.display = form.style.display === 'none' ? 'block' : 'none';
}

// Helper to submit homework from expert view
async function submitHomework(clientId) {
  var title = document.getElementById('hwTitle').value.trim();
  var desc = document.getElementById('hwDesc').value.trim();
  var dueDate = document.getElementById('hwDueDate').value;
  var ok = await saveHomework(clientId, title, desc, dueDate);
  if (ok) showClientDetail(clientId);
}

// Helpers to save structured notes from forms
async function saveSoapNote(clientId) {
  var data = {
    session_date: document.getElementById('soapDate').value,
    subjective: document.getElementById('soapS').value.trim(),
    objective: document.getElementById('soapO').value.trim(),
    assessment: document.getElementById('soapA').value.trim(),
    plan: document.getElementById('soapP').value.trim()
  };
  if (!data.subjective && !data.objective && !data.assessment && !data.plan) { showToast('Lütfen en az bir alan doldurun.'); return; }
  var ok = await saveStructuredNote(clientId, 'soap', data);
  if (ok) showClientDetail(clientId);
}

async function saveRiskNote(clientId) {
  var data = {
    session_date: document.getElementById('riskDate').value,
    risk_level: document.getElementById('riskLevel').value,
    risk_details: document.getElementById('riskDetails').value.trim()
  };
  if (!data.risk_level) { showToast('Lütfen risk seviyesi seçin.'); return; }
  var ok = await saveStructuredNote(clientId, 'risk', data);
  if (ok) showClientDetail(clientId);
}

async function savePlanNote(clientId) {
  var data = {
    session_date: document.getElementById('planDate').value,
    goals: document.getElementById('planGoals').value.trim(),
    interventions: document.getElementById('planInterventions').value.trim(),
    next_session_goals: document.getElementById('planNextGoals').value.trim()
  };
  if (!data.goals && !data.interventions && !data.next_session_goals) { showToast('Lütfen en az bir alan doldurun.'); return; }
  var ok = await saveStructuredNote(clientId, 'plan', data);
  if (ok) showClientDetail(clientId);
}

function backToExpertList() {
  var expertClientList = document.getElementById("expertClientList");
  if (expertClientList) expertClientList.style.display = "grid";
  var upcomingSection = document.querySelector(".upcoming-sessions-section");
  if (upcomingSection) upcomingSection.style.display = "";
  var adminMsgSection = document.querySelector(".admin-message-section");
  if (adminMsgSection) adminMsgSection.style.display = "";
  document.querySelector(".page-header").style.display = "flex";
  var detailEl = document.getElementById("clientDetailView");
  detailEl.classList.remove("active");
  detailEl.innerHTML = "";
}

async function addNote(clientId) {
  var textarea = document.getElementById("newNoteText");
  var text = textarea.value.trim();
  if (!text) { showToast("Lütfen not yazın."); return; }

  var ins = await sb.from("notes").insert({
    expert_id: currentProfile.id,
    client_id: clientId,
    content: text
  });

  if (ins.error) { showToast("Hata: " + ins.error.message); return; }
  showToast("Not eklendi");
  showClientDetail(clientId);
}

// ==================== CLIENT VIEW ====================
async function renderClientView() {
  var main = document.getElementById("mainContent");
  main.innerHTML = '<div class="empty-state"><div class="loading-spinner"></div><p>Yükleniyor...</p></div>';

  var assignRes = await sb.from("assignments").select("*, expert:expert_id(id, full_name, specialty, email)").eq("client_id", currentProfile.id);
  var assignment = (assignRes.data || [])[0];

  // Load upcoming sessions for this client
  var today = new Date().toISOString().split("T")[0];
  var sessionsRes = await sb.from("scheduled_sessions")
    .select("*, expert:expert_id(id, full_name)")
    .eq("client_id", currentProfile.id)
    .gte("session_date", today)
    .order("session_date")
    .order("start_time");
  var upcomingSessions = sessionsRes.data || [];

  var html = '<div class="page-header"><h2 class="page-title">Hoş Geldiniz, ' + esc(currentProfile.full_name.split(" ")[0]) + '</h2></div>';

  if (!assignment || !assignment.expert) {
    html += '<div class="empty-state"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><circle cx="12" cy="12" r="10"/><path d="M12 8v4"/><path d="M12 16h.01"/></svg><h3>Henüz bir uzman atanmadı</h3><p>Size bir uzman atandığında burada görüşme bilgileri görünecektir.</p></div>';
  } else {
    var expert = assignment.expert;
    html +=
      '<div class="card" style="max-width:480px;">' +
        '<div class="card-header"><h3 class="card-title">Uzmanınız</h3></div>' +
        '<div style="display:flex;align-items:center;gap:var(--space-4);margin-bottom:var(--space-5);">' +
          '<div class="user-card-avatar expert-avatar" style="width:56px;height:56px;font-size:var(--text-lg);">' + getInitials(expert.full_name) + '</div>' +
          '<div><div style="font-weight:600;font-size:var(--text-base);">' + esc(expert.full_name) + '</div><div style="font-size:var(--text-sm);color:var(--color-text-muted);">' + esc(expert.specialty || "") + '</div>' + (expert.areas_of_expertise ? '<div class="expert-areas" style="margin-top:4px;">' + expert.areas_of_expertise.split(",").map(function(a){return '<span class="area-tag">' + esc(a.trim()) + '</span>';}).join("") + '</div>' : '') + '</div>' +
        '</div>' +
        '<button class="btn btn-primary btn-full" onclick="startVideoCall(\'' + escAttr(expert.id) + '\',\'' + escAttr(expert.full_name) + '\')">' +
          '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="m22 8-6 4 6 4V8Z"/><rect width="14" height="12" x="2" y="6" rx="2"/></svg> Görüntülü Görüşme Başlat</button>' +
      '</div>';

    // Upcoming sessions for client
    html += '<div class="upcoming-sessions-section" style="max-width:480px;margin-top:var(--space-6);">';
    html += '<h3 class="section-title">Yaklaşan Seanslar</h3>';

    if (upcomingSessions.length === 0) {
      html += '<p class="no-sessions-msg">Yaklaşan planlanmış seans bulunmuyor.</p>';
    } else {
      html += '<div class="session-list session-list-compact">';
      upcomingSessions.forEach(function(sess) {
        var expertName = sess.expert ? sess.expert.full_name : "?";
        var statusClass = sess.status === "completed" ? "session-status-completed" : sess.status === "cancelled" ? "session-status-cancelled" : "session-status-planned";
        var statusLabel = sess.status === "completed" ? "Tamamlandı" : sess.status === "cancelled" ? "İptal" : "Planlandı";
        html +=
          '<div class="session-card session-card-compact">' +
            '<div class="session-card-date">' +
              '<div class="session-day">' + formatSessionDate(sess.session_date) + '</div>' +
              '<div class="session-time">' + sess.start_time.substring(0, 5) + ' – ' + sess.end_time.substring(0, 5) + '</div>' +
            '</div>' +
            '<div class="session-card-info">' +
              '<div class="session-names"><span class="session-expert">' + esc(expertName) + '</span></div>' +
            '</div>' +
            '<span class="session-status ' + statusClass + '">' + statusLabel + '</span>' +
          '</div>';
      });
      html += '</div>';
    }
    html += '</div>';
  }

  main.innerHTML = html;
}

// ==================== VIDEO CALL (Jitsi — meet.jit.si FREE server) ====================
var jitsiApi = null;

function startVideoCall(remoteId, remoteName) {
  // Build a stable room name based on the two participant IDs (sorted for consistency)
  var ids = [currentProfile.id.substring(0, 8), (remoteId || "").substring(0, 8)].sort();
  var roomName = "danisanagi-" + ids.join("-");

  document.getElementById("videoCallScreen").classList.add("active");

  // Remove any previously injected Jitsi script to avoid conflicts
  var oldScript = document.getElementById("jitsiScript");
  if (oldScript) oldScript.remove();

  // Load meet.jit.si External API
  var container = document.getElementById("jitsiContainer");
  container.innerHTML = "";

  var script = document.createElement("script");
  script.id = "jitsiScript";
  script.src = "https://meet.jit.si/external_api.js";

  script.onload = function() {
    /* global JitsiMeetExternalAPI */
    jitsiApi = new JitsiMeetExternalAPI("meet.jit.si", {
      roomName: roomName,
      parentNode: container,
      width: "100%",
      height: "100%",
      userInfo: {
        displayName: currentProfile.full_name
      },
      configOverwrite: {
        startWithAudioMuted: false,
        startWithVideoMuted: false,
        prejoinPageEnabled: false,
        disableDeepLinking: true
      },
      interfaceConfigOverwrite: {
        SHOW_JITSI_WATERMARK: false,
        TOOLBAR_ALWAYS_VISIBLE: true
      }
    });

    jitsiApi.addListener("readyToClose", function() {
      endVideoCall();
    });
  };

  script.onerror = function() {
    // Fallback: open meet.jit.si in new tab
    container.innerHTML =
      '<div style="display:flex;flex-direction:column;align-items:center;justify-content:center;height:100%;color:#fff;text-align:center;padding:var(--space-8);">' +
        '<p style="margin-bottom:var(--space-4);">Jitsi yüklenemedi. Görüşmeyi yeni sekmede açabilirsiniz:</p>' +
        '<a href="https://meet.jit.si/' + roomName + '" target="_blank" rel="noopener noreferrer" style="color:var(--color-secondary);font-size:var(--text-lg);">Görüşmeye Katıl</a>' +
      '</div>';
  };

  document.head.appendChild(script);
  showToast((remoteName || "Karşı taraf") + " ile görüşme odası oluşturuldu");
}

function endVideoCall() {
  if (jitsiApi) {
    jitsiApi.dispose();
    jitsiApi = null;
  }
  document.getElementById("jitsiContainer").innerHTML = "";
  document.getElementById("videoCallScreen").classList.remove("active");
  showToast("Görüşme sonlandırıldı");
}

// ==================== HELPERS ====================
function getInitials(name) {
  return name.split(" ").map(function(w) { return w.charAt(0).toUpperCase(); }).slice(0, 2).join("");
}

function esc(str) {
  var div = document.createElement("div");
  div.appendChild(document.createTextNode(str || ""));
  return div.innerHTML;
}

function escAttr(str) {
  // Escape for use inside onclick='...' attributes (handles quotes)
  return (str || "").replace(/&/g, "&amp;").replace(/'/g, "&#39;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function formatDate(dateStr) {
  var d = new Date(dateStr);
  var months = ["Ocak","Şubat","Mart","Nisan","Mayıs","Haziran","Temmuz","Ağustos","Eylül","Ekim","Kasım","Aralık"];
  return d.getDate() + " " + months[d.getMonth()] + " " + d.getFullYear() + ", " +
    String(d.getHours()).padStart(2, "0") + ":" + String(d.getMinutes()).padStart(2, "0");
}

function formatSessionDate(dateStr) {
  // dateStr is YYYY-MM-DD
  var parts = dateStr.split("-");
  var d = new Date(parseInt(parts[0]), parseInt(parts[1]) - 1, parseInt(parts[2]));
  var days = ["Paz","Pzt","Sal","Çar","Per","Cum","Cmt"];
  var months = ["Oca","Şub","Mar","Nis","May","Haz","Tem","Ağu","Eyl","Eki","Kas","Ara"];
  return days[d.getDay()] + " " + d.getDate() + " " + months[d.getMonth()];
}

function showToast(message) {
  var toast = document.getElementById("toast");
  toast.textContent = message;
  toast.classList.add("show");
  setTimeout(function() { toast.classList.remove("show"); }, 2500);
}

function filterList(query, listId) {
  var q = query.toLowerCase();
  document.querySelectorAll("#" + listId + " .user-card").forEach(function(card) {
    var name = card.getAttribute("data-name") || "";
    card.style.display = name.indexOf(q) !== -1 ? "" : "none";
  });
}

function openModal(id) { document.getElementById(id).classList.add("active"); }
function closeModal(id) { document.getElementById(id).classList.remove("active"); }

// Close modals
document.querySelectorAll(".modal-overlay").forEach(function(overlay) {
  overlay.addEventListener("click", function(e) {
    if (e.target === overlay) overlay.classList.remove("active");
  });
});

document.addEventListener("keydown", function(e) {
  if (e.key === "Escape") {
    document.querySelectorAll(".modal-overlay.active").forEach(function(m) { m.classList.remove("active"); });
    if (document.getElementById("videoCallScreen").classList.contains("active")) endVideoCall();
  }
});

// Enter to login
document.getElementById("loginPassword").addEventListener("keydown", function(e) {
  if (e.key === "Enter") handleLogin();
});

// ==================== MESSAGING SYSTEM ====================
var currentChatPartnerId = null;
var currentChatPartnerName = null;
var messagePollingInterval = null;

function openMessaging(partnerId, partnerName) {
  currentChatPartnerId = partnerId;
  currentChatPartnerName = partnerName;
  document.getElementById("chatPartnerName").textContent = partnerName;
  document.getElementById("chatPartnerAvatar").textContent = getInitials(partnerName);
  document.getElementById("chatInput").value = "";
  clearPendingFile();
  loadMessages(partnerId);
  openModal("messageModal");
  // Poll for new messages every 5 seconds
  if (messagePollingInterval) clearInterval(messagePollingInterval);
  messagePollingInterval = setInterval(function() { loadMessages(partnerId, true); }, 5000);
}

function closeMessaging() {
  if (messagePollingInterval) { clearInterval(messagePollingInterval); messagePollingInterval = null; }
  currentChatPartnerId = null;
  currentChatPartnerName = null;
  closeModal("messageModal");
}

async function loadMessages(partnerId, silent) {
  var container = document.getElementById("chatMessages");
  if (!silent) {
    container.innerHTML = '<div style="text-align:center;padding:var(--space-6);color:var(--color-text-faint);"><div class="loading-spinner"></div></div>';
  }

  var myId = currentProfile.id;
  // Get messages between current user and partner
  var res = await sb.from("messages").select("*")
    .or("and(sender_id.eq." + myId + ",receiver_id.eq." + partnerId + "),and(sender_id.eq." + partnerId + ",receiver_id.eq." + myId + ")")
    .order("created_at", { ascending: true });

  var messages = res.data || [];

  if (messages.length === 0) {
    container.innerHTML = '<div class="chat-empty"><svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg><p>Henüz mesaj yok. İlk mesajı gönderin.</p></div>';
    return;
  }

  var html = '';
  var lastDate = '';
  messages.forEach(function(msg) {
    var msgDate = new Date(msg.created_at);
    var dateStr = formatSessionDate(msgDate.getFullYear() + '-' + String(msgDate.getMonth() + 1).padStart(2, '0') + '-' + String(msgDate.getDate()).padStart(2, '0'));
    if (dateStr !== lastDate) {
      html += '<div class="chat-date-divider"><span>' + dateStr + '</span></div>';
      lastDate = dateStr;
    }
    var isMine = msg.sender_id === myId;
    var timeStr = String(msgDate.getHours()).padStart(2, '0') + ':' + String(msgDate.getMinutes()).padStart(2, '0');
    html += '<div class="chat-bubble ' + (isMine ? 'chat-mine' : 'chat-theirs') + '">' +
      renderFileInBubble(msg) +
      (msg.content ? '<div class="chat-bubble-text">' + esc(msg.content) + '</div>' : '') +
      '<div class="chat-bubble-time">' + timeStr + '</div>' +
    '</div>';
  });

  container.innerHTML = html;
  // Scroll to bottom
  container.scrollTop = container.scrollHeight;

  // Mark unread messages as read
  var unreadIds = messages.filter(function(m) { return m.receiver_id === myId && !m.is_read; }).map(function(m) { return m.id; });
  if (unreadIds.length > 0) {
    await sb.from("messages").update({ is_read: true }).in("id", unreadIds);
  }
}

async function sendMessage() {
  var input = document.getElementById("chatInput");
  var text = input.value.trim();

  // Ne metin ne dosya varsa gönderme
  if (!text && !pendingFile) return;
  if (!currentChatPartnerId) return;

  var fileUrl = null;
  var fileName = null;
  var fileType = null;

  // Dosya varsa önce yükle
  if (pendingFile) {
    showToast("Dosya yükleniyor...");
    var uploadResult = await uploadChatFile(pendingFile);
    if (!uploadResult) {
      showToast("Dosya yüklenemedi.");
      return;
    }
    fileUrl = uploadResult.url;
    fileName = uploadResult.name;
    fileType = uploadResult.type;
    clearPendingFile();
  }

  input.value = '';
  input.focus();

  var msgData = {
    sender_id: currentProfile.id,
    receiver_id: currentChatPartnerId,
    content: text || null,
    file_url: fileUrl,
    file_name: fileName,
    file_type: fileType
  };

  var res = await sb.from("messages").insert(msgData);

  if (res.error) {
    showToast("Mesaj gönderilemedi: " + res.error.message);
    return;
  }

  loadMessages(currentChatPartnerId, true);
}

// ==================== FILE SHARING ====================
function handleFileSelect(input) {
  var file = input.files[0];
  if (!file) return;

  // Max 10MB
  if (file.size > 10 * 1024 * 1024) {
    showToast("Dosya boyutu 10MB'dan küçük olmalıdır.");
    input.value = '';
    return;
  }

  pendingFile = file;
  showFilePreview(file);
}

function showFilePreview(file) {
  var preview = document.getElementById("chatFilePreview");
  var isImage = file.type.startsWith('image/');

  if (isImage) {
    var reader = new FileReader();
    reader.onload = function(e) {
      preview.innerHTML =
        '<div class="file-preview-card">' +
          '<img src="' + e.target.result + '" class="file-preview-img" alt="Önizleme">' +
          '<div class="file-preview-info">' +
            '<span class="file-preview-name">' + esc(file.name) + '</span>' +
            '<span class="file-preview-size">' + formatFileSize(file.size) + '</span>' +
          '</div>' +
          '<button class="btn btn-ghost btn-sm file-preview-remove" onclick="clearPendingFile()" title="Kaldır">' +
            '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>' +
          '</button>' +
        '</div>';
    };
    reader.readAsDataURL(file);
  } else {
    preview.innerHTML =
      '<div class="file-preview-card">' +
        '<div class="file-preview-icon">' + getFileIcon(file.name) + '</div>' +
        '<div class="file-preview-info">' +
          '<span class="file-preview-name">' + esc(file.name) + '</span>' +
          '<span class="file-preview-size">' + formatFileSize(file.size) + '</span>' +
        '</div>' +
        '<button class="btn btn-ghost btn-sm file-preview-remove" onclick="clearPendingFile()" title="Kaldır">' +
          '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>' +
        '</button>' +
      '</div>';
  }

  preview.style.display = 'block';
}

function clearPendingFile() {
  pendingFile = null;
  var preview = document.getElementById("chatFilePreview");
  preview.innerHTML = '';
  preview.style.display = 'none';
  var fileInput = document.getElementById("chatFileInput");
  if (fileInput) fileInput.value = '';
}

async function uploadChatFile(file) {
  var ext = file.name.split('.').pop();
  var safeName = Date.now() + '_' + Math.random().toString(36).substring(2, 8) + '.' + ext;
  var path = currentProfile.id + '/' + safeName;

  var res = await sb.storage.from('chat-files').upload(path, file, {
    cacheControl: '3600',
    upsert: false
  });

  if (res.error) {
    console.error('Upload error:', res.error);
    return null;
  }

  var urlRes = sb.storage.from('chat-files').getPublicUrl(path);
  return {
    url: urlRes.data.publicUrl,
    name: file.name,
    type: file.type
  };
}

function formatFileSize(bytes) {
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return Math.round(bytes / 1024) + ' KB';
  return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
}

function getFileIcon(filename) {
  var ext = (filename.split('.').pop() || '').toLowerCase();
  if (['pdf'].includes(ext)) return '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#e74c3c" stroke-width="1.5"><path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5L14.5 2z"/><polyline points="14 2 14 8 20 8"/><path d="M10 12h4"/><path d="M10 16h4"/></svg>';
  if (['doc','docx'].includes(ext)) return '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#2b579a" stroke-width="1.5"><path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5L14.5 2z"/><polyline points="14 2 14 8 20 8"/><line x1="8" y1="13" x2="16" y2="13"/><line x1="8" y1="17" x2="16" y2="17"/></svg>';
  if (['xls','xlsx'].includes(ext)) return '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#217346" stroke-width="1.5"><path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5L14.5 2z"/><polyline points="14 2 14 8 20 8"/><rect x="8" y="12" width="8" height="6" rx="1"/></svg>';
  return '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5L14.5 2z"/><polyline points="14 2 14 8 20 8"/></svg>';
}

function renderFileInBubble(msg) {
  if (!msg.file_url) return '';
  var isImage = (msg.file_type || '').startsWith('image/');
  var fname = msg.file_name || 'Dosya';

  if (isImage) {
    return '<div class="chat-file-attachment">' +
      '<a href="' + esc(msg.file_url) + '" target="_blank" rel="noopener">' +
        '<img src="' + esc(msg.file_url) + '" class="chat-file-image" alt="' + esc(fname) + '" loading="lazy">' +
      '</a>' +
    '</div>';
  }

  return '<div class="chat-file-attachment chat-file-doc">' +
    '<a href="' + esc(msg.file_url) + '" target="_blank" rel="noopener" class="chat-file-link">' +
      getFileIcon(fname) +
      '<span class="chat-file-name">' + esc(fname) + '</span>' +
      '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>' +
    '</a>' +
  '</div>';
}

async function getUnreadCount(partnerId) {
  var res = await sb.from("messages").select("id", { count: "exact", head: true })
    .eq("receiver_id", currentProfile.id)
    .eq("sender_id", partnerId)
    .eq("is_read", false);
  return res.count || 0;
}

// ==================== SESSION NOTES HISTORY ====================
var currentSessionNoteClientId = null;

async function showSessionNotes(clientId, clientName) {
  currentSessionNoteClientId = clientId;
  document.getElementById("sessionNotesTitle").textContent = clientName + " — Seans Notları";
  document.getElementById("sessionNoteDate").value = new Date().toISOString().split('T')[0];
  document.getElementById("sessionNoteTitle").value = "";
  document.getElementById("sessionNoteContent").value = "";
  await loadSessionNotes(clientId);
  openModal("sessionNotesModal");
}

async function loadSessionNotes(clientId) {
  var container = document.getElementById("sessionNotesList");
  container.innerHTML = '<div style="text-align:center;padding:var(--space-4);color:var(--color-text-faint);"><div class="loading-spinner"></div></div>';

  var res = await sb.from("session_notes").select("*")
    .eq("expert_id", currentProfile.id)
    .eq("client_id", clientId)
    .order("session_date", { ascending: false });

  var notes = res.data || [];

  if (notes.length === 0) {
    container.innerHTML = '<div style="text-align:center;padding:var(--space-6);color:var(--color-text-faint);font-size:var(--text-sm);">Henüz seans notu eklenmemiş.</div>';
    return;
  }

  var html = '';
  notes.forEach(function(note) {
    html += '<div class="session-note-entry">' +
      '<div class="session-note-header">' +
        '<div class="session-note-date-badge">' + formatSessionDate(note.session_date) + '</div>' +
        (note.title ? '<div class="session-note-entry-title">' + esc(note.title) + '</div>' : '') +
        '<button class="btn btn-ghost btn-sm" onclick="deleteSessionNote(' + note.id + ')" title="Sil" style="color:var(--color-error);margin-left:auto;padding:var(--space-1);">' +
          '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 6h18"/><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"/><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"/></svg></button>' +
      '</div>' +
      '<div class="session-note-body">' + esc(note.content) + '</div>' +
    '</div>';
  });

  container.innerHTML = html;
}

async function saveSessionNote() {
  var date = document.getElementById("sessionNoteDate").value;
  var title = document.getElementById("sessionNoteTitle").value.trim();
  var content = document.getElementById("sessionNoteContent").value.trim();

  if (!date || !content) {
    showToast("Tarih ve not içeriği zorunludur.");
    return;
  }

  var res = await sb.from("session_notes").insert({
    expert_id: currentProfile.id,
    client_id: currentSessionNoteClientId,
    session_date: date,
    title: title || null,
    content: content
  });

  if (res.error) {
    showToast("Hata: " + res.error.message);
    return;
  }

  showToast("Seans notu eklendi");
  document.getElementById("sessionNoteTitle").value = "";
  document.getElementById("sessionNoteContent").value = "";
  loadSessionNotes(currentSessionNoteClientId);
}

async function deleteSessionNote(noteId) {
  if (!confirm("Bu seans notunu silmek istediğinize emin misiniz?")) return;
  var res = await sb.from("session_notes").delete().eq("id", noteId);
  if (res.error) {
    showToast("Hata: " + res.error.message);
    return;
  }
  showToast("Seans notu silindi");
  loadSessionNotes(currentSessionNoteClientId);
}

// ==================== ADMIN DASHBOARD ====================
async function renderAdminDashboardTab() {
  var container = document.getElementById("adminTabContent");
  container.innerHTML = '<div class="empty-state"><div class="loading-spinner"></div><p>Yükleniyor...</p></div>';

  var d = window._adminData;
  var today = new Date();
  var todayStr = today.toISOString().split('T')[0];

  // Get this week boundaries (Monday to Sunday)
  var dayOfWeek = today.getDay();
  var mondayOffset = dayOfWeek === 0 ? -6 : 1 - dayOfWeek;
  var monday = new Date(today);
  monday.setDate(today.getDate() + mondayOffset);
  var sunday = new Date(monday);
  sunday.setDate(monday.getDate() + 6);
  var mondayStr = monday.toISOString().split('T')[0];
  var sundayStr = sunday.toISOString().split('T')[0];

  // Fetch scheduled sessions for stats
  var allSessionsRes = await sb.from("scheduled_sessions").select("*");
  var allSessions = allSessionsRes.data || [];

  var todaySessions = allSessions.filter(function(s) { return s.session_date === todayStr; });
  var weekSessions = allSessions.filter(function(s) { return s.session_date >= mondayStr && s.session_date <= sundayStr; });
  var plannedSessions = allSessions.filter(function(s) { return s.status === 'planned' && s.session_date >= todayStr; });
  var completedSessions = allSessions.filter(function(s) { return s.status === 'completed'; });

  // Fetch messages count
  var messagesRes = await sb.from("messages").select("id", { count: "exact", head: true });
  var totalMessages = messagesRes.count || 0;

  // Fetch session_notes count
  var sessionNotesRes = await sb.from("session_notes").select("id", { count: "exact", head: true });
  var totalSessionNotes = sessionNotesRes.count || 0;

  var html =
    '<h2 class="section-title">Gösterge Paneli</h2>' +
    // Row 1: Key Stats
    '<div class="dashboard-grid">' +
      '<div class="dash-card dash-card-highlight">' +
        '<div class="dash-icon">📅</div>' +
        '<div class="dash-value">' + todaySessions.length + '</div>' +
        '<div class="dash-label">Bugünkü Seans</div>' +
      '</div>' +
      '<div class="dash-card">' +
        '<div class="dash-icon">📊</div>' +
        '<div class="dash-value">' + weekSessions.length + '</div>' +
        '<div class="dash-label">Bu Hafta</div>' +
      '</div>' +
      '<div class="dash-card">' +
        '<div class="dash-icon">⏳</div>' +
        '<div class="dash-value">' + plannedSessions.length + '</div>' +
        '<div class="dash-label">Bekleyen Seans</div>' +
      '</div>' +
      '<div class="dash-card">' +
        '<div class="dash-icon">✅</div>' +
        '<div class="dash-value">' + completedSessions.length + '</div>' +
        '<div class="dash-label">Tamamlanan</div>' +
      '</div>' +
    '</div>' +
    // Row 2: More stats
    '<div class="dashboard-grid dashboard-grid-3">' +
      '<div class="dash-card">' +
        '<div class="dash-icon">👥</div>' +
        '<div class="dash-value">' + d.experts.length + ' / ' + d.clients.length + '</div>' +
        '<div class="dash-label">Uzman / Danışan</div>' +
      '</div>' +
      '<div class="dash-card">' +
        '<div class="dash-icon">💬</div>' +
        '<div class="dash-value">' + totalMessages + '</div>' +
        '<div class="dash-label">Toplam Mesaj</div>' +
      '</div>' +
      '<div class="dash-card">' +
        '<div class="dash-icon">📝</div>' +
        '<div class="dash-value">' + (d.notes.length + totalSessionNotes) + '</div>' +
        '<div class="dash-label">Toplam Not</div>' +
      '</div>' +
    '</div>';

  // Upcoming sessions today
  if (todaySessions.length > 0) {
    html += '<h3 class="section-title" style="margin-top:var(--space-6);">Bugünkü Seanslar</h3>';
    html += '<div class="session-list session-list-compact">';
    todaySessions.forEach(function(sess) {
      var expert = d.experts.find(function(e) { return e.id === sess.expert_id; });
      var client = d.clients.find(function(c) { return c.id === sess.client_id; });
      html +=
        '<div class="session-card session-card-compact">' +
          '<div class="session-card-date">' +
            '<div class="session-time">' + sess.start_time.substring(0, 5) + ' – ' + sess.end_time.substring(0, 5) + '</div>' +
          '</div>' +
          '<div class="session-card-info">' +
            '<div class="session-names">' +
              '<span class="session-expert">' + esc(expert ? expert.full_name : "?") + '</span>' +
              '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M5 12h14"/><path d="m12 5 7 7-7 7"/></svg>' +
              '<span class="session-client">' + esc(client ? client.full_name : "?") + '</span>' +
            '</div>' +
          '</div>' +
        '</div>';
    });
    html += '</div>';
  }

  // Expert workload breakdown
  html += '<h3 class="section-title" style="margin-top:var(--space-6);">Uzman İş Yükü</h3>';
  html += '<div class="workload-list">';
  d.experts.forEach(function(expert) {
    var clientCount = d.assignments.filter(function(a) { return a.expert_id === expert.id; }).length;
    var expertSessions = allSessions.filter(function(s) { return s.expert_id === expert.id && s.session_date >= todayStr && s.status === 'planned'; }).length;
    var maxBar = Math.max(clientCount, 1);
    html +=
      '<div class="workload-row">' +
        '<div class="workload-name">' +
          '<div class="user-card-avatar expert-avatar" style="width:32px;height:32px;font-size:var(--text-xs);">' + getInitials(expert.full_name) + '</div>' +
          '<span>' + esc(expert.full_name) + '</span>' +
        '</div>' +
        '<div class="workload-stats">' +
          '<span class="workload-badge">' + clientCount + ' danışan</span>' +
          '<span class="workload-badge workload-badge-alt">' + expertSessions + ' yaklaşan seans</span>' +
        '</div>' +
      '</div>';
  });
  html += '</div>';

  container.innerHTML = html;
}

// ==================== MOOD TRACKING FUNCTIONS ====================
var selectedMoodScore = null;
var selectedMoodLabel = '';

function selectMood(score, label) {
  selectedMoodScore = score;
  selectedMoodLabel = label;
  document.querySelectorAll('.mood-emoji-btn').forEach(function(btn) {
    btn.classList.remove('selected');
    if (btn.getAttribute('data-score') === String(score)) {
      btn.classList.add('selected');
    }
  });
}

async function saveMoodEntry(score, label, note) {
  if (!score) { showToast('Lütfen bir duygu seçin.'); return; }
  var res = await sb.from('mood_entries').insert({
    client_id: currentProfile.id,
    mood_score: score,
    mood_label: label,
    note: note || null
  });
  if (res.error) { showToast('Hata: ' + res.error.message); return; }
  showToast('Ruh haliniz kaydedildi');
  selectedMoodScore = null;
  selectedMoodLabel = '';
  renderClientView();
}

async function loadMoodEntries(clientId, days) {
  var since = new Date();
  since.setDate(since.getDate() - days);
  var res = await sb.from('mood_entries').select('*')
    .eq('client_id', clientId)
    .gte('created_at', since.toISOString())
    .order('created_at', { ascending: true });
  return res.data || [];
}

function renderMoodSelector() {
  return '<div class="mood-selector">' +
    '<button class="mood-emoji-btn" data-score="2" onclick="selectMood(2,\'Çok Kötü\')" title="Çok Kötü">😞</button>' +
    '<button class="mood-emoji-btn" data-score="4" onclick="selectMood(4,\'Kötü\')" title="Kötü">😕</button>' +
    '<button class="mood-emoji-btn" data-score="5" onclick="selectMood(5,\'Orta\')" title="Orta">😐</button>' +
    '<button class="mood-emoji-btn" data-score="7" onclick="selectMood(7,\'İyi\')" title="İyi">🙂</button>' +
    '<button class="mood-emoji-btn" data-score="9" onclick="selectMood(9,\'Çok İyi\')" title="Çok İyi">😊</button>' +
  '</div>';
}

function getMoodEmoji(score) {
  if (score <= 2) return '😞';
  if (score <= 4) return '😕';
  if (score <= 5) return '😐';
  if (score <= 7) return '🙂';
  return '😊';
}

function getMoodColor(score) {
  if (score <= 2) return '#c0392b';
  if (score <= 4) return '#e67e22';
  if (score <= 5) return '#f1c40f';
  if (score <= 7) return '#27ae60';
  return '#2ecc71';
}

function renderMoodTimeline(entries) {
  if (!entries || entries.length === 0) {
    return '<p style="font-size:var(--text-xs);color:var(--color-text-faint);text-align:center;padding:var(--space-3);">Henüz duygu kaydı yok.</p>';
  }
  var last7 = entries.slice(-7);
  var html = '<div class="mood-timeline">';
  last7.forEach(function(e) {
    var d = new Date(e.created_at);
    var dayNames = ['Paz','Pzt','Sal','Çar','Per','Cum','Cmt'];
    var dateLabel = dayNames[d.getDay()] + ' ' + d.getDate();
    html += '<div class="mood-timeline-item">' +
      '<div class="mood-timeline-emoji" title="' + esc(e.mood_label || '') + ' (' + e.mood_score + ')">' + getMoodEmoji(e.mood_score) + '</div>' +
      '<div class="mood-timeline-date">' + dateLabel + '</div>' +
    '</div>';
  });
  html += '</div>';
  return html;
}

function renderMoodChart(entries) {
  if (!entries || entries.length === 0) {
    return '<p style="font-size:var(--text-xs);color:var(--color-text-faint);text-align:center;padding:var(--space-4);">Duygu verisi bulunamadı.</p>';
  }
  var maxScore = 10;
  var html = '<div class="mood-chart">';
  entries.forEach(function(e) {
    var pct = (e.mood_score / maxScore) * 100;
    var color = getMoodColor(e.mood_score);
    var d = new Date(e.created_at);
    var dateLabel = d.getDate() + '/' + (d.getMonth() + 1);
    html += '<div class="mood-bar-wrapper">' +
      '<div class="mood-bar" style="height:' + pct + '%;background:' + color + ';" title="' + dateLabel + ' - ' + getMoodEmoji(e.mood_score) + ' ' + esc(e.mood_label || '') + ' (' + e.mood_score + ')"></div>' +
      '<div class="mood-bar-date">' + dateLabel + '</div>' +
    '</div>';
  });
  html += '</div>';
  // Compute average
  var sum = 0;
  entries.forEach(function(e) { sum += e.mood_score; });
  var avg = (sum / entries.length).toFixed(1);
  html += '<div style="text-align:center;font-size:var(--text-sm);color:var(--color-text-muted);margin-top:var(--space-2);">Ortalama: <strong>' + avg + '/10</strong> ' + getMoodEmoji(Math.round(sum / entries.length)) + '</div>';
  return html;
}

// ==================== STRUCTURED NOTES FUNCTIONS ====================
var currentNoteTab = 'free';

function switchNoteTab(tab) {
  currentNoteTab = tab;
  document.querySelectorAll('.note-tab-btn').forEach(function(b) { b.classList.remove('active'); });
  var activeBtn = document.querySelector('.note-tab-btn[data-tab="' + tab + '"]');
  if (activeBtn) activeBtn.classList.add('active');
  document.querySelectorAll('.note-tab-content').forEach(function(c) { c.style.display = 'none'; });
  var activeContent = document.getElementById('noteTab_' + tab);
  if (activeContent) activeContent.style.display = 'block';
}

async function saveStructuredNote(clientId, noteType, data) {
  var payload = {
    expert_id: currentProfile.id,
    client_id: clientId,
    note_type: noteType,
    session_date: data.session_date || new Date().toISOString().split('T')[0]
  };
  if (noteType === 'soap') {
    payload.subjective = data.subjective || null;
    payload.objective = data.objective || null;
    payload.assessment = data.assessment || null;
    payload.plan = data.plan || null;
  } else if (noteType === 'risk') {
    payload.risk_level = data.risk_level || null;
    payload.risk_details = data.risk_details || null;
  } else if (noteType === 'plan') {
    payload.goals = data.goals || null;
    payload.interventions = data.interventions || null;
    payload.next_session_goals = data.next_session_goals || null;
  }
  var res = await sb.from('structured_notes').insert(payload);
  if (res.error) { showToast('Hata: ' + res.error.message); return false; }
  showToast('Not kaydedildi');
  return true;
}

async function loadStructuredNotes(clientId) {
  var res = await sb.from('structured_notes').select('*')
    .eq('client_id', clientId)
    .order('created_at', { ascending: false });
  return res.data || [];
}

async function deleteStructuredNote(noteId) {
  if (!confirm('Bu notu silmek istediğinize emin misiniz?')) return;
  var res = await sb.from('structured_notes').delete().eq('id', noteId);
  if (res.error) { showToast('Hata: ' + res.error.message); return; }
  showToast('Not silindi');
}

function renderStructuredNoteForm(type) {
  var today = new Date().toISOString().split('T')[0];
  var html = '';
  if (type === 'soap') {
    html = '<div class="form-group"><label>Seans Tarihi</label><input type="date" id="soapDate" class="form-input" value="' + today + '"></div>' +
      '<div class="form-group"><label>Subjektif (S)</label><textarea id="soapS" class="form-input" rows="2" placeholder="Danışanın ifadeleri..."></textarea></div>' +
      '<div class="form-group"><label>Objektif (O)</label><textarea id="soapO" class="form-input" rows="2" placeholder="Gözlemler ve bulgular..."></textarea></div>' +
      '<div class="form-group"><label>Değerlendirme (A)</label><textarea id="soapA" class="form-input" rows="2" placeholder="Klinik değerlendirme..."></textarea></div>' +
      '<div class="form-group"><label>Plan (P)</label><textarea id="soapP" class="form-input" rows="2" placeholder="Tedavi planı..."></textarea></div>';
  } else if (type === 'risk') {
    html = '<div class="form-group"><label>Değerlendirme Tarihi</label><input type="date" id="riskDate" class="form-input" value="' + today + '"></div>' +
      '<div class="form-group"><label>Risk Seviyesi</label><select id="riskLevel" class="form-input"><option value="">Seçiniz</option><option value="düşük">Düşük</option><option value="orta">Orta</option><option value="yüksek">Yüksek</option><option value="acil">Acil</option></select></div>' +
      '<div class="form-group"><label>Detaylar</label><textarea id="riskDetails" class="form-input" rows="3" placeholder="Risk değerlendirme detayları..."></textarea></div>';
  } else if (type === 'plan') {
    html = '<div class="form-group"><label>Tarih</label><input type="date" id="planDate" class="form-input" value="' + today + '"></div>' +
      '<div class="form-group"><label>Hedefler</label><textarea id="planGoals" class="form-input" rows="2" placeholder="Tedavi hedefleri..."></textarea></div>' +
      '<div class="form-group"><label>Müdahaleler</label><textarea id="planInterventions" class="form-input" rows="2" placeholder="Planlanan müdahaleler..."></textarea></div>' +
      '<div class="form-group"><label>Sonraki Seans Hedefleri</label><textarea id="planNextGoals" class="form-input" rows="2" placeholder="Bir sonraki seans için hedefler..."></textarea></div>';
  }
  return html;
}

function renderNoteTimeline(regularNotes, structuredNotes) {
  var all = [];
  (regularNotes || []).forEach(function(n) {
    all.push({ type: 'free', date: n.created_at, content: n.content, id: n.id, source: 'notes' });
  });
  (structuredNotes || []).forEach(function(n) {
    var content = '';
    if (n.note_type === 'soap') {
      content = (n.subjective ? 'S: ' + n.subjective + '\n' : '') + (n.objective ? 'O: ' + n.objective + '\n' : '') + (n.assessment ? 'A: ' + n.assessment + '\n' : '') + (n.plan ? 'P: ' + n.plan : '');
    } else if (n.note_type === 'risk') {
      content = 'Risk: ' + (n.risk_level || '?') + '\n' + (n.risk_details || '');
    } else if (n.note_type === 'plan') {
      content = (n.goals ? 'Hedefler: ' + n.goals + '\n' : '') + (n.interventions ? 'Müdahaleler: ' + n.interventions + '\n' : '') + (n.next_session_goals ? 'Sonraki Seans: ' + n.next_session_goals : '');
    }
    all.push({ type: n.note_type, date: n.created_at, content: content, id: n.id, source: 'structured_notes', session_date: n.session_date, risk_level: n.risk_level });
  });
  all.sort(function(a, b) { return new Date(b.date) - new Date(a.date); });

  if (all.length === 0) {
    return '<p style="color:var(--color-text-muted);font-size:var(--text-sm);text-align:center;padding:var(--space-6);">Henüz not eklenmemiş.</p>';
  }

  var html = '';
  all.forEach(function(item) {
    var badgeClass = 'note-type-free';
    var badgeLabel = 'Serbest';
    if (item.type === 'soap') { badgeClass = 'note-type-soap'; badgeLabel = 'SOAP'; }
    else if (item.type === 'risk') { badgeClass = 'note-type-risk'; badgeLabel = 'Risk'; }
    else if (item.type === 'plan') { badgeClass = 'note-type-plan'; badgeLabel = 'Tedavi Planı'; }

    var riskBadge = '';
    if (item.type === 'risk' && item.risk_level) {
      var rlClass = item.risk_level === 'acil' ? 'color:var(--color-error);font-weight:700;' : item.risk_level === 'yüksek' ? 'color:#e67e22;font-weight:600;' : '';
      riskBadge = ' <span style="' + rlClass + 'font-size:var(--text-xs);">(' + esc(item.risk_level) + ')</span>';
    }

    html += '<div class="note-item">' +
      '<div class="note-date">' +
        '<span class="note-type-badge ' + badgeClass + '">' + badgeLabel + '</span>' + riskBadge +
        ' — ' + formatDate(item.date) +
        (item.session_date ? ' (Seans: ' + formatSessionDate(item.session_date) + ')' : '') +
      '</div>' +
      '<div class="note-text" style="white-space:pre-wrap;">' + esc(item.content) + '</div>' +
    '</div>';
  });
  return html;
}

// ==================== HOMEWORK FUNCTIONS ====================
async function saveHomework(clientId, title, description, dueDate) {
  if (!title) { showToast('Lütfen ödev başlığı girin.'); return false; }
  var res = await sb.from('homework').insert({
    expert_id: currentProfile.id,
    client_id: clientId,
    title: title,
    description: description || null,
    due_date: dueDate || null,
    status: 'pending'
  });
  if (res.error) { showToast('Hata: ' + res.error.message); return false; }
  showToast('Ödev atandı');
  return true;
}

async function loadHomework(clientId) {
  var res = await sb.from('homework').select('*')
    .eq('client_id', clientId)
    .order('created_at', { ascending: false });
  return res.data || [];
}

async function updateHomeworkStatus(homeworkId, status, response) {
  var payload = { status: status, updated_at: new Date().toISOString() };
  if (response !== undefined) payload.client_response = response;
  var res = await sb.from('homework').update(payload).eq('id', homeworkId);
  if (res.error) { showToast('Hata: ' + res.error.message); return; }
  showToast(status === 'completed' ? 'Ödev tamamlandı' : 'Ödev güncellendi');
}

async function deleteHomework(homeworkId) {
  if (!confirm('Bu ödevi silmek istediğinize emin misiniz?')) return;
  var res = await sb.from('homework').delete().eq('id', homeworkId);
  if (res.error) { showToast('Hata: ' + res.error.message); return; }
  showToast('Ödev silindi');
}

// ==================== JOURNAL FUNCTIONS ====================
async function saveJournalEntry(title, content, isShared) {
  if (!content) { showToast('Lütfen günlük içeriği yazın.'); return false; }
  var res = await sb.from('journal_entries').insert({
    client_id: currentProfile.id,
    title: title || null,
    content: content,
    is_shared: isShared || false
  });
  if (res.error) { showToast('Hata: ' + res.error.message); return false; }
  showToast('Günlük kaydedildi');
  return true;
}

async function loadJournalEntries(clientId) {
  var res = await sb.from('journal_entries').select('*')
    .eq('client_id', clientId)
    .order('created_at', { ascending: false });
  return res.data || [];
}

async function deleteJournalEntry(entryId) {
  if (!confirm('Bu günlük kaydını silmek istediğinize emin misiniz?')) return;
  var res = await sb.from('journal_entries').delete().eq('id', entryId);
  if (res.error) { showToast('Hata: ' + res.error.message); return; }
  showToast('Günlük silindi');
  renderClientView();
}

// ==================== PROGRESS DASHBOARD FUNCTIONS ====================
async function loadProgressData(clientId) {
  var sessionsRes = await sb.from('scheduled_sessions').select('*').eq('client_id', clientId);
  var sessions = sessionsRes.data || [];
  var completed = sessions.filter(function(s) { return s.status === 'completed'; });
  var cancelled = sessions.filter(function(s) { return s.status === 'cancelled'; });
  var totalSessions = completed.length;
  var attendanceRate = (completed.length + cancelled.length) > 0 ? Math.round((completed.length / (completed.length + cancelled.length)) * 100) : 0;
  var lastSession = completed.length > 0 ? completed.sort(function(a, b) { return b.session_date.localeCompare(a.session_date); })[0].session_date : null;

  // Mood trend
  var now = new Date();
  var d7 = new Date(); d7.setDate(now.getDate() - 7);
  var d14 = new Date(); d14.setDate(now.getDate() - 14);
  var moodRes = await sb.from('mood_entries').select('*').eq('client_id', clientId).gte('created_at', d14.toISOString()).order('created_at');
  var moods = moodRes.data || [];
  var recent7 = moods.filter(function(m) { return new Date(m.created_at) >= d7; });
  var prev7 = moods.filter(function(m) { return new Date(m.created_at) < d7; });
  var avgRecent = recent7.length > 0 ? recent7.reduce(function(s, m) { return s + m.mood_score; }, 0) / recent7.length : 0;
  var avgPrev = prev7.length > 0 ? prev7.reduce(function(s, m) { return s + m.mood_score; }, 0) / prev7.length : 0;
  var moodTrend = recent7.length > 0 ? (avgRecent > avgPrev ? 'up' : avgRecent < avgPrev ? 'down' : 'stable') : 'none';

  // Notes count
  var notesRes = await sb.from('notes').select('id', { count: 'exact', head: true }).eq('client_id', clientId);
  var structNotesRes = await sb.from('structured_notes').select('id', { count: 'exact', head: true }).eq('client_id', clientId);
  var totalNotes = (notesRes.count || 0) + (structNotesRes.count || 0);

  // Homework
  var hwRes = await sb.from('homework').select('*').eq('client_id', clientId);
  var hw = hwRes.data || [];
  var hwCompleted = hw.filter(function(h) { return h.status === 'completed'; }).length;
  var hwTotal = hw.length;

  return {
    totalSessions: totalSessions,
    attendanceRate: attendanceRate,
    lastSession: lastSession,
    moodTrend: moodTrend,
    avgMood: avgRecent,
    totalNotes: totalNotes,
    allSessions: sessions,
    hwCompleted: hwCompleted,
    hwTotal: hwTotal
  };
}

function renderProgressDashboard(data) {
  var lastSessionStr = data.lastSession ? formatSessionDate(data.lastSession) : 'Yok';
  var trendHtml = '';
  if (data.moodTrend === 'up') trendHtml = '<span class="trend-up">↑ ' + data.avgMood.toFixed(1) + '</span>';
  else if (data.moodTrend === 'down') trendHtml = '<span class="trend-down">↓ ' + data.avgMood.toFixed(1) + '</span>';
  else if (data.moodTrend === 'stable') trendHtml = '<span style="color:var(--color-text-muted);">→ ' + data.avgMood.toFixed(1) + '</span>';
  else trendHtml = '<span style="color:var(--color-text-faint);">—</span>';

  return '<div class="progress-grid">' +
    '<div class="progress-card"><div class="progress-value">' + data.totalSessions + '</div><div class="progress-label">Toplam Seans</div></div>' +
    '<div class="progress-card"><div class="progress-value">' + data.attendanceRate + '%</div><div class="progress-label">Devam Oranı</div></div>' +
    '<div class="progress-card"><div class="progress-value" style="font-size:var(--text-sm);">' + lastSessionStr + '</div><div class="progress-label">Son Seans</div></div>' +
    '<div class="progress-card"><div class="progress-value">' + trendHtml + '</div><div class="progress-label">Duygu Trendi</div></div>' +
    '<div class="progress-card"><div class="progress-value">' + data.totalNotes + '</div><div class="progress-label">Toplam Not</div></div>' +
  '</div>';
}

// ==================== ENHANCED ADMIN VIEW (add Dashboard + Mesajlar tab) ====================
// Override renderAdminView to add new tabs
var _originalRenderAdminView = renderAdminView;
renderAdminView = async function() {
  var main = document.getElementById("mainContent");
  main.innerHTML = '<div class="empty-state"><div class="loading-spinner"></div><p>Yükleniyor...</p></div>';

  var expertsRes = await sb.from("profiles").select("*").eq("role", "expert").order("full_name");
  var clientsRes = await sb.from("profiles").select("*").eq("role", "client").order("full_name");
  var assignRes = await sb.from("assignments").select("*");
  var notesRes = await sb.from("notes").select("*");
  var sessionsRes = await sb.from("scheduled_sessions").select("*").order("session_date").order("start_time");

  var experts = expertsRes.data || [];
  var clients = clientsRes.data || [];
  var assignments = assignRes.data || [];
  var notes = notesRes.data || [];
  var scheduledSessions = sessionsRes.data || [];

  var totalExperts = experts.length;
  var totalClients = clients.length;
  var totalNotes = notes.length;
  var assignedClients = new Set(assignments.map(function(a) { return a.client_id; })).size;

  window._adminData = { experts: experts, clients: clients, assignments: assignments, notes: notes, scheduledSessions: scheduledSessions };

  main.innerHTML =
    '<div class="stats-grid">' +
      '<div class="stat-card"><div class="stat-value">' + totalExperts + '</div><div class="stat-label">Uzman</div></div>' +
      '<div class="stat-card"><div class="stat-value">' + totalClients + '</div><div class="stat-label">Danışan</div></div>' +
      '<div class="stat-card"><div class="stat-value">' + totalNotes + '</div><div class="stat-label">Seans Notu</div></div>' +
      '<div class="stat-card"><div class="stat-value">' + assignedClients + '</div><div class="stat-label">Atanmış Danışan</div></div>' +
    '</div>' +
    '<div class="tab-nav">' +
      '<button class="tab-btn active" onclick="switchAdminTab(\'dashboard\',this)">Panel</button>' +
      '<button class="tab-btn" onclick="switchAdminTab(\'experts\',this)">Uzmanlar</button>' +
      '<button class="tab-btn" onclick="switchAdminTab(\'clients\',this)">Danışanlar</button>' +
      '<button class="tab-btn" onclick="switchAdminTab(\'messages\',this)">Mesajlar</button>' +
      '<button class="tab-btn" onclick="switchAdminTab(\'notes\',this)">Notlar</button>' +
      '<button class="tab-btn" onclick="switchAdminTab(\'announcements\',this)">Duyurular</button>' +
      '<button class="tab-btn" onclick="switchAdminTab(\'loginlogs\',this)">Giri\u015f Loglar\u0131</button>' +
      '<button class="tab-btn" onclick="switchAdminTab(\'calendar\',this)">Takvim</button>' +
      '<button class="tab-btn" onclick="switchAdminTab(\'payments\',this)">&Ouml;demeler</button>' +
    '</div>' +
    '<div id="adminTabContent"></div>';

  renderAdminDashboardTab();
};

// Override switchAdminTab to handle new tabs
var _originalSwitchAdminTab = switchAdminTab;
switchAdminTab = function(tab, btn) {
  document.querySelectorAll(".tab-btn").forEach(function(b) { b.classList.remove("active"); });
  btn.classList.add("active");
  if (tab === "dashboard") renderAdminDashboardTab();
  else if (tab === "experts") renderAdminExpertsTab();
  else if (tab === "clients") renderAdminClientsTab();
  else if (tab === "messages") renderAdminMessagesTab();
  else if (tab === "announcements") renderAdminAnnouncementsTab();
  else if (tab === "loginlogs") renderAdminLoginLogsTab();
  else if (tab === "calendar") renderAdminCalendarTab();
  else if (tab === "payments") renderAdminPaymentsTab();
  else renderAdminNotesTab();
};

// ==================== ADMIN MESSAGES TAB ====================
async function renderAdminMessagesTab() {
  var container = document.getElementById("adminTabContent");
  container.innerHTML = '<div class="empty-state"><div class="loading-spinner"></div><p>Yükleniyor...</p></div>';

  var d = window._adminData;

  // Fetch all messages
  var messagesRes = await sb.from("messages").select("*").order("created_at", { ascending: false }).limit(100);
  var messages = messagesRes.data || [];

  // Build a lookup of all users (experts + clients + admin)
  var allUsers = {};
  d.experts.forEach(function(e) { allUsers[e.id] = { name: e.full_name, role: 'expert' }; });
  d.clients.forEach(function(c) { allUsers[c.id] = { name: c.full_name, role: 'client' }; });
  allUsers[currentProfile.id] = { name: currentProfile.full_name, role: 'admin' };

  // Group messages by conversation (pair of users)
  var conversations = {};
  messages.forEach(function(msg) {
    var pair = [msg.sender_id, msg.receiver_id].sort().join('_');
    if (!conversations[pair]) {
      conversations[pair] = {
        partnerId1: msg.sender_id,
        partnerId2: msg.receiver_id,
        lastMessage: msg,
        count: 0
      };
    }
    conversations[pair].count++;
  });

  var convList = Object.values(conversations).sort(function(a, b) {
    return new Date(b.lastMessage.created_at) - new Date(a.lastMessage.created_at);
  });

  var html =
    '<div class="page-header">' +
      '<h2 class="section-title">Mesajlar</h2>' +
    '</div>';

  if (convList.length === 0) {
    html += '<div class="empty-state"><svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg><h3>Henüz mesaj yok</h3><p>Uzmanlarla mesajlaşmaya başlamak için Uzmanlar sekmesindeki mesaj ikonuna tıklayın.</p></div>';
  } else {
    html += '<div class="user-list">';
    convList.forEach(function(conv) {
      var user1 = allUsers[conv.partnerId1] || { name: 'Bilinmeyen', role: 'unknown' };
      var user2 = allUsers[conv.partnerId2] || { name: 'Bilinmeyen', role: 'unknown' };

      // Determine who is the "other" person (not admin)
      var otherUser, otherId;
      if (conv.partnerId1 === currentProfile.id) {
        otherUser = user2;
        otherId = conv.partnerId2;
      } else if (conv.partnerId2 === currentProfile.id) {
        otherUser = user1;
        otherId = conv.partnerId1;
      } else {
        // Conversation between expert and client (admin viewing)
        otherUser = null;
        otherId = null;
      }

      var lastMsg = conv.lastMessage;
      var senderName = allUsers[lastMsg.sender_id] ? allUsers[lastMsg.sender_id].name : '?';
      var msgText = lastMsg.content || (lastMsg.file_name ? '📎 ' + lastMsg.file_name : 'Dosya');
      var preview = msgText.length > 50 ? msgText.substring(0, 50) + '...' : msgText;
      var timeStr = formatDate(lastMsg.created_at);

      if (otherUser && otherId) {
        // Admin's own conversation with someone
        var roleLabel = otherUser.role === 'expert' ? 'Uzman' : otherUser.role === 'client' ? 'Danışan' : '';
        html +=
          '<div class="user-card" style="cursor:pointer;" onclick="openMessaging(\'' + escAttr(otherId) + '\',\'' + escAttr(otherUser.name) + '\')">' +
            '<div class="user-card-avatar' + (otherUser.role === 'expert' ? ' expert-avatar' : '') + '">' + getInitials(otherUser.name) + '</div>' +
            '<div class="user-card-info">' +
              '<div class="user-card-name">' + esc(otherUser.name) + (roleLabel ? ' <span class="role-tag ' + otherUser.role + '" style="font-size:9px;padding:1px 6px;vertical-align:middle;">' + roleLabel + '</span>' : '') + '</div>' +
              '<div class="user-card-detail"><strong>' + esc(senderName.split(' ')[0]) + ':</strong> ' + esc(preview) + ' — ' + timeStr + '</div>' +
            '</div>' +
            '<div class="user-card-actions">' +
              '<span style="font-size:var(--text-xs);color:var(--color-text-faint);">' + conv.count + ' mesaj</span>' +
            '</div>' +
          '</div>';
      } else {
        // Conversation between two other users
        html +=
          '<div class="user-card">' +
            '<div class="user-card-avatar" style="background:var(--color-surface-dynamic);color:var(--color-text-muted);">' +
              '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>' +
            '</div>' +
            '<div class="user-card-info">' +
              '<div class="user-card-name">' + esc(user1.name) + ' ↔ ' + esc(user2.name) + '</div>' +
              '<div class="user-card-detail"><strong>' + esc(senderName.split(' ')[0]) + ':</strong> ' + esc(preview) + ' — ' + timeStr + '</div>' +
            '</div>' +
            '<div class="user-card-actions">' +
              '<span style="font-size:var(--text-xs);color:var(--color-text-faint);">' + conv.count + ' mesaj</span>' +
            '</div>' +
          '</div>';
      }
    });
    html += '</div>';
  }

  container.innerHTML = html;
}

// ==================== ENHANCED EXPERT VIEW (Tabbed Layout) ====================
var _originalRenderExpertView = renderExpertView;
var currentExpertTab = 'clients';
var _expertViewData = {};

function switchExpertTab(tab) {
  currentExpertTab = tab;
  document.querySelectorAll('.tab-btn[data-expert-tab]').forEach(function(b) { b.classList.remove('active'); });
  var activeBtn = document.querySelector('.tab-btn[data-expert-tab="' + tab + '"]');
  if (activeBtn) activeBtn.classList.add('active');
  renderExpertTabContent();
}

renderExpertView = async function() {
  var main = document.getElementById("mainContent");
  main.innerHTML = '<div class="empty-state"><div class="loading-spinner"></div><p>Y\u00FCkleniyor...</p></div>';

  // Fetch all data in parallel
  var [assignRes, annRes, adminRes, payRes] = await Promise.all([
    sb.from("assignments").select("*, client:client_id(id, full_name, email, phone)").eq("expert_id", currentProfile.id),
    sb.from("announcements").select("*").order("created_at", { ascending: false }).limit(10),
    sb.from("profiles").select("id, full_name").eq("role", "admin").limit(1).maybeSingle(),
    sb.from("expert_payments").select("*").eq("expert_id", currentProfile.id).order("due_date", { ascending: true })
  ]);

  _expertViewData.assignments = assignRes.data || [];
  _expertViewData.announcements = annRes.data || [];
  _expertViewData.admin = adminRes.data;
  _expertViewData.payments = payRes.data || [];
  window._expertClients = _expertViewData.assignments;

  // Build tab navigation
  var annCount = _expertViewData.announcements.length;
  var pendingPayments = _expertViewData.payments.filter(function(p) { return p.status !== 'paid'; }).length;

  var html = '<div class="tab-nav" role="tablist">';
  html += '<button class="tab-btn' + (currentExpertTab === 'clients' ? ' active' : '') + '" data-expert-tab="clients" onclick="switchExpertTab(\'clients\')">' +
    '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="vertical-align:-2px;margin-right:4px;"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>' +
    'Dan\u0131\u015Fanlar\u0131m</button>';
  html += '<button class="tab-btn' + (currentExpertTab === 'announcements' ? ' active' : '') + '" data-expert-tab="announcements" onclick="switchExpertTab(\'announcements\')">' +
    '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="vertical-align:-2px;margin-right:4px;"><path d="M19.4 14.9C20.2 16.4 21 17 21 17H3s3-2 3-9c0-3.3 2.7-6 6-6 .7 0 1.3.1 1.9.3"/><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0"/><circle cx="18" cy="8" r="3"/></svg>' +
    'Duyurular' + (annCount > 0 ? ' <span style="font-size:10px;background:var(--color-secondary);color:#fff;padding:1px 6px;border-radius:99px;margin-left:2px;">' + annCount + '</span>' : '') + '</button>';
  html += '<button class="tab-btn' + (currentExpertTab === 'payments' ? ' active' : '') + '" data-expert-tab="payments" onclick="switchExpertTab(\'payments\')">' +
    '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="vertical-align:-2px;margin-right:4px;"><rect x="2" y="5" width="20" height="14" rx="2"/><path d="M2 10h20"/></svg>' +
    '\u00D6deme Takvimi' + (pendingPayments > 0 ? ' <span style="font-size:10px;background:var(--color-warning);color:#fff;padding:1px 6px;border-radius:99px;margin-left:2px;">' + pendingPayments + '</span>' : '') + '</button>';
  html += '<button class="tab-btn' + (currentExpertTab === 'profile' ? ' active' : '') + '" data-expert-tab="profile" onclick="switchExpertTab(\'profile\')">' +
    '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="vertical-align:-2px;margin-right:4px;"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>' +
    'Profilim</button>';
  html += '</div>';

  html += '<div id="expertTabContent"></div>';
  html += '<div id="clientDetailView" class="detail-view"></div>';
  main.innerHTML = html;
  renderExpertTabContent();
};

async function renderExpertTabContent() {
  var container = document.getElementById('expertTabContent');
  if (!container) return;

  if (currentExpertTab === 'clients') {
    await renderExpertClientsTab(container);
  } else if (currentExpertTab === 'announcements') {
    renderExpertAnnouncementsTab(container);
  } else if (currentExpertTab === 'payments') {
    renderExpertPaymentsTab(container);
  } else if (currentExpertTab === 'profile') {
    renderExpertProfileTab(container);
  }
}

async function renderExpertClientsTab(container) {
  var assignments = _expertViewData.assignments || [];
  var admin = _expertViewData.admin;
  var html = '';

  html += '<div class="page-header" style="margin-bottom:var(--space-4);">' +
    '<h2 class="page-title">Dan\u0131\u015Fanlar\u0131m</h2>' +
    '<span class="badge badge-online">\u00C7evrimii\u00E7i</span>' +
  '</div>';

  if (assignments.length === 0) {
    html += '<div class="empty-state"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/></svg><h3>Hen\u00FCz dan\u0131\u015Fan\u0131n\u0131z yok</h3><p>Admin taraf\u0131ndan size dan\u0131\u015Fan atand\u0131\u011F\u0131nda burada g\u00F6r\u00FCnecektir.</p></div>';
  } else {
    html += '<div class="user-list" id="expertClientList">';
    for (var i = 0; i < assignments.length; i++) {
      var a = assignments[i];
      var client = a.client;
      var notesRes2 = await sb.from("notes").select("id").eq("expert_id", currentProfile.id).eq("client_id", client.id);
      var noteCount = (notesRes2.data || []).length;
      var unreadCount = await getUnreadCount(client.id);
      var unreadBadge = unreadCount > 0 ? '<span class="unread-badge">' + unreadCount + '</span>' : '';
      html +=
        '<div class="user-card">' +
          '<div class="user-card-avatar">' + getInitials(client.full_name) + '</div>' +
          '<div class="user-card-info">' +
            '<div class="user-card-name">' + esc(client.full_name) + '</div>' +
            '<div class="user-card-detail">' + noteCount + ' seans notu</div>' +
          '</div>' +
          '<div class="user-card-actions">' +
            '<button class="btn btn-ghost btn-sm" onclick="openMessaging(\'' + escAttr(client.id) + '\',\'' + escAttr(client.full_name) + '\')" title="Mesaj">' +
              '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>' + unreadBadge + '</button>' +
            '<button class="btn btn-ghost btn-sm" onclick="showSessionNotes(\'' + escAttr(client.id) + '\',\'' + escAttr(client.full_name) + '\')" title="Seans Notlar\u0131">' +
              '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5L14.5 2z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/></svg></button>' +
            '<button class="btn btn-primary btn-sm" onclick="startVideoCall(\'' + escAttr(client.id) + '\',\'' + escAttr(client.full_name) + '\')">' +
              '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="m22 8-6 4 6 4V8Z"/><rect width="14" height="12" x="2" y="6" rx="2"/></svg> G\u00F6r\u00FC\u015Fme</button>' +
            '<button class="btn btn-ghost btn-sm" onclick="showClientDetail(\'' + client.id + '\')">' +
              '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 20h9"/><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z"/></svg> Notlar</button>' +
          '</div>' +
        '</div>';
    }
    html += '</div>';
  }

  // Admin messages section
  if (admin) {
    var adminUnread = await getUnreadCount(admin.id);
    var adminUnreadBadge = adminUnread > 0 ? '<span class="unread-badge">' + adminUnread + '</span>' : '';
    var myId2 = currentProfile.id;
    var lastMsgRes = await sb.from("messages").select("*")
      .or("and(sender_id.eq." + myId2 + ",receiver_id.eq." + admin.id + "),and(sender_id.eq." + admin.id + ",receiver_id.eq." + myId2 + ")")
      .order("created_at", { ascending: false })
      .limit(1);
    var lastAdminMsg = (lastMsgRes.data || [])[0];
    var adminPreview = '';
    if (lastAdminMsg) {
      var isMyMsg = lastAdminMsg.sender_id === myId2;
      var prevMsgText = lastAdminMsg.content || (lastAdminMsg.file_name ? '\uD83D\uDCCE ' + lastAdminMsg.file_name : 'Dosya');
      var prevText = prevMsgText.length > 40 ? prevMsgText.substring(0, 40) + '...' : prevMsgText;
      adminPreview = '<div class="user-card-detail">' + (isMyMsg ? '<strong>Siz:</strong> ' : '<strong>Admin:</strong> ') + esc(prevText) + '</div>';
    } else {
      adminPreview = '<div class="user-card-detail">Hen\u00FCz mesaj yok</div>';
    }
    html +=
      '<div style="margin-top:var(--space-6);">' +
        '<h3 class="section-title">Y\u00F6netim Mesajlar\u0131</h3>' +
        '<div class="user-card" style="cursor:pointer;" onclick="openMessaging(\'' + escAttr(admin.id) + '\',\'' + escAttr(admin.full_name) + '\')">' +
          '<div class="user-card-avatar" style="background:var(--color-primary);">' + getInitials(admin.full_name) + '</div>' +
          '<div class="user-card-info">' +
            '<div class="user-card-name">' + esc(admin.full_name) + ' <span class="role-tag admin" style="font-size:9px;padding:1px 6px;vertical-align:middle;">Admin</span>' + adminUnreadBadge + '</div>' +
            adminPreview +
          '</div>' +
          '<div class="user-card-actions">' +
            '<button class="btn btn-primary btn-sm">' +
              '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg> Mesaj</button>' +
          '</div>' +
        '</div>' +
      '</div>';
  }

  container.innerHTML = html;
}

function renderExpertAnnouncementsTab(container) {
  var announcements = _expertViewData.announcements || [];
  var html = '<div class="page-header" style="margin-bottom:var(--space-4);">' +
    '<h2 class="page-title">Duyurular</h2>' +
  '</div>';

  if (announcements.length === 0) {
    html += '<div class="empty-state"><svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M19.4 14.9C20.2 16.4 21 17 21 17H3s3-2 3-9c0-3.3 2.7-6 6-6 .7 0 1.3.1 1.9.3"/><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0"/><circle cx="18" cy="8" r="3"/></svg><h3>Hen\u00FCz duyuru yok</h3><p>Y\u00F6netim taraf\u0131ndan payla\u015F\u0131lan duyurular burada g\u00F6r\u00FCnecektir.</p></div>';
  } else {
    html += '<div class="announcements-list">';
    announcements.forEach(function(a) {
      var date = new Date(a.created_at);
      var dateStr = date.toLocaleDateString('tr-TR', { day: 'numeric', month: 'long', year: 'numeric' });
      html += '<div class="announcement-card">' +
        '<div class="announcement-header">' +
          '<div>' +
            '<div class="announcement-title">' + esc(a.title) + '</div>' +
            '<div class="announcement-date">' + dateStr + '</div>' +
          '</div>' +
        '</div>' +
        '<div class="announcement-content">' + esc(a.content).replace(/\n/g, '<br>') + '</div>' +
      '</div>';
    });
    html += '</div>';
  }
  container.innerHTML = html;
}

function renderExpertPaymentsTab(container) {
  var payments = _expertViewData.payments || [];
  var html = '<div class="page-header" style="margin-bottom:var(--space-4);">' +
    '<h2 class="page-title">\u00D6deme Takvimim</h2>' +
  '</div>';

  if (payments.length === 0) {
    html += '<div class="empty-state" style="padding:var(--space-8);">' +
      '<svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><rect x="2" y="5" width="20" height="14" rx="2"/><path d="M2 10h20"/></svg>' +
      '<h3>Hen\u00FCz \u00F6deme takvimi olu\u015Fturulmam\u0131\u015F</h3>' +
      '<p>\u00D6deme takviminiz olu\u015Fturuldu\u011Funda burada g\u00F6r\u00FCnecektir.</p></div>';
    container.innerHTML = html;
    return;
  }

  // Company IBAN info
  html += '<div class="payment-company-info">' +
    '<div class="payment-company-title">' +
      '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="2" y="5" width="20" height="14" rx="2"/><path d="M2 10h20"/></svg>' +
      ' \u00D6deme Bilgileri' +
    '</div>' +
    '<div class="payment-company-detail">' +
      '<strong>Firma:</strong> SYNAPSE LYNK DANI\u015EMANLIK VE E\u011E\u0130T\u0130M H\u0130ZMETLER\u0130 L\u0130M\u0130TED \u015E\u0130RKET\u0130' +
    '</div>' +
    '<div class="payment-company-detail">' +
      '<strong>IBAN:</strong> <span class="payment-iban">TR29 0001 2001 6620 0010 1011 89</span>' +
      ' <button class="btn btn-ghost btn-sm" onclick="copyCompanyIban()" title="Kopyala" style="padding:2px 6px;">' +
        '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg></button>' +
    '</div>' +
    '<div class="payment-company-hint">Ayl\u0131k hizmet bedelinizi yukar\u0131daki IBAN\'a havale/EFT ile g\u00F6nderebilirsiniz.</div>' +
  '</div>';

  // Stats
  var totalPending = 0, totalPaid = 0, nextPayment = null;
  var today = new Date().toISOString().split('T')[0];
  payments.forEach(function(p) {
    if (p.status === 'paid') totalPaid++;
    else {
      totalPending++;
      if (!nextPayment && p.due_date >= today) nextPayment = p;
    }
  });

  html += '<div class="stats-grid" style="margin-bottom:var(--space-4);">' +
    '<div class="stat-card"><div class="stat-value">' + totalPaid + '/' + payments.length + '</div><div class="stat-label">\u00D6denen / Toplam</div></div>';
  if (nextPayment) {
    var nextDate = new Date(nextPayment.due_date + 'T00:00:00').toLocaleDateString('tr-TR', { day: 'numeric', month: 'long' });
    html += '<div class="stat-card"><div class="stat-value">' + formatCurrency(parseFloat(nextPayment.amount)) + '</div><div class="stat-label">Sonraki \u00D6deme (' + nextDate + ')</div></div>';
  }
  html += '</div>';

  // Payment list
  html += '<div class="payment-list">';
  for (var k = 0; k < payments.length; k++) {
    var p = payments[k];
    var isOverdue = p.status === 'pending' && p.due_date < today;
    var statusClass = p.status === 'paid' ? 'paid' : (isOverdue ? 'overdue' : 'pending');
    var statusLabel = p.status === 'paid' ? '\u00D6dendi' : (isOverdue ? 'Gecikmi\u015F' : 'Bekliyor');
    var iconSvg = p.status === 'paid'
      ? '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M20 6 9 17l-5-5"/></svg>'
      : '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/></svg>';
    var dueDateStr = new Date(p.due_date + 'T00:00:00').toLocaleDateString('tr-TR', { day: 'numeric', month: 'long', year: 'numeric' });

    html += '<div class="payment-item payment-item-' + statusClass + '">' +
      '<div class="payment-item-icon">' + iconSvg + '</div>' +
      '<div class="payment-item-info">' +
        '<div class="payment-item-period">' + esc(p.period_label) + '</div>' +
        '<div class="payment-item-date">' + dueDateStr + '</div>' +
      '</div>' +
      '<div class="payment-item-right">' +
        '<div class="payment-item-amount">' + formatCurrency(parseFloat(p.amount)) + '</div>' +
        '<div class="payment-item-status payment-status-' + statusClass + '">' + statusLabel + '</div>' +
      '</div>' +
    '</div>';
  }
  html += '</div>';

  container.innerHTML = html;
}

function renderExpertProfileTab(container) {
  var p = currentProfile;
  var html = '<div class="page-header" style="margin-bottom:var(--space-4);">' +
    '<h2 class="page-title">Profilim</h2>' +
  '</div>';

  html += '<div class="card" style="max-width:600px;">';

  // Display info
  html += '<div style="display:flex;align-items:center;gap:var(--space-4);margin-bottom:var(--space-6);">' +
    '<div class="detail-avatar">' + getInitials(p.full_name) + '</div>' +
    '<div>' +
      '<h3 style="margin:0;font-size:var(--text-lg);font-weight:600;">' + esc(p.full_name) + '</h3>' +
      '<p style="margin:0;color:var(--color-text-muted);font-size:var(--text-sm);">' + esc(p.email || '') + '</p>' +
      '<span class="role-tag expert" style="margin-top:4px;display:inline-block;">' + esc(p.specialty || 'Uzman') + '</span>' +
    '</div>' +
  '</div>';

  // Info grid
  var fields = [
    { label: '\u00C7al\u0131\u015Fma Alanlar\u0131', value: p.areas_of_expertise || '\u2014' },
    { label: 'Telefon', value: p.phone || '\u2014' },
    { label: 'IBAN', value: p.iban ? '<span class="payment-iban">' + esc(p.iban.replace(/(.{4})/g, '$1 ').trim()) + '</span>' : '<span style="color:var(--color-warning);">Girilmemi\u015F</span>' },
  ];

  fields.forEach(function(f) {
    html += '<div style="padding:var(--space-3) 0;border-bottom:1px solid var(--color-divider);">' +
      '<div style="font-size:var(--text-xs);color:var(--color-text-faint);font-weight:500;text-transform:uppercase;letter-spacing:0.05em;margin-bottom:2px;">' + f.label + '</div>' +
      '<div style="font-size:var(--text-sm);color:var(--color-text);">' + f.value + '</div>' +
    '</div>';
  });

  html += '<div style="margin-top:var(--space-6);">' +
    '<button class="btn btn-primary" onclick="openMyProfile()">' +
      '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 20h9"/><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z"/></svg>' +
      ' Bilgilerimi D\u00FCzenle</button>' +
  '</div>';

  html += '</div>';
  container.innerHTML = html;
}

// ==================== ENHANCED CLIENT VIEW (Tabbed Self-Service Portal) ====================
var currentClientTab = 'home';
var _originalRenderClientView = renderClientView;

function switchClientTab(tab) {
  currentClientTab = tab;
  document.querySelectorAll('.client-tab-btn').forEach(function(b) { b.classList.remove('active'); });
  var activeBtn = document.querySelector('.client-tab-btn[data-tab="' + tab + '"]');
  if (activeBtn) activeBtn.classList.add('active');
  renderClientTabContent();
}

async function renderClientTabContent() {
  var contentEl = document.getElementById('clientTabContent');
  if (!contentEl) return;
  contentEl.innerHTML = '<div class="empty-state"><div class="loading-spinner"></div><p>Yükleniyor...</p></div>';

  var clientData = window._clientPortalData;
  if (!clientData) return;

  var html = '';
  if (currentClientTab === 'home') {
    html = await renderClientHomeTab(clientData);
  } else if (currentClientTab === 'homework') {
    html = await renderClientHomeworkTab(clientData);
  } else if (currentClientTab === 'journal') {
    html = await renderClientJournalTab(clientData);
  } else if (currentClientTab === 'progress') {
    html = await renderClientProgressTab(clientData);
  }
  contentEl.innerHTML = html;
}

async function renderClientHomeTab(data) {
  var html = '';
  if (data.expert) {
    var expert = data.expert;
    var unreadCount = await getUnreadCount(expert.id);
    var unreadBadge = unreadCount > 0 ? ' <span class="unread-badge">' + unreadCount + '</span>' : '';
    html +=
      '<div class="card" style="max-width:480px;">' +
        '<div class="card-header"><h3 class="card-title">Uzmanınız</h3></div>' +
        '<div style="display:flex;align-items:center;gap:var(--space-4);margin-bottom:var(--space-5);">' +
          '<div class="user-card-avatar expert-avatar" style="width:56px;height:56px;font-size:var(--text-lg);">' + getInitials(expert.full_name) + '</div>' +
          '<div><div style="font-weight:600;font-size:var(--text-base);">' + esc(expert.full_name) + '</div><div style="font-size:var(--text-sm);color:var(--color-text-muted);">' + esc(expert.specialty || "") + '</div>' + (expert.areas_of_expertise ? '<div class="expert-areas" style="margin-top:4px;">' + expert.areas_of_expertise.split(",").map(function(a){return '<span class="area-tag">' + esc(a.trim()) + '</span>';}).join("") + '</div>' : '') + '</div>' +
        '</div>' +
        '<div style="display:flex;gap:var(--space-3);">' +
          '<button class="btn btn-primary" style="flex:1;" onclick="startVideoCall(\'' + escAttr(expert.id) + '\',\'' + escAttr(expert.full_name) + '\')">' +
            '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="m22 8-6 4 6 4V8Z"/><rect width="14" height="12" x="2" y="6" rx="2"/></svg> Görüntülü Görüşme</button>' +
          '<button class="btn btn-secondary" style="flex:1;" onclick="openMessaging(\'' + escAttr(expert.id) + '\',\'' + escAttr(expert.full_name) + '\')">' +
            '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg> Mesaj' + unreadBadge + '</button>' +
        '</div>' +
      '</div>';
  }

  // Upcoming sessions
  var today = new Date().toISOString().split("T")[0];
  var upcoming = (data.allSessions || []).filter(function(s) { return s.session_date >= today && s.status !== 'cancelled'; });
  upcoming.sort(function(a, b) { return (a.session_date + a.start_time).localeCompare(b.session_date + b.start_time); });

  html += '<div style="max-width:480px;margin-top:var(--space-6);">';
  html += '<h3 class="section-title">Yaklaşan Seanslar</h3>';
  if (upcoming.length === 0) {
    html += '<p class="no-sessions-msg">Yaklaşan planlanmış seans bulunmuyor.</p>';
  } else {
    html += '<div class="session-list session-list-compact">';
    upcoming.forEach(function(sess) {
      var expertName = sess.expert ? sess.expert.full_name : "?";
      var statusClass = sess.status === "completed" ? "session-status-completed" : sess.status === "cancelled" ? "session-status-cancelled" : "session-status-planned";
      var statusLabel = sess.status === "completed" ? "Tamamlandı" : sess.status === "cancelled" ? "İptal" : "Planlandı";
      html +=
        '<div class="session-card session-card-compact">' +
          '<div class="session-card-date">' +
            '<div class="session-day">' + formatSessionDate(sess.session_date) + '</div>' +
            '<div class="session-time">' + sess.start_time.substring(0, 5) + ' – ' + sess.end_time.substring(0, 5) + '</div>' +
          '</div>' +
          '<div class="session-card-info">' +
            '<div class="session-names"><span class="session-expert">' + esc(expertName) + '</span></div>' +
          '</div>' +
          '<span class="session-status ' + statusClass + '">' + statusLabel + '</span>' +
        '</div>';
    });
    html += '</div>';
  }
  html += '</div>';

  // Mood Tracking Widget
  var moodEntries = await loadMoodEntries(currentProfile.id, 7);
  html += '<div class="card" style="max-width:480px;margin-top:var(--space-6);">' +
    '<div class="card-header"><h3 class="card-title">Duygu Takip</h3></div>' +
    '<p style="font-size:var(--text-sm);color:var(--color-text-muted);margin-bottom:var(--space-3);">Bugün kendinizi nasıl hissediyorsunuz?</p>' +
    renderMoodSelector() +
    '<div class="form-group" style="margin-top:var(--space-3);">' +
      '<textarea id="moodNote" class="form-input" rows="2" placeholder="Notunuz (isteğe bağlı)..."></textarea>' +
    '</div>' +
    '<button class="btn btn-primary btn-full" onclick="saveMoodEntry(selectedMoodScore, selectedMoodLabel, document.getElementById(\'moodNote\').value.trim())">Bugünkü Ruh Halimi Kaydet</button>' +
    '<div style="margin-top:var(--space-4);">' +
      '<h4 style="font-size:var(--text-sm);font-weight:600;margin-bottom:var(--space-2);">Son 7 Gün</h4>' +
      renderMoodTimeline(moodEntries) +
    '</div>' +
  '</div>';

  return html;
}

async function renderClientHomeworkTab(data) {
  var homework = await loadHomework(currentProfile.id);
  var html = '<h3 class="section-title">Ödevlerim</h3>';

  if (homework.length === 0) {
    html += '<div class="empty-state" style="padding:var(--space-8);"><h3>Henüz ödev yok</h3><p>Uzmanınız size ödev verdiğinde burada görünecektir.</p></div>';
  } else {
    homework.forEach(function(hw) {
      var statusClass = hw.status === 'completed' ? 'homework-status-completed' : 'homework-status-pending';
      var statusLabel = hw.status === 'completed' ? 'Tamamlandı' : 'Bekliyor';
      html += '<div class="homework-card">' +
        '<div class="homework-header">' +
          '<span class="homework-title">' + esc(hw.title) + '</span>' +
          '<span class="homework-status ' + statusClass + '">' + statusLabel + '</span>' +
        '</div>' +
        (hw.description ? '<div class="homework-desc">' + esc(hw.description) + '</div>' : '') +
        (hw.due_date ? '<div class="homework-due">Son tarih: ' + formatSessionDate(hw.due_date) + '</div>' : '');

      if (hw.status === 'pending') {
        html += '<div class="homework-response">' +
          '<textarea id="hwResponse_' + hw.id + '" class="form-input" rows="2" placeholder="Yanıtınızı yazın...">' + esc(hw.client_response || '') + '</textarea>' +
          '<div style="display:flex;gap:var(--space-2);margin-top:var(--space-2);">' +
            '<button class="btn btn-success btn-sm" onclick="completeHomework(' + hw.id + ')">Tamamlandı Olarak İşaretle</button>' +
          '</div>' +
        '</div>';
      } else if (hw.client_response) {
        html += '<div style="margin-top:var(--space-3);padding-top:var(--space-3);border-top:1px solid var(--color-divider);">' +
          '<div style="font-size:var(--text-xs);color:var(--color-text-muted);margin-bottom:var(--space-1);">Yanıtınız:</div>' +
          '<div style="font-size:var(--text-sm);">' + esc(hw.client_response) + '</div>' +
        '</div>';
      }

      html += '</div>';
    });
  }
  return html;
}

async function completeHomework(hwId) {
  var responseEl = document.getElementById('hwResponse_' + hwId);
  var response = responseEl ? responseEl.value.trim() : '';
  await updateHomeworkStatus(hwId, 'completed', response);
  renderClientTabContent();
}

async function renderClientJournalTab(data) {
  var entries = await loadJournalEntries(currentProfile.id);
  var html = '<h3 class="section-title">Günlüğüm</h3>';

  // Form
  html += '<div class="card" style="margin-bottom:var(--space-6);">' +
    '<div class="form-group"><label>Başlık</label><input type="text" id="journalTitle" class="form-input" placeholder="Günlük başlığı (isteğe bağlı)"></div>' +
    '<div class="form-group"><label>İçerik</label><textarea id="journalContent" class="form-input" rows="4" placeholder="Günlüğünüzü yazın..."></textarea></div>' +
    '<div style="display:flex;align-items:center;gap:var(--space-3);margin-bottom:var(--space-3);">' +
      '<label style="display:flex;align-items:center;gap:var(--space-2);font-size:var(--text-sm);cursor:pointer;">' +
        '<input type="checkbox" id="journalShared" style="width:18px;height:18px;accent-color:var(--color-primary);">' +
        'Uzmanla Paylaş' +
      '</label>' +
    '</div>' +
    '<button class="btn btn-primary" onclick="submitJournal()">Kaydet</button>' +
  '</div>';

  // Entries list
  if (entries.length === 0) {
    html += '<p style="color:var(--color-text-muted);font-size:var(--text-sm);text-align:center;padding:var(--space-6);">Henüz günlük kaydı yok.</p>';
  } else {
    entries.forEach(function(e) {
      html += '<div class="journal-entry">' +
        '<div class="journal-header">' +
          '<div>' +
            '<span class="journal-title">' + esc(e.title || 'Başlıksız') + '</span>' +
            (e.is_shared ? ' <span class="journal-shared-badge">Paylaşıldı</span>' : '') +
          '</div>' +
          '<div style="display:flex;align-items:center;gap:var(--space-2);">' +
            '<span class="journal-date">' + formatDate(e.created_at) + '</span>' +
            '<button class="btn btn-ghost btn-sm" onclick="deleteJournalEntry(' + e.id + ')" title="Sil" style="color:var(--color-error);padding:var(--space-1);">' +
              '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 6h18"/><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"/><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"/></svg></button>' +
          '</div>' +
        '</div>' +
        '<div class="journal-content">' + esc(e.content) + '</div>' +
      '</div>';
    });
  }
  return html;
}

async function submitJournal() {
  var title = document.getElementById('journalTitle').value.trim();
  var content = document.getElementById('journalContent').value.trim();
  var isShared = document.getElementById('journalShared').checked;
  var ok = await saveJournalEntry(title, content, isShared);
  if (ok) renderClientTabContent();
}

async function renderClientProgressTab(data) {
  var moodEntries = await loadMoodEntries(currentProfile.id, 30);
  var progressData = await loadProgressData(currentProfile.id);
  var html = '<h3 class="section-title">İlerleme</h3>';

  // Mood chart
  html += '<div class="card" style="margin-bottom:var(--space-4);">' +
    '<div class="card-header"><h3 class="card-title">Duygu Grafiği (Son 30 Gün)</h3></div>' +
    renderMoodChart(moodEntries) +
  '</div>';

  // Session history (ALL sessions)
  var allSessions = progressData.allSessions || [];
  allSessions.sort(function(a, b) { return b.session_date.localeCompare(a.session_date); });

  html += '<div class="card" style="margin-bottom:var(--space-4);">' +
    '<div class="card-header"><h3 class="card-title">Seans Geçmişi</h3></div>';

  if (allSessions.length === 0) {
    html += '<p style="color:var(--color-text-muted);font-size:var(--text-sm);text-align:center;padding:var(--space-4);">Henüz seans kaydı yok.</p>';
  } else {
    html += '<div class="session-list session-list-compact">';
    allSessions.forEach(function(sess) {
      var statusClass = sess.status === "completed" ? "session-status-completed" : sess.status === "cancelled" ? "session-status-cancelled" : "session-status-planned";
      var statusLabel = sess.status === "completed" ? "Tamamlandı" : sess.status === "cancelled" ? "İptal" : "Planlandı";
      html +=
        '<div class="session-card session-card-compact">' +
          '<div class="session-card-date">' +
            '<div class="session-day">' + formatSessionDate(sess.session_date) + '</div>' +
            '<div class="session-time">' + sess.start_time.substring(0, 5) + ' – ' + sess.end_time.substring(0, 5) + '</div>' +
          '</div>' +
          '<div class="session-card-info">' +
            '<div class="session-names"><span class="session-expert">' + esc(sess.expert_id ? 'Uzman' : '?') + '</span></div>' +
          '</div>' +
          '<span class="session-status ' + statusClass + '">' + statusLabel + '</span>' +
        '</div>';
    });
    html += '</div>';
  }
  html += '</div>';

  // Homework completion rate
  html += '<div class="card">' +
    '<div class="card-header"><h3 class="card-title">Ödev Durumu</h3></div>' +
    '<div class="progress-grid">' +
      '<div class="progress-card"><div class="progress-value">' + progressData.hwCompleted + '/' + progressData.hwTotal + '</div><div class="progress-label">Tamamlanan Ödev</div></div>' +
      '<div class="progress-card"><div class="progress-value">' + (progressData.hwTotal > 0 ? Math.round((progressData.hwCompleted / progressData.hwTotal) * 100) : 0) + '%</div><div class="progress-label">Tamamlanma Oranı</div></div>' +
    '</div>' +
  '</div>';

  return html;
}

renderClientView = async function() {
  var main = document.getElementById("mainContent");
  main.innerHTML = '<div class="empty-state"><div class="loading-spinner"></div><p>Yükleniyor...</p></div>';

  var assignRes = await sb.from("assignments").select("*, expert:expert_id(id, full_name, specialty, email, areas_of_expertise)").eq("client_id", currentProfile.id);
  var assignment = (assignRes.data || [])[0];

  // Load ALL sessions (not just upcoming)
  var sessionsRes = await sb.from("scheduled_sessions")
    .select("*, expert:expert_id(id, full_name)")
    .eq("client_id", currentProfile.id)
    .order("session_date")
    .order("start_time");
  var allSessions = sessionsRes.data || [];

  // Store data for tabs
  window._clientPortalData = {
    expert: assignment ? assignment.expert : null,
    allSessions: allSessions
  };

  var html = '<div class="page-header"><h2 class="page-title">Hoş Geldiniz, ' + esc(currentProfile.full_name.split(" ")[0]) + '</h2></div>';

  if (!assignment || !assignment.expert) {
    html += '<div class="empty-state"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><circle cx="12" cy="12" r="10"/><path d="M12 8v4"/><path d="M12 16h.01"/></svg><h3>Henüz bir uzman atanmadı</h3><p>Size bir uzman atandığında burada görüşme bilgileri görünecektir.</p></div>';
    main.innerHTML = html;
    return;
  }

  // Tab navigation
  html += '<div class="client-tabs">' +
    '<button class="client-tab-btn active" data-tab="home" onclick="switchClientTab(\'home\')">Ana Sayfa</button>' +
    '<button class="client-tab-btn" data-tab="homework" onclick="switchClientTab(\'homework\')">Ödevlerim</button>' +
    '<button class="client-tab-btn" data-tab="journal" onclick="switchClientTab(\'journal\')">Günlüğüm</button>' +
    '<button class="client-tab-btn" data-tab="progress" onclick="switchClientTab(\'progress\')">İlerleme</button>' +
  '</div>' +
  '<div id="clientTabContent"></div>';

  main.innerHTML = html;
  currentClientTab = 'home';
  renderClientTabContent();
};

// ==================== EXPERT PROFILE EDIT ====================
function openMyProfile() {
  document.getElementById("myProfileName").value = currentProfile.full_name || "";
  document.getElementById("myProfileEmail").value = currentProfile.email || "";
  document.getElementById("myProfileSpecialty").value = currentProfile.specialty || "";
  document.getElementById("myProfileAreas").value = currentProfile.areas_of_expertise || "";
  document.getElementById("myProfilePhone").value = currentProfile.phone || "";
  document.getElementById("myProfileIban").value = currentProfile.iban || "";
  openModal("expertProfileModal");
}

async function saveMyProfile() {
  var specialty = document.getElementById("myProfileSpecialty").value.trim();
  var areas = document.getElementById("myProfileAreas").value.trim();
  var phone = document.getElementById("myProfilePhone").value.trim();
  var iban = document.getElementById("myProfileIban").value.trim().replace(/\s/g, "").toUpperCase();

  if (!specialty) {
    showToast("Unvan boş bırakılamaz.");
    return;
  }

  // Validate IBAN format if provided
  if (iban && !/^TR\d{24}$/.test(iban)) {
    showToast("Geçerli bir TR IBAN giriniz (TR + 24 rakam).");
    return;
  }

  var upd = await sb.from("profiles").update({
    specialty: specialty,
    areas_of_expertise: areas || null,
    phone: phone,
    iban: iban || null,
    updated_at: new Date().toISOString()
  }).eq("id", currentProfile.id);

  if (upd.error) {
    showToast("Hata: " + upd.error.message);
    return;
  }

  // Update local profile
  currentProfile.specialty = specialty;
  currentProfile.areas_of_expertise = areas || null;
  currentProfile.phone = phone;
  currentProfile.iban = iban || null;

  showToast("Profiliniz güncellendi");
  closeModal("expertProfileModal");
  if (typeof currentExpertTab !== 'undefined' && currentExpertTab === 'profile') {
    var pc = document.getElementById('expertTabContent');
    if (pc) renderExpertProfileTab(pc);
  } else {
    renderExpertView();
  }
}

// ==================== DUYURU SİSTEMİ (Announcements) ====================

async function renderAdminAnnouncementsTab() {
  var container = document.getElementById("adminTabContent");
  container.innerHTML = '<div class="empty-state"><div class="loading-spinner"></div><p>Yükleniyor...</p></div>';

  var res = await sb.from("announcements").select("*").order("created_at", { ascending: false });
  var announcements = res.data || [];

  var html =
    '<div class="page-header">' +
      '<h2 class="section-title">Duyuru Yönetimi</h2>' +
      '<button class="btn btn-primary" onclick="openAddAnnouncement()">' +
        '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 5v14"/><path d="M5 12h14"/></svg>' +
        'Yeni Duyuru</button>' +
    '</div>';

  if (announcements.length === 0) {
    html += '<div class="empty-state">' +
      '<svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M19.4 14.9C20.2 16.4 21 17 21 17H3s3-2 3-9c0-3.3 2.7-6 6-6 .7 0 1.3.1 1.9.3"/><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0"/><circle cx="18" cy="8" r="3"/></svg>' +
      '<h3>Henüz duyuru yok</h3>' +
      '<p>Yeni bir duyuru ekleyerek tüm uzmanlara bildirim gönderebilirsiniz.</p>' +
    '</div>';
  } else {
    html += '<div class="announcements-list">';
    announcements.forEach(function(a) {
      var date = new Date(a.created_at);
      var dateStr = date.toLocaleDateString('tr-TR', { day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit' });
      html +=
        '<div class="announcement-card">' +
          '<div class="announcement-header">' +
            '<div>' +
              '<h3 class="announcement-title">' + esc(a.title) + '</h3>' +
              '<span class="announcement-date">' + dateStr + '</span>' +
            '</div>' +
            '<button class="btn btn-ghost btn-sm" onclick="deleteAnnouncement(\'' + a.id + '\')" title="Sil" style="color:var(--color-error);">' +
              '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 6h18"/><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"/><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"/></svg></button>' +
          '</div>' +
          '<div class="announcement-content">' + esc(a.content).replace(/\n/g, '<br>') + '</div>' +
        '</div>';
    });
    html += '</div>';
  }

  container.innerHTML = html;
}

function openAddAnnouncement() {
  document.getElementById("announcementTitle").value = "";
  document.getElementById("announcementContent").value = "";
  openModal("announcementModal");
}

async function saveAnnouncement() {
  var title = document.getElementById("announcementTitle").value.trim();
  var content = document.getElementById("announcementContent").value.trim();

  if (!title || !content) {
    showToast("Başlık ve içerik zorunludur.");
    return;
  }

  var res = await sb.from("announcements").insert({
    title: title,
    content: content,
    created_by: currentProfile.id
  });

  if (res.error) {
    showToast("Hata: " + res.error.message);
    return;
  }

  showToast("Duyuru yayınlandı");
  closeModal("announcementModal");
  renderAdminAnnouncementsTab();
}

async function deleteAnnouncement(id) {
  if (!confirm("Bu duyuruyu silmek istediğinize emin misiniz?")) return;

  var res = await sb.from("announcements").delete().eq("id", id);
  if (res.error) {
    showToast("Hata: " + res.error.message);
    return;
  }

  showToast("Duyuru silindi");
  renderAdminAnnouncementsTab();
}

// ==================== ADMIN LOGIN LOGS TAB ====================
function formatToGMT3(isoString) {
  var d = new Date(isoString);
  // Convert to GMT+3
  var gmt3 = new Date(d.getTime() + (3 * 60 * 60 * 1000));
  var day = String(gmt3.getUTCDate()).padStart(2, '0');
  var month = String(gmt3.getUTCMonth() + 1).padStart(2, '0');
  var year = gmt3.getUTCFullYear();
  var hours = String(gmt3.getUTCHours()).padStart(2, '0');
  var minutes = String(gmt3.getUTCMinutes()).padStart(2, '0');
  var seconds = String(gmt3.getUTCSeconds()).padStart(2, '0');
  return day + '.' + month + '.' + year + ' ' + hours + ':' + minutes + ':' + seconds;
}

var _loginLogsCache = null;
var _loginLogsFilters = { expertId: '', dateFrom: '', dateTo: '' };

async function renderAdminLoginLogsTab() {
  var container = document.getElementById("adminTabContent");
  container.innerHTML = '<div class="empty-state"><div class="loading-spinner"></div><p>Yükleniyor...</p></div>';

  var d = window._adminData;
  var experts = (d && d.experts) || [];

  // Fetch all login logs
  var query = sb.from("login_logs").select("*").order("timestamp", { ascending: false }).limit(5000);
  var res = await query;
  _loginLogsCache = res.data || [];

  // Build user lookup (experts + clients + admin)
  var expertMap = {};
  experts.forEach(function(e) { expertMap[e.id] = e.full_name; });
  var clients = (d && d.clients) || [];
  clients.forEach(function(c) { expertMap[c.id] = c.full_name; });
  // Add admin
  expertMap['cfdf92f1-4bbc-48c4-bd62-47d23ea42d91'] = 'Admin';

  renderLoginLogsContent(experts, expertMap);
}

function renderLoginLogsContent(experts, expertMap) {
  var container = document.getElementById("adminTabContent");
  var logs = filterLoginLogs(_loginLogsCache, expertMap);

  var html =
    '<div class="page-header">' +
      '<h2 class="section-title">Giri\u015f / \u00c7\u0131k\u0131\u015f Loglar\u0131</h2>' +
      '<p style="color:var(--text-secondary);font-size:0.92rem;margin-top:4px;">Panele giri\u015f ve \u00e7\u0131k\u0131\u015f kay\u0131tlar\u0131 (GMT+3)</p>' +
    '</div>' +
    '<div class="login-logs-filters">' +
      '<div class="filter-row">' +
        '<div class="filter-group">' +
          '<label>Uzman</label>' +
          '<select id="logExpertFilter" onchange="applyLoginLogFilter()">' +
            '<option value="">T\u00fcm Uzmanlar</option>';

  experts.sort(function(a, b) { return a.full_name.localeCompare(b.full_name, 'tr'); });
  experts.forEach(function(e) {
    var sel = _loginLogsFilters.expertId === e.id ? ' selected' : '';
    html += '<option value="' + e.id + '"' + sel + '>' + e.full_name + '</option>';
  });

  html +=
          '</select>' +
        '</div>' +
        '<div class="filter-group">' +
          '<label>Ba\u015flang\u0131\u00e7 Tarihi</label>' +
          '<input type="date" id="logDateFrom" value="' + _loginLogsFilters.dateFrom + '" onchange="applyLoginLogFilter()">' +
        '</div>' +
        '<div class="filter-group">' +
          '<label>Biti\u015f Tarihi</label>' +
          '<input type="date" id="logDateTo" value="' + _loginLogsFilters.dateTo + '" onchange="applyLoginLogFilter()">' +
        '</div>' +
        '<div class="filter-group filter-actions">' +
          '<button class="btn btn-sm" onclick="clearLoginLogFilters()" style="margin-top:22px;">Temizle</button>' +
          '<button class="btn btn-primary btn-sm" onclick="exportLoginLogsCSV()" style="margin-top:22px;">\u2913 CSV \u0130ndir</button>' +
        '</div>' +
      '</div>' +
    '</div>';

  html += '<div class="login-logs-summary">' +
    '<span class="log-count">' + logs.length + ' kay\u0131t</span>' +
  '</div>';

  if (logs.length === 0) {
    html += '<div class="empty-state"><svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"/></svg><h3>Kay\u0131t bulunamad\u0131</h3><p>Se\u00e7ilen filtrelere uygun giri\u015f/\u00e7\u0131k\u0131\u015f kayd\u0131 yok.</p></div>';
  } else {
    html += '<div class="table-responsive"><table class="login-logs-table">' +
      '<thead><tr>' +
        '<th>Uzman</th>' +
        '<th>\u0130\u015flem</th>' +
        '<th>Tarih / Saat (GMT+3)</th>' +
        '<th>IP Adresi</th>' +
        '<th>Taray\u0131c\u0131</th>' +
      '</tr></thead><tbody>';

    logs.forEach(function(log) {
      var expertName = expertMap[log.user_id] || 'Bilinmeyen';
      var eventLabel = log.event_type === 'login'
        ? '<span class="log-badge log-login">Giri\u015f</span>'
        : '<span class="log-badge log-logout">\u00c7\u0131k\u0131\u015f</span>';
      var timeStr = formatToGMT3(log.timestamp);
      var ip = log.ip_address || '-';
      var ua = log.user_agent ? shortenUA(log.user_agent) : '-';

      html += '<tr>' +
        '<td class="log-expert-name">' + expertName + '</td>' +
        '<td>' + eventLabel + '</td>' +
        '<td class="log-time">' + timeStr + '</td>' +
        '<td class="log-ip">' + ip + '</td>' +
        '<td class="log-ua" title="' + (log.user_agent || '') + '">' + ua + '</td>' +
      '</tr>';
    });

    html += '</tbody></table></div>';
  }

  container.innerHTML = html;
}

function shortenUA(ua) {
  // Extract browser name from user agent
  if (ua.indexOf('Chrome') > -1 && ua.indexOf('Edg') > -1) return 'Edge';
  if (ua.indexOf('Chrome') > -1 && ua.indexOf('OPR') > -1) return 'Opera';
  if (ua.indexOf('Chrome') > -1) return 'Chrome';
  if (ua.indexOf('Firefox') > -1) return 'Firefox';
  if (ua.indexOf('Safari') > -1) return 'Safari';
  if (ua.indexOf('MSIE') > -1 || ua.indexOf('Trident') > -1) return 'IE';
  return ua.substring(0, 30) + '...';
}

function filterLoginLogs(allLogs, expertMap) {
  return allLogs.filter(function(log) {
    // Only show expert logs
    if (!expertMap[log.user_id]) return false;

    if (_loginLogsFilters.expertId && log.user_id !== _loginLogsFilters.expertId) return false;

    if (_loginLogsFilters.dateFrom) {
      var from = new Date(_loginLogsFilters.dateFrom);
      from.setHours(0, 0, 0, 0);
      var logDate = new Date(log.timestamp);
      // Adjust logDate to GMT+3 for comparison
      var logGMT3 = new Date(logDate.getTime() + (3 * 60 * 60 * 1000));
      var logDateOnly = new Date(logGMT3.getUTCFullYear(), logGMT3.getUTCMonth(), logGMT3.getUTCDate());
      if (logDateOnly < from) return false;
    }

    if (_loginLogsFilters.dateTo) {
      var to = new Date(_loginLogsFilters.dateTo);
      to.setHours(23, 59, 59, 999);
      var logDate2 = new Date(log.timestamp);
      var logGMT3b = new Date(logDate2.getTime() + (3 * 60 * 60 * 1000));
      var logDateOnly2 = new Date(logGMT3b.getUTCFullYear(), logGMT3b.getUTCMonth(), logGMT3b.getUTCDate());
      if (logDateOnly2 > to) return false;
    }

    return true;
  });
}

function applyLoginLogFilter() {
  _loginLogsFilters.expertId = document.getElementById('logExpertFilter').value;
  _loginLogsFilters.dateFrom = document.getElementById('logDateFrom').value;
  _loginLogsFilters.dateTo = document.getElementById('logDateTo').value;

  var d = window._adminData;
  var experts = (d && d.experts) || [];
  var expertMap = {};
  experts.forEach(function(e) { expertMap[e.id] = e.full_name; });
  renderLoginLogsContent(experts, expertMap);
}

function clearLoginLogFilters() {
  _loginLogsFilters = { expertId: '', dateFrom: '', dateTo: '' };
  document.getElementById('logExpertFilter').value = '';
  document.getElementById('logDateFrom').value = '';
  document.getElementById('logDateTo').value = '';
  applyLoginLogFilter();
}

function exportLoginLogsCSV() {
  var d = window._adminData;
  var experts = (d && d.experts) || [];
  var expertMap = {};
  experts.forEach(function(e) { expertMap[e.id] = e.full_name; });

  var logs = filterLoginLogs(_loginLogsCache || [], expertMap);

  if (logs.length === 0) {
    showToast('Dışa aktarılacak kayıt bulunamadı');
    return;
  }

  var csvRows = ['Uzman,İşlem,Tarih/Saat (GMT+3),IP Adresi,Tarayıcı,Oturum ID'];

  logs.forEach(function(log) {
    var name = (expertMap[log.user_id] || 'Bilinmeyen').replace(/,/g, ' ');
    var event = log.event_type === 'login' ? 'Giriş' : 'Çıkış';
    var time = formatToGMT3(log.timestamp);
    var ip = (log.ip_address || '-').replace(/,/g, ' ');
    var ua = (log.user_agent || '-').replace(/,/g, ' ').replace(/"/g, "'");
    var sid = (log.session_id || '-').replace(/,/g, ' ');
    csvRows.push('"' + name + '","' + event + '","' + time + '","' + ip + '","' + ua + '","' + sid + '"');
  });

  var csvContent = '\uFEFF' + csvRows.join('\n'); // BOM for Excel Turkish char support
  var blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
  var url = URL.createObjectURL(blob);
  var a = document.createElement('a');
  a.href = url;
  var now = new Date();
  var dateStr = now.getFullYear() + '-' + String(now.getMonth()+1).padStart(2,'0') + '-' + String(now.getDate()).padStart(2,'0');
  a.download = 'giris_loglari_' + dateStr + '.csv';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
  showToast('CSV dosyası indiriliyor...');
}

// ==================== WORK MODEL AUTO-FEE ====================
document.addEventListener('DOMContentLoaded', function() {
  var wmSel = document.getElementById('expertWorkModel');
  if (wmSel) {
    wmSel.addEventListener('change', function() {
      var feeInput = document.getElementById('expertMonthlyFee');
      if (this.value === 'contract') feeInput.value = '4380';
      else if (this.value === 'commission') feeInput.value = '1590';
      else feeInput.value = '';
    });
  }
});

// ==================== PAYMENT SCHEDULE HELPERS ====================
function getFirstBusinessDayOfMonth(year, month) {
  // First day of month
  var d = new Date(year, month, 1);
  // Move to first weekday (Mon-Fri)
  while (d.getDay() === 0 || d.getDay() === 6) {
    d.setDate(d.getDate() + 1);
  }
  return d;
}

function generatePaymentSchedule(contractStart, contractEnd, amount) {
  var payments = [];
  if (!contractStart || !contractEnd || !amount) return payments;
  var start = new Date(contractStart);
  var end = new Date(contractEnd);
  // Start from the contract start month (ilk ödeme sözleşme başlangıç ayı)
  var curYear = start.getFullYear();
  var curMonth = start.getMonth();
  while (true) {
    var dueDate = getFirstBusinessDayOfMonth(curYear, curMonth);
    if (dueDate > end) break;
    var label = dueDate.toLocaleDateString('tr-TR', { month: 'long', year: 'numeric' });
    label = label.charAt(0).toUpperCase() + label.slice(1);
    payments.push({
      period_label: label,
      due_date: dueDate.toISOString().split('T')[0],
      amount: amount
    });
    curMonth++;
    if (curMonth > 11) { curMonth = 0; curYear++; }
  }
  return payments;
}

// ==================== ADMIN PAYMENTS TAB ====================
var _paymentsExpertFilter = '';

async function renderAdminPaymentsTab() {
  var container = document.getElementById('adminTabContent');
  container.innerHTML = '<div class="empty-state"><div class="loading-spinner"></div><p>Yükleniyor...</p></div>';

  var d = window._adminData;
  var experts = (d && d.experts) || [];

  var html =
    '<div class="page-header">' +
      '<h2 class="section-title">\u00D6deme Y\u00F6netimi</h2>' +
    '</div>';

  // Filter by expert
  html += '<div class="filter-bar" style="margin-bottom:var(--space-4);display:flex;gap:var(--space-3);align-items:center;flex-wrap:wrap;">';
  html += '<select id="paymentExpertFilter" class="form-input" style="max-width:300px;" onchange="filterPaymentsTab()">';
  html += '<option value="">T\u00FCm Uzmanlar</option>';
  for (var i = 0; i < experts.length; i++) {
    var sel = _paymentsExpertFilter === experts[i].id ? ' selected' : '';
    html += '<option value="' + experts[i].id + '"' + sel + '>' + esc(experts[i].full_name) + '</option>';
  }
  html += '</select>';
  html += '<button class="btn btn-primary btn-sm" onclick="openGeneratePayments()">\u00D6deme Takvimi Olu\u015Ftur</button>';
  html += '</div>';

  // Fetch payments
  var query = sb.from('expert_payments').select('*').order('due_date', { ascending: true });
  if (_paymentsExpertFilter) {
    query = query.eq('expert_id', _paymentsExpertFilter);
  }
  var payRes = await query;
  var payments = payRes.data || [];

  // Expert name map
  var expertMap = {};
  experts.forEach(function(e) { expertMap[e.id] = e; });

  if (payments.length === 0) {
    html += '<div class="empty-state"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" width="48" height="48"><rect x="2" y="5" width="20" height="14" rx="2"/><path d="M2 10h20"/></svg>' +
      '<h3>Hen\u00FCz \u00F6deme kayd\u0131 yok</h3>' +
      '<p>\"\u00D6deme Takvimi Olu\u015Ftur\" butonu ile uzmanlar i\u00E7in \u00F6deme plan\u0131 olu\u015Fturabilirsiniz.</p></div>';
  } else {
    // Summary stats
    var totalPending = 0, totalPaid = 0, pendingAmount = 0, paidAmount = 0;
    payments.forEach(function(p) {
      if (p.status === 'paid') { totalPaid++; paidAmount += parseFloat(p.amount); }
      else { totalPending++; pendingAmount += parseFloat(p.amount); }
    });
    html += '<div class="stats-grid" style="margin-bottom:var(--space-4);">' +
      '<div class="stat-card"><div class="stat-value">' + totalPending + '</div><div class="stat-label">Bekleyen</div></div>' +
      '<div class="stat-card"><div class="stat-value">' + totalPaid + '</div><div class="stat-label">\u00D6dendi</div></div>' +
      '<div class="stat-card"><div class="stat-value">' + formatCurrency(pendingAmount) + '</div><div class="stat-label">Bekleyen Tutar</div></div>' +
      '<div class="stat-card"><div class="stat-value">' + formatCurrency(paidAmount) + '</div><div class="stat-label">\u00D6denen Tutar</div></div>' +
    '</div>';

    html += '<div class="table-container"><table class="data-table payment-table">';
    html += '<thead><tr>' +
      '<th>Uzman</th>' +
      '<th>D\u00F6nem</th>' +
      '<th>Vade Tarihi</th>' +
      '<th>Tutar</th>' +
      '<th>Durum</th>' +
      '<th>\u0130\u015Flem</th>' +
    '</tr></thead><tbody>';

    var today = new Date().toISOString().split('T')[0];
    for (var j = 0; j < payments.length; j++) {
      var p = payments[j];
      var exp = expertMap[p.expert_id];
      var expName = exp ? exp.full_name : 'Bilinmeyen';
      var isOverdue = p.status === 'pending' && p.due_date < today;
      var rowClass = p.status === 'paid' ? 'payment-paid' : (isOverdue ? 'payment-overdue' : 'payment-pending');
      var statusText = p.status === 'paid' ? '\u00D6dendi' : (isOverdue ? 'Gecikmi\u015F' : 'Bekliyor');
      var statusBadge = p.status === 'paid'
        ? '<span class="badge badge-success">\u00D6dendi</span>'
        : (isOverdue ? '<span class="badge badge-danger">Gecikmi\u015F</span>' : '<span class="badge badge-warning">Bekliyor</span>');
      var dueDateFormatted = new Date(p.due_date + 'T00:00:00').toLocaleDateString('tr-TR', { day: 'numeric', month: 'long', year: 'numeric' });

      html += '<tr class="' + rowClass + '">' +
        '<td data-label="Uzman">' + esc(expName) + '</td>' +
        '<td data-label="D\u00F6nem">' + esc(p.period_label) + '</td>' +
        '<td data-label="Vade">' + dueDateFormatted + '</td>' +
        '<td data-label="Tutar">' + formatCurrency(parseFloat(p.amount)) + '</td>' +
        '<td data-label="Durum">' + statusBadge + '</td>' +
        '<td data-label="\u0130\u015Flem">';

      if (p.status === 'pending') {
        html += '<button class="btn btn-primary btn-sm" onclick="markPaymentPaid(\'' + p.id + '\')">' +
          '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M20 6 9 17l-5-5"/></svg> \u00D6dendi \u0130\u015Faretle</button>';
      } else {
        var paidDate = p.paid_at ? new Date(p.paid_at).toLocaleDateString('tr-TR') : '-';
        html += '<span style="font-size:var(--text-xs);color:var(--color-text-faint);">' + paidDate + '</span>';
      }
      html += '</td></tr>';
    }
    html += '</tbody></table></div>';
  }

  container.innerHTML = html;
}

function formatCurrency(val) {
  return val.toLocaleString('tr-TR', { minimumFractionDigits: 0, maximumFractionDigits: 0 }) + ' \u20BA';
}

function filterPaymentsTab() {
  _paymentsExpertFilter = document.getElementById('paymentExpertFilter').value;
  renderAdminPaymentsTab();
}

async function markPaymentPaid(paymentId) {
  var upd = await sb.from('expert_payments').update({
    status: 'paid',
    paid_at: new Date().toISOString(),
    paid_by: currentProfile.id,
    updated_at: new Date().toISOString()
  }).eq('id', paymentId);

  if (upd.error) {
    showToast('Hata: ' + upd.error.message);
    return;
  }
  showToast('\u00D6deme \u00F6dendi olarak i\u015Faretlendi');
  renderAdminPaymentsTab();
}

// Generate payment schedule modal flow
async function openGeneratePayments() {
  var d = window._adminData;
  var experts = (d && d.experts) || [];
  var eligibleExperts = experts.filter(function(e) {
    return e.contract_start && e.contract_end && e.work_model && e.monthly_fee;
  });

  if (eligibleExperts.length === 0) {
    showToast('\u00D6deme takvimi olu\u015Fturulacak uygun uzman bulunamad\u0131. Uzmanlar\u0131n s\u00F6zle\u015Fme tarihleri, \u00E7al\u0131\u015Fma modeli ve ayl\u0131k \u00FCcret bilgilerini doldurunuz.');
    return;
  }

  // Build confirm modal
  var html = '<div style="max-height:400px;overflow-y:auto;">';
  html += '<p style="margin-bottom:var(--space-3);font-size:var(--text-sm);color:var(--color-text-faint);">A\u015Fa\u011F\u0131daki uzmanlar i\u00E7in s\u00F6zle\u015Fme tarihlerine g\u00F6re \u00F6deme takvimi olu\u015Fturulacakt\u0131r. Mevcut \u00F6demeleri olan uzmanlar\u0131n takvimleri tekrar olu\u015Fturulmaz.</p>';
  html += '<table class="data-table" style="font-size:var(--text-sm);"><thead><tr><th>Uzman</th><th>Model</th><th>Ayl\u0131k</th><th>S\u00F6zle\u015Fme</th></tr></thead><tbody>';
  for (var i = 0; i < eligibleExperts.length; i++) {
    var e = eligibleExperts[i];
    var modelLabel = e.work_model === 'contract' ? 'S\u00F6zle\u015Fmeli' : 'Komisyonlu';
    html += '<tr><td>' + esc(e.full_name) + '</td><td>' + modelLabel + '</td><td>' + formatCurrency(parseFloat(e.monthly_fee)) + '</td>' +
      '<td>' + e.contract_start + ' / ' + e.contract_end + '</td></tr>';
  }
  html += '</tbody></table></div>';

  // Ensure modal exists (create dynamically if not in HTML)
  if (!document.getElementById('paymentConfirmModal')) {
    var modalEl = document.createElement('div');
    modalEl.id = 'paymentConfirmModal';
    modalEl.className = 'modal-overlay';
    modalEl.innerHTML =
      '<div class="modal modal-wide">' +
        '<div class="modal-header">' +
          '<h3 class="modal-title">\u00D6deme Takvimi Olu\u015Ftur</h3>' +
          '<button class="modal-close" onclick="closeModal(\'paymentConfirmModal\')">' +
            '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>' +
          '</button>' +
        '</div>' +
        '<div id="paymentConfirmBody"></div>' +
        '<div class="modal-footer">' +
          '<button class="btn btn-secondary" onclick="closeModal(\'paymentConfirmModal\')">Vazge\u00E7</button>' +
          '<button class="btn btn-primary" id="paymentConfirmOkBtn">Olu\u015Ftur</button>' +
        '</div>' +
      '</div>';
    document.body.appendChild(modalEl);
  }
  document.getElementById('paymentConfirmBody').innerHTML = html;
  document.getElementById('paymentConfirmOkBtn').onclick = function() {
    closeModal('paymentConfirmModal');
    executeGeneratePayments(eligibleExperts);
  };
  openModal('paymentConfirmModal');
}

async function executeGeneratePayments(experts) {
  var created = 0;
  for (var i = 0; i < experts.length; i++) {
    var e = experts[i];
    // Check if payments already exist for this expert
    var existRes = await sb.from('expert_payments').select('id').eq('expert_id', e.id).limit(1);
    if (existRes.data && existRes.data.length > 0) continue; // Skip

    var schedule = generatePaymentSchedule(e.contract_start, e.contract_end, e.monthly_fee);
    for (var j = 0; j < schedule.length; j++) {
      var pmt = schedule[j];
      await sb.from('expert_payments').insert({
        expert_id: e.id,
        period_label: pmt.period_label,
        due_date: pmt.due_date,
        amount: pmt.amount,
        status: 'pending'
      });
      created++;
    }
  }
  showToast(created + ' \u00F6deme kayd\u0131 olu\u015Fturuldu');
  renderAdminPaymentsTab();
}

// ==================== EXPERT PAYMENT CALENDAR VIEW ====================
var _expertPaymentsCache = [];

async function renderExpertPaymentsSection() {
  var container = document.getElementById('expertPaymentsContainer');
  if (!container) return;
  container.innerHTML = '<div class="loading-spinner" style="margin:var(--space-4) auto;"></div>';

  var payRes = await sb.from('expert_payments').select('*').eq('expert_id', currentProfile.id).order('due_date', { ascending: true });
  var payments = payRes.data || [];
  _expertPaymentsCache = payments;

  if (payments.length === 0) {
    container.innerHTML = '<div class="empty-state" style="padding:var(--space-6);">' +
      '<p style="color:var(--color-text-faint);">Hen\u00FCz \u00F6deme takvimi olu\u015Fturulmam\u0131\u015F.</p></div>';
    return;
  }

  var html = '';
  // Company IBAN info
  html += '<div class="payment-company-info">' +
    '<div class="payment-company-title">' +
      '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="2" y="5" width="20" height="14" rx="2"/><path d="M2 10h20"/></svg>' +
      ' \u00D6deme Bilgileri' +
    '</div>' +
    '<div class="payment-company-detail">' +
      '<strong>Firma:</strong> SYNAPSE LYNK DANI\u015EMANLIK VE E\u011E\u0130T\u0130M H\u0130ZMETLER\u0130 L\u0130M\u0130TED \u015E\u0130RKET\u0130' +
    '</div>' +
    '<div class="payment-company-detail">' +
      '<strong>IBAN:</strong> <span class="payment-iban">TR29 0001 2001 6620 0010 1011 89</span>' +
      ' <button class="btn btn-ghost btn-sm" onclick="copyCompanyIban()" title="Kopyala" style="padding:2px 6px;">' +
        '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg></button>' +
    '</div>' +
    '<div class="payment-company-hint">Ayl\u0131k hizmet bedelinizi yukar\u0131daki IBAN\'a havale/EFT ile g\u00F6nderebilirsiniz.</div>' +
  '</div>';

  // Stats
  var totalPending = 0, totalPaid = 0, nextPayment = null;
  var today = new Date().toISOString().split('T')[0];
  payments.forEach(function(p) {
    if (p.status === 'paid') totalPaid++;
    else {
      totalPending++;
      if (!nextPayment && p.due_date >= today) nextPayment = p;
    }
  });

  html += '<div class="stats-grid" style="margin-bottom:var(--space-4);">' +
    '<div class="stat-card"><div class="stat-value">' + totalPaid + '/' + payments.length + '</div><div class="stat-label">\u00D6denen / Toplam</div></div>';
  if (nextPayment) {
    var nextDate = new Date(nextPayment.due_date + 'T00:00:00').toLocaleDateString('tr-TR', { day: 'numeric', month: 'long' });
    html += '<div class="stat-card"><div class="stat-value">' + formatCurrency(parseFloat(nextPayment.amount)) + '</div><div class="stat-label">Sonraki \u00D6deme (' + nextDate + ')</div></div>';
  }
  html += '</div>';

  // Payment list
  html += '<div class="payment-list">';
  for (var k = 0; k < payments.length; k++) {
    var p = payments[k];
    var isOverdue = p.status === 'pending' && p.due_date < today;
    var statusClass = p.status === 'paid' ? 'paid' : (isOverdue ? 'overdue' : 'pending');
    var statusLabel = p.status === 'paid' ? '\u00D6dendi' : (isOverdue ? 'Gecikmi\u015F' : 'Bekliyor');
    var iconSvg = p.status === 'paid'
      ? '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M20 6 9 17l-5-5"/></svg>'
      : '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/></svg>';
    var dueDateStr = new Date(p.due_date + 'T00:00:00').toLocaleDateString('tr-TR', { day: 'numeric', month: 'long', year: 'numeric' });

    html += '<div class="payment-item payment-item-' + statusClass + '">' +
      '<div class="payment-item-icon">' + iconSvg + '</div>' +
      '<div class="payment-item-info">' +
        '<div class="payment-item-period">' + esc(p.period_label) + '</div>' +
        '<div class="payment-item-date">' + dueDateStr + '</div>' +
      '</div>' +
      '<div class="payment-item-right">' +
        '<div class="payment-item-amount">' + formatCurrency(parseFloat(p.amount)) + '</div>' +
        '<div class="payment-item-status payment-status-' + statusClass + '">' + statusLabel + '</div>' +
      '</div>' +
    '</div>';
  }
  html += '</div>';

  container.innerHTML = html;
}

function copyCompanyIban() {
  var ibanText = 'TR2900012001662000101011 89';
  if (navigator.clipboard) {
    navigator.clipboard.writeText(ibanText).then(function() {
      showToast('IBAN kopyaland\u0131');
    });
  } else {
    var ta = document.createElement('textarea');
    ta.value = ibanText;
    document.body.appendChild(ta);
    ta.select();
    document.execCommand('copy');
    document.body.removeChild(ta);
    showToast('IBAN kopyaland\u0131');
  }
}
