/* ============================================================
   Pesaplug frontend — talks to the backend API.
   Auth token is stored in localStorage; all balances,
   streaks, video rewards and withdrawals live on the server.
   ============================================================ */

const API = ""; // same origin
const TOKEN_KEY = "pesaplug_token";

let RULES = { rewardPerVideo: 20, streakReward: 10, videoLength: 30, minWithdraw: 240, mpesaConfigured: false };
let me = null; // current user

/* ---------- DOM helper ---------- */
const $ = (id) => document.getElementById(id);

/* ---------- Token ---------- */
const getToken = () => localStorage.getItem(TOKEN_KEY);
const setToken = (t) => localStorage.setItem(TOKEN_KEY, t);
const clearToken = () => localStorage.removeItem(TOKEN_KEY);

/* ---------- API wrapper ---------- */
async function api(path, { method = "GET", body, authed = true } = {}) {
  const headers = { "Content-Type": "application/json" };
  if (authed && getToken()) headers.Authorization = `Bearer ${getToken()}`;
  const res = await fetch(API + path, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
  return data;
}

/* ---------- Toast ---------- */
let toastTimer;
function toast(msg, type = "success") {
  const t = $("toast");
  t.textContent = msg;
  t.className = `toast show ${type}`;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (t.className = "toast"), 2800);
}

const fmt = (n) => Number(n || 0).toLocaleString("en-KE");

/* ============================================================
   AUTH
   ============================================================ */
let authMode = "login";

function setAuthMode(mode) {
  authMode = mode;
  $("tabLogin").classList.toggle("active", mode === "login");
  $("tabRegister").classList.toggle("active", mode === "register");
  $("nameField").classList.toggle("hidden", mode !== "register");
  $("authSubmit").textContent = mode === "login" ? "Log in" : "Create account";
  $("authPassword").setAttribute("autocomplete", mode === "login" ? "current-password" : "new-password");
  $("authHint").textContent = "";
}

document.querySelectorAll(".auth-tab").forEach((b) =>
  b.addEventListener("click", () => setAuthMode(b.dataset.auth))
);

$("authForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const hint = $("authHint");
  hint.style.color = "var(--danger)";
  const email = $("authEmail").value.trim();
  const password = $("authPassword").value;
  const name = $("authName").value.trim();

  try {
    const path = authMode === "login" ? "/api/auth/login" : "/api/auth/register";
    const body =
      authMode === "login"
        ? { email, password }
        : { name, email, password, ref: new URLSearchParams(location.search).get("ref") || "" };
    const data = await api(path, { method: "POST", body, authed: false });
    setToken(data.token);
    me = data.user;
    await enterApp();
  } catch (err) {
    hint.textContent = err.message;
  }
});

$("logoutBtn").addEventListener("click", () => {
  clearToken();
  me = null;
  $("appShell").classList.add("hidden");
  $("authWrap").classList.remove("hidden");
  $("authForm").reset();
});

/* ============================================================
   APP BOOT
   ============================================================ */
async function enterApp() {
  $("authWrap").classList.add("hidden");
  $("appShell").classList.remove("hidden");
  $("userName").textContent = me.name;
  RULES = await api("/api/config", { authed: false });
  await loadVideos();
  await loadReferrals();
  await loadOffers();
  initAds();
  applyRulesToUI();
  render();
  await loadHistory();
  navigate("home");
}

async function loadVideos() {
  try {
    const { videos } = await api("/api/videos", { authed: false });
    const playable = (videos || []).filter((v) => v.youtubeId);
    if (playable.length) VIDEO_LIBRARY = playable;
  } catch {
    /* keep default library */
  }
  pickVideo();
}

