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
async function initDB() {
    try {
        const query = `
            CREATE TABLE IF NOT EXISTS orders (
                id SERIAL PRIMARY KEY,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                total NUMERIC,
                status VARCHAR(50) DEFAULT 'Pending',
                delivery VARCHAR(50),
                address TEXT,
                cart JSONB, -- Stores the array of carpets
                user_id BIGINT,
                user_name VARCHAR(255),
                user_username VARCHAR(255)
            );
        `;
        await pool.query(query);
        console.log("Database table 'orders' is ready.");
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

// --- STARTUP ---
(async () => {
    await initDB(); // Initialize DB tables
    
    app.listen(PORT, () => {
        console.log(`Server running on port ${PORT}`);
    });

    bot.launch();
})();