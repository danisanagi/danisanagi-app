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
    showApp();
  } catch (e) {
    errEl.textContent = "Bağlantı hatası: " + e.message;
    errEl.style.display = "block";
  }
}

async function handleLogout() {
  if (sb) await sb.auth.signOut();
  currentUser = null;
  currentProfile = null;
  showScreen("loginScreen");
  document.getElementById("loginEmail").value = "";
  document.getElementById("loginPassword").value = "";
  document.getElementById("loginError").style.display = "none";
}

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
    html +=
      '<div class="user-card" data-name="' + expert.full_name.toLowerCase() + '">' +
        '<div class="user-card-avatar expert-avatar">' + getInitials(expert.full_name) + '</div>' +
        '<div class="user-card-info">' +
          '<div class="user-card-name">' + esc(expert.full_name) + '</div>' +
          '<div class="user-card-detail">' + esc(expert.specialty || "Belirtilmemiş") + ' — ' + clientCount + ' danışan</div>' +
        '</div>' +
        '<div class="user-card-actions">' +
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
    html +=
      '<div class="user-card" data-name="' + client.full_name.toLowerCase() + '">' +
        '<div class="user-card-avatar">' + getInitials(client.full_name) + '</div>' +
        '<div class="user-card-info">' +
          '<div class="user-card-name">' + esc(client.full_name) + '</div>' +
          '<div class="user-card-detail">Uzman: ' + esc(expertName) + '</div>' +
        '</div>' +
        '<div class="user-card-actions">' +
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

async function renderAdminNotesTab() {
  var container = document.getElementById("adminTabContent");
  var d = window._adminData;

  var html = '<h2 class="section-title">Tüm Seans Notları</h2>';

  if (d.notes.length === 0) {
    html += '<div class="empty-state"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M12 20h9"/><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z"/></svg><h3>Henüz not yok</h3><p>Uzmanlar seans notları eklediğinde burada görünecektir.</p></div>';
  } else {
    var sorted = d.notes.slice().sort(function(a, b) { return new Date(b.created_at) - new Date(a.created_at); });
    sorted.forEach(function(note) {
      var expert = d.experts.find(function(e) { return e.id === note.expert_id; });
      var client = d.clients.find(function(c) { return c.id === note.client_id; });
      html +=
        '<div class="note-item">' +
          '<div class="note-date"><strong>' + esc(expert ? expert.full_name : "?") + '</strong> → <strong>' + esc(client ? client.full_name : "?") + '</strong> — ' + formatDate(note.created_at) + '</div>' +
          '<div class="note-text">' + esc(note.content) + '</div>' +
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
  document.getElementById("expertPhone").value = "";
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
  document.getElementById("expertPhone").value = expert.phone || "";
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
  var phone = document.getElementById("expertPhone").value.trim();

  if (!name || !email || !specialty) {
    showToast("Ad, e-posta ve uzmanlık alanı zorunludur.");
    return;
  }

  if (editingId) {
    // Update profile (direct Supabase — no auth conflict)
    var upd = await sb.from("profiles").update({
      full_name: name,
      specialty: specialty,
      phone: phone,
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
        phone: phone
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

  if (!name || !email) {
    showToast("Ad ve e-posta zorunludur.");
    return;
  }

  if (editingId) {
    var upd = await sb.from("profiles").update({
      full_name: name,
      phone: phone,
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
        expert_id: expertId
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

  var notesRes = await sb.from("notes").select("*").eq("expert_id", currentProfile.id).eq("client_id", clientId).order("created_at", { ascending: false });
  var notes = notesRes.data || [];

  var expertClientList = document.getElementById("expertClientList");
  if (expertClientList) expertClientList.style.display = "none";
  var upcomingSection = document.querySelector(".upcoming-sessions-section");
  if (upcomingSection) upcomingSection.style.display = "none";
  document.querySelector(".page-header").style.display = "none";
  var detailEl = document.getElementById("clientDetailView");
  detailEl.classList.add("active");

  var html =
    '<button class="back-btn" onclick="backToExpertList()">' +
      '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="m12 19-7-7 7-7"/><path d="M19 12H5"/></svg> Geri Dön</button>' +
    '<div class="detail-header">' +
      '<div class="detail-avatar">' + getInitials(client.full_name) + '</div>' +
      '<div class="detail-info"><h2>' + esc(client.full_name) + '</h2><p>' + esc(client.email) + (client.phone ? ' — ' + esc(client.phone) : '') + '</p></div>' +
      '<button class="btn btn-primary btn-sm" onclick="startVideoCall(\'' + escAttr(client.id) + '\',\'' + escAttr(client.full_name) + '\')" style="margin-left:auto;">' +
        '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="m22 8-6 4 6 4V8Z"/><rect width="14" height="12" x="2" y="6" rx="2"/></svg> Görüşme</button>' +
    '</div>' +
    '<div class="notes-section">' +
      '<h3 class="section-title">Seans Notları</h3>' +
      '<div class="note-input-area">' +
        '<textarea id="newNoteText" placeholder="Yeni seans notu yazın..."></textarea>' +
        '<button class="btn btn-primary" onclick="addNote(\'' + clientId + '\')">Ekle</button>' +
      '</div>';

  if (notes.length === 0) {
    html += '<p style="color:var(--color-text-muted);font-size:var(--text-sm);text-align:center;padding:var(--space-6);">Henüz not eklenmemiş.</p>';
  } else {
    notes.forEach(function(note) {
      html += '<div class="note-item"><div class="note-date">' + formatDate(note.created_at) + '</div><div class="note-text">' + esc(note.content) + '</div></div>';
    });
  }

  html += '</div>';
  detailEl.innerHTML = html;
}

function backToExpertList() {
  var expertClientList = document.getElementById("expertClientList");
  if (expertClientList) expertClientList.style.display = "grid";
  var upcomingSection = document.querySelector(".upcoming-sessions-section");
  if (upcomingSection) upcomingSection.style.display = "";
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
          '<div><div style="font-weight:600;font-size:var(--text-base);">' + esc(expert.full_name) + '</div><div style="font-size:var(--text-sm);color:var(--color-text-muted);">' + esc(expert.specialty || "") + '</div></div>' +
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
