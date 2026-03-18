const express = require('express');
const { getMessages, createMessages, createChatBackup } = require('../controllers/messageController');

const router = express.Router();

router.route('/')
  .get(getMessages)
  .post(createMessages);

router.route('/backup')
  .post(createChatBackup);

module.exports = router;
