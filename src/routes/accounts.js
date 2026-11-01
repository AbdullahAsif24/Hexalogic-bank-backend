// ============================================================
// routes/accounts.js - open accounts, joint holders, status, cards
// ============================================================
// POST   /accounts            - open a new account        (teller/manager)
// GET    /accounts            - list accounts             (all, customers see own)
// PATCH  /accounts/:id/status - freeze / unfreeze / close (manager)
// POST   /accounts/:id/joint-holders - add joint holder  (teller/manager)
// POST   /accounts/:id/cards  - issue a card              (teller/manager)

import { Router } from 'express';
import { z } from 'zod';
import { callProc, query } from '../db.js';
import { authenticate, requireRole } from '../auth.js';
import { money, parse, id } from '../validate.js';

const router = Router();

// shortcuts for the common middleware combinations
const anyUser = [authenticate];
const staff = [authenticate, requireRole('teller', 'manager')];
const manager = [authenticate, requireRole('manager')];

// ---------- open a new account ----------
const openSchema = z.object({
  customerId: z.number().int(),
  branchId: z.number().int(),
  accountTypeId: z.number().int(),
  initialDeposit: money,
});

router.post('/accounts', staff, async (req, res) => {
  const body = parse(openSchema, req.body);
  await callProc('sp_open_account', [
    body.customerId,
    body.branchId,
    body.accountTypeId,
    body.initialDeposit,
    req.user.employeeId, // the teller/manager who opened it
  ]);
  res.status(201).json({ message: 'Account opened' });
});

// ---------- change account status (manager only) ----------
// body: { "status": "active" | "frozen" | "closed" }
router.patch('/accounts/:id/status', manager, async (req, res) => {
  const { status } = parse(
    z.object({ status: z.enum(['active', 'frozen', 'closed']) }),
    req.body
  );
  await callProc('sp_set_account_status', [
    id(req.params.id),
    status,
    req.user.employeeId,
  ]);
  res.json({ message: 'Status updated' });
});

// ---------- search customers (teller/manager) ----------
// GET /customers?q=<CNIC or name or phone>
// Used by the staff "Open account" page to pick a customer.
router.get('/customers', staff, async (req, res) => {
  const term = parse(
    z.object({ q: z.string().min(1, 'Type at least one character') }),
    req.query
  ).q.trim();
  const like = `%${term}%`;
  const rows = await query(
    `SELECT customer_id, name, cnic, phone
       FROM customer
      WHERE (cnic LIKE ? OR name LIKE ? OR phone LIKE ?)
      ORDER BY customer_id
      LIMIT 10`,
    [like, like, like]
  );
  res.json(rows);
});

// ---------- list accounts ----------
// Customer  -> only their own accounts (from v_customer_accounts)
// Staff     -> the whole bank (from v_account_summary)
router.get('/accounts', anyUser, async (req, res) => {
  if (req.user.role === 'customer') {
    const rows = await query(
      'SELECT * FROM v_customer_accounts WHERE customer_id=?',
      [req.user.customerId]
    );
    return res.json(rows);
  }
  const rows = await query('SELECT * FROM v_account_summary'); // staff
  res.json(rows);
});

// ---------- add a joint holder ----------
// body: { "customerId": 5 }
router.post('/accounts/:id/joint-holders', staff, async (req, res) => {
  const customerId = parse(
    z.object({ customerId: z.number().int().positive() }),
    req.body
  ).customerId;
  await callProc('sp_add_joint_holder', [
    id(req.params.id),
    customerId,
  ]);
  res.status(201).json({ message: 'Joint holder added' });
});

// ---------- issue a card ----------
// body: { "cardType": "debit" }  (or "credit")
router.post('/accounts/:id/cards', staff, async (req, res) => {
  const { cardType } = parse(
    z.object({ cardType: z.enum(['debit', 'credit']) }),
    req.body
  );
  await callProc('sp_issue_card', [id(req.params.id), cardType]);
  res.status(201).json({ message: 'Card issued' });
});

export default router;
