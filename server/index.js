const express = require("express");
const http = require("http");
const path = require("path");
const { Server } = require("socket.io");

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static(path.join(__dirname, "..", "public")));

const rooms = {};

// экономика
const cellPrice = 200;
const cellRent = 50;
const startMoney = 1500;
const startBonus = 200; // зарплата за проход через старт

// какие клетки нельзя покупать (старт, углы, события)
const nonBuyableCells = new Set([0, 10, 20, 30, 9, 29]);
// клетки-события
const eventCells = new Set([9, 29]);

// карточки событий
const eventCards = [
  { id: "bounty", desc: "+200 золота (баунти-руна)", moneyDelta: 200 },
  { id: "tax", desc: "-150 золота (налог на байбек)", moneyDelta: -150 },
  { id: "heal", desc: "+100 золота (курьер принёс голду)", moneyDelta: 100 },
  { id: "trap", desc: "-100 золота (попал под ганги)", moneyDelta: -100 }
];

/*
rooms = {
  roomId: {
    players:   { socketId: positionNumber },
    money:     { socketId: moneyNumber },
    owners:    { cellIndex: socketId | null },
    nicknames: { socketId: string },
    turnOrder: [socketId, ...],
    currentTurnIndex: number
  }
}
*/

function ensureRoom(roomId) {
  if (!rooms[roomId]) {
    rooms[roomId] = {
      players: {},
      money: {},
      owners: {},
      nicknames: {},
      turnOrder: [],
      currentTurnIndex: 0,
    };

    for (let i = 0; i < 40; i++) {
      rooms[roomId].owners[i] = null;
    }
  }
  return rooms[roomId];
}

function broadcastTurn(roomId) {
  const room = rooms[roomId];
  if (!room || room.turnOrder.length === 0) return;

  if (room.currentTurnIndex >= room.turnOrder.length) {
    room.currentTurnIndex = 0;
  }

  const currentPlayerId = room.turnOrder[room.currentTurnIndex];
  if (!currentPlayerId) return;

  io.to(roomId).emit("turnChanged", { playerId: currentPlayerId });
}

function applyEvent(roomId, room, playerId, cellIndex) {
  const card = eventCards[Math.floor(Math.random() * eventCards.length)];
  room.money[playerId] += card.moneyDelta;

  io.to(roomId).emit("eventCard", {
    playerId,
    cellIndex,
    cardId: card.id,
    description: card.desc,
    delta: card.moneyDelta,
    money: room.money[playerId],
  });

  io.to(roomId).emit("moneyUpdated", {
    playerId,
    money: room.money[playerId],
  });
}

function handleBankruptcy(roomId, room, playerId) {
  io.to(roomId).emit("playerBankrupt", {
    playerId,
    nickname: room.nicknames[playerId] || null,
  });

  // освобождаем клетки игрока
  for (let i = 0; i < 40; i++) {
    if (room.owners[i] === playerId) {
      room.owners[i] = null;
      io.to(roomId).emit("cellReleased", { cellIndex: i });
    }
  }

  delete room.players[playerId];
  delete room.money[playerId];
  delete room.nicknames[playerId];

  const idx = room.turnOrder.indexOf(playerId);
  if (idx !== -1) {
    if (idx < room.currentTurnIndex) {
      room.currentTurnIndex--;
    }
    room.turnOrder.splice(idx, 1);
    if (room.currentTurnIndex >= room.turnOrder.length) {
      room.currentTurnIndex = 0;
    }
  }

  // если остался один — победа
  if (room.turnOrder.length <= 1) {
    const winnerId = room.turnOrder[0];
    io.to(roomId).emit("gameOver", {
      winnerId,
      nickname: winnerId ? room.nicknames[winnerId] || null : null,
    });
    delete rooms[roomId];
    return;
  }

  broadcastTurn(roomId);
}

