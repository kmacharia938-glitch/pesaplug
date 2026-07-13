"use strict";

const express = require("express");
const jwt = require("jsonwebtoken");
const store = require("./store");
const config = require("./config");

const router = express.Router();

// Accepts a full YouTube URL or a bare 11-char video ID and returns the ID.
function extractYouTubeId(input) {
  const s = String(input || "").trim();
  if (!s) return "";
  if (/^[a-zA-Z0-9_-]{11}$/.test(s)) return s;
  const m = s.match(
    /(?:youtube\.com\/(?:watch\?v=|embed\/|shorts\/|live\/)|youtu\.be\/)([a-zA-Z0-9_-]{11})/
  );
  return m ? m[1] : "";
}

function signAdminToken() {
  return jwt.sign({ role: "admin", user: config.admin.user }, config.jwtSecret, {
    expiresIn: "12h"
  });
}

// Admin-only middleware
function adminAuth(req, res, next) {
  const header = req.headers.authorization || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : null;
  if (!token) return res.status(401).json({ error: "Admin not authenticated" });
  try {
    const payload = jwt.verify(token, config.jwtSecret);
    if (payload.role !== "admin") return res.status(403).json({ error: "Not an admin" });
    req.admin = payload;
    next();
  } catch {
    return res.status(401).json({ error: "Invalid or expired admin session" });
  }
}

// POST /api/admin/login
router.post("/login", (req, res) => {
  const user = (req.body.user || "").trim();
  const pass = req.body.pass || "";
  if (user === config.admin.user && pass === config.admin.pass) {
    return res.json({ token: signAdminToken(), user });
  }
  return res.status(401).json({ error: "Invalid admin username or password." });
});

// GET /api/admin/stats
router.get("/stats", adminAuth, (req, res) => {
  res.json({ stats: store.admin.stats(), mpesaConfigured: config.mpesa.configured });
});

// GET /api/admin/users
router.get("/users", adminAuth, (req, res) => {
  res.json({ users: store.admin.allUsers() });
});

// GET /api/admin/withdrawals
router.get("/withdrawals", adminAuth, (req, res) => {
  res.json({ withdrawals: store.admin.allWithdrawals() });
});

// POST /api/admin/withdrawals/:id/action  body: { action: 'paid' | 'reject' }
router.post("/withdrawals/:id/action", adminAuth, (req, res) => {
  const id = Number(req.params.id);
  const action = (req.body.action || "").toLowerCase();
  const w = store.withdrawals.findById(id);
  if (!w) return res.status(404).json({ error: "Withdrawal not found." });

  if (action === "paid") {
    w.status = "paid";
    w.result_desc = "Marked paid by admin";
    store.withdrawals.update(w);
  } else if (action === "reject") {
    // refund the user if not already completed/paid
    if (!["completed", "paid"].includes(w.status)) {
      const u = store.users.findById(w.user_id);
      if (u) {
        u.balance += w.amount;
        store.users.update(u);
      }
    }
    w.status = "rejected";
    w.result_desc = "Rejected & refunded by admin";
    store.withdrawals.update(w);
  } else {
    return res.status(400).json({ error: "Unknown action." });
  }
  res.json({ ok: true, withdrawal: w });
});

// --- Videos management ---
router.get("/videos", adminAuth, (req, res) => {
  res.json({ videos: store.videos.list() });
});

router.post("/videos", adminAuth, (req, res) => {
  const title = (req.body.title || "").trim();
  const emoji = (req.body.emoji || "🎬").trim();
  const youtubeId = extractYouTubeId(req.body.youtubeId || req.body.url || "");
  if (!title) return res.status(400).json({ error: "Video title is required." });
  if (!youtubeId) return res.status(400).json({ error: "A valid YouTube link or video ID is required." });
  const v = store.videos.create({ emoji, title, youtubeId });
  res.json({ ok: true, video: v });
});

router.delete("/videos/:id", adminAuth, (req, res) => {
  const id = Number(req.params.id);
  const removed = store.videos.remove(id);
  if (!removed) return res.status(404).json({ error: "Video not found." });
  res.json({ ok: true });
});

module.exports = { router, adminAuth };