function applyRulesToUI() {
  document.querySelectorAll("[data-video-reward]").forEach((el) => (el.textContent = RULES.rewardPerVideo));
  $("videoTimer").textContent = fmtTime(RULES.videoLength);
  if ($("adReward")) $("adReward").textContent = RULES.adReward || 5;
  if ($("rfrReferrer")) $("rfrReferrer").textContent = RULES.referral ? RULES.referral.referrerBonus : 50;
  if ($("rfrSignup")) $("rfrSignup").textContent = RULES.referral ? RULES.referral.signupBonus : 20;
  const infoBanner = $("infoBanner");
  if (!RULES.mpesaConfigured) {
    infoBanner.innerHTML = `Signed in as <strong>${me.name}</strong>. Note: M-Pesa payouts not yet configured on the server.`;
  }
}

/* ============================================================
   RENDER
   ============================================================ */
function render() {
  $("balanceTop").textContent = fmt(me.balance);
  $("balanceHome").textContent = fmt(me.balance);
  $("balanceWithdraw").textContent = fmt(me.balance);
  $("videosWatched").textContent = fmt(me.videosWatched);
  $("totalEarned").textContent = fmt(me.totalEarned);
  $("streakDays").textContent = fmt(me.streakDays);
  renderStreak();
}

function todayKey() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function renderStreak() {
  const track = $("streakTrack");
  track.innerHTML = "";
  const claimedToday = me.lastClaim === todayKey();
  const filled = claimedToday ? ((me.streakDays - 1) % 7) + 1 : (me.streakDays % 7);
  for (let i = 0; i < 7; i++) {
    const dot = document.createElement("div");
    dot.className = "streak-dot" + (i < filled ? " filled" : "");
    dot.textContent = "D" + (i + 1);
    track.appendChild(dot);
  }
  const btn = $("claimStreakBtn");
  const hint = $("streakHint");
  if (claimedToday) {
    btn.disabled = true;
    btn.textContent = "Claimed today ✓";
    hint.textContent = "Come back tomorrow to keep your streak going!";
  } else {
    btn.disabled = false;
    btn.textContent = `Claim daily ${RULES.streakReward} KSh`;
    hint.textContent = me.lastClaim ? "Your streak is waiting — claim now!" : "Start your streak today!";
  }
}

async function loadHistory() {
  try {
    const { withdrawals } = await api("/api/withdrawals");
    const list = $("historyList");
    if (!withdrawals.length) {
      list.innerHTML = '<li class="empty">No withdrawals yet.</li>';
      return;
    }
    list.innerHTML = "";
    withdrawals.forEach((w) => {
      const li = document.createElement("li");
      li.className = "history-item";
      li.innerHTML = `
        <div class="hi-left">
          <span class="hi-method">${w.method === "mpesa" ? "M-Pesa" : "PayPal"} · ${w.destination}</span>
          <span class="hi-date">${w.created_at}</span>
        </div>

        <!-- Aviator crash game (demo) -->
        <div class="aviator-section">
          <div class="card-head"><h2>🎮 Aviator</h2><span class="chip green">Demo</span></div>
          <p class="muted">Try the Aviator crash game. This is a demo for fun — no real money.</p>
          <a class="btn btn-primary" href="https://aviatorgame.org/demo" target="_blank" rel="noopener" style="margin-top:8px">🚀 Play Aviator Demo</a>
          <p class="hint" style="margin-top:8px">Opens in a new tab.</p>
        </div>
        <div style="text-align:right">
          <div class="hi-amount">KSh ${fmt(w.amount)}</div>
          <div class="hi-status">${w.status}</div>
        </div>`;
      list.appendChild(li);
    });
  } catch (e) {
    /* ignore */
  }
}

/* ============================================================
   NAVIGATION
   ============================================================ */
function navigate(view) {
  document.querySelectorAll(".view").forEach((v) => v.classList.remove("active"));
  $("view-" + view).classList.add("active");
  document.querySelectorAll(".nav-item").forEach((n) =>
    n.classList.toggle("active", n.dataset.nav === view)
  );
  window.scrollTo({ top: 0, behavior: "smooth" });
}
document.querySelectorAll("[data-nav]").forEach((el) =>
  el.addEventListener("click", () => navigate(el.dataset.nav))
);

