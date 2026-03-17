'use strict';

const { supabase, loadData } = require('../lib/supabase');
const { sendWhatsAppMessage } = require('../lib/whatsapp');
const { fmt, today, arNow, arDay, currentMonth, parseDateParts, MONTH_NAMES, getGreeting } = require('../lib/helpers');
const { callClaude } = require('../ai/interpret');

let lastWeeklyReportDay = null;

// ── Saludo matutino ────────────────────────────────────────
async function sendMorningGreeting() {
  try {
    // Distributed lock: si otra instancia ya corrió hoy, salteamos
    const lockPhone = `_scheduler_morning_${today()}`;
    const { error: lockErr } = await supabase
      .from('pending_suggestions')
      .insert({ phone: lockPhone, original_message: 'lock' });
    if (lockErr) {
      console.log('⏭️ Morning greeting ya ejecutado por otra instancia, salteando.');
      return;
    }

    const { data: users } = await supabase.from('whatsapp_users').select('phone, user_id, user_name');
    if (!users || !users.length) return;
    const { month, year } = currentMonth();

    for (const user of users) {
      const data = await loadData(user.user_id);
      if (!data) continue;
      if (data.silencedUntil && data.silencedUntil >= today()) continue;

      const txsMes = data.transactions.filter(t => {
        const p = parseDateParts(t.date);
        return p.month === month && p.year === year;
      });
      const ingresos = txsMes.filter(t => t.type === 'ingreso' || t.type === 'sueldo').reduce((a, t) => a + t.amount, 0);
      const gastos = txsMes.filter(t => t.type === 'gasto').reduce((a, t) => a + t.amount, 0);
      const balance = ingresos - gastos;

      const todayDay = arDay();
      const proxVenc = (data.events || []).filter(ev => ev.day >= todayDay && ev.day <= todayDay + 3);
      const name = user.user_name ? user.user_name.split(' ')[0] : '';

      const morningPrompt = `Sos Orbe, el asistente financiero personal de ${name || 'tu usuario'}. Sos cálido, empático, cercano. Hablás en español rioplatense informal. Sos el primero en escribirle al usuario cada mañana.

Contexto financiero de ${MONTH_NAMES[month]} ${year}:
- Ingresos: ${fmt(ingresos)} / Gastos: ${fmt(gastos)}
- Balance disponible: ${fmt(balance)}${balance < 0 ? ' (NEGATIVO)' : ''}
${proxVenc.length > 0 ? `- Vencimientos en los próximos 3 días: ${proxVenc.map(ev => {
  const dias = ev.day - todayDay;
  return dias === 0 ? `${ev.title} (HOY)` : `${ev.title} (en ${dias} día${dias > 1 ? 's' : ''})`;
}).join(', ')}` : '- Sin vencimientos urgentes'}

Tu tarea: escribí el mensaje de buenos días. Antes de escribir, pensá: ¿qué es lo más importante de la situación de este usuario ahora mismo? ¿Hay un vencimiento hoy? ¿El balance está mal? ¿O todo está bien y simplemente podés arrancar con algo liviano y humano? Arrancá desde ahí, no desde un template. Integrá el contexto financiero de forma conversacional — no como una lista de datos, sino como algo que te acordás y que viene al caso. Una sola pregunta sobre cómo está o cómo arrancó el día. Variá el estilo cada vez. Sin listas, sin asteriscos, sin "¡Buenos días!" como primer palabra siempre. Máximo 5 líneas. Como un WhatsApp de alguien que genuinamente se acuerda de tu situación.`;

      try {
        const msg = await callClaude(morningPrompt, [], 'buenos días');
        await sendWhatsAppMessage(user.phone, msg);
      } catch {
        // fallback si Claude falla
        const fallback = `☀️ Buenos días${name ? ', ' + name : ''}! ¿Cómo arrancaste?\n\n📊 ${MONTH_NAMES[month]}: ${fmt(ingresos)} ingresos, ${fmt(gastos)} gastos. Disponible: ${fmt(balance)}.${proxVenc.length > 0 ? `\n\n⚠️ Vencimientos próximos: ${proxVenc.map(ev => ev.title).join(', ')}` : ''}\n\n¿Tenés algo para registrar? Avisame 💚`;
        await sendWhatsAppMessage(user.phone, fallback);
      }

      // Verificar recordatorios del día
      const todayStr = today();
      const todayReminders = (data.reminders || []).filter(r => r.date === todayStr && !r.notified);
      if (todayReminders.length > 0) {
        for (const reminder of todayReminders) {
          await sendWhatsAppMessage(user.phone, `🔔 *Recordatorio:* ${reminder.description}`);
        }
        const updatedReminders = (data.reminders || []).map(r =>
          todayReminders.find(tr => tr.id === r.id) ? { ...r, notified: true } : r
        );
        await saveData(user.user_id, { ...data, reminders: updatedReminders });
      }

      // Notificaciones de eventos según notifyDaysBefore
      const events = data.events || [];
      for (const ev of events) {
        if (!ev.day || !ev.notifyDaysBefore) continue;
        const daysUntil = ev.day - todayDay;
        if (daysUntil === parseInt(ev.notifyDaysBefore)) {
          const typeLabel = ev.type === 'vencimiento' ? 'vence' : ev.type === 'pago' ? 'pagás' : 'tenés';
          await sendWhatsAppMessage(user.phone,
            `🔔 *Recordatorio de Orbe*\n\nEn ${daysUntil} día${daysUntil !== 1 ? 's' : ''} ${typeLabel} *${ev.title}* (día ${ev.day}).\n\n¿Querés que te recuerde algo más?`
          );
        }
      }
    }
  } catch (err) {
    console.error('❌ Error saludo matutino:', err.message);
  }
}

