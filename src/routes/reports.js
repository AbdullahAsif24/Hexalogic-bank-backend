// ============================================================
// routes/reports.js - manager-only reports from views
// ============================================================
// GET /reports/branch-summary    - accounts & deposits per branch
// GET /reports/daily             - transactions per day per type
// GET /reports/employee-activity - transactions handled per employee

import { Router } from 'express';
import { query } from '../db.js';
import { authenticate, requireRole } from '../auth.js';

const router = Router();

// every route here needs: logged in AND manager
const manager = [authenticate, requireRole('manager')];

router.get('/reports/branch-summary', manager, async (_req, res) => {
  const rows = await query('SELECT * FROM v_branch_summary');
  res.json(rows);
});

router.get('/reports/daily', manager, async (_req, res) => {
  const rows = await query('SELECT * FROM v_daily_transactions');
  res.json(rows);
});

router.get('/reports/employee-activity', manager, async (_req, res) => {
  const rows = await query('SELECT * FROM v_employee_activity');
  res.json(rows);
});

export default router;
