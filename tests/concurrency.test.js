// ============================================================
// tests/concurrency.test.js - fire 50 opposite transfers at once
// ============================================================
// Run:  set TOKEN=<token> && node tests/concurrency.test.js
//   (PowerShell:  $env:TOKEN="<token>"; node tests/concurrency.test.js)
//
// Expected:
// - no crash, no deadlock errors
// - no negative balance anywhere
// - total money across both accounts is UNCHANGED:
//     SELECT SUM(balance) FROM account WHERE account_id IN (1,2);

const URL = 'http://localhost:8000';

// One transfer of 100.00 from account a to account b
const send = (from, to) =>
  fetch(`${URL}/transfers`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${process.env.TOKEN}`,
    },
    body: JSON.stringify({ fromAccount: from, toAccount: to, amount: '100.00' }),
  }).then(async (r) => ({ status: r.status, body: await r.json() }));

if (!process.env.TOKEN) {
  console.log('Usage: set TOKEN to a customer or staff login token first.');
  process.exit(1);
}

// 25 transfers 1->2 and 25 transfers 2->1, all at the same time.
// Opposite directions are the classic case that can cause deadlocks -
// the database procedures must handle this correctly (rows locked in
// ascending account_id order inside sp_transfer_funds).
const jobs = [];
for (let i = 0; i < 25; i++) {
  jobs.push(send(1, 2), send(2, 1));
}
const results = await Promise.all(jobs);

const succeeded = results.filter((r) => r.status === 200);
const failed = results.filter((r) => r.status !== 200);

console.log(`${succeeded.length} transfers succeeded`);
console.log(`${failed.length} failed`);
if (failed.length > 0) {
  console.log('First few failures:');
  for (const f of failed.slice(0, 5)) {
    console.log(' ', f.status, f.body);
  }
}
console.log(
  'Now check in Workbench (total must be the same as before the test):'
);
console.log('  SELECT SUM(balance) FROM account WHERE account_id IN (1,2);');
