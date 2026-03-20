'use strict';

const crypto = require('crypto');
const express = require('express');
const router = express.Router();

// ── Deduplicación de webhooks (memoria + Supabase) ─────────
const processedMessages = new Map(); // id → timestamp (caché en memoria)

async function isAlreadyProcessed(msgId) {
  if (processedMessages.has(msgId)) return true;
  // Fallback a Supabase tras reinicio del servidor
  try {
    const { data } = await supabaseAdmin.from('processed_messages').select('msg_id').eq('msg_id', msgId).single();
    if (data) { processedMessages.set(msgId, Date.now()); return true; }
  } catch {}
  return false;
}

function markAsProcessed(msgId) {
  processedMessages.set(msgId, Date.now());
  (async () => { try { await supabaseAdmin.from('processed_messages').upsert({ msg_id: msgId, processed_at: new Date().toISOString() }); } catch {} })();
}

// Limpiar registros viejos cada hora
setInterval(() => {
  const cutoff = Date.now() - 24 * 60 * 60 * 1000;
  for (const [id, ts] of processedMessages) if (ts < cutoff) processedMessages.delete(id);
  (async () => { try { await supabaseAdmin.from('processed_messages').delete().lt('processed_at', new Date(cutoff).toISOString()); } catch {} })();
}, 60 * 60_000);

