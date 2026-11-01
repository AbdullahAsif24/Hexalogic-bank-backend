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
import { callProc } from '../db.js';
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
// Customers may only transfer FROM an account they own (checked below);
// staff may transfer from any account.
router.post('/transfers', anyUser, async (req, res) => {
  const body = parse(
    z.object({
      fromAccount: z.number().int().positive(),
      toAccount: z.number().int().positive(),
      amount: money,
    }),
    req.body
  );
  await assertOwnsAccount(req.user, body.fromAccount); // customers: own only
  await callProc('sp_transfer_funds', [
    body.fromAccount,
    body.toAccount,
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
