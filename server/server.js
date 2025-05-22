const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const path = require('path');
require('dotenv').config();
const mongoose = require('mongoose');

const app = express();
const server = http.createServer(app);
const io = socketIo(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  }
});

// MongoDB connection
mongoose.connect(process.env.MONGO_URI)
  .then(() => console.log('✅ Connected to MongoDB'))
  .catch(err => console.error('❌ MongoDB error:', err));

// Import Message model
const Message = require('./models/Message');

// Serve static files from current directory (where your HTML files are)
app.use(express.static(__dirname));

// Route for root path - serve login page
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'login.html'));
});

// Route for login page
app.get('/login.html', (req, res) => {
  res.sendFile(path.join(__dirname, 'login.html'));
});

// Route for chat page
app.get('/chat.html', (req, res) => {
  res.sendFile(path.join(__dirname, 'chat.html'));
});

const users = {}; // username -> socket.id
const activeCalls = {}; // track active calls

io.on('connection', (socket) => {
  console.log('A user connected:', socket.id);

  // User registration
  socket.on('register', async (username) => {
    if (users[username]) {
      socket.emit('register failed', 'Username is already taken');
      return;
    }

    users[username] = socket.id;
    socket.username = username; // Store username on socket for easy access
    socket.emit('register success', username);
    io.emit('user list', Object.keys(users));

    console.log(`${username} registered with socket ${socket.id}`);

    // Load chat history from MongoDB
    try {
      const history = await Message.find({ to: username })
        .sort({ timestamp: 1 })
        .limit(20);

      socket.emit('chat history', history);
    } catch (err) {
      console.error('Failed to load chat history:', err);
    }
  });

  // Handle private messages (server-based)
  socket.on('private message', async ({ to, message, from }) => {
    const recipientSocketId = users[to];
    
    // Save message to database
    try {
      const newMessage = new Message({ from, to, message });
      await newMessage.save();
      console.log(`Message saved: ${from} -> ${to}: ${message}`);
    } catch (err) {
      console.error('Failed to save message:', err);
    }

    // Forward to recipient if online
    if (recipientSocketId) {
      io.to(recipientSocketId).emit('private message', { from, message });
    }
  });

  // WebRTC Signaling Handlers
  socket.on('webrtc-offer', ({ to, offer, callType }) => {
    const recipientSocketId = users[to];
    if (recipientSocketId) {
      // Track the call
      const callId = `${socket.username}-${to}`;
      activeCalls[callId] = {
        caller: socket.username,
        recipient: to,
        type: callType || 'voice',
        status: 'calling',
        startTime: Date.now()
      };

      io.to(recipientSocketId).emit('webrtc-offer', {
        from: socket.username,
        offer: offer,
        callType: callType || 'voice'
      });
      console.log(`WebRTC ${callType || 'voice'} call offer: ${socket.username} -> ${to}`);
    } else {
      socket.emit('webrtc-error', { message: 'Recipient not found or offline' });
    }
  });

  socket.on('webrtc-answer', ({ to, answer }) => {
    const recipientSocketId = users[to];
    if (recipientSocketId) {
      // Update call status
      const callId = `${to}-${socket.username}`;
      if (activeCalls[callId]) {
        activeCalls[callId].status = 'connected';
      }

      io.to(recipientSocketId).emit('webrtc-answer', {
        from: socket.username,
        answer: answer
      });
      console.log(`WebRTC answer: ${socket.username} -> ${to}`);
    }
  });

  socket.on('ice-candidate', ({ to, candidate }) => {
    const recipientSocketId = users[to];
    if (recipientSocketId) {
      io.to(recipientSocketId).emit('ice-candidate', {
        from: socket.username,
        candidate: candidate
      });
      // Don't log each ICE candidate to avoid spam
    }
  });

  // Call management events
  socket.on('call-declined', ({ to }) => {
    const recipientSocketId = users[to];
    if (recipientSocketId) {
      io.to(recipientSocketId).emit('call-declined', {
        from: socket.username
      });
      
      // Remove from active calls
      const callId1 = `${socket.username}-${to}`;
      const callId2 = `${to}-${socket.username}`;
      delete activeCalls[callId1];
      delete activeCalls[callId2];
      
      console.log(`Call declined: ${socket.username} -> ${to}`);
    }
  });

  socket.on('call-ended', ({ to }) => {
    const recipientSocketId = users[to];
    if (recipientSocketId) {
      io.to(recipientSocketId).emit('call-ended', {
        from: socket.username
      });
      
      // Remove from active calls and log duration
      const callId1 = `${socket.username}-${to}`;
      const callId2 = `${to}-${socket.username}`;
      
      const call = activeCalls[callId1] || activeCalls[callId2];
      if (call) {
        const duration = Math.floor((Date.now() - call.startTime) / 1000);
        console.log(`Call ended: ${call.caller} <-> ${call.recipient} (${duration}s)`);
      }
      
      delete activeCalls[callId1];
      delete activeCalls[callId2];
    }
  });

  // Handle connection status updates (optional)
  socket.on('webrtc-status', ({ to, status }) => {
    const recipientSocketId = users[to];
    if (recipientSocketId) {
      io.to(recipientSocketId).emit('webrtc-status', {
        from: socket.username,
        status: status
      });
    }
  });

  // Handle disconnect
  socket.on('disconnect', () => {
    if (socket.username) {
      // End any active calls involving this user
      Object.keys(activeCalls).forEach(callId => {
        const call = activeCalls[callId];
        if (call.caller === socket.username || call.recipient === socket.username) {
          const otherUser = call.caller === socket.username ? call.recipient : call.caller;
          const otherSocketId = users[otherUser];
          
          if (otherSocketId) {
            io.to(otherSocketId).emit('call-ended', {
              from: socket.username,
              reason: 'user_disconnected'
            });
          }
          
          delete activeCalls[callId];
          console.log(`Call terminated due to disconnect: ${callId}`);
        }
      });

      delete users[socket.username];
      io.emit('user list', Object.keys(users));
      console.log(`${socket.username} disconnected`);
    }
  });

  // Error handling
  socket.on('error', (error) => {
    console.error('Socket error:', error);
  });
});

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({ 
    status: 'OK', 
    timestamp: new Date().toISOString(),
    activeUsers: Object.keys(users).length,
    activeCalls: Object.keys(activeCalls).length
  });
});

// API endpoint to get call statistics
app.get('/api/calls', (req, res) => {
  res.json({
    activeCalls: Object.keys(activeCalls).length,
    callDetails: activeCalls
  });
});

// Start server
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`🚀 Server running on http://localhost:${PORT}`);
  console.log(`📊 WebRTC signaling enabled`);
  console.log(`📞 Voice & Video calls supported`);
  console.log(`📁 Serving files from: ${__dirname}`);
});

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('Shutting down gracefully...');
  server.close(() => {
    mongoose.connection.close();
    process.exit(0);
  });
});