"use strict";

/**
 * Verify your M-Pesa (Daraja) configuration WITHOUT pasting secrets in chat.
 *
 *   node server/check-mpesa.js
 *
 * It loads your .env, confirms the required values are present, and tries to
 * fetch a real OAuth token from Daraja. If the token comes back, your
 * Consumer Key/Secret are correct and M-Pesa payouts can authenticate.
 *
 * It does NOT print your secret values.
 */

require("dotenv").config();
const mpesa = require("./mpesa");
const config = require("./config");

function present(v) {
  return v && String(v).trim().length > 0;
}

console.log("M-Pesa environment check\n");

const checks = [
  ["Consumer Key", present(process.env.MPESA_CONSUMER_KEY)],
  ["Consumer Secret", present(process.env.MPESA_CONSUMER_SECRET)],
  ["Shortcode", present(process.env.MPESA_SHORTCODE)],
  ["Initiator Name", present(process.env.MPESA_INITIATOR_NAME)],
  [
    "Security Credential OR (Initiator Password + Cert)",
    present(process.env.MPESA_SECURITY_CREDENTIAL) ||
      (present(process.env.MPESA_INITIATOR_PASSWORD) && present(process.env.MPESA_CERT_PATH))
  ],
  ["BASE_URL is public (not localhost)", !/localhost|127\.0\.0\.1/.test(config.baseUrl)]
];

let allOk = true;
for (const [label, ok] of checks) {
  console.log(`  ${ok ? "✅" : "❌"}  ${label}`);
  if (!ok) allOk = false;
}

if (!allOk) {
  console.log("\nMissing required M-Pesa settings. Fill them in your .env, then re-run.");
  process.exit(1);
}

console.log(`\nTrying to authenticate with Daraja (${config.mpesa.env})...`);
mpesa
  .getAccessToken()
  .then((token) => {
    console.log(`  ✅  Token received (${token.slice(0, 12)}…). M-Pesa is wired and can authenticate.`);
    console.log("  → Start the server; withdrawals via M-Pesa will now trigger real B2C payouts.");
  })
  .catch((err) => {
    console.log(`  ❌  Auth failed: ${err.message}`);
    console.log("  → Check your Consumer Key/Secret and that the app has the B2C product enabled.");
    process.exit(2);
  });