/* ============================================================
   DAILY STREAK
   ============================================================ */
$("claimStreakBtn").addEventListener("click", async () => {
  try {
    const data = await api("/api/streak/claim", { method: "POST" });
    me = data.user;
    render();
    toast(`+${data.reward} KSh daily bonus! 🔥 ${data.streakDays}-day streak`);
  } catch (err) {
    toast(err.message, "error");
  }
});

/* ============================================================
   VIDEO WATCHING — real YouTube playback
   Reward is granted after RULES.videoLength seconds of ACTUAL
   playback (tracked via the YouTube IFrame API), or when the
   clip ends.
   ============================================================ */
const VIDEO_LIBRARY_DEFAULT = [
  { emoji: "🎵", title: "See You Again", youtubeId: "RgKAFK5djSk" },
  { emoji: "🎶", title: "Despacito", youtubeId: "kJQP7kiw5Fk" },
  { emoji: "🕺", title: "Gangnam Style", youtubeId: "9bZkp7q19f0" },
  { emoji: "🎤", title: "Uptown Funk", youtubeId: "OPf0YbXqDm0" }
];
let VIDEO_LIBRARY = VIDEO_LIBRARY_DEFAULT.slice();
let currentVideo = null;
let watching = false;
let rewarded = false;
let watchInterval = null;
let watchedSeconds = 0;

// YouTube IFrame API
let ytPlayer = null;
let ytReady = false;
window.onYouTubeIframeAPIReady = function () {
  ytReady = true;
  ytPlayer = new YT.Player("ytPlayer", {
    height: "100%",
    width: "100%",
    playerVars: { rel: 0, modestbranding: 1, playsinline: 1 },
    events: {
      onStateChange: onYtStateChange
    }
  });
};

function pickVideo() {
  currentVideo = VIDEO_LIBRARY[Math.floor(Math.random() * VIDEO_LIBRARY.length)];
  $("videoEmoji").textContent = currentVideo.emoji || "🎬";
  $("videoTitle").textContent = currentVideo.title;
}
function fmtTime(s) {
  const m = Math.floor(s / 60);
  const sec = s % 60;
  return `${m}:${String(sec).padStart(2, "0")}`;
}
function resetVideoUI() {
  watching = false;
  rewarded = false;
  watchedSeconds = 0;
  clearInterval(watchInterval);
  $("progressBar").style.width = "0%";
  $("videoTimer").textContent = fmtTime(RULES.videoLength);
  $("videoScreen").classList.remove("playing");
  $("videoOverlay").classList.remove("hidden");
  $("watchBtn").textContent = "Play video";
  $("watchBtn").disabled = false;
}

function startVideo() {
  if (watching) return;
  if (!ytReady || !ytPlayer || !currentVideo || !currentVideo.youtubeId) {
    toast("Video player is still loading, try again in a second.", "error");
    return;
  }
  watching = true;
  rewarded = false;
  watchedSeconds = 0;
  $("videoOverlay").classList.add("hidden");
  $("videoScreen").classList.add("playing");
  $("watchBtn").textContent = "Watching…";
  $("watchBtn").disabled = true;
  ytPlayer.loadVideoById(currentVideo.youtubeId);
}

// Count real playback seconds while the video is actually playing.
function onYtStateChange(e) {
  if (!watching) return;
  if (e.data === YT.PlayerState.PLAYING) {
    clearInterval(watchInterval);
    watchInterval = setInterval(tickWatch, 1000);
  } else if (e.data === YT.PlayerState.PAUSED || e.data === YT.PlayerState.BUFFERING) {
    clearInterval(watchInterval);
  } else if (e.data === YT.PlayerState.ENDED) {
    clearInterval(watchInterval);
    if (!rewarded) finishVideo();
  }
}

