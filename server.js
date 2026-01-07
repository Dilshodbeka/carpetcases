const express = require('express');
const { Telegraf } = require('telegraf');
const bodyParser = require('body-parser');
const { Pool } = require('pg'); // This is the Postgres driver

// --- CONFIGURATION ---
const PORT = process.env.PORT || 3000;

// 1. Bot Token (from Environment Variable)
const TOKEN = process.env.BOT_TOKEN; 
const ADMIN_CHAT_ID = process.env.ADMIN_CHAT_ID;

// 2. Database Connection (from Environment Variable)
// We use 'rejectUnauthorized: false' because Render uses SSL
const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
});

const bot = new Telegraf(TOKEN);
const app = express();

app.use(bodyParser.json());
app.use(express.static('public'));

// --- DATABASE SETUP ---
// This runs when the server starts to make sure the 'orders' table exists
// --- DATABASE SETUP ---
async function initDB() {
    try {
        // 1. Create Orders Table
        const ordersQuery = `
            CREATE TABLE IF NOT EXISTS orders (
                id SERIAL PRIMARY KEY,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                total NUMERIC,
                status VARCHAR(50) DEFAULT 'Pending',
                delivery VARCHAR(50),
                address TEXT,
                cart JSONB,
                user_id BIGINT,
                user_name VARCHAR(255),
                user_username VARCHAR(255)
            );
        `;
        await pool.query(ordersQuery);

        // 2. Create Designs Table (NEW)
        const designsQuery = `
            CREATE TABLE IF NOT EXISTS designs (
                id INTEGER PRIMARY KEY,
                name VARCHAR(255),
                img TEXT,
                smallPrice NUMERIC,
                largePrice NUMERIC
            );
        `;
        await pool.query(designsQuery);

        // 3. Seed Initial Designs (Only if table is empty)
        const checkDesigns = await pool.query('SELECT * FROM designs');
        if (checkDesigns.rows.length === 0) {
            console.log("Seeding default designs...");
            await pool.query(`
                INSERT INTO designs (id, name, img, smallPrice, largePrice) VALUES 
                (1, 'Oriental Classic', 'https://picsum.photos/seed/rug1/300/300', 50, 45),
                (2, 'Modern Geometric', 'https://picsum.photos/seed/rug2/300/300', 45, 40),
                (3, 'Persian Red', 'https://picsum.photos/seed/rug3/300/300', 60, 55),
                (4, 'Blue Silk', 'https://picsum.photos/seed/rug4/300/300', 85, 80)
            `);
        }

        console.log("Database tables are ready.");
    } catch (err) {
        console.error("Database init error:", err);
    }
}

// --- ROUTES ---

// 1. GET: Fetch all orders for Admin
app.get('/api/orders', async (req, res) => {
    try {
        const result = await pool.query('SELECT * FROM orders ORDER BY created_at DESC');
        res.json(result.rows);
    } catch (err) {
        console.error(err);
        res.status(500).send("Server Error");
    }
});

// 2. POST: Create New Order
app.post('/api/order', async (req, res) => {
    const { cart, address, total, delivery, telegramUser } = req.body;

    try {
        const query = `
            INSERT INTO orders (cart, address, total, delivery, user_id, user_name, user_username)
            VALUES ($1, $2, $3, $4, $5, $6, $7)
            RETURNING id;
        `;
        const values = [
            JSON.stringify(cart), // Store cart as JSONB
            address,
            total,
            delivery,
            telegramUser.id,
            telegramUser.first_name,
            telegramUser.username
        ];

        const result = await pool.query(query, values);
        const orderId = result.rows[0].id;

        // 1. Notify Admin
        if (ADMIN_CHAT_ID) {
            bot.telegram.sendMessage(ADMIN_CHAT_ID, 
                `🛍 NEW ORDER! #${orderId}\n` +
                `Client: ${telegramUser.first_name} (@${telegramUser.username || 'no username'})\n` +
                `Total: $${total}\nDelivery: ${delivery}\nAddress: ${address}`
            ).catch(e => console.log("Admin notify failed"));
        }

        // 2. Notify User
        bot.telegram.sendMessage(telegramUser.id, 
            `✅ Order Received!\n` +
            `Hello ${telegramUser.first_name}, we received your order for $${total}.\n` +
            `Order ID: #${orderId}\n` +
            `We will notify you when it is shipped.`
        ).catch(e => console.log("User notify failed"));

        res.json({ success: true, orderId });
    } catch (err) {
        console.error(err);
        res.status(500).json({ success: false });
    }
});

// 3. POST: Update Order Status
app.post('/api/update-status', async (req, res) => {
    const { orderId, status } = req.body;

    try {
        const query = 'UPDATE orders SET status = $1 WHERE id = $2 RETURNING *;';
        const result = await pool.query(query, [status, orderId]);
        const order = result.rows[0];

        if (order && status === 'Shipped') {
            // Notify User
            bot.telegram.sendMessage(order.user_id, 
                `🚚 SHIPPED\nYour order #${order.id} is on its way via ${order.delivery}.`
            ).catch(e => console.log("Notify error"));
        }

        res.json({ success: true });
    } catch (err) {
        console.error(err);
        res.status(500).json({ success: false });
    }
});

// --- NEW ROUTES FOR DESIGNS ---

// 1. GET: Fetch Designs
app.get('/api/designs', async (req, res) => {
    try {
        const result = await pool.query('SELECT * FROM designs ORDER BY id');
        res.json(result.rows);
    } catch (err) {
        console.error(err);
        res.status(500).send("Server Error");
    }
});

// 2. POST: Update Design
app.post('/api/update-design', async (req, res) => {
    const { id, name, img, smallPrice, largePrice } = req.body;
    try {
        const query = `
            UPDATE designs 
            SET name = $1, img = $2, smallPrice = $3, largePrice = $4 
            WHERE id = $5;
        `;
        await pool.query(query, [name, img, smallPrice, largePrice, id]);
        res.json({ success: true });
    } catch (err) {
        console.error(err);
        res.status(500).json({ success: false });
    }
});

// --- STARTUP ---
(async () => {
    await initDB(); // Initialize DB tables
    
    app.listen(PORT, () => {
        console.log(`Server running on port ${PORT}`);
    });

    bot.launch();
})();