"use strict";

/**
 * Tiny pure-JS JSON-file data store (no native modules required).
 * Persists everything to pesaplug.db.json. Suitable for a starter/MVP;
 * swap for Postgres/MySQL when you scale.
 */

const fs = require("fs");
const path = require("path");

const FILE = path.join(__dirname, "..", "pesaplug.db.json");

const defaultVideos = [
  { emoji: "🎵", title: "Wiz Khalifa - See You Again ft. Charlie Puth", youtubeId: "RgKAFK5djSk" },
  { emoji: "🎶", title: "Luis Fonsi - Despacito ft. Daddy Yankee", youtubeId: "kJQP7kiw5Fk" },
  { emoji: "🕺", title: "PSY - Gangnam Style", youtubeId: "9bZkp7q19f0" },
  { emoji: "🎤", title: "Mark Ronson - Uptown Funk ft. Bruno Mars", youtubeId: "OPf0YbXqDm0" },
  { emoji: "🎸", title: "Ed Sheeran - Shape of You", youtubeId: "JGwWNGJdvx8" },
  { emoji: "🔥", title: "Katy Perry - Roar", youtubeId: "CevxZvSJLk8" },
  { emoji: "🌟", title: "Maroon 5 - Sugar", youtubeId: "09R8_2nJtjg" },
  { emoji: "💃", title: "Taylor Swift - Shake It Off", youtubeId: "nfWlot6h_JM" }
];

const defaultData = {
  seq: { users: 0, withdrawals: 0, videoLogs: 0, videos: 0 },
  users: [],
  withdrawals: [],
  videoLogs: [],
  videos: []
};

let data;

function load() {
  try {
    if (fs.existsSync(FILE)) {
      const parsed = JSON.parse(fs.readFileSync(FILE, "utf8"));
      data = { ...defaultData, ...parsed };
      // deep-merge the sequence counters so new collections get a counter
      data.seq = { ...defaultData.seq, ...(parsed.seq || {}) };
    } else {
      data = JSON.parse(JSON.stringify(defaultData));
    }
  } catch {
    data = JSON.parse(JSON.stringify(defaultData));
  }
}

let saveTimer = null;
function save() {
  // debounce writes slightly to batch rapid updates
  if (saveTimer) return;
  saveTimer = setTimeout(() => {
    saveTimer = null;
    fs.writeFileSync(FILE, JSON.stringify(data, null, 2));
  }, 30);
}
function saveNow() {
  if (saveTimer) {
    clearTimeout(saveTimer);
    saveTimer = null;
  }
  fs.writeFileSync(FILE, JSON.stringify(data, null, 2));
}

function nowIso() {
  return new Date().toISOString().replace("T", " ").slice(0, 19);
}

load();

// Seed the video list on first run
if (!data.videos || data.videos.length === 0) {
  data.videos = defaultVideos.map((v) => ({ id: ++data.seq.videos, ...v }));
  saveNow();
}

/* ---------- Users ---------- */
const users = {
  findByEmail(email) {
    return data.users.find((u) => u.email === email) || null;
  },
  findById(id) {
    return data.users.find((u) => u.id === id) || null;
  },
  create({ name, email, passwordHash }) {
    const user = {
      id: ++data.seq.users,
      name,
      email,
      password_hash: passwordHash,
      balance: 0,
      total_earned: 0,
      videos_watched: 0,
      streak_days: 0,
      last_claim: null,
      created_at: nowIso()
    };
    data.users.push(user);
    saveNow();
    return user;
  },
  update(user) {
    const idx = data.users.findIndex((u) => u.id === user.id);
    if (idx !== -1) data.users[idx] = user;
    saveNow();
    return user;
  }
};

/* ---------- Withdrawals ---------- */
const withdrawals = {
  create({ userId, method, destination, amount, status = "pending" }) {
    const w = {
      id: ++data.seq.withdrawals,
      user_id: userId,
      method,
      destination,
      amount,
      status,
      provider_ref: null,
      result_desc: null,
      created_at: nowIso(),
      updated_at: nowIso()
    };
    data.withdrawals.push(w);
    saveNow();
    return w;
  },
  findById(id) {
    return data.withdrawals.find((w) => w.id === id) || null;
  },
  findByProviderRef(ref) {
    return data.withdrawals.find((w) => w.provider_ref === ref) || null;
  },
  listByUser(userId) {
    return data.withdrawals
      .filter((w) => w.user_id === userId)
      .sort((a, b) => b.id - a.id);
  },
  update(w) {
    const idx = data.withdrawals.findIndex((x) => x.id === w.id);
    if (idx !== -1) {
      w.updated_at = nowIso();
      data.withdrawals[idx] = w;
    }
    saveNow();
    return w;
  }
};

/* ---------- Video logs ---------- */
const videoLogs = {
  create({ userId, reward }) {
    const log = {
      id: ++data.seq.videoLogs,
      user_id: userId,
      reward,
      watched_at: nowIso()
    };
    data.videoLogs.push(log);
    save();
    return log;
  }
};

/* ---------- Videos (watch list) ---------- */
const videos = {
  list() {
    return data.videos.slice();
  },
  create({ emoji, title, youtubeId }) {
    const v = { id: ++data.seq.videos, emoji: emoji || "🎬", title, youtubeId: youtubeId || "" };
    data.videos.push(v);
    saveNow();
    return v;
  },
  remove(id) {
    const before = data.videos.length;
    data.videos = data.videos.filter((v) => v.id !== id);
    saveNow();
    return data.videos.length < before;
  }
};

/* ---------- Aggregates for admin ---------- */
const admin = {
  allUsers() {
    return data.users.map((u) => ({
      id: u.id,
      name: u.name,
      email: u.email,
      balance: u.balance,
      total_earned: u.total_earned,
      videos_watched: u.videos_watched,
      streak_days: u.streak_days,
      last_claim: u.last_claim,
      created_at: u.created_at
    }));
  },
  allWithdrawals() {
    return data.withdrawals
      .slice()
      .sort((a, b) => b.id - a.id)
      .map((w) => {
        const u = data.users.find((x) => x.id === w.user_id);
        return { ...w, user_name: u ? u.name : "?", user_email: u ? u.email : "?" };
      });
  },
  stats() {
    const paid = data.withdrawals
      .filter((w) => w.status === "completed" || w.status === "paid")
      .reduce((s, w) => s + w.amount, 0);
    const pending = data.withdrawals.filter((w) =>
      ["pending", "processing"].includes(w.status)
    );
    return {
      users: data.users.length,
      videosWatched: data.videoLogs.length,
      totalPaid: paid,
      pendingCount: pending.length,
      pendingAmount: pending.reduce((s, w) => s + w.amount, 0),
      balanceOutstanding: data.users.reduce((s, u) => s + u.balance, 0)
    };
  }
};

module.exports = { users, withdrawals, videoLogs, videos, admin, saveNow };
