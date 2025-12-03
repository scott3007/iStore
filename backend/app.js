const express = require('express');
const cors = require('cors');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const db = require('./db');

const app = express();

app.use(cors()); // <--- 2. ADD THIS LINE (Must be BEFORE routes)
app.use(express.json());

const SECRET_KEY = 'your_super_secret_key'; // Put this in .env file in production

// --- MIDDLEWARE: Authenticate Token ---
const authenticateToken = (req, res, next) => {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1]; // Bearer TOKEN

    if (!token) return res.status(401).json({ message: 'Access Token Required' });

    jwt.verify(token, SECRET_KEY, (err, user) => {
        if (err) return res.status(403).json({ message: 'Invalid Token' });
        req.user = user;
        next();
    });
};

// --- 1. AUTHENTICATION ---

// Signup
app.post('/api/signup', async (req, res) => {
    try {
        const { name, email, password } = req.body;

        // Hash password
        const hashedPassword = await bcrypt.hash(password, 10);

        const [result] = await db.execute(
            'INSERT INTO users (name, email, password) VALUES (?, ?, ?)',
            [name, email, hashedPassword]
        );

        res.status(201).json({ message: 'User created', userId: result.insertId });
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
});

// Login
app.post('/api/login', async (req, res) => {
    try {
        const { email, password } = req.body;

        const [users] = await db.execute('SELECT * FROM users WHERE email = ?', [email]);
        if (users.length === 0) return res.status(400).json({ message: 'User not found' });

        const user = users[0];

        // Compare password
        const validPassword = await bcrypt.compare(password, user.password);
        if (!validPassword) return res.status(400).json({ message: 'Invalid password' });

        // Generate JWT
        const token = jwt.sign({ id: user.id, email: user.email }, SECRET_KEY, { expiresIn: '1h' });

        res.json({ token, user: { id: user.id, name: user.name, email: user.email } });
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
});

// --- 2. PRODUCT MANAGEMENT ---

// List Products
app.get('/api/products', async (req, res) => {
    try {
        const [products] = await db.execute('SELECT * FROM products');
        res.json(products);
    } catch (error) {
        res.status(200).json({ message: error.message });
    }
});

// Product Detail
app.get('/api/products/:id', async (req, res) => {
    try {
        const [products] = await db.execute('SELECT * FROM products WHERE id = ?', [req.params.id]);
        if (products.length === 0) return res.status(404).json({ message: 'Product not found' });
        res.json(products[0]);
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
});

// --- 3. ORDER MANAGEMENT ---

// Checkout (Create Order)
// Expected Body: { items: [ { productId: 1, quantity: 2 }, ... ] }
app.post('/api/checkout', authenticateToken, async (req, res) => {
    const connection = await db.getConnection();
    try {
        await connection.beginTransaction(); // Start Transaction

        const { items } = req.body;
        const userId = req.user.id;
        let totalAmount = 0;

        // 1. Calculate Total (In a real app, verify prices from DB here to prevent tampering)
        // For simplicity, we are fetching price inside the loop, but usually, you fetch all prices first.
        const orderItemsData = [];

        for (const item of items) {
            const [rows] = await connection.execute('SELECT price, stock FROM products WHERE id = ?', [item.productId]);
            if (rows.length === 0) throw new Error(`Product ${item.productId} not found`);

            const product = rows[0];
            if (product.stock < item.quantity) throw new Error(`Insufficient stock for product ${item.productId}`);

            totalAmount += parseFloat(product.price) * item.quantity;
            orderItemsData.push({ ...item, price: product.price });
        }

        // 2. Create Order Record
        const [orderResult] = await connection.execute(
            'INSERT INTO orders (user_id, total_amount) VALUES (?, ?)',
            [userId, totalAmount]
        );
        const orderId = orderResult.insertId;

        // 3. Create Order Items & Update Stock
        for (const item of orderItemsData) {
            await connection.execute(
                'INSERT INTO order_items (order_id, product_id, quantity, price) VALUES (?, ?, ?, ?)',
                [orderId, item.productId, item.quantity, item.price]
            );

            await connection.execute(
                'UPDATE products SET stock = stock - ? WHERE id = ?',
                [item.quantity, item.productId]
            );
        }

        await connection.commit(); // Commit Transaction
        res.status(201).json({ message: 'Order placed successfully', orderId });

    } catch (error) {
        await connection.rollback(); // Rollback if error
        res.status(500).json({ message: error.message });
    } finally {
        connection.release();
    }
});

// Order List (For logged-in user)
app.get('/api/orders', authenticateToken, async (req, res) => {
    try {
        const [orders] = await db.execute(
            'SELECT * FROM orders WHERE user_id = ? ORDER BY created_at DESC',
            [req.user.id]
        );
        res.json(orders);
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
});

// Order Detail
app.get('/api/orders/:id', authenticateToken, async (req, res) => {
    try {
        // Get Order
        const [orders] = await db.execute(
            'SELECT * FROM orders WHERE id = ? AND user_id = ?',
            [req.params.id, req.user.id]
        );

        if (orders.length === 0) return res.status(404).json({ message: 'Order not found' });

        // Get Items for that order
        const [items] = await db.execute(
            `SELECT oi.id, p.name, oi.quantity, oi.price
             FROM order_items oi
             JOIN products p ON oi.product_id = p.id
             WHERE oi.order_id = ?`,
            [req.params.id]
        );

        const orderDetails = {
            ...orders[0],
            items: items
        };

        res.json(orderDetails);
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
});

const PORT = 3000;
app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});
