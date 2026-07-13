"use strict";

const path = require("path");
const express = require("express");
const cors = require("cors");
const config = require("./config");
const auth = require("./auth");
const apiRoutes = require("./routes");
const admin = require("./admin");

const app = express();

app.use(cors());
app.use(express.json());

// API
app.use("/api/auth", auth.router);
app.use("/api/admin", admin.router);
app.use("/api", apiRoutes);

app.get("/api/health", (req, res) => {
  res.json({ ok: true, mpesaConfigured: config.mpesa.configured, env: config.mpesa.env });
});

// Static frontend
app.use(express.static(path.join(__dirname, "..", "public")));

// Admin panel page
app.get("/admin", (req, res) => {
  res.sendFile(path.join(__dirname, "..", "public", "admin.html"));
});

// SPA-ish fallback for the root
app.get("*", (req, res) => {
  res.sendFile(path.join(__dirname, "..", "public", "index.html"));
});

app.listen(config.port, () => {
  console.log(`\n  Pesaplug running at ${config.baseUrl}`);
  console.log(`  Local:   http://localhost:${config.port}`);
  console.log(`  Admin:   http://localhost:${config.port}/admin`);
  console.log(`  M-Pesa:  ${config.mpesa.configured ? "configured (" + config.mpesa.env + ")" : "NOT configured — fill .env"}`);
  console.log("");
});
