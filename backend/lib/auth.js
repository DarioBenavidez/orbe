'use strict';

const crypto = require('crypto');
const { supabase } = require('./supabase');

// ── Códigos de vinculación (Supabase) ─────────────────────
async function generateLinkingCode(userId, userName, expectedPhone) {
  const code = String(crypto.randomInt(100000, 1000000));
  const expires_at = new Date(Date.now() + 10 * 60_000).toISOString();
  await supabase.from('linking_codes').delete().eq('user_id', userId);
  await supabase.from('linking_codes').insert({ code, user_id: userId, user_name: userName, expected_phone: expectedPhone || null, expires_at });
  return code;
}

async function consumeLinkingCode(code, fromPhone) {
  const { data: entry } = await supabase.from('linking_codes').select('*').eq('code', code).single();
  if (!entry) return null;
  if (new Date(entry.expires_at) < new Date()) {
    await supabase.from('linking_codes').delete().eq('code', code);
    return null;
  }
  if (entry.expected_phone && entry.expected_phone !== fromPhone) return null;
  await supabase.from('linking_codes').delete().eq('code', code);
  return { userId: entry.user_id, userName: entry.user_name };
}

// ── OTP de verificación de teléfono (Supabase) ────────────
async function generatePhoneOTP(userId, userName, phone) {
  const otp = String(crypto.randomInt(100000, 1000000));
  const expires_at = new Date(Date.now() + 5 * 60_000).toISOString();
  await supabase.from('phone_otps').upsert({ phone, otp, user_id: userId, user_name: userName, expires_at });
  return otp;
}

async function getPhoneOTP(phone) {
  const { data } = await supabase.from('phone_otps').select('*').eq('phone', phone).single();
  if (!data) return null;
  if (new Date(data.expires_at) < new Date()) {
    await supabase.from('phone_otps').delete().eq('phone', phone);
    return null;
  }
  return { otp: data.otp, userId: data.user_id, userName: data.user_name, expires: new Date(data.expires_at).getTime() };
}

async function deletePhoneOTP(phone) {
  await supabase.from('phone_otps').delete().eq('phone', phone);
}

// ── Rate limit por teléfono (en memoria) ──────────────────
const phoneRateMap = new Map();

function isPhoneRateLimited(phone) {
  const now = Date.now();
  const windowMs = 60_000;
  const maxPerWindow = 20;
  const entry = phoneRateMap.get(phone) || { count: 0, reset: now + windowMs };
  if (now > entry.reset) { entry.count = 0; entry.reset = now + windowMs; }
  entry.count++;
  phoneRateMap.set(phone, entry);
  return entry.count > maxPerWindow;
}

// Limpiar entradas viejas cada 5 min
setInterval(() => {
  const now = Date.now();
  for (const [k, v] of phoneRateMap) { if (now > v.reset + 60_000) phoneRateMap.delete(k); }
}, 5 * 60_000);

// ── Verificar firma X-Hub-Signature-256 de Meta ───────────
function verifyMetaSignature(req) {
  const appSecret = process.env.WHATSAPP_APP_SECRET;
  if (!appSecret) return false;
  const sig = req.headers['x-hub-signature-256'];
  if (!sig) return false;
  const expected = 'sha256=' + crypto.createHmac('sha256', appSecret).update(req.rawBody || '').digest('hex');
  try { return crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected)); } catch { return false; }
}

module.exports = {
  generateLinkingCode, consumeLinkingCode,
  generatePhoneOTP, getPhoneOTP, deletePhoneOTP,
  isPhoneRateLimited,
  verifyMetaSignature,
};
