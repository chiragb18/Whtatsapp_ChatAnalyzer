const express = require('express');
const { getChats, getMessagesByChatId, logout } = require('../controllers/whatsappController');

const router = express.Router();

router.route('/chats').get(getChats);
router.route('/chats/:chatId/messages').get(getMessagesByChatId);
router.route('/logout').post(logout);

module.exports = router;
