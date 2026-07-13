"use strict";

const fs = require("fs");
const crypto = require("crypto");
const config = require("./config");

const M = config.mpesa;

/**
 * Get an OAuth access token from Daraja using consumer key/secret.
 */
async function getAccessToken() {
  const auth = Buffer.from(`${M.consumerKey}:${M.consumerSecret}`).toString("base64");
  const url = `${M.baseApi}/oauth/v1/generate?grant_type=client_credentials`;
  const res = await fetch(url, { headers: { Authorization: `Basic ${auth}` } });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`M-Pesa auth failed (${res.status}): ${body}`);
  }
  const data = await res.json();
  if (!data.access_token) throw new Error("M-Pesa auth: no access_token returned");
  return data.access_token;
}

/**
 * Build the SecurityCredential. Either use the pre-generated one from env,
 * or RSA-encrypt the initiator password with Safaricom's public certificate.
 */
function buildSecurityCredential() {
  if (M.securityCredential) return M.securityCredential;

  if (!M.initiatorPassword || !M.certPath) {
    throw new Error(
      "M-Pesa not configured: set MPESA_SECURITY_CREDENTIAL, or MPESA_INITIATOR_PASSWORD + MPESA_CERT_PATH."
    );
  }
  if (!fs.existsSync(M.certPath)) {
    throw new Error(`M-Pesa certificate not found at MPESA_CERT_PATH: ${M.certPath}`);
  }

  const cert = fs.readFileSync(M.certPath, "utf8");
  const encrypted = crypto.publicEncrypt(
    { key: cert, padding: crypto.constants.RSA_PKCS1_PADDING },
    Buffer.from(M.initiatorPassword)
  );
  return encrypted.toString("base64");
}

/**
 * Normalise a Kenyan phone number to the 2547XXXXXXXX / 2541XXXXXXXX format.
 */
function normalizePhone(phone) {
  let p = String(phone).replace(/\D/g, "");
  if (p.startsWith("0")) p = "254" + p.slice(1);
  else if (p.startsWith("7") || p.startsWith("1")) p = "254" + p;
  else if (p.startsWith("254")) {
    /* already ok */
  }
  return p;
}

/**
 * Send a B2C payment (payout) to a customer's phone.
 * @returns {Promise<{ConversationID, OriginatorConversationID, ResponseDescription}>}
 */
async function sendB2C({ phone, amount, remarks = "Pesaplug withdrawal", occasion = "Withdrawal" }) {
  if (!M.configured) {
    throw new Error("M-Pesa is not configured. Fill in the MPESA_* values in your .env file.");
  }

  const token = await getAccessToken();
  const securityCredential = buildSecurityCredential();
  const partyB = normalizePhone(phone);

  const payload = {
    OriginatorConversationID: `pesaplug-${Date.now()}-${Math.floor(Math.random() * 1e6)}`,
    InitiatorName: M.initiatorName,
    SecurityCredential: securityCredential,
    CommandID: M.commandId,
    Amount: Math.floor(amount),
    PartyA: M.shortcode,
    PartyB: partyB,
    Remarks: remarks.slice(0, 100),
    QueueTimeOutURL: `${config.baseUrl}/api/mpesa/timeout`,
    ResultURL: `${config.baseUrl}/api/mpesa/result`,
    Occasion: occasion.slice(0, 100)
  };

  const url = `${M.baseApi}/mpesa/b2c/v3/paymentrequest`;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify(payload)
  });

  const data = await res.json().catch(() => ({}));
  if (!res.ok || data.errorCode) {
    throw new Error(
      `M-Pesa B2C request failed: ${data.errorMessage || data.ResponseDescription || res.status}`
    );
  }
  return data;
}

module.exports = { getAccessToken, sendB2C, normalizePhone, buildSecurityCredential };
