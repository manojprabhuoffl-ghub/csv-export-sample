const express = require('express');
const store = require('./store');

const HEADER = 'date,category,amount,note';

// Quote a note only when it has a comma, quote or line break; double inner quotes.
function csvNote(note) {
  const s = String(note ?? '');
  return /[",\r\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}

// isValidDate is passed in from app.js so there is one definition of "valid date".
module.exports = function exportRoutes(isValidDate) {
  const router = express.Router();

  // GET /expenses/export.csv?from=YYYY-MM-DD&to=YYYY-MM-DD  (both required, inclusive)
  router.get('/expenses/export.csv', (req, res) => {
    const { from, to } = req.query;
    if (from === undefined || to === undefined) {
      return res.status(400).json({ error: 'from and to are required (YYYY-MM-DD)' });
    }
    if (!isValidDate(from) || !isValidDate(to)) {
      return res.status(400).json({ error: 'from and to must be valid dates in YYYY-MM-DD format' });
    }
    // ISO dates sort correctly as plain strings, so no Date parsing here.
    if (from > to) {
      return res.status(400).json({ error: 'from must not be later than to' });
    }

    const rows = store
      .readAll()
      .filter((r) => r.date >= from && r.date <= to)
      .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));

    const lines = [HEADER, ...rows.map((r) => `${r.date},${r.category},${r.amount},${csvNote(r.note)}`)];

    res.set({
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="expenses-${from}-${to}.csv"`,
    });
    res.send(lines.join('\n') + '\n');
  });

  return router;
};
