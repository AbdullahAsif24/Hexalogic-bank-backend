// ============================================================
// index.js - builds the app, mounts routes, starts the server
// ============================================================
// Run with:  npm run dev   (auto-restart on changes)

import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import { HttpError } from './db.js';
import authRoutes from './routes/auth.js';
import accountRoutes from './routes/accounts.js';
import moneyRoutes from './routes/money.js';
import loanRoutes from './routes/loans.js';
import reportRoutes from './routes/reports.js';

const app = express();

// ----- middleware -----
// CORS: only the frontend dev server may call this API from a browser.
app.use(cors({ origin: 'http://localhost:5173' })); // Vite dev server
app.use(express.json()); // read JSON bodies

// ----- simple health check (no database needed) -----
app.get('/health', (_req, res) => res.json({ ok: true }));

// ----- all routes -----
app.use(authRoutes, accountRoutes, moneyRoutes, loanRoutes, reportRoutes);

// ----- 404 for unknown paths -----
app.use((_req, res) => res.status(404).json({ error: 'Not found' }));

// ----- central error handler (last middleware) -----
// Every thrown HttpError ends up here with the right status code.
app.use((err, _req, res, _next) => {
  if (err instanceof HttpError) {
    return res.status(err.status).json({ error: err.message });
  }
  console.error(err); // unexpected bug -> log it, hide details from user
  res.status(500).json({ error: 'Server error' });
});

// ----- start server -----
app.listen(process.env.PORT || 8000, () => {
  console.log(`API running on http://localhost:${process.env.PORT || 8000}`);
});
