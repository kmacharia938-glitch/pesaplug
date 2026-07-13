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
    mpesaConfigured: config.mpesa.configured,
    referral: {
      signupBonus: config.referral.signupBonus,
      referrerBonus: config.referral.referrerBonus
    },
    offerwall: { enabled: config.offerwall.enabled, provider: config.offerwall.provider || "demo", live: Boolean(config.offerwall.publisherId) },
    adReward: config.ads.reward,
    adsPublisherId: config.ads.publisherId ? "set" : ""
  });
});

// Public: current video watch list (managed by admin)
router.get("/videos", (req, res) => {
  res.json({ videos: store.videos.list() });
});

// Public: offerwall list (live mode signals the client to load the real wall)
router.get("/offers", (req, res) => {
  const live = Boolean(config.offerwall.publisherId);
  res.json({
    live,
    provider: live ? config.offerwall.provider : "demo",
    offers: store.offers.list().map((o) => ({ id: o.id, title: o.title, desc: o.desc, reward: o.reward, icon: o.icon }))
  });
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

  // Credit the referrer once, when their referred user watches the first video
  if (config.referral.referrerOnFirstVideo && user.referred_by && !user.referral_credited) {
    const referrer = store.users.findById(user.referred_by);
    if (referrer) {
      referrer.balance += config.referral.referrerBonus;
      referrer.total_earned += config.referral.referrerBonus;
      store.users.update(referrer);
    }
    user.referral_credited = (user.referral_credited || 0) + 1;
    store.users.update(user);
  }

  res.json({ reward, user: publicUser(user) });
});

// GET /api/referrals/me  -> referral code, link and counts
router.get("/referrals/me", auth, (req, res) => {
  const user = store.users.findById(req.user.id);
  const referredCount = store.admin.allUsers().filter((u) => u.referred_by === user.id).length;
  res.json({
    referralCode: user.referral_code,
    referralLink: `${config.baseUrl}/?ref=${user.referral_code}`,
    referrerBonus: config.referral.referrerBonus,
    signupBonus: config.referral.signupBonus,
    referredCount
  });
});

// POST /api/offer/complete  -> DEMO offerwall only (live completions come via postback)
router.post("/offer/complete", auth, (req, res) => {
  if (config.offerwall.publisherId) {
    return res.status(400).json({ error: "Offers complete via the live offerwall; use the wall." });
  }
  if (!config.offerwall.enabled) {
    return res.status(503).json({ error: "Offerwall is disabled." });
  }
  const offerId = Number(req.body.offerId);
  const offer = store.offers.findById(offerId);
  if (!offer) return res.status(404).json({ error: "Offer not found." });

  const user = store.users.findById(req.user.id);
  if ((user.offers_completed || []).includes(offerId)) {
    return res.status(400).json({ error: "You already completed this offer." });
  }
  user.offers_completed = user.offers_completed || [];
  user.offers_completed.push(offerId);
  user.balance += offer.reward;
  user.total_earned += offer.reward;
  store.users.update(user);
  store.adLogs.record({ userId: user.id, ownerRevenue: config.offerwall.ownerRevenuePerOffer });

  res.json({ reward: offer.reward, user: publicUser(user) });
});

// GET /api/offerwall/url  -> signed live offerwall embed for the current user
router.get("/offerwall/url", auth, (req, res) => {
  if (!config.offerwall.publisherId) {
    return res.status(400).json({ error: "Live offerwall not configured." });
  }
  const user = store.users.findById(req.user.id);

  // Standard CPX secure hash: MD5(ext_user_id + username + email + secret_key)
  const signInput = `${user.id}${user.name}${user.email}${config.offerwall.secretKey}`;
  const secureHash = require("crypto").createHash("md5").update(signInput).digest("hex");

  const wall = `https://offers.cpx-research.com/index.php?app_id=${config.offerwall.publisherId}&ext_user_id=${user.id}&secure_hash=${secureHash}&username=${encodeURIComponent(user.name)}&email=${encodeURIComponent(user.email)}&subid_1=&subid_2=`;

  res.json({ url: wall, provider: config.offerwall.provider });
});

// POST /api/offerwall/postback  -> provider credits the user for a real completion
router.post("/offerwall/postback", express.json(), (req, res) => {
  const userId = Number(req.query.user_id || req.body.user_id);
  const sig = req.query.sig || req.body.sig;
  if (!userId || !sig) return res.status(400).send("bad request");

  const expected = require("crypto")
    .createHmac("sha256", config.offerwall.postbackSecret)
    .update(String(userId))
    .digest("hex")
    .slice(0, 16);
  if (sig !== expected) return res.status(403).send("invalid signature");

  const amount = config.offerwall.reward;
  store.users.creditById(userId, amount, true);
  store.adLogs.record({ userId, ownerRevenue: config.offerwall.ownerRevenuePerOffer });

  res.json({ ok: true, credited: amount });
});

// POST /api/ad/complete  -> rewarded ad: user gets a cut, owner logs revenue
router.post("/ad/complete", auth, (req, res) => {
  const user = store.users.findById(req.user.id);
  user.balance += config.ads.reward;
  user.total_earned += config.ads.reward;
  store.users.update(user);
  store.adLogs.record({ userId: user.id, ownerRevenue: config.ads.ownerRevenuePerView });
  res.json({ reward: config.ads.reward, user: publicUser(user) });
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
