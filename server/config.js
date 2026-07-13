"use strict";

require("dotenv").config();

function num(val, fallback) {
  const n = Number(val);
  return Number.isFinite(n) ? n : fallback;
}

const config = {
  port: num(process.env.PORT, 3000),
  baseUrl: (process.env.BASE_URL || "http://localhost:3000").replace(/\/$/, ""),
  jwtSecret: process.env.JWT_SECRET || "insecure-dev-secret-change-me",

  rewardPerVideo: num(process.env.REWARD_PER_VIDEO, 20),
  streakReward: num(process.env.STREAK_REWARD, 10),
  videoLength: num(process.env.VIDEO_LENGTH_SECONDS, 30),
  minWithdraw: num(process.env.MIN_WITHDRAW, 240),

  // --- Monetization (how the OWNER earns; users get a cut) ---
  referral: {
    signupBonus: num(process.env.REFERRAL_SIGNUP_BONUS, 20), // referee gets on join
    referrerBonus: num(process.env.REFERRAL_REFERRER_BONUS, 50), // referrer gets when referee active
    referrerOnFirstVideo: Boolean(process.env.REFERRAL_ON_FIRST_VIDEO !== "false")
  },
  offerwall: {
    enabled: process.env.OFFERWALL_ENABLED !== "false",
    // Real provider (CPX Research / BitLabs / Adscend). Leave blank = demo mode.
    provider: process.env.OFFERWALL_PROVIDER || "",
    publisherId: process.env.OFFERWALL_PUBLISHER_ID || "",
    // Owner's simulated earnings per completed offer (KSh), for admin stats
    ownerRevenuePerOffer: num(process.env.OFFERWALL_OWNER_REVENUE, 8)
  },
  ads: {
    reward: num(process.env.AD_REWARD, 5), // user cut per rewarded ad
    // Owner's simulated earnings per ad impression (KSh)
    ownerRevenuePerView: num(process.env.AD_OWNER_REVENUE, 3),
    // Real ad SDK publisher id (Google AdSense/AdMob). Blank = demo mode.
    publisherId: process.env.ADS_PUBLISHER_ID || ""
  },

  admin: {
    user: process.env.ADMIN_USER || "admin",
    pass: process.env.ADMIN_PASS || "admin123"
  },

  mpesa: {
    env: (process.env.MPESA_ENV || "sandbox").toLowerCase(),
    consumerKey: process.env.MPESA_CONSUMER_KEY || "",
    consumerSecret: process.env.MPESA_CONSUMER_SECRET || "",
    shortcode: process.env.MPESA_SHORTCODE || "",
    initiatorName: process.env.MPESA_INITIATOR_NAME || "",
    initiatorPassword: process.env.MPESA_INITIATOR_PASSWORD || "",
    certPath: process.env.MPESA_CERT_PATH || "",
    securityCredential: process.env.MPESA_SECURITY_CREDENTIAL || "",
    commandId: process.env.MPESA_COMMAND_ID || "BusinessPayment"
  }
};

config.mpesa.baseApi =
  config.mpesa.env === "production"
    ? "https://api.safaricom.co.ke"
    : "https://sandbox.safaricom.co.ke";

config.mpesa.configured = Boolean(
  config.mpesa.consumerKey &&
    config.mpesa.consumerSecret &&
    config.mpesa.shortcode &&
    config.mpesa.initiatorName &&
    (config.mpesa.securityCredential ||
      (config.mpesa.initiatorPassword && config.mpesa.certPath))
);

module.exports = config;
