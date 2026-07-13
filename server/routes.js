"use strict";

const express = require("express");
const store = require("./store");
const config = require("./config");
const mpesa = require("./mpesa");
const { auth, publicUser } = require("./auth");

const router = express.Router();

function todayKey() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(
    d.getDate()
  ).padStart(2, "0")}`;
}
function daysBetween(aKey, bKey) {
  const a = new Date(aKey + "T00:00:00");
  const b = new Date(bKey + "T00:00:00");
  return Math.round((b - a) / 86400000);
}

// Expose earning rules to the client
router.get("/config", (req, res) => {
  res.json({
    rewardPerVideo: config.rewardPerVideo,
    streakReward: config.streakReward,
    videoLength: config.videoLength,
    minWithdraw: config.minWithdraw,
    mpesaConfigured: config.mpesa.configured
  });
});

// Public: current video watch list (managed by admin)
router.get("/videos", (req, res) => {
  res.json({ videos: store.videos.list() });
});

// POST /api/video/complete  -> reward for finishing a 30s video
router.post("/video/complete", auth, (req, res) => {
  const reward = config.rewardPerVideo;
  const user = store.users.findById(req.user.id);
  user.balance += reward;
  user.total_earned += reward;
  user.videos_watched += 1;
  store.users.update(user);
  store.videoLogs.create({ userId: user.id, reward });
  res.json({ reward, user: publicUser(user) });
});

// POST /api/streak/claim  -> once per day, +streakReward
router.post("/streak/claim", auth, (req, res) => {
  const today = todayKey();
  const user = store.users.findById(req.user.id);

  if (user.last_claim === today) {
    return res.status(400).json({ error: "Daily bonus already claimed today." });
  }

  let streak = 1;
  if (user.last_claim && daysBetween(user.last_claim, today) === 1) {
    streak = user.streak_days + 1;
  }
  const reward = config.streakReward;
  user.balance += reward;
  user.total_earned += reward;
  user.streak_days = streak;
  user.last_claim = today;
  store.users.update(user);

  res.json({ reward, streakDays: streak, user: publicUser(user) });
});

// GET /api/withdrawals -> history for the logged-in user
router.get("/withdrawals", auth, (req, res) => {
  const rows = store.withdrawals.listByUser(req.user.id).map((w) => ({
    id: w.id,
    method: w.method,
    destination: w.destination,
    amount: w.amount,
    status: w.status,
    result_desc: w.result_desc,
    created_at: w.created_at
  }));
  res.json({ withdrawals: rows });
});

// POST /api/withdraw -> request a withdrawal (M-Pesa live, PayPal queued)
router.post("/withdraw", auth, async (req, res) => {
  const method = (req.body.method || "").toLowerCase();
  const destination = (req.body.destination || "").trim();
  const amount = Math.floor(Number(req.body.amount));

  if (!["mpesa", "paypal"].includes(method)) {
    return res.status(400).json({ error: "Choose M-Pesa or PayPal." });
  }
  if (!amount || amount <= 0) {
    return res.status(400).json({ error: "Enter a valid amount." });
  }
  if (amount < config.minWithdraw) {
    return res.status(400).json({ error: `Minimum withdrawal is KSh ${config.minWithdraw}.` });
  }

  const user = store.users.findById(req.user.id);
  if (amount > user.balance) {
    return res.status(400).json({ error: "Amount exceeds your balance." });
  }

  if (method === "mpesa") {
    if (!/^(?:254|0)?[17]\d{8}$/.test(destination.replace(/\D/g, ""))) {
      return res.status(400).json({ error: "Enter a valid M-Pesa phone number." });
    }
  } else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(destination)) {
    return res.status(400).json({ error: "Enter a valid PayPal email." });
  }

  // Reserve funds first, then attempt payout.
  user.balance -= amount;
  store.users.update(user);
  const withdrawal = store.withdrawals.create({
    userId: user.id,
    method,
    destination,
    amount,
    status: "pending"
  });

  if (method === "mpesa") {
    if (!config.mpesa.configured) {
      user.balance += amount; // refund
      store.users.update(user);
      withdrawal.status = "failed";
      withdrawal.result_desc = "M-Pesa not configured on server";
      store.withdrawals.update(withdrawal);
      return res.status(503).json({
        error: "M-Pesa payouts are not configured yet. Add MPESA_* values to the server .env."
      });
    }
    try {
      const result = await mpesa.sendB2C({ phone: destination, amount });
      withdrawal.status = "processing";
      withdrawal.provider_ref =
        result.ConversationID || result.OriginatorConversationID || "";
      store.withdrawals.update(withdrawal);
    } catch (err) {
      user.balance += amount; // refund on failure
      store.users.update(user);
      withdrawal.status = "failed";
      withdrawal.result_desc = String(err.message).slice(0, 250);
      store.withdrawals.update(withdrawal);
      return res.status(502).json({ error: err.message });
    }
  } else {
    // PayPal: queued for manual/admin processing (Payouts API can be added later)
    withdrawal.status = "processing";
    store.withdrawals.update(withdrawal);
  }

  res.json({
    ok: true,
    withdrawal: {
      id: withdrawal.id,
      method: withdrawal.method,
      destination: withdrawal.destination,
      amount: withdrawal.amount,
      status: withdrawal.status
    },
    user: publicUser(user)
  });
});

// --- M-Pesa callbacks (Safaricom -> our server) ---

// POST /api/mpesa/result
router.post("/mpesa/result", express.json(), (req, res) => {
  try {
    const r = req.body && req.body.Result;
    if (r) {
      const convId = r.ConversationID || r.OriginatorConversationID;
      const success = Number(r.ResultCode) === 0;
      const row = store.withdrawals.findByProviderRef(convId);
      if (row) {
        const wasCompleted = row.status === "completed";
        row.status = success ? "completed" : "failed";
        row.result_desc = String(r.ResultDesc || "").slice(0, 250);
        store.withdrawals.update(row);
        if (!success && !wasCompleted) {
          const u = store.users.findById(row.user_id);
          if (u) {
            u.balance += row.amount;
            store.users.update(u);
          }
        }
      }
    }
  } catch (e) {
    /* always 200 to Safaricom */
  }
  res.json({ ResultCode: 0, ResultDesc: "Accepted" });
});

// POST /api/mpesa/timeout
router.post("/mpesa/timeout", express.json(), (req, res) => {
  res.json({ ResultCode: 0, ResultDesc: "Accepted" });
});

module.exports = router;
