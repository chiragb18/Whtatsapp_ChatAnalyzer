const { getClient, getCachedChats } = require('../whatsapp');
const Chat = require('../models/Chat');
const Message = require('../models/Message');

const whatsappController = {
  // @desc    Get all active WhatsApp chats
  // @route   GET /api/whatsapp/chats
  getChats: async (req, res) => {
    try {
      res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
      res.setHeader('Pragma', 'no-cache');
      res.setHeader('Expires', '0');
      const client = getClient();
      
      // Step 1: Memory Cache (INSTANT)
      let formattedChats = getCachedChats() || [];
      let source = 'memory';
      
      // Step 2: Database Cache (FAST)
      if (formattedChats.length === 0) {
        const dbChats = await Chat.find().sort({ timestamp: -1 });
        if (dbChats && dbChats.length > 0) {
          formattedChats = dbChats;
          source = 'database';
        }
      }

      // Step 3: Check Connection Status
      if (!client && formattedChats.length === 0) {
        return res.status(503).json({ success: false, error: 'Connecting to WhatsApp... If this is your first scan, please wait for the QR code.' });
      }

      // Step 4: Optional Live Force Refresh
      if (req.query.refresh === 'true' && client) {
        console.log('Force refresh: Fetching live chats...');
        const chats = await client.getChats().catch(() => []);
        formattedChats = (chats || []).map(chat => ({
          id: chat.id._serialized,
          name: chat.name || chat.id.user || 'Unknown Chat',
          isGroup: chat.isGroup,
          unreadCount: chat.unreadCount,
          timestamp: chat.timestamp ? new Date(chat.timestamp * 1000) : null,
          lastSyncIST: new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })
        }));
        source = 'live';
      }

      res.status(200).json({ 
        success: true, 
        count: formattedChats.length, 
        source: source,
        data: formattedChats 
      });
    } catch (error) {
      console.error('Critical Error in getChats:', error);
      res.status(500).json({ success: false, error: 'Database or System busy. Please refresh the page.' });
    }
  },

  // @desc    Get specific messages for a chat ID
  getMessagesByChatId: async (req, res) => {
    try {
      res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
      const chatId = req.params.chatId;
      const beforeId = req.query.before; // For fetching older messages
      const limit = parseInt(req.query.limit) || 100; // Increased default limit
      const client = getClient();
      
      console.log(`[Messages] Fetching for ${chatId}${beforeId ? ' before ' + beforeId : ''}. Limit: ${limit}`);

      // Step 1: Check MongoDB first
      let dbMessages = [];
      if (beforeId) {
        let referenceMsg = await Message.findOne({ id: beforeId });
        
        if (referenceMsg) {
          dbMessages = await Message.find({ 
            chatId, 
            timestamp: { $lt: referenceMsg.timestamp } 
          }).sort({ timestamp: -1 }).limit(limit);
        } else {
          // Fallback: If beforeId isn't in DB, we'll rely entirely on Live fetch
          console.log(`[Messages] beforeId ${beforeId} not found in DB, skipping DB cache.`);
        }
      } else {
        dbMessages = await Message.find({ chatId }).sort({ timestamp: -1 }).limit(limit);
      }
      
      // If we found enough in DB and it's not a forced live refresh or "load more"
      if (dbMessages.length >= limit && !req.query.live && !beforeId) {
        console.log(`[Messages] Returning ${dbMessages.length} messages from MongoDB for chat ${chatId}`);
        // Return in chronological order (oldest first for the frontend to append/prepend easily)
        // Actually frontend expects descending or handle it. Let's keep it descending as it was.
        return res.status(200).json({ success: true, count: dbMessages.length, source: 'database', data: dbMessages });
      }

      // Step 2: Fetch live if DB data is insufficient OR live is requested
      if (!client) {
        // Fallback to whatever we have in DB if client isn't ready
        if (dbMessages.length > 0) {
            return res.status(200).json({ success: true, count: dbMessages.length, source: 'database-fallback', data: dbMessages });
        }
        return res.status(503).json({ success: false, error: 'WhatsApp is connecting. Please wait...' });
      }

      try {
        const chat = await client.getChatById(chatId);
        
        // WhatsApp Web fetch options
        const fetchOptions = { limit: limit };
        if (beforeId) {
          fetchOptions.before = beforeId;
        }

        console.log(`[Messages] Fetching live from WhatsApp... Options:`, fetchOptions);
        const rawMessages = await chat.fetchMessages(fetchOptions); 
        
        let profilePic = null;
        if (!beforeId) {
          try { profilePic = await chat.getProfilePicUrl(); } catch (e) {}
        }

        const formattedMessages = rawMessages.map(msg => {
          // Identify sender name logic
          let senderName = msg.fromMe ? 'Me' : 'System';
          
          if (!msg.fromMe) {
            // Try to get name from saved contact info or notify name
            // msg._data.author is used for groups, msg.from for direct
            const author = msg.author || msg.from;
            const contactName = msg._data?.notifyName || '';
            const pushName = msg._data?.pushname || '';
            
            // Priority: Saved Name (if available in chat name for direct) or Number
            // For direct chat, chat.name is usually the saved name
            if (!chat.isGroup) {
               senderName = chat.name || author.split('@')[0];
            } else {
               // For groups, we use notify name or pushname if available, otherwise the number
               senderName = contactName || pushName || author.split('@')[0];
            }
          }

          return {
            id: msg.id._serialized,
            chatId: chatId,
            chatName: chat.name,
            sender: senderName,
            message: msg.body || '',
            timestamp: new Date(msg.timestamp * 1000),
            timestampIST: new Date(msg.timestamp * 1000).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' }),
            exportedAtIST: new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' }),
            hasMedia: msg.hasMedia || false,
            type: msg.type || 'chat'
          };
        }).filter(msg => msg.message || msg.hasMedia); 

        // Auto-save to DB to build history
        if (formattedMessages.length > 0) {
          // Fire and forget upsert
          formattedMessages.forEach(msg => {
            Message.findOneAndUpdate({ id: msg.id }, msg, { upsert: true }).catch(() => {});
          });
        }

        res.status(200).json({ 
          success: true, 
          count: formattedMessages.length, 
          profilePic: profilePic,
          source: 'live',
          data: formattedMessages 
        });
      } catch (clientErr) {
        console.error('[Messages] WhatsApp Client Error:', clientErr.message);
        // Fallback to DB if live fails
        if (dbMessages.length > 0) {
            return res.status(200).json({ success: true, count: dbMessages.length, source: 'database-error-fallback', data: dbMessages });
        }
        res.status(500).json({ success: false, error: 'Failed to fetch live messages.' });
      }
    } catch (error) {
      console.error('[Messages] Critical Error:', error);
      res.status(500).json({ success: false, error: 'Internal Server Error' });
    }
  },

  // @desc    Logout WhatsApp session
  // @route   POST /api/whatsapp/logout
  logout: async (req, res) => {
    try {
      const { logoutAndReset } = require('../whatsapp');
      await logoutAndReset();
      res.status(200).json({ success: true, message: 'Logged out successfully' });
    } catch (error) {
      console.error('Logout controller error:', error);
      res.status(500).json({ success: false, error: 'Failed to logout' });
    }
  }
};

module.exports = whatsappController;
