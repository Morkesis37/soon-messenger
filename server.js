const express = require('express');
const app = express();
const http = require('http').createServer(app);
const io = require('socket.io')(http, {
  maxHttpBufferSize: 1e8, // 100MB для тяжелых файлов
  cors: { origin: "*", methods: ["GET", "POST"] }
});

app.use(express.static(__dirname));

app.get('/', (req, res) => {
  res.sendFile(__dirname + '/index.html');
});

// База данных аккаунтов на сервере (синхронизация)
const registeredAccounts = {
  "catoshi": { password: "lekonty12", bio: "Создатель", color: "#6366f1", avatar: "" }
};

const users = {};
const pinnedMessages = {};

io.on('connection', (socket) => {

  // Авторизация и регистрация
  socket.on('auth user', (data) => {
    const { username, password, bio, color, avatar } = data;
    
    if (registeredAccounts[username]) {
      if (registeredAccounts[username].password !== password) {
        socket.emit('auth error', 'Неправильный пароль!');
        return;
      }
    } else {
      registeredAccounts[username] = { password, bio: bio || 'В сети', color: color || '#6366f1', avatar: avatar || '' };
    }

    socket.emit('auth success', registeredAccounts[username]);
  });

  socket.on('user join', (data) => {
    const room = (data.room || 'general').toLowerCase();
    socket.join(room);
    users[socket.id] = { 
      name: data.name, 
      avatar: data.avatar, 
      color: data.color,
      status: data.status,
      room: room 
    };
    
    socket.emit('pinned message', pinnedMessages[room] || null);
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

    socket.emit('pinned message', pinnedMessages[targetRoom] || null);
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

  socket.on('pin message', (data) => {
    if (users[socket.id]) {
      const room = users[socket.id].room;
      pinnedMessages[room] = data;
      io.to(room).emit('pinned message', data);
    }
  });

  socket.on('vote poll', (data) => {
    if (users[socket.id]) {
      const room = users[socket.id].room;
      io.to(room).emit('update poll', data);
    }
  });

  socket.on('add reaction', (data) => {
    if (users[socket.id]) {
      const room = users[socket.id].room;
      io.to(room).emit('update reaction', data);
    }
  });

  const typingUsers = new Set();
  socket.on('typing', (isTyping) => {
    if (!users[socket.id]) return;
    const room = users[socket.id].room;
    if (isTyping) {
      typingUsers.add(users[socket.id].name);
    } else {
      typingUsers.delete(users[socket.id].name);
    }
    io.to(room).emit('typing status', Array.from(typingUsers));
  });

  socket.on('disconnect', () => {
    if (users[socket.id]) {
      const room = users[socket.id].room;
      typingUsers.delete(users[socket.id].name);
      io.to(room).emit('system message', `${users[socket.id].name} вышел из сети`);
      delete users[socket.id];
      io.to(room).emit('update users list', getUsersInRoom(room));
      io.to(room).emit('typing status', Array.from(typingUsers));
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