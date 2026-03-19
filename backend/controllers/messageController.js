const mongoose = require('mongoose');
const Message = require('../models/Message');
const ChatBackup = require('../models/ChatBackup');

// @desc    Get all captured messages
// @route   GET /api/messages
// @access  Public
const Object = {
  getMessages: async (req, res) => {
    try {
      const messages = await Message.find().sort({ timestamp: -1 });
      res.status(200).json({ success: true, count: messages.length, data: messages });
    } catch (error) {
      console.error(error);
      res.status(500).json({ success: false, error: 'Server Error' });
    }
  },

  // @desc    Bulk store messages (Export from frontend)
  // @route   POST /api/messages
  createMessages: async (req, res) => {
    try {
      const { messages } = req.body;
      if (!messages || !Array.isArray(messages)) {
         return res.status(400).json({ success: false, error: 'Invalid message data' });
      }

      // Filter out any messages that are missing the 'id' field to avoid duplicate 'undefined' keys
      const validMessages = messages.filter(m => m.id);

      if (validMessages.length === 0) {
        return res.status(200).json({ success: true, message: 'No new messages to save', count: 0 });
      }

      // Format/Map messages to include IST timestamp string
      const formattedInput = validMessages.map(m => {
          const date = m.timestamp ? new Date(m.timestamp) : new Date();
          return {
              ...m,
              timestamp: date,
              timestampIST: date.toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' }),
              exportedAtIST: new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })
          };
      });
      
      // Bulk insert messages. ordered: false allows it to continue if some exist
      try {
        const savedMessages = await Message.insertMany(formattedInput, { ordered: false });
        res.status(201).json({ success: true, count: savedMessages.length, data: savedMessages });
      } catch (insertErr) {
        // If it's just duplicate key errors (code 11000), we still consider it a success
        if (insertErr.code === 11000 || (insertErr.writeErrors && insertErr.writeErrors.length > 0)) {
           const writeErrors = insertErr.writeErrors || [];
           const insertedCount = validMessages.length - writeErrors.length;
           res.status(201).json({ 
             success: true, 
             message: 'Export completed (existing messages skipped)', 
             count: insertedCount 
           });
        } else {
          console.error('Bulk Insert Error:', insertErr);
          res.status(500).json({ success: false, error: 'Database error during export' });
        }
      }
    } catch (error) {
       console.error('Critical Export Error:', error);
       res.status(500).json({ success: false, error: 'Failed to process export request' });
    }
  },

  // @desc    Store named chat backup
  // @route   POST /api/messages/backup
  createChatBackup: async (req, res) => {
    try {
      const { chatId, chatName, backupName, messages } = req.body;
      
      console.log(`Backend Export: Creating backup collection "${backupName}" for chat ${chatId}. Messages: ${messages?.length}`);

      if (!messages || !Array.isArray(messages) || !backupName || !chatId || !chatName) {
        return res.status(400).json({ success: false, error: 'Incomplete backup metadata (chatId/chatName/backupName/messages required)' });
      }

      // 1. Format messages for storage
      const formattedMessages = messages.map(m => {
          const date = m.timestamp ? new Date(m.timestamp) : new Date();
          const istString = date.toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' });
          return {
              id: String(m.id || ''),
              sender: String(m.sender || 'Unknown'),
              message: String(m.message || ''),
              timestamp: date,
              timestampIST: istString,
              hasMedia: Boolean(m.hasMedia),
              type: String(m.type || 'chat'),
              chatId: String(m.chatId || chatId),
              chatName: String(m.chatName || chatName),
              exportedAt: new Date(),
              exportedAtIST: new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })
          };
      });

      // 2. STORES IN DYNAMIC COLLECTION (Named after person/backup name)
      // This fulfills the requirement: "store on that particular person name"
      const collectionName = String(backupName).trim();
      const db = mongoose.connection.db;
      await db.collection(collectionName).insertMany(formattedMessages);

      // 3. ALSO Keep a record in the main ChatBackup summary collection for reference
      const backupIndex = new ChatBackup({
        chatId: String(chatId),
        chatName: String(chatName),
        backupName: collectionName,
        messageCount: messages.length,
        // We still keep the array here for legacy support/quick view, but it's now officially in the named collection too
        messages: formattedMessages,
        exportedAt: new Date(),
        exportedAtIST: new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })
      });

      await backupIndex.save();
      
      res.status(201).json({ 
        success: true, 
        message: `Successfully saved backup to collection: ${collectionName}`, 
        backupId: backupIndex._id 
      });

    } catch (error) {
      console.error('Critical Backup Error:', error);
      res.status(500).json({ 
        success: false, 
        error: error.message || 'Failed to create chat backup',
        details: error.name === 'ValidationError' ? error.errors : null 
      });
    }
  }
};

module.exports = Object;
