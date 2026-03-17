'use strict';

const express = require('express');
const router = express.Router();

const {
  getUserIdByPhone, loadData, saveData,
  loadHistory, saveHistory,
  getPendingSuggestion, savePendingSuggestion, clearPendingSuggestion,
  saveFeatureRequest,
} = require('../lib/supabase');
const { sendWhatsAppMessage, transcribeWhatsAppAudio, downloadWhatsAppImage, callClaudeWithImage } = require('../lib/whatsapp');
const { consumeLinkingCode, linkPhoneToUser, isPhoneRateLimited, verifyMetaSignature } = require('../lib/auth');
const { today, fmt } = require('../lib/helpers');
const { callClaude, interpretMessage } = require('../ai/interpret');
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

    const from = message.from;
    if (!from) return;

    // ── Manejo de imagen (factura/recibo) ──────────────────
    if (message.type === 'image') {
      const userInfo = await getUserIdByPhone(from);
      if (!userInfo) {
        await sendWhatsAppMessage(from, `Para procesar tu imagen primero tenés que vincular tu cuenta. Escribime tu email de Orbe.`);
        return;
      }
      const mediaId = message.image?.id;
      const caption = message.image?.caption?.trim() || '';
      if (!mediaId) return;

      try {
        await sendWhatsAppMessage(from, `📸 Recibí la imagen, analizando...`);
        const { base64, mimeType } = await downloadWhatsAppImage(mediaId);
        const { user_id: userId, user_name: userName } = userInfo;
        const data = await loadData(userId);

        const imageSystemPrompt = `Analizá esta imagen financiera y determiná qué tipo es.

TIPO A — TICKET DE COMPRA: un solo recibo/ticket de un comercio (supermercado, farmacia, restaurante, etc.) con ítems y un total.
Respondé con este JSON:
{"tipo":"ticket","tienda":"Supermercado Día","total":12450,"fecha":"${today()}","categoria":"Supermercado"}
Categorías posibles: Alimentación, Supermercado, Salud, Entretenimiento, Ropa, Transporte, Servicios, Otros.

TIPO B — RESUMEN/EXTRACTO BANCARIO: múltiples movimientos de distintas fechas (tarjeta, banco, Mercado Pago).
Respondé con un JSON array:
[
  {"descripcion":"Supermercado Día","monto":15000,"fecha":"${today()}","categoria":"Supermercado","tipo":"gasto"},
  {"descripcion":"Transferencia recibida","monto":50000,"fecha":"${today()}","categoria":"Otros","tipo":"ingreso"}
]
Reglas para el array:
- descripcion: nombre del comercio o descripción tal como aparece
- monto: número sin $ ni puntos de miles (ej: 15000, no $15.000)
- fecha: YYYY-MM-DD (si no figura usá hoy: ${today()})
- categoria: Alimentación, Transporte, Salud, Entretenimiento, Ropa, Vivienda, Educación, Supermercado, Servicios, Otros
- tipo: "gasto" o "ingreso"

Si no es imagen financiera: {"error":"no_financiero"}
Si no se puede leer: {"error":"ilegible"}
Devolvé SOLO el JSON, sin texto adicional.`;

        const extractedText = await callClaudeWithImage(imageSystemPrompt, base64, mimeType,
          caption ? `Imagen adjunta. Nota del usuario: "${caption}"` : 'Analizá la imagen.');

        let parsed;
        try {
          const jsonMatch = extractedText.match(/[\[{][\s\S]*[\]}]/);
          parsed = JSON.parse(jsonMatch?.[0] || extractedText);
        } catch {
          await sendWhatsAppMessage(from, `😅 No pude leer la imagen. ¿Podés decirme los datos manualmente?`);
          return;
        }

        // Errores
        if (parsed?.error === 'no_financiero') {
          await sendWhatsAppMessage(from, `🤔 Eso no parece un comprobante financiero. Si querés registrar un gasto, mandame los datos: *"gasté $X en Y"*.`);
          return;
        }
        if (parsed?.error === 'ilegible') {
          await sendWhatsAppMessage(from, `😓 La imagen está borrosa. ¿Podés mandarla más clara o pasarme los datos a mano?`);
          return;
        }

        // ── TICKET SIMPLE ──────────────────────────────────────
        if (parsed?.tipo === 'ticket') {
          const { tienda, total, fecha, categoria } = parsed;
          if (!total || total <= 0) {
            await sendWhatsAppMessage(from, `😅 Vi el ticket pero no pude leer el total. ¿Cuánto fue?`);
            return;
          }
          await savePendingSuggestion(from, JSON.stringify({
            type: 'confirm_ticket',
            tienda: tienda || 'Comercio',
            total: parseFloat(total),
            fecha: fecha || today(),
            categoria: categoria || 'Otros',
          }));
          await sendWhatsAppMessage(from, `🧾 *${tienda || 'Comercio'}* — ${fmt(parseFloat(total))}\n📂 ${categoria || 'Otros'} · 📅 ${fecha || today()}\n\n¿Lo registro? (Sí / No)`);
          return;
        }

        // ── EXTRACTO BANCARIO ──────────────────────────────────
        const txList = Array.isArray(parsed) ? parsed : null;
        if (!txList || !txList.length) {
          await sendWhatsAppMessage(from, `😅 No encontré transacciones en la imagen. ¿Es un resumen bancario o extracto?`);
          return;
        }

        // Separar las que tienen categoría clara de las dudosas (Otros)
        const claras = txList.filter(t => t.categoria && t.categoria !== 'Otros');
        const dudosas = txList
          .map((t, i) => ({ ...t, _originalIdx: i }))
          .filter(t => !t.categoria || t.categoria === 'Otros');

        // Guardar estado pendiente con toda la lista para categorizar las dudosas
        if (dudosas.length > 0) {
          await savePendingSuggestion(from, JSON.stringify({
            type: 'pending_bank_import',
            txList,
            dudosas,
            dudosaIdx: 0,
          }));

          const resumen = txList.map((t, i) => {
            const emoji = t.tipo === 'ingreso' ? '💰' : '💸';
            const cat = t.categoria !== 'Otros' ? ` (${t.categoria})` : ' ❓';
            return `${i + 1}. ${emoji} ${t.descripcion} — ${fmt(t.monto)}${cat}`;
          }).join('\n');

          await sendWhatsAppMessage(from, `📊 Encontré *${txList.length} transacciones*:\n\n${resumen}\n\n✅ ${claras.length} categorizadas automáticamente.\n❓ ${dudosas.length} necesitan categoría.\n\nVoy a preguntarte de a una. Empecemos:`);

          const primera = dudosas[0];
          await sendWhatsAppMessage(from, `❓ *"${primera.descripcion}"* — ${fmt(primera.monto)}\n\n¿En qué categoría va?\n\n1. Alimentación\n2. Transporte\n3. Salud\n4. Entretenimiento\n5. Ropa\n6. Vivienda\n7. Educación\n8. Servicios\n9. Otros\n\nRespondé con el número o el nombre. Si no sabés, decí *"no sé"* o *"otros"*.`);
        } else {
          // Todas categorizadas, registrar todo de una
          const newTxs = txList.map(t => ({
            id: crypto.randomUUID(),
            type: t.tipo || 'gasto',
            description: t.descripcion,
            amount: parseFloat(t.monto),
            category: t.categoria || 'Otros',
            date: t.fecha || today(),
            savingsId: '',
            note: 'Importado por foto',
          }));
          await saveData(userId, { ...data, transactions: [...data.transactions, ...newTxs] });
          const total = newTxs.filter(t => t.type === 'gasto').reduce((s, t) => s + t.amount, 0);
          await sendWhatsAppMessage(from, `✅ *${newTxs.length} transacciones importadas!*\n\n${newTxs.map(t => `${t.type === 'gasto' ? '💸' : '💰'} ${t.description} — ${fmt(t.amount)} (${t.category})`).join('\n')}\n\n💸 Total gastos: ${fmt(total)}`);
        }
      } catch (err) {
        console.error('❌ Error procesando imagen:', err.message);
        await sendWhatsAppMessage(from, `😓 Tuve un problema procesando la imagen. ¿Podés pasarme los datos a mano?`);
      }
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
        console.log(`🎙️ Transcripción (${from}): ${transcripcion}`);
        // Procesar la transcripción como si fuera un mensaje de texto normal
        message.type = 'text';
        message.text = { body: transcripcion };
        await sendWhatsAppMessage(from, `_🎙️ Escuché: "${transcripcion}"_`);
      } catch (err) {
        console.error('❌ Error procesando audio:', err.message);
        await sendWhatsAppMessage(from, `😓 Tuve un problema con el audio. ¿Podés escribirme?`);
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

    console.log(`📩 ${from}: ${incomingMsg.substring(0, 100)}${incomingMsg.length > 100 ? '...' : ''}`);

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

    console.log('🤖 Acción:', JSON.stringify(action));
    const respuesta = await processAction(action, data, userId, userName, history, from);

    if (action.type === 'unknown') {
      await savePendingSuggestion(from, incomingMsg);
    }

    await saveHistory(from, [...history, { role: 'user', content: incomingMsg }, { role: 'assistant', content: respuesta }]);
    await sendWhatsAppMessage(from, respuesta);

  } catch (err) {
    console.error('❌ Error webhook:', err.message);
  }
});

module.exports = router;
