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
const { today, fmt, currentMonth, parseDateParts, getGreeting } = require('../lib/helpers');
const { CATEGORIAS } = require('../lib/constants');
const { callClaude, interpretMessage } = require('../ai/interpret');
const { processAction } = require('../actions/index');

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

        const imageSystemPrompt = `Analizá esta imagen. Puede ser un resumen bancario, estado de cuenta, comprobante único, o extracto de Mercado Pago/tarjeta.
Extraé TODAS las transacciones que veas y respondé SOLO con un JSON array:
[
  {"descripcion":"Supermercado Día","monto":15000,"fecha":"${today()}","categoria":"Supermercado","tipo":"gasto"},
  {"descripcion":"Transferencia recibida","monto":50000,"fecha":"${today()}","categoria":"Otros","tipo":"ingreso"}
]
Reglas:
- descripcion: nombre del comercio o descripción tal como aparece
- monto: número sin $ ni puntos de miles (ej: 15000, no $15.000)
- fecha: YYYY-MM-DD (si no figura usá hoy: ${today()})
- categoria: una de estas EXACTAS según lo que parezca: Alimentación, Transporte, Salud, Entretenimiento, Ropa, Vivienda, Educación, Supermercado, Servicios, Otros. Si no estás seguro usá "Otros".
- tipo: "gasto" o "ingreso"
Si no es imagen financiera: [{"error":"no_financiero"}]
Si no se puede leer: [{"error":"ilegible"}]
Devolvé SOLO el JSON array, sin texto adicional.`;

        const extractedText = await callClaudeWithImage(imageSystemPrompt, base64, mimeType,
          caption ? `Imagen adjunta. Nota del usuario: "${caption}"` : 'Extraé todas las transacciones.');

        let txList;
        try {
          const jsonMatch = extractedText.match(/\[[\s\S]*\]/);
          txList = JSON.parse(jsonMatch?.[0] || extractedText);
        } catch {
          await sendWhatsAppMessage(from, `😅 No pude leer la imagen. ¿Podés decirme los datos manualmente?`);
          return;
        }

        if (!Array.isArray(txList) || !txList.length) {
          await sendWhatsAppMessage(from, `😅 No encontré transacciones en la imagen. ¿Es un resumen bancario o extracto?`);
          return;
        }
        if (txList[0]?.error === 'no_financiero') {
          await sendWhatsAppMessage(from, `🤔 Eso no parece un resumen bancario. Si querés registrar un gasto, mandame los datos: *"gasté $X en Y"*.`);
          return;
        }
        if (txList[0]?.error === 'ilegible') {
          await sendWhatsAppMessage(from, `😓 La imagen está borrosa. ¿Podés mandarla más clara o pasarme los datos a mano?`);
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

          // Mostrar resumen de lo encontrado
          const resumen = txList.map((t, i) => {
            const emoji = t.tipo === 'ingreso' ? '💰' : '💸';
            const cat = t.categoria !== 'Otros' ? ` (${t.categoria})` : ' ❓';
            return `${i + 1}. ${emoji} ${t.descripcion} — ${fmt(t.monto)}${cat}`;
          }).join('\n');

          await sendWhatsAppMessage(from, `📊 Encontré *${txList.length} transacciones*:\n\n${resumen}\n\n✅ ${claras.length} categorizadas automáticamente.\n❓ ${dudosas.length} necesitan categoría.\n\nVoy a preguntarte de a una. Empecemos:`);

          // Preguntar por la primera dudosa
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

    let pendingUSD = null;
    let pendingVocabConfirm = null;
    let pendingVocabClarify = null;
    let pendingGastosFijos = null;
    let pendingLimpiar = null;
    if (pendingRaw) {
      try {
        const parsed = JSON.parse(pendingRaw);
        if (parsed.type === 'usd_tx') pendingUSD = parsed;
        else if (parsed.type === 'vocab_confirm') pendingVocabConfirm = parsed;
        else if (parsed.type === 'vocab_clarify') pendingVocabClarify = parsed;
        else if (parsed.type === 'confirm_gastos_fijos') pendingGastosFijos = parsed;
        else if (parsed.type === 'confirm_limpiar') pendingLimpiar = parsed;
        else if (parsed.type === 'pending_bank_import') {
          // ── Flujo de categorización de importación bancaria ─
          const { txList, dudosas, dudosaIdx } = parsed;

          const msg = incomingMsg.trim().toLowerCase();

          let catElegida = 'Otros';
          const numMatch = incomingMsg.match(/^\s*(\d)\s*$/);
          if (numMatch) {
            const idx = parseInt(numMatch[1]) - 1;
            catElegida = CATEGORIAS[idx] || 'Otros';
          } else if (msg === 'no sé' || msg === 'no se' || msg === 'otros' || msg === '9') {
            catElegida = 'Otros';
          } else {
            const found = CATEGORIAS.find(c => c.toLowerCase().includes(msg) || msg.includes(c.toLowerCase()));
            if (found) catElegida = found;
          }

          const dudosaActual = dudosas[dudosaIdx];
          const txIdx = dudosaActual._originalIdx !== undefined
            ? dudosaActual._originalIdx
            : txList.findIndex(t => t.descripcion === dudosaActual.descripcion && t.monto === dudosaActual.monto);
          if (txIdx >= 0) txList[txIdx].categoria = catElegida;

          const nextIdx = dudosaIdx + 1;

          if (nextIdx < dudosas.length) {
            await savePendingSuggestion(from, JSON.stringify({ type: 'pending_bank_import', txList, dudosas, dudosaIdx: nextIdx }));
            const siguiente = dudosas[nextIdx];
            await sendWhatsAppMessage(from, `✅ *${dudosaActual.descripcion}* → ${catElegida}\n\n❓ *"${siguiente.descripcion}"* — ${fmt(siguiente.monto)}\n\n¿En qué categoría va?\n\n1. Alimentación\n2. Transporte\n3. Salud\n4. Entretenimiento\n5. Ropa\n6. Vivienda\n7. Educación\n8. Servicios\n9. Otros`);
          } else {
            await clearPendingSuggestion(from);
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
            const totalGastos = newTxs.filter(t => t.type === 'gasto').reduce((s, t) => s + t.amount, 0);
            const totalIngresos = newTxs.filter(t => t.type !== 'gasto').reduce((s, t) => s + t.amount, 0);
            await sendWhatsAppMessage(from, `✅ *¡Listo! ${newTxs.length} transacciones importadas.*\n\n${newTxs.map(t => `${t.type === 'gasto' ? '💸' : '💰'} ${t.description} — ${fmt(t.amount)} (${t.category})`).join('\n')}${totalGastos > 0 ? `\n\n💸 Total gastos: ${fmt(totalGastos)}` : ''}${totalIngresos > 0 ? `\n💰 Total ingresos: ${fmt(totalIngresos)}` : ''}`);
          }
          return;
        }
      } catch (err) {
        console.error('❌ Error procesando pending suggestion:', err.message);
      }
    }

    if (pendingUSD) {
      await clearPendingSuggestion(from);
      const montoMatch = incomingMsg.match(/\$\s*([\d.,]+)/);
      const montoEspecifico = montoMatch
        ? parseFloat(montoMatch[1].replace(/\./g, '').replace(',', '.'))
        : null;

      const querePesos   = /\bpeso|conver|tipo.*hoy|sí\b|si\b|dale\b|listo\b|registr|anotar|ok\b/i.test(incomingMsg);
      const quereDolares = /\bdólar|dolar|pendiente|despu[eé]|luego|no\b/i.test(incomingMsg);

      let amountARS;
      let nota;

      if (montoEspecifico) {
        amountARS = montoEspecifico;
        nota = `USD ${pendingUSD.amountUSD} → ${fmt(amountARS)} al cierre`;
      } else if (quereDolares && !querePesos) {
        amountARS = (pendingUSD.dolarBlue > 0) ? Math.round(pendingUSD.amountUSD * pendingUSD.dolarBlue) : 0;
        nota = `USD ${pendingUSD.amountUSD} (conversión pendiente al cierre)`;
      } else if (pendingUSD.dolarBlue > 0) {
        amountARS = Math.round(pendingUSD.amountUSD * pendingUSD.dolarBlue);
        nota = `USD ${pendingUSD.amountUSD} al blue ${fmt(pendingUSD.dolarBlue)}`;
      } else {
        // Sin cotización disponible — marcar como pendiente
        amountARS = 0;
        nota = `USD ${pendingUSD.amountUSD} (sin cotización disponible — pendiente de conversión)`;
      }

      const isPending = quereDolares && !querePesos && !montoEspecifico;
      const tx = {
        id: crypto.randomUUID(),
        type: 'gasto',
        description: `${pendingUSD.description}${nota ? ' (' + nota + ')' : ''}`,
        amount: amountARS,
        amountUSD: pendingUSD.amountUSD,
        currency: 'USD',
        dolarBlue: pendingUSD.dolarBlue,
        pendingConversion: isPending,
        category: pendingUSD.category,
        date: pendingUSD.date,
        savingsId: '',
      };

      await saveData(userId, { ...data, transactions: [...data.transactions, tx] });

      let confirmMsg;
      if (montoEspecifico) {
        confirmMsg = `✅ Listo, actualicé el monto real: ${fmt(amountARS)} por *${pendingUSD.description}* (eran USD ${pendingUSD.amountUSD}).`;
      } else if (!pendingUSD.dolarBlue || pendingUSD.dolarBlue <= 0) {
        confirmMsg = `📌 No pude obtener la cotización del dólar. Registré USD ${pendingUSD.amountUSD} como pendiente de conversión. Cuando tengas el monto en pesos, mandámelo y lo corrijo.`;
      } else if (isPending) {
        confirmMsg = `📌 Lo marqué como pendiente. Registré ${fmt(amountARS)} como aproximación al blue de hoy. Cuando cierre la tarjeta, mandame el monto real y lo corrijo.`;
      } else {
        confirmMsg = `💸 Anotado: ${fmt(amountARS)} por *${pendingUSD.description}* (USD ${pendingUSD.amountUSD} al blue ${fmt(pendingUSD.dolarBlue)}).`;
      }

      await saveHistory(from, [...history, { role: 'user', content: incomingMsg }, { role: 'assistant', content: confirmMsg }]);
      await sendWhatsAppMessage(from, confirmMsg);
      return;
    }

    // ── Flujo de confirmación de limpiar transacciones ─────
    if (pendingLimpiar) {
      await clearPendingSuggestion(from);
      const confirmado = /\b(confirmar|confirmo|sí|si|dale|ok|listo|adelante|borrar)\b/i.test(incomingMsg.trim());
      if (!confirmado) {
        const msg = `Ok, cancelado. Tus transacciones siguen intactas 👍`;
        await saveHistory(from, [...history, { role: 'user', content: incomingMsg }, { role: 'assistant', content: msg }]);
        await sendWhatsAppMessage(from, msg);
        return;
      }
      const { month: cm, year: cy } = currentMonth();
      const scope = pendingLimpiar.scope || 'mes';
      const newTxs = scope === 'todo'
        ? []
        : data.transactions.filter(t => { const p = parseDateParts(t.date); return !(p.month === cm && p.year === cy); });
      await saveData(userId, { ...data, transactions: newTxs });
      const msg = `🗑️ Listo, borré todas las transacciones ${scope === 'todo' ? 'de todos los meses' : 'de este mes'}. Empezamos de cero 🌱`;
      await saveHistory(from, [...history, { role: 'user', content: incomingMsg }, { role: 'assistant', content: msg }]);
      await sendWhatsAppMessage(from, msg);
      return;
    }

    // ── Flujo de confirmación de gastos fijos ──────────────
    if (pendingGastosFijos) {
      await clearPendingSuggestion(from);
      const esAfirmativo = /\b(sí|si|dale|todos|yes|ok|listo|confirmo|claro|así|asi)\b/i.test(incomingMsg);
      const esNegativo   = /\b(no\b|ninguno|cancel)/i.test(incomingMsg);

      let gastosARegistrar = pendingGastosFijos.gastos;

      if (!esAfirmativo && !esNegativo) {
        gastosARegistrar = pendingGastosFijos.gastos.filter(g =>
          incomingMsg.toLowerCase().includes(g.description.toLowerCase())
        );
        if (!gastosARegistrar.length) {
          const lineas = pendingGastosFijos.gastos.map(g => `• ${g.description}: ${fmt(g.amount)}`).join('\n');
          await savePendingSuggestion(from, JSON.stringify(pendingGastosFijos));
          const msg = `No entendí bien cuáles. ¿Registramos todos o me decís cuáles?\n\n${lineas}`;
          await sendWhatsAppMessage(from, msg);
          return;
        }
      }

      if (esNegativo) {
        const msg = `Dale, no registré nada. Avisame cuando quieras hacerlo.`;
        await saveHistory(from, [...history, { role: 'user', content: incomingMsg }, { role: 'assistant', content: msg }]);
        await sendWhatsAppMessage(from, msg);
        return;
      }

      const fecha = pendingGastosFijos.date || today();
      const nuevasTx = gastosARegistrar.map(g => ({
        id: crypto.randomUUID(),
        type: 'gasto',
        description: g.description,
        amount: g.amount,
        category: g.category || 'Otros',
        date: fecha,
        savingsId: '',
      }));
      await saveData(userId, { ...data, transactions: [...data.transactions, ...nuevasTx] });
      const total = gastosARegistrar.reduce((s, g) => s + g.amount, 0);
      const lineas = gastosARegistrar.map(g => `✅ ${g.description}: ${fmt(g.amount)}`).join('\n');
      const msg = `Listo, registré los gastos fijos:\n\n${lineas}\n\n💸 Total: ${fmt(total)}`;
      await saveHistory(from, [...history, { role: 'user', content: incomingMsg }, { role: 'assistant', content: msg }]);
      await sendWhatsAppMessage(from, msg);
      return;
    }

    // ── Flujo de confirmación de vocabulario ───────────────
    if (pendingVocabConfirm) {
      await clearPendingSuggestion(from);
      const esAfirmativo = /\b(sí|si|dale|yes|correcto|exacto|eso|claro|obvio|justo|así|asi|confirmo|ok|okok|aja|ajá)\b/i.test(incomingMsg);
      const esNegativo = /\b(no|nope|incorrecto|mal|para nada|negativo|tampoco|nada que ver)\b/i.test(incomingMsg);

      if (esAfirmativo) {
        const txRaw = pendingVocabConfirm.tx || {};
        const tx = {
          id: crypto.randomUUID(),
          type: txRaw.txType || 'gasto',
          description: txRaw.description || pendingVocabConfirm.interpretacion,
          amount: parseFloat(txRaw.amount) || 0,
          category: txRaw.category || pendingVocabConfirm.categoria || 'Otros',
          date: txRaw.date || today(),
          savingsId: '',
        };
        const vocab = Array.isArray(data.vocabulario) ? [...data.vocabulario] : [];
        if (!vocab.find(v => v.expresion.toLowerCase() === pendingVocabConfirm.expresion.toLowerCase())) {
          vocab.push({ expresion: pendingVocabConfirm.expresion, descripcion: pendingVocabConfirm.interpretacion, categoria: pendingVocabConfirm.categoria || 'Otros' });
        }
        await saveData(userId, { ...data, transactions: [...data.transactions, tx], vocabulario: vocab });
        const confirmMsg = `✅ Anotado: *${tx.description}*, ${fmt(tx.amount)}.\n\nY ya aprendí que *"${pendingVocabConfirm.expresion}"* = *${pendingVocabConfirm.interpretacion}* — no te pregunto más 😊`;
        await saveHistory(from, [...history, { role: 'user', content: incomingMsg }, { role: 'assistant', content: confirmMsg }]);
        await sendWhatsAppMessage(from, confirmMsg);
        return;
      } else if (esNegativo) {
        await savePendingSuggestion(from, JSON.stringify({ type: 'vocab_clarify', expresion: pendingVocabConfirm.expresion, tx: pendingVocabConfirm.tx }));
        const msg = `Ah, copado. Entonces decime: ¿a qué te referís con *"${pendingVocabConfirm.expresion}"*?`;
        await saveHistory(from, [...history, { role: 'user', content: incomingMsg }, { role: 'assistant', content: msg }]);
        await sendWhatsAppMessage(from, msg);
        return;
      } else {
        await savePendingSuggestion(from, JSON.stringify(pendingVocabConfirm));
        const msg = `¿Es sí o no? Cuando decís *"${pendingVocabConfirm.expresion}"*, ¿te referís a *${pendingVocabConfirm.interpretacion}*?`;
        await sendWhatsAppMessage(from, msg);
        return;
      }
    }

    // ── Flujo de aclaración de vocabulario ─────────────────
    if (pendingVocabClarify) {
      await clearPendingSuggestion(from);
      const expresion = pendingVocabClarify.expresion;
      const txRaw = pendingVocabClarify.tx || {};
      const tx = {
        id: crypto.randomUUID(),
        type: txRaw.txType || 'gasto',
        description: incomingMsg,
        amount: parseFloat(txRaw.amount) || 0,
        category: txRaw.category || 'Otros',
        date: txRaw.date || today(),
        savingsId: '',
      };
      const vocab = Array.isArray(data.vocabulario) ? [...data.vocabulario] : [];
      if (!vocab.find(v => v.expresion.toLowerCase() === expresion.toLowerCase())) {
        vocab.push({ expresion, descripcion: incomingMsg, categoria: txRaw.category || 'Otros' });
      }
      await saveData(userId, { ...data, transactions: [...data.transactions, tx], vocabulario: vocab });
      const confirmMsg = `Perfecto, guardé que *"${expresion}"* = *${incomingMsg}* 💾 Y anoté el ${tx.type === 'gasto' ? 'gasto' : 'ingreso'}: ${fmt(tx.amount)}.`;
      await saveHistory(from, [...history, { role: 'user', content: incomingMsg }, { role: 'assistant', content: confirmMsg }]);
      await sendWhatsAppMessage(from, confirmMsg);
      return;
    }

    // ── Flujo de sugerencia pendiente ──────────────────────
    if (pendingRaw && !pendingUSD) {
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
