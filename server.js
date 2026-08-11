const express = require('express');
const app = express();
const http = require('http').createServer(app);
const io = require('socket.io')(http, {
  maxHttpBufferSize: 5e7, // Увеличили лимит до 50MB для видео
  cors: { origin: "*", methods: ["GET", "POST"] }
});

app.use(express.static(__dirname));

app.get('/', (req, res) => {
  res.sendFile(__dirname + '/index.html');
});

const users = {};

io.on('connection', (socket) => {

  socket.on('user join', (data) => {
    const room = (data.room || 'general').toLowerCase();
    socket.join(room);
    users[socket.id] = { 
      name: data.name, 
      avatar: data.avatar, 
      color: data.color || '#6366f1',
      status: data.status || 'В сети',
      room: room 
    };
    
    io.to(room).emit('system message', `${data.name} вошел(шла) в чат`);
    io.to(room).emit('update users list', getUsersInRoom(room));
  });

  socket.on('change room', (newRoom) => {
    if (!users[socket.id]) return;

    const oldRoom = users[socket.id].room;
    const targetRoom = newRoom.trim().toLowerCase() || 'general';

    if (oldRoom === targetRoom) return;

    socket.leave(oldRoom);
    io.to(oldRoom).emit('system message', `${users[socket.id].name} покинул(а) чат`);
    io.to(oldRoom).emit('update users list', getUsersInRoom(oldRoom));

    socket.join(targetRoom);
    users[socket.id].room = targetRoom;

    io.to(targetRoom).emit('system message', `${users[socket.id].name} вошел(шла) в чат`);
    io.to(targetRoom).emit('update users list', getUsersInRoom(targetRoom));
  });

  socket.on('chat message', (data) => {
    if (users[socket.id]) {
      const room = users[socket.id].room;
      io.to(room).emit('chat message', data);
    }
  });

  socket.on('edit message', (data) => {
    if (users[socket.id]) {
      const room = users[socket.id].room;
      io.to(room).emit('edit message', data);
    }
  });

  socket.on('add reaction', (data) => {
    if (users[socket.id]) {
      const room = users[socket.id].room;
      io.to(room).emit('update reaction', data);
    }
  });

  socket.on('typing', (isTyping) => {
    if (users[socket.id]) {
      const room = users[socket.id].room;
      socket.to(room).emit('typing status', { name: users[socket.id].name, isTyping });
    }
  });

  socket.on('disconnect', () => {
    if (users[socket.id]) {
      const room = users[socket.id].room;
      io.to(room).emit('system message', `${users[socket.id].name} вышел из сети`);
      delete users[socket.id];
      io.to(room).emit('update users list', getUsersInRoom(room));
    }
  });
});

function getUsersInRoom(room) {
  const list = [];
  for (let id in users) {
    if (users[id].room === room) {
      list.push({ name: users[id].name, avatar: users[id].avatar, color: users[id].color, status: users[id].status });
    }
  }
  return list;
}

http.listen(3000, () => {
  console.log('Сервер запущен!');
});