function tickWatch() {
  watchedSeconds++;
  const remaining = RULES.videoLength - watchedSeconds;
  $("videoTimer").textContent = fmtTime(Math.max(remaining, 0));
  $("progressBar").style.width = `${Math.min((watchedSeconds / RULES.videoLength) * 100, 100)}%`;
  if (watchedSeconds >= RULES.videoLength && !rewarded) {
    clearInterval(watchInterval);
    finishVideo();
  }
}

async function finishVideo() {
  rewarded = true;
  clearInterval(watchInterval);
  try {
    if (ytPlayer && ytPlayer.stopVideo) ytPlayer.stopVideo();
  } catch {}
  try {
    const data = await api("/api/video/complete", { method: "POST" });
    me = data.user;
    render();
    toast(`+${data.reward} KSh earned! 🎉`);
  } catch (err) {
    toast(err.message, "error");
  }
  pickVideo();
  resetVideoUI();
  $("watchBtn").textContent = "Watch another";
}
$("watchBtn").addEventListener("click", startVideo);

/* ============================================================
   WITHDRAW
   ============================================================ */
let currentMethod = "mpesa";
function setMethod(method) {
  currentMethod = method;
  $("mpesaTab").classList.toggle("active", method === "mpesa");
  $("paypalTab").classList.toggle("active", method === "paypal");
  $("mpesaFields").classList.toggle("hidden", method !== "mpesa");
  $("paypalFields").classList.toggle("hidden", method !== "paypal");
}
document.querySelectorAll(".method-btn").forEach((b) =>
  b.addEventListener("click", () => setMethod(b.dataset.method))
);
$("maxBtn").addEventListener("click", () => {
  $("withdrawAmount").value = me.balance;
});

$("withdrawForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const hint = $("withdrawHint");
  hint.style.color = "var(--danger)";
  const amount = Math.floor(Number($("withdrawAmount").value));
  const destination = currentMethod === "mpesa" ? $("mpesaPhone").value.trim() : $("paypalEmail").value.trim();

  if (!amount || amount < RULES.minWithdraw) {
    hint.textContent = `Minimum withdrawal is KSh ${RULES.minWithdraw}.`;
    return;
  }
  if (amount > me.balance) {
    hint.textContent = "Amount exceeds your balance.";
    return;
  }
  if (!destination) {
    hint.textContent = currentMethod === "mpesa" ? "Enter your M-Pesa number." : "Enter your PayPal email.";
    return;
  }

  $("withdrawSubmit").disabled = true;
  $("withdrawSubmit").textContent = "Processing…";
  try {
    const data = await api("/api/withdraw", {
      method: "POST",
      body: { method: currentMethod, destination, amount }
    });
    me = data.user;
    render();
    await loadHistory();
    hint.style.color = "var(--primary)";
    hint.textContent = `Withdrawal of KSh ${fmt(amount)} to your ${currentMethod === "mpesa" ? "M-Pesa" : "PayPal"} is ${data.withdrawal.status}.`;
    toast(`Withdrawal request sent: KSh ${fmt(amount)} 💸`);
    $("withdrawForm").reset();
  } catch (err) {
    hint.textContent = err.message;
    toast(err.message, "error");
  } finally {
    $("withdrawSubmit").disabled = false;
    $("withdrawSubmit").textContent = "Request withdrawal";
  }
});

/* ============================================================
   REFERRALS / OFFERWALL / ADS  (monetization)
   ============================================================ */
async function loadReferrals() {
  try {
    const r = await api("/api/referrals/me");
    $("referralLink").value = r.referralLink;
    $("refCount").textContent = r.referredCount;
  } catch {}
}

$("copyRefBtn").addEventListener("click", () => {
  const inp = $("referralLink");
  inp.select();
  try {
    navigator.clipboard.writeText(inp.value);
    toast("Referral link copied! 🔗");
  } catch {
    document.execCommand("copy");
    toast("Referral link copied! 🔗");
  }
});

async function loadOffers() {
  try {
    const data = await api("/api/offers", { authed: false });
    const grid = $("offerGrid");
    if (data.live) {
      // REAL offerwall: load the provider wall in an iframe (credits via postback)
      let url = "";
      try {
        const wall = await api("/api/offerwall/url");
        url = wall.url;
      } catch {}

      grid.innerHTML = `
        ${url ? `<iframe src="${url}" title="Offerwall" class="offerwall-iframe"></iframe>` : ""}
        <p class="hint">Complete any offer in the wall above. Your balance is credited automatically when the provider confirms.</p>
        <a class="btn btn-light" href="${url || "https://offers.cpx-research.com/index.php?app_id=34464"}" target="_blank" rel="noopener" style="margin-top:10px">🔗 Open CPX Offerwall in new tab</a>

        </div>`;
      return;
    }
    // DEMO mode: simulated offer cards
    const offers = data.offers || [];
    grid.innerHTML = offers
      .map(
        (o) => `<div class="offer-tile" data-id="${o.id}">
          <div class="ot-icon">${o.icon || "🎯"}</div>
          <div class="ot-body">
            <div class="ot-title">${esc(o.title)}</div>
            <div class="ot-desc">${esc(o.desc)}</div>
        </div>
          <button class="btn btn-primary ot-btn" data-id="${o.id}">+${o.reward} KSh</button>
        </div>`
      )
      .join("");
    grid.querySelectorAll(".ot-btn").forEach((btn) =>
      btn.addEventListener("click", async () => {
        btn.disabled = true;
        btn.textContent = "…";
        try {
          const d = await api("/api/offer/complete", { method: "POST", body: { offerId: Number(btn.dataset.id) } });
          me = d.user;
          render();
          toast(`+${d.reward} KSh from offer! 🎯`);
          btn.textContent = "Done ✓";
        } catch (err) {
          toast(err.message, "error");
          btn.disabled = false;
          btn.textContent = "Retry";
        }
      })
    );
  } catch {}
}

// Inject a REAL Google AdSense ad unit when a publisher id is configured.
function initAds() {
  const pid = RULES.ads && RULES.ads.publisherId;
  if (!pid) return; // demo mode: simulated ad reward
  if (window.__pesaplugAds) return;
  window.__pesaplugAds = true;
  const s = document.createElement("script");
  s.async = true;
  s.crossOrigin = "anonymous";
  s.src = "https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js";
  s.setAttribute("data-ad-client", pid); // e.g. ca-pub-XXXX
  document.head.appendChild(s);

  // Banner slot on the Offers screen
  const slot = document.getElementById("adBannerSlot");
  if (slot && !slot.dataset.loaded) {
    slot.dataset.loaded = "1";
    slot.innerHTML = `<ins class="adsbygoogle" style="display:block" data-ad-client="${pid}" data-ad-slot="auto" data-ad-format="auto"></ins>`;
    try { (window.adsbygoogle = window.adsbygoogle || []).push({}); } catch {}
  }
}

$("watchAdBtn").addEventListener("click", async () => {
  const btn = $("watchAdBtn");
  btn.disabled = true;
  try {
    const data = await api("/api/ad/complete", { method: "POST" });
    me = data.user;
    render();
    toast(`+${data.reward} KSh from ad! 📺`);
  } catch (err) {
    toast(err.message, "error");
  } finally {
    btn.disabled = false;
  }
});

function esc(s) {
  return String(s == null ? "" : s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
}

/* ============================================================
   INIT
   ============================================================ */
setMethod("mpesa");
setAuthMode("login");
pickVideo();

(async function boot() {
  if (getToken()) {
    try {
      const { user } = await api("/api/auth/me");
      me = user;
      await enterApp();
      return;
    } catch {
      clearToken();
    }
  }
  $("authWrap").classList.remove("hidden");
})();
