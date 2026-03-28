'use strict';

const express = require('express');
const rateLimit = require('express-rate-limit');
const router = express.Router();

const { supabase, linkPhoneToUser } = require('../lib/supabase');
const { generateLinkingCode, generatePhoneOTP, getPhoneOTP, deletePhoneOTP } = require('../lib/auth');
const { sendWhatsAppMessage } = require('../lib/whatsapp');
const { getGreeting, getDolarPrice } = require('../lib/helpers');


// ── Rate limit para generación de códigos ─────────────────
const linkCodeLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Demasiados intentos. Esperá un momento antes de generar otro código.' },
});

// ── CORS para /api/* ───────────────────────────────────────
router.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', process.env.ALLOWED_ORIGIN || 'http://localhost:3000');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type');
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});

// ── Generar código de vinculación ─────────────────────────
router.post('/generate-link-code', linkCodeLimiter, async (req, res) => {
  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith('Bearer ')) return res.status(401).json({ error: 'No autorizado' });
  const token = authHeader.slice(7);
  try {
    const { data: { user }, error } = await supabase.auth.getUser(token);
    if (error || !user) return res.status(401).json({ error: 'Token inválido' });
    const userName = user.user_metadata?.full_name || user.user_metadata?.nombre || user.email?.split('@')[0] || 'Usuario';
    const rawPhone = req.body?.phone || '';
    const expectedPhone = rawPhone.replace(/\D/g, '');
    const code = await generateLinkingCode(user.id, userName, expectedPhone || null);
    res.json({ code });
  } catch (err) {
    console.error('❌ Error generando código:', err.message);
    res.status(500).json({ error: 'Error interno' });
  }
});

// ── Enviar OTP por WhatsApp ───────────────────────────────
router.post('/send-phone-otp', async (req, res) => {
  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith('Bearer ')) return res.status(401).json({ error: 'No autorizado' });
  const token = authHeader.slice(7);
  try {
    const { data: { user }, error } = await supabase.auth.getUser(token);
    if (error || !user) return res.status(401).json({ error: 'Token inválido' });
    const phone = (req.body?.phone || '').replace(/\D/g, '');
    if (phone.length < 10) return res.status(400).json({ error: 'Número inválido' });
    const existing = await getPhoneOTP(phone);
    if (existing && Date.now() < existing.expires - 4.5 * 60_000) {
      return res.status(429).json({ error: 'Esperá unos segundos antes de volver a pedir el código.' });
    }
    const userName = user.user_metadata?.full_name || user.user_metadata?.nombre || user.email?.split('@')[0] || 'Usuario';
    const otp = await generatePhoneOTP(user.id, userName, phone);
    try {
      await sendWhatsAppMessage(phone, `🔐 *Tu código de verificación de Orbe es:*\n\n*${otp}*\n\nIngresálo en la app. Expira en 5 minutos.\n\n_Si no lo pediste vos, ignorá este mensaje._`, { throwOnError: true });
    } catch (waErr) {
      phoneOTPs.delete(phone);
      const msg = waErr.message || '';
      const isWindowError = msg.includes('24') || msg.includes('window') || msg.includes('131026') || msg.includes('131047');
      if (isWindowError) {
        return res.status(400).json({
          error: 'Para recibir el código necesitás enviarle primero un mensaje al bot de Orbe en WhatsApp. Escribile "Hola" y luego pedí el código de nuevo.',
          needsFirstMessage: true,
        });
      }
      return res.status(500).json({ error: 'No se pudo enviar el código por WhatsApp. Verificá que el número sea correcto.' });
    }
    res.json({ ok: true });
  } catch (err) {
    console.error('❌ Error enviando OTP:', err.message);
    res.status(500).json({ error: 'Error interno' });
  }
});

// ── Verificar OTP y vincular teléfono ────────────────────
router.post('/verify-phone-otp', async (req, res) => {
  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith('Bearer ')) return res.status(401).json({ error: 'No autorizado' });
  const token = authHeader.slice(7);
  try {
    const { data: { user }, error } = await supabase.auth.getUser(token);
    if (error || !user) return res.status(401).json({ error: 'Token inválido' });
    const phone = (req.body?.phone || '').replace(/\D/g, '');
    const otp   = (req.body?.otp   || '').trim();
    const entry = await getPhoneOTP(phone);
    if (!entry) return res.status(400).json({ error: 'Código expirado. Pedí uno nuevo en la app.' });
    if (entry.otp !== otp) return res.status(400).json({ error: 'Código incorrecto.' });
    if (entry.userId !== user.id) return res.status(403).json({ error: 'No autorizado.' });
    await deletePhoneOTP(phone);
    await linkPhoneToUser(phone, user.id, entry.userName);
    const firstName = entry.userName ? entry.userName.split(' ')[0] : 'acá';
    await sendWhatsAppMessage(phone, `¡Hola ${firstName}! Bienvenido a Orbe. 🌟\n\nSoy tu asistente financiero personal. Estoy acá para ayudarte a entender a dónde va tu plata, ahorrar con un objetivo claro y no llevarte sorpresas a fin de mes.\n\nDesde este chat podés hacer todo sin abrir la app:\n\n💸 *Registrar gastos e ingresos*\n"Gasté $6000 en el súper" · "Cobré el sueldo"\n\n📊 *Consultar tu situación*\n"¿Cómo voy este mes?" · "¿Cuánto gasté en comida?"\n\n🎯 *Seguir tus metas de ahorro*\n"¿Cuánto me falta para mi meta?" · "Quiero ahorrar para un viaje"\n\n💳 *Controlar tus deudas*\n"¿Cuándo vence mi próxima cuota?"\n\n💵 *Precios del dólar*\n"¿A cuánto está el blue hoy?"\n\n📌 Anclá este chat para tenerme siempre a mano.\n\n¿Cómo arrancaste el mes? 😊`);
    res.json({ ok: true });
  } catch (err) {
    console.error('❌ Error verificando OTP:', err.message);
    res.status(500).json({ error: 'Error interno' });
  }
});

// ── Cotización del dólar (para el frontend) ───────────────
router.get('/dolar', async (req, res) => {
  try {
    const dolar = await getDolarPrice();
    if (!dolar) return res.status(503).json({ error: 'No disponible' });
    res.json({ blue: dolar.blue, oficial: dolar.oficial, tarjeta: dolar.tarjeta || null });
  } catch {
    res.status(500).json({ error: 'Error interno' });
  }
});

module.exports = router;