// ── Check-in nocturno (~21hs) ──────────────────────────────
async function sendEveningCheckin() {
  try {
    // Distributed lock: si otra instancia ya corrió hoy, salteamos
    const lockPhone = `_scheduler_evening_${today()}`;
    const { error: lockErr } = await supabase
      .from('pending_suggestions')
      .insert({ phone: lockPhone, original_message: 'lock' });
    if (lockErr) {
      console.log('⏭️ Evening check-in ya ejecutado por otra instancia, salteando.');
      return;
    }

    const { data: users } = await supabase.from('whatsapp_users').select('phone, user_id, user_name');
    if (!users || !users.length) return;
    const { month, year } = currentMonth();
    const todayStr = today();

    for (const user of users) {
      const data = await loadData(user.user_id);
      if (!data) continue;
      if (data.silencedUntil && data.silencedUntil >= today()) continue;

      const txsHoy = data.transactions.filter(t => t.date === todayStr);
      const gastosHoy = txsHoy.filter(t => t.type === 'gasto').reduce((a, t) => a + t.amount, 0);
      const cantGastosHoy = txsHoy.filter(t => t.type === 'gasto').length;

      const txsMes = data.transactions.filter(t => {
        const p = parseDateParts(t.date);
        return p.month === month && p.year === year;
      });
      const ingresos = txsMes.filter(t => t.type === 'ingreso' || t.type === 'sueldo').reduce((a, t) => a + t.amount, 0);
      const gastos = txsMes.filter(t => t.type === 'gasto').reduce((a, t) => a + t.amount, 0);
      const balance = ingresos - gastos;
      const name = user.user_name ? user.user_name.split(' ')[0] : '';

      const eveningPrompt = `Sos Orbe, asistente financiero personal de ${name || 'tu usuario'}. Son las 9 de la noche en Argentina. Mandás un check-in nocturno breve, cálido y sin presión.

Contexto del día:
- Gastos registrados hoy: ${cantGastosHoy}${cantGastosHoy > 0 ? ` (${fmt(gastosHoy)} en total)` : ' — no registró nada'}
- Balance del mes: ${fmt(balance)}${balance < 0 ? ' (NEGATIVO)' : ''}

Tu tarea: escribí un mensaje nocturno de máximo 3 líneas. Preguntá cómo le fue en el día y si tiene algo para registrar antes de que termine. Si no registró nada hoy, podés mencionarlo con ligereza: no como reproche, sino como "¿tuviste un día tranquilo o quedó algo sin anotar?". Si el balance del mes está bien, podés ser más relajada. Sin listas, sin asteriscos. Como un mensaje de alguien que te consulta al final del día para no olvidarse nada.`;

      try {
        const msg = await callClaude(eveningPrompt, [], 'buenas noches');
        await sendWhatsAppMessage(user.phone, msg);
      } catch {
        const fallback = `Buenas noches${name ? ', ' + name : ''}! ¿Cómo te fue hoy? ¿Tenés algo para registrar antes de que cierre el día? 🌙`;
        await sendWhatsAppMessage(user.phone, fallback);
      }
    }
  } catch (err) {
    console.error('❌ Error check-in nocturno:', err.message);
  }
}

