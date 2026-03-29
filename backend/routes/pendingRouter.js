'use strict';

const crypto = require('crypto');
const { saveData, saveHistory, savePendingSuggestion, clearPendingSuggestion } = require('../lib/supabase');
const { sendWhatsAppMessage } = require('../lib/whatsapp');
const { fmt, today, currentMonth, parseDateParts } = require('../lib/helpers');
const { CATEGORIAS } = require('../lib/constants');

/**
 * Maneja flujos pendientes tipados.
 * Retorna true si el pending fue procesado, false si no.
 */
async function handlePending(pendingRaw, incomingMsg, data, userId, history, from) {
  let parsed;
  try {
    parsed = JSON.parse(pendingRaw);
  } catch {
    return false;
  }

  const { type } = parsed;

  switch (type) {

    case 'usd_tx': {
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
        nota = `USD ${parsed.amountUSD} → ${fmt(amountARS)} al cierre`;
      } else if (quereDolares && !querePesos) {
        amountARS = (parsed.dolarBlue > 0) ? Math.round(parsed.amountUSD * parsed.dolarBlue) : 0;
        nota = `USD ${parsed.amountUSD} (conversión pendiente al cierre)`;
      } else if (parsed.dolarBlue > 0) {
        amountARS = Math.round(parsed.amountUSD * parsed.dolarBlue);
        nota = `USD ${parsed.amountUSD} al blue ${fmt(parsed.dolarBlue)}`;
      } else {
        // Sin cotización y sin monto explícito: no registrar $0, pedir el monto
        const msg = `😓 No pude obtener el precio del dólar en este momento. ¿Cuánto fue en pesos? Mandame el monto y lo registro.`;
        await saveHistory(from, [...history, { role: 'user', content: incomingMsg }, { role: 'assistant', content: msg }]);
        await sendWhatsAppMessage(from, msg);
        return true;
      }

      const isPending = quereDolares && !querePesos && !montoEspecifico;
      const tx = {
        id: crypto.randomUUID(),
        type: 'gasto',
        description: `${parsed.description}${nota ? ' (' + nota + ')' : ''}`,
        amount: amountARS,
        amountUSD: parsed.amountUSD,
        currency: 'USD',
        dolarBlue: parsed.dolarBlue,
        pendingConversion: isPending,
        category: parsed.category,
        date: parsed.date,
        savingsId: '',
      };

      await saveData(userId, { ...data, transactions: [...data.transactions, tx] });

      let confirmMsg;
      if (montoEspecifico) {
        confirmMsg = `✅ Listo, actualicé el monto real: ${fmt(amountARS)} por *${parsed.description}* (eran USD ${parsed.amountUSD}).`;
      } else if (!parsed.dolarBlue || parsed.dolarBlue <= 0) {
        confirmMsg = `📌 No pude obtener la cotización del dólar. Registré USD ${parsed.amountUSD} como pendiente de conversión. Cuando tengas el monto en pesos, mandámelo y lo corrijo.`;
      } else if (isPending) {
        confirmMsg = `📌 Lo marqué como pendiente. Registré ${fmt(amountARS)} como aproximación al blue de hoy. Cuando cierre la tarjeta, mandame el monto real y lo corrijo.`;
      } else {
        confirmMsg = `💸 Anotado: ${fmt(amountARS)} por *${parsed.description}* (USD ${parsed.amountUSD} al blue ${fmt(parsed.dolarBlue)}).`;
      }

      await saveHistory(from, [...history, { role: 'user', content: incomingMsg }, { role: 'assistant', content: confirmMsg }]);
      await sendWhatsAppMessage(from, confirmMsg);
      return true;
    }

    case 'confirm_limpiar': {
      await clearPendingSuggestion(from);
      const confirmado = /\b(confirmar|confirmo|sí|si|dale|ok|listo|adelante|borrar)\b/i.test(incomingMsg.trim());
      if (!confirmado) {
        const msg = `Ok, cancelado. Tus transacciones siguen intactas 👍`;
        await saveHistory(from, [...history, { role: 'user', content: incomingMsg }, { role: 'assistant', content: msg }]);
        await sendWhatsAppMessage(from, msg);
        return true;
      }
      const { month: cm, year: cy } = currentMonth();
      const scope = parsed.scope || 'mes';
      const newTxs = scope === 'todo'
        ? []
        : data.transactions.filter(t => { const p = parseDateParts(t.date); return !(p.month === cm && p.year === cy); });
      await saveData(userId, { ...data, transactions: newTxs });
      const msg = `🗑️ Listo, borré todas las transacciones ${scope === 'todo' ? 'de todos los meses' : 'de este mes'}. Empezamos de cero 🌱`;
      await saveHistory(from, [...history, { role: 'user', content: incomingMsg }, { role: 'assistant', content: msg }]);
      await sendWhatsAppMessage(from, msg);
      return true;
    }

    case 'confirm_gastos_fijos': {
      await clearPendingSuggestion(from);
      const esAfirmativo = /\b(sí|si|dale|todos|yes|ok|listo|confirmo|claro|así|asi)\b/i.test(incomingMsg);
      const esNegativo   = /\b(no\b|ninguno|cancel)/i.test(incomingMsg);

      let gastosARegistrar = parsed.gastos;

      if (!esAfirmativo && !esNegativo) {
        gastosARegistrar = parsed.gastos.filter(g =>
          incomingMsg.toLowerCase().includes(g.description.toLowerCase())
        );
        if (!gastosARegistrar.length) {
          const lineas = parsed.gastos.map(g => `• ${g.description}: ${fmt(g.amount)}`).join('\n');
          await savePendingSuggestion(from, JSON.stringify(parsed));
          const msg = `No entendí bien cuáles. ¿Registramos todos o me decís cuáles?\n\n${lineas}`;
          await sendWhatsAppMessage(from, msg);
          return true;
        }
      }

      if (esNegativo) {
        const msg = `Dale, no registré nada. Avisame cuando quieras hacerlo.`;
        await saveHistory(from, [...history, { role: 'user', content: incomingMsg }, { role: 'assistant', content: msg }]);
        await sendWhatsAppMessage(from, msg);
        return true;
      }

      const fecha = parsed.date || today();
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
      return true;
    }

    case 'vocab_confirm': {
      await clearPendingSuggestion(from);
      const esAfirmativo = /\b(sí|si|dale|yes|correcto|exacto|eso|claro|obvio|justo|así|asi|confirmo|ok|okok|aja|ajá)\b/i.test(incomingMsg);
      const esNegativo = /\b(no|nope|incorrecto|mal|para nada|negativo|tampoco|nada que ver)\b/i.test(incomingMsg);

      if (esAfirmativo) {
        const txRaw = parsed.tx || {};
        const tx = {
          id: crypto.randomUUID(),
          type: txRaw.txType || 'gasto',
          description: txRaw.description || parsed.interpretacion,
          amount: parseFloat(txRaw.amount) || 0,
          category: txRaw.category || parsed.categoria || 'Otros',
          date: txRaw.date || today(),
          savingsId: '',
        };
        const vocab = Array.isArray(data.vocabulario) ? [...data.vocabulario] : [];
        if (!vocab.find(v => v.expresion.toLowerCase() === parsed.expresion.toLowerCase())) {
          vocab.push({ expresion: parsed.expresion, descripcion: parsed.interpretacion, categoria: parsed.categoria || 'Otros' });
        }
        await saveData(userId, { ...data, transactions: [...data.transactions, tx], vocabulario: vocab });
        const confirmMsg = `✅ Anotado: *${tx.description}*, ${fmt(tx.amount)}.\n\nY ya aprendí que *"${parsed.expresion}"* = *${parsed.interpretacion}* — no te pregunto más 😊`;
        await saveHistory(from, [...history, { role: 'user', content: incomingMsg }, { role: 'assistant', content: confirmMsg }]);
        await sendWhatsAppMessage(from, confirmMsg);
        return true;
      } else if (esNegativo) {
        await savePendingSuggestion(from, JSON.stringify({ type: 'vocab_clarify', expresion: parsed.expresion, tx: parsed.tx }));
        const msg = `Ah, copado. Entonces decime: ¿a qué te referís con *"${parsed.expresion}"*?`;
        await saveHistory(from, [...history, { role: 'user', content: incomingMsg }, { role: 'assistant', content: msg }]);
        await sendWhatsAppMessage(from, msg);
        return true;
      } else {
        await savePendingSuggestion(from, JSON.stringify(parsed));
        const msg = `¿Es sí o no? Cuando decís *"${parsed.expresion}"*, ¿te referís a *${parsed.interpretacion}*?`;
        await sendWhatsAppMessage(from, msg);
        return true;
      }
    }

    case 'vocab_clarify': {
      await clearPendingSuggestion(from);
      const expresion = parsed.expresion;
      const txRaw = parsed.tx || {};
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
      return true;
    }

    case 'confirm_edit': {
      await clearPendingSuggestion(from);
      const esNegativo = /\b(no\b|nope|cancel|no quiero|no gracias)\b/i.test(incomingMsg);

      if (esNegativo) {
        const msg = `Ok, no cambié nada.`;
        await saveHistory(from, [...history, { role: 'user', content: incomingMsg }, { role: 'assistant', content: msg }]);
        await sendWhatsAppMessage(from, msg);
        return true;
      }

      const txs = [...data.transactions];
      const txIdx = txs.findIndex(t => t.id === parsed.txId);
      if (txIdx === -1) {
        await sendWhatsAppMessage(from, `😅 No encontré la transacción para actualizar.`);
        return true;
      }
      const original = txs[txIdx];
      const updated = {
        ...original,
        ...(parsed.newAmount      ? { amount:      parseFloat(parsed.newAmount) }   : {}),
        ...(parsed.newDescription ? { description: parsed.newDescription }           : {}),
        ...(parsed.newCategory    ? { category:    parsed.newCategory }              : {}),
      };
      txs[txIdx] = updated;
      await saveData(userId, { ...data, transactions: txs });
      const cambios = [];
      if (parsed.newAmount)      cambios.push(`${fmt(original.amount)} → ${fmt(updated.amount)}`);
      if (parsed.newDescription) cambios.push(`"${original.description}" → "${updated.description}"`);
      if (parsed.newCategory)    cambios.push(`${original.category} → ${updated.category}`);
      const msg = `✅ Actualizado: *${updated.description}* — ${cambios.join(', ')}.`;
      await saveHistory(from, [...history, { role: 'user', content: incomingMsg }, { role: 'assistant', content: msg }]);
      await sendWhatsAppMessage(from, msg);
      return true;
    }

    case 'confirm_borrar_todos': {
      await clearPendingSuggestion(from);
      const confirmado = /\b(confirmar|confirmo|sí|si|dale|ok|listo|adelante|borrar)\b/i.test(incomingMsg.trim());
      if (!confirmado) {
        const msg = `Ok, cancelado. No borré nada 👍`;
        await saveHistory(from, [...history, { role: 'user', content: incomingMsg }, { role: 'assistant', content: msg }]);
        await sendWhatsAppMessage(from, msg);
        return true;
      }
      const idsToRemove = new Set(parsed.idsToRemove || []);
      if (!idsToRemove.size) {
        await sendWhatsAppMessage(from, `😅 No encontré las transacciones para borrar. Intentá de nuevo.`);
        return true;
      }
      const newTxs = data.transactions.filter(t => !idsToRemove.has(t.id));
      const borrados = data.transactions.length - newTxs.length;
      await saveData(userId, { ...data, transactions: newTxs });
      const msg = `🗑️ Listo, eliminé *${borrados} transacciones* de *"${parsed.keyword}"*.`;
      await saveHistory(from, [...history, { role: 'user', content: incomingMsg }, { role: 'assistant', content: msg }]);
      await sendWhatsAppMessage(from, msg);
      return true;
    }

    case 'confirm_borrar_duplicados': {
      await clearPendingSuggestion(from);
      const confirmado = /\b(confirmar|confirmo|sí|si|dale|ok|listo|adelante|borrar)\b/i.test(incomingMsg.trim());
      if (!confirmado) {
        const msg = `Ok, cancelado. No borré nada 👍`;
        await saveHistory(from, [...history, { role: 'user', content: incomingMsg }, { role: 'assistant', content: msg }]);
        await sendWhatsAppMessage(from, msg);
        return true;
      }
      const idsToRemove = new Set(parsed.idsToRemove || []);
      if (!idsToRemove.size) {
        await sendWhatsAppMessage(from, `😅 No encontré los duplicados para borrar. Intentá de nuevo.`);
        return true;
      }
      const newTxs = data.transactions.filter(t => !idsToRemove.has(t.id));
      const borrados = data.transactions.length - newTxs.length;
      await saveData(userId, { ...data, transactions: newTxs });
      const msg = `🧹 Listo, eliminé *${borrados} transacciones duplicadas*. Quedan las originales intactas.`;
      await saveHistory(from, [...history, { role: 'user', content: incomingMsg }, { role: 'assistant', content: msg }]);
      await sendWhatsAppMessage(from, msg);
      return true;
    }

    default:
      return false;
  }
}

module.exports = { handlePending };
