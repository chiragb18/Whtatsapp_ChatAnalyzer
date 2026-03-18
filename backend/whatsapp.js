const { Client, LocalAuth } = require('whatsapp-web.js');
const qrcode = require('qrcode');
const qrcodeTerm = require('qrcode-terminal');
const Chat = require('./models/Chat');

let client;
let lastQr = null;
let _io = null;
let isReady = false;
let cachedChats = [];

const initializeWhatsApp = (io) => {
    if (!_io) {
        _io = io;
        setupSocketListeners(io);
    }
    
    console.log('Initializing fresh WhatsApp Client...');
    
    client = new Client({
        authStrategy: new LocalAuth(),
        puppeteer: {
            headless: true,
            args: [
                '--no-sandbox',
                '--disable-setuid-sandbox',
                '--disable-dev-shm-usage',
                '--disable-accelerated-2d-canvas',
                '--no-first-run',
                '--no-zygote',
                '--disable-gpu',
                '--disable-extensions',
                '--dns-prefetch-disable', // Helpful for ERR_NAME_NOT_RESOLVED
                '--ignore-certificate-errors',
                '--disable-web-security'
            ],
            protocolTimeout: 600000 // Increased to 10 minutes for slow connections
        }
    });

    client.on('qr', async (qr) => {
        try {
            console.log('QR RECEIVED: Scan this in terminal or frontend:');
            qrcodeTerm.generate(qr, { small: true });
            
            const qrCodeDataUrl = await qrcode.toDataURL(qr);
            lastQr = qrCodeDataUrl; // Store the QR code
            console.log('New QR Code generated and cached.');
            io.emit('qr', qrCodeDataUrl);
        } catch (err) {
            console.error('Error generating QR code:', err);
        }
    });

    client.on('ready', () => {
        lastQr = null;
        isReady = true;
        console.log('====================================');
        console.log('WhatsApp Client is Ready! Starting background sync...');
        console.log('====================================');
        _io.emit('ready', { status: 'WhatsApp System Ready' });
        
        // Start background sync
        startBackgroundSync();
    });

    client.on('authenticated', () => {
        lastQr = null;
        console.log('====================================');
        console.log('SCAN SUCCESS: WhatsApp Authenticated!');
        console.log('Preparing user session and sync...');
        console.log('====================================');
        io.emit('authenticated');
    });

    client.on('auth_failure', (msg) => {
        console.error('AUTHENTICATION FAILURE:', msg);
        io.emit('auth_failure', 'Phone disconnected or session rejected.');
    });

    client.on('disconnected', (reason) => {
        console.log('WhatsApp Client disconnected. Reason: ', reason);
        io.emit('disconnected', reason);
        logoutAndReset(); // Auto reset on disconnect
    });

    client.on('change_state', state => {
        console.log('CLIENT STATE CHANGED:', state);
        io.emit('state_change', state);
    });

    try {
        client.initialize().catch(err => {
            console.error('====================================');
            console.error('WhatsApp Initialization Failed!');
            console.error('Error Details:', err.message);
            
            if (err.message.includes('ERR_NAME_NOT_RESOLVED') || err.message.includes('net::ERR')) {
                console.error('CRITICAL: Network/DNS failure. Ensure you are connected to the internet.');
                console.error('Attempting to notify frontend and retrying in 30s...');
                
                if (_io) _io.emit('error', 'Network failure: Web WhatsApp is unreachable. Checking internet connection...');
                
                // Retry logic for transient network issues
                setTimeout(() => {
                    console.log('Retrying WhatsApp initialization...');
                    initializeWhatsApp(_io);
                }, 30000);
            }
            console.error('====================================');
        });
    } catch (error) {
        console.log('Init block exception:', error);
    }
};

const setupSocketListeners = (io) => {
    io.on('connection', (socket) => {
        console.log('New frontend connection:', socket.id);
        
        if (lastQr) {
            socket.emit('qr', lastQr);
        }

        socket.on('check-auth', async () => {
            try {
                if (isReady) {
                    socket.emit('ready');
                } else if (lastQr) {
                    socket.emit('qr', lastQr);
                } else if (client && !isReady) {
                    // Check if client is actually authenticated but just not "ready" yet
                    // This is helpful if user refreshes while session is initializing
                    try {
                        const state = await client.getState().catch(() => null);
                        if (state === 'CONNECTED' || state === 'OPENING') {
                            socket.emit('authenticated');
                        }
                    } catch (e) {}
                }
            } catch (e) {
                console.log('Check auth error:', e);
            }
        });
    });
};

const Message = require('./models/Message');

const startBackgroundSync = async () => {
    if (!client || !isReady) return;
    
    try {
        console.log('Background Sync: Fetching chats from WhatsApp...');
        const chats = await client.getChats();
        
        cachedChats = (chats || []).map(chat => ({
            id: chat.id._serialized,
            name: chat.name || chat.id.user || 'Unknown Chat',
            isGroup: chat.isGroup,
            unreadCount: chat.unreadCount,
            timestamp: chat.timestamp ? new Date(chat.timestamp * 1000) : null
        }));

        // Persist chats to MongoDB
        for (const chatData of cachedChats) {
            await Chat.findOneAndUpdate(
                { id: chatData.id },
                { ...chatData, lastSync: new Date() },
                { upsert: true }
            ).catch(() => {});
        }
        
        console.log(`Background Sync: ${cachedChats.length} chats synced. Messages will be loaded on demand when a chat is selected.`);
        
        // Refresh every 5 minutes
        setTimeout(startBackgroundSync, 5 * 60 * 1000);
    } catch (error) {
        console.error('Initial background sync error:', error);
        setTimeout(startBackgroundSync, 30000); // Retry sooner on error
    }
};

const logoutAndReset = async () => {
    try {
        console.log('Starting logout process...');
        isReady = false;
        lastQr = null;
        cachedChats = [];

        if (client) {
            // Important: logout() unpairs the session from LocalAuth
            await client.logout().catch(() => console.log('Logout failed or already logged out'));
            await client.destroy().catch(() => console.log('Destroy failed'));
            client = null;
        }

        console.log('Session cleared. Re-initializing for new QR...');
        if (_io) {
            // Small delay before re-initializing to ensure old process is fully dead
            setTimeout(() => initializeWhatsApp(_io), 2000);
        }
    } catch (error) {
        console.error('Logout failed:', error);
    }
};

const getClient = () => {
    return isReady ? client : null;
};

const getCachedChats = () => {
    return cachedChats;
};

module.exports = { initializeWhatsApp, getClient, logoutAndReset, getCachedChats };
