'use strict';

const { parseDateParts } = require('../lib/helpers');

// Filtra transacciones de un mes/año específico
function filterByMonth(transactions, month, year) {
  return transactions.filter(t => {
    const p = parseDateParts(t.date);
    return p.month === month && p.year === year;
  });
}

// Calcula totales de un mes: { txs, ingresos, gastos, sueldo }
function monthlyTotals(transactions, month, year) {
  const txs = filterByMonth(transactions, month, year);
  return {
    txs,
    ingresos: txs.filter(t => t.type === 'ingreso' || t.type === 'sueldo').reduce((s, t) => s + t.amount, 0),
    gastos:   txs.filter(t => t.type === 'gasto' || t.type === 'ahorro_meta').reduce((s, t) => s + t.amount, 0),
    sueldo:   txs.filter(t => t.type === 'sueldo').reduce((s, t) => s + t.amount, 0),
  };
}

module.exports = { filterByMonth, monthlyTotals };
