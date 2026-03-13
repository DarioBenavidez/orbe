require('dotenv').config();
const express = require('express');
const { createClient } = require('@supabase/supabase-js');
const Anthropic = require('@anthropic-ai/sdk');

const app = express();
app.use(express.json());

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY);
const supabaseAdmin = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_ANON_KEY, { auth: { autoRefreshToken: false, persistSession: false } });
const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

const PHONE_NUMBER_ID = process.env.PHONE_NUMBER_ID;
const WHATSAPP_TOKEN = process.env.WHATSAPP_TOKEN;
const WEBHOOK_VERIFY_TOKEN = process.env.WEBHOOK_VERIFY_TOKEN;

// ── Helpers de fecha (Argentina UTC-3) ────────────────────
function arNow() {
  return new Date(new Date().getTime() - 3 * 60 * 60 * 1000);
}
function arDay() {
  return arNow().getDate();
}
function today() {
  return arNow().toISOString().split('T')[0];
}
function currentMonth() {
  const ar = arNow();
  return { month: ar.getMonth(), year: ar.getFullYear() };
}
function parseDateParts(dateStr) {
  const [y, m, d] = dateStr.split('-').map(Number);
  return { year: y, month: m - 1, day: d };
}
function fmt(n) {
  return '$' + Math.abs(Number(n)).toLocaleString('es-AR', { maximumFractionDigits: 0 });
}
function fmtSigned(n) {
  return (n < 0 ? '-' : '') + fmt(n);
}
function getGreeting() {
  const hour = arNow().getHours();
  if (hour >= 6 && hour < 12) return 'Buenos días';
  if (hour >= 12 && hour < 20) return 'Buenas tardes';
  return 'Buenas noches';
}

const MONTH_NAMES = ['Enero','Febrero','Marzo','Abril','Mayo','Junio','Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre'];

// ── WhatsApp Meta Cloud API ────────────────────────────────
async function sendWhatsAppMessage(to, body) {
  try {
    const response = await fetch(`https://graph.facebook.com/v18.0/${PHONE_NUMBER_ID}/messages`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${WHATSAPP_TOKEN}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        messaging_product: 'whatsapp',
        to,
        type: 'text',
        text: { body },
      }),
    });
    const result = await response.json();
    if (!response.ok) console.error('❌ Error WhatsApp:', JSON.stringify(result));
    return result;
  } catch (err) {
    console.error('❌ Error sendWhatsAppMessage:', err.message);
  }
}

// ── Supabase ───────────────────────────────────────────────
function defaultData() {
  return {
    transactions: [], budgets: [], categories: {}, savings: [], debts: [], events: [],
    vocabulario: [], recurringIncomes: [],
    balanceAlert: 0,
    reminders: [],
    selectedMonth: new Date().getMonth(), selectedYear: new Date().getFullYear(),
  };
}
async function loadData(uid) {
  const { data, error } = await supabase.from('finanzas').select('data').eq('id', uid).single();
  if (error || !data || !data.data) return defaultData();
  const d = data.data;
  return {
    ...defaultData(),
    ...d,
    reminders: Array.isArray(d.reminders) ? d.reminders : [],
    balanceAlert: typeof d.balanceAlert === 'number' ? d.balanceAlert : 0,
  };
}
async function saveData(uid, payload) {
  await supabase.from('finanzas').upsert({ id: uid, data: payload, updated_at: new Date().toISOString() });
}
async function getUserIdByPhone(phone) {
  const { data, error } = await supabase.from('whatsapp_users').select('user_id, user_name').eq('phone', phone).single();
  if (error || !data) return null;
  return data;
}
async function linkPhoneToUser(phone, userId, userName) {
  const record = { phone, user_id: userId, linked_at: new Date().toISOString() };
  if (userName) record.user_name = userName;
  await supabase.from('whatsapp_users').upsert(record);
}
async function loadHistory(phone) {
  const { data, error } = await supabase.from('chat_history').select('messages').eq('phone', phone).single();
  if (error || !data) return [];
  return data.messages || [];
}
async function saveHistory(phone, messages) {
  const trimmed = messages.slice(-30);
  await supabase.from('chat_history').upsert({ phone, messages: trimmed, updated_at: new Date().toISOString() });
}

// ── Sugerencias de usuarios ────────────────────────────────
async function getPendingSuggestion(phone) {
  const { data, error } = await supabase.from('pending_suggestions').select('original_message').eq('phone', phone).single();
  if (error || !data) return null;
  return data.original_message;
}
async function savePendingSuggestion(phone, originalMessage) {
  await supabase.from('pending_suggestions').upsert({ phone, original_message: originalMessage, created_at: new Date().toISOString() });
}
async function clearPendingSuggestion(phone) {
  await supabase.from('pending_suggestions').delete().eq('phone', phone);
}
async function saveFeatureRequest(phone, userName, originalMessage, suggestion) {
  await supabase.from('feature_requests').insert({
    phone,
    user_name: userName || null,
    original_message: originalMessage,
    suggestion,
    created_at: new Date().toISOString(),
    status: 'pending',
  });
}

// ── Precio del dólar ──────────────────────────────────────
async function getDolarPrice() {
  try {
    const res = await fetch('https://api.bluelytics.com.ar/v2/latest');
    const data = await res.json();
    return {
      oficial: data.oficial?.value_sell,
      blue: data.blue?.value_sell,
    };
  } catch {
    return null;
  }
}

// ── Claude Haiku ──────────────────────────────────────────
async function callClaude(systemPrompt, history, userMessage) {
  // Asegurarse de que los mensajes alternen roles correctamente
  const rawMessages = [...history.slice(-10), { role: 'user', content: userMessage }];
  const messages = [];
  for (const msg of rawMessages) {
    if (messages.length > 0 && messages[messages.length - 1].role === msg.role) continue;
    messages.push(msg);
  }
  if (messages[0]?.role === 'assistant') messages.shift();

  const response = await anthropic.messages.create({
    model: process.env.ANTHROPIC_MODEL || 'claude-haiku-4-5',
    max_tokens: 600,
    system: systemPrompt,
    messages,
  });
  const text = response.content?.[0]?.text;
  if (!text) throw new Error('Claude devolvió respuesta vacía');
  return text.trim();
}

// ── Interpretar mensaje con Claude ────────────────────────
async function interpretMessage(userMessage, data, history, userName) {
  const { month, year } = currentMonth();
  const greeting = getGreeting();
  const name = userName || '';

  // Calcular contexto financiero actual
  const txsMes = data.transactions.filter(t => {
    const p = parseDateParts(t.date);
    return p.month === month && p.year === year;
  });
  const ingresos = txsMes.filter(t => t.type === 'ingreso' || t.type === 'sueldo').reduce((a, t) => a + t.amount, 0);
  const gastos = txsMes.filter(t => t.type === 'gasto').reduce((a, t) => a + t.amount, 0);
  const balance = ingresos - gastos;

  // Contexto mes anterior para comparaciones
  const prevMonth = month === 0 ? 11 : month - 1;
  const prevYear = month === 0 ? year - 1 : year;
  const txsPrev = data.transactions.filter(t => {
    const p = parseDateParts(t.date);
    return p.month === prevMonth && p.year === prevYear;
  });
  const ingresosPrev = txsPrev.filter(t => t.type === 'ingreso' || t.type === 'sueldo').reduce((a, t) => a + t.amount, 0);
  const gastosPrev = txsPrev.filter(t => t.type === 'gasto').reduce((a, t) => a + t.amount, 0);

  const todayDay = arDay();
  const proxVenc = (data.events || []).filter(ev => ev.day >= todayDay && ev.day <= todayDay + 7);

  const systemPrompt = `Sos Orbe, la asistente financiera personal de ${name || 'tu usuario'}. Sos su mano derecha para las finanzas: cercana, confiable y genuinamente interesada en su bienestar. No sos un bot ni una app — sos una persona de confianza con quien ${name || 'el usuario'} puede hablar de plata sin vergüenza.

QUIÉN SOS:
Hablás en español rioplatense informal, como hablaría una amiga argentina: usás "vos", "che", "dale", "re", "laburo", "un toque", etc. Tenés memoria de la conversación y hacés referencias naturales a lo que se habló antes. Notás si el usuario está estresado o preocupado y lo contenés antes de tirar números. Cuando va bien, lo felicitás con entusiasmo genuino. Tenés humor suave — cuando la situación lo permite, tirás algún comentario gracioso sin forzarlo.
IMPORTANTE — vocabulario: NUNCA uses "boludo", "pelotudo", "chabón" ni ninguna palabra vulgar o grosera. Rioplatense sí, vulgar no.

CONTEXTO ACTUAL:
- Fecha: ${today()} | ${MONTH_NAMES[month]} ${year} | Horario: ${greeting}
- ${name ? `Usuario: ${name}` : 'Usuario sin nombre registrado'}
- Ingresos del mes: ${fmt(ingresos)}
- Gastos del mes: ${fmt(gastos)}
- Balance disponible: ${fmt(balance)}${balance < 0 ? ' ← NEGATIVO, mencionalo con tacto si intenta gastar más' : ''}
- Categorías disponibles: ${Object.keys(data.categories || {}).join(', ') || 'ninguna aún'}
- Vocabulario personalizado del usuario: ${(data.vocabulario || []).length > 0 ? (data.vocabulario || []).map(v => `"${v.expresion}" → ${v.descripcion} (${v.categoria})`).join(', ') : 'ninguno aún — si usá expresiones propias, pedíle confirmación'}
- Metas de ahorro: ${data.savings?.length || 0} (total acumulado: ${fmt((data.savings || []).reduce((s, sv) => s + (sv.current || 0), 0))})${data.savings?.length > 0 ? ' — ' + data.savings.map(sv => `${sv.name}: ${fmt(sv.current)}/${fmt(sv.target)}`).join(', ') : ''}
- Deudas: ${data.debts?.length || 0} (total pendiente: ${fmt((data.debts || []).reduce((s, d) => s + d.remaining, 0))})${data.debts?.length > 0 ? ' — ' + data.debts.map(d => `${d.name}: ${fmt(d.remaining)}`).join(', ') : ''}
- Préstamos pendientes (te deben): ${(data.loans || []).filter(l => l.remaining > 0).length}${(data.loans || []).filter(l => l.remaining > 0).length > 0 ? ' — ' + (data.loans || []).filter(l => l.remaining > 0).map(l => `${l.name}: ${fmt(l.remaining)}`).join(', ') : ''}
- Gastos fijos configurados (${(data.recurringExpenses || []).filter(g => g.active).length}): ${(data.recurringExpenses || []).filter(g => g.active).length > 0 ? (data.recurringExpenses || []).filter(g => g.active).map(g => `${g.description} ${fmt(g.amount)}/mes día ${g.day}`).join(', ') : 'ninguno'}
- Ingresos fijos esperados (${(data.recurringIncomes || []).filter(r => r.active).length}): ${(data.recurringIncomes || []).filter(r => r.active).length > 0 ? (data.recurringIncomes || []).filter(r => r.active).map(r => `${r.name} ${fmt(r.amount)}/mes día ${r.day}${r.reason ? ' por ' + r.reason : ''}`).join(', ') : 'ninguno'}
- Mes anterior (${MONTH_NAMES[prevMonth]}): ingresos ${fmt(ingresosPrev)}, gastos ${fmt(gastosPrev)}${gastosPrev > 0 && gastos > gastosPrev ? ' ← este mes está gastando más que el anterior' : gastosPrev > 0 && gastos < gastosPrev * 0.8 ? ' ← este mes está gastando menos, buen dato' : ''}
${proxVenc.length > 0 ? `- Vencimientos próximos (7 días): ${proxVenc.map(ev => ev.title).join(', ')} ← mencionálos si viene al caso` : ''}
${data.balanceAlert > 0 ? `- Alerta de balance configurada: avisa cuando baje de ${fmt(data.balanceAlert)}` : ''}
${(data.reminders || []).filter(r => !r.notified).length > 0 ? `- Recordatorios pendientes: ${(data.reminders || []).filter(r => !r.notified).map(r => `"${r.description}" el ${r.date}`).join(', ')}` : ''}

TU TAREA:
Interpretá el mensaje y devolvé SOLO un JSON con la acción a realizar.

ACCIONES DISPONIBLES:
{"type":"agregar_transaccion","txType":"gasto|ingreso|sueldo","description":"...","amount":1234,"category":"...","date":"YYYY-MM-DD"}
{"type":"agregar_multiples_transacciones","transacciones":[{"txType":"gasto","description":"Pan","amount":500,"category":"Alimentación","date":"YYYY-MM-DD"},{"txType":"gasto","description":"Nafta","amount":1500,"category":"Transporte","date":"YYYY-MM-DD"}]}
{"type":"buscar_transacciones","keyword":"","category":"","dateFrom":"","dateTo":"","txType":""}
{"type":"borrar_transaccion","keyword":"...","amount":0}
{"type":"consultar_balance"}
{"type":"ultimas_transacciones"}
{"type":"consultar_presupuesto"}
{"type":"consultar_presupuesto_categoria","category":"Ropa"}
{"type":"actualizar_presupuesto","category":"Ropa","limit":5000}
{"type":"consultar_ahorros"}
{"type":"consultar_deudas"}
{"type":"consultar_vencimientos"}
{"type":"consultar_eventos"}
{"type":"agregar_evento","title":"...","day":15,"eventType":"vencimiento|pago|recordatorio","notify":true}
{"type":"eliminar_evento","keyword":"..."}
{"type":"resumen_general"}
{"type":"agregar_ingreso_recurrente","name":"Astrid","amount":150000,"reason":"venta","day":1}
{"type":"agregar_prestamo","name":"Claudio","amount":4000,"reason":"coca cola"}
{"type":"registrar_pago_prestamo","name":"Claudio","amount":100}
{"type":"consultar_prestamo","name":"Claudio"}
{"type":"consultar_todos_prestamos"}
{"type":"registrar_gastos_fijos","date":"YYYY-MM-DD"}
{"type":"agregar_gasto_fijo","description":"Gimnasio","amount":8000,"category":"Salud","day":1}
{"type":"actualizar_gasto_fijo","keyword":"internet","day":5,"amount":0,"description":""}
{"type":"eliminar_gasto_fijo","keyword":"gimnasio"}
{"type":"consolidar_prestamos","name":"Samy"}
{"type":"agregar_ahorro","name":"Vacaciones","target":50000,"current":0}
{"type":"depositar_ahorro","keyword":"vacaciones","amount":5000}
{"type":"agregar_deuda","name":"Tarjeta Visa","remaining":30000,"installment":5000}
{"type":"pagar_deuda","keyword":"visa","amount":5000}
{"type":"consultar_dolar"}
{"type":"simular_sin_gasto","keyword":"netflix","amount":0}
{"type":"planear_compra","name":"auto","amount":5000000,"months":12}
{"type":"gasto_en_dolares","description":"Netflix","amountUSD":15,"category":"Entretenimiento","date":"YYYY-MM-DD","source":"tarjeta"}
{"type":"guardar_vocabulario","expresion":"el chino","descripcion":"Chino del barrio","categoria":"Comida"}
{"type":"confirmar_vocabulario","expresion":"gym","interpretacion":"Gimnasio","categoria":"Salud","tx":{"txType":"gasto","description":"Gimnasio","amount":5000,"category":"Salud","date":"YYYY-MM-DD"}}
{"type":"editar_transaccion","keyword":"sueldo","newAmount":1600000,"newDescription":"","newCategory":""}
{"type":"limpiar_transacciones","scope":"mes"}
{"type":"proyectar_fin_de_mes"}
{"type":"resumen_mes","month":3,"year":2026}
{"type":"comparar_meses","month1":2,"year1":2026,"month2":3,"year2":2026}
{"type":"analisis_historico"}
{"type":"configurar_alerta_balance","amount":50000}
{"type":"agregar_categoria","name":"Mascotas","icon":"🐾"}
{"type":"agregar_recordatorio","description":"Pagar seguro","date":"YYYY-MM-DD"}
{"type":"gasto_compartido","description":"Alquiler","amount":200000,"category":"Vivienda","sharedWith":"pareja","date":"YYYY-MM-DD"}
{"type":"conversacion","respuesta":"..."}
{"type":"unknown"}

REGLAS DE INTERPRETACIÓN:
- FECHAS RELATIVAS: siempre resolvé las fechas relativas usando la fecha actual (${today()}). "ayer" = ${(()=>{const d=new Date(today());d.setDate(d.getDate()-1);return d.toISOString().slice(0,10)})()}, "anteayer" = ${(()=>{const d=new Date(today());d.setDate(d.getDate()-2);return d.toISOString().slice(0,10)})()}, "el lunes/martes/etc" = el día más reciente con ese nombre. Siempre incluí el campo "date" con la fecha resuelta en formato YYYY-MM-DD.
- MÚLTIPLES GASTOS en un solo mensaje ("hoy gasté X en A, Y en B y Z en C", "compré pan 500, leche 300, nafta 1500") → SIEMPRE agregar_multiples_transacciones con array de transacciones. NUNCA agregar_transaccion repetido.
- "cuánto gasté en X", "buscar gastos de X", "mostrar todos los gastos de X", "cuándo fue la última vez que pagué X", "gastos del mes pasado" → buscar_transacciones (keyword: término a buscar, category: categoría si menciona, dateFrom/dateTo: rango YYYY-MM-DD si aplica, txType: "gasto" o "ingreso" si especifica)
- "gasté/pagué/compré/salí" → txType "gasto"
- "cobré/sueldo/me depositaron/me pagaron/entró plata" → txType "sueldo" o "ingreso"
- "me debe/le presté/le fié/fiado" → agregar_prestamo
- "X me pagó/me devolvió/abonó" → registrar_pago_prestamo
- "¿a cuánto está el dólar? / cotización / precio del dólar / blue" → consultar_dolar SOLO cuando preguntan el precio. "quiero comprar dólares / me conviene comprar dólares / qué hago con los dólares" → conversacion (consejo financiero, NO consultar_dolar)
- "tengo eventos?", "qué eventos tengo?", "mostrá mis eventos", "qué tengo anotado?", "cuáles son mis eventos?" → consultar_eventos (muestra TODOS los eventos sin importar si ya pasaron este mes)
- "qué vence?", "qué tengo que pagar?", "vencimientos del mes?", "qué me vence este mes?" → consultar_vencimientos (solo próximos del mes actual)
- "quiero ahorrar X para Y / quiero juntar X para Y / estoy ahorrando para Y" → SIEMPRE agregar_ahorro (target=X, name=Y). NUNCA agregar_evento.
- "agregá X al ahorro de Y / depositá X en Y / sumá X para Y / puse X en el ahorro" → SIEMPRE depositar_ahorro (keyword=Y, amount=X). NUNCA agregar_transaccion.
- "unir los préstamos de X / consolidar / juntá todo de X" → consolidar_prestamos
- "nueva deuda/debo/tengo una deuda/saqué una tarjeta/cuota" → agregar_deuda
- "pagué la deuda/pagué la cuota/aboné la tarjeta" → pagar_deuda
- "qué pasaría si dejo de pagar/si cancelo/si me doy de baja/si elimino X" → simular_sin_gasto (si el usuario menciona un monto explícito, usalo en amount; si no, dejá amount en 0 para que se busque en los registros)
- "quiero comprar/me quiero comprar/estoy pensando en comprar/cómo llego a/cómo ahorro para" → planear_compra (si el usuario menciona un plazo, usalo en months; si no, omitilo)
- "gasté X dólares/USD", "pagué X USD", "compré en dólares", "usé mis dólares", "gasté en dólares" → gasto_en_dolares (source: "tarjeta" si menciona tarjeta/crédito/débito, "cuenta" si dice cuenta/efectivo/mis dólares/ahorros)
- "X me paga/viene pagando Y por mes", "tengo un ingreso mensual de Y de X", "X me debe pagar Y todos los meses", "acuerdo de pago mensual con X" → agregar_ingreso_recurrente (name: quien paga, amount: monto mensual, reason: motivo si se menciona, day: día del mes si se menciona)
- "ya pagué mis gastos fijos", "pagué todos los fijos", "este mes pagué los gastos fijos", "ya aboné los gastos del mes" → registrar_gastos_fijos (date: fecha que mencione o today si no dice)
- "cambiá el día de X al Y", "pasá el gasto fijo X al día Y", "actualizá el monto de X a Y", "el X ahora cuesta Y", "poneles el día Y a todos los gastos fijos" → actualizar_gasto_fijo (keyword: nombre del gasto o "todos" si aplica a todos, day y/o amount solo si se mencionan, omitir los que no cambian)
- "chau / hasta luego / buenas noches / nos vemos" AL FINAL de una conversación o junto a "gracias" → conversacion con despedida breve. NUNCA disparar el saludo completo en una despedida.
- "borrá/eliminá todo el historial", "empezar de cero", "limpiá todo", "quiero borrar todo", "borrá todas las transacciones" → limpiar_transacciones (scope: "mes" si dice "de este mes", "todo" si dice "todo" o "empezar de cero")
- "borrá/eliminá/quitá/sacá el gasto/ingreso de X", "borrá el X", "ese no va" → borrar_transaccion (keyword: parte del nombre/descripción/categoría, amount: monto si lo mencionan para asegurarse de borrar la correcta, omitir si no especifica)
- "corregí/cambié/el X era Y/el monto del X era Y/modificá el X a Y" → editar_transaccion (keyword: parte de la descripción, newAmount si cambia monto, newDescription si cambia descripción, newCategory si cambia categoría — solo los campos que se modifican)
- "cuando diga/digo X es/significa/quiero decir Y", "aprendé que X es Y", "guardá que X es Y", "X = Y" (enseñanza explícita de vocabulario) → guardar_vocabulario (categoria: inferila del contexto o usá "Otros")
- Hay palabras genéricas que son SIEMPRE ambiguas porque pueden referirse a muchas cosas distintas: "cuota", "pago", "factura", "el pago", "la cuenta", "el servicio", "la mensualidad". Si el usuario las usa SIN especificar de qué (ej: "pagué la cuota", "aboné la factura"), NO asumas ni uses confirmar_vocabulario — usá conversacion para preguntar "¿cuota de qué?" o "¿factura de qué servicio?". Si el usuario YA especificó (ej: "pagué la cuota del auto", "cuota del colegio"), procesá normalmente.
- Si el mensaje incluye una expresión coloquial, abreviación o apodo propio del usuario (ej: "gym", "el super", "el kiosco", "el chino") que NO está en el vocabulario aprendido y cuyo significado podría ser ambiguo, devolvé "confirmar_vocabulario" con tu mejor interpretación como sugerencia. Si la expresión YA está en el vocabulario aprendido, usala directamente sin preguntar. Si la expresión es completamente obvia y universal (ej: "supermercado", "restaurante", "taxi", "comida", "farmacia"), NO preguntes — usá agregar_transaccion directamente.
- "cómo voy a terminar el mes", "me alcanza para fin de mes", "cuánto me queda para gastar" → proyectar_fin_de_mes
- "cómo me fue en enero/febrero/etc", "resumen de [mes]", "qué pasó en [mes]" → resumen_mes (month: número 1-12, year: año)
- "compará enero con febrero", "cómo estuvo X vs Y", "diferencia entre mes X e Y" → comparar_meses
- "en qué mes gasté más", "cuál fue mi peor mes", "análisis de todo el año", "historial completo" → analisis_historico
- "avisame si mi balance baja de X", "alerta si tengo menos de X", "recordame cuando tenga menos de X" → configurar_alerta_balance
- "creá la categoría X", "agregá categoría X con emoji Y", "nueva categoría X" → agregar_categoria
- "recordame el [fecha] que [descripción]", "poné un recordatorio para el [fecha]" → agregar_recordatorio (date: fecha resuelta YYYY-MM-DD)
- "dividí con X el gasto de Y", "gasté Z con mi pareja/amigo/familiar en X", "gasto compartido" → gasto_compartido (amount: monto TOTAL, la mitad se registra automáticamente)
- "qué me recomendás", "conviene que...", "qué hago con...", "es buen momento para..." → conversacion (Claude responde con consejo financiero personalizado usando el contexto disponible)

CÓMO RAZONÁS (lo más importante):
Pensás antes de responder. No das respuestas automáticas. Te hacés preguntas: ¿qué está necesitando realmente esta persona? ¿hay algo en los números que debería mencionar aunque no me lo pidió? ¿el contexto financiero cambia lo que voy a decir?

Ejemplos de razonamiento proactivo:
- Si alguien registra un gasto grande y el balance queda justo, lo mencionás algo como: "Anotado. Con esto te quedan unos [monto disponible] para lo que resta del mes."
- Si el balance es negativo y el usuario quiere gastar más, primero lo avisás con cariño, sin drama.
- Si ves que hay un vencimiento próximo y el usuario mencionó algo relacionado, conectás los puntos.
- Si el mensaje es ambiguo (¿fue gasto personal o del laburo? ¿de hoy o de ayer?), preguntás antes de asumir.
- Si algo no tiene sentido financiero, lo decís — con tacto, pero lo decís.

CÓMO MANEJAR "conversacion":
- Frases cortas. Sin asteriscos ni listas. Como un WhatsApp de alguien de confianza.
- JAMÁS empieces con "¡Perfecto!", "¡Genial!", "¡Claro que sí!", "¡Por supuesto!", "¡Absolutamente!" ni ningún relleno adulador.
- SIEMPRE usá "vos": "tenés razón", "sabés qué", "qué decís". NUNCA "tienes", "sabes", "qué dices" (eso es castellano de España, no rioplatense).
- Variá cómo abrís cada mensaje: no siempre igual.
- Si el usuario está estresado o preocupado, primero escuchá. Después los números.
- Si hay algo de la conversación previa que sea relevante, referencíalo natural, no forzado.
- Podés preguntar cómo está si el contexto lo pide — pero solo una pregunta, no un cuestionario.
- Si no entendés algo, pedí que te lo repita sin hacerlo incómodo.
- Tenés opiniones propias sobre finanzas y las compartís cuando viene al caso — no como un sermón, como una amiga que sabe del tema.

NUNCA devuelvas texto fuera del JSON. Devolvé SOLO el JSON.`;

  const text = await callClaude(systemPrompt, history, userMessage);
  try { return JSON.parse(text); } catch {
    const match = text.match(/\{[\s\S]*\}/);
    if (match) return JSON.parse(match[0]);
    return { type: 'conversacion', respuesta: text };
  }
}

// ── Procesar acciones ──────────────────────────────────────
async function processAction(action, data, userId, userName, history = [], phone = null) {
  const { month, year } = currentMonth();
  const name = userName || '';

  switch (action.type) {

    case 'saludo': {
      const greeting = getGreeting();
      const todayStr = today();
      const txsHoy = data.transactions.filter(t => t.date === todayStr);
      const txsMes2 = data.transactions.filter(t => {
        const p = parseDateParts(t.date);
        return p.month === month && p.year === year;
      });
      const ingresosMes = txsMes2.filter(t => t.type === 'ingreso' || t.type === 'sueldo').reduce((a, t) => a + t.amount, 0);
      const gastosMes = txsMes2.filter(t => t.type === 'gasto').reduce((a, t) => a + t.amount, 0);
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

      const saludoPrompt = `Sos Orbe, la asistente financiera personal de ${name || 'tu usuario'}. Sos cálida, empática, cercana y hablás en español rioplatense informal. No sos un bot, sos una persona de confianza.

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
      const updated = {
        ...original,
        ...(action.newAmount    ? { amount:      parseFloat(action.newAmount) }   : {}),
        ...(action.newDescription ? { description: action.newDescription }         : {}),
        ...(action.newCategory  ? { category:    action.newCategory }             : {}),
      };
      const newTxs = txs.map((t, i) => i === realIdx ? updated : t);
      await saveData(userId, { ...data, transactions: newTxs });
      const cambios = [];
      if (action.newAmount)      cambios.push(`monto: ${fmt(original.amount)} → ${fmt(updated.amount)}`);
      if (action.newDescription) cambios.push(`descripción: "${original.description}" → "${updated.description}"`);
      if (action.newCategory)    cambios.push(`categoría: ${original.category} → ${updated.category}`);
      return `✏️ *Transacción actualizada*\n\n📝 ${updated.description}\n${cambios.join('\n')}`;
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
      const tx = {
        id: Date.now().toString(),
        type: action.txType || 'gasto',
        description: action.description,
        amount: parseFloat(action.amount),
        category: action.category || 'Otros',
        date: action.date || today(),
        savingsId: '',
        note: action.note || '',
      };
      const allTxs = [...data.transactions, tx];
      await saveData(userId, { ...data, transactions: allTxs });

      // Bienvenida especial cuando llega el sueldo
      if (tx.type === 'sueldo') {
        const gastosFijos = (data.recurringExpenses || []).filter(g => g.active).reduce((a, g) => a + g.amount, 0);
        const gastosMes = allTxs.filter(t => {
          const p = parseDateParts(t.date);
          return p.month === month && p.year === year && t.type === 'gasto';
        }).reduce((a, t) => a + t.amount, 0);
        const disponible = tx.amount - gastosMes;
        const sueldoPrompt = `Sos Orbe, asistente financiera de ${name || 'tu usuario'}. Hablás en español rioplatense informal. El usuario acaba de registrar su sueldo — es el momento más importante del mes. Felicitálo con calidez y decile lo que le queda disponible después de los gastos. Si tiene gastos fijos configurados, mencioná cuánto absorben. Si tiene metas de ahorro activas (${data.savings?.length || 0}), sugerí separar algo. Sin listas ni asteriscos. Máximo 4 líneas.
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
          const spentCat = allTxs.filter(t => {
            const p = parseDateParts(t.date);
            return p.month === month && p.year === year && t.type === 'gasto' && t.category.toLowerCase() === tx.category.toLowerCase();
          }).reduce((a, t) => a + t.amount, 0);
          const pct = Math.round((spentCat / budget.limit) * 100);
          if (pct >= 100) {
            respuesta += `\n\n🔴 Pasaste el presupuesto de *${tx.category}* (${pct}% usado). Te fuiste ${fmt(spentCat - budget.limit)} del límite.`;
          } else if (pct >= 80) {
            respuesta += `\n\n🟡 Ya usaste el ${pct}% del presupuesto de *${tx.category}*. Te quedan ${fmt(budget.limit - spentCat)}.`;
          }
        }

        // Aviso si el balance queda justo después del gasto
        const ingMes = allTxs.filter(t => {
          const p = parseDateParts(t.date);
          return p.month === month && p.year === year && (t.type === 'ingreso' || t.type === 'sueldo');
        }).reduce((a, t) => a + t.amount, 0);
        const gastMes = allTxs.filter(t => {
          const p = parseDateParts(t.date);
          return p.month === month && p.year === year && t.type === 'gasto';
        }).reduce((a, t) => a + t.amount, 0);
        const balanceNuevo = ingMes - gastMes;
        if (balanceNuevo < 0) {
          respuesta += `\n\n⚠️ Con esto el mes quedó en rojo: ${fmtSigned(balanceNuevo)}.`;
        } else if (balanceNuevo < tx.amount * 2) {
          respuesta += `\n\nTe quedan ${fmt(balanceNuevo)} para lo que resta del mes.`;
        }

        // Alerta de balance bajo
        if (data.balanceAlert > 0) {
          const newIngresos = allTxs.filter(t => { const p = parseDateParts(t.date); return p.month === month && p.year === year && (t.type === 'ingreso' || t.type === 'sueldo'); }).reduce((s, t) => s + t.amount, 0);
          const newGastos = allTxs.filter(t => { const p = parseDateParts(t.date); return p.month === month && p.year === year && t.type === 'gasto'; }).reduce((s, t) => s + t.amount, 0);
          const newBalance = newIngresos - newGastos;
          if (newBalance < data.balanceAlert) {
            respuesta += `\n\n⚠️ *Alerta:* tu balance bajó a ${fmt(newBalance)}, por debajo del límite que configuraste (${fmt(data.balanceAlert)}).`;
          }
        }
      }

      return respuesta;
    }

    case 'agregar_multiples_transacciones': {
      const items = Array.isArray(action.transacciones) ? action.transacciones : [];
      if (!items.length) return `🤔 No encontré transacciones para registrar.`;
      const nuevas = items.map(t => ({
        id: Date.now().toString() + Math.random().toString(36).slice(2),
        type: t.txType || 'gasto',
        description: t.description || 'Sin descripción',
        amount: parseFloat(t.amount) || 0,
        category: t.category || 'Otros',
        date: t.date || today(),
        savingsId: '',
      }));
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
      // Buscar la transacción más reciente del mes actual que matchee keyword en descripción O categoría
      const txsRev = [...data.transactions].reverse();
      const found = txsRev.find(t => {
        const p = parseDateParts(t.date);
        if (p.month !== cm || p.year !== cy) return false;
        const matchDesc = t.description?.toLowerCase().includes(keyword);
        const matchCat = t.category?.toLowerCase().includes(keyword);
        if (!matchDesc && !matchCat) return false;
        if (targetAmount > 0) return Math.abs(t.amount - targetAmount) < 1;
        return true;
      });
      if (!found) return `🤔 No encontré ninguna transacción de este mes que coincida con *"${action.keyword}"*${targetAmount > 0 ? ` por ${fmt(targetAmount)}` : ''}.`;
      const newTxs = data.transactions.filter(t => t.id !== found.id);
      await saveData(userId, { ...data, transactions: newTxs });
      return `🗑️ Listo, eliminé *${found.description}* (${fmt(found.amount)}) del ${found.date}.`;
    }

    case 'limpiar_transacciones': {
      const scope = action.scope || 'mes';
      const { month: cm, year: cy } = currentMonth();
      const count = scope === 'todo'
        ? data.transactions.length
        : data.transactions.filter(t => { const p = parseDateParts(t.date); return p.month === cm && p.year === cy; }).length;
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
      const txsMes = data.transactions.filter(t => {
        const p = parseDateParts(t.date);
        return p.month === cm && p.year === cy;
      });
      const ingresos = txsMes.filter(t => t.type === 'ingreso' || t.type === 'sueldo').reduce((s, t) => s + t.amount, 0);
      const gastos = txsMes.filter(t => t.type === 'gasto').reduce((s, t) => s + t.amount, 0);
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
      const txs = data.transactions.filter(t => {
        const p = parseDateParts(t.date);
        return p.month === targetMonth && p.year === targetYear;
      });
      if (!txs.length) return `📭 No hay transacciones registradas en ${MONTH_NAMES[targetMonth]} ${targetYear}.`;
      const ingresos = txs.filter(t => t.type === 'ingreso' || t.type === 'sueldo').reduce((s, t) => s + t.amount, 0);
      const gastos = txs.filter(t => t.type === 'gasto').reduce((s, t) => s + t.amount, 0);
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
      const txs1 = data.transactions.filter(t => { const p = parseDateParts(t.date); return p.month === m1 && p.year === y1; });
      const txs2 = data.transactions.filter(t => { const p = parseDateParts(t.date); return p.month === m2 && p.year === y2; });
      const ing1 = txs1.filter(t => t.type === 'ingreso' || t.type === 'sueldo').reduce((s, t) => s + t.amount, 0);
      const gst1 = txs1.filter(t => t.type === 'gasto').reduce((s, t) => s + t.amount, 0);
      const ing2 = txs2.filter(t => t.type === 'ingreso' || t.type === 'sueldo').reduce((s, t) => s + t.amount, 0);
      const gst2 = txs2.filter(t => t.type === 'gasto').reduce((s, t) => s + t.amount, 0);
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
        id: Date.now().toString(),
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
        id: Date.now().toString(),
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
      const txs = data.transactions.filter(t => {
        const { month: m, year: y } = parseDateParts(t.date);
        return m === month && y === year && t.type === 'gasto' && t.category.toLowerCase() === action.category.toLowerCase();
      });
      const spent = txs.reduce((a, t) => a + t.amount, 0);
      const budget = data.budgets.find(b => b.cat.toLowerCase() === action.category.toLowerCase());
      if (!budget || !budget.limit) return `📭 No tenés presupuesto configurado para *${action.category}*.\n\n¿Querés que te agregue uno? Decime el monto.`;
      const pct = Math.round((spent / budget.limit) * 100);
      return `${pct >= 100 ? '🔴' : pct >= 80 ? '🟡' : '🟢'} *Presupuesto ${action.category}*\n\n💸 Gastado: ${fmt(spent)}\n🎯 Límite: ${fmt(budget.limit)}\n📊 Uso: ${pct}%\n💰 Disponible: ${fmt(Math.max(0, budget.limit - spent))}`;
    }

    case 'consultar_balance': {
      const txs = data.transactions.filter(t => { const { month: m, year: y } = parseDateParts(t.date); return m === month && y === year; });
      const ingresos = txs.filter(t => t.type === 'ingreso' || t.type === 'sueldo').reduce((a, t) => a + t.amount, 0);
      const gastos = txs.filter(t => t.type === 'gasto').reduce((a, t) => a + t.amount, 0);
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
      const txs = data.transactions.filter(t => { const { month: m, year: y } = parseDateParts(t.date); return m === month && y === year; }).slice(-5).reverse();
      if (!txs.length) return `📭 No hay transacciones este mes todavía${name ? ', ' + name : ''}. ¡Empezá registrando algo!`;
      return `🕐 *Últimas transacciones*\n\n${txs.map(t => `${t.type === 'gasto' ? '💸' : '💰'} ${t.description} — ${fmt(t.amount)} (${t.date})`).join('\n')}`;
    }

    case 'consultar_presupuesto': {
      const txs = data.transactions.filter(t => { const { month: m, year: y } = parseDateParts(t.date); return m === month && y === year && t.type === 'gasto'; });
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
      return `💳 *Tus deudas*\n\n${data.debts.map(d => `💳 *${d.name}*: ${fmt(d.remaining)}${d.installment > 0 ? ` · cuota ${fmt(d.installment)}` : ''}`).join('\n')}\n\n📊 Total: ${fmt(total)}`;
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
      const ev = { id: Date.now().toString(), title: action.title, day: parseInt(action.day), type: action.eventType || 'recordatorio', notifyDaysBefore: action.notify ? 3 : 0 };
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
      const loan = { id: Date.now().toString(), name: action.name, reason: action.reason || '', amount: parseFloat(action.amount), remaining: parseFloat(action.amount), payments: [], createdAt: today() };
      await saveData(userId, { ...data, loans: [...loans, loan] });
      return `📋 *Préstamo registrado!*\n\n👤 ${action.name} te debe ${fmt(action.amount)}${action.reason ? `\n📝 Por: ${action.reason}` : ''}\n📅 ${today()}\n\nCuando pague algo, avisame y lo registro.`;
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
      await saveData(userId, { ...data, loans });

      if (totalDespues === 0) {
        return `🎉 *${action.name} saldó todo!*\n\nPagó ${fmt(parseFloat(action.amount))} y quedó en cero. ¡Cerramos esa deuda!`;
      }
      return `💵 *Pago registrado!*\n\n👤 ${action.name} pagó ${fmt(parseFloat(action.amount))}\n💰 Le queda pendiente: ${fmt(totalDespues)}`;
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
        resp += activos.map(l => `• ${l.reason || 'Préstamo'}: ${fmt(l.remaining)}`).join('\n') + '\n';
        resp += `\n💰 Total pendiente: ${fmt(totalRest)}\n`;
      } else {
        resp += `💰 Original: ${fmt(totalOrig)}\n💸 Pagado: ${fmt(pagadoTotal)}\n⏳ Queda: ${fmt(totalRest)}\n`;
        if (activos[0]?.reason) resp += `📝 Por: ${activos[0].reason}\n`;
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
        if (loan.remaining <= 0) continue; // ignorar pagados
        const key = loan.name.toLowerCase();
        if (!porPersona[key]) porPersona[key] = { name: loan.name, total: 0, items: [] };
        porPersona[key].total += loan.remaining;
        if (loan.reason) porPersona[key].items.push(loan.reason);
      }

      const activos = Object.values(porPersona);
      if (!activos.length) return `📭 No tenés préstamos pendientes${name ? ', ' + name : ''}. ¡Todo al día!`;

      const totalGlobal = activos.reduce((s, p) => s + p.total, 0);
      const lineas = activos.map(p => {
        const detalle = p.items.length > 0 ? ` (${p.items.join(', ')})` : '';
        return `👤 *${p.name}*: ${fmt(p.total)}${detalle}`;
      });
      return `📋 *Préstamos pendientes*\n\n${lineas.join('\n')}\n\n💰 Total que te deben: ${fmt(totalGlobal)}`;
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
        id: Date.now().toString(),
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
      const sv = {
        id: Date.now().toString(),
        name: action.name,
        target: parseFloat(action.target),
        current: parseFloat(action.current || 0),
        history: [],
      };
      await saveData(userId, { ...data, savings: [...savings, sv] });
      return `🐷 *Meta de ahorro creada!*\n\n📝 ${sv.name}\n🎯 Objetivo: ${fmt(sv.target)}${sv.current > 0 ? `\n💰 Ya tenés: ${fmt(sv.current)}` : ''}\n\nCuando quieras depositar, decime: *"depositá $X en ${sv.name}"*`;
    }

    case 'depositar_ahorro': {
      const savings = data.savings || [];
      const idx = savings.findIndex(sv => sv.name.toLowerCase().includes(action.keyword.toLowerCase()));
      if (idx === -1) return `🤔 No encontré ninguna meta de ahorro que coincida con *${action.keyword}*. ¿Cómo se llama exactamente?`;
      const sv = { ...savings[idx] };
      const monto = parseFloat(action.amount);
      sv.current = (sv.current || 0) + monto;
      sv.history = [...(sv.history || []), { date: today(), amount: monto }];
      savings[idx] = sv;
      const pct = Math.round((sv.current / sv.target) * 100);
      const tx = { id: Date.now().toString(), type: 'ahorro_meta', description: `Ahorro: ${sv.name}`, amount: monto, category: 'Ahorro', date: today(), savingsId: sv.id };
      await saveData(userId, { ...data, savings, transactions: [...data.transactions, tx] });
      if (sv.current >= sv.target) return `🎉 *¡Meta cumplida!*\n\n🐷 ${sv.name}: ${fmt(sv.current)} / ${fmt(sv.target)} (100%)\n\n¡Llegaste a tu objetivo! ¿Querés crear una nueva meta?`;
      return `🐷 *Depósito registrado!*\n\n📝 ${sv.name}\n💰 Depositaste: ${fmt(monto)}\n📊 Acumulado: ${fmt(sv.current)} / ${fmt(sv.target)} (${pct}%)\n${pct >= 80 ? '¡Ya casi llegás! 🔥' : `Falta ${fmt(sv.target - sv.current)} para la meta.`}`;
    }

    case 'agregar_deuda': {
      const debts = data.debts || [];
      const installment = parseFloat(action.installment || 0);
      const remaining = parseFloat(action.remaining);
      const ri = installment > 0 ? Math.ceil(remaining / installment) : 0;
      const deuda = {
        id: Date.now().toString(),
        name: action.name,
        total: remaining,
        remaining,
        installment,
        remainingInstallments: ri,
      };
      await saveData(userId, { ...data, debts: [...debts, deuda] });
      return `💳 *Deuda registrada!*\n\n📝 ${deuda.name}\n💸 Monto: ${fmt(remaining)}${installment > 0 ? `\n📆 Cuota mensual: ${fmt(installment)}\n🗓️ Cuotas estimadas: ${ri}` : ''}\n\nTe aviso cuando llegues al límite de presupuesto.`;
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
      const tx = { id: Date.now().toString(), type: 'gasto', description: `Pago: ${deuda.name}`, amount: monto, category: 'Préstamo tarjeta', date: today(), savingsId: '' };
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
      const gasto = { id: Date.now().toString(), description: action.description, amount: parseFloat(action.amount), category: action.category || 'Otros', day: parseInt(action.day) || 1, active: true };
      await saveData(userId, { ...data, recurringExpenses: [...recurringExpenses, gasto] });
      return `🔄 *Gasto fijo agregado!*\n\n📝 ${gasto.description}: ${fmt(gasto.amount)}/mes\n📆 Se registra el día ${gasto.day} automáticamente.`;
    }

    case 'agregar_ingreso_recurrente': {
      const ri = {
        id: Date.now().toString(),
        name: action.name,
        amount: parseFloat(action.amount),
        reason: action.reason || '',
        day: parseInt(action.day) || 1,
        active: true,
      };
      const recurringIncomes = [...(data.recurringIncomes || []), ri];
      await saveData(userId, { ...data, recurringIncomes });
      return `💰 *Ingreso mensual registrado!*\n\n👤 ${ri.name}\n💵 ${fmt(ri.amount)}/mes${ri.reason ? `\n📝 Por: ${ri.reason}` : ''}\n📆 Esperado el día ${ri.day} de cada mes\n\nCuando llegue el pago, decime y lo registro como ingreso.`;
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
        id: Date.now().toString(),
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
      const txs = data.transactions.filter(t => { const { month: m, year: y } = parseDateParts(t.date); return m === month && y === year; });
      const ingresos = txs.filter(t => t.type === 'ingreso' || t.type === 'sueldo').reduce((a, t) => a + t.amount, 0);
      const gastos = txs.filter(t => t.type === 'gasto').reduce((a, t) => a + t.amount, 0);
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
          const total = data.transactions
            .filter(t => {
              const p = parseDateParts(t.date);
              return p.month === mm && p.year === yy &&
                t.type === 'gasto' &&
                t.description.toLowerCase().includes(keyword);
            })
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
        const txs = data.transactions.filter(t => {
          const p = parseDateParts(t.date); return p.month === mm && p.year === yy;
        });
        const ing = txs.filter(t => t.type === 'ingreso' || t.type === 'sueldo').reduce((s, t) => s + t.amount, 0);
        const gst = txs.filter(t => t.type === 'gasto').reduce((s, t) => s + t.amount, 0);
        if (ing > 0 || gst > 0) { totalIng += ing; totalGst += gst; mesesConDatos++; }
      }
      const ingMedio = mesesConDatos > 0 ? Math.round(totalIng / mesesConDatos) : 0;
      const gstMedio = mesesConDatos > 0 ? Math.round(totalGst / mesesConDatos) : 0;
      const superavitActual = ingMedio - gstMedio;
      const superavitNuevo = superavitActual + costoMensual;

      const prompt = `Sos Orbe, asistente financiera de ${name || 'tu usuario'}. Hablás en español rioplatense informal, sin asteriscos, como una amiga que sabe de finanzas. El usuario te preguntó qué pasaría si deja de pagar "${action.keyword}".

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
        const txs = data.transactions.filter(t => {
          const p = parseDateParts(t.date); return p.month === mm && p.year === yy;
        });
        const ing = txs.filter(t => t.type === 'ingreso' || t.type === 'sueldo').reduce((s, t) => s + t.amount, 0);
        const gst = txs.filter(t => t.type === 'gasto').reduce((s, t) => s + t.amount, 0);
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

      const prompt = `Sos Orbe, asistente financiera de ${name || 'tu usuario'}. Hablás en español rioplatense informal, sin asteriscos, como una amiga que genuinamente quiere ayudar. El usuario quiere comprar "${nombreCompra}"${objetivo > 0 ? ` que sale ${fmt(objetivo)}` : ''}.

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
  ? `El usuario no tiene margen de ahorro mensual ahora mismo. Sé honesta pero empática — explicá la situación, sugerí primero reducir gastos o aumentar ingresos antes de planificar esa compra.`
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

    case 'conversacion':
      return action.respuesta || `Contame, ¿en qué te puedo ayudar${name ? ', ' + name : ''}? 💚`;

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

      const txsMes = data.transactions.filter(t => {
        const p = parseDateParts(t.date);
        return p.month === month && p.year === year;
      });
      const ingresos = txsMes.filter(t => t.type === 'ingreso' || t.type === 'sueldo').reduce((a, t) => a + t.amount, 0);
      const gastos = txsMes.filter(t => t.type === 'gasto').reduce((a, t) => a + t.amount, 0);
      const balance = ingresos - gastos;

      const todayDay = arDay();
      const proxVenc = (data.events || []).filter(ev => ev.day >= todayDay && ev.day <= todayDay + 3);
      const name = user.user_name || '';

      const morningPrompt = `Sos Orbe, la asistente financiera personal de ${name || 'tu usuario'}. Sos cálida, empática, cercana. Hablás en español rioplatense informal. Sos la primera en escribirle al usuario cada mañana.

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
      const name = user.user_name || '';

      const eveningPrompt = `Sos Orbe, asistente financiera personal de ${name || 'tu usuario'}. Son las 9 de la noche en Argentina. Mandás un check-in nocturno breve, cálido y sin presión.

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
      const reportPrompt = `Sos Orbe, asistente financiera de ${name || 'tu usuario'}. Es el 1° del mes y mandás el resumen financiero de ${MONTH_NAMES[prevMonth]}. Tono: cálido, directo, rioplatense. Sin listas con asteriscos — usá emojis. Máximo 6 líneas.
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
}
if (process.env.NODE_ENV !== 'test') scheduleDaily();

// ── Webhook: verificación Meta ─────────────────────────────
app.get('/webhook', (req, res) => {
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
app.post('/webhook', async (req, res) => {
  res.sendStatus(200); // Siempre responder 200 inmediatamente a Meta

  try {
    const entry = req.body.entry?.[0];
    const change = entry?.changes?.[0];
    const message = change?.value?.messages?.[0];

    if (!message || message.type !== 'text') return;

    const from = message.from;
    const incomingMsg = message.text?.body?.trim();
    if (!incomingMsg) return;

    console.log(`📩 ${from}: ${incomingMsg}`);

    // Activación legacy — formato: ORBE_ACTIVATE:userId:Nombre (compatibilidad hacia atrás)
    if (incomingMsg.startsWith('ORBE_ACTIVATE:')) {
      const parts = incomingMsg.replace('ORBE_ACTIVATE:', '').split(':');
      const userId   = parts[0]?.trim();
      const userName = parts[1]?.trim() || null;
      if (userId) {
        await linkPhoneToUser(from, userId, userName);
        const greeting  = getGreeting();
        const firstName = userName ? userName.split(' ')[0] : null;
        const saludo    = firstName ? `${greeting}, ${firstName}` : greeting;
        await sendWhatsAppMessage(from, `✅ *¡${saludo}! Soy Orbe, tu asistente financiera personal* 🌟\n\nYa estamos conectados. Desde ahora podés registrar gastos, consultar tu balance, pedir el precio del dólar y mucho más, todo por acá sin abrir la app.\n\nProbá con:\n• *"hola"*\n• *"balance"*\n• *"gasté $500 en café"*\n• *"¿a cuánto está el dólar?"*`);
      }
      return;
    }

    const userInfo = await getUserIdByPhone(from);
    if (!userInfo) {
      // Si tiene un email pendiente de confirmación, intentar vincularlo
      const pendingRawLink = await getPendingSuggestion(from);
      if (pendingRawLink) {
        try {
          const parsed = JSON.parse(pendingRawLink);
          if (parsed.type === 'awaiting_email') {
            // El usuario respondió con su email
            const email = incomingMsg.trim().toLowerCase();
            // Validar que parezca un email antes de buscar
            if (!email.includes('@')) {
              await savePendingSuggestion(from, JSON.stringify({ type: 'awaiting_email' }));
              await sendWhatsAppMessage(from, `Eso no parece un email. Escribime el email con el que te registraste en Orbe (ej: *nombre@gmail.com*).`);
              return;
            }
            try {
              const { data: listData, error: authErr } = await supabaseAdmin.auth.admin.listUsers({ perPage: 1000 });
              const users = listData?.users || [];
              if (!authErr) {
                const found = users.find(u => u.email?.toLowerCase() === email);
                if (found) {
                  const userName = found.user_metadata?.full_name || found.user_metadata?.nombre || (found.email || email).split('@')[0];
                  await linkPhoneToUser(from, found.id, userName);
                  await clearPendingSuggestion(from);
                  const greeting = getGreeting();
                  const firstName = userName.split(' ')[0];
                  await sendWhatsAppMessage(from, `✅ *¡${greeting}, ${firstName}! Soy Orbe* 🌟\n\nYa estamos conectados. Podés registrar gastos, consultar tu balance y mucho más por acá.\n\nProbá con:\n• *"hola"*\n• *"balance"*\n• *"gasté $500 en café"*`);
                  return;
                }
              }
              await clearPendingSuggestion(from);
              await sendWhatsAppMessage(from, `🤔 No encontré ninguna cuenta con el email *${email}*.\n\nSi todavía no te registraste, descargá la app de Orbe, creá tu cuenta y después volvé por acá. 📱\n\nSi ya tenés cuenta, asegurate de escribir el mismo email con el que te registraste.`);
            } catch (err) {
              console.error('❌ Error buscando usuario por email:', err.message);
              await clearPendingSuggestion(from);
              await sendWhatsAppMessage(from, `😓 Hubo un error buscando tu cuenta. Intentá de nuevo en un momento.`);
            }
            return;
          }
        } catch {}
      }

      // Primer contacto — pedir email
      await savePendingSuggestion(from, JSON.stringify({ type: 'awaiting_email' }));
      await sendWhatsAppMessage(from, `👋 ¡Hola! Soy *Orbe*, tu asistente financiera personal.\n\nPara conectar tu cuenta, escribime el *email* con el que te registraste en la app de Orbe.`);
      return;
    }

    const { user_id: userId, user_name: userName } = userInfo;
    const data = await loadData(userId);

    const history = await loadHistory(from);

    // ── Flujo de transacción USD pendiente ─────────────────
    const pendingRaw = await getPendingSuggestion(from);
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
      } catch {}
    }

    if (pendingUSD) {
      await clearPendingSuggestion(from);
      const msgLwr = incomingMsg.toLowerCase();

      // Detectar si el usuario especificó un monto ARS concreto (cuando cierra la tarjeta)
      const montoMatch = incomingMsg.match(/\$\s*([\d.,]+)/);
      const montoEspecifico = montoMatch
        ? parseFloat(montoMatch[1].replace(/\./g, '').replace(',', '.'))
        : null;

      const querePesos    = /\bpeso|conver|tipo.*hoy|sí\b|si\b|dale\b|listo\b|registr|anotar|ok\b/i.test(incomingMsg);
      const quereDolares  = /\bdólar|dolar|pendiente|despu[eé]|luego|no\b/i.test(incomingMsg);

      let amountARS;
      let nota;

      if (montoEspecifico) {
        // Usuario trajo el monto real (ej: cuando cerró la tarjeta)
        amountARS = montoEspecifico;
        nota = `USD ${pendingUSD.amountUSD} → ${fmt(amountARS)} al cierre`;
      } else if (quereDolares && !querePesos) {
        // Guardar en dólares: convertir igualmente para el balance pero marcar como USD
        amountARS = pendingUSD.dolarBlue ? Math.round(pendingUSD.amountUSD * pendingUSD.dolarBlue) : 0;
        nota = `USD ${pendingUSD.amountUSD} (conversión pendiente al cierre)`;
      } else {
        // Convertir al tipo guardado (blue del momento en que se registró)
        amountARS = pendingUSD.dolarBlue ? Math.round(pendingUSD.amountUSD * pendingUSD.dolarBlue) : 0;
        nota = `USD ${pendingUSD.amountUSD} al blue ${fmt(pendingUSD.dolarBlue)}`;
      }

      const isPending = quereDolares && !querePesos && !montoEspecifico;
      const tx = {
        id: Date.now().toString(),
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
      } else if (isPending) {
        confirmMsg = `📌 Lo marqué como pendiente. Registré ${fmt(amountARS)} como aproximación al blue de hoy. Cuando cierre la tarjeta, mandame el monto real y lo corrijo.`;
      } else {
        confirmMsg = `💸 Anotado: ${fmt(amountARS)} por *${pendingUSD.description}* (USD ${pendingUSD.amountUSD} al blue ${pendingUSD.dolarBlue ? fmt(pendingUSD.dolarBlue) : ''}).`;
      }

      await saveHistory(from, [...history, { role: 'user', content: incomingMsg }, { role: 'assistant', content: confirmMsg }]);
      await sendWhatsAppMessage(from, confirmMsg);
      return;
    }

    // ── Flujo de confirmación de limpiar transacciones ─────
    if (pendingLimpiar) {
      await clearPendingSuggestion(from);
      const confirmado = /^confirmar$/i.test(incomingMsg.trim());
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
        // El usuario mencionó cuáles sí — filtrar por los que nombró
        gastosARegistrar = pendingGastosFijos.gastos.filter(g =>
          incomingMsg.toLowerCase().includes(g.description.toLowerCase())
        );
        if (!gastosARegistrar.length) {
          // No matcheó ninguno, re-preguntar
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
        id: Date.now().toString() + Math.random().toString(36).slice(2),
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
          id: Date.now().toString(),
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
        // Respuesta ambigua — volver a preguntar
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
        id: Date.now().toString(),
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
      // Es un string plano (no JSON conocido) → feature request
      await saveFeatureRequest(from, userName, pendingRaw, incomingMsg);
      await clearPendingSuggestion(from);
      const confirmPrompt = `Sos Orbe, asistente financiera. El usuario acaba de explicarte en detalle algo que querían hacer y que no pudiste interpretar. Agradecéle de forma genuina y breve que se haya tomado el tiempo. Decile que lo guardaste para evaluarlo y que si es viable lo sumás próximamente. Español rioplatense informal. Sin asteriscos. Máximo 2 líneas.`;
      const confirmMsg = await callClaude(confirmPrompt, [], incomingMsg);
      await saveHistory(from, [...history, { role: 'user', content: incomingMsg }, { role: 'assistant', content: confirmMsg }]);
      await sendWhatsAppMessage(from, confirmMsg);
      return;
    }

    // Detecciones directas (sin gastar tokens de Claude)
    const saludos = ['hola', 'buenas', 'hey', 'buen dia', 'buen día', 'buenos dias', 'buenos días', 'buenas tardes', 'que tal', 'qué tal', 'como estas', 'cómo estás'];
    const despedidas = ['chau', 'bye', 'hasta luego', 'nos vemos', 'hasta mañana', 'buenas noches'];
    const msgLower = incomingMsg.toLowerCase().trim();

    // Despedida: "buenas noches", "gracias, chau", etc. — va antes del saludo para no confundirlas
    const esDespedida = despedidas.some(d => msgLower === d || msgLower.endsWith(d) || msgLower.includes(d)) &&
      (despedidas.some(d => msgLower === d) || /gracias|hasta|chau|bye|nos vemos/i.test(msgLower));

    const esSaludo = !esDespedida && saludos.some(s => msgLower === s || msgLower.startsWith(s + ' ') || msgLower.endsWith(' ' + s));

    const palabrasPago = ['ya pague', 'ya pagué', 'pague el', 'pagué el', 'pague la', 'pagué la', 'abone', 'aboné', 'abonó'];
    const esPago = palabrasPago.some(s => msgLower.startsWith(s) || msgLower.includes(s));

    let action;
    if (esDespedida) {
      // Despedida breve sin disparar el saludo completo
      const despedidaMsg = name
        ? `Buenas noches${name ? ', ' + name.split(' ')[0] : ''}! Que descanses. 🌙`
        : `Buenas noches! Que descanses. 🌙`;
      await saveHistory(from, [...history, { role: 'user', content: incomingMsg }, { role: 'assistant', content: despedidaMsg }]);
      await sendWhatsAppMessage(from, despedidaMsg);
      return;
    } else if (esSaludo) {
      action = { type: 'saludo' };
    } else if (esPago) {
      const montoMatch = incomingMsg.match(/\$?([\d.,]+)/);
      let desc = incomingMsg
        .replace(/ya pagu[eé]|pagu[eé]|abon[oó]/gi, '')
        .replace(/\b(el|la|los|las|un|una)\b/gi, '')
        .replace(/\$?[\d.,]+/g, '')
        .trim();
      if (montoMatch) {
        const amount = parseFloat(montoMatch[1].replace(/\./g, '').replace(',', '.'));
        action = { type: 'pagar_y_eliminar_evento', description: desc || 'Pago', amount, category: 'Otros', date: today() };
      } else {
        action = { type: 'conversacion', respuesta: '¿Cuánto fue el pago? Decime el monto y lo registro como gasto 💸' };
      }
    } else if (/cotizacion|cotización|blue|a cu[aá]nto.*dol|precio.*dol|valor.*dol/i.test(incomingMsg) && !/gast[eé]|pagu[eé]|compr[eé]|us[eé]|sal[ií]/i.test(incomingMsg)) {
      action = { type: 'consultar_dolar' };
    } else if (/tengo.*eventos|mis eventos|qué.*eventos|cuáles.*eventos|que.*eventos|cuales.*eventos/i.test(incomingMsg)) {
      action = { type: 'consultar_eventos' };
    } else if (/venc[ei]|vence|vencimiento|qué.*pagar|que.*pagar/i.test(incomingMsg)) {
      action = { type: 'consultar_vencimientos' };
    } else if (/balance|saldo|cuánto.*tengo|cuanto.*tengo/i.test(incomingMsg)) {
      action = { type: 'consultar_balance' };
    } else if (/resumen|cómo.*voy|como.*voy/i.test(incomingMsg)) {
      action = { type: 'resumen_general' };

    // ── Fast-detect ahorros (evita que Claude los confunda con eventos) ──
    } else if (/\b(quiero|quier[eo]|quiero|junt[ao]|estoy)\b.*(ahorrar|juntar|guardar).*(para|por)\b/i.test(incomingMsg)) {
      // "quiero ahorrar 200 para un auto" → agregar_ahorro
      const amountMatch = incomingMsg.match(/[\d.,]+/);
      const amount = amountMatch ? parseFloat(amountMatch[0].replace(/\./g, '').replace(',', '.')) : 0;
      const nameMatch = incomingMsg.match(/para\s+(?:un[ao]?\s+)?(.+)/i);
      const savingName = nameMatch ? nameMatch[1].trim() : 'Meta de ahorro';
      action = { type: 'agregar_ahorro', name: savingName, target: amount, current: 0 };

    } else if (/\b(agrega[rá]?|deposit[aá]?|sum[aá]?|pon[eé]?|puse|agregué|deposité)\b.*(ahorro|meta|para el ahorro|para la meta)/i.test(incomingMsg)) {
      // "agregá 50 para el ahorro del auto" → depositar_ahorro
      const amountMatch = incomingMsg.match(/[\d.,]+/);
      const amount = amountMatch ? parseFloat(amountMatch[0].replace(/\./g, '').replace(',', '.')) : 0;
      const keyMatch = incomingMsg.match(/(?:ahorro|meta)\s+(?:de(?:l)?\s+)?(.+)/i) ||
                       incomingMsg.match(/para\s+(?:el\s+)?(?:ahorro|meta)\s+(?:de(?:l)?\s+)?(.+)/i);
      const keyword = keyMatch ? keyMatch[1].trim() : '';
      action = { type: 'depositar_ahorro', keyword, amount };

    } else {
      action = await interpretMessage(incomingMsg, data, history, userName);
    }

    console.log('🤖 Acción:', JSON.stringify(action));
    const respuesta = await processAction(action, data, userId, userName, history, from);

    // Si no entendió, guardar el mensaje original para capturar el detalle en el próximo turno
    if (action.type === 'unknown') {
      await savePendingSuggestion(from, incomingMsg);
    }

    await saveHistory(from, [...history, { role: 'user', content: incomingMsg }, { role: 'assistant', content: respuesta }]);
    await sendWhatsAppMessage(from, respuesta);

  } catch (err) {
    console.error('❌ Error webhook:', err.message);
  }
});

app.get('/', (req, res) => res.json({ status: 'ok', app: 'Orbe', version: '5.0.0' }));

if (process.env.NODE_ENV !== 'test') {
  const PORT = process.env.PORT || 3000;
  app.listen(PORT, () => console.log(`🚀 Orbe v5.0 en puerto ${PORT}`));
}

if (process.env.NODE_ENV === 'test') {
  module.exports = { processAction, interpretMessage, defaultData, fmt, today };
}
