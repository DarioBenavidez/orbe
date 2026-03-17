'use strict';

require('dotenv').config();

const express = require('express');
const helmet  = require('helmet');
const rateLimit = require('express-rate-limit');

const apiRouter     = require('./routes/api');
const webhookRouter = require('./routes/webhook');
const { scheduleDaily } = require('./scheduler/index');

const app = express();
app.set('trust proxy', 1); // Railway / reverse proxies

// ── Seguridad: headers HTTP ────────────────────────────────
app.use(helmet());

// ── Seguridad: body size limit + guardar raw body para firma Meta ─
app.use(express.json({
  limit: '2mb',
  verify: (req, _res, buf) => { req.rawBody = buf; },
}));

// ── Seguridad: rate limit global (por IP) ─────────────────
app.use(rateLimit({
  windowMs: 60 * 1000,
  max: 120,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Demasiadas solicitudes. Intentá más tarde.' },
}));

// ── Rutas ──────────────────────────────────────────────────
app.use('/api', apiRouter);
app.use('/webhook', webhookRouter);
app.get('/', (req, res) => res.json({ status: 'ok' }));

// ── Scheduler ──────────────────────────────────────────────
if (process.env.NODE_ENV !== 'test') {
  scheduleDaily();
}

// ── Servidor ───────────────────────────────────────────────
if (process.env.NODE_ENV !== 'test') {
  const PORT = process.env.PORT || 3000;
  app.listen(PORT, () => console.log(`🚀 Orbe v5.0 en puerto ${PORT}`));
}

module.exports = app;