// ── Notificaciones automáticas ─────────────────────────────
async function checkAndSendNotifications() {
  try {
    const { data: users } = await supabase.from('whatsapp_users').select('phone, user_id');
    if (!users) return;
    const todayDay = arDay();
    for (const user of users) {
      const data = await loadData(user.user_id);
      if (!data || !data.events) continue;
      for (const ev of data.events) {
        if (ev.notifyDaysBefore && ev.notifyDaysBefore > 0) {
          const daysUntil = ev.day - todayDay;
          if (daysUntil === ev.notifyDaysBefore || daysUntil === 1 || daysUntil === 0) {
            const msg = daysUntil === 0
              ? `🔴 Che, hoy vence *${ev.title}*. ¿Ya lo pagaste?`
              : daysUntil === 1
              ? `⚠️ Mañana vence *${ev.title}*. Te aviso por si no lo tenías en el radar.`
              : `📅 En ${daysUntil} días vence *${ev.title}*. Te aviso con tiempo para que lo tengas listo.`;
            await sendWhatsAppMessage(user.phone, msg);
          }
        }
      }
      // Plazos fijos que vencen en los próximos 2 días
      const pfs = data.plazosFijos || [];
      for (const pf of pfs) {
        if (!pf.fechaVencimiento) continue;
        const pfDate = new Date(pf.fechaVencimiento);
        const nowDate = new Date(today());
        const diffDays = Math.round((pfDate - nowDate) / (1000 * 60 * 60 * 24));
        if (diffDays === 1 || diffDays === 0) {
          const msg = diffDays === 0
            ? `🏦 Hoy vence tu plazo fijo en *${pf.banco}* por ${fmt(pf.amount)}${pf.ganancia ? `. Ganancia: ${fmt(pf.ganancia)}` : ''}. ¿Lo renovás?`
            : `🏦 Mañana vence tu plazo fijo en *${pf.banco}* por ${fmt(pf.amount)}. Te aviso con tiempo.`;
          await sendWhatsAppMessage(user.phone, msg);
        }
      }

      // Turnos que vencen en 2 días
      const turnos = data.turnos || [];
      const in2days = new Date(today());
      in2days.setDate(in2days.getDate() + 2);
      const in2daysStr = in2days.toISOString().slice(0, 10);
      const turnosMañana = new Date(today());
      turnosMañana.setDate(turnosMañana.getDate() + 1);
      const turnosMañanaStr = turnosMañana.toISOString().slice(0, 10);

      for (const turno of turnos) {
        const typeEmoji = { médico: '🏥', banco: '🏦', trámite: '📋', veterinario: '🐾', odontólogo: '🦷', otro: '📅' };
        const emoji = typeEmoji[turno.turnoType] || '📅';
        if (turno.date === in2daysStr && !turno.notified) {
          // Recordatorio 2 días antes — marcar como notificado
          const updatedTurnos = turnos.map(t => t.id === turno.id ? { ...t, notified: true } : t);
          await saveData(user.user_id, { ...data, turnos: updatedTurnos });
          const timeStr = turno.time ? ` a las *${turno.time}hs*` : '';
          const locStr = turno.location ? `\n📍 ${turno.location}` : '';
          await sendWhatsAppMessage(user.phone, `${emoji} *Recordatorio de turno*\n\nEl pasado mañana tenés: *${turno.description}*${timeStr}${locStr}\n\n¡Que no se te pase!`);
        } else if (turno.date === turnosMañanaStr) {
          const timeStr = turno.time ? ` a las *${turno.time}hs*` : '';
          const locStr = turno.location ? `\n📍 ${turno.location}` : '';
          await sendWhatsAppMessage(user.phone, `${emoji} *¡Mañana tenés turno!*\n\n*${turno.description}*${timeStr}${locStr}\n\n¿Está todo listo?`);
        } else if (turno.date === today()) {
          const timeStr = turno.time ? ` a las *${turno.time}hs*` : '';
          await sendWhatsAppMessage(user.phone, `${emoji} *¡Hoy tenés turno!*\n\n*${turno.description}*${timeStr}\n\n¡Éxitos!`);
        }
      }
    }
  } catch (err) {
    console.error('❌ Error notificaciones:', err.message);
  }
}

