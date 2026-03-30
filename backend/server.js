'use strict';

require('dotenv').config();

// ── Validación de variables críticas al startup ───────────
const REQUIRED_ENV = ['WHATSAPP_APP_SECRET', 'SUPABASE_URL', 'SUPABASE_ANON_KEY', 'ANTHROPIC_API_KEY', 'PHONE_NUMBER_ID', 'WHATSAPP_TOKEN'];
const missing = REQUIRED_ENV.filter(k => !process.env[k]);
if (missing.length) {
  console.error(`❌ Variables de entorno faltantes: ${missing.join(', ')} — el servidor no puede arrancar.`);
  process.exit(1);
}

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
app.get('/health', (req, res) => res.json({ status: 'ok', uptime: Math.floor(process.uptime()), ts: new Date().toISOString() }));

// ── Scheduler ──────────────────────────────────────────────
// Desactivado hasta tener número de WhatsApp Business verificado
// if (process.env.NODE_ENV !== 'test') {
//   scheduleDaily();
// }

// ── Servidor ───────────────────────────────────────────────
if (process.env.NODE_ENV !== 'test') {
  const PORT = process.env.PORT || 3000;
  app.listen(PORT, () => console.log(`🚀 Orbe v5.0 en puerto ${PORT}`));
}

module.exports = app;
