// ============================================================
// validate.js - input checking with zod
// ============================================================
// Routes call parse(schema, data) at the top. If a field is missing
// or wrong shape, we immediately return a 400 with the first message.

import { z } from 'zod';
import { HttpError } from './db.js';

// ---------- money ----------
// Money is ALWAYS a string like "1500.50" (never JavaScript floats!).
// If a JSON body sends a number, we convert it to a string first.
export const money = z.preprocess(
  (v) => (typeof v === 'number' ? String(v) : v),
  z
    .string()
    .regex(/^\d{1,13}(\.\d{1,2})?$/, 'Invalid amount')
    .refine((v) => Number(v) > 0, 'Amount must be greater than zero')
);

// ---------- date ----------
// Dates must look like 'YYYY-MM-DD' (e.g. '2026-05-01')
export const dateStr = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD');

// ---------- helpers ----------
// parse(schema, data): returns clean data or throws HttpError 400.
export function parse(schema, data) {
  const result = schema.safeParse(data);
  if (!result.success) {
    throw new HttpError(400, result.error.issues[0].message);
  }
  return result.data;
}

// id(value): validate an id from req.params (params are always strings).
export function id(value) {
  const n = Number(value);
  if (!Number.isInteger(n) || n <= 0) throw new HttpError(400, 'Invalid id');
  return n;
}
