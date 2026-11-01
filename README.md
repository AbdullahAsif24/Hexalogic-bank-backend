# Banking System Backend

Node.js + Express API for the Banking DBMS project.
It is a **thin layer on top of the database**: every money change calls a
stored procedure (`CALL sp_...`), every report reads a view
(`SELECT ... FROM v_...`). No business rules are written in JavaScript.

## Project structure (what each file does)

```
backend/
  .env                        DB login, JWT secret, port  (DO NOT commit)
  package.json                dependencies and npm scripts
  src/
    index.js                  builds the app, mounts routes, starts server
    db.js                     MySQL pool + callProc()/query() + error translation
    auth.js                   bcrypt, JWT token, authenticate/requireRole/ownership check
    validate.js               input validation helpers (money as string, dates, ids)
    routes/
      auth.js                 POST /auth/register, /auth/login
      accounts.js             open account, list, joint holders, status, cards
      money.js                deposit, withdraw, transfer, statement
      loans.js                apply, pending queue, decide, pay installment, EMI
      reports.js              manager-only reports from views
  tests/
    concurrency.test.js       50 opposite transfers at the same time
```

## 1. Before running - database side

Run the SQL files in this order (from the `Banking_DB_SQL_Design.pdf`):
`01_schema`, `02_indexes`, `03_views`, `04_procedures`, `05_triggers`, `06_seed`.

Then create the limited app user (only procedures + views, no direct table access):

```sql
CREATE USER 'bank_app'@'localhost' IDENTIFIED BY 'change_me';
GRANT EXECUTE ON BankDB.* TO 'bank_app'@'localhost';
GRANT SELECT ON BankDB.v_account_summary    TO 'bank_app'@'localhost';
GRANT SELECT ON BankDB.v_customer_accounts  TO 'bank_app'@'localhost';
GRANT SELECT ON BankDB.v_loan_status        TO 'bank_app'@'localhost';
GRANT SELECT ON BankDB.v_pending_loans      TO 'bank_app'@'localhost';
GRANT SELECT ON BankDB.v_branch_summary     TO 'bank_app'@'localhost';
GRANT SELECT ON BankDB.v_daily_transactions TO 'bank_app'@'localhost';
GRANT SELECT ON BankDB.v_employee_activity  TO 'bank_app'@'localhost';
GRANT SELECT ON BankDB.user_account         TO 'bank_app'@'localhost';
GRANT SELECT ON BankDB.customer_account     TO 'bank_app'@'localhost';
GRANT SELECT ON BankDB.loan                 TO 'bank_app'@'localhost';
```

## 2. Run the backend

```bash
npm install
npm run dev        # starts on http://localhost:8000
```

If `bcrypt` fails to install on Windows, run `npm i bcryptjs` and change
the import in `src/auth.js` from `'bcrypt'` to `'bcryptjs'`.

Set your real DB password and JWT secret in `.env` first!

## 3. Try it with Postman / Thunder Client

1. `GET http://localhost:8000/health` -> `{"ok":true}`
2. `POST /auth/login` with `{"username":"...","password":"..."}`
3. Copy the `token` and send it on other requests as header:
   `Authorization: Bearer <token>`

## 4. Endpoint map (who can call what)

| Method + path                  | Calls                           | Who            |
| ------------------------------ | ------------------------------- | -------------- |
| POST /auth/register            | sp_register_customer            | public         |
| POST /auth/login               | SELECT user_account             | public         |
| POST /accounts                 | sp_open_account                 | teller, manager |
| GET /accounts                  | v_account_summary / v_customer_accounts | all    |
| PATCH /accounts/:id/status     | sp_set_account_status           | manager        |
| POST /accounts/:id/joint-holders | sp_add_joint_holder           | teller, manager |
| POST /accounts/:id/cards       | sp_issue_card                   | teller, manager |
| POST /accounts/:id/deposit     | sp_deposit                      | teller, manager |
| POST /accounts/:id/withdraw    | sp_withdraw                     | teller, manager |
| POST /transfers                | sp_transfer_funds               | all (owner of from-account) |
| GET /accounts/:id/statement    | sp_get_statement                | all (owner)    |
| POST /loans                    | sp_apply_loan                   | customer       |
| GET /loans                     | v_loan_status                   | all (own for customer) |
| GET /loans/pending             | v_pending_loans                 | manager        |
| GET /loans/emi                 | fn_calc_emi(...)                | all            |
| POST /loans/:id/decision       | sp_decide_loan                  | manager        |
| POST /loans/:id/payments       | sp_pay_installment              | customer       |
| GET /reports/branch-summary    | v_branch_summary                | manager        |
| GET /reports/daily             | v_daily_transactions            | manager        |
| GET /reports/employee-activity | v_employee_activity             | manager        |

Notes:
- `employee_id` is taken from the login token for staff, `null` for online
  customer actions - never from the request body.
- Money amounts in requests are strings like `"1500.50"` (a plain number is
  also accepted and converted).

## 5. Concurrency test

```bash
# PowerShell
$env:TOKEN="<paste a login token>"; npm run test:concurrency
```

Expected: no deadlocks, no negative balance, and
`SELECT SUM(balance) FROM account WHERE account_id IN (1,2);` unchanged.

## 6. Error messages the API returns

| Message                          | HTTP | Cause                                |
| -------------------------------- | ---- | ------------------------------------ |
| Insufficient balance             | 400  | spend more than allowed              |
| Minimum balance violated         | 400  | would go below type's min_balance    |
| Account is not active            | 400  | frozen/closed account                |
| Cannot transfer to the same account | 400 | from = to account                  |
| Loan is not pending              | 400  | deciding a loan twice                |
| Account balance must be zero to close | 400 | closing a funded account        |
| Only a manager can approve loans | 403  | non-manager employee                 |
| Already exists (CNIC, ...)       | 409  | duplicate key                        |
| Invalid or expired token         | 401  | missing/bad token                    |
| Not allowed / does not belong to you | 403 | wrong role / not your account      |
| validation message from zod      | 400  | bad amount/CNIC/date/missing field   |
