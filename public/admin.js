/* ============================================================
   Pesaplug Admin Console
   ============================================================ */
const TOKEN_KEY = "pesaplug_admin_token";
const $ = (id) => document.getElementById(id);
const getToken = () => localStorage.getItem(TOKEN_KEY);
const setToken = (t) => localStorage.setItem(TOKEN_KEY, t);
const clearToken = () => localStorage.removeItem(TOKEN_KEY);
const fmt = (n) => Number(n || 0).toLocaleString("en-KE");

let toastTimer;
function toast(msg, type = "success") {
  const t = $("toast");
  t.textContent = msg;
  t.className = `toast show ${type}`;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (t.className = "toast"), 2800);
}

async function api(path, { method = "GET", body } = {}) {
  const headers = { "Content-Type": "application/json" };
  if (getToken()) headers.Authorization = `Bearer ${getToken()}`;
  const res = await fetch(path, { method, headers, body: body ? JSON.stringify(body) : undefined });
  const data = await res.json().catch(() => ({}));
  if (res.status === 401) {
    clearToken();
    showLogin();
    throw new Error(data.error || "Session expired");
  }
  if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
  return data;
}

/* ---------- Login ---------- */
function showLogin() {
  $("adminApp").classList.add("hidden");
  $("adminLogin").classList.remove("hidden");
}
function showApp() {
  $("adminLogin").classList.add("hidden");
  $("adminApp").classList.remove("hidden");
  refreshAll();
}

$("adminLoginForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const hint = $("adminLoginHint");
  hint.style.color = "var(--danger)";
  try {
    const data = await api("/api/admin/login", {
      method: "POST",
      body: { user: $("adminUser").value.trim(), pass: $("adminPass").value }
    });
    setToken(data.token);
    showApp();
  } catch (err) {
    hint.textContent = err.message;
  }
});

$("adminLogout").addEventListener("click", () => {
  clearToken();
  showLogin();
});

/* ---------- Tabs ---------- */
document.querySelectorAll(".admin-tab").forEach((b) =>
  b.addEventListener("click", () => {
    document.querySelectorAll(".admin-tab").forEach((x) => x.classList.remove("active"));
    document.querySelectorAll(".admin-view").forEach((x) => x.classList.remove("active"));
    b.classList.add("active");
    $("tab-" + b.dataset.tab).classList.add("active");
  })
);

/* ---------- Render ---------- */
async function refreshAll() {
  await Promise.all([loadStats(), loadWithdrawals(), loadUsers(), loadVideos()]);
}

async function loadStats() {
  const { stats, mpesaConfigured } = await api("/api/admin/stats");
  const grid = $("statGrid");
  const cards = [
    { num: fmt(stats.users), lbl: "Users" },
    { num: fmt(stats.videosWatched), lbl: "Videos watched" },
    { num: "KSh " + fmt(stats.totalPaid), lbl: "Total paid out" },
    { num: fmt(stats.pendingCount), lbl: "Pending withdrawals" },
    { num: "KSh " + fmt(stats.pendingAmount), lbl: "Pending amount" },
    { num: "KSh " + fmt(stats.balanceOutstanding), lbl: "User balances (liability)" }
  ];
  grid.innerHTML = cards
    .map((c) => `<div class="stat-box"><div class="num">${c.num}</div><div class="lbl">${c.lbl}</div></div>`)
    .join("");
  const m = document.createElement("div");
  m.className = "stat-box";
  m.innerHTML = `<div class="num" style="color:${mpesaConfigured ? "var(--primary)" : "var(--danger)"}">${mpesaConfigured ? "ON" : "OFF"}</div><div class="lbl">M-Pesa payouts</div>`;
  grid.appendChild(m);
}

function esc(s) {
  return String(s == null ? "" : s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
}

async function loadWithdrawals() {
  const { withdrawals } = await api("/api/admin/withdrawals");
  const body = $("withdrawalsBody");
  if (!withdrawals.length) {
    body.innerHTML = '<tr class="empty-row"><td colspan="8">No withdrawals yet.</td></tr>';
    return;
  }
  body.innerHTML = withdrawals
    .map((w) => {
      const canAct = ["pending", "processing"].includes(w.status);
      return `<tr>
        <td>#${w.id}</td>
        <td>${esc(w.user_name)}<br><small style="color:var(--muted)">${esc(w.user_email)}</small></td>
        <td>${w.method === "mpesa" ? "M-Pesa" : "PayPal"}</td>
        <td>${esc(w.destination)}</td>
        <td>KSh ${fmt(w.amount)}</td>
        <td><span class="badge ${w.status}">${w.status}</span></td>
        <td>${esc(w.created_at)}</td>
        <td>
          <button class="act-btn act-paid" data-id="${w.id}" data-action="paid" ${canAct ? "" : "disabled"}>Mark paid</button>
          <button class="act-btn act-reject" data-id="${w.id}" data-action="reject" ${canAct ? "" : "disabled"}>Reject</button>
        </td>
      </tr>`;
    })
    .join("");

  body.querySelectorAll(".act-btn").forEach((btn) =>
    btn.addEventListener("click", async () => {
      const id = btn.dataset.id;
      const action = btn.dataset.action;
      if (action === "reject" && !confirm("Reject this withdrawal and refund the user?")) return;
      try {
        await api(`/api/admin/withdrawals/${id}/action`, { method: "POST", body: { action } });
        toast(action === "paid" ? "Marked as paid" : "Rejected & refunded");
        await Promise.all([loadWithdrawals(), loadStats(), loadUsers()]);
      } catch (err) {
        toast(err.message, "error");
      }
    })
  );
}

async function loadUsers() {
  const { users } = await api("/api/admin/users");
  const body = $("usersBody");
  if (!users.length) {
    body.innerHTML = '<tr class="empty-row"><td colspan="8">No users yet.</td></tr>';
    return;
  }
  body.innerHTML = users
    .map(
      (u) => `<tr>
        <td>#${u.id}</td>
        <td>${esc(u.name)}</td>
        <td>${esc(u.email)}</td>
        <td>KSh ${fmt(u.balance)}</td>
        <td>KSh ${fmt(u.total_earned)}</td>
        <td>${fmt(u.videos_watched)}</td>
        <td>${fmt(u.streak_days)}</td>
        <td>${esc(u.created_at)}</td>
      </tr>`
    )
    .join("");
}

async function loadVideos() {
  const { videos } = await api("/api/admin/videos");
  const grid = $("videoGrid");
  if (!videos.length) {
    grid.innerHTML = '<p style="color:var(--muted)">No videos. Add one above.</p>';
    return;
  }
  grid.innerHTML = videos
    .map(
      (v) => `<div class="video-tile">
        <div class="vt-left">
          ${v.youtubeId
            ? `<img class="vt-thumb" src="https://img.youtube.com/vi/${esc(v.youtubeId)}/mqdefault.jpg" alt="" />`
            : `<span class="vt-emoji">${esc(v.emoji)}</span>`}
          <span class="vt-title">${esc(v.title)}</span>
        </div>
        <button class="del-btn" data-id="${v.id}" title="Delete">🗑</button>
      </div>`
    )
    .join("");
  grid.querySelectorAll(".del-btn").forEach((btn) =>
    btn.addEventListener("click", async () => {
      if (!confirm("Delete this video?")) return;
      try {
        await api(`/api/admin/videos/${btn.dataset.id}`, { method: "DELETE" });
        toast("Video deleted");
        loadVideos();
      } catch (err) {
        toast(err.message, "error");
      }
    })
  );
}

$("videoForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const title = $("videoTitle").value.trim();
  const emoji = $("videoEmoji").value.trim() || "🎬";
  const url = $("videoUrl").value.trim();
  if (!title) return;
  if (!url) return toast("Add a YouTube link or video ID", "error");
  try {
    await api("/api/admin/videos", { method: "POST", body: { title, emoji, url } });
    $("videoForm").reset();
    toast("Video added");
    loadVideos();
  } catch (err) {
    toast(err.message, "error");
  }
});

/* ---------- Boot ---------- */
if (getToken()) {
  // verify by loading stats
  api("/api/admin/stats").then(showApp).catch(showLogin);
} else {
  showLogin();
}
