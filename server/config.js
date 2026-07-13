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
