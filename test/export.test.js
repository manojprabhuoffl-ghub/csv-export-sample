const { test, after } = require('node:test');
const assert = require('node:assert');
const http = require('node:http');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

// Work on a temp copy of the data so tests never touch data/expenses.json
const tmp = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'expenses-')), 'expenses.json');
fs.copyFileSync(path.join(__dirname, '..', 'data', 'expenses.json'), tmp);
process.env.EXPENSES_FILE = tmp;

const app = require('../src/app');
const server = app.listen(0);
after(() => server.close());

function request(method, urlPath, data) {
  return new Promise((resolve, reject) => {
    const payload = data === undefined ? null : JSON.stringify(data);
    const req = http.request(
      {
        port: server.address().port,
        path: urlPath,
        method,
        headers: payload ? { 'content-type': 'application/json', 'content-length': Buffer.byteLength(payload) } : {},
      },
      (res) => {
        let body = '';
        res.on('data', (c) => (body += c));
        res.on('end', () => {
          const json = res.headers['content-type']?.includes('json') ? JSON.parse(body) : body;
          resolve({ status: res.statusCode, headers: res.headers, body: json });
        });
      }
    );
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

const SEPT = '/expenses/export.csv?from=2026-09-01&to=2026-09-30';

test('export: September returns header plus 18 rows, ordered by date', async () => {
  const res = await request('GET', SEPT);
  assert.strictEqual(res.status, 200);
  const lines = res.body.split('\n');
  assert.strictEqual(lines.pop(), ''); // body ends with a newline
  assert.strictEqual(lines[0], 'date,category,amount,note');
  assert.strictEqual(lines.length, 19);
  const dates = lines.slice(1).map((l) => l.split(',')[0]);
  assert.deepStrictEqual(dates, [...dates].sort());
});

test('export: range is inclusive on both ends', async () => {
  const all = await request('GET', '/expenses');
  const day = all.body.find((r) => r.date.startsWith('2026-09')).date;
  const res = await request('GET', `/expenses/export.csv?from=${day}&to=${day}`);
  const expected = all.body.filter((r) => r.date === day).length;
  assert.strictEqual(res.body.split('\n').length - 2, expected);
});

test('export: a note with comma and quotes is quoted and escaped', async () => {
  const note = 'Lunch, with "friends"';
  const post = await request('POST', '/expenses', { date: '2026-10-25', amount: 99, category: 'food', note });
  assert.strictEqual(post.status, 201);
  const res = await request('GET', '/expenses/export.csv?from=2026-10-25&to=2026-10-25');
  assert.strictEqual(res.body, 'date,category,amount,note\n2026-10-25,food,99,"Lunch, with ""friends"""\n');
});

test('export: bad or missing dates return 400 with a JSON error', async () => {
  const queries = [
    '',
    '?from=2026-09-01',
    '?to=2026-09-30',
    '?from=2026-13-45&to=2026-09-30',
    '?from=01/09/2026&to=30/09/2026',
    '?from=2026-9-1&to=2026-09-30',
    '?from=2026-09-30&to=2026-09-01',
  ];
  for (const q of queries) {
    const res = await request('GET', '/expenses/export.csv' + q);
    assert.strictEqual(res.status, 400, q);
    assert.ok(typeof res.body.error === 'string' && res.body.error.length > 0, q);
  }
});

test('export: sends CSV content type and attachment filename', async () => {
  const res = await request('GET', SEPT);
  assert.strictEqual(res.headers['content-type'], 'text/csv; charset=utf-8');
  assert.strictEqual(res.headers['content-disposition'], 'attachment; filename="expenses-2026-09-01-2026-09-30.csv"');
});

test('export: an empty range returns 200 with only the header', async () => {
  const res = await request('GET', '/expenses/export.csv?from=2020-01-01&to=2020-01-31');
  assert.strictEqual(res.status, 200);
  assert.strictEqual(res.body, 'date,category,amount,note\n');
});