// ── Sanitizar texto de usuario antes de meterlo en prompts ─
function sanitizeForPrompt(str, maxLen = 200) {
  return (str || '').replace(/[`\\]/g, '').slice(0, maxLen);
}

const {
  supabaseAdmin,
  getUserIdByPhone, loadData, saveData,
  loadHistory, saveHistory,
  getPendingSuggestion, savePendingSuggestion, clearPendingSuggestion,
  saveFeatureRequest,
} = require('../lib/supabase');
const { sendWhatsAppMessage, transcribeWhatsAppAudio } = require('../lib/whatsapp');
const { consumeLinkingCode, linkPhoneToUser, isPhoneRateLimited, verifyMetaSignature } = require('../lib/auth');
const { today, fmt } = require('../lib/helpers');
const { callClaude, interpretMessage, isClaudeRateLimited } = require('../ai/interpret');
const { processAction } = require('../actions/index');
const { handlePending } = require('./pendingRouter');

const WEBHOOK_VERIFY_TOKEN = process.env.WEBHOOK_VERIFY_TOKEN;

// ── Webhook: verificación Meta ─────────────────────────────
router.get('/', (req, res) => {
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];
  if (mode === 'subscribe' && token === WEBHOOK_VERIFY_TOKEN) {
    console.log('✅ Webhook verificado por Meta');
    return res.status(200).send(challenge);
  }
  res.sendStatus(403);
});

// ── Webhook: mensajes entrantes ────────────────────────────
router.post('/', async (req, res) => {
  // Verificar firma Meta
  if (!verifyMetaSignature(req)) {
    console.warn('⚠️  Firma Meta inválida — request rechazado');
    return res.sendStatus(403);
  }

  res.sendStatus(200); // Siempre responder 200 inmediatamente a Meta

  try {
    const entry = req.body.entry?.[0];
    const change = entry?.changes?.[0];
    const message = change?.value?.messages?.[0];

    if (!message || !['text', 'image', 'audio'].includes(message.type)) return;

    // Deduplicar: ignorar mensajes ya procesados (Meta puede reintentar)
    const msgId = message.id;
    if (msgId) {
      if (await isAlreadyProcessed(msgId)) return;
      markAsProcessed(msgId);
    }

    const from = message.from;
    if (!from) return;

    // ── Imágenes: no soportado ─────────────────────────────
    if (message.type === 'image') {
      await sendWhatsAppMessage(from, `Por ahora no proceso imágenes. Escribime el gasto: *"gasté $X en Y"* y lo anoto en segundos 😊`);
      return;
    }

    // ── Manejo de audio (nota de voz) ──────────────────────
    if (message.type === 'audio') {
      const userInfo = await getUserIdByPhone(from);
      if (!userInfo) {
        await sendWhatsAppMessage(from, `Para procesar tu audio primero tenés que vincular tu cuenta. Escribime tu email de Orbe.`);
        return;
      }
      const mediaId = message.audio?.id;
      const mimeType = message.audio?.mime_type;
      if (!mediaId) return;

      if (!process.env.GROQ_API_KEY) {
        await sendWhatsAppMessage(from, `🎙️ Los audios aún no están configurados. Por ahora escribime el gasto en texto.`);
        return;
      }

      try {
        await sendWhatsAppMessage(from, `🎙️ Escuchando...`);
        const transcripcion = await transcribeWhatsAppAudio(mediaId, mimeType);
        if (!transcripcion) {
          await sendWhatsAppMessage(from, `😓 No pude entender el audio. ¿Podés repetirlo o escribirme?`);
          return;
        }
        console.log(`🎙️ Transcripción (***${from.slice(-4)}): ${transcripcion}`);
        // Procesar la transcripción como si fuera un mensaje de texto normal
        message.type = 'text';
        message.text = { body: transcripcion };
        await sendWhatsAppMessage(from, `_🎙️ Escuché: "${transcripcion}"_`);
      } catch (err) {
        console.error('❌ Error procesando audio:', err.message);
        const msg = err.message === 'audio_demasiado_largo'
          ? `🎙️ El audio es muy largo. Mandame uno de menos de 10 segundos o escribime directamente.`
          : `😓 Tuve un problema con el audio. ¿Podés escribirme?`;
        await sendWhatsAppMessage(from, msg);
        return;
      }
    }

    // Rate limit por teléfono
    if (isPhoneRateLimited(from)) {
      console.warn(`⚠️  Rate limit: ${from}`);
      return;
    }

    const incomingMsg = message.text?.body?.trim();
    if (!incomingMsg) return;

    // Limitar longitud de mensajes (evita abuso de API)
    if (incomingMsg.length > 4000) {
      await sendWhatsAppMessage(from, `Ese mensaje es muy largo. Por favor enviá mensajes de menos de 4000 caracteres.`);
      return;
    }

    console.log(`📩 ***${from.slice(-4)}: ${incomingMsg.substring(0, 100)}${incomingMsg.length > 100 ? '...' : ''}`);

    // Activación segura con código temporal — formato: ORBE:123456
    if (incomingMsg.startsWith('ORBE:')) {
      const code = incomingMsg.replace('ORBE:', '').trim();
      const entry = await consumeLinkingCode(code, from);
      if (entry) {
        await linkPhoneToUser(from, entry.userId, entry.userName);
        const firstName = entry.userName ? entry.userName.split(' ')[0] : null;
        const nombre = firstName || 'acá';
        await sendWhatsAppMessage(from, `¡Hola ${nombre}! Bienvenido a Orbe. 🌟\n\nSoy tu asistente financiero personal. Estoy acá para ayudarte a entender a dónde va tu plata, ahorrar con un objetivo claro y no llevarte sorpresas a fin de mes.\n\nDesde este chat podés hacer todo sin abrir la app:\n\n💸 *Registrar gastos e ingresos*\n"Gasté $6000 en el súper" · "Cobré el sueldo"\n\n📊 *Consultar tu situación*\n"¿Cómo voy este mes?" · "¿Cuánto gasté en comida?"\n\n🎯 *Seguir tus metas de ahorro*\n"¿Cuánto me falta para mi meta?" · "Quiero ahorrar para un viaje"\n\n💳 *Controlar tus deudas*\n"¿Cuándo vence mi próxima cuota?"\n\n💵 *Precios del dólar*\n"¿A cuánto está el blue hoy?"\n\n📌 Anclá este chat para tenerme siempre a mano.\n\n¿Cómo arrancaste el mes? 😊`);
      } else {
        await sendWhatsAppMessage(from, `❌ Código inválido o expirado. Abrí la app de Orbe y generá un nuevo código desde *Perfil → Conectar WhatsApp*.`);
      }
      return;
    }

    // Legacy ORBE_ACTIVATE — deshabilitado por seguridad
    if (incomingMsg.startsWith('ORBE_ACTIVATE:')) {
      await sendWhatsAppMessage(from, `⚠️ Este método ya no está disponible. Abrí la app de Orbe y usá el botón *Conectar WhatsApp* para obtener un código seguro.`);
      return;
    }

    const userInfo = await getUserIdByPhone(from);
    if (!userInfo) {
      await sendWhatsAppMessage(from, `👋 Hola, soy *Orbe*, el asistente financiero personal.\n\nEste chat es exclusivo para usuarios de la app de Orbe. Para usarlo, descargá la app, creá tu cuenta y vinculá tu WhatsApp desde *Perfil → Conectar WhatsApp*. 📱`);
      return;
    }

    const { user_id: userId, user_name: userName } = userInfo;
    const name = userName ? userName.split(' ')[0] : '';
    const data = await loadData(userId);
    const history = await loadHistory(from);

    // ── Flujos pendientes ───────────────────────────────────
    const pendingRaw = await getPendingSuggestion(from);

    // ── Comando de escape: cancela cualquier flujo activo ──
    if (pendingRaw && /^(cancelar|salir|\/cancel|\/salir|stop|dejar|limpiar)$/i.test(incomingMsg.trim())) {
      await clearPendingSuggestion(from);
      const escapeMsg = `Ok, cancelado. ¿En qué te puedo ayudar? 😊`;
      await saveHistory(from, [...history, { role: 'user', content: incomingMsg }, { role: 'assistant', content: escapeMsg }]);
      await sendWhatsAppMessage(from, escapeMsg);
      return;
    }

    if (pendingRaw) {
      const handled = await handlePending(pendingRaw, incomingMsg, data, userId, history, from);
      if (handled) return;

      // Fallback: el pending era un mensaje libre (action.type === 'unknown') → guardar como feature request
      await saveFeatureRequest(from, userName, pendingRaw, incomingMsg);
      await clearPendingSuggestion(from);
      const confirmPrompt = `Sos Orbe, asistente financiero. El usuario acaba de explicarte en detalle algo que querían hacer y que no pudiste interpretar. Agradecéle de forma genuina y breve que se haya tomado el tiempo. Decile que lo guardaste para evaluarlo y que si es viable lo sumás próximamente. Español rioplatense informal. Sin asteriscos. Máximo 2 líneas.`;
      const confirmMsg = await callClaude(confirmPrompt, [], incomingMsg);
      await saveHistory(from, [...history, { role: 'user', content: incomingMsg }, { role: 'assistant', content: confirmMsg }]);
      await sendWhatsAppMessage(from, confirmMsg);
      return;
    }

    // ── Rate limit de Claude API por teléfono ──────────────────
    if (isClaudeRateLimited(from)) {
      console.warn(`⚠️  Claude rate limit: ${from}`);
      await sendWhatsAppMessage(from, `Un momento, mandaste muchos mensajes seguidos. Esperá un minuto y volvemos. 😊`);
      return;
    }

    // ── Routing: solo dos fast-paths sin ambigüedad posible ──────
    const despedidas = ['chau', 'bye', 'hasta luego', 'nos vemos', 'hasta mañana', 'buenas noches'];
    const saludos    = ['hola', 'buenas', 'hey', 'buen dia', 'buen día', 'buenos dias', 'buenos días', 'buenas tardes', 'que tal', 'qué tal', 'como estas', 'cómo estás'];
    const msgLower   = incomingMsg.toLowerCase().trim();

    const esDespedida = despedidas.some(d => msgLower === d || msgLower.endsWith(d) || msgLower.includes(d)) &&
      (despedidas.some(d => msgLower === d) || /gracias|hasta|chau|bye|nos vemos/i.test(msgLower));

    const esSaludo = !esDespedida && saludos.some(s => {
      if (msgLower === s) return true;
      if (msgLower.startsWith(s + ' ') || msgLower.startsWith(s + ',')) {
        const rest = msgLower.slice(s.length).replace(/^[\s,]+/, '').replace(/^orbe[\s,!]*/i, '').trim();
        return rest.length < 6;
      }
      return false;
    });

    let action;
    if (esDespedida) {
      const despedidaMsg = `Buenas noches${name ? ', ' + name : ''}! Que descanses. 🌙`;
      await saveHistory(from, [...history, { role: 'user', content: incomingMsg }, { role: 'assistant', content: despedidaMsg }]);
      await sendWhatsAppMessage(from, despedidaMsg);
      return;
    } else if (esSaludo) {
      action = { type: 'saludo' };
    } else {
      action = await interpretMessage(incomingMsg, data, history, userName);
    }

    // ── Validación de acción ────────────────────────────────
    if (!action || typeof action.type !== 'string') {
      console.warn('⚠️ Acción inválida recibida de Claude:', action);
      action = { type: 'unknown' };
    }

    console.log('🤖 Acción:', action.type);
    let respuesta;
    try {
      respuesta = await processAction(action, data, userId, userName, history, from);
    } catch (err) {
      console.error('❌ Error en processAction:', err.message);
      await sendWhatsAppMessage(from, `😓 Tuve un problema procesando tu mensaje. Intentá de nuevo en un momento.`);
      return;
    }

    if (action.type === 'unknown') {
      await savePendingSuggestion(from, incomingMsg);
    }

    const updatedHistory = [...history, { role: 'user', content: incomingMsg }, { role: 'assistant', content: respuesta }];
    await saveHistory(from, updatedHistory.slice(-30));
    await sendWhatsAppMessage(from, respuesta);

  } catch (err) {
    console.error('❌ Error webhook:', err.message);
  }
});

module.exports = router;
