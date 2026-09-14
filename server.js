const express = require('express');
const http = require('http');
const path = require('path');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);

// We configure maxHttpBufferSize to 60MB so 50MB files pass entirely in RAM buffers
const io = new Server(server, {
  maxHttpBufferSize: 60 * 1024 * 1024,
  cors: {
    origin: '*',
    methods: ['GET', 'POST']
  },
  transports: ['websocket', 'polling']
});

const PORT = process.env.PORT || 3000;

// Check whether index.html is located inside /public or the root folder
const fs = require('fs');
const publicDir = path.join(__dirname, 'public');
const hasPublicDir = fs.existsSync(path.join(publicDir, 'index.html'));
const indexPath = hasPublicDir 
  ? path.join(publicDir, 'index.html') 
  : path.join(__dirname, 'index.html');

if (hasPublicDir) {
  app.use(express.static(publicDir));
} else {
  app.use(express.static(__dirname));
}

// Fallback routing: Any /room/:roomId request resolves to the SPA client
app.get('/room/:roomId', (req, res) => {
  res.sendFile(indexPath);
});

// Root route handler
app.get('/', (req, res) => {
  res.sendFile(indexPath);
});

// Map tracking room population solely in active RAM: RoomId -> Set(SocketId)
const activeRooms = new Map();

io.on('connection', (socket) => {
  let currentRoomId = null;

  socket.on('join-room', (roomId) => {
    if (!roomId || typeof roomId !== 'string') return;

    currentRoomId = roomId.trim();
    socket.join(currentRoomId);

    if (!activeRooms.has(currentRoomId)) {
      activeRooms.set(currentRoomId, new Set());
    }
    activeRooms.get(currentRoomId).add(socket.id);

    const roomMembers = activeRooms.get(currentRoomId);
    const peerCount = roomMembers.size;

    // Acknowledge connection to joining client
    socket.emit('room-joined', {
      roomId: currentRoomId,
      peerCount: peerCount,
      socketId: socket.id
    });

    // Notify other peers in the room
    socket.to(currentRoomId).emit('peer-connected', {
      peerCount: peerCount,
      senderId: socket.id
    });
  });

  socket.on('send-text', (data) => {
    if (!currentRoomId || !data || !data.text) return;

    // Immediate volatile stream to all other clients in the room (Zero disk write)
    socket.to(currentRoomId).emit('receive-text', {
      senderId: socket.id,
      text: String(data.text).slice(0, 5000), // Protect memory payload
      timestamp: Date.now()
    });
  });

  socket.on('send-file', (filePayload) => {
    if (!currentRoomId || !filePayload) return;

    // Enforce 50MB payload limit directly in RAM buffer inspection
    if (filePayload.fileSize > 52428800) {
      socket.emit('transfer-error', { message: 'Payload exceeds strict 50MB RAM limit.' });
      return;
    }

    // Direct RAM-to-RAM relay: Broadcast payload immediately without disk persistence
    socket.to(currentRoomId).emit('receive-file', {
      senderId: socket.id,
      fileName: filePayload.fileName,
      fileType: filePayload.fileType,
      fileSize: filePayload.fileSize,
      fileBuffer: filePayload.fileBuffer,
      timestamp: Date.now()
    });
  });

  socket.on('transfer-progress', (progressData) => {
    if (!currentRoomId) return;
    socket.to(currentRoomId).emit('peer-transfer-progress', {
      senderId: socket.id,
      percentage: progressData.percentage,
      fileName: progressData.fileName
    });
  });

  socket.on('disconnect', () => {
    if (currentRoomId && activeRooms.has(currentRoomId)) {
      const roomMembers = activeRooms.get(currentRoomId);
      roomMembers.delete(socket.id);

      if (roomMembers.size === 0) {
        // Complete memory eradication: remove room entry completely from RAM
        activeRooms.delete(currentRoomId);
      } else {
        // Notify remaining peers of connection drop
        socket.to(currentRoomId).emit('peer-disconnected', {
          peerCount: roomMembers.size,
          senderId: socket.id
        });
      }
    }
  });
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`[ZERO-STORAGE BROKER] Running securely on port ${PORT}`);
  console.log(`[VOLATILE MEMORY] 100% ephemeral in-RAM streaming active.`);
});