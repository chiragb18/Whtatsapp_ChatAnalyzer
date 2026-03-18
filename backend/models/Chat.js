const mongoose = require('mongoose');

const ChatSchema = new mongoose.Schema({
  id: { type: String, required: true, unique: true },
  name: { type: String, default: 'Unknown Chat' },
  isGroup: { type: Boolean, default: false },
  unreadCount: { type: Number, default: 0 },
  timestamp: { type: Date },
  profilePic: { type: String },
  lastSync: { type: Date, default: Date.now }
});

module.exports = mongoose.model('Chat', ChatSchema);
