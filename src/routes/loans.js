// ============================================================
// routes/loans.js - apply, list, pending queue, decide, pay, EMI
// ============================================================
// POST /loans            - customer applies for a loan
// GET  /loans            - loans list (customer: own, staff: all)
// GET  /loans/pending    - manager's approval queue
// GET  /loans/emi        - EMI calculator (no data changes)
// POST /loans/:id/decision - manager approves or rejects
// POST /loans/:id/payments - customer pays an installment

import { Router } from 'express';
import { z } from 'zod';
import { callProc, query, HttpError } from '../db.js';
import { authenticate, requireRole } from '../auth.js';
import { money, parse, id } from '../validate.js';

const router = Router();

const anyUser = [authenticate];
const manager = [authenticate, requireRole('manager')];
const customerOnly = [authenticate, requireRole('customer')];

// Loan rate decided by the SERVER (config), never sent by the client.
// TODO: later this can look up the rate by amount/term.
const LOAN_RATE = 12.5;

// NOTE: static paths must be DEFINED FIRST,
// otherwise '/loans/pending' would be caught by '/loans/:id'.

// ---------- manager: approval queue ----------
router.get('/loans/pending', manager, async (_req, res) => {
  const rows = await query('SELECT * FROM v_pending_loans');
  res.json(rows);
});

// ---------- everyone: EMI calculator ----------
// /loans/emi?principal=100000&rate=12.5&months=24
router.get('/loans/emi', anyUser, async (req, res) => {
  const q = parse(
    z.object({
      principal: z.coerce.number().positive(),
      rate: z.coerce.number().min(0),
      months: z.coerce.number().int().positive(),
    }),
    req.query
  );
  // Uses the SQL function from 04_procedures.sql
  const [row] = await query('SELECT fn_calc_emi(?,?,?) AS emi', [
    q.principal,
    q.rate,
    q.months,
  ]);
  res.json(row);
});

// ---------- customer: apply for a loan ----------
router.post('/loans', customerOnly, async (req, res) => {
  const body = parse(
    z.object({
      branchId: z.number().int().positive(),
      principal: money,
      termMonths: z.number().int().positive(),
    }),
    req.body
  );
  // customerId comes from the TOKEN, not the body (security!)
  await callProc('sp_apply_loan', [
    req.user.customerId,
    body.branchId,
    body.principal,
    LOAN_RATE,
    body.termMonths,
  ]);
  res.status(201).json({ message: 'Loan application submitted' });
});

// ---------- list loans ----------
// Customer -> own loans (v_loan_status filtered by customer_id)
// Staff    -> all loans
router.get('/loans', anyUser, async (req, res) => {
  if (req.user.role === 'customer') {
    const rows = await query('SELECT * FROM v_loan_status WHERE customer_id=?', [
      req.user.customerId,
    ]);
    return res.json(rows);
  }
  const rows = await query('SELECT * FROM v_loan_status'); // staff
  res.json(rows);
});

// ---------- manager: approve or reject ----------
// body: { "approve": true }  or  { "approve": false }
router.post('/loans/:id/decision', manager, async (req, res) => {
  const { approve } = parse(z.object({ approve: z.boolean() }), req.body);
  await callProc('sp_decide_loan', [
    id(req.params.id),
    req.user.employeeId,
    approve,
  ]);
  res.json({ message: approve ? 'Approved' : 'Rejected' });
});

// ---------- customer: pay an installment ----------
router.post('/loans/:id/payments', customerOnly, async (req, res) => {
  const loanId = id(req.params.id);
  const body = parse(
    z.object({
      amount: money,
      fromAccountId: z.number().int().positive(),
    }),
    req.body
  );
  // Customer may only pay for their OWN loan
  const own = await query('SELECT 1 FROM loan WHERE loan_id=? AND customer_id=?', [
    loanId,
    req.user.customerId,
  ]);
  if (own.length === 0) {
    throw new HttpError(403, 'This loan does not belong to you');
  }
  // ...and only pay FROM an account they own
  const ownAccount = await query(
    'SELECT 1 FROM customer_account WHERE customer_id=? AND account_id=?',
    [req.user.customerId, body.fromAccountId]
  );
  if (ownAccount.length === 0) {
    throw new HttpError(403, 'This account does not belong to you');
  }
  await callProc('sp_pay_installment', [loanId, body.amount, body.fromAccountId]);
  res.json({ message: 'Installment paid' });
});

export default router;
