const express = require('express');
const app = express();
const http = require('http').createServer(app);
// Увеличиваем лимит размера передаваемых файлов до 10 МБ
const io = require('socket.io')(http, {
  maxHttpBufferSize: 1e7,
  cors: { origin: "*", methods: ["GET", "POST"] }
});

app.use(express.static(__dirname));

app.get('/', (req, res) => {
  res.sendFile(__dirname + '/index.html');
});

const users = {};

io.on('connection', (socket) => {

  // Вход пользователя
  socket.on('user join', (data) => {
    const room = (data.room || 'general').toLowerCase();
    socket.join(room);
    users[socket.id] = { name: data.name, avatar: data.avatar, room: room };
    
    const roomName = room === 'general' ? 'Общий чат' : `комнату "${room}"`;
    io.to(room).emit('system message', `${data.name} вошел(шла) в ${roomName}`);
  });

  // Смена комнаты
  socket.on('change room', (newRoom) => {
    if (!users[socket.id]) return;

    const oldRoom = users[socket.id].room;
    const targetRoom = newRoom.trim().toLowerCase() || 'general';

    if (oldRoom === targetRoom) return;

    socket.leave(oldRoom);
    io.to(oldRoom).emit('system message', `${users[socket.id].name} перешел(шла) в другой чат`);

    socket.join(targetRoom);
    users[socket.id].room = targetRoom;

    const roomName = targetRoom === 'general' ? 'Общий чат' : `комнату "${targetRoom}"`;
    io.to(targetRoom).emit('system message', `${users[socket.id].name} вошел(шла) в ${roomName}`);
  });

  // Сообщения (текст, картинки, голосовые)
  socket.on('chat message', (data) => {
    if (users[socket.id]) {
      const room = users[socket.id].room;
      io.to(room).emit('chat message', data);
    }
  });

  // Реакции
  socket.on('add reaction', (data) => {
    if (users[socket.id]) {
      const room = users[socket.id].room;
      io.to(room).emit('update reaction', data);
    }
  });

  // Печатает...
  socket.on('typing', (isTyping) => {
    if (users[socket.id]) {
      const room = users[socket.id].room;
      socket.to(room).emit('typing status', { name: users[socket.id].name, isTyping });
    }
  });

  // Выход
  socket.on('disconnect', () => {
    if (users[socket.id]) {
      const room = users[socket.id].room;
      io.to(room).emit('system message', `${users[socket.id].name} покинул(а) чат`);
      delete users[socket.id];
    }
  });
});

http.listen(3000, () => {
  console.log('Сервер запущен на порту 3000!');
});