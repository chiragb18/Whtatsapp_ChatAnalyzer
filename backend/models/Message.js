const mongoose = require('mongoose');

const messageSchema = new mongoose.Schema({
  id: { type: String, unique: true }, // WhatsApp message ID
  chatId: { type: String, required: true, index: true },
  chatName: { type: String },
  sender: { type: String, required: true },
  message: { type: String },
  timestamp: { type: Date, required: true },
  timestampIST: { type: String }, // DD/MM/YYYY, HH:MM:SS
  exportedAtIST: { type: String }, // DD/MM/YYYY, HH:MM:SS
  hasMedia: { type: Boolean, default: false },
  type: { type: String }
}, {
  timestamps: true,
});

module.exports = mongoose.model('Message', messageSchema);
