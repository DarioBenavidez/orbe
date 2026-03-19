'use strict';

const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY);

if (!process.env.SUPABASE_SERVICE_KEY) {
  console.error('⚠️  SUPABASE_SERVICE_KEY no configurada — operaciones admin deshabilitadas');
}
const supabaseAdmin = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY,
  { auth: { autoRefreshToken: false, persistSession: false } }
);

// ── Estructura por defecto del usuario ────────────────────
function defaultData() {
  return {
    transactions: [], budgets: [], categories: {}, savings: [], debts: [], events: [],
    vocabulario: [], recurringIncomes: [],
    balanceAlert: 0,
    reminders: [],
    selectedMonth: new Date().getMonth(), selectedYear: new Date().getFullYear(),
    silencedUntil: null,
    savingsMode: 0,
    plazosFijos: [],
    paymentMethods: {},
    orbeName: 'Orbe',
    suscripciones: [],
    onboardingDone: false,
    credits: {},
    turnos: [],
    activos: [],
    productos: [],
    ventas: [],
    negocio: null,
  };
}

// ── Datos financieros ──────────────────────────────────────
async function loadData(uid) {
  const { data, error } = await supabaseAdmin.from('finanzas').select('data').eq('id', uid).single();
  if (error || !data || !data.data) return defaultData();
  const d = data.data;
  return {
    ...defaultData(),
    ...d,
    reminders: Array.isArray(d.reminders) ? d.reminders : [],
    balanceAlert: typeof d.balanceAlert === 'number' ? d.balanceAlert : 0,
    silencedUntil: d.silencedUntil || null,
    savingsMode: typeof d.savingsMode === 'number' ? d.savingsMode : 0,
    plazosFijos: Array.isArray(d.plazosFijos) ? d.plazosFijos : [],
    paymentMethods: d.paymentMethods && typeof d.paymentMethods === 'object' ? d.paymentMethods : {},
    orbeName: typeof d.orbeName === 'string' ? d.orbeName : 'Orbe',
    suscripciones: Array.isArray(d.suscripciones) ? d.suscripciones : [],
    onboardingDone: typeof d.onboardingDone === 'boolean' ? d.onboardingDone : false,
    credits: d.credits && typeof d.credits === 'object' && !Array.isArray(d.credits) ? d.credits : {},
    turnos: Array.isArray(d.turnos) ? d.turnos : [],
    activos: Array.isArray(d.activos) ? d.activos : [],
    productos: Array.isArray(d.productos) ? d.productos : [],
    ventas: Array.isArray(d.ventas) ? d.ventas : [],
    negocio: d.negocio && typeof d.negocio === 'object' ? d.negocio : null,
  };
}

async function saveData(uid, payload) {
  await supabaseAdmin.from('finanzas').upsert({ id: uid, data: payload, updated_at: new Date().toISOString() });
}

// ── Usuarios de WhatsApp ───────────────────────────────────
async function getUserIdByPhone(phone) {
  const { data, error } = await supabaseAdmin.from('whatsapp_users').select('user_id, user_name').eq('phone', phone).single();
  if (error || !data) return null;
  return data;
}

async function linkPhoneToUser(phone, userId, userName) {
  const record = { phone, user_id: userId, linked_at: new Date().toISOString() };
  if (userName) record.user_name = userName;
  await supabaseAdmin.from('whatsapp_users').upsert(record);
}

// ── Historial de conversación ──────────────────────────────
async function loadHistory(phone) {
  const { data, error } = await supabaseAdmin.from('chat_history').select('messages').eq('phone', phone).single();
  if (error || !data) return [];
  return data.messages || [];
}

async function saveHistory(phone, messages) {
  const trimmed = messages.slice(-30);
  await supabaseAdmin.from('chat_history').upsert({ phone, messages: trimmed, updated_at: new Date().toISOString() });
}

// ── Sugerencias / estados pendientes (en memoria) ─────────
// Los flujos pendientes duran segundos/minutos — memoria es suficiente y más confiable.
const pendingMap = new Map(); // phone → { message, createdAt }

function getPendingSuggestion(phone) {
  const entry = pendingMap.get(phone);
  if (!entry) return null;
  // Auto-expirar después de 30 minutos
  if (Date.now() - entry.createdAt > 30 * 60 * 1000) {
    pendingMap.delete(phone);
    return null;
  }
  return entry.message;
}

function savePendingSuggestion(phone, originalMessage) {
  pendingMap.set(phone, { message: originalMessage, createdAt: Date.now() });
}

function clearPendingSuggestion(phone) {
  pendingMap.delete(phone);
}

async function saveFeatureRequest(phone, userName, originalMessage, suggestion) {
  await supabaseAdmin.from('feature_requests').insert({
    phone,
    user_name: userName || null,
    original_message: originalMessage,
    suggestion,
    created_at: new Date().toISOString(),
    status: 'pending',
  });
}

module.exports = {
  supabase, supabaseAdmin,
  defaultData, loadData, saveData,
  getUserIdByPhone, linkPhoneToUser,
  loadHistory, saveHistory,
  getPendingSuggestion, savePendingSuggestion, clearPendingSuggestion,
  saveFeatureRequest,
};
