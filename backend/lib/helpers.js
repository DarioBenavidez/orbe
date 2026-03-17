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
  const [y, m, d] = dateStr.split('-').map(Number);
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

const MONTH_NAMES = ['Enero','Febrero','Marzo','Abril','Mayo','Junio','Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre'];

module.exports = {
  arNow, arDay, today, currentMonth, parseDateParts,
  fmt, fmtSigned, fmtDate,
  getGreeting, getDolarPrice,
  MONTH_NAMES,
};
