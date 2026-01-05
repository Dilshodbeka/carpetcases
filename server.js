const express = require('express');
const { Telegraf } = require('telegraf');
const bodyParser = require('body-parser');
const fs = require('fs');

// --- CONFIGURATION ---
const PORT = process.env.PORT || 3000;
const TOKEN = '8524797886:AAFel51fCM7KtJAz6KkRchDbJnzjy3uc1B8'; // <--- PASTE YOUR TOKEN HERE
const bot = new Telegraf(TOKEN);
const app = express();

app.use(bodyParser.json());
app.use(express.static('public')); // Serves HTML files from 'public' folder

// --- DATABASE (JSON FILE) ---
const DB_FILE = 'database.json';

function getOrders() {
    if (!fs.existsSync(DB_FILE)) return [];
    return JSON.parse(fs.readFileSync(DB_FILE));
}

function saveOrder(order) {
    const orders = getOrders();
    orders.push(order);
    fs.writeFileSync(DB_FILE, JSON.stringify(orders, null, 2));
    console.log("Order Saved:", order);
}

// --- WEBSITE ROUTES ---

// 1. Home Page (The Carpet Designer)
app.get('/', (req, res) => {
    // We will put the HTML here later. For now, it returns a simple message.
    res.send('<h1>Carpet Bot Website</h1><a href="/order">Go to Order Page</a>');
});

// 2. API to Receive Orders from the Website
app.post('/api/order', (req, res) => {
    const { cart, address, total, delivery } = req.body;
    
    const newOrder = {
        id: Date.now(),
        date: new Date().toISOString(),
        cart,
        address,
        total,
        delivery
    };

    saveOrder(newOrder);
    
    // Notify you (The Admin) in Telegram
    // We will need your Chat ID later, but for now we just log it.
    bot.telegram.sendMessage(ADMIN_CHAT_ID, `🛍 New Order!\nTotal: $${total}\nAddress: ${address}`); 
    
    res.json({ success: true, orderId: newOrder.id });
});

// --- TELEGRAM BOT LOGIC ---

bot.start((ctx) => ctx.reply('Welcome to Elite Carpet Bot! Click the button below to order.'));
bot.command('admin', (ctx) => {
    // Simple password check for admin
    if(ctx.message.text === '/admin 123') {
        const orders = getOrders();
        ctx.reply(`Total Orders: ${orders.length}`);
    }
});

// Start Express Server
app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});

// Start Telegram Bot Polling
bot.launch();