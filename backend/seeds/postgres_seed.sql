-- dataPlane Postgres Seed: HR Domain
-- Executed on startup by Docker postgres init

CREATE TABLE IF NOT EXISTS employees (
    employee_id   SERIAL PRIMARY KEY,
    first_name    VARCHAR(50) NOT NULL,
    last_name     VARCHAR(50) NOT NULL,
    email         VARCHAR(100) UNIQUE NOT NULL,
    phone         VARCHAR(20),
    hire_date     DATE NOT NULL,
    department_id INTEGER,
    job_title     VARCHAR(80),
    salary        DECIMAL(12,2),
    ssn           VARCHAR(11)
);

CREATE TABLE IF NOT EXISTS departments (
    department_id   SERIAL PRIMARY KEY,
    department_name VARCHAR(60) NOT NULL,
    manager_id      INTEGER,
    location        VARCHAR(100),
    budget          DECIMAL(15,2)
);

CREATE TABLE IF NOT EXISTS payroll (
    payroll_id    SERIAL PRIMARY KEY,
    employee_id   INTEGER REFERENCES employees(employee_id),
    pay_period    VARCHAR(10),
    gross_pay     DECIMAL(12,2),
    tax_deduction DECIMAL(12,2),
    net_pay       DECIMAL(12,2),
    pay_date      DATE,
    bank_account  VARCHAR(30)
);

-- Seed departments
INSERT INTO departments (department_name, manager_id, location, budget) VALUES
    ('Engineering',   1, 'San Francisco, CA', 2500000.00),
    ('Sales',         2, 'New York, NY',      1800000.00),
    ('Human Resources', 3, 'Chicago, IL',     950000.00),
    ('Finance',       4, 'Boston, MA',        1200000.00),
    ('Marketing',     5, 'Austin, TX',        1100000.00)
ON CONFLICT DO NOTHING;

-- Seed employees
INSERT INTO employees (first_name, last_name, email, phone, hire_date, department_id, job_title, salary, ssn) VALUES
    ('James',    'Anderson', 'james.anderson@company.com',  '+1-555-3001', '2022-03-15', 1, 'Sr. Engineer',       145000.00, '***-**-1234'),
    ('Maria',    'Garcia',   'maria.garcia@company.com',    '+1-555-3002', '2021-07-20', 2, 'Sales Director',     165000.00, '***-**-2345'),
    ('Chen',     'Wei',      'chen.wei@company.com',        '+1-555-3003', '2023-01-10', 3, 'HR Manager',         120000.00, '***-**-3456'),
    ('Sarah',    'Johnson',  'sarah.johnson@company.com',   '+1-555-3004', '2020-11-01', 4, 'Finance Director',   155000.00, '***-**-4567'),
    ('Ahmed',    'Hassan',   'ahmed.hassan@company.com',    '+1-555-3005', '2023-06-15', 5, 'Marketing Manager',  125000.00, '***-**-5678'),
    ('Lisa',     'Park',     'lisa.park@company.com',       '+1-555-3006', '2022-09-01', 1, 'DevOps Engineer',    135000.00, '***-**-6789'),
    ('Michael',  'Brown',    'michael.brown@company.com',   '+1-555-3007', '2021-04-12', 2, 'Account Executive',  110000.00, '***-**-7890'),
    ('Priya',    'Sharma',   'priya.sharma@company.com',    '+1-555-3008', '2024-01-08', 1, 'Software Engineer',  125000.00, '***-**-8901')
ON CONFLICT DO NOTHING;

-- Seed payroll
INSERT INTO payroll (employee_id, pay_period, gross_pay, tax_deduction, net_pay, pay_date, bank_account) VALUES
    (1, '2025-06', 12083.33, 3625.00,  8458.33, '2025-06-30', 'XXXX-1234'),
    (2, '2025-06', 13750.00, 4125.00,  9625.00, '2025-06-30', 'XXXX-2345'),
    (3, '2025-06', 10000.00, 3000.00,  7000.00, '2025-06-30', 'XXXX-3456'),
    (4, '2025-06', 12916.67, 3875.00,  9041.67, '2025-06-30', 'XXXX-4567'),
    (5, '2025-06', 10416.67, 3125.00,  7291.67, '2025-06-30', 'XXXX-5678'),
    (6, '2025-06', 11250.00, 3375.00,  7875.00, '2025-06-30', 'XXXX-6789'),
    (7, '2025-06',  9166.67, 2750.00,  6416.67, '2025-06-30', 'XXXX-7890'),
    (8, '2025-06', 10416.67, 3125.00,  7291.67, '2025-06-30', 'XXXX-8901')
ON CONFLICT DO NOTHING;
