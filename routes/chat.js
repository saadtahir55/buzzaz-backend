const express = require('express');
const { authMiddleware } = require('../middleware/auth');
const pg = require('../services/db');

const router = express.Router();

// Middleware to ensure user is authenticated
router.use(authMiddleware);

// Content filtering function to block email/phone sharing
const filterSensitiveContent = (message) => {
  // Email patterns
  const emailRegex = /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b/g;
  
  // Phone number patterns (various formats)
  const phoneRegex = /(\+?\d{1,4}[-.\s]?)?\(?\d{1,4}\)?[-.\s]?\d{1,4}[-.\s]?\d{1,9}/g;
  
  // WhatsApp/Telegram patterns
  const whatsappRegex = /whatsapp|wa\.me|t\.me|telegram/gi;
  
  // Social media handle patterns that might be used for contact
  const socialRegex = /@[a-zA-Z0-9._]+/g;
  
  let filteredMessage = message;
  
  // Replace emails with asterisks
  filteredMessage = filteredMessage.replace(emailRegex, '*****');
  
  // Replace phone numbers with asterisks
  filteredMessage = filteredMessage.replace(phoneRegex, '*****');
  
  // Replace WhatsApp/Telegram mentions
  filteredMessage = filteredMessage.replace(whatsappRegex, '*****');
  
  // Replace social media handles that look like contact info
  filteredMessage = filteredMessage.replace(socialRegex, '*****');
  
  return filteredMessage;
};

// Get or create conversation between two users
router.post('/conversations', async (req, res) => {
  try {
    const { participantId } = req.body;
    const currentUserId = req.user.uid;

    if (!participantId) {
      return res.status(400).json({ message: 'Participant ID is required' });
    }

    if (participantId === currentUserId) {
      return res.status(400).json({ message: 'Cannot create conversation with yourself' });
    }

    // Check if participant exists and get their role from Postgres
    const participantRes = await pg.query('SELECT uid, email, role, display_name FROM users WHERE uid = $1 LIMIT 1', [participantId]);
    if (participantRes.rowCount === 0) {
      return res.status(404).json({ message: 'Participant not found' });
    }

    const participantData = participantRes.rows[0];
    const currentUserRole = req.user.role;
    const participantRole = participantData.role;

    // Validate that only brands can chat with influencers/ugc_creators and vice versa
    const validCombinations = [
      (currentUserRole === 'brand' && ['influencer', 'ugc_creator'].includes(participantRole)),
      (['influencer', 'ugc_creator'].includes(currentUserRole) && participantRole === 'brand')
    ];

    if (!validCombinations.some(combo => combo)) {
      return res.status(403).json({ 
        message: 'Chat is only allowed between brands and influencers/UGC creators' 
      });
    }

    // Create conversation ID (sorted to ensure consistency)
    const conversationId = [currentUserId, participantId].sort().join('_');

    // Check if conversation already exists in Postgres
    const existing = await pg.query('SELECT * FROM conversations WHERE id = $1', [conversationId]);
    if (existing.rowCount > 0) {
      const row = existing.rows[0];
      return res.json({ conversationId, conversation: {
        id: row.id,
        participants: row.participants,
        participantDetails: row.participant_details,
        lastMessage: row.last_message,
        lastMessageTime: row.last_message_time,
        createdAt: row.created_at?.toISOString?.() || row.created_at,
        updatedAt: row.updated_at?.toISOString?.() || row.updated_at
      }});
    }

    // Create new conversation in Postgres
    const conversationData = {
      id: conversationId,
      participants: [currentUserId, participantId],
      participantDetails: {
        [currentUserId]: {
          name: req.user.fullName || req.user.email,
          role: currentUserRole
        },
        [participantId]: {
          name: participantData.display_name || participantData.email,
          role: participantRole
        }
      },
      lastMessage: null,
      lastMessageTime: null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };

    await pg.query(
      'INSERT INTO conversations (id, participants, participant_details, last_message, last_message_time, created_at, updated_at) VALUES ($1, $2, $3, $4, $5, $6, $7)',
      [
        conversationData.id,
        conversationData.participants,
        conversationData.participantDetails,
        conversationData.lastMessage,
        conversationData.lastMessageTime,
        conversationData.createdAt,
        conversationData.updatedAt
      ]
    );

    res.status(201).json({ conversationId, conversation: conversationData });

  } catch (error) {
    console.error('Create conversation error:', error);
    res.status(500).json({ message: 'Server error while creating conversation' });
  }
});

// Get user's conversations
router.get('/conversations', async (req, res) => {
  try {
    const currentUserId = req.user.uid;

    const result = await pg.query(
      'SELECT id, participants, participant_details, last_message, last_message_time, created_at, updated_at FROM conversations WHERE $1 = ANY(participants) ORDER BY updated_at DESC',
      [currentUserId]
    );

    const conversations = result.rows.map(row => ({
      id: row.id,
      participants: row.participants,
      participantDetails: row.participant_details,
      lastMessage: row.last_message,
      lastMessageTime: row.last_message_time,
      createdAt: row.created_at?.toISOString?.() || row.created_at,
      updatedAt: row.updated_at?.toISOString?.() || row.updated_at
    }));

    res.json({ conversations });

  } catch (error) {
    console.error('Get conversations error:', error);
    res.status(500).json({ message: 'Server error while fetching conversations' });
  }
});

// Send message in conversation
router.post('/conversations/:conversationId/messages', async (req, res) => {
  try {
    const { conversationId } = req.params;
    const { message } = req.body;
    const currentUserId = req.user.uid;

    if (!message || message.trim().length === 0) {
      return res.status(400).json({ message: 'Message content is required' });
    }

    // Check if conversation exists and user is participant (Postgres)
    const convRes = await pg.query('SELECT id, participants FROM conversations WHERE id = $1', [conversationId]);
    if (convRes.rowCount === 0) {
      return res.status(404).json({ message: 'Conversation not found' });
    }
    const conversationData = convRes.rows[0];
    if (!conversationData.participants.includes(currentUserId)) {
      return res.status(403).json({ message: 'You are not a participant in this conversation' });
    }

    // Filter sensitive content
    const filteredMessage = filterSensitiveContent(message.trim());

    // Create message
    const messageData = {
      id: `msg_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      senderId: currentUserId,
      senderName: req.user.fullName || req.user.email,
      message: filteredMessage,
      timestamp: new Date().toISOString(),
      isFiltered: filteredMessage !== message.trim()
    };

    await pg.query(
      'INSERT INTO messages (id, conversation_id, sender_id, sender_name, message, timestamp, is_filtered) VALUES ($1, $2, $3, $4, $5, $6, $7)',
      [
        messageData.id,
        conversationId,
        messageData.senderId,
        messageData.senderName,
        messageData.message,
        messageData.timestamp,
        messageData.isFiltered
      ]
    );

    await pg.query(
      'UPDATE conversations SET last_message = $1, last_message_time = $2, last_message_sender = $3, updated_at = $2 WHERE id = $4',
      [filteredMessage, messageData.timestamp, currentUserId, conversationId]
    );

    res.status(201).json({ message: messageData, isFiltered: messageData.isFiltered });

  } catch (error) {
    console.error('Send message error:', error);
    res.status(500).json({ message: 'Server error while sending message' });
  }
});

// Get messages in conversation
router.get('/conversations/:conversationId/messages', async (req, res) => {
  try {
    const { conversationId } = req.params;
    const { page = 1, limit = 50 } = req.query;
    const currentUserId = req.user.uid;

    // Check if conversation exists and user is participant (Postgres)
    const convRes = await pg.query('SELECT id, participants, participant_details, last_message, last_message_time, created_at, updated_at FROM conversations WHERE id = $1', [conversationId]);
    if (convRes.rowCount === 0) {
      return res.status(404).json({ message: 'Conversation not found' });
    }
    const conversationRow = convRes.rows[0];
    if (!conversationRow.participants.includes(currentUserId)) {
      return res.status(403).json({ message: 'You are not a participant in this conversation' });
    }

    const msgRes = await pg.query(
      'SELECT id, sender_id as "senderId", sender_name as "senderName", message, timestamp, is_filtered as "isFiltered" FROM messages WHERE conversation_id = $1 ORDER BY timestamp DESC LIMIT $2',
      [conversationId, parseInt(limit)]
    );

    const messages = msgRes.rows.reverse();

    res.json({ messages, conversation: {
      id: conversationRow.id,
      participants: conversationRow.participants,
      participantDetails: conversationRow.participant_details,
      lastMessage: conversationRow.last_message,
      lastMessageTime: conversationRow.last_message_time,
      createdAt: conversationRow.created_at?.toISOString?.() || conversationRow.created_at,
      updatedAt: conversationRow.updated_at?.toISOString?.() || conversationRow.updated_at
    }});

  } catch (error) {
    console.error('Get messages error:', error);
    res.status(500).json({ message: 'Server error while fetching messages' });
  }
});

// Get conversation details
router.get('/conversations/:conversationId', async (req, res) => {
  try {
    const { conversationId } = req.params;
    const currentUserId = req.user.uid;
    const convRes = await pg.query('SELECT id, participants, participant_details, last_message, last_message_time, created_at, updated_at FROM conversations WHERE id = $1', [conversationId]);
    if (convRes.rowCount === 0) {
      return res.status(404).json({ message: 'Conversation not found' });
    }
    const row = convRes.rows[0];
    if (!row.participants.includes(currentUserId)) {
      return res.status(403).json({ message: 'You are not a participant in this conversation' });
    }

    res.json({ conversation: {
      id: row.id,
      participants: row.participants,
      participantDetails: row.participant_details,
      lastMessage: row.last_message,
      lastMessageTime: row.last_message_time,
      createdAt: row.created_at?.toISOString?.() || row.created_at,
      updatedAt: row.updated_at?.toISOString?.() || row.updated_at
    }});

  } catch (error) {
    console.error('Get conversation error:', error);
    res.status(500).json({ message: 'Server error while fetching conversation' });
  }
});

module.exports = router;
