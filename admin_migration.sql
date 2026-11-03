-- ============================================================
-- admin_migration.sql - the ADMIN feature (run as ROOT, once, BankDB)
-- ============================================================
-- Runs AFTER 01_schema..06_seed. Safe to re-run (procedures are dropped
-- first; ALTER-ing the enum twice would error, that's expected).
--
-- 1) widen the role enum + add is_active (soft-disable for logins)
-- 2) custody procedures guarded by designation = 'Administrator'
-- 3) first admin login created by seed_staff.sql style insert
--
-- Login afterwards: admin / admin123  (CHANGE IT - see README)

USE BankDB;

-- ---------- 1) schema change ----------
ALTER TABLE user_account
  MODIFY role ENUM('customer','teller','manager','admin') NOT NULL,
  ADD COLUMN is_active TINYINT(1) NOT NULL DEFAULT 1;

-- ---------- 2) procedures ----------
DELIMITER $$
DROP PROCEDURE IF EXISTS sp_create_staff$$
CREATE PROCEDURE sp_create_staff(
    IN p_cnic CHAR(13), IN p_name VARCHAR(80), IN p_designation VARCHAR(30),
    IN p_email VARCHAR(100), IN p_branch_id INT,
    IN p_username VARCHAR(50), IN p_password_hash VARCHAR(255),
    IN p_actor_employee_id INT
)
BEGIN
    DECLARE v_actor VARCHAR(30) DEFAULT NULL;
    DECLARE v_emp_id INT;
    DECLARE v_role_val VARCHAR(10);
    DECLARE EXIT HANDLER FOR SQLEXCEPTION BEGIN ROLLBACK; RESIGNAL; END;

    START TRANSACTION;
    IF p_cnic NOT REGEXP '^[0-9]{13}$' THEN
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'CNIC must be 13 digits';
    END IF;
    IF p_designation NOT IN ('Teller', 'Manager', 'Administrator') THEN
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Invalid designation';
    END IF;
    IF p_password_hash IS NULL OR LENGTH(p_password_hash) = 0 THEN
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Password hash required';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM branch WHERE branch_id = p_branch_id) THEN
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Branch not found';
    END IF;
    SELECT designation INTO v_actor FROM employee WHERE employee_id = p_actor_employee_id;
    IF v_actor IS NULL OR v_actor <> 'Administrator' THEN
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Only an administrator can create staff';
    END IF;
    IF EXISTS (SELECT 1 FROM employee WHERE cnic = p_cnic)
       OR EXISTS (SELECT 1 FROM employee WHERE email = p_email)
       OR EXISTS (SELECT 1 FROM user_account WHERE username = p_username) THEN
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'CNIC, email or username already exists';
    END IF;

    SET v_role_val = CASE p_designation
        WHEN 'Administrator' THEN 'admin'
        WHEN 'Manager' THEN 'manager'
        ELSE 'teller'
    END;

    INSERT INTO employee (branch_id, cnic, name, designation, email)
    VALUES (p_branch_id, p_cnic, p_name, p_designation, p_email);
    SET v_emp_id = LAST_INSERT_ID();

    INSERT INTO user_account (username, password_hash, role, customer_id, employee_id)
    VALUES (p_username, p_password_hash, v_role_val, NULL, v_emp_id);

    COMMIT;
    SELECT v_emp_id AS employee_id, LAST_INSERT_ID() AS user_id;
END$$

DROP PROCEDURE IF EXISTS sp_set_user_active$$
CREATE PROCEDURE sp_set_user_active(
    IN p_user_id INT, IN p_active BOOLEAN, IN p_actor_employee_id INT
)
BEGIN
    DECLARE v_actor VARCHAR(30) DEFAULT NULL;
    DECLARE v_target_emp INT;
    DECLARE EXIT HANDLER FOR SQLEXCEPTION BEGIN ROLLBACK; RESIGNAL; END;

    SELECT designation INTO v_actor FROM employee WHERE employee_id = p_actor_employee_id;
    IF v_actor IS NULL OR v_actor <> 'Administrator' THEN
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Only an administrator can enable or disable logins';
    END IF;
    IF p_user_id IS NULL OR NOT EXISTS (SELECT 1 FROM user_account WHERE user_id = p_user_id) THEN
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'User not found';
    END IF;
    IF p_active = FALSE THEN
        SELECT employee_id INTO v_target_emp FROM user_account WHERE user_id = p_user_id;
        IF v_target_emp IS NOT NULL AND v_target_emp = p_actor_employee_id THEN
            SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'You cannot disable your own login';
        END IF;
    END IF;

    UPDATE user_account SET is_active = IF(p_active, 1, 0) WHERE user_id = p_user_id;
END$$

DROP PROCEDURE IF EXISTS sp_reset_user_password$$
CREATE PROCEDURE sp_reset_user_password(
    IN p_user_id INT, IN p_password_hash VARCHAR(255), IN p_actor_employee_id INT
)
BEGIN
    DECLARE v_actor VARCHAR(30) DEFAULT NULL;
    DECLARE EXIT HANDLER FOR SQLEXCEPTION BEGIN ROLLBACK; RESIGNAL; END;

    SELECT designation INTO v_actor FROM employee WHERE employee_id = p_actor_employee_id;
    IF v_actor IS NULL OR v_actor <> 'Administrator' THEN
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Only an administrator can reset passwords';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM user_account WHERE user_id = p_user_id) THEN
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'User not found';
    END IF;
    IF p_password_hash IS NULL OR LENGTH(p_password_hash) = 0 THEN
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Password hash required';
    END IF;
    UPDATE user_account SET password_hash = p_password_hash WHERE user_id = p_user_id;
END$$

DELIMITER ;

-- ---------- 3) first admin login (bcrypt hash of 'admin123', cost 10) ----------
-- CHANGE THIS PASSWORD after first login (POST /admin/users/:id/password)
INSERT INTO employee (branch_id, cnic, name, designation, email)
VALUES (1, '3511111111103', 'System Admin', 'Administrator', 'admin@bank.com');

INSERT INTO user_account (username, password_hash, role, customer_id, employee_id)
VALUES ('admin', '$2b$10$LPgAPR/hFDaVNAydR3EVFea34Qd34H6yomvnefWy.lNAW7iMl7016',
        'admin', NULL, LAST_INSERT_ID());