function isCellBuyable(room, cellIndex) {
  if (cellIndex == null || cellIndex < 0 || cellIndex > 39) return false;
  if (nonBuyableCells.has(cellIndex)) return false;
  if (room.owners[cellIndex]) return false;
  return true;
}

function advanceTurn(roomId, room) {
  if (!room) return;
  room.currentTurnIndex++;
  if (room.currentTurnIndex >= room.turnOrder.length) {
    room.currentTurnIndex = 0;
  }
  broadcastTurn(roomId);
}

io.on("connection", (socket) => {
  console.log("Новый игрок:", socket.id);

  // список комнат (для лобби)
  socket.on("listRooms", () => {
    const summary = Object.entries(rooms).map(([roomId, room]) => ({
      roomId,
      players: Object.keys(room.players).length,
    }));
    socket.emit("roomsList", summary);
  });

  // Создание комнаты
  socket.on("createRoom", ({ roomId, nickname }) => {
    if (!roomId || !nickname || !nickname.trim()) {
      socket.emit("errorMessage", {
        message: "Нужно ввести ник и ID комнаты.",
      });
      return;
    }

    const room = ensureRoom(roomId);
    const name = nickname.trim().slice(0, 20);

    if (!room.players[socket.id]) {
      room.players[socket.id] = 0;
      room.turnOrder.push(socket.id);
      room.money[socket.id] = startMoney;
      room.nicknames[socket.id] = name;
    }

    socket.join(roomId);
    socket.emit("roomCreated", { roomId });

    socket.emit("playerInfo", {
      playerId: socket.id,
      nickname: room.nicknames[socket.id],
    });

    socket.emit("moneyInit", {
      playerId: socket.id,
      money: room.money[socket.id],
    });

    // Отправляем ему остальных игроков
    for (const playerId in room.players) {
      if (playerId !== socket.id) {
        socket.emit("playerJoined", {
          playerId,
          nickname: room.nicknames[playerId],
        });
        socket.emit("playerMove", {
          playerId,
          position: room.players[playerId],
        });
        socket.emit("moneyUpdated", {
          playerId,
          money: room.money[playerId],
        });
      }
    }

    // Сообщаем остальным о новом игроке
    socket.to(roomId).emit("playerJoined", {
      playerId: socket.id,
      nickname: room.nicknames[socket.id],
    });
    socket.to(roomId).emit("moneyUpdated", {
      playerId: socket.id,
      money: room.money[socket.id],
    });

    broadcastTurn(roomId);
  });

  // Вход в комнату
  socket.on("joinRoom", ({ roomId, nickname }) => {
    if (!roomId || !nickname || !nickname.trim()) {
      socket.emit("errorMessage", {
        message: "Нужно ввести ник и ID комнаты.",
      });
      return;
    }

    const room = ensureRoom(roomId);
    const name = nickname.trim().slice(0, 20);

    if (!room.players[socket.id]) {
      room.players[socket.id] = 0;
      room.turnOrder.push(socket.id);
      room.money[socket.id] = startMoney;
      room.nicknames[socket.id] = name;
    }

    socket.join(roomId);

    socket.emit("playerInfo", {
      playerId: socket.id,
      nickname: room.nicknames[socket.id],
    });

    socket.emit("moneyInit", {
      playerId: socket.id,
      money: room.money[socket.id],
    });

    // отправляем ему всех остальных
    for (const playerId in room.players) {
      if (playerId !== socket.id) {
        socket.emit("playerJoined", {
          playerId,
          nickname: room.nicknames[playerId],
        });
        socket.emit("playerMove", {
          playerId,
          position: room.players[playerId],
        });
        socket.emit("moneyUpdated", {
          playerId,
          money: room.money[playerId],
        });
      }
    }

    socket.to(roomId).emit("playerJoined", {
      playerId: socket.id,
      nickname: room.nicknames[socket.id],
    });
    socket.to(roomId).emit("moneyUpdated", {
      playerId: socket.id,
      money: room.money[socket.id],
    });

    broadcastTurn(roomId);
  });

  // Ход (движение)
  socket.on("move", ({ roomId, playerId, position }) => {
    const room = rooms[roomId];
    if (!room) return;

    const current = room.turnOrder[room.currentTurnIndex];
    if (current !== socket.id || current !== playerId) return;

    const oldPos = room.players[playerId] ?? 0;
    room.players[playerId] = position;

    // проход через старт
    if (position < oldPos) {
      room.money[playerId] += startBonus;

      io.to(roomId).emit("startPassed", {
        playerId,
        nickname: room.nicknames[playerId] || null,
        bonus: startBonus,
        money: room.money[playerId],
      });

      io.to(roomId).emit("moneyUpdated", {
        playerId,
        money: room.money[playerId],
      });
    }

    io.to(roomId).emit("playerMove", { playerId, position });

    // событие
    if (eventCells.has(position)) {
      applyEvent(roomId, room, playerId, position);
    }

    // аренда (не на событиях)
    const owner = room.owners[position];
    if (owner && owner !== playerId && !eventCells.has(position)) {
      room.money[playerId] -= cellRent;
      room.money[owner] += cellRent;

      io.to(roomId).emit("rentPaid", {
        from: playerId,
        to: owner,
        fromNickname: room.nicknames[playerId] || null,
        toNickname: room.nicknames[owner] || null,
        cellIndex: position,
        amount: cellRent,
        moneyFrom: room.money[playerId],
        moneyTo: room.money[owner],
      });

      io.to(roomId).emit("moneyUpdated", {
        playerId,
        money: room.money[playerId],
      });
      io.to(roomId).emit("moneyUpdated", {
        playerId: owner,
        money: room.money[owner],
      });
    }

    // банкротство
    if (room.money[playerId] < 0) {
      handleBankruptcy(roomId, room, playerId);
      return;
    }

    // если клетка не покупаемая — ход переходит дальше
    if (!isCellBuyable(room, position)) {
      advanceTurn(roomId, room);
    } else {
      // покупаемая — ждём решения игрока
      io.to(roomId).emit("canBuyHere", {
        playerId,
        cellIndex: position,
      });
    }
  });

  // Покупка клетки
  socket.on("buyCell", ({ roomId, playerId, cellIndex }) => {
    const room = rooms[roomId];
    if (!room) return;

    const current = room.turnOrder[room.currentTurnIndex];
    if (current !== socket.id || current !== playerId) return;

    if (!isCellBuyable(room, cellIndex)) {
      socket.emit("purchaseFailed", { reason: "not_buyable" });
      advanceTurn(roomId, room);
      return;
    }

    if (room.money[playerId] < cellPrice) {
      socket.emit("purchaseFailed", { reason: "no_money" });
      advanceTurn(roomId, room);
      return;
    }

    room.money[playerId] -= cellPrice;
    room.owners[cellIndex] = playerId;

    io.to(roomId).emit("cellBought", {
      playerId,
      nickname: room.nicknames[playerId] || null,
      cellIndex,
      money: room.money[playerId],
    });

    io.to(roomId).emit("moneyUpdated", {
      playerId,
      money: room.money[playerId],
    });

    advanceTurn(roomId, room);
  });

  // Отказ от покупки
  socket.on("skipBuy", ({ roomId, playerId }) => {
    const room = rooms[roomId];
    if (!room) return;

    const current = room.turnOrder[room.currentTurnIndex];
    if (current !== socket.id || current !== playerId) return;

    advanceTurn(roomId, room);
  });

  socket.on("disconnect", () => {
    console.log("Игрок отключился:", socket.id);

    for (const roomId in rooms) {
      const room = rooms[roomId];
      if (!room) continue;

      if (room.players[socket.id] !== undefined) {
        handleBankruptcy(roomId, room, socket.id);
      }
    }
  });
});

server.listen(3000, () => {
  console.log("Сервер запущен: http://localhost:3000");
});