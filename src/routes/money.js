// ============================================================
// routes/money.js - deposit, withdraw, transfer, statement
// ============================================================
// POST /accounts/:id/deposit    - cash at the counter (teller/manager)
// POST /accounts/:id/withdraw   - cash at the counter (teller/manager)
// POST /transfers               - anyone with a valid login
// GET  /accounts/:id/statement  - account owner or staff
//
// IMPORTANT: every money change goes through a stored procedure.
// This file NEVER writes UPDATE account SET balance = ... itself.

import { Router } from 'express';
import { z } from 'zod';
import { callProc, HttpError, query } from '../db.js';
import { authenticate, requireRole, assertOwnsAccount } from '../auth.js';
import { money, dateStr, parse, id } from '../validate.js';

const router = Router();

const anyUser = [authenticate];
const staff = [authenticate, requireRole('teller', 'manager')];

// ---------- deposit (cash at counter) ----------
router.post('/accounts/:id/deposit', staff, async (req, res) => {
  const { amount } = parse(z.object({ amount: money }), req.body);
  await callProc('sp_deposit', [
    id(req.params.id),
    amount,
    req.user.employeeId ?? null, // always set for staff; null just in case
  ]);
  res.json({ message: 'Deposit successful' });
});

// ---------- withdraw (cash at counter) ----------
router.post('/accounts/:id/withdraw', staff, async (req, res) => {
  const { amount } = parse(z.object({ amount: money }), req.body);
  await callProc('sp_withdraw', [
    id(req.params.id),
    amount,
    req.user.employeeId ?? null,
  ]);
  res.json({ message: 'Withdrawal successful' });
});

// ---------- transfer between accounts ----------
// Resolve a destination that may be given as account ID (e.g. 3) or as
// account number ("ACC-92610278" or "92610278"). Users think in numbers.
async function resolveAccountRef(value, label) {
  // strip 'ACC-' and spaces/spaces left by display formatting, keep digits
  const digits = String(value).trim().toUpperCase().replace(/^ACC-/, '').replace(/\s+/g, '');
  if (!/^\d+$/.test(digits)) {
    throw new HttpError(400, `Invalid ${label} (use the account ID or ACC-number)`);
  }
  // 1st try: it is an account_id
  const byId = await query(
    'SELECT account_id FROM v_account_summary WHERE account_id = ?',
    [Number(digits)]
  );
  if (byId.length > 0) return Number(digits);
  // 2nd try: it is digits of an account_number
  const byNumber = await query(
    'SELECT account_id FROM v_account_summary WHERE account_number = ?',
    ['ACC-' + digits]
  );
  if (byNumber.length > 0) return byNumber[0].account_id;
  throw new HttpError(400, `${label} not found`);
}

// Customers may only transfer FROM an account they own (checked below);
// staff may transfer from any account.
router.post('/transfers', anyUser, async (req, res) => {
  const body = parse(
    z.object({
      fromAccount: z.union([z.number(), z.string()]),
      toAccount: z.union([z.number(), z.string()]),
      amount: money,
    }),
    req.body
  );
  const fromId = await resolveAccountRef(body.fromAccount, 'Source account');
  const toId = await resolveAccountRef(body.toAccount, 'Receiver account');
  await assertOwnsAccount(req.user, fromId); // customers: own only
  await callProc('sp_transfer_funds', [
    fromId,
    toId,
    body.amount,
    req.user.employeeId ?? null, // null = done online by a customer
  ]);
  res.json({ message: 'Transfer successful' });
});

// ---------- statement ----------
// /accounts/:id/statement?from=2026-01-01&to=2026-01-31
router.get('/accounts/:id/statement', anyUser, async (req, res) => {
  const accountId = id(req.params.id);
  const query2 = parse(
    z.object({ from: dateStr, to: dateStr }),
    req.query
  );
  await assertOwnsAccount(req.user, accountId);
  const rows = await callProc('sp_get_statement', [
    accountId,
    query2.from,
    query2.to,
  ]);
  res.json(rows);
});

export default router;