// ── Reporte financiero mensual a cada usuario ───────────────
async function sendMonthlyFinancialReport() {
  try {
    const { data: users } = await supabase.from('whatsapp_users').select('phone, user_id, user_name');
    if (!users || !users.length) return;

    const { month, year } = currentMonth();
    const prevMonth = month === 0 ? 11 : month - 1;
    const prevYear  = month === 0 ? year - 1 : year;

    for (const user of users) {
      const data = await loadData(user.user_id);
      if (!data) continue;

      const txsPrev = data.transactions.filter(t => {
        const p = parseDateParts(t.date);
        return p.month === prevMonth && p.year === prevYear;
      });
      if (!txsPrev.length) continue;

      const ingresos = txsPrev.filter(t => t.type === 'ingreso' || t.type === 'sueldo').reduce((s, t) => s + t.amount, 0);
      const gastos   = txsPrev.filter(t => t.type === 'gasto').reduce((s, t) => s + t.amount, 0);
      const balance  = ingresos - gastos;

      // Gastos por categoría
      const porCat = {};
      txsPrev.filter(t => t.type === 'gasto').forEach(t => {
        porCat[t.category] = (porCat[t.category] || 0) + t.amount;
      });
      const topCats = Object.entries(porCat).sort((a, b) => b[1] - a[1]).slice(0, 5);

      const name = user.user_name ? user.user_name.split(' ')[0] : '';
      const reportPrompt = `Sos Orbe, asistente financiero de ${name || 'tu usuario'}. Es el 1° del mes y mandás el resumen financiero de ${MONTH_NAMES[prevMonth]}. Tono: cálido, directo, rioplatense. Sin listas con asteriscos — usá emojis. Máximo 6 líneas.
Datos de ${MONTH_NAMES[prevMonth]} ${prevYear}:
- Ingresos: ${fmt(ingresos)}
- Gastos totales: ${fmt(gastos)}
- Balance: ${fmt(balance)}${balance < 0 ? ' (NEGATIVO)' : ''}
- Top categorías de gasto: ${topCats.map(([c, v]) => `${c} ${fmt(v)}`).join(', ')}
${data.savings?.length ? `- Ahorros acumulados: ${fmt(data.savings.reduce((s, sv) => s + (sv.current || 0), 0))}` : ''}
Mencioná 1 cosa destacada del mes (positiva o a mejorar) y un breve aliento para el mes nuevo. Sin "¡Perfecto!" ni rellenos.`;

      try {
        const msg = await callClaude(reportPrompt, [], 'reporte mensual');
        await sendWhatsAppMessage(user.phone, `📅 *Resumen de ${MONTH_NAMES[prevMonth]} ${prevYear}*\n\n${msg}`);
      } catch {
        const balanceMsg = balance >= 0 ? `Cerraste con ${fmt(balance)} a favor 💚` : `El mes cerró en rojo: ${fmt(balance)} 😬`;
        await sendWhatsAppMessage(user.phone, `📅 *Resumen de ${MONTH_NAMES[prevMonth]} ${prevYear}*\n\n💰 Ingresos: ${fmt(ingresos)}\n💸 Gastos: ${fmt(gastos)}\n${balanceMsg}`);
      }
    }
  } catch (err) {
    console.error('❌ Error reporte financiero mensual:', err.message);
  }
}

// ── Reporte mensual de sugerencias ─────────────────────────
async function sendMonthlySuggestionReport() {
  try {
    const adminPhone = process.env.ADMIN_PHONE;
    if (!adminPhone) {
      console.log('ℹ️ ADMIN_PHONE no configurado, omitiendo reporte mensual.');
      return;
    }

    const { month, year } = currentMonth();
    const prevMonth = month === 0 ? 11 : month - 1;
    const prevYear = month === 0 ? year - 1 : year;

    const startDate = `${prevYear}-${String(prevMonth + 1).padStart(2, '0')}-01T00:00:00.000Z`;
    const endDate = `${year}-${String(month + 1).padStart(2, '0')}-01T00:00:00.000Z`;

    const { data: requests, error } = await supabase
      .from('feature_requests')
      .select('*')
      .gte('created_at', startDate)
      .lt('created_at', endDate)
      .order('created_at', { ascending: false });

    if (error) { console.error('❌ Error reporte sugerencias:', error.message); return; }

    if (!requests || requests.length === 0) {
      await sendWhatsAppMessage(adminPhone, `📊 *Reporte de sugerencias — ${MONTH_NAMES[prevMonth]} ${prevYear}*\n\nNo hubo sugerencias nuevas este mes.`);
      return;
    }

    let report = `📊 *Sugerencias de usuarios — ${MONTH_NAMES[prevMonth]} ${prevYear}*\n`;
    report += `Total: ${requests.length} sugerencia${requests.length !== 1 ? 's' : ''}\n\n`;

    requests.forEach((r, i) => {
      const quien = r.user_name || r.phone;
      report += `*${i + 1}.* ${quien}\n`;
      report += `💬 _"${r.suggestion}"_\n`;
      if (r.original_message && r.original_message !== r.suggestion) {
        report += `_(msg original: "${r.original_message}")_\n`;
      }
      report += '\n';
    });

    report += `_Evaluá cuáles son viables para integrar._`;

    // WhatsApp tiene límite de ~4096 chars, partir si es necesario
    if (report.length <= 4000) {
      await sendWhatsAppMessage(adminPhone, report);
    } else {
      const chunks = [];
      const lines = report.split('\n');
      let chunk = '';
      for (const line of lines) {
        if ((chunk + line).length > 3800) { chunks.push(chunk); chunk = ''; }
        chunk += line + '\n';
      }
      if (chunk) chunks.push(chunk);
      for (const c of chunks) await sendWhatsAppMessage(adminPhone, c);
    }

    console.log(`📊 Reporte mensual enviado: ${requests.length} sugerencias de ${MONTH_NAMES[prevMonth]}`);
  } catch (err) {
    console.error('❌ Error reporte mensual:', err.message);
  }
}

