-- dataPlane MySQL Seed: E-Commerce Domain
-- Used when MySQL container is present

CREATE DATABASE IF NOT EXISTS ecommerce;
USE ecommerce;

CREATE TABLE IF NOT EXISTS products (
    product_id   INT AUTO_INCREMENT PRIMARY KEY,
    name         VARCHAR(100) NOT NULL,
    category     VARCHAR(50),
    price        DECIMAL(10,2),
    stock_qty    INT DEFAULT 0,
    sku          VARCHAR(20) UNIQUE
);

CREATE TABLE IF NOT EXISTS orders (
    order_id         INT AUTO_INCREMENT PRIMARY KEY,
    customer_email   VARCHAR(100),
    product_id       INT,
    quantity         INT,
    total_amount     DECIMAL(10,2),
    order_date       DATETIME,
    shipping_address TEXT
);

CREATE TABLE IF NOT EXISTS customers (
    customer_id      INT AUTO_INCREMENT PRIMARY KEY,
    full_name        VARCHAR(100),
    email            VARCHAR(100) UNIQUE,
    phone            VARCHAR(20),
    address          TEXT,
    city             VARCHAR(50),
    state            VARCHAR(20),
    zip_code         VARCHAR(10),
    credit_card_last4 VARCHAR(4)
);

INSERT INTO products (name, category, price, stock_qty, sku) VALUES
    ('Wireless Mouse', 'Electronics', 29.99, 150, 'WM-001'),
    ('USB-C Hub', 'Electronics', 49.99, 80, 'UC-002'),
    ('Standing Desk', 'Furniture', 399.99, 25, 'SD-003'),
    ('Monitor Arm', 'Accessories', 89.99, 60, 'MA-004'),
    ('Mechanical Keyboard', 'Electronics', 129.99, 45, 'MK-005');

INSERT INTO customers (full_name, email, phone, address, city, state, zip_code, credit_card_last4) VALUES
    ('Alice Thompson', 'alice@shop.com', '+1-555-2001', '123 Main St', 'New York', 'NY', '10001', '4242'),
    ('Bob Martinez', 'bob@shop.com', '+1-555-2002', '456 Oak Ave', 'Los Angeles', 'CA', '90001', '1234'),
    ('Carol Chen', 'carol@shop.com', '+1-555-2003', '789 Pine Rd', 'Houston', 'TX', '77001', '5678');

INSERT INTO orders (customer_email, product_id, quantity, total_amount, order_date, shipping_address) VALUES
    ('alice@shop.com', 1, 2, 59.98, '2025-06-01 10:30:00', '123 Main St, New York, NY'),
    ('bob@shop.com', 3, 1, 399.99, '2025-06-02 14:00:00', '456 Oak Ave, Los Angeles, CA'),
    ('carol@shop.com', 2, 3, 149.97, '2025-06-03 09:15:00', '789 Pine Rd, Houston, TX'),
    ('alice@shop.com', 5, 1, 129.99, '2025-06-04 16:45:00', '123 Main St, New York, NY');
