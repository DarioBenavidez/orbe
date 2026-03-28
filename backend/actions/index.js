'use strict';

const { supabase, loadData, saveData, getPendingSuggestion, savePendingSuggestion, clearPendingSuggestion } = require('../lib/supabase');
const { sendWhatsAppMessage } = require('../lib/whatsapp');
const { fmt, fmtSigned, fmtDate, today, currentMonth, arDay, arNow, parseDateParts, getDolarPrice, MONTH_NAMES, getGreeting, truncate } = require('../lib/helpers');
const fmtUSD = (n) => { const num = Number(n) || 0; return `USD ${num % 1 === 0 ? num : num.toFixed(2)}`; };
const fmtLoan = (loan) => loan.currency === 'usd' && loan.amountUSD ? `${fmtUSD(loan.amountUSD)} (≈ ${fmt(loan.remaining)})` : fmt(loan.remaining);
const { callClaude } = require('../ai/interpret');
const { filterByMonth, monthlyTotals } = require('./helpers');

async function processAction(action, data, userId, userName, history = [], phone = null) {
  const { month, year } = currentMonth();
  const name = userName ? userName.split(' ')[0] : '';

  switch (action.type) {

    case 'saludo': {
      const greeting = getGreeting();
      const todayStr = today();
      const txsHoy = data.transactions.filter(t => t.date === todayStr);
      const { ingresos: ingresosMes, gastos: gastosMes } = monthlyTotals(data.transactions, month, year);
      const balanceMes = ingresosMes - gastosMes;
      const todayDay = arDay();
      const proxVenc2 = (data.events || []).filter(ev => ev.day >= todayDay && ev.day <= todayDay + 3);

      let contextoHoy = '';
      if (txsHoy.length === 0) {
        contextoHoy = 'Todavía no registraste nada hoy.';
      } else {
        const gastosHoy = txsHoy.filter(t => t.type === 'gasto').reduce((a, t) => a + t.amount, 0);
        const ingresosHoy = txsHoy.filter(t => t.type !== 'gasto').reduce((a, t) => a + t.amount, 0);
        const partes = [];
        if (ingresosHoy > 0) partes.push(`ingresos: ${fmt(ingresosHoy)}`);
        if (gastosHoy > 0) partes.push(`gastos: ${fmt(gastosHoy)}`);
        contextoHoy = `Hoy ya registraste: ${partes.join(' y ')}.`;
      }

      const saludoPrompt = `Sos Orbe, el asistente financiero personal de ${name || 'tu usuario'}. Sos cálido, empático, cercano y hablás en español rioplatense informal. Sos un asistente — nunca digas que sos humano ni que no sos un bot.

Situación actual:
- Saludo del horario: "${greeting}"
- Nombre del usuario: ${name || '(no disponible)'}
- ${contextoHoy}
- Balance del mes (${MONTH_NAMES[month]}): ${fmt(balanceMes)} ${balanceMes < 0 ? '(NEGATIVO)' : ''}
- Ingresos del mes: ${fmt(ingresosMes)} / Gastos: ${fmt(gastosMes)}
${proxVenc2.length > 0 ? `- Vencimientos próximos (próx. 3 días): ${proxVenc2.map(ev => ev.title).join(', ')}` : '- Sin vencimientos urgentes'}
- Historial reciente: ${history.length > 0 ? 'hay mensajes previos esta sesión' : 'primer mensaje del día'}

Tu tarea: escribí un saludo natural, breve y conversacional. Pensá qué es lo más relevante de la situación financiera para mencionar — no todo, lo que realmente importa ahora mismo. Si hay vencimientos urgentes, son lo primero. Si el balance está justo, es el momento de mencionarlo. Si todo va bien, podés ser más liviana y simplemente preguntar cómo arrancó el día. Una sola pregunta, nunca varias. No uses listas ni asteriscos. Variá el estilo — no empieces siempre igual, no digas siempre "¡Buenos días!". Máximo 4 líneas. Escribí como alguien que genuinamente se acuerda de la situación del usuario, no como un bot que ejecuta un template.`;

      return await callClaude(saludoPrompt, [], 'hola');
    }

    case 'editar_transaccion': {
      const { month: cm, year: cy } = currentMonth();
      const keyword = (action.keyword || '').toLowerCase();
      const txs = data.transactions;
      // Buscar la más reciente que matchee el keyword en el mes actual
      const idx = [...txs].reverse().findIndex(t => {
        const p = parseDateParts(t.date);
        if (p.month !== cm || p.year !== cy) return false;
        return t.description?.toLowerCase().includes(keyword) || t.category?.toLowerCase().includes(keyword);
      });
      const realIdx = idx !== -1 ? txs.length - 1 - idx : -1;
      if (realIdx === -1) return `🤔 No encontré ninguna transacción de este mes que coincida con *"${action.keyword}"*.`;
      const original = txs[realIdx];
      const cambios = [];
      if (action.newAmount)      cambios.push(`monto: ${fmt(original.amount)} → ${fmt(parseFloat(action.newAmount))}`);
      if (action.newDescription) cambios.push(`descripción: "${original.description}" → "${action.newDescription}"`);
      if (action.newCategory)    cambios.push(`categoría: ${original.category} → ${action.newCategory}`);
      await savePendingSuggestion(phone, JSON.stringify({
        type: 'confirm_edit',
        txId: original.id,
        newAmount: action.newAmount || null,
        newDescription: action.newDescription || null,
        newCategory: action.newCategory || null,
      }));
      return `✏️ Encontré esto:\n\n📝 *${original.description}* — ${fmt(original.amount)} (${original.date})\n\n${cambios.join('\n')}\n\n¿Lo actualizo? (Sí / No)`;
    }

    case 'guardar_vocabulario': {
      const vocab = Array.isArray(data.vocabulario) ? [...data.vocabulario] : [];
      const idx = vocab.findIndex(v => v.expresion.toLowerCase() === action.expresion.toLowerCase());
      if (idx !== -1) {
        vocab[idx] = { expresion: action.expresion, descripcion: action.descripcion, categoria: action.categoria || 'Otros' };
      } else {
        vocab.push({ expresion: action.expresion, descripcion: action.descripcion, categoria: action.categoria || 'Otros' });
      }
      await saveData(userId, { ...data, vocabulario: vocab });
      return `Guardado 💾 Ya sé que *"${action.expresion}"* = *${action.descripcion}* (${action.categoria || 'Otros'}). La próxima lo uso directamente.`;
    }

    case 'confirmar_vocabulario': {
      const pendingJson = JSON.stringify({
        type: 'vocab_confirm',
        expresion: action.expresion,
        interpretacion: action.interpretacion,
        categoria: action.categoria,
        tx: action.tx,
      });
      await savePendingSuggestion(phone, pendingJson);
      return `Una pregunta rápida: cuando decís *"${action.expresion}"*, ¿te referís a *${action.interpretacion}*? (Sí / No)`;
    }

    case 'consultar_dolar': {
      const dolar = await getDolarPrice();
      if (!dolar) return `😓 No pude obtener la cotización ahora. Intentá de nuevo en un rato.`;
      return `💵 *Cotización del dólar*\n\n🏦 Oficial: ${fmt(dolar.oficial)}\n🔵 Blue: ${fmt(dolar.blue)}\n\n_Fuente: Bluelytics_`;
    }

    case 'agregar_transaccion': {
      const txAmount = parseFloat(action.amount);
      if (!txAmount || txAmount <= 0) return `🤔 No entendí el monto. ¿Cuánto fue exactamente?`;
      const tx = {
        id: crypto.randomUUID(),
        type: action.txType || 'gasto',
        description: truncate(action.description, 200),
        amount: txAmount,
        category: action.category || 'Otros',
        date: action.date || today(),
        savingsId: '',
        note: action.note || '',
      };
      // Deduplicación: evitar registrar dos veces la misma transacción
      if (tx.type === 'ingreso' || tx.type === 'sueldo') {
        const duplicate = data.transactions.find(t =>
          Math.abs(t.amount - tx.amount) < 1 &&
          t.date === tx.date &&
          (t.type === 'ingreso' || t.type === 'sueldo')
        );
        if (duplicate) {
          return `⚠️ Ya tenés registrado *${duplicate.description}* por ${fmt(duplicate.amount)} el ${duplicate.date}. No lo volví a agregar para evitar duplicados. Si querés modificarlo, decime qué cambiar.`;
        }
      }
      if (tx.type === 'gasto') {
        const duplicate = data.transactions.find(t =>
          t.type === 'gasto' &&
          Math.abs(t.amount - tx.amount) < 1 &&
          t.date === tx.date &&
          t.description.toLowerCase() === tx.description.toLowerCase()
        );
        if (duplicate) {
          return `⚠️ Ya registré *${duplicate.description}* por ${fmt(duplicate.amount)} hoy. ¿Lo querés registrar de nuevo o fue un error?`;
        }
      }

      const allTxs = [...data.transactions, tx];
      await saveData(userId, { ...data, transactions: allTxs });

      // Bienvenida especial cuando llega el sueldo
      if (tx.type === 'sueldo') {
        const gastosFijos = (data.recurringExpenses || []).filter(g => g.active).reduce((a, g) => a + g.amount, 0);
        const gastosMes = monthlyTotals(allTxs, month, year).gastos;
        const disponible = tx.amount - gastosMes;
        const sueldoPrompt = `Sos Orbe, asistente financiero de ${name || 'tu usuario'}. Hablás en español rioplatense informal. El usuario acaba de registrar su sueldo — es el momento más importante del mes. Felicitálo con calidez y decile lo que le queda disponible después de los gastos. Si tiene gastos fijos configurados, mencioná cuánto absorben. Si tiene metas de ahorro activas (${data.savings?.length || 0}), sugerí separar algo. Sin listas ni asteriscos. Máximo 4 líneas.
Datos: sueldo ${fmt(tx.amount)} | gastos del mes hasta ahora ${fmt(gastosMes)} | gastos fijos mensuales ${fmt(gastosFijos)} | disponible real ${fmt(disponible)}`;
        return await callClaude(sueldoPrompt, [], 'cobré el sueldo');
      }

      const label = tx.type === 'gasto' ? 'Gasto' : 'Ingreso';
      const emoji = tx.type === 'gasto' ? '💸' : '💰';
      const confirmaciones = [
        `${emoji} Anotado. *${tx.description}* — ${fmt(tx.amount)}`,
        `${emoji} Registré el ${label.toLowerCase()}: *${tx.description}*, ${fmt(tx.amount)}.`,
        `${emoji} Listo, ${fmt(tx.amount)} por *${tx.description}*. ✅`,
      ];
      let respuesta = confirmaciones[Math.floor(Math.random() * confirmaciones.length)];

      // Alerta de presupuesto si es un gasto
      if (tx.type === 'gasto') {
        const budget = (data.budgets || []).find(b => b.cat.toLowerCase() === tx.category.toLowerCase());
        if (budget && budget.limit > 0) {
          const spentCat = filterByMonth(allTxs, month, year)
            .filter(t => t.type === 'gasto' && t.category.toLowerCase() === tx.category.toLowerCase())
            .reduce((a, t) => a + t.amount, 0);
          const pct = Math.round((spentCat / budget.limit) * 100);
          if (pct >= 100) {
            respuesta += `\n\n🔴 Pasaste el presupuesto de *${tx.category}* (${pct}% usado). Te fuiste ${fmt(spentCat - budget.limit)} del límite.`;
          } else if (pct >= 80) {
            respuesta += `\n\n🟡 Ya usaste el ${pct}% del presupuesto de *${tx.category}*. Te quedan ${fmt(budget.limit - spentCat)}.`;
          }
        }

        // Aviso si el balance queda justo después del gasto
        const { ingresos: ingMes, gastos: gastMes } = monthlyTotals(allTxs, month, year);
        const balanceNuevo = ingMes - gastMes;
        if (balanceNuevo < 0) {
          respuesta += `\n\n⚠️ Con esto el mes quedó en rojo: ${fmtSigned(balanceNuevo)}.`;
        } else if (balanceNuevo < tx.amount * 2) {
          respuesta += `\n\nTe quedan ${fmt(balanceNuevo)} para lo que resta del mes.`;
        }

        // Alerta de balance bajo
        if (data.balanceAlert > 0 && balanceNuevo < data.balanceAlert) {
          respuesta += `\n\n⚠️ *Alerta:* tu balance bajó a ${fmt(balanceNuevo)}, por debajo del límite que configuraste (${fmt(data.balanceAlert)}).`;
        }
      }

      return respuesta;
    }

    case 'agregar_multiples_transacciones': {
      const items = Array.isArray(action.transacciones) ? action.transacciones : [];
      if (!items.length) return `🤔 No encontré transacciones para registrar.`;
      const nuevas = items
        .filter(t => parseFloat(t.amount) > 0)
        .map(t => ({
          id: crypto.randomUUID(),
          type: t.txType || 'gasto',
          description: truncate(t.description, 200) || 'Sin descripción',
          amount: parseFloat(t.amount),
          category: t.category || 'Otros',
          date: t.date || today(),
          savingsId: '',
        }));
      if (!nuevas.length) return `🤔 No pude leer los montos. ¿Podés pasarme cada gasto por separado?`;
      await saveData(userId, { ...data, transactions: [...data.transactions, ...nuevas] });
      const totalGastos = nuevas.filter(t => t.type === 'gasto').reduce((s, t) => s + t.amount, 0);
      const lineas = nuevas.map(t => `${t.type === 'gasto' ? '💸' : '💰'} ${t.description}: ${fmt(t.amount)}`).join('\n');
      return `✅ *${nuevas.length} transacciones registradas*\n\n${lineas}\n\n📊 Total: ${fmt(totalGastos)}`;
    }

    case 'buscar_transacciones': {
      const keyword = (action.keyword || '').toLowerCase();
      const cat = (action.category || '').toLowerCase();
      const txType = action.txType || '';
      const dateFrom = action.dateFrom || '';
      const dateTo = action.dateTo || '';

      const results = data.transactions.filter(t => {
        if (keyword && !t.description?.toLowerCase().includes(keyword) && !t.category?.toLowerCase().includes(keyword)) return false;
        if (cat && !t.category?.toLowerCase().includes(cat)) return false;
        if (txType && t.type !== txType) return false;
        if (dateFrom && t.date < dateFrom) return false;
        if (dateTo && t.date > dateTo) return false;
        return true;
      }).slice().reverse().slice(0, 15);

      if (!results.length) return `🔍 No encontré transacciones que coincidan con tu búsqueda.`;
      const total = results.reduce((s, t) => s + (t.type === 'gasto' ? t.amount : -t.amount), 0);
      const lineas = results.map(t => `${t.type === 'gasto' ? '💸' : '💰'} ${t.description} — ${fmt(t.amount)} (${t.date})`).join('\n');
      return `🔍 *${results.length} resultado${results.length > 1 ? 's' : ''}*\n\n${lineas}\n\n📊 Total: ${fmt(Math.abs(total))}`;
    }

    case 'borrar_transaccion': {
      const { month: cm, year: cy } = currentMonth();
      const keyword = (action.keyword || '').toLowerCase();
      const targetAmount = parseFloat(action.amount) || 0;
      const matchFn = t => {
        const p = parseDateParts(t.date);
        if (p.month !== cm || p.year !== cy) return false;
        const matchDesc = t.description?.toLowerCase().includes(keyword);
        const matchCat = t.category?.toLowerCase().includes(keyword);
        if (!matchDesc && !matchCat) return false;
        if (targetAmount > 0) return Math.abs(t.amount - targetAmount) < 1;
        return true;
      };
      // all:true → pedir confirmación antes de borrar todas
      if (action.all) {
        const toDelete = data.transactions.filter(matchFn);
        if (!toDelete.length) return `🤔 No encontré transacciones de este mes que coincidan con *"${action.keyword}"*.`;
        await savePendingSuggestion(phone, JSON.stringify({
          type: 'confirm_borrar_todos',
          keyword: action.keyword,
          idsToRemove: toDelete.map(t => t.id),
        }));
        const total = toDelete.reduce((s, t) => s + t.amount, 0);
        return `⚠️ Estoy por eliminar *${toDelete.length} transacciones* de *"${action.keyword}"* (${fmt(total)} en total).\n\nRespondé *CONFIRMAR* para continuar, o cualquier otra cosa para cancelar.`;
      }
      // Por defecto: borrar solo la más reciente
      const txsRev = [...data.transactions].reverse();
      const found = txsRev.find(matchFn);
      if (!found) return `🤔 No encontré ninguna transacción de este mes que coincida con *"${action.keyword}"*${targetAmount > 0 ? ` por ${fmt(targetAmount)}` : ''}.`;
      const newTxs = data.transactions.filter(t => t.id !== found.id);
      await saveData(userId, { ...data, transactions: newTxs });
      return `🗑️ Listo, eliminé *${found.description}* (${fmt(found.amount)}) del ${found.date}.`;
    }

    case 'borrar_duplicados': {
      const { month: cm, year: cy } = currentMonth();
      const txsMes = data.transactions.filter(t => {
        const p = parseDateParts(t.date);
        return p.month === cm && p.year === cy;
      });
      // Detectar duplicados: misma descripción + mismo monto + misma fecha
      const seen = new Map();
      const toRemove = [];
      for (const t of txsMes) {
        const key = `${t.description?.toLowerCase()}|${t.amount}|${t.date}`;
        if (!seen.has(key)) seen.set(key, t.id);
        else toRemove.push(t);
      }
      if (!toRemove.length) return `✅ No encontré duplicados en las transacciones de este mes.`;
      // Guardar pending con los IDs exactos a borrar
      const idsToRemove = toRemove.map(t => t.id);
      await savePendingSuggestion(phone, JSON.stringify({ type: 'confirm_borrar_duplicados', idsToRemove }));
      const resumen = [...new Set(toRemove.map(t => t.description))].slice(0, 5).join(', ');
      return `⚠️ Encontré *${toRemove.length} transacciones duplicadas*: ${resumen}${toRemove.length > 5 ? '...' : ''}.\n\nRespondé *CONFIRMAR* para limpiarlas, o cualquier otra cosa para cancelar.`;
    }

    case 'presupuesto_diario': {
      const { month: cm, year: cy } = currentMonth();
      const daysInMonth = new Date(cy, cm + 1, 0).getDate();
      const dayOfMonth = arDay();
      const daysLeft = daysInMonth - dayOfMonth;
      const { ingresos, gastos } = monthlyTotals(data.transactions, cm, cy);
      const balance = ingresos - gastos;
      const gastosFijosRest = (data.recurringExpenses || []).filter(g => g.active && g.day > dayOfMonth).reduce((s, g) => s + g.amount, 0);
      const disponible = balance - gastosFijosRest;
      const porDia = daysLeft > 0 ? Math.round(disponible / daysLeft) : disponible;
      const emoji = porDia > 0 ? '🟢' : '🔴';
      return `${emoji} *Presupuesto diario*\n\n💰 Balance actual: ${fmt(balance)}\n🔧 Gastos fijos que restan: ${fmt(gastosFijosRest)}\n💡 Disponible real: ${fmt(disponible)}\n📅 Días restantes: ${daysLeft}\n\n💸 *Podés gastar: ${fmt(Math.max(0, porDia))} por día*`;
    }

    case 'modo_ahorro': {
      const pct = Math.min(Math.max(parseFloat(action.porcentaje) || 10, 1), 50);
      const newBudgets = (data.budgets || []).map(b => ({
        ...b,
        limitOriginal: b.limitOriginal || b.limit,
        limit: b.limit > 0 ? Math.round(b.limit * (1 - pct / 100)) : 0,
      }));
      await saveData(userId, { ...data, budgets: newBudgets, savingsMode: pct });
      return `🐷 *Modo ahorro activado al ${pct}%*\n\nReduje todos tus presupuestos ${pct}%. Para volver a los valores originales decime "desactivar modo ahorro".`;
    }

    case 'simular_prestamo': {
      const capital = parseFloat(action.amount) || 0;
      const cuotas = parseInt(action.cuotas) || 12;
      const tna = parseFloat(action.tna) || 60;
      if (capital <= 0) return `🤔 Decime el monto del préstamo para simularlo.`;
      const tem = Math.pow(1 + tna / 100, 1 / 12) - 1;
      const cuota = tem > 0 ? capital * tem / (1 - Math.pow(1 + tem, -cuotas)) : capital / cuotas;
      const totalPagar = cuota * cuotas;
      const totalIntereses = totalPagar - capital;
      const cft = Math.pow(totalPagar / capital, 12 / cuotas) - 1;
      return `🏦 *Simulación de préstamo*\n\n💵 Capital: ${fmt(capital)}\n📅 Cuotas: ${cuotas}\n📈 TNA: ${tna}%\n\n💸 Cuota mensual: *${fmt(Math.round(cuota))}*\n💰 Total a pagar: ${fmt(Math.round(totalPagar))}\n🔴 Intereses totales: ${fmt(Math.round(totalIntereses))} (${Math.round(totalIntereses/capital*100)}% extra)`;
    }

    case 'estrategia_deudas': {
      const deudas = (data.debts || []).filter(d => d.remaining > 0);
      if (!deudas.length) return `✅ No tenés deudas activas. ¡Excelente posición!`;
      const avalancha = [...deudas].sort((a, b) => (b.interest || 0) - (a.interest || 0));
      const bolaNieve = [...deudas].sort((a, b) => a.remaining - b.remaining);
      const totalDeuda = deudas.reduce((s, d) => s + d.remaining, 0);
      const totalCuotas = deudas.reduce((s, d) => s + (d.installment || 0), 0);
      return `💳 *Estrategia para tus deudas*\n\n📊 Total adeudado: ${fmt(totalDeuda)}\n💸 Cuotas mensuales: ${fmt(totalCuotas)}\n\n🎯 *Avalancha* (ahorra más intereses):\nPagá primero → ${avalancha[0].name} (${fmt(avalancha[0].remaining)})\n\n⛄ *Bola de nieve* (más motivador):\nPagá primero → ${bolaNieve[0].name} (${fmt(bolaNieve[0].remaining)})\n\n_Recomendación: si podés pagar extra este mes, priorizá ${avalancha[0].name}._`;
    }

    case 'agregar_plazo_fijo': {
      const pf = {
        id: crypto.randomUUID(),
        amount: parseFloat(action.amount) || 0,
        tna: parseFloat(action.tna) || 0,
        dias: parseInt(action.dias) || 30,
        banco: action.banco || 'Banco',
        fechaInicio: today(),
        fechaVencimiento: (() => { const d = new Date(today()); d.setDate(d.getDate() + (parseInt(action.dias) || 30)); return d.toISOString().slice(0, 10); })(),
        ganancia: action.tna ? Math.round(parseFloat(action.amount) * (parseFloat(action.tna)/100) * ((parseInt(action.dias)||30)/365)) : 0,
      };
      const plazosFijos = [...(data.plazosFijos || []), pf];
      await saveData(userId, { ...data, plazosFijos });
      return `🏦 *Plazo fijo registrado*\n\n💵 Capital: ${fmt(pf.amount)}\n🏛️ Banco: ${pf.banco}\n📅 Vencimiento: ${pf.fechaVencimiento}${pf.tna > 0 ? `\n📈 TNA: ${pf.tna}%\n💰 Ganancia estimada: ${fmt(pf.ganancia)}` : ''}\n\nTe aviso cuando venza.`;
    }

    case 'consultar_plazo_fijo': {
      const pfs = data.plazosFijos || [];
      if (!pfs.length) return `📭 No tenés plazos fijos registrados.`;
      const total = pfs.reduce((s, p) => s + p.amount, 0);
      const totalGanancia = pfs.reduce((s, p) => s + (p.ganancia || 0), 0);
      const todayStr = today();
      const lineas = pfs.map(p => {
        const vencido = p.fechaVencimiento < todayStr;
        return `${vencido ? '✅' : '⏳'} *${p.banco}*: ${fmt(p.amount)}${p.tna ? ` al ${p.tna}% TNA` : ''} — vence ${p.fechaVencimiento}${p.ganancia ? ` (+${fmt(p.ganancia)})` : ''}`;
      }).join('\n');
      return `🏦 *Tus plazos fijos*\n\n${lineas}\n\n💰 Total invertido: ${fmt(total)}${totalGanancia > 0 ? `\n📈 Ganancia estimada: ${fmt(totalGanancia)}` : ''}`;
    }

    case 'gastos_hormiga': {
      const { month: cm, year: cy } = currentMonth();
      const txsMes = filterByMonth(data.transactions, cm, cy).filter(t => t.type === 'gasto');
      const UMBRAL = 5000;
      const hormiga = txsMes.filter(t => t.amount <= UMBRAL);
      if (!hormiga.length) return `✅ No detecté gastos hormiga este mes.`;
      const totalHormiga = hormiga.reduce((s, t) => s + t.amount, 0);
      const totalGastos = txsMes.reduce((s, t) => s + t.amount, 0);
      const porCat = {};
      hormiga.forEach(t => { porCat[t.description] = (porCat[t.description] || 0) + t.amount; });
      const top = Object.entries(porCat).sort((a, b) => b[1] - a[1]).slice(0, 5);
      return `🐜 *Gastos hormiga este mes*\n\n${hormiga.length} transacciones de menos de ${fmt(UMBRAL)}\n💸 Suman en total: *${fmt(totalHormiga)}* (${Math.round(totalHormiga/totalGastos*100)}% de tus gastos)\n\n*Los más frecuentes:*\n${top.map(([d, v]) => `• ${d}: ${fmt(v)}`).join('\n')}`;
    }

    case 'regla_50_30_20': {
      const { month: cm, year: cy } = currentMonth();
      const { txs: txsMes, ingresos, gastos } = monthlyTotals(data.transactions, cm, cy);
      if (!ingresos) return `📭 Todavía no registraste ingresos este mes. Registrá tu sueldo primero.`;
      const ahorros = (data.savings || []).reduce((s, sv) => s + (sv.current || 0), 0);
      const NECESIDADES_CATS = ['Vivienda', 'Alimentación', 'Transporte', 'Salud', 'Servicios'];
      const necesidades = txsMes.filter(t => t.type === 'gasto' && NECESIDADES_CATS.includes(t.category)).reduce((s, t) => s + t.amount, 0);
      const deseos = gastos - necesidades;
      const ideal50 = ingresos * 0.5;
      const ideal30 = ingresos * 0.3;
      const ideal20 = ingresos * 0.2;
      const pct = (v, t) => Math.round(v / t * 100);
      const status = (real, ideal) => real <= ideal ? '✅' : '⚠️';
      return `📊 *Regla 50/30/20*\n\n💰 Ingresos: ${fmt(ingresos)}\n\n${status(necesidades,ideal50)} *Necesidades* (ideal 50%): ${fmt(necesidades)} (${pct(necesidades,ingresos)}%)\n   Ideal: ${fmt(Math.round(ideal50))}\n\n${status(deseos,ideal30)} *Deseos* (ideal 30%): ${fmt(deseos)} (${pct(deseos,ingresos)}%)\n   Ideal: ${fmt(Math.round(ideal30))}\n\n${status(ahorros,ideal20)} *Ahorro* (ideal 20%): ${fmt(ahorros)} (${pct(ahorros,ingresos)}%)\n   Ideal: ${fmt(Math.round(ideal20))}`;
    }

    case 'ratio_ahorro': {
      const { month: cm, year: cy } = currentMonth();
      const { ingresos, gastos } = monthlyTotals(data.transactions, cm, cy);
      if (!ingresos) return `📭 No hay ingresos registrados este mes todavía.`;
      const ahorro = ingresos - gastos;
      const ratio = Math.round(ahorro / ingresos * 100);
      const emoji = ratio >= 20 ? '🟢' : ratio >= 10 ? '🟡' : ratio >= 0 ? '🟠' : '🔴';
      const label = ratio >= 20 ? 'Excelente' : ratio >= 10 ? 'Aceptable' : ratio >= 0 ? 'Bajo' : 'Negativo';
      return `${emoji} *Tasa de ahorro — ${label}*\n\n💰 Ingresos: ${fmt(ingresos)}\n💸 Gastos: ${fmt(gastos)}\n🐷 Ahorro neto: ${fmt(ahorro)}\n\n📊 Ratio: *${ratio}%*\n_Referencia: 20%+ excelente, 10-20% bueno, <10% a mejorar_`;
    }

    case 'dias_cubre_ahorro': {
      const totalAhorros = (data.savings || []).reduce((s, sv) => s + (sv.current || 0), 0);
      if (!totalAhorros) return `📭 No tenés ahorros registrados todavía.`;
      const { month: cm, year: cy } = currentMonth();
      let totalGastos = 0, meses = 0;
      for (let i = 0; i < 3; i++) {
        const mm = ((cm - i) + 12) % 12;
        const yy = cm - i < 0 ? cy - 1 : cy;
        const g = filterByMonth(data.transactions, mm, yy).filter(t => t.type === 'gasto').reduce((s, t) => s + t.amount, 0);
        if (g > 0) { totalGastos += g; meses++; }
      }
      const avgMensual = meses > 0 ? totalGastos / meses : 0;
      if (!avgMensual) return `📭 No hay suficiente historial para calcular.`;
      const mesesCubre = totalAhorros / avgMensual;
      const diasCubre = Math.round(mesesCubre * 30);
      const emoji = mesesCubre >= 6 ? '🟢' : mesesCubre >= 3 ? '🟡' : '🔴';
      return `${emoji} *Cobertura de ahorros*\n\n🐷 Ahorros totales: ${fmt(totalAhorros)}\n📊 Gasto mensual promedio: ${fmt(Math.round(avgMensual))}\n\n⏳ Tus ahorros cubren *${diasCubre} días* (${mesesCubre.toFixed(1)} meses)\n_Recomendación: tener al menos 3-6 meses de gastos._`;
    }

    case 'top_categorias_ahorro': {
      const { month: cm, year: cy } = currentMonth();
      const txsMes = filterByMonth(data.transactions, cm, cy).filter(t => t.type === 'gasto');
      if (!txsMes.length) return `📭 No hay gastos registrados este mes.`;
      const porCat = {};
      txsMes.forEach(t => { porCat[t.category] = (porCat[t.category] || 0) + t.amount; });
      const top = Object.entries(porCat).sort((a, b) => b[1] - a[1]).slice(0, 5);
      const total = txsMes.reduce((s, t) => s + t.amount, 0);
      return `💡 *Dónde podés recortar*\n\n${top.map(([cat, val], i) => `${i+1}. *${cat}*: ${fmt(val)} (${Math.round(val/total*100)}%)\n   Si reducís 20% → ahorrás ${fmt(Math.round(val*0.2))}/mes`).join('\n\n')}`;
    }

    case 'agregar_suscripcion': {
      let amountARS;
      let usdNote = '';
      if (action.currency === 'usd' && action.amountUSD) {
        const usdAmt = parseFloat(action.amountUSD);
        const dolar = await getDolarPrice();
        const rate = action.source === 'tarjeta' ? (dolar.tarjeta || dolar.blue * 1.6) : dolar.blue;
        amountARS = Math.round(usdAmt * rate);
        usdNote = `\n💱 USD ${usdAmt} × $${Math.round(rate)} (${action.source === 'tarjeta' ? 'tarjeta' : 'blue'}) = ${fmt(amountARS)}`;
      } else {
        amountARS = parseFloat(action.amount) || 0;
      }
      const subName = action.name || 'Suscripción';
      const subKey = subName.toLowerCase();
      // Evitar duplicados — si ya existe una con ese nombre, actualizarla
      const existingSubs = data.suscripciones || [];
      const existingIdx = existingSubs.findIndex(s => s.name.toLowerCase() === subKey);
      if (existingIdx !== -1) {
        const updated = existingSubs.map((s, i) => i === existingIdx ? { ...s, amount: amountARS, active: true, day: parseInt(action.day) || s.day } : s);
        const updatedExpenses = (data.recurringExpenses || []).map(g =>
          g.description?.toLowerCase() === subKey ? { ...g, amount: amountARS, active: true } : g
        );
        const updateTx = {
          id: crypto.randomUUID(),
          type: 'gasto',
          amount: amountARS,
          description: `Suscripción ${subName}`,
          category: action.category || 'Entretenimiento',
          date: today(),
        };
        await saveData(userId, { ...data, suscripciones: updated, recurringExpenses: updatedExpenses, transactions: [...(data.transactions || []), updateTx] });
        return `✅ Suscripción *${subName}* actualizada — ${fmt(amountARS)}/mes.${usdNote}\n💸 Registré el gasto de este mes en tu historial.`;
      }
      const sub = {
        id: crypto.randomUUID(),
        name: subName,
        amount: amountARS,
        day: parseInt(action.day) || 1,
        category: action.category || 'Entretenimiento',
        active: true,
      };
      // Agregar también como gasto fijo si no existe uno igual
      const yaExisteGastoFijo = (data.recurringExpenses || []).some(g =>
        g.description?.toLowerCase() === subKey
      );
      const gastoFijo = !yaExisteGastoFijo ? {
        id: crypto.randomUUID(),
        description: sub.name,
        amount: sub.amount,
        category: sub.category,
        day: sub.day,
        active: true,
      } : null;
      const newData = {
        ...data,
        suscripciones: [...existingSubs, sub],
        recurringExpenses: gastoFijo
          ? [...(data.recurringExpenses || []), gastoFijo]
          : (data.recurringExpenses || []),
      };
      // Registrar gasto del mes actual
      const subTx = {
        id: crypto.randomUUID(),
        type: 'gasto',
        amount: sub.amount,
        description: `Suscripción ${sub.name}`,
        category: sub.category,
        date: today(),
      };
      await saveData(userId, { ...newData, transactions: [...(data.transactions || []), subTx] });
      return `✅ Suscripción *${sub.name}* registrada — ${fmt(sub.amount)}/mes (día ${sub.day}).${usdNote}${gastoFijo ? '\n📌 También la agregué a tus gastos fijos.' : ''}\n💸 Registré el gasto de este mes en tu historial.`;
    }

    case 'consultar_suscripciones': {
      const subs = (data.suscripciones || []).filter(s => s.active);
      if (!subs.length) return `📭 No tenés suscripciones registradas.`;
      const total = subs.reduce((s, sub) => s + sub.amount, 0);
      const anual = total * 12;
      return `📱 *Tus suscripciones*\n\n${subs.map(s => `• *${s.name}*: ${fmt(s.amount)}/mes (día ${s.day})`).join('\n')}\n\n💸 Total mensual: ${fmt(total)}\n📅 Total anual: ${fmt(anual)}`;
    }

    case 'cancelar_suscripcion': {
      const keyword = (action.keyword || '').toLowerCase();
      const cancelada = (data.suscripciones || []).find(s => s.name.toLowerCase().includes(keyword) && s.active);
      if (!cancelada) return `🤔 No encontré ninguna suscripción con ese nombre.`;
      // Desactivar suscripción y eliminar gasto fijo asociado
      const suscripciones = (data.suscripciones || []).map(s =>
        s.name.toLowerCase().includes(keyword) ? { ...s, active: false } : s
      );
      const recurringExpenses = (data.recurringExpenses || []).filter(g =>
        !g.description?.toLowerCase().includes(keyword)
      );
      await saveData(userId, { ...data, suscripciones, recurringExpenses });
      return `🗑️ Suscripción *${cancelada.name}* (${fmt(cancelada.amount)}/mes) cancelada. Te ahorrás ${fmt(cancelada.amount * 12)} por año.`;
    }

    case 'silenciar': {
      const dias = parseInt(action.dias) || 1;
      const hasta = (() => { const d = new Date(today()); d.setDate(d.getDate() + dias); return d.toISOString().slice(0, 10); })();
      await saveData(userId, { ...data, silencedUntil: hasta });
      return `🔕 Listo, no te molesto hasta el *${hasta}*. Cuando quieras que retome escribime "volvé" o "reanudar".`;
    }

    case 'reanudar': {
      await saveData(userId, { ...data, silencedUntil: null });
      return `🔔 ¡Bienvenido/a de vuelta! Las notificaciones y check-ins están activos de nuevo.`;
    }

    case 'calcular_impuesto_pais': {
      const dolar = await getDolarPrice();
      const amountUSD = parseFloat(action.amountUSD) || 1;
      if (!dolar) return `😓 No pude obtener la cotización del dólar ahora.`;
      const oficial = dolar.oficial;
      const conImpuesto = oficial * 1.6; // 60% impuesto PAIS + percepción
      const totalARS = amountUSD * conImpuesto;
      return `🧾 *Precio con Impuesto PAIS*\n\n💵 USD ${amountUSD}\n🏦 Dólar oficial: ${fmt(oficial)}\n📋 Con impuesto PAIS (60%): ${fmt(Math.round(conImpuesto))}\n\n💸 Total en pesos: *${fmt(Math.round(totalARS))}*`;
    }

    case 'equivalencia_canasta': {
      const CANASTA_BASICA = 280000;
      const amount = parseFloat(action.amount) || 0;
      if (!amount) return `🤔 Decime el monto para calcular la equivalencia.`;
      const canastas = amount / CANASTA_BASICA;
      return `🛒 *${fmt(amount)}* equivale a *${canastas.toFixed(2)} canastas básicas*\n_(Canasta básica referencia: ${fmt(CANASTA_BASICA)})_`;
    }

    case 'cambiar_nombre': {
      return `Mi nombre es *Orbe* y así me quedo 😄 ¡Es parte de mi identidad! ¿En qué te puedo ayudar?`;
    }

    case 'onboarding': {
      await saveData(userId, { ...data, onboardingDone: true });
      return `👋 *¡Configuremos todo juntos!*\n\nTe hago 5 preguntas para dejarte todo listo:\n\n*1.* ¿Cuánto ganás por mes (sueldo aproximado)?\n\nRespondé con el monto y seguimos con el resto 🚀`;
    }

    case 'limpiar_transacciones': {
      const scope = action.scope || 'mes';
      const { month: cm, year: cy } = currentMonth();
      const count = scope === 'todo'
        ? data.transactions.length
        : filterByMonth(data.transactions, cm, cy).length;
      if (count === 0) return `📭 No hay transacciones${scope === 'mes' ? ' este mes' : ''} para borrar.`;
      // Guardar pending para confirmar
      await savePendingSuggestion(phone, JSON.stringify({ type: 'confirm_limpiar', scope }));
      const scopeLabel = scope === 'todo' ? 'de todos los meses' : 'de este mes';
      return `⚠️ Estás por borrar *${count} transacciones* ${scopeLabel}. Esta acción no se puede deshacer.\n\nRespondé *CONFIRMAR* para proceder, o cualquier otra cosa para cancelar.`;
    }

    case 'proyectar_fin_de_mes': {
      const { month: cm, year: cy } = currentMonth();
      const daysInMonth = new Date(cy, cm + 1, 0).getDate();
      const dayOfMonth = arDay();
      const daysLeft = daysInMonth - dayOfMonth;
      const { ingresos, gastos } = monthlyTotals(data.transactions, cm, cy);
      const balance = ingresos - gastos;
      const avgDailySpend = dayOfMonth > 0 ? gastos / dayOfMonth : 0;
      const proyectedGastos = gastos + (avgDailySpend * daysLeft);
      const proyectedBalance = ingresos - proyectedGastos;
      const gastosFijosRestantes = (data.recurringExpenses || []).filter(g => g.active && g.day > dayOfMonth).reduce((s, g) => s + g.amount, 0);
      const balanceRealProyectado = balance - gastosFijosRestantes;
      const emoji = balanceRealProyectado >= 0 ? '🟢' : '🔴';
      return `${emoji} *Proyección de fin de mes*\n\n📅 Quedan ${daysLeft} días del mes\n💸 Promedio diario de gasto: ${fmt(Math.round(avgDailySpend))}\n📈 Gastos proyectados al ${daysInMonth}: ${fmt(Math.round(proyectedGastos))}\n\n💰 Balance actual: ${fmt(balance)}\n🔧 Gastos fijos que restan: ${fmt(gastosFijosRestantes)}\n${emoji} Balance proyectado: ${fmt(Math.round(balanceRealProyectado))}`;
    }

    case 'resumen_mes': {
      const targetMonth = (parseInt(action.month) - 1 + 12) % 12;
      const targetYear = parseInt(action.year) || currentMonth().year;
      const { txs, ingresos, gastos } = monthlyTotals(data.transactions, targetMonth, targetYear);
      if (!txs.length) return `📭 No hay transacciones registradas en ${MONTH_NAMES[targetMonth]} ${targetYear}.`;
      const balance = ingresos - gastos;
      const porCat = {};
      txs.filter(t => t.type === 'gasto').forEach(t => { porCat[t.category] = (porCat[t.category] || 0) + t.amount; });
      const topCats = Object.entries(porCat).sort((a, b) => b[1] - a[1]).slice(0, 4);
      const emoji = balance >= 0 ? '✅' : '🔴';
      return `📅 *${MONTH_NAMES[targetMonth]} ${targetYear}*\n\n💰 Ingresos: ${fmt(ingresos)}\n💸 Gastos: ${fmt(gastos)}\n${emoji} Balance: ${fmt(balance)}\n\n📊 *Top categorías:*\n${topCats.map(([c, v]) => `• ${c}: ${fmt(v)} (${Math.round(v/gastos*100)}%)`).join('\n')}`;
    }

    case 'comparar_meses': {
      const m1 = (parseInt(action.month1) - 1 + 12) % 12;
      const y1 = parseInt(action.year1) || currentMonth().year;
      const m2 = (parseInt(action.month2) - 1 + 12) % 12;
      const y2 = parseInt(action.year2) || currentMonth().year;
      const { ingresos: ing1, gastos: gst1 } = monthlyTotals(data.transactions, m1, y1);
      const { ingresos: ing2, gastos: gst2 } = monthlyTotals(data.transactions, m2, y2);
      const diffGst = gst2 - gst1;
      const diffIng = ing2 - ing1;
      const arrow = (n) => n > 0 ? `↑ ${fmt(Math.abs(n))} más` : n < 0 ? `↓ ${fmt(Math.abs(n))} menos` : 'igual';
      return `📊 *${MONTH_NAMES[m1]} vs ${MONTH_NAMES[m2]}*\n\n💰 Ingresos: ${fmt(ing1)} → ${fmt(ing2)} (${arrow(diffIng)})\n💸 Gastos: ${fmt(gst1)} → ${fmt(gst2)} (${arrow(diffGst)})\n✅ Balance: ${fmt(ing1-gst1)} → ${fmt(ing2-gst2)}`;
    }

    case 'analisis_historico': {
      const porMes = {};
      data.transactions.forEach(t => {
        const p = parseDateParts(t.date);
        const key = `${p.year}-${String(p.month+1).padStart(2,'0')}`;
        if (!porMes[key]) porMes[key] = { ingresos: 0, gastos: 0, month: p.month, year: p.year };
        if (t.type === 'gasto') porMes[key].gastos += t.amount;
        else porMes[key].ingresos += t.amount;
      });
      const meses = Object.entries(porMes).sort((a, b) => a[0].localeCompare(b[0]));
      if (!meses.length) return `📭 No hay historial de transacciones todavía.`;
      const peorMes = meses.reduce((max, m) => m[1].gastos > max[1].gastos ? m : max, meses[0]);
      const mejorMes = meses.reduce((min, m) => (m[1].ingresos - m[1].gastos) > (min[1].ingresos - min[1].gastos) ? m : min, meses[0]);
      const resumen = meses.slice(-6).map(([, v]) => `${MONTH_NAMES[v.month]} ${v.year}: ${fmt(v.ingresos - v.gastos)}`).join('\n');
      return `📈 *Análisis histórico*\n\n📅 Meses con datos: ${meses.length}\n💸 Mes con más gastos: *${MONTH_NAMES[peorMes[1].month]} ${peorMes[1].year}* (${fmt(peorMes[1].gastos)})\n🏆 Mejor balance: *${MONTH_NAMES[mejorMes[1].month]} ${mejorMes[1].year}* (${fmt(mejorMes[1].ingresos - mejorMes[1].gastos)})\n\n*Últimos 6 meses:*\n${resumen}`;
    }

    case 'configurar_alerta_balance': {
      const amount = parseFloat(action.amount) || 0;
      await saveData(userId, { ...data, balanceAlert: amount });
      if (amount === 0) return `🔕 Alerta de balance desactivada.`;
      return `🔔 Listo! Te aviso cuando tu balance baje de *${fmt(amount)}*.`;
    }

    case 'agregar_categoria': {
      const catName = action.name || '';
      const catIcon = action.icon || '📦';
      if (!catName) return `🤔 ¿Cómo querés llamar a la categoría?`;
      const cats = { ...(data.categories || {}), [catName]: catIcon };
      const budgets = [...(data.budgets || [])];
      if (!budgets.find(b => b.cat === catName)) budgets.push({ cat: catName, limit: 0 });
      await saveData(userId, { ...data, categories: cats, budgets });
      return `✅ Categoría *${catIcon} ${catName}* agregada. Ya podés usarla al registrar gastos.`;
    }

    case 'agregar_recordatorio': {
      const reminder = {
        id: crypto.randomUUID(),
        description: action.description || 'Recordatorio',
        date: action.date || today(),
        notified: false,
      };
      const reminders = [...(data.reminders || []), reminder];
      await saveData(userId, { ...data, reminders });
      return `🔔 Recordatorio guardado: *"${reminder.description}"* para el *${reminder.date}*. Te aviso ese día a la mañana.`;
    }

    case 'gasto_compartido': {
      const mitad = parseFloat(action.amount) / 2;
      const tx = {
        id: crypto.randomUUID(),
        type: 'gasto',
        description: `${action.description || 'Gasto'} (compartido con ${action.sharedWith || 'otra persona'})`,
        amount: mitad,
        category: action.category || 'Otros',
        date: action.date || today(),
        savingsId: '',
        note: `Gasto total: ${fmt(parseFloat(action.amount))}. Tu parte: ${fmt(mitad)}.`,
      };
      await saveData(userId, { ...data, transactions: [...data.transactions, tx] });
      return `💸 *Gasto compartido registrado*\n\n📝 ${action.description}\n👥 Total: ${fmt(parseFloat(action.amount))} — tu parte: *${fmt(mitad)}*\n📂 ${tx.category}`;
    }

    case 'actualizar_presupuesto': {
      const budgets = data.budgets.map(b =>
        b.cat.toLowerCase() === action.category.toLowerCase()
          ? { ...b, limit: parseFloat(action.limit) }
          : b
      );
      const exists = data.budgets.some(b => b.cat.toLowerCase() === action.category.toLowerCase());
      if (!exists) budgets.push({ cat: action.category, limit: parseFloat(action.limit) });
      await saveData(userId, { ...data, budgets });
      return `🎯 *Presupuesto actualizado!*\n\n📦 ${action.category}: ${fmt(action.limit)} por mes`;
    }

    case 'consultar_presupuesto_categoria': {
      const txs = filterByMonth(data.transactions, month, year)
        .filter(t => t.type === 'gasto' && t.category.toLowerCase() === action.category.toLowerCase());
      const spent = txs.reduce((a, t) => a + t.amount, 0);
      const budget = data.budgets.find(b => b.cat.toLowerCase() === action.category.toLowerCase());
      if (!budget || !budget.limit) return `📭 No tenés presupuesto configurado para *${action.category}*.\n\n¿Querés que te agregue uno? Decime el monto.`;
      const pct = Math.round((spent / budget.limit) * 100);
      return `${pct >= 100 ? '🔴' : pct >= 80 ? '🟡' : '🟢'} *Presupuesto ${action.category}*\n\n💸 Gastado: ${fmt(spent)}\n🎯 Límite: ${fmt(budget.limit)}\n📊 Uso: ${pct}%\n💰 Disponible: ${fmt(Math.max(0, budget.limit - spent))}`;
    }

    case 'consultar_balance': {
      const { txs, ingresos, gastos } = monthlyTotals(data.transactions, month, year);
      const gastosFijos = (data.recurringExpenses || []).filter(g => g.active).reduce((a, g) => a + g.amount, 0);
      const ingFijosNoRecibidos = (data.recurringIncomes || []).filter(r => r.active).reduce((a, r) => {
        const yaRecibido = txs.some(t => (t.type === 'ingreso' || t.type === 'sueldo') && t.description?.toLowerCase().includes(r.name.toLowerCase()));
        return yaRecibido ? a : a + r.amount;
      }, 0);
      const balance = ingresos - gastos;
      const proyectado = balance - gastosFijos + ingFijosNoRecibidos;
      const pctGastado = ingresos > 0 ? (gastos / ingresos) * 100 : 0;
      const tempEmoji = pctGastado < 60 ? '🟢 Excelente' : pctGastado < 80 ? '🟡 Cuidado' : pctGastado < 100 ? '🟠 En riesgo' : '🔴 En rojo';
      const balanceMsg = balance >= 0
        ? ['Vas muy bien por ahora!', 'Todo en orden por el momento.', 'Buen ritmo este mes!'][Math.floor(Math.random() * 3)]
        : ['Estás un poco ajustado este mes, ojo.', 'El mes está apretado, pero se puede revertir.', 'Cuidado con los gastos, el balance está en rojo.'][Math.floor(Math.random() * 3)];
      let resp = `📊 *Balance de ${MONTH_NAMES[month]}${name ? ', ' + name : ''}*\n\n💰 Ingresos: ${fmt(ingresos)}\n💸 Gastos registrados: ${fmt(gastos)}\n${balance >= 0 ? '✅' : '⚠️'} Disponible ahora: ${fmtSigned(balance)}`;
      if (gastosFijos > 0) resp += `\n🔄 Gastos fijos pendientes: ${fmt(gastosFijos)}`;
      if (ingFijosNoRecibidos > 0) resp += `\n💵 Ingresos esperados: ${fmt(ingFijosNoRecibidos)}`;
      if (gastosFijos > 0 || ingFijosNoRecibidos > 0) resp += `\n📅 Estimado fin de mes: ${fmtSigned(proyectado)}`;
      resp += `\n🌡️ Temperatura: ${tempEmoji}`;
      resp += `\n\n${balanceMsg}`;
      return resp;
    }

    case 'ultimas_transacciones': {
      const txs = filterByMonth(data.transactions, month, year).slice(-5).reverse();
      if (!txs.length) return `📭 No hay transacciones este mes todavía${name ? ', ' + name : ''}. ¡Empezá registrando algo!`;
      return `🕐 *Últimas transacciones*\n\n${txs.map(t => `${t.type === 'gasto' ? '💸' : '💰'} ${t.description} — ${fmt(t.amount)} (${t.date})`).join('\n')}`;
    }

    case 'consultar_presupuesto': {
      const txs = filterByMonth(data.transactions, month, year).filter(t => t.type === 'gasto');
      const expByCat = txs.reduce((acc, t) => { acc[t.category] = (acc[t.category] || 0) + t.amount; return acc; }, {});
      const cats = data.categories || {};
      const lines = data.budgets.filter(b => b.limit > 0).map(b => {
        const spent = expByCat[b.cat] || 0;
        const pct = Math.round((spent / b.limit) * 100);
        return `${pct >= 100 ? '🔴' : pct >= 80 ? '🟡' : '🟢'} ${cats[b.cat] || '📦'} ${b.cat}: ${fmt(spent)} / ${fmt(b.limit)} (${pct}%)`;
      });
      if (!lines.length) return `📭 No tenés presupuestos configurados${name ? ', ' + name : ''}.\n\nPodés agregar uno: *"agregá $5000 de presupuesto en Ropa"*`;
      return `🎯 *Presupuesto ${MONTH_NAMES[month]}*\n\n${lines.join('\n')}`;
    }

    case 'consultar_ahorros': {
      if (!data.savings.length) return `🐷 No tenés metas de ahorro todavía${name ? ', ' + name : ''}.\n\n¿Querés crear una? Decime para qué y cuánto.`;
      return `🐷 *Tus ahorros*\n\n${data.savings.map(sv => `🐷 *${sv.name}*: ${fmt(sv.current)} / ${fmt(sv.target)} (${Math.round((sv.current / sv.target) * 100)}%)`).join('\n')}`;
    }

    case 'consultar_deudas': {
      if (!data.debts.length) return `✅ No tenés deudas registradas${name ? ', ' + name : ''}. ¡Excelente!`;
      const total = data.debts.reduce((s, d) => s + d.remaining, 0);
      const arRef = arNow();
      const lines = data.debts.map(d => {
        let line = `💳 *${d.name}*: ${fmt(d.remaining)}`;
        if (d.installment > 0) {
          const mesesLeft = Math.ceil(d.remaining / d.installment);
          const finDate = new Date(arRef.getFullYear(), arRef.getMonth() + mesesLeft, 1);
          const finStr = `${MONTH_NAMES[finDate.getMonth()]} ${finDate.getFullYear()}`;
          line += ` · cuota ${fmt(d.installment)} · termina ${finStr}`;
        }
        return line;
      });
      return `💳 *Tus deudas*\n\n${lines.join('\n')}\n\n📊 Total: ${fmt(total)}`;
    }

    case 'consultar_fin_deudas': {
      if (!data.debts.length) return `✅ No tenés deudas registradas. ¡Excelente!`;
      const arRef = arNow();
      const lines = data.debts.map(d => {
        if (d.installment <= 0) return `📋 *${d.name}*: sin cuota definida (${fmt(d.remaining)} pendiente)`;
        const mesesLeft = Math.ceil(d.remaining / d.installment);
        const finDate = new Date(arRef.getFullYear(), arRef.getMonth() + mesesLeft, 1);
        const finStr = `${MONTH_NAMES[finDate.getMonth()]} ${finDate.getFullYear()}`;
        return `📋 *${d.name}*: terminás en ${finStr} (${mesesLeft} cuota${mesesLeft !== 1 ? 's' : ''} de ${fmt(d.installment)})`;
      });
      return `🗓️ *Cuándo terminás de pagar*\n\n${lines.join('\n')}\n\n_Calculado en base al saldo actual y cuota mensual._`;
    }

    case 'consultar_vencimientos': {
      const todayDay = arDay();
      const upcoming = (data.events || []).filter(ev => ev.day >= todayDay).sort((a, b) => a.day - b.day).slice(0, 10);
      if (!upcoming.length) return `✅ No hay vencimientos próximos este mes${name ? ', ' + name : ''}. ¡Todo tranquilo!`;
      return `⚠️ *Vencimientos del mes*\n\n${upcoming.map(ev => { const d = ev.day - todayDay; return `${d === 0 ? '🔴 HOY' : d <= 3 ? `🟡 en ${d} días` : `📅 día ${ev.day}`} — ${ev.title}`; }).join('\n')}`;
    }

    case 'consultar_eventos': {
      const evs = data.events || [];
      if (!evs.length) return `📅 No tenés eventos registrados${name ? ', ' + name : ''}.`;
      const todayDay = arDay();
      const sorted = [...evs].sort((a, b) => a.day - b.day);
      return `📅 *Tus eventos*\n\n${sorted.map(ev => {
        const d = ev.day - todayDay;
        const tag = d < 0 ? `día ${ev.day}` : d === 0 ? '🔴 HOY' : d <= 3 ? `🟡 en ${d} días` : `📅 día ${ev.day}`;
        return `${tag} — ${ev.title}`;
      }).join('\n')}`;
    }

    case 'agregar_evento': {
      const ev = { id: crypto.randomUUID(), title: action.title, day: parseInt(action.day), type: action.eventType || 'recordatorio', notifyDaysBefore: action.notify ? 3 : 0 };
      await saveData(userId, { ...data, events: [...(data.events || []), ev] });
      return `📅 *Evento agregado!*\n\n📝 ${ev.title}\n📆 Día ${ev.day} de cada mes${action.notify ? '\n🔔 Te aviso 3 días antes.' : ''}`;
    }

    case 'eliminar_evento': {
      const before = (data.events || []).length;
      const events = (data.events || []).filter(e => !e.title.toLowerCase().includes(action.keyword.toLowerCase()));
      await saveData(userId, { ...data, events });
      if (events.length === before) return `🤔 No encontré ningún evento con ese nombre. ¿Cómo se llamaba exactamente?`;
      return `🗑️ Listo, eliminé el evento correctamente.`;
    }

    case 'agregar_prestamo': {
      const loans = data.loans || [];
      const credits = { ...(data.credits || {}) };
      const personKey = action.name.toLowerCase();
      let usdLoanNote = '';
      let amountARS;
      if (action.currency === 'usd' && action.amountUSD) {
        const dolar = await getDolarPrice();
        const rate = action.source === 'tarjeta' ? (dolar.tarjeta || dolar.blue * 1.6) : dolar.blue;
        amountARS = Math.round(parseFloat(action.amountUSD) * rate);
        usdLoanNote = `\n💱 USD ${action.amountUSD} × $${Math.round(rate)} = ${fmt(amountARS)}`;
      } else {
        amountARS = parseFloat(action.amount) || 0;
      }
      let remaining = amountARS;
      let creditNote = '';

      // Descontar saldo a favor existente
      if (credits[personKey] && credits[personKey].amount > 0) {
        const credito = credits[personKey].amount;
        if (credito >= remaining) {
          credits[personKey].amount -= remaining;
          await saveData(userId, { ...data, loans, credits });
          return `ℹ️ *${action.name}* tiene un saldo a favor de ${fmt(credito)}. Este nuevo pedido (${fmt(remaining)}) queda cubierto. Le queda un saldo a favor de ${fmt(credito - remaining)}.`;
        } else {
          remaining -= credito;
          credits[personKey].amount = 0;
          creditNote = `\n_⚡ Se descontó un saldo a favor de ${fmt(credito)} que tenía._`;
        }
      }

      const loanId = crypto.randomUUID();
      const loan = { id: loanId, name: action.name, reason: action.reason || '', amount: remaining, remaining, payments: [], loanType: 'prestamo', createdAt: today(), ...(action.currency === 'usd' ? { currency: 'usd', amountUSD: parseFloat(action.amountUSD) } : {}) };
      // Registrar como gasto para que impacte en el balance
      const loanTx = {
        id: crypto.randomUUID(),
        type: 'gasto',
        amount: remaining,
        description: `Préstamo a ${action.name}${action.reason ? ` — ${action.reason}` : ''}`,
        category: 'Préstamos',
        date: today(),
        loanId,
      };
      await saveData(userId, { ...data, loans: [...loans, loan], credits, transactions: [...(data.transactions || []), loanTx] });
      return `📋 *Préstamo registrado!*\n\n👤 ${action.name} te debe ${fmt(remaining)}${action.reason ? `\n📝 Por: ${action.reason}` : ''}\n📅 ${today()}${usdLoanNote}${creditNote}\n💸 Desconté ${fmt(remaining)} de tu balance.\n\nCuando pague algo, avisame y lo registro.`;
    }

    case 'agregar_fiado': {
      const loans = data.loans || [];
      const credits = { ...(data.credits || {}) };
      const personKey = action.name.toLowerCase();
      let usdNote = '';
      let amountARS;
      if (action.currency === 'usd' && action.amountUSD) {
        const dolar = await getDolarPrice();
        const rate = dolar.blue;
        amountARS = Math.round(parseFloat(action.amountUSD) * rate);
        usdNote = `\n💱 USD ${action.amountUSD} × $${Math.round(rate)} = ${fmt(amountARS)}`;
      } else {
        amountARS = parseFloat(action.amount) || 0;
      }

      // Descontar saldo a favor existente
      let remaining = amountARS;
      let creditNote = '';
      if (credits[personKey] && credits[personKey].amount > 0) {
        const credito = credits[personKey].amount;
        if (credito >= remaining) {
          credits[personKey].amount -= remaining;
          await saveData(userId, { ...data, loans, credits });
          return `ℹ️ *${action.name}* tiene un saldo a favor de ${fmt(credito)}. Este fiado (${fmt(remaining)}) queda cubierto con ese saldo.`;
        } else {
          remaining -= credito;
          credits[personKey].amount = 0;
          creditNote = `\n_⚡ Se descontó un saldo a favor de ${fmt(credito)} que tenía._`;
        }
      }

      const loan = { id: crypto.randomUUID(), name: action.name, reason: action.reason || '', amount: remaining, remaining, payments: [], loanType: 'fiado', createdAt: today(), ...(action.currency === 'usd' ? { currency: 'usd', amountUSD: parseFloat(action.amountUSD) } : {}) };
      // Fiado NO crea transacción — no sale plata del balance
      await saveData(userId, { ...data, loans: [...loans, loan], credits });
      return `🤝 *Fiado registrado!*\n\n👤 ${action.name} te debe ${fmt(remaining)}${action.reason ? `\n📝 Por: ${action.reason}` : ''}\n📅 ${today()}${usdNote}${creditNote}\n_No se descontó del balance — fue mercadería/servicio._\n\nCuando pague, avisame y lo registro.`;
    }

    case 'registrar_pago_prestamo': {
      const loans = [...(data.loans || [])];
      const key = action.name.toLowerCase();

      // Verificar que exista algún préstamo activo (remaining > 0) para esa persona
      const tieneActivo = loans.some(l => l.name.toLowerCase().includes(key) && l.remaining > 0);
      if (!loans.some(l => l.name.toLowerCase().includes(key))) {
        return `🤔 No encontré ningún préstamo a nombre de *${action.name}*. ¿Cómo se llama exactamente?`;
      }
      if (!tieneActivo) {
        return `✅ ${action.name} ya no tiene deudas pendientes con vos.`;
      }

      // Aplicar el pago distribuido entre los préstamos activos (FIFO)
      let restante = parseFloat(action.amount);
      let totalAntes = 0;
      for (let i = 0; i < loans.length; i++) {
        if (!loans[i].name.toLowerCase().includes(key)) continue;
        if (loans[i].remaining <= 0) continue;
        totalAntes += loans[i].remaining;
        const aplicar = Math.min(loans[i].remaining, restante);
        loans[i] = {
          ...loans[i],
          remaining: loans[i].remaining - aplicar,
          payments: [...(loans[i].payments || []), { date: today(), amount: aplicar }],
        };
        restante -= aplicar;
        if (restante <= 0) break;
      }

      const totalDespues = loans
        .filter(l => l.name.toLowerCase().includes(key))
        .reduce((s, l) => s + l.remaining, 0);

      // Si pagó de más, registrar saldo a favor
      const credits = { ...(data.credits || {}) };
      const personKey = action.name.toLowerCase();
      if (restante > 0) {
        credits[personKey] = { name: action.name, amount: (credits[personKey]?.amount || 0) + restante };
      }

      const pagado = parseFloat(action.amount) - Math.max(restante, 0);
      // Registrar el cobro como ingreso para que impacte en el balance
      const pagoTx = {
        id: crypto.randomUUID(),
        type: 'ingreso',
        amount: pagado,
        description: `Cobro préstamo — ${action.name}`,
        category: 'Préstamos',
        date: today(),
      };
      await saveData(userId, { ...data, loans, credits, transactions: [...(data.transactions || []), pagoTx] });

      if (totalDespues === 0 && restante > 0) {
        return `🎉 *${action.name} saldó todo!*\n\nPagó ${fmt(parseFloat(action.amount))}, quedó en cero y tiene un *saldo a favor de ${fmt(restante)}*. Se sumó ${fmt(pagado)} a tu balance.`;
      }
      if (totalDespues === 0) {
        return `🎉 *${action.name} saldó todo!*\n\nPagó ${fmt(parseFloat(action.amount))} y quedó en cero. Se sumó ${fmt(pagado)} a tu balance.`;
      }
      return `💵 *Pago registrado!*\n\n👤 ${action.name} pagó ${fmt(parseFloat(action.amount))}\n💰 Le queda pendiente: ${fmt(totalDespues)}\n✅ Se sumó ${fmt(pagado)} a tu balance.`;
    }

    case 'consultar_prestamo': {
      const loans = data.loans || [];
      const key = action.name.toLowerCase();
      const matching = loans.filter(l => l.name.toLowerCase().includes(key));
      if (!matching.length) return `🤔 No encontré ningún préstamo a nombre de *${action.name}*.`;

      const activos   = matching.filter(l => l.remaining > 0);
      const totalRest = activos.reduce((s, l) => s + l.remaining, 0);
      const totalOrig = matching.reduce((s, l) => s + (l.amount || l.remaining), 0);
      const pagadoTotal = matching.reduce((s, l) => s + (l.amount || 0) - l.remaining, 0);
      const todosLosPagos = matching.flatMap(l => l.payments || []).sort((a, b) => a.date.localeCompare(b.date));

      if (totalRest === 0) return `✅ *${matching[0].name}* ya no te debe nada. Saldó todo.`;

      let resp = `📋 *Deuda de ${matching[0].name}*\n\n`;
      if (activos.length > 1) {
        resp += activos.map(l => `• ${l.reason || (l.loanType === 'fiado' ? 'Fiado' : 'Préstamo')}: ${fmtLoan(l)}`).join('\n') + '\n';
        resp += `\n💰 Total pendiente: ${fmt(totalRest)}\n`;
      } else {
        resp += `💰 Original: ${fmtLoan(activos[0])}\n💸 Pagado: ${fmt(pagadoTotal)}\n⏳ Queda: ${fmtLoan(activos[0])}\n`;
        if (activos[0]?.reason) resp += `📝 Por: ${activos[0].reason}\n`;
        if (activos[0]?.loanType) resp += `📌 Tipo: ${activos[0].loanType === 'fiado' ? 'Fiado' : 'Préstamo'}\n`;
      }
      if (todosLosPagos.length > 0) {
        resp += `\n📜 *Historial de pagos:*\n${todosLosPagos.map(p => `• ${p.date}: ${fmt(p.amount)}`).join('\n')}`;
      } else {
        resp += `\n📭 Todavía no hizo ningún pago.`;
      }
      return resp;
    }

    case 'consultar_todos_prestamos': {
      const loans = data.loans || [];

      // Agrupar por persona y sumar sólo los registros con remaining > 0
      const porPersona = {};
      for (const loan of loans) {
        if (loan.remaining <= 0) continue;
        const key = loan.name.toLowerCase();
        if (!porPersona[key]) porPersona[key] = { name: loan.name, total: 0, items: [], loans: [] };
        porPersona[key].total += loan.remaining;
        porPersona[key].loans.push(loan);
        if (loan.reason) porPersona[key].items.push(loan.reason);
      }

      const activos = Object.values(porPersona);
      const creditEntries = Object.values(data.credits || {}).filter(c => c.amount > 0);
      if (!activos.length && !creditEntries.length) return `📭 No tenés préstamos pendientes${name ? ', ' + name : ''}. ¡Todo al día!`;

      const totalGlobal = activos.reduce((s, p) => s + p.total, 0);
      const lineas = activos.map(p => {
        // Si todos sus loans son en la misma moneda USD, mostrarlo
        const usdLoans = p.loans.filter(l => l.currency === 'usd');
        const totalUSD = usdLoans.reduce((s, l) => s + (l.amountUSD || 0), 0);
        const montoStr = usdLoans.length === p.loans.length && totalUSD > 0
          ? `${fmtUSD(totalUSD)} (≈ ${fmt(p.total)})`
          : fmt(p.total);
        const detalle = p.items.length > 0 ? ` — ${p.items.join(', ')}` : '';
        return `👤 *${p.name}*: ${montoStr}${detalle}`;
      });
      let resp = `📋 *Préstamos pendientes*\n\n`;
      if (activos.length) resp += lineas.join('\n') + `\n\n💰 Total que te deben: ${fmt(totalGlobal)}`;
      if (creditEntries.length) {
        resp += `\n\n💳 *Saldos a favor (ellos pagaron de más):*\n`;
        resp += creditEntries.map(c => `👤 *${c.name}*: ${fmt(c.amount)} a favor`).join('\n');
      }
      return resp;
    }

    case 'renombrar_prestamo': {
      const loans = [...(data.loans || [])];
      const keyword = (action.oldName || '').toLowerCase();
      const matching = loans.filter(l => l.name.toLowerCase().includes(keyword));
      if (!matching.length) return `🤔 No encontré ningún préstamo con el nombre *${action.oldName}*. ¿Cómo se llama exactamente?`;
      const newName = action.newName;
      const updated = loans.map(l => l.name.toLowerCase().includes(keyword) ? { ...l, name: newName } : l);
      // También actualizar credits si existe
      const credits = { ...(data.credits || {}) };
      if (credits[keyword]) {
        credits[newName.toLowerCase()] = { ...credits[keyword], name: newName };
        delete credits[keyword];
      }
      await saveData(userId, { ...data, loans: updated, credits });
      return `✅ Listo, cambié el nombre de *${matching[0].name}* a *${newName}* en todos los préstamos.`;
    }

    case 'consolidar_prestamos': {
      const loans = data.loans || [];
      const keyword = (action.name || '').toLowerCase();
      const matching = loans.filter(l => l.name.toLowerCase().includes(keyword));
      if (matching.length === 0) return `🤔 No encontré ningún préstamo a nombre de *${action.name}*.`;
      if (matching.length === 1) return `ℹ️ ${action.name} solo tiene un préstamo registrado (${fmt(matching[0].remaining)}), no hay nada que consolidar.`;

      const totalRemaining = matching.reduce((s, l) => s + l.remaining, 0);
      const totalOriginal  = matching.reduce((s, l) => s + (l.amount || l.remaining), 0);
      const reasons = matching.map(l => l.reason).filter(Boolean).join(', ');
      const consolidated = {
        id: crypto.randomUUID(),
        name: matching[0].name,
        reason: reasons || '',
        amount: totalOriginal,
        remaining: totalRemaining,
        payments: matching.flatMap(l => l.payments || []),
        createdAt: matching[0].createdAt || today(),
      };
      const otherLoans = loans.filter(l => !l.name.toLowerCase().includes(keyword));
      await saveData(userId, { ...data, loans: [...otherLoans, consolidated] });
      return `✅ Listo, consolidé todos los préstamos de *${matching[0].name}*.\n\n📋 Total que te debe: ${fmt(totalRemaining)}${reasons ? `\n📝 Conceptos: ${reasons}` : ''}\n\nAhora es un solo registro, más fácil de seguir.`;
    }

    case 'agregar_ahorro': {
      const savings = data.savings || [];
      const isUSD = action.currency === 'usd';
      let arsRate = null;
      if (isUSD) {
        const dolar = await getDolarPrice();
        arsRate = dolar.blue;
      }
      const sv = {
        id: crypto.randomUUID(),
        name: action.name,
        target: parseFloat(action.target || action.targetUSD || 0),
        current: parseFloat(action.current || action.currentUSD || 0),
        currency: isUSD ? 'usd' : 'ars',
        arsRate,
        history: [],
      };
      await saveData(userId, { ...data, savings: [...savings, sv] });
      if (isUSD) {
        return `🐷 *Meta de ahorro en dólares creada!*\n\n📝 ${sv.name}\n🎯 Objetivo: ${fmtUSD(sv.target)} (≈ ${fmt(Math.round(sv.target * arsRate))})\n${sv.current > 0 ? `💰 Ya tenés: ${fmtUSD(sv.current)} (≈ ${fmt(Math.round(sv.current * arsRate))})\n` : ''}\nCuando quieras depositar, decime: *"depositá X dólares en ${sv.name}"*`;
      }
      return `🐷 *Meta de ahorro creada!*\n\n📝 ${sv.name}\n🎯 Objetivo: ${fmt(sv.target)}${sv.current > 0 ? `\n💰 Ya tenés: ${fmt(sv.current)}` : ''}\n\nCuando quieras depositar, decime: *"depositá $X en ${sv.name}"*`;
    }

    case 'depositar_ahorro': {
      const savings = data.savings || [];
      const idx = savings.findIndex(sv => sv.name.toLowerCase().includes(action.keyword.toLowerCase()));
      if (idx === -1) return `🤔 No encontré ninguna meta de ahorro que coincida con *${action.keyword}*. ¿Cómo se llama exactamente?`;
      const sv = { ...savings[idx] };
      const monto = parseFloat(action.amount);
      const isUSD = sv.currency === 'usd';

      if (isUSD) {
        const dolar = await getDolarPrice();
        sv.arsRate = dolar.blue;
        sv.current = (sv.current || 0) + monto;
        sv.history = [...(sv.history || []), { date: today(), amount: monto, arsRate: dolar.blue }];
        savings[idx] = sv;
        const pct = Math.round((sv.current / sv.target) * 100);
        await saveData(userId, { ...data, savings });
        if (sv.current >= sv.target) return `🎉 *¡Meta cumplida!*\n\n🐷 ${sv.name}: ${fmtUSD(sv.current)} / ${fmtUSD(sv.target)} (100%)\n\n¡Llegaste a tu objetivo!`;
        const falta = parseFloat((sv.target - sv.current).toFixed(2));
        return `🐷 *Depósito registrado!*\n\n📝 ${sv.name}\n💵 Depositaste: ${fmtUSD(monto)} (≈ ${fmt(Math.round(monto * dolar.blue))})\n📊 Acumulado: ${fmtUSD(sv.current)} / ${fmtUSD(sv.target)} (${pct}%)\n≈ ${fmt(Math.round(sv.current * dolar.blue))} ARS al blue de hoy\n${pct >= 80 ? '¡Ya casi llegás! 🔥' : `Falta ${fmtUSD(falta)} para la meta.`}`;
      }

      sv.current = (sv.current || 0) + monto;
      sv.history = [...(sv.history || []), { date: today(), amount: monto }];
      savings[idx] = sv;
      const pct = Math.round((sv.current / sv.target) * 100);
      const tx = { id: crypto.randomUUID(), type: 'ahorro_meta', description: `Ahorro: ${sv.name}`, amount: monto, category: 'Ahorro', date: today(), savingsId: sv.id };
      await saveData(userId, { ...data, savings, transactions: [...data.transactions, tx] });
      if (sv.current >= sv.target) return `🎉 *¡Meta cumplida!*\n\n🐷 ${sv.name}: ${fmt(sv.current)} / ${fmt(sv.target)} (100%)\n\n¡Llegaste a tu objetivo! ¿Querés crear una nueva meta?`;
      const baseMsg = `🐷 *Depósito registrado!*\n\n📝 ${sv.name}\n💰 Depositaste: ${fmt(monto)}\n📊 Acumulado: ${fmt(sv.current)} / ${fmt(sv.target)} (${pct}%)\n${pct >= 80 ? '¡Ya casi llegás! 🔥' : `Falta ${fmt(sv.target - sv.current)} para la meta.`}`;
      return `${baseMsg}\n\n💬 ¿De dónde salió esa plata? ¿Del sueldo o fue un extra?`;
    }

    case 'agregar_deuda': {
      const debts = data.debts || [];
      const installment = parseFloat(action.installment || 0);
      const remaining = parseFloat(action.remaining);
      const ri = installment > 0 ? Math.ceil(remaining / installment) : 0;
      const deuda = {
        id: crypto.randomUUID(),
        name: action.name,
        total: remaining,
        remaining,
        installment,
        remainingInstallments: ri,
      };
      await saveData(userId, { ...data, debts: [...debts, deuda] });
      return `💳 *Deuda registrada!*\n\n📝 ${deuda.name}\n💸 Monto: ${fmt(remaining)}${installment > 0 ? `\n📆 Cuota mensual: ${fmt(installment)}\n🗓️ Cuotas estimadas: ${ri}` : ''}\n\nCuando hagas un pago, avisame y lo descuento del total.`;
    }

    case 'borrar_deuda': {
      const debts = data.debts || [];
      const idx = debts.findIndex(d => d.name.toLowerCase().includes((action.keyword || '').toLowerCase()));
      if (idx === -1) return `🤔 No encontré ninguna deuda que coincida con *${action.keyword}*. ¿Cómo se llama exactamente?`;
      const nombre = debts[idx].name;
      const newDebts = debts.filter((_, i) => i !== idx);
      await saveData(userId, { ...data, debts: newDebts });
      return `🗑️ Listo, eliminé la deuda *${nombre}*. Si fue un error, avisame y la vuelvo a cargar.`;
    }

    case 'pagar_deuda': {
      const debts = data.debts || [];
      const idx = debts.findIndex(d => d.name.toLowerCase().includes(action.keyword.toLowerCase()));
      if (idx === -1) return `🤔 No encontré ninguna deuda que coincida con *${action.keyword}*. ¿Cómo se llama exactamente?`;
      const deuda = { ...debts[idx] };
      const monto = parseFloat(action.amount);
      deuda.remaining = Math.max(0, deuda.remaining - monto);
      deuda.remainingInstallments = Math.max(0, (deuda.remainingInstallments || 0) - 1);
      debts[idx] = deuda;
      const tx = { id: crypto.randomUUID(), type: 'gasto', description: `Pago: ${deuda.name}`, amount: monto, category: 'Préstamo tarjeta', date: today(), savingsId: '' };
      await saveData(userId, { ...data, debts, transactions: [...data.transactions, tx] });
      if (deuda.remaining === 0) return `🎉 *¡Deuda saldada!*\n\n✅ *${deuda.name}* quedó en cero. Pagaste ${fmt(monto)} y cerramos esa deuda. ¡Una menos!`;
      return `💳 *Pago registrado!*\n\n📝 ${deuda.name}\n💵 Pagaste: ${fmt(monto)}\n⏳ Queda: ${fmt(deuda.remaining)}${deuda.remainingInstallments > 0 ? `\n📆 Cuotas restantes: ${deuda.remainingInstallments}` : ''}`;
    }

    case 'registrar_gastos_fijos': {
      const activos = (data.recurringExpenses || []).filter(g => g.active);
      if (!activos.length) return `📭 No tenés gastos fijos configurados todavía. ¿Querés que agregue alguno?`;
      const fecha = action.date || today();
      const total = activos.reduce((s, g) => s + g.amount, 0);
      const lineas = activos.map(g => `• ${g.description}: ${fmt(g.amount)}`).join('\n');
      // Guardar confirmación pendiente antes de asentar
      await savePendingSuggestion(phone, JSON.stringify({
        type: 'confirm_gastos_fijos',
        gastos: activos,
        date: fecha,
      }));
      return `¿Registramos todos?\n\n${lineas}\n\n💸 Total: ${fmt(total)}\n\n(Sí / No, o decime cuáles no)`;
    }

    case 'agregar_gasto_fijo': {
      const recurringExpenses = data.recurringExpenses || [];
      const gastoAmount = parseFloat(action.amount);
      if (!gastoAmount || gastoAmount <= 0) return `🤔 No entendí el monto del gasto fijo. ¿Cuánto es por mes?`;
      const gasto = { id: crypto.randomUUID(), description: truncate(action.description, 100), amount: gastoAmount, category: action.category || 'Otros', day: parseInt(action.day) || 1, active: true };
      await saveData(userId, { ...data, recurringExpenses: [...recurringExpenses, gasto] });
      return `🔄 *Gasto fijo agregado!*\n\n📝 ${gasto.description}: ${fmt(gasto.amount)}/mes\n📆 Se registra el día ${gasto.day} automáticamente.`;
    }

    case 'agregar_ingreso_recurrente': {
      const riAmount = parseFloat(action.amount);
      if (!riAmount || riAmount <= 0) return `🤔 No entendí el monto del ingreso. ¿Cuánto es por mes?`;
      const ri = {
        id: crypto.randomUUID(),
        name: truncate(action.name, 100),
        amount: riAmount,
        reason: action.reason || '',
        day: parseInt(action.day) || 1,
        active: true,
      };
      const recurringIncomes = [...(data.recurringIncomes || []), ri];
      await saveData(userId, { ...data, recurringIncomes });
      return `💰 *Ingreso mensual registrado!*\n\n👤 ${ri.name}\n💵 ${fmt(ri.amount)}/mes${ri.reason ? `\n📝 Por: ${ri.reason}` : ''}\n📆 Esperado el día ${ri.day} de cada mes\n\nCuando llegue el pago, decime y lo registro como ingreso.`;
    }

    case 'borrar_ingreso_recurrente': {
      const keyword = (action.keyword || '').toLowerCase();
      const all = action.all === true || keyword === 'todos' || keyword === 'all';
      const prevList = data.recurringIncomes || [];
      const newList = all
        ? []
        : prevList.filter(r => !r.name.toLowerCase().includes(keyword));
      const removed = prevList.length - newList.length;
      if (removed === 0) return `🔍 No encontré ningún ingreso recurrente que coincida con "${action.keyword}".`;
      await saveData(userId, { ...data, recurringIncomes: newList });
      return all
        ? `🗑️ Borré todos los ingresos recurrentes (${removed}). Ya no van a aparecer en los estimados.`
        : `🗑️ Borré el ingreso recurrente *${action.keyword}*. Ya no va a aparecer en los estimados.`;
    }

    case 'actualizar_gasto_fijo': {
      const esTotal = !action.keyword || action.keyword.toLowerCase() === 'todos' || action.keyword.toLowerCase() === 'all';
      const recurringExpenses = (data.recurringExpenses || []).map(g => {
        const match = esTotal || g.description.toLowerCase().includes(action.keyword.toLowerCase());
        if (!match) return g;
        const updated = { ...g };
        if (action.day)    updated.day    = parseInt(action.day);
        if (action.amount) updated.amount = parseFloat(action.amount);
        if (action.description) updated.description = action.description;
        return updated;
      });
      await saveData(userId, { ...data, recurringExpenses });
      const afectados = esTotal ? recurringExpenses : recurringExpenses.filter(g => g.description.toLowerCase().includes((action.keyword || '').toLowerCase()));
      const cambios = [];
      if (action.day)    cambios.push(`día → ${action.day}`);
      if (action.amount) cambios.push(`monto → ${fmt(action.amount)}`);
      if (action.description) cambios.push(`nombre → ${action.description}`);
      return `✅ Actualicé ${esTotal ? 'todos los gastos fijos' : `*${afectados[0]?.description || action.keyword}*`}: ${cambios.join(', ')}.`;
    }

    case 'eliminar_gasto_fijo': {
      const recurringExpenses = (data.recurringExpenses || []).map(g =>
        g.description.toLowerCase().includes(action.keyword.toLowerCase()) ? { ...g, active: false } : g
      );
      await saveData(userId, { ...data, recurringExpenses });
      return `✅ Listo, desactivé ese gasto fijo.`;
    }

    case 'pagar_y_eliminar_evento': {
      const descLower = (action.description || '').toLowerCase();
      const amount = parseFloat(action.amount);
      let newData = { ...data };
      const extras = [];

      const tx = {
        id: crypto.randomUUID(),
        type: 'gasto',
        description: action.description || 'Pago',
        amount,
        category: action.category || 'Otros',
        date: action.date || today(),
        savingsId: '',
      };
      newData.transactions = [...newData.transactions, tx];

      const eventosBefore = newData.events || [];
      newData.events = eventosBefore.filter(ev =>
        !ev.title.toLowerCase().includes(descLower) &&
        !descLower.includes(ev.title.toLowerCase())
      );
      if (newData.events.length < eventosBefore.length) {
        extras.push('🗑️ Eliminé el vencimiento del calendario.');
      }

      const deudaIdx = (newData.debts || []).findIndex(d =>
        d.name.toLowerCase().includes(descLower) ||
        descLower.includes(d.name.toLowerCase())
      );
      if (deudaIdx !== -1) {
        const deuda = { ...newData.debts[deudaIdx] };
        deuda.remaining = Math.max(0, deuda.remaining - amount);
        if (deuda.remaining === 0) {
          newData.debts = newData.debts.filter((_, i) => i !== deudaIdx);
          extras.push(`✅ La deuda *${deuda.name}* quedó saldada y la cerré.`);
        } else {
          newData.debts = newData.debts.map((d, i) => i === deudaIdx ? deuda : d);
          extras.push(`💳 Le quedan ${fmt(deuda.remaining)} a la deuda *${deuda.name}*.`);
        }
      }

      await saveData(userId, newData);
      let resp = `💸 *Pago registrado!*\n\n📝 ${tx.description}\n💵 ${fmt(tx.amount)}\n📅 ${tx.date}`;
      if (extras.length) resp += '\n\n' + extras.join('\n');
      return resp;
    }

    case 'resumen_general': {
      const { txs, ingresos, gastos } = monthlyTotals(data.transactions, month, year);
      const balance = ingresos - gastos;
      const gastosFijos = (data.recurringExpenses || []).filter(g => g.active).reduce((a, g) => a + g.amount, 0);
      // Ingresos fijos: solo los que NO llegaron todavía este mes (no están en transacciones)
      const ingFijosNoRecibidos = (data.recurringIncomes || []).filter(r => r.active).reduce((a, r) => {
        const yaRecibido = txs.some(t => (t.type === 'ingreso' || t.type === 'sueldo') && t.description?.toLowerCase().includes(r.name.toLowerCase()));
        return yaRecibido ? a : a + r.amount;
      }, 0);
      const proyectado = balance - gastosFijos + ingFijosNoRecibidos;
      const totalDeudas = data.debts.reduce((s, d) => s + d.remaining, 0);
      const totalAhorros = data.savings.reduce((s, sv) => s + (sv.current || 0), 0);
      const totalPrestamos = (data.loans || []).reduce((s, l) => s + l.remaining, 0);
      const todayDay = arDay();
      const proxVenc = (data.events || []).filter(ev => ev.day >= todayDay && ev.day <= todayDay + 7);
      let resp = `🌟 *Resumen de ${MONTH_NAMES[month]}${name ? ', ' + name : ''}*\n\n`;
      resp += `💰 Ingresos: ${fmt(ingresos)}\n💸 Gastos: ${fmt(gastos)}\n${balance >= 0 ? '✅' : '⚠️'} Disponible: ${fmtSigned(balance)}\n`;
      if (gastosFijos > 0) resp += `🔄 Gastos fijos pendientes: ${fmt(gastosFijos)}\n`;
      if (ingFijosNoRecibidos > 0) resp += `💵 Ingresos esperados aún no recibidos: ${fmt(ingFijosNoRecibidos)}\n`;
      if (gastosFijos > 0 || ingFijosNoRecibidos > 0) resp += `📅 Estimado fin de mes: ${fmtSigned(proyectado)}\n`;
      if (totalDeudas > 0) resp += `💳 Deudas: ${fmt(totalDeudas)}\n`;
      if (totalAhorros > 0) resp += `🐷 Ahorros: ${fmt(totalAhorros)}\n`;
      if (totalPrestamos > 0) resp += `📋 Te deben: ${fmt(totalPrestamos)}\n`;
      if (proxVenc.length) resp += `\n⚠️ *Vencimientos esta semana:*\n${proxVenc.map(ev => `• ${ev.title} (día ${ev.day})`).join('\n')}`;
      return resp;
    }

    case 'simular_sin_gasto': {
      const keyword = (action.keyword || '').toLowerCase();

      // Buscar el costo mensual: primero en gastos fijos, luego en historial de transacciones
      let costoMensual = parseFloat(action.amount) || 0;
      let fuente = '';

      if (!costoMensual) {
        const gastoFijo = (data.recurringExpenses || []).find(g =>
          g.active && g.description.toLowerCase().includes(keyword)
        );
        if (gastoFijo) {
          costoMensual = gastoFijo.amount;
          fuente = `gasto fijo registrado (${gastoFijo.description})`;
        }
      }

      if (!costoMensual) {
        // Buscar en las últimas 3 meses de transacciones y promediar
        const { month: m, year: y } = currentMonth();
        const meses3 = [];
        for (let i = 0; i < 3; i++) {
          const mm = ((m - i) + 12) % 12;
          const yy = m - i < 0 ? y - 1 : y;
          const total = filterByMonth(data.transactions, mm, yy)
            .filter(t => t.type === 'gasto' && t.description.toLowerCase().includes(keyword))
            .reduce((s, t) => s + t.amount, 0);
          if (total > 0) meses3.push(total);
        }
        if (meses3.length > 0) {
          costoMensual = Math.round(meses3.reduce((a, b) => a + b, 0) / meses3.length);
          fuente = `promedio de los últimos ${meses3.length} meses en tus registros`;
        }
      }

      // Calcular ingreso y gasto mensual promedio (últimos 3 meses)
      const { month: curM, year: curY } = currentMonth();
      let totalIng = 0, totalGst = 0, mesesConDatos = 0;
      for (let i = 0; i < 3; i++) {
        const mm = ((curM - i) + 12) % 12;
        const yy = curM - i < 0 ? curY - 1 : curY;
        const { ingresos: ing, gastos: gst } = monthlyTotals(data.transactions, mm, yy);
        if (ing > 0 || gst > 0) { totalIng += ing; totalGst += gst; mesesConDatos++; }
      }
      const ingMedio = mesesConDatos > 0 ? Math.round(totalIng / mesesConDatos) : 0;
      const gstMedio = mesesConDatos > 0 ? Math.round(totalGst / mesesConDatos) : 0;
      const superavitActual = ingMedio - gstMedio;
      const superavitNuevo = superavitActual + costoMensual;

      const prompt = `Sos Orbe, asistente financiero de ${name || 'tu usuario'}. Hablás en español rioplatense informal, sin asteriscos, como un amigo que sabe de finanzas. El usuario te preguntó qué pasaría si deja de pagar "${action.keyword}".

Datos calculados:
- Costo mensual de "${action.keyword}": ${costoMensual > 0 ? fmt(costoMensual) : 'no encontrado en los registros'}${fuente ? ` (${fuente})` : ''}
- Ingreso mensual promedio (últimos meses): ${fmt(ingMedio)}
- Gasto mensual promedio actual: ${fmt(gstMedio)}
- Superávit mensual actual: ${fmt(superavitActual)}${superavitActual < 0 ? ' (negativo)' : ''}
- Superávit si elimina ese gasto: ${costoMensual > 0 ? fmt(superavitNuevo) : 'no calculable sin el monto'}
- En 6 meses ahorraría: ${costoMensual > 0 ? fmt(costoMensual * 6) : '?'}
- En 12 meses ahorraría: ${costoMensual > 0 ? fmt(costoMensual * 12) : '?'}
- Metas de ahorro activas: ${data.savings?.length || 0}
- Deudas activas: ${data.debts?.length || 0}

Instrucciones:
${costoMensual > 0
  ? `Contale la simulación completa de forma conversacional. Mostrá el superávit nuevo, lo que acumularía en 6 y 12 meses. Si tiene deudas activas, sugerí que esa plata vaya a achicarlas. Si tiene metas de ahorro, sugerí aplicarla a alguna. Sé específica y útil, pero no lo hagas sentir obligado a nada.`
  : `No encontraste ese gasto en sus registros. Pedíle que te confirme cuánto paga por ese servicio para hacer la simulación.`
}
Sin listas. Máximo 6 líneas. Tono cálido y directo.`;

      return await callClaude(prompt, [], action.keyword);
    }

    case 'planear_compra': {
      const objetivo = parseFloat(action.amount);
      const nombreCompra = action.name || 'esa compra';
      const mesesObjetivo = parseInt(action.months) || null;

      // Calcular ingreso y gasto promedio (últimos 3 meses)
      const { month: pM, year: pY } = currentMonth();
      let pTotalIng = 0, pTotalGst = 0, pMeses = 0;
      for (let i = 0; i < 3; i++) {
        const mm = ((pM - i) + 12) % 12;
        const yy = pM - i < 0 ? pY - 1 : pY;
        const { ingresos: ing, gastos: gst } = monthlyTotals(data.transactions, mm, yy);
        if (ing > 0 || gst > 0) { pTotalIng += ing; pTotalGst += gst; pMeses++; }
      }
      const ingMedio = pMeses > 0 ? Math.round(pTotalIng / pMeses) : 0;
      const gstMedio = pMeses > 0 ? Math.round(pTotalGst / pMeses) : 0;
      const superavit = ingMedio - gstMedio;

      // Cuánto ya tienen en ahorros (por si tiene una meta relacionada)
      const totalAhorrado = (data.savings || []).reduce((s, sv) => s + (sv.current || 0), 0);

      // Simulaciones: meses al 25%, 50% y 100% del superávit
      const calcMeses = (porcentaje) => superavit > 0 ? Math.ceil(objetivo / (superavit * porcentaje)) : null;
      const meses25 = calcMeses(0.25);
      const meses50 = calcMeses(0.5);
      const meses100 = calcMeses(1.0);

      // Si hay plazo objetivo, calcular cuánto hay que ahorrar por mes
      const ahorroNecesario = mesesObjetivo ? Math.ceil(objetivo / mesesObjetivo) : null;

      const prompt = `Sos Orbe, asistente financiero de ${name || 'tu usuario'}. Hablás en español rioplatense informal, sin asteriscos, como un amigo que genuinamente quiere ayudar. El usuario quiere comprar "${nombreCompra}"${objetivo > 0 ? ` que sale ${fmt(objetivo)}` : ''}.

Datos financieros:
- Ingreso mensual promedio: ${fmt(ingMedio)}
- Gasto mensual promedio: ${fmt(gstMedio)}
- Superávit mensual disponible: ${superavit > 0 ? fmt(superavit) : `negativo (${fmt(Math.abs(superavit))} en rojo)`}
- Ya tienen ahorrado (total metas): ${fmt(totalAhorrado)}
- Deudas activas: ${data.debts?.length || 0}${data.debts?.length > 0 ? ` (total ${fmt((data.debts || []).reduce((s, d) => s + d.remaining, 0))})` : ''}
${mesesObjetivo ? `- El usuario quiere lograrlo en ${mesesObjetivo} meses → necesita ahorrar ${ahorroNecesario ? fmt(ahorroNecesario) + '/mes' : '(incalculable)'}` : ''}
${objetivo > 0 && superavit > 0 ? `
Simulaciones de ahorro:
- Guardando el 25% del superávit (${fmt(Math.round(superavit * 0.25))}/mes): ${meses25 ? meses25 + ' meses' : 'no alcanzable'}
- Guardando el 50% del superávit (${fmt(Math.round(superavit * 0.5))}/mes): ${meses50 ? meses50 + ' meses' : 'no alcanzable'}
- Guardando el 100% del superávit (${fmt(superavit)}/mes): ${meses100 ? meses100 + ' meses' : 'no alcanzable'}` : ''}

Instrucciones:
${superavit <= 0
  ? `El usuario no tiene margen de ahorro mensual ahora mismo. Sé honesto pero empático — explicá la situación, sugerí primero reducir gastos o aumentar ingresos antes de planificar esa compra.`
  : `Armale un plan concreto y realista. Recomendá un monto mensual a ahorrar (el que tenga más sentido según su situación). Si tiene deudas, considerá si conviene saldarlas primero. Sugerí crear una meta de ahorro específica para esto. Si el plazo queda muy largo, sugerí una alternativa (ahorrar más, buscar algo más barato, etc.). Sé específica con números.`
}
Sin listas. Máximo 8 líneas. Tono cálido, directo y que inspire confianza en que es posible.`;

      return await callClaude(prompt, [], `quiero comprar ${nombreCompra}`);
    }

    case 'gasto_en_dolares': {
      const amountUSD = parseFloat(action.amountUSD || action.amount || 0);
      if (!amountUSD) {
        return `🤔 No entendí el monto en dólares. ¿Cuánto fue exactamente? Por ejemplo: *"gasté 50 dólares en ropa"*`;
      }

      const dolar = await getDolarPrice();
      const dolarBlue = dolar?.blue || 0;
      const dolarOficial = dolar?.oficial || 0;
      const aproxARS = dolarBlue ? Math.round(amountUSD * dolarBlue) : null;
      const source = action.source || 'tarjeta'; // 'tarjeta' | 'cuenta'

      // Guardar estado pendiente en pending_suggestions como JSON tipado
      if (phone) {
        const pendingData = JSON.stringify({
          type: 'usd_tx',
          description: action.description || 'Gasto en dólares',
          amountUSD,
          category: action.category || 'Otros',
          date: action.date || today(),
          dolarBlue,
          dolarOficial,
          source,
        });
        await savePendingSuggestion(phone, pendingData);
      }

      if (source === 'tarjeta') {
        const recargos = aproxARS ? fmt(Math.round(aproxARS * 1.6)) : '(no disponible)'; // ~60% recargos promedio tarjeta
        return `💳 *USD ${amountUSD} con tarjeta — ${action.description || ''}*\n\nEl blue de hoy está en ${dolarBlue ? fmt(dolarBlue) : '(?)'}, lo que da unos ${aproxARS ? fmt(aproxARS) : '(?)'} en pesos. Pero acordate que la tarjeta toma el tipo del *día que cierra*, más impuestos y recargos (puede llegar a ${recargos} aprox.).\n\n¿Cómo lo registro?\n• *"en pesos"* → lo anoto al tipo de hoy como estimación\n• *"pendiente"* → lo marco para actualizar cuando cierre la tarjeta`;
      } else {
        return `💵 *USD ${amountUSD} de tu cuenta — ${action.description || ''}*\n\nAl blue de hoy (${dolarBlue ? fmt(dolarBlue) : '(?)'}), son ${aproxARS ? fmt(aproxARS) : '(?)'} en pesos.\n\n¿Cómo lo registro?\n• *"en pesos"* → lo convierto al tipo de hoy y lo anoto en ARS\n• *"en dólares"* → lo guardo como gasto en USD para que puedas rastrear tu saldo en dólares`;
      }
    }

    // ── MÓDULO EMPRESARIAL ─────────────────────────────────

    case 'registrar_negocio': {
      const negocio = { nombre: action.nombre, tipo: action.tipo || 'negocio' };
      await saveData(userId, { ...data, negocio });
      return `🏪 *Negocio registrado!*\n\n📝 ${negocio.nombre}\n🏷️ Tipo: ${negocio.tipo}\n\nAhora podés agregar productos, registrar ventas, activos y mucho más. ¿Por dónde empezamos?`;
    }

    case 'agregar_activo': {
      const activos = data.activos || [];
      const activo = {
        id: crypto.randomUUID(),
        name: action.name,
        value: parseFloat(action.value),
        residualValue: parseFloat(action.residualValue || 0),
        usefulLifeYears: parseFloat(action.usefulLifeYears || 5),
        purchaseDate: action.purchaseDate || today(),
        category: action.category || 'General',
      };
      await saveData(userId, { ...data, activos: [...activos, activo] });
      const amortAnual = (activo.value - activo.residualValue) / activo.usefulLifeYears;
      const amortMensual = amortAnual / 12;
      return `🏭 *Activo registrado!*\n\n📝 ${activo.name}\n💰 Valor de compra: ${fmt(activo.value)}\n📆 Vida útil: ${activo.usefulLifeYears} años\n🔻 Valor residual: ${fmt(activo.residualValue)}\n\n📊 *Amortización:*\n• Anual: ${fmt(Math.round(amortAnual))}\n• Mensual: ${fmt(Math.round(amortMensual))}\n\n_Esto es un costo contable mensual de ${fmt(Math.round(amortMensual))} que representa el desgaste real del activo._`;
    }

    case 'consultar_amortizacion': {
      const activos = data.activos || [];
      if (!activos.length) return `📭 No tenés activos registrados${name ? ', ' + name : ''}.\n\nPodés agregar uno: *"compré una computadora por $400.000"*`;
      const totalMensual = activos.reduce((s, a) => s + (a.value - a.residualValue) / a.usefulLifeYears / 12, 0);
      const lines = activos.map(a => {
        const amortMensual = (a.value - a.residualValue) / a.usefulLifeYears / 12;
        const purchaseYear = parseDateParts(a.purchaseDate).year;
        const purchaseMonth = parseDateParts(a.purchaseDate).month;
        const { month: cm, year: cy } = currentMonth();
        const mesesTranscurridos = (cy - purchaseYear) * 12 + (cm - purchaseMonth);
        const valorActual = Math.max(a.residualValue, a.value - amortMensual * mesesTranscurridos);
        return `🏭 *${a.name}*\n   Valor original: ${fmt(a.value)} | Valor actual: ${fmt(Math.round(valorActual))}\n   Amortización: ${fmt(Math.round(amortMensual))}/mes | Vida útil: ${a.usefulLifeYears} años`;
      });
      return `🏭 *Amortización de activos*\n\n${lines.join('\n\n')}\n\n📊 *Total amortización mensual: ${fmt(Math.round(totalMensual))}*\n_Este monto es el costo real mensual de tus activos (desgaste/obsolescencia)._`;
    }

    case 'agregar_producto': {
      const productos = data.productos || [];
      const existing = productos.findIndex(p => p.name.toLowerCase() === action.name.toLowerCase());
      const prodCost = parseFloat(action.cost);
      const prodPrice = parseFloat(action.price);
      if (!prodCost || prodCost <= 0 || !prodPrice || prodPrice <= 0) return `🤔 Necesito el costo y el precio de venta para agregar el producto.`;
      const producto = {
        id: existing >= 0 ? productos[existing].id : crypto.randomUUID(),
        name: truncate(action.name, 100),
        cost: prodCost,
        price: prodPrice,
        unit: action.unit || 'unidad',
      };
      const margen = ((producto.price - producto.cost) / producto.price * 100).toFixed(1);
      const ganancia = producto.price - producto.cost;
      if (existing >= 0) {
        productos[existing] = producto;
        await saveData(userId, { ...data, productos });
        return `✅ *${producto.name}* actualizado!\n\n💰 Costo: ${fmt(producto.cost)} | Precio: ${fmt(producto.price)}\n📈 Margen bruto: *${margen}%* (ganás ${fmt(ganancia)} por ${producto.unit})`;
      }
      await saveData(userId, { ...data, productos: [...productos, producto] });
      return `✅ *${producto.name}* agregado!\n\n💰 Costo: ${fmt(producto.cost)} | Precio: ${fmt(producto.price)}\n📈 Margen bruto: *${margen}%* (ganás ${fmt(ganancia)} por ${producto.unit})`;
    }

    case 'consultar_productos': {
      const productos = data.productos || [];
      if (!productos.length) return `📭 No tenés productos registrados todavía.\n\nAgregá uno: *"vendo Coca Cola a $900, me cuesta $600"*`;
      const lines = productos.map(p => {
        const margen = ((p.price - p.cost) / p.price * 100).toFixed(1);
        const emoji = margen >= 40 ? '🟢' : margen >= 25 ? '🟡' : '🔴';
        return `${emoji} *${p.name}*: costo ${fmt(p.cost)} → precio ${fmt(p.price)} | margen ${margen}%`;
      });
      const margenProm = productos.reduce((s, p) => s + (p.price - p.cost) / p.price * 100, 0) / productos.length;
      return `📦 *Tus productos (${productos.length})*\n\n${lines.join('\n')}\n\n📊 Margen promedio: *${margenProm.toFixed(1)}%*`;
    }

    case 'eliminar_producto': {
      const productos = data.productos || [];
      const filtered = productos.filter(p => !p.name.toLowerCase().includes(action.keyword.toLowerCase()));
      if (filtered.length === productos.length) return `🤔 No encontré ningún producto con "${action.keyword}".`;
      await saveData(userId, { ...data, productos: filtered });
      return `🗑️ Producto eliminado correctamente.`;
    }

    case 'registrar_venta': {
      const ventas = data.ventas || [];
      const productos = data.productos || [];
      let total = 0;
      const items = (action.items || []).map(item => {
        const prod = productos.find(p => p.name.toLowerCase().includes(item.name.toLowerCase()));
        const unitPrice = parseFloat(item.unitPrice) || (prod?.price || 0);
        const qty = parseInt(item.quantity) || 1;
        total += unitPrice * qty;
        return { name: prod?.name || item.name, quantity: qty, unitPrice, subtotal: unitPrice * qty };
      });
      if (!items.length) return `🤔 No entendí qué vendiste. Decime el producto y cantidad.`;
      const venta = { id: crypto.randomUUID(), date: action.date || today(), items, total, paymentMethod: action.paymentMethod || 'efectivo' };
      await saveData(userId, { ...data, ventas: [...ventas, venta] });
      const itemLines = items.map(i => `• ${i.name} x${i.quantity} = ${fmt(i.subtotal)}`).join('\n');
      return `💵 *Venta registrada!*\n\n${itemLines}\n\n💰 Total: *${fmt(total)}*\n💳 ${venta.paymentMethod}`;
    }

    case 'consultar_ventas_negocio': {
      const ventas = data.ventas || [];
      const ventasMes = filterByMonth(ventas, month, year);
      if (!ventasMes.length) return `📭 No hay ventas registradas este mes${name ? ', ' + name : ''}.\n\nPodés registrar una: *"vendí 3 Coca Colas"*`;
      const totalVentas = ventasMes.reduce((s, v) => s + v.total, 0);
      const productos = data.productos || [];
      // Calcular costo estimado si hay productos cargados
      let costoEstimado = 0;
      ventasMes.forEach(v => v.items.forEach(i => {
        const prod = productos.find(p => p.name.toLowerCase().includes(i.name.toLowerCase()));
        if (prod) costoEstimado += prod.cost * i.quantity;
      }));
      const gananciaEstimada = costoEstimado > 0 ? totalVentas - costoEstimado : null;
      let resp = `📊 *Ventas de ${MONTH_NAMES[month]}*\n\n💵 Total vendido: *${fmt(totalVentas)}*\n🔢 Cantidad de ventas: ${ventasMes.length}`;
      if (gananciaEstimada !== null) resp += `\n💰 Ganancia bruta estimada: *${fmt(Math.round(gananciaEstimada))}*\n📈 Margen: ${((gananciaEstimada / totalVentas) * 100).toFixed(1)}%`;
      return resp;
    }

    case 'calcular_margen': {
      const productos = data.productos || [];
      if (action.keyword) {
        const prod = productos.find(p => p.name.toLowerCase().includes(action.keyword.toLowerCase()));
        if (!prod) return `🤔 No encontré el producto "${action.keyword}". ¿Cómo se llama exactamente?`;
        const margen = ((prod.price - prod.cost) / prod.price * 100).toFixed(1);
        const ganancia = prod.price - prod.cost;
        const markupPct = ((prod.price - prod.cost) / prod.cost * 100).toFixed(1);
        return `📈 *Análisis de ${prod.name}*\n\n💰 Costo: ${fmt(prod.cost)}\n💵 Precio de venta: ${fmt(prod.price)}\n📊 Margen bruto: *${margen}%*\n📦 Markup: *${markupPct}%*\n💸 Ganancia por unidad: *${fmt(ganancia)}*\n\n_Margen = (precio - costo) / precio. Markup = (precio - costo) / costo._`;
      }
      if (!productos.length) return `📭 No tenés productos cargados. Agregá uno primero.`;
      const lines = productos.map(p => {
        const m = ((p.price - p.cost) / p.price * 100).toFixed(1);
        return `• ${p.name}: margen ${m}% (ganás ${fmt(p.price - p.cost)}/u)`;
      });
      return `📈 *Márgenes de tus productos*\n\n${lines.join('\n')}`;
    }

    case 'punto_equilibrio': {
      const productos = data.productos || [];
      const costosFijosParam = parseFloat(action.costosFijos) || 0;
      // Gastos fijos del mes como proxy de costos fijos si no se especifican
      const gastosFijosConfig = (data.recurringExpenses || []).filter(g => g.active).reduce((s, g) => s + g.amount, 0);
      const costosFijos = costosFijosParam > 0 ? costosFijosParam : gastosFijosConfig;
      if (costosFijos === 0 && !productos.length) {
        return `📊 Para calcular el punto de equilibrio necesito saber tus costos fijos mensuales (alquiler, sueldos, servicios) y tus productos con precio y costo.\n\nDecime: *"mi punto de equilibrio con costos fijos de $50.000"*`;
      }
      if (!productos.length) {
        return `📊 *Punto de equilibrio*\n\n🔒 Costos fijos: ${fmt(costosFijos)}\n\nNo tenés productos cargados para calcular el margen de contribución. Agregá al menos un producto con costo y precio.`;
      }
      const margenProm = productos.reduce((s, p) => s + (p.price - p.cost), 0) / productos.length;
      const precioPromedio = productos.reduce((s, p) => s + p.price, 0) / productos.length;
      const unidadesReq = costosFijos > 0 ? Math.ceil(costosFijos / margenProm) : 0;
      const ventasReq = unidadesReq * precioPromedio;
      return `📊 *Punto de equilibrio*\n\n🔒 Costos fijos mensuales: ${fmt(costosFijos)}\n📦 Margen de contribución promedio: ${fmt(Math.round(margenProm))}/unidad\n\n🎯 *Para cubrir tus costos necesitás:*\n• ${unidadesReq} unidades vendidas\n• O ${fmt(Math.round(ventasReq))} en ventas\n\n_Por encima de eso, cada venta es ganancia pura._`;
    }

    case 'estado_de_resultados': {
      const { ingresos: ingresosTotales, gastos: gastosTotales } = monthlyTotals(data.transactions, month, year);
      const ventasMes = filterByMonth(data.ventas || [], month, year);
      const ingresoVentas = ventasMes.reduce((s, v) => s + v.total, 0);
      const ingresoTotal = ingresosTotales + ingresoVentas;
      const gastosFijos = (data.recurringExpenses || []).filter(g => g.active).reduce((s, g) => s + g.amount, 0);
      const amortizacion = (data.activos || []).reduce((s, a) => s + (a.value - a.residualValue) / a.usefulLifeYears / 12, 0);
      const resultadoOperativo = ingresoTotal - gastosTotales;
      const resultadoNeto = resultadoOperativo - amortizacion;
      return `📋 *Estado de Resultados — ${MONTH_NAMES[month]} ${year}*\n\n💰 *INGRESOS*\n   Cobros/sueldo: ${fmt(ingresosTotales)}${ingresoVentas > 0 ? `\n   Ventas negocio: ${fmt(ingresoVentas)}` : ''}\n   *Total ingresos: ${fmt(ingresoTotal)}*\n\n💸 *EGRESOS*\n   Gastos del mes: ${fmt(gastosTotales)}\n   *Total egresos: ${fmt(gastosTotales)}*\n\n📊 *RESULTADO OPERATIVO: ${fmtSigned(resultadoOperativo)}*${amortizacion > 0 ? `\n   (-) Amortizaciones: ${fmt(Math.round(amortizacion))}\n\n📊 *RESULTADO NETO: ${fmtSigned(Math.round(resultadoNeto))}*` : ''}`;
    }

    case 'flujo_de_caja_negocio': {
      const { ingresos: entradas, gastos: salidas } = monthlyTotals(data.transactions, month, year);
      const ventasMes = filterByMonth(data.ventas || [], month, year);
      const entradasVentas = ventasMes.reduce((s, v) => s + v.total, 0);
      const flujoOperativo = (entradas + entradasVentas) - salidas;
      const prestamosAFavor = (data.loans || []).filter(l => l.remaining > 0).reduce((s, l) => s + l.remaining, 0);
      return `💧 *Flujo de Caja — ${MONTH_NAMES[month]} ${year}*\n\n📥 *ENTRADAS*\n   Ingresos: ${fmt(entradas)}${entradasVentas > 0 ? `\n   Ventas: ${fmt(entradasVentas)}` : ''}\n   *Total entradas: ${fmt(entradas + entradasVentas)}*\n\n📤 *SALIDAS*\n   Gastos: ${fmt(salidas)}\n   *Total salidas: ${fmt(salidas)}*\n\n${flujoOperativo >= 0 ? '✅' : '⚠️'} *Flujo operativo: ${fmtSigned(flujoOperativo)}*${prestamosAFavor > 0 ? `\n\n📋 Dinero en la calle (préstamos): ${fmt(prestamosAFavor)}` : ''}\n\n_El flujo de caja refleja el movimiento real de dinero — distinto a la ganancia contable._`;
    }

    case 'agendar_turno': {
      const turnos = data.turnos || [];
      const turno = {
        id: crypto.randomUUID(),
        description: action.description,
        date: action.date,
        time: action.time || null,
        location: action.location || null,
        turnoType: action.turnoType || 'otro',
        notified: false,
      };
      await saveData(userId, { ...data, turnos: [...turnos, turno] });
      const typeEmoji = { médico: '🏥', banco: '🏦', trámite: '📋', veterinario: '🐾', odontólogo: '🦷', otro: '📅' };
      const emoji = typeEmoji[turno.turnoType] || '📅';
      const daysUntil = Math.round((new Date(turno.date) - new Date(today())) / (1000 * 60 * 60 * 24));
      const whenText = daysUntil === 0 ? '¡es hoy!' : daysUntil === 1 ? 'es mañana' : daysUntil === 2 ? 'es pasado mañana' : `en ${daysUntil} días`;
      return `${emoji} *Turno agendado!*\n\n📝 ${turno.description}\n📅 ${fmtDate(turno.date)}${turno.time ? ` a las ${turno.time}hs` : ''}${turno.location ? `\n📍 ${turno.location}` : ''}\n\n⏰ ${whenText} — te aviso 2 días antes.`;
    }

    case 'consultar_turnos': {
      const turnos = data.turnos || [];
      const proximos = turnos
        .filter(t => t.date >= today())
        .sort((a, b) => a.date.localeCompare(b.date));
      if (!proximos.length) return `📅 No tenés turnos agendados${name ? ', ' + name : ''}.\n\nPodés agendar uno: *"tengo turno con el médico el 20 de marzo a las 10hs"*`;
      const typeEmoji = { médico: '🏥', banco: '🏦', trámite: '📋', veterinario: '🐾', odontólogo: '🦷', otro: '📅' };
      const lines = proximos.map(t => {
        const emoji = typeEmoji[t.turnoType] || '📅';
        const daysUntil = Math.round((new Date(t.date) - new Date(today())) / (1000 * 60 * 60 * 24));
        const tag = daysUntil === 0 ? '🔴 HOY' : daysUntil === 1 ? '🟡 Mañana' : daysUntil === 2 ? '🟠 Pasado mañana' : `📅 ${fmtDate(t.date)}`;
        return `${emoji} *${t.description}*\n   ${tag}${t.time ? ` a las ${t.time}hs` : ''}${t.location ? ` — ${t.location}` : ''}`;
      });
      return `📅 *Tus próximos turnos*\n\n${lines.join('\n\n')}`;
    }

    case 'editar_turno': {
      const turnos = data.turnos || [];
      const keyword = (action.keyword || '').toLowerCase();
      const idx = turnos.findIndex(t => t.description.toLowerCase().includes(keyword));
      if (idx === -1) return `🤔 No encontré ningún turno que coincida con *${action.keyword}*. ¿Cómo se llama exactamente?`;
      const updated = { ...turnos[idx] };
      if (action.date) updated.date = action.date;
      if (action.time) updated.time = action.time;
      if (action.location) updated.location = action.location;
      const newTurnos = turnos.map((t, i) => i === idx ? updated : t);
      await saveData(userId, { ...data, turnos: newTurnos });
      const typeEmoji = { médico: '🏥', banco: '🏦', trámite: '📋', veterinario: '🐾', odontólogo: '🦷', otro: '📅' };
      const emoji = typeEmoji[updated.turnoType] || '📅';
      const daysUntil = Math.round((new Date(updated.date) - new Date(today())) / (1000 * 60 * 60 * 24));
      const whenText = daysUntil === 0 ? '¡es hoy!' : daysUntil === 1 ? 'mañana' : daysUntil === 2 ? 'pasado mañana' : `en ${daysUntil} días`;
      return `${emoji} *Turno actualizado!*\n\n📝 ${updated.description}\n📅 ${fmtDate(updated.date)}${updated.time ? ` a las ${updated.time}hs` : ''}${updated.location ? `\n📍 ${updated.location}` : ''}\n\n⏰ ${whenText}.`;
    }

    case 'cancelar_turno': {
      const turnos = data.turnos || [];
      const keyword = (action.keyword || '').toLowerCase();
      // Si hay fecha, usarla para desambiguar entre turnos con el mismo nombre
      const matchFn = action.date
        ? t => t.description.toLowerCase().includes(keyword) && t.date === action.date
        : t => t.description.toLowerCase().includes(keyword);
      const cancelado = turnos.find(matchFn);
      if (!cancelado) {
        // Si había coincidencia por nombre pero no por fecha, avisar
        const byName = turnos.filter(t => t.description.toLowerCase().includes(keyword));
        if (byName.length > 1 && action.date) return `🤔 No encontré un turno de *${action.keyword}* para esa fecha. ¿Querés cancelar el del ${byName.map(t => fmtDate(t.date)).join(' o el del ')}?`;
        return `🤔 No encontré ningún turno que coincida con *${action.keyword}*. ¿Cómo se llamaba exactamente?`;
      }
      await saveData(userId, { ...data, turnos: turnos.filter(t => t.id !== cancelado.id) });
      return `🗑️ Turno de *${cancelado.description}* del ${fmtDate(cancelado.date)} cancelado. Si lo reagendás, avisame.`;
    }

    case 'exportar_csv': {
      const scope = action.scope || 'transacciones';
      let csv = '';
      let titulo = '';

      if (scope === 'transacciones' || scope === 'todo') {
        const txs = data.transactions.slice(-100); // últimas 100
        titulo = 'Transacciones';
        csv += `Fecha,Descripción,Tipo,Monto,Categoría\n`;
        csv += txs.map(t => `${t.date},"${t.description}",${t.type},${t.amount},"${t.category}"`).join('\n');
      } else if (scope === 'ventas') {
        const ventas = data.ventas || [];
        titulo = 'Ventas';
        csv += `Fecha,Productos,Total,Método de pago\n`;
        csv += ventas.map(v => `${v.date},"${v.items.map(i => `${i.name} x${i.quantity}`).join(' | ')}",${v.total},${v.paymentMethod}`).join('\n');
      } else if (scope === 'prestamos') {
        const loans = data.loans || [];
        titulo = 'Préstamos';
        csv += `Nombre,Monto original,Pendiente,Fecha\n`;
        csv += loans.map(l => `"${l.name}",${l.amount || l.remaining},${l.remaining},${l.createdAt}`).join('\n');
      }

      if (!csv || csv.split('\n').length <= 1) return `📭 No hay datos de ${titulo.toLowerCase()} para exportar.`;

      return `📊 *Datos listos para Excel — ${titulo}*\n\nCopiá el texto de abajo y pegálo en Excel (o Sheets). Después seleccioná la columna A → Datos → Texto en columnas → Delimitado → Coma.\n\n\`\`\`\n${csv}\n\`\`\`\n\n_Consejo: en Google Sheets podés usar Archivo → Importar y pegar directamente._`;
    }

    case 'educacion_financiera': {
      const conceptos = {
        amortizacion: `📚 *Amortización / Depreciación*\n\nCuando comprás un activo (computadora, heladera, auto), no lo "gastás" de una — se desgasta con el tiempo. La amortización distribuye ese costo a lo largo de su vida útil.\n\n*Ejemplo:* Comprás una computadora por $400.000 con vida útil de 4 años → amortizás $100.000/año = $8.333/mes.\n\nEse $8.333 mensual es un costo real de tu negocio aunque no salga plata de tu bolsillo en ese momento. Ignorarlo infla artificialmente tus ganancias.`,
        margen: `📚 *Margen de ganancia*\n\nHay dos tipos que no hay que confundir:\n\n*Margen bruto* = (precio - costo) / precio × 100\n*Markup* = (precio - costo) / costo × 100\n\n*Ejemplo:* Vendés algo a $1.000 que te costó $600:\n→ Margen bruto: 40% (de cada $1000 que entra, $400 son ganancia)\n→ Markup: 66.7% (le pusiste un 66.7% encima del costo)\n\nEl margen es más útil para analizar rentabilidad. El markup para fijar precios.`,
        punto_equilibrio: `📚 *Punto de equilibrio (Break-even)*\n\nEs el nivel de ventas donde no ganás ni perdés. Por debajo = pérdida. Por encima = ganancia.\n\n*Fórmula:* Costos fijos / (precio - costo variable por unidad)\n\n*Ejemplo:* Tenés $50.000 de costos fijos/mes. Vendés algo a $1.000 que te cuesta $600 → margen de contribución = $400 → necesitás vender 125 unidades/mes para cubrir los costos.`,
        balance: `📚 *Balance General*\n\nFoto del patrimonio en un momento dado. La ecuación fundamental:\n\n*ACTIVOS = PASIVOS + PATRIMONIO NETO*\n\nActivos: lo que tenés (caja, mercadería, equipos, créditos a cobrar)\nPasivos: lo que debés (préstamos, cuentas a pagar, tarjetas)\nPatrimonio neto: lo que realmente es tuyo = activos - pasivos\n\nUn negocio sano tiene más activos que pasivos. Si el patrimonio neto es negativo, estás "quebrado" contablemente.`,
        flujo_de_caja: `📚 *Flujo de Caja (Cash Flow)*\n\nEl error más común: confundir ganancia con liquidez. Podés ser rentable y quedarte sin efectivo.\n\n*Ejemplo:* Vendiste $500.000 en el mes pero te pagan a 60 días → tenés ganancia pero sin caja para pagar sueldos hoy.\n\nEl flujo de caja mide el movimiento REAL de dinero:\n• Flujo operativo: del negocio diario\n• Flujo de inversión: compra/venta de activos\n• Flujo financiero: préstamos tomados/pagados`,
        roi: `📚 *ROI (Retorno sobre Inversión)*\n\nMide qué tan rentable fue una inversión:\n\n*ROI = (ganancia obtenida - inversión) / inversión × 100*\n\n*Ejemplo:* Invertiste $100.000 en stock, lo vendiste por $160.000 → ROI = 60%\n\nSiempre comparalo contra alternativas: si el plazo fijo rinde 8% mensual y tu negocio te da 5%, quizás convenga reubicar el capital.`,
        ebitda: `📚 *EBITDA*\n\nSignifica: Earnings Before Interest, Taxes, Depreciation and Amortization (Ganancias antes de intereses, impuestos, depreciación y amortización).\n\nEs la rentabilidad operativa PURA — lo que genera el negocio con su operación, sin los ajustes financieros ni contables.\n\n*Para qué sirve:* comparar negocios sin que la estructura de deuda o el país (impuestos) distorsionen la comparación. Un EBITDA positivo y creciente es señal de un negocio sano.`,
        capital_de_trabajo: `📚 *Capital de Trabajo*\n\n*Capital de trabajo = Activo corriente - Pasivo corriente*\n\nActivo corriente: lo que se convierte en cash en menos de 1 año (caja, cuentas a cobrar, inventario)\nPasivo corriente: deudas que vencen en menos de 1 año\n\nSi es positivo: el negocio puede pagar sus deudas de corto plazo con sus recursos de corto plazo.\nSi es negativo: riesgo de iliquidez — aunque el negocio sea rentable.\n\nEs la diferencia entre solvencia y liquidez.`,
        costos_fijos_variables: `📚 *Costos Fijos vs Variables*\n\n*Fijos:* no cambian con el volumen de ventas. Ej: alquiler, sueldo, internet → los pagás aunque vendas cero.\n\n*Variables:* cambian con la producción/ventas. Ej: materia prima, embalaje, comisiones.\n\n*Por qué importa:* el punto de equilibrio usa solo los costos fijos. Cuantos más fijos tenés, más vendés para no perder. Una empresa con muchos variables y pocos fijos tiene más flexibilidad ante una caída de ventas.`,
      };
      const concepto = action.concepto || 'margen';
      const resp = conceptos[concepto];
      if (resp) return resp;
      // Si el concepto no está en la lista, usar Claude para explicarlo
      const eduPrompt = `Sos Orbe, asistente financiero especialista en administración de empresas. Explicá el concepto "${concepto}" en español rioplatense informal, con un ejemplo concreto en pesos argentinos. Máximo 5 líneas. Sin listas largas. Como si se lo explicaras a un emprendedor que no tiene formación contable.`;
      return await callClaude(eduPrompt, [], `Explicame qué es ${concepto}`);
    }

    case 'agregar_tarea': {
      const tareas = data.tareas || [];
      const nueva = {
        id: Date.now(),
        description: truncate(action.description, 200),
        dueDate: action.dueDate || null,
        status: 'pendiente',
        createdAt: today(),
      };
      await saveData(userId, { ...data, tareas: [...tareas, nueva] });
      const dueDateTxt = nueva.dueDate ? ` para el ${fmtDate(nueva.dueDate)}` : '';
      return `📝 Anotado${dueDateTxt}: *${nueva.description}*`;
    }

    case 'consultar_tareas': {
      const tareas = data.tareas || [];
      const filter = action.filter || 'pendientes';
      const lista = filter === 'todas' ? tareas : filter === 'hechas' ? tareas.filter(t => t.status === 'hecha') : tareas.filter(t => t.status === 'pendiente');
      if (!lista.length) {
        if (filter === 'hechas') return `✅ No tenés tareas completadas aún.`;
        return `📋 No tenés tareas pendientes${name ? ', ' + name : ''}.\n\nPodés agregar una: *"anotá que tengo que llamar al banco"*`;
      }
      const pendientes = lista.filter(t => t.status === 'pendiente');
      const hechas = lista.filter(t => t.status === 'hecha');
      let lines = [];
      if (pendientes.length) {
        lines.push(...pendientes.map(t => {
          const due = t.dueDate ? ` — ${fmtDate(t.dueDate)}` : '';
          const urgente = t.dueDate && t.dueDate <= today() ? ' 🔴' : t.dueDate && t.dueDate <= (() => { const d = new Date(today()); d.setDate(d.getDate() + 3); return d.toISOString().slice(0, 10); })() ? ' 🟡' : '';
          return `⬜ ${t.description}${due}${urgente}`;
        }));
      }
      if (hechas.length && filter === 'todas') {
        if (pendientes.length) lines.push('');
        lines.push(...hechas.map(t => `✅ ~~${t.description}~~`));
      }
      const header = filter === 'todas' ? `📋 *Todas tus tareas* (${pendientes.length} pendientes, ${hechas.length} hechas)` : `📋 *Tareas pendientes* (${pendientes.length})`;
      return `${header}\n\n${lines.join('\n')}`;
    }

    case 'completar_tarea': {
      const tareas = data.tareas || [];
      const keyword = (action.keyword || '').toLowerCase();
      const idx = tareas.findIndex(t => t.status === 'pendiente' && t.description.toLowerCase().includes(keyword));
      if (idx === -1) return `🤔 No encontré ninguna tarea pendiente que coincida con *${action.keyword}*.`;
      const completada = tareas[idx];
      const newTareas = tareas.map((t, i) => i === idx ? { ...t, status: 'hecha' } : t);
      await saveData(userId, { ...data, tareas: newTareas });
      const pendientesRestantes = newTareas.filter(t => t.status === 'pendiente').length;
      const suffix = pendientesRestantes === 0 ? ' No te queda ninguna pendiente 🙌' : ` Te ${pendientesRestantes === 1 ? 'queda 1' : `quedan ${pendientesRestantes}`} pendiente${pendientesRestantes !== 1 ? 's' : ''}.`;
      return `✅ *${completada.description}* — listo.${suffix}`;
    }

    case 'borrar_tarea': {
      const tareas = data.tareas || [];
      const keyword = (action.keyword || '').toLowerCase();
      const tarea = tareas.find(t => t.description.toLowerCase().includes(keyword));
      if (!tarea) return `🤔 No encontré ninguna tarea que coincida con *${action.keyword}*.`;
      await saveData(userId, { ...data, tareas: tareas.filter(t => t.id !== tarea.id) });
      return `🗑️ Tarea *${tarea.description}* eliminada.`;
    }

    case 'guardar_memoria': {
      const memoria = data.memoria || [];
      const nueva = { id: Date.now(), text: truncate(action.text, 300), type: 'patron', date: today() };
      await saveData(userId, { ...data, memoria: [...memoria, nueva] });
      return `🧠 Anotado${name ? ', ' + name : ''}: "${action.text}"`;
    }

    case 'registrar_feedback_negativo': {
      const memoria = data.memoria || [];
      const nueva = { id: Date.now(), text: truncate(action.text, 300), type: 'feedback', date: today() };
      await saveData(userId, { ...data, memoria: [...memoria, nueva] });
      return `Anotado${name ? ', ' + name : ''}. No lo vuelvo a hacer. 🙏`;
    }

    case 'conversacion': {
      let resp = action.respuesta || `Contame, ¿en qué te puedo ayudar${name ? ', ' + name : ''}? 💚`;
      // Sanitizar por si Claude devolvió JSON crudo como respuesta
      if (typeof resp === 'string' && resp.trim().startsWith('{')) {
        try {
          const parsed = JSON.parse(resp.trim());
          if (parsed.respuesta) resp = parsed.respuesta;
        } catch {}
      }
      return resp;
    }

    default: {
      const invites = [
        `No llegué a entender lo que me pedías, pero me intriga la idea. Contame todo en detalle: ¿qué querías hacer o consultar? Lo anoto para evaluarlo.`,
        `Hmm, no pude interpretar eso del todo. Explicame con más detalle qué necesitabas — si es viable, lo integramos.`,
        `No llegué a descifrar eso${name ? ', ' + name : ''}. Contame bien qué querías hacer y lo guardo para ver si lo podemos agregar.`,
      ];
      return invites[Math.floor(Math.random() * invites.length)];
    }
  }
}


module.exports = { processAction };