// ── Reporte semanal (lunes) ─────────────────────────────────

async function sendWeeklyReport() {
  const todayKey = today();
  if (lastWeeklyReportDay === todayKey) {
    console.log('⏭️ Reporte semanal ya enviado hoy, omitiendo duplicado.');
    return;
  }
  lastWeeklyReportDay = todayKey;
  try {
    const { data: users } = await supabase.from('whatsapp_users').select('phone, user_id, user_name');
    if (!users || !users.length) return;
    const todayStr = today();
    const weekAgo = (() => { const d = new Date(todayStr); d.setDate(d.getDate() - 7); return d.toISOString().slice(0, 10); })();

    for (const user of users) {
      const data = await loadData(user.user_id);
      if (!data) continue;
      if (data.silencedUntil && data.silencedUntil >= todayStr) continue;

      const txsSemana = data.transactions.filter(t => t.date >= weekAgo && t.date <= todayStr);
      if (!txsSemana.length) continue;

      const ingresos = txsSemana.filter(t => t.type === 'ingreso' || t.type === 'sueldo').reduce((s, t) => s + t.amount, 0);
      const gastos = txsSemana.filter(t => t.type === 'gasto').reduce((s, t) => s + t.amount, 0);
      const porCat = {};
      txsSemana.filter(t => t.type === 'gasto').forEach(t => { porCat[t.category] = (porCat[t.category] || 0) + t.amount; });
      const topCat = Object.entries(porCat).sort((a, b) => b[1] - a[1])[0];
      const name = user.user_name ? user.user_name.split(' ')[0] : '';

      const msg = `📊 *Resumen de la semana${name ? ', ' + name : ''}*\n\n💰 Ingresos: ${fmt(ingresos)}\n💸 Gastos: ${fmt(gastos)}\n✅ Balance: ${fmt(ingresos - gastos)}${topCat ? `\n\n🏆 Mayor gasto: *${topCat[0]}* (${fmt(topCat[1])})` : ''}\n\n¿Cómo arrancamos la semana? 💪`;
      await sendWhatsAppMessage(user.phone, msg);
    }
  } catch (err) {
    console.error('❌ Error reporte semanal:', err.message);
  }
}

// ── Scheduler diario (Argentina) ───────────────────────────
function scheduleAt(hour, minute, fn, label) {
  const now = arNow();
  const next = new Date(now);
  next.setHours(hour, minute, 0, 0);
  if (now >= next) next.setDate(next.getDate() + 1);
  const msUntil = next - now;
  console.log(`⏰ ${label} programado en ${Math.round(msUntil / 60000)} minutos`);
  setTimeout(() => {
    fn();
    setInterval(fn, 24 * 60 * 60 * 1000);
  }, msUntil);
}

function scheduleDaily() {
  scheduleAt(8, 30, () => {
    sendMorningGreeting().catch(e => console.error('❌ sendMorningGreeting:', e.message));
    checkAndSendNotifications().catch(e => console.error('❌ checkAndSendNotifications:', e.message));
    if (arDay() === 1) {
      sendMonthlySuggestionReport().catch(e => console.error('❌ sendMonthlySuggestionReport:', e.message));
      sendMonthlyFinancialReport().catch(e => console.error('❌ sendMonthlyFinancialReport:', e.message));
    }
  }, 'Saludo matutino');
  scheduleAt(21, 0, () => sendEveningCheckin().catch(e => console.error('❌ sendEveningCheckin:', e.message)), 'Check-in nocturno');
  // Reporte semanal los lunes a las 9am
  scheduleAt(9, 0, () => {
    const dayOfWeek = arNow().getDay(); // 1 = Monday
    if (dayOfWeek === 1) sendWeeklyReport().catch(e => console.error('❌ sendWeeklyReport:', e.message));
  }, 'Reporte semanal');
}

module.exports = { scheduleDaily };
