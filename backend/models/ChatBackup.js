const mongoose = require('mongoose');

const chatBackupSchema = new mongoose.Schema({
    chatId: { type: String, required: true },
    chatName: { type: String, required: true },
    backupName: { type: String, required: true },
    messageCount: { type: Number, default: 0 },
    messages: [{ type: mongoose.Schema.Types.Mixed }],
    exportedAt: { type: Date, default: Date.now },
    exportedAtIST: { type: String }
});

module.exports = mongoose.model('ChatBackup', chatBackupSchema);
