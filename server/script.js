const socket = io();
const currentUsername = localStorage.getItem('username');
socket.emit('register', currentUsername);
if (!currentUsername) {
  window.location.href = "login.html"; // Redirect if not logged in
}


function register() {
  const usernameInput = document.getElementById('username');
  currentUsername = usernameInput.value.trim();
  if (currentUsername) {
    socket.emit('register', currentUsername);
  }
}

socket.on('register failed', (msg) => {
  alert(msg);
});

socket.on('register success', (username) => {
  document.getElementById('username').disabled = true;
});

const form = document.getElementById('form');
const input = document.getElementById('input');
const messages = document.getElementById('messages');
const userList = document.getElementById('userList');

// Send private message
form.addEventListener('submit', function(e) {
  e.preventDefault();
  const toUser = userList.value;
  const msg = input.value.trim();
  if (msg && toUser) {
    socket.emit('private message', {
      to: toUser,
      from: currentUsername,
      message: msg
    });
    const item = document.createElement('li');
    item.textContent = `[You → ${toUser}]: ${msg}`;
    messages.appendChild(item);
    input.value = '';
  }
});

// Update user list
socket.on('user list', (users) => {
  userList.innerHTML = '';
  users.forEach(user => {
    if (user !== currentUsername) {
      const option = document.createElement('option');
      option.value = user;
      option.textContent = user;
      userList.appendChild(option);
    }
  });
});

// Display incoming private messages
socket.on('private message', ({ from, message }) => {
  const item = document.createElement('li');
  item.textContent = `[${from} → You]: ${message}`;
  messages.appendChild(item);
});
socket.on('chat history', (messages) => {
  messages.forEach(({ from, message }) => {
    const item = document.createElement('li');
    item.textContent = `[${from} → You]: ${message}`;
    messages.appendChild(item);
  });
});
// Load chat history when user registers
socket.on('chat history', (messagesFromDB) => {
  messagesFromDB.forEach(({ from, message }) => {
    const item = document.createElement('li');
    item.textContent = `[${from} → You]: ${message}`;
    messages.appendChild(item);
  });
});
