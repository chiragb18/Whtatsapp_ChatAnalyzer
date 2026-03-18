const express = require('express');
const dotenv = require('dotenv');
const cors = require('cors');
const http = require('http');
const { Server } = require('socket.io');

const connectDB = require('./config/db');
const messageRoutes = require('./routes/messageRoutes');
const whatsappRoutes = require('./routes/whatsappRoutes');
const { initializeWhatsApp } = require('./whatsapp');

// Load environment variables
dotenv.config();

// Connect to MongoDB
connectDB();

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: '*',
    methods: ['GET', 'POST']
  }
});

// Middleware
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));
app.use(cors());

// Mount routers
app.use('/api/messages', messageRoutes);
app.use('/api/whatsapp', whatsappRoutes);

// Health check endpoint
app.get('/', (req, res) => {
  res.send('WhatsApp AI Search System Backend with Socket.IO is running...');
});

// Socket Connection handling
io.on('connection', (socket) => {
  console.log('Frontend Client Connected: ', socket.id);
});

// Initialize WhatsApp Web Client with WebSockets attached
initializeWhatsApp(io);

const PORT = process.env.PORT || 5000;

server.listen(PORT, () => {
  console.log(`====================================`);
  console.log(`Server running in ${process.env.NODE_ENV || 'development'} mode on port ${PORT}`);
  console.log(`====================================`);
});
