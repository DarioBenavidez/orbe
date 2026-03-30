'use strict';

// ── Fecha/hora en Argentina (UTC-3) ────────────────────────
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
  if (!dateStr || typeof dateStr !== 'string') return { year: 0, month: 0, day: 1 };
  const parts = dateStr.split('-').map(Number);
  if (parts.length < 3 || parts.some(isNaN)) return { year: 0, month: 0, day: 1 };
  const [y, m, d] = parts;
  return { year: y, month: m - 1, day: d };
}

// ── Formato de moneda ──────────────────────────────────────
function fmt(n) {
  return '$' + Math.abs(Number(n)).toLocaleString('es-AR', { maximumFractionDigits: 0 });
}
function fmtSigned(n) {
  return (n < 0 ? '-' : '') + fmt(n);
}
function fmtDate(dateStr) {
  const MESES = ['enero','febrero','marzo','abril','mayo','junio','julio','agosto','septiembre','octubre','noviembre','diciembre'];
  const [, m, d] = dateStr.split('-').map(Number);
  return `${d} de ${MESES[m - 1]}`;
}

// ── Saludo según horario ───────────────────────────────────
function getGreeting() {
  const hour = arNow().getHours();
  if (hour >= 6 && hour < 12) return 'Buenos días';
  if (hour >= 12 && hour < 20) return 'Buenas tardes';
  return 'Buenas noches';
}

// ── Precio del dólar (con cache de 5 min) ─────────────────
let _dolarCache = null;
let _dolarCacheAt = 0;
async function getDolarPrice() {
  if (_dolarCache && Date.now() - _dolarCacheAt < 5 * 60_000) return _dolarCache;
  try {
    const res = await fetch('https://api.bluelytics.com.ar/v2/latest');
    const data = await res.json();
    _dolarCache = { oficial: data.oficial?.value_sell, blue: data.blue?.value_sell, fetchedAt: Date.now() };
    _dolarCacheAt = Date.now();
    return _dolarCache;
  } catch {
    if (_dolarCache) {
      const ageMin = Math.round((Date.now() - _dolarCacheAt) / 60_000);
      console.warn(`[dolar] API no disponible, usando cache de hace ${ageMin} min`);
      return _dolarCache;
    }
    return null;
  }
}

// ── Limitar longitud de strings del usuario ───────────────
function truncate(str, max = 200) {
  if (typeof str !== 'string') return '';
  return str.slice(0, max);
}

const MONTH_NAMES = ['Enero','Febrero','Marzo','Abril','Mayo','Junio','Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre'];

module.exports = {
  arNow, arDay, today, currentMonth, parseDateParts,
  fmt, fmtSigned, fmtDate,
  getGreeting, getDolarPrice, truncate,
  MONTH_NAMES,
};
