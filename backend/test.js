/**
 * Orbe — Test suite
 * Uso: node test.js
 */

// ── Mock de variables de entorno ──────────────────────────
process.env.NODE_ENV           = 'test';
process.env.SUPABASE_URL       = 'https://mock.supabase.co';
process.env.SUPABASE_ANON_KEY  = 'mock-key';
process.env.ANTHROPIC_API_KEY  = 'mock-key';
process.env.PHONE_NUMBER_ID    = 'mock-phone';
process.env.WHATSAPP_TOKEN     = 'mock-token';
process.env.WEBHOOK_VERIFY_TOKEN = 'mock-verify';

// ── Mock de módulos externos ───────────────────────────────
const Module = require('module');
const _load  = Module._load.bind(Module);

// Datos inyectables para tests de acciones de escritura
// processAction recarga datos desde Supabase para acciones de escritura —
// este mock devuelve los datos de prueba en lugar de null
let _mockDbData = null;
function setMockData(d) { _mockDbData = d; }
function clearMockData() { _mockDbData = null; }

const chain = new Proxy({}, {
  get(_, prop) {
    if (prop === 'single') return () => Promise.resolve(
      _mockDbData ? { data: { data: _mockDbData }, error: null } : { data: null, error: null }
    );
    if (['upsert','insert','delete'].includes(prop))
      return () => Promise.resolve({ data: null, error: null });
    return () => chain;
  }
});

Module._load = function(req, parent, isMain) {
  if (req === 'dotenv') return { config: () => {} };
  if (req === '@supabase/supabase-js')
    return { createClient: () => ({ from: () => chain }) };
  if (req === '@anthropic-ai/sdk')
    return class Anthropic {
      messages = {
        create: async ({ messages }) => {
          const last = (messages[messages.length - 1]?.content || '').slice(0, 40);
          return { content: [{ text: `{"type":"conversacion","respuesta":"Mock: ${last}"}` }] };
        }
      };
    };
  return _load(req, parent, isMain);
};

// ── Importar módulos ────────────────────────────────────────
const { processAction }    = require('./actions/index.js');
const { interpretMessage } = require('./ai/interpret.js');
const { defaultData }      = require('./lib/supabase.js');
const { fmt, today }       = require('./lib/helpers.js');

// ── Datos de prueba ───────────────────────────────────────
function mockData(overrides) {
  const base = {
    ...defaultData(),
    transactions: [
      { id: '1', type: 'sueldo',  description: 'Sueldo',        amount: 1500000, category: 'Ingreso', date: today(), savingsId: '' },
      { id: '2', type: 'gasto',   description: 'Supermercado',  amount:   50000, category: 'Comida',  date: today(), savingsId: '' },
    ],
    budgets:   [{ cat: 'Comida', limit: 100000 }, { cat: 'Salud', limit: 50000 }],
    categories: { Comida: '🛒', Salud: '💊', Transporte: '🚗' },
    savings:  [{ id: 's1', name: 'Vacaciones', target: 200000, current: 40000,  history: [] }],
    debts:    [{ id: 'd1', name: 'Tarjeta Visa', total: 80000, remaining: 80000, installment: 16000, remainingInstallments: 5 }],
    loans:    [{ id: 'l1', name: 'Claudio', amount: 10000, remaining: 8000, reason: 'prestamo', payments: [], createdAt: today() }],
    events:   [{ id: 'e1', title: 'Vencimiento Visa', day: 20, type: 'vencimiento', notifyDaysBefore: 3 }],
    recurringExpenses: [
      { id: 'r1', description: 'Internet', amount: 25000, category: 'Servicios', day: 5, active: true },
      { id: 'r2', description: 'Nafta',    amount: 50000, category: 'Auto',      day: 5, active: true },
    ],
    recurringIncomes: [{ id: 'ri1', name: 'Astrid', amount: 150000, reason: 'venta', day: 10, active: true }],
    vocabulario: [{ expresion: 'super', descripcion: 'Supermercado', categoria: 'Comida' }],
  };
  return overrides ? { ...base, ...overrides } : base;
}

const UID   = 'user-test-123';
const NAME  = 'Dario Test';
const PHONE = '5491100000000';

// ── Runner ─────────────────────────────────────────────────
let passed = 0, failed = 0;
const results = [];

async function test(group, name, fn) {
  try {
    await fn();
    results.push({ group, name, ok: true });
    passed++;
  } catch (e) {
    results.push({ group, name, ok: false, err: e.message });
    failed++;
  }
}

function assert(cond, msg)       { if (!cond)              throw new Error(msg || 'Aserción fallida'); }
function assertStr(val)          { if (typeof val !== 'string' || !val.trim()) throw new Error(`Esperaba string, recibí: ${JSON.stringify(val)}`); }
function assertIncludes(str, s)  { if (!str?.includes(s))  throw new Error(`"${str?.slice(0,80)}..." no incluye "${s}"`); }

// Helper que inyecta datos en el mock de Supabase antes de llamar a processAction.
// Necesario porque las acciones de escritura recargan datos frescos desde Supabase,
// descartando el parámetro `data`. setMockData hace que el mock devuelva los datos del test.
async function act(action, data, ...args) {
  setMockData(data);
  try { return await processAction(action, data, ...args); }
  finally { clearMockData(); }
}

// ═══════════════════════════════════════════════════════════
(async () => {

// ── Transacciones ─────────────────────────────────────────
await test('Transacciones', 'agregar gasto', async () => {
  const r = await act({ type:'agregar_transaccion', txType:'gasto', description:'Almuerzo', amount:3000, category:'Comida', date:today() }, mockData(), UID, NAME, [], PHONE);
  assertStr(r); assertIncludes(r, '3.000');
});

await test('Transacciones', 'agregar ingreso', async () => {
  const r = await act({ type:'agregar_transaccion', txType:'ingreso', description:'Freelance', amount:50000, category:'Ingreso', date:today() }, mockData(), UID, NAME, [], PHONE);
  assertStr(r); assertIncludes(r, '50.000');
});

await test('Transacciones', 'agregar sueldo no crashea', async () => {
  const r = await act({ type:'agregar_transaccion', txType:'sueldo', description:'Sueldo', amount:1500000, category:'Ingreso', date:today() }, mockData(), UID, NAME, [], PHONE);
  assertStr(r);
});

await test('Transacciones', 'alerta presupuesto al 80%', async () => {
  const d = mockData({ budgets:[{ cat:'Comida', limit:100000 }] });
  const r = await act({ type:'agregar_transaccion', txType:'gasto', description:'Super', amount:85000, category:'Comida', date:today() }, d, UID, NAME, [], PHONE);
  assertIncludes(r, '%');
});

await test('Transacciones', 'alerta presupuesto al 100%', async () => {
  const d = mockData({ budgets:[{ cat:'Comida', limit:100000 }] });
  const r = await act({ type:'agregar_transaccion', txType:'gasto', description:'Super', amount:110000, category:'Comida', date:today() }, d, UID, NAME, [], PHONE);
  assertIncludes(r, 'Pasaste');
});

await test('Transacciones', 'últimas transacciones con datos', async () => {
  const r = await act({ type:'ultimas_transacciones' }, mockData(), UID, NAME);
  assertStr(r); assertIncludes(r, 'Últimas');
});

await test('Transacciones', 'últimas transacciones vacío', async () => {
  const r = await act({ type:'ultimas_transacciones' }, mockData({ transactions:[] }), UID, NAME);
  assertIncludes(r, 'No hay');
});

// ── Balance y Resumen ──────────────────────────────────────
await test('Balance', 'consultar_balance muestra ingresos y gastos', async () => {
  const r = await act({ type:'consultar_balance' }, mockData(), UID, NAME);
  assertIncludes(r, 'Ingresos'); assertIncludes(r, 'Gastos'); assertIncludes(r, 'Disponible');
});

await test('Balance', 'consultar_balance muestra gastos fijos y estimado', async () => {
  const r = await act({ type:'consultar_balance' }, mockData(), UID, NAME);
  assertIncludes(r, 'Gastos fijos'); assertIncludes(r, 'Estimado');
});

await test('Balance', 'resumen_general completo', async () => {
  const r = await act({ type:'resumen_general' }, mockData(), UID, NAME);
  assertIncludes(r, 'Resumen'); assertIncludes(r, 'Ingresos'); assertIncludes(r, 'Te deben');
});

await test('Balance', 'resumen incluye gastos fijos pendientes', async () => {
  const r = await act({ type:'resumen_general' }, mockData(), UID, NAME);
  assertIncludes(r, 'Gastos fijos');
});

// ── Presupuestos ──────────────────────────────────────────
await test('Presupuestos', 'consultar_presupuesto con datos', async () => {
  const r = await act({ type:'consultar_presupuesto' }, mockData(), UID, NAME);
  assertStr(r);
});

await test('Presupuestos', 'consultar_presupuesto vacío', async () => {
  const r = await act({ type:'consultar_presupuesto' }, mockData({ budgets:[] }), UID, NAME);
  assertIncludes(r, 'No');
});

await test('Presupuestos', 'consultar_presupuesto_categoria existente', async () => {
  const r = await act({ type:'consultar_presupuesto_categoria', category:'Comida' }, mockData(), UID, NAME);
  assertIncludes(r, 'Comida'); assertIncludes(r, '100.000');
});

await test('Presupuestos', 'consultar_presupuesto_categoria inexistente', async () => {
  const r = await act({ type:'consultar_presupuesto_categoria', category:'Viajes' }, mockData(), UID, NAME);
  assertIncludes(r, 'presupuesto');
});

await test('Presupuestos', 'actualizar_presupuesto nuevo', async () => {
  const r = await act({ type:'actualizar_presupuesto', category:'Ropa', limit:30000 }, mockData(), UID, NAME);
  assertIncludes(r, 'Ropa'); assertIncludes(r, '30.000');
});

// ── Eventos ───────────────────────────────────────────────
await test('Eventos', 'agregar_evento', async () => {
  const r = await act({ type:'agregar_evento', title:'Pago Gas', day:15, eventType:'vencimiento', notify:true }, mockData(), UID, NAME);
  assertIncludes(r, 'Pago Gas'); assertIncludes(r, '15');
});

await test('Eventos', 'eliminar_evento existente', async () => {
  const r = await act({ type:'eliminar_evento', keyword:'Visa' }, mockData(), UID, NAME);
  assertIncludes(r, 'elimin');
});

await test('Eventos', 'eliminar_evento inexistente', async () => {
  const r = await act({ type:'eliminar_evento', keyword:'XYZ' }, mockData(), UID, NAME);
  assertIncludes(r, 'encontr');
});

await test('Eventos', 'consultar_vencimientos', async () => {
  const r = await act({ type:'consultar_vencimientos' }, mockData(), UID, NAME);
  assertStr(r);
});

// ── Préstamos (te deben) ──────────────────────────────────
await test('Préstamos', 'agregar_prestamo', async () => {
  const r = await act({ type:'agregar_prestamo', name:'Pedro', amount:5000, reason:'cena' }, mockData(), UID, NAME);
  assertIncludes(r, 'Pedro'); assertIncludes(r, '5.000');
});

await test('Préstamos', 'registrar_pago parcial', async () => {
  const r = await act({ type:'registrar_pago_prestamo', name:'Claudio', amount:3000 }, mockData(), UID, NAME);
  assertIncludes(r, 'Claudio'); assertIncludes(r, '3.000');
});

await test('Préstamos', 'registrar_pago que salda', async () => {
  const r = await act({ type:'registrar_pago_prestamo', name:'Claudio', amount:8000 }, mockData(), UID, NAME);
  assertIncludes(r, 'saldó');
});

await test('Préstamos', 'consultar_prestamo existente', async () => {
  const r = await act({ type:'consultar_prestamo', name:'Claudio' }, mockData(), UID, NAME);
  assertIncludes(r, 'Claudio');
});

await test('Préstamos', 'consultar_prestamo inexistente', async () => {
  const r = await act({ type:'consultar_prestamo', name:'Nadie' }, mockData(), UID, NAME);
  assertIncludes(r, 'encontr');
});

await test('Préstamos', 'consultar_todos_prestamos con datos', async () => {
  const r = await act({ type:'consultar_todos_prestamos' }, mockData(), UID, NAME);
  assertIncludes(r, 'Claudio');
});

await test('Préstamos', 'consultar_todos_prestamos vacío', async () => {
  const r = await act({ type:'consultar_todos_prestamos' }, mockData({ loans:[] }), UID, NAME);
  assertIncludes(r, 'No tenés');
});

// ── Deudas ────────────────────────────────────────────────
await test('Deudas', 'agregar_deuda', async () => {
  const r = await act({ type:'agregar_deuda', name:'Tarjeta Naranja', remaining:40000, installment:8000 }, mockData(), UID, NAME);
  assertIncludes(r, 'Naranja'); assertIncludes(r, '40.000');
});

await test('Deudas', 'pagar_deuda parcial', async () => {
  const r = await act({ type:'pagar_deuda', keyword:'Visa', amount:16000 }, mockData(), UID, NAME);
  assertIncludes(r, '16.000');
});

await test('Deudas', 'pagar_deuda que salda', async () => {
  const r = await act({ type:'pagar_deuda', keyword:'Visa', amount:80000 }, mockData(), UID, NAME);
  assertIncludes(r, 'saldada');
});

await test('Deudas', 'pagar_deuda inexistente', async () => {
  const r = await act({ type:'pagar_deuda', keyword:'XYZ', amount:1000 }, mockData(), UID, NAME);
  assertIncludes(r, 'encontr');
});

await test('Deudas', 'consultar_deudas con datos', async () => {
  const r = await act({ type:'consultar_deudas' }, mockData(), UID, NAME);
  assertIncludes(r, 'Visa');
});

await test('Deudas', 'consultar_deudas vacío', async () => {
  const r = await act({ type:'consultar_deudas' }, mockData({ debts:[] }), UID, NAME);
  assertIncludes(r, 'No tenés');
});

// ── Ahorros ───────────────────────────────────────────────
await test('Ahorros', 'agregar_ahorro', async () => {
  const r = await act({ type:'agregar_ahorro', name:'Moto', target:500000, current:0 }, mockData(), UID, NAME);
  assertIncludes(r, 'Moto'); assertIncludes(r, '500.000');
});

await test('Ahorros', 'depositar_ahorro parcial', async () => {
  const r = await act({ type:'depositar_ahorro', keyword:'vacaciones', amount:20000 }, mockData(), UID, NAME);
  assertIncludes(r, '20.000'); assertIncludes(r, 'Vacaciones');
});

await test('Ahorros', 'depositar_ahorro completa meta', async () => {
  const d = mockData({ savings:[{ id:'s1', name:'Vacaciones', target:200000, current:10000, history:[] }] });
  const r = await act({ type:'depositar_ahorro', keyword:'vacaciones', amount:200000 }, d, UID, NAME);
  assertIncludes(r, 'cumplida');
});

await test('Ahorros', 'depositar_ahorro inexistente', async () => {
  const r = await act({ type:'depositar_ahorro', keyword:'XYZ', amount:1000 }, mockData(), UID, NAME);
  assertIncludes(r, 'encontr');
});

await test('Ahorros', 'consultar_ahorros con datos', async () => {
  const r = await act({ type:'consultar_ahorros' }, mockData(), UID, NAME);
  assertIncludes(r, 'Vacaciones');
});

await test('Ahorros', 'consultar_ahorros vacío', async () => {
  const r = await act({ type:'consultar_ahorros' }, mockData({ savings:[] }), UID, NAME);
  assertIncludes(r, 'No tenés');
});

// ── Gastos Fijos ──────────────────────────────────────────
await test('Gastos fijos', 'agregar_gasto_fijo', async () => {
  const r = await act({ type:'agregar_gasto_fijo', description:'Gym', amount:15000, category:'Salud', day:5 }, mockData(), UID, NAME);
  assertIncludes(r, 'Gym'); assertIncludes(r, '15.000');
});

await test('Gastos fijos', 'actualizar por nombre', async () => {
  const r = await act({ type:'actualizar_gasto_fijo', keyword:'internet', day:10 }, mockData(), UID, NAME);
  assertIncludes(r, 'día → 10');
});

await test('Gastos fijos', 'actualizar todos', async () => {
  const r = await act({ type:'actualizar_gasto_fijo', keyword:'todos', day:5 }, mockData(), UID, NAME);
  assertIncludes(r, 'todos los gastos fijos');
});

await test('Gastos fijos', 'eliminar_gasto_fijo', async () => {
  const r = await act({ type:'eliminar_gasto_fijo', keyword:'nafta' }, mockData(), UID, NAME);
  assertIncludes(r, 'desactivé');
});

await test('Gastos fijos', 'registrar pide confirmación', async () => {
  const r = await act({ type:'registrar_gastos_fijos', date:today() }, mockData(), UID, NAME, [], PHONE);
  assertIncludes(r, 'Internet'); assertIncludes(r, 'Nafta'); assertIncludes(r, 'Sí');
});

await test('Gastos fijos', 'registrar sin gastos configurados', async () => {
  const r = await act({ type:'registrar_gastos_fijos', date:today() }, mockData({ recurringExpenses:[] }), UID, NAME, [], PHONE);
  assertIncludes(r, 'No tenés');
});

// ── Ingresos recurrentes ───────────────────────────────────
await test('Ingresos recurrentes', 'agregar_ingreso_recurrente', async () => {
  const r = await act({ type:'agregar_ingreso_recurrente', name:'Juan', amount:50000, reason:'alquiler', day:5 }, mockData(), UID, NAME);
  assertIncludes(r, 'Juan'); assertIncludes(r, '50.000'); assertIncludes(r, 'día 5');
});

// ── Vocabulario ───────────────────────────────────────────
await test('Vocabulario', 'guardar_vocabulario nuevo', async () => {
  const r = await act({ type:'guardar_vocabulario', expresion:'chino', descripcion:'Chino del barrio', categoria:'Comida' }, mockData(), UID, NAME);
  assertIncludes(r, 'chino'); assertIncludes(r, 'Chino del barrio');
});

await test('Vocabulario', 'guardar_vocabulario sobreescribe existente', async () => {
  const r = await act({ type:'guardar_vocabulario', expresion:'super', descripcion:'Super chino', categoria:'Comida' }, mockData(), UID, NAME);
  assertIncludes(r, 'super');
});

await test('Vocabulario', 'confirmar_vocabulario guarda pending', async () => {
  const r = await act({ type:'confirmar_vocabulario', expresion:'gym', interpretacion:'Gimnasio', categoria:'Salud', tx:{ txType:'gasto', description:'Gimnasio', amount:5000, category:'Salud', date:today() } }, mockData(), UID, NAME, [], PHONE);
  assertIncludes(r, 'gym'); assertIncludes(r, 'Gimnasio');
});

// ── Conversación y edge cases ─────────────────────────────
await test('Edge cases', 'conversacion devuelve respuesta directa', async () => {
  const r = await act({ type:'conversacion', respuesta:'Hola!' }, mockData(), UID, NAME);
  assert(r === 'Hola!', `Esperaba "Hola!", recibí "${r}"`);
});

await test('Edge cases', 'conversacion sin respuesta da fallback', async () => {
  const r = await act({ type:'conversacion', respuesta:'' }, mockData(), UID, NAME);
  assertStr(r);
});

await test('Edge cases', 'type unknown no crashea', async () => {
  const r = await act({ type:'unknown' }, mockData(), UID, NAME);
  assertStr(r);
});

await test('Edge cases', 'action desconocida no crashea', async () => {
  const r = await act({ type:'accion_inexistente' }, mockData(), UID, NAME);
  assertStr(r);
});

await test('Edge cases', 'fmt formatea correctamente', () => {
  assert(fmt(1500000) === '$1.500.000', `fmt(1500000) = ${fmt(1500000)}`);
  assert(fmt(0)       === '$0',         `fmt(0) = ${fmt(0)}`);
});

await test('Edge cases', 'defaultData tiene todos los campos', () => {
  const d = defaultData();
  for (const c of ['transactions','budgets','categories','savings','debts','events','vocabulario','recurringIncomes','selectedMonth','selectedYear'])
    assert(c in d, `Falta campo: ${c}`);
});

// ── interpretMessage ──────────────────────────────────────
await test('interpretMessage', 'retorna objeto con type', async () => {
  const r = await interpretMessage('gasté 5000 en comida', mockData(), [], NAME);
  assert(typeof r === 'object' && 'type' in r, `Esperaba objeto con type, recibí: ${JSON.stringify(r)}`);
});

await test('interpretMessage', 'no crashea con mensaje vacío', async () => {
  const r = await interpretMessage('', mockData(), [], NAME);
  assert(typeof r === 'object', 'Debería retornar objeto');
});

await test('interpretMessage', 'no crashea con historial largo (35 msgs)', async () => {
  const history = Array.from({ length: 35 }, (_, i) => ({ role: i % 2 === 0 ? 'user' : 'assistant', content: `msg ${i}` }));
  const r = await interpretMessage('balance', mockData(), history, NAME);
  assert(typeof r === 'object', 'Debería retornar objeto');
});

// ═══════════════════════════════════════════════════════════
//  REPORTE FINAL
// ═══════════════════════════════════════════════════════════

console.log('\n' + '═'.repeat(55));
console.log('  ORBE — Resultados del test');
console.log('═'.repeat(55));

let lastGroup = '';
for (const r of results) {
  if (r.group !== lastGroup) { console.log(`\n  📂 ${r.group}`); lastGroup = r.group; }
  console.log(`  ${r.ok ? '✅' : '❌'} ${r.name}`);
  if (!r.ok) console.log(`       → ${r.err}`);
}

console.log('\n' + '─'.repeat(55));
console.log(`  ✅ Pasaron:  ${passed}`);
if (failed > 0) console.log(`  ❌ Fallaron: ${failed}`);
console.log(`  📊 Total:    ${passed + failed}`);
console.log('─'.repeat(55) + '\n');

if (failed > 0) process.exit(1);

})();
