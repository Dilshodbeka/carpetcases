const express = require('express');
const { Telegraf } = require('telegraf');
const bodyParser = require('body-parser');
const fs = require('fs');
const path = require('path');

// --- CONFIGURATION ---
const PORT = process.env.PORT || 3000;
// REPLACE WITH YOUR ACTUAL TOKEN
const TOKEN = '8524797886:AAFel51fCM7KtJAz6KkRchDbJnzjy3uc1B8'; 
// REPLACE WITH YOUR PERSONAL TELEGRAM ID (to receive admin alerts)
// You can get this by messaging @userinfobot in Telegram
const ADMIN_CHAT_ID = 7829091241;

const bot = new Telegraf(TOKEN);
const app = express();

app.use(bodyParser.json());
app.use(express.static('public')); // Serves your HTML file

// --- DATABASE (JSON FILE) ---
const DB_FILE = 'database.json';

// Helper to read orders
function getOrders() {
    if (!fs.existsSync(DB_FILE)) return [];
    try {
        const data = fs.readFileSync(DB_FILE);
        return JSON.parse(data);
    } catch (e) {
        return [];
    }
}

// Helper to save orders
function saveOrders(orders) {
    fs.writeFileSync(DB_FILE, JSON.stringify(orders, null, 2));
}

// --- WEBSITE ROUTES ---

// 1. API: GET all orders (For Admin Dashboard)
app.get('/api/orders', (req, res) => {
    const orders = getOrders();
    res.json(orders);
});

// 2. API: Receive New Order
app.post('/api/order', (req, res) => {
    const { cart, address, total, delivery, telegramUser } = req.body;
    
    const orders = getOrders();
    const newOrder = {
        id: Date.now(), // Unique ID based on timestamp
        date: new Date().toISOString(),
        cart,
        address,
        total,
        delivery,
        status: 'Pending',
        // Store the user's Telegram ID and Name
        user: {
            id: telegramUser.id,
            first_name: telegramUser.first_name,
            username: telegramUser.username
        }
    };

    orders.push(newOrder);
    saveOrders(orders);
    
    // 1. Notify Admin
    bot.telegram.sendMessage(ADMIN_CHAT_ID, 
        `🛍 NEW ORDER! #${newOrder.id}\n` +
        `Client: ${newOrder.user.first_name} (@${newOrder.user.username || 'no username'})\n` +
        `Total: $${total}\nDelivery: ${delivery}\nAddress: ${address}`
    ).catch(e => console.log("Admin notification failed (check ADMIN_CHAT_ID)"));

    // 2. Notify User
    bot.telegram.sendMessage(newOrder.user.id, 
        `✅ Order Received!\n` +
        `Hello ${newOrder.user.first_name}, we received your order for $${total}.\n` +
        `Order ID: #${newOrder.id}\n` +
        `We will notify you when payment is confirmed.`
    ).catch(e => console.log("User notification failed (user might have blocked bot)"));
    
    res.json({ success: true, orderId: newOrder.id });
});

// 3. API: Update Order Status (For Admin Dashboard)
app.post('/api/update-status', (req, res) => {
    const { orderId, status } = req.body;
    const orders = getOrders();
    const orderIndex = orders.findIndex(o => o.id == orderId);

    if (orderIndex > -1) {
        const oldStatus = orders[orderIndex].status;
        orders[orderIndex].status = status;
        saveOrders(orders);

        // Notify User about status change
        let message = "";
        if (status === 'Paid') {
            message = `💳 PAYMENT CONFIRMED\nYour order #${orderId} is marked as PAID. We are starting production!`;
        } else if (status === 'Shipped') {
            message = `🚚 SHIPPED\nYour order #${orderId} is on its way via ${orders[orderIndex].delivery}.`;
        }

        if (message) {
            bot.telegram.sendMessage(orders[orderIndex].user.id, message)
                .catch(e => console.log("Error notifying user"));
        }

        res.json({ success: true });
    } else {
        res.status(404).json({ success: false, message: "Order not found" });
    }
});

// --- TELEGRAM BOT COMMANDS ---
bot.start((ctx) => ctx.reply('Welcome to Elite Carpet Bot! Visit our website to order.'));
bot.command('myorders', (ctx) => {
    // Simple check to see if user has orders
    const orders = getOrders();
    const userOrders = orders.filter(o => o.user.id === ctx.from.id);
    if(userOrders.length === 0) return ctx.reply("You have no orders yet.");
    // Send a summary (kept brief)
    ctx.reply(`You have ${userOrders.length} orders. Check the website for details.`);
});

// Start Express Server
app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});

// Start Telegram Bot Polling
bot.launch();