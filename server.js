const express = require('express');
const app = express();
const http = require('http').createServer(app);
const io = require('socket.io')(http, {
  maxHttpBufferSize: 2e8, // 200MB для тяжелых файлов
  cors: { origin: "*", methods: ["GET", "POST"] }
});

app.use(express.static(__dirname));

app.get('/', (req, res) => {
  res.sendFile(__dirname + '/index.html');
});

// База данных аккаунтов со синхронизацией друзей и аватарок
const registeredAccounts = {
  "catoshi": { 
    password: "lekonty12", 
    bio: "Создатель", 
    color: "#6366f1", 
    avatar: "", 
    friends: [], 
    friendRequests: [] 
  }
};

const users = {};
const pinnedMessages = {};
const customRooms = {
  'general': { name: 'Общий чат', type: 'general' }
};

io.on('connection', (socket) => {

  socket.on('auth user', (data) => {
    const { username, password, bio, color } = data;
    
    if (registeredAccounts[username]) {
      if (registeredAccounts[username].password !== password) {
        socket.emit('auth error', 'Неправильный пароль!');
        return;
      }
    } else {
      registeredAccounts[username] = { 
        password, 
        bio: bio || 'В сети', 
        color: color || '#6366f1', 
        avatar: '', 
        friends: [], 
        friendRequests: [] 
      };
    }

    socket.emit('auth success', registeredAccounts[username]);
    sendUserDataToClient(username);
  });

  // Обновление профиля и аватара
  socket.on('update profile', (data) => {
    const { username, bio, color, avatar } = data;
    if (registeredAccounts[username]) {
      registeredAccounts[username].bio = bio;
      registeredAccounts[username].color = color;
      if (avatar) registeredAccounts[username].avatar = avatar;
      sendUserDataToClient(username);
    }
  });

  // Система друзей
  socket.on('send friend request', (data) => {
    const { from, to } = data;
    if (!registeredAccounts[to]) {
      socket.emit('friend error', 'Пользователь с таким логином не найден!');
      return;
    }
    if (to === from) {
      socket.emit('friend error', 'Нельзя добавить самого себя!');
      return;
    }
    if (registeredAccounts[from].friends.includes(to)) {
      socket.emit('friend error', 'Этот пользователь уже у вас в друзьях!');
      return;
    }
    if (registeredAccounts[to].friendRequests.includes(from)) {
      socket.emit('friend error', 'Заявка уже отправлена!');
      return;
    }

    registeredAccounts[to].friendRequests.push(from);
    sendUserDataToClient(to);
    socket.emit('friend success', 'Заявка отправлена!');
  });

  socket.on('accept friend request', (data) => {
    const { username, friend } = data;
    if (registeredAccounts[username] && registeredAccounts[friend]) {
      // Удаляем из заявок
      registeredAccounts[username].friendRequests = registeredAccounts[username].friendRequests.filter(f => f !== friend);
      // Добавляем в друзья обоим
      if (!registeredAccounts[username].friends.includes(friend)) registeredAccounts[username].friends.push(friend);
      if (!registeredAccounts[friend].friends.includes(username)) registeredAccounts[friend].friends.push(username);

      sendUserDataToClient(username);
      sendUserDataToClient(friend);
    }
  });

  socket.on('reject friend request', (data) => {
    const { username, friend } = data;
    if (registeredAccounts[username]) {
      registeredAccounts[username].friendRequests = registeredAccounts[username].friendRequests.filter(f => f !== friend);
      sendUserDataToClient(username);
    }
  });

  // Создание комнат (групп / сообществ)
  socket.on('create room', (data) => {
    const { name, type } = data;
    const roomId = name.trim().toLowerCase();
    if (!customRooms[roomId]) {
      customRooms[roomId] = { name: name.trim(), type: type };
      io.emit('room created', customRooms[roomId]);
    }
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
    
    socket.emit('rooms list', customRooms);
    socket.emit('pinned message', pinnedMessages[room] || null);
    io.to(room).emit('system message', `${data.name} вошел(шла) в чат`);
    io.to(room).emit('update users list', getUsersInRoom(room));
  });

  socket.on('change room', (newRoom) => {
    if (!users[socket.id]) return;

    const oldRoom = users[socket.id].room;
    const targetRoom = newRoom.trim().toLowerCase();

    if (oldRoom === targetRoom || !customRooms[targetRoom]) return;

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

  socket.on('pin message', (data) => {
    if (users[socket.id]) {
      const room = users[socket.id].room;
      pinnedMessages[room] = data;
      io.to(room).emit('pinned message', data);
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

function sendUserDataToClient(username) {
  for (let id in users) {
    if (users[id].name === username) {
      io.to(id).emit('sync user data', {
        friends: registeredAccounts[username].friends,
        friendRequests: registeredAccounts[username].friendRequests,
        avatar: registeredAccounts[username].avatar
      });
    }
  }
}

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
  console.log('Сервер запущен и полностью оптимизирован!');
});