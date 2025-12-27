const socket = io();

/* ---------- DOM ---------- */

const board = document.getElementById("board");
const boardCenterLabel = document.getElementById("board-center-label");
const logBox = document.getElementById("log");
const turnInfo = document.getElementById("turnInfo");
const moneyInfo = document.getElementById("moneyInfo");
const rollBtn = document.getElementById("rollBtn");
const playersList = document.getElementById("playersList");

// лобби
const roomsList = document.getElementById("roomsList");
const roomsListSide = document.getElementById("roomsList-side");

// профиль
const profileNameEl = document.getElementById("profileName");
const profileStatsEl = document.getElementById("profileStats");
const profileCoinsEl = document.getElementById("profileCoins");
const shopResultEl = document.getElementById("shopResult");

// модалки
const buyModalOverlay = document.getElementById("buyModalOverlay");
const buyModalText = document.getElementById("buyModalText");
const eventModalOverlay = document.getElementById("eventModalOverlay");
const eventModalText = document.getElementById("eventModalText");
const eventModalDelta = document.getElementById("eventModalDelta");
const gameOverOverlay = document.getElementById("gameOverOverlay");
const gameOverText = document.getElementById("gameOverText");
const bankruptOverlay = document.getElementById("bankruptOverlay");
const bankruptText = document.getElementById("bankruptText");

/* ---------- Состояние ---------- */

let myId = null;
let roomId = null;
let currentTurnId = null;

let money = {};
let positions = {};
let players = {};
let nicknames = {};

let iAmBankrupt = false;
let canBuyNow = false;
let buyCellIndex = null;

/* ---------- Профиль / темы ---------- */

let profile = {
    nickname: "",
    gamesPlayed: 0,
    gamesWon: 0,
    coins: 0,
    unlockedThemes: ["classic", "dota"],
    selectedTheme: "classic"
};

let currentTheme = profile.selectedTheme;

/* ---------- Навигация экранов ---------- */

function showScreen(name) {
    const screens = {
        game: document.getElementById("screen-game"),
        profile: document.getElementById("screen-profile"),
        lobby: document.getElementById("screen-lobby")
    };
    const navButtons = {
        game: document.getElementById("nav-game"),
        profile: document.getElementById("nav-profile"),
        lobby: document.getElementById("nav-lobby")
    };

    Object.values(screens).forEach(s => s && s.classList.remove("active"));
    Object.values(navButtons).forEach(b => b && b.classList.remove("active"));

    if (screens[name]) screens[name].classList.add("active");
    if (navButtons[name]) navButtons[name].classList.add("active");
}

/* ---------- Утилиты ---------- */

function log(msg) {
    if (!logBox) return;
    logBox.innerHTML += msg + "<br>";
    logBox.scrollTop = logBox.scrollHeight;
}

function shortName(id) {
    if (!id) return "?";
    return id.slice(0, 4);
}

function displayName(id) {
    return nicknames[id] || shortName(id);
}

function updateMoneyInfo() {
    if (!moneyInfo || !myId) return;
    const val = money[myId];
    if (typeof val !== "number") {
        moneyInfo.textContent = "";
        return;
    }
    moneyInfo.textContent = "Ваш баланс: " + val;
}

function setTurnInfo() {
    if (!turnInfo || !rollBtn) return;

    if (!currentTurnId) {
        turnInfo.textContent = "Ожидание начала игры.";
        rollBtn.disabled = true;
        return;
    }

    if (currentTurnId === myId && !iAmBankrupt) {
        turnInfo.textContent = "Ваш ход";
        rollBtn.disabled = false;
    } else {
        turnInfo.textContent = "Ход игрока: " + displayName(currentTurnId);
        rollBtn.disabled = true;
    }
}

/* ---------- Профиль ---------- */

function loadProfile() {
    try {
        const raw = localStorage.getItem("monopolyProfile");
        if (!raw) return;
        const p = JSON.parse(raw);
        if (!p || typeof p !== "object") return;

        profile = {
            nickname: "",
            gamesPlayed: 0,
            gamesWon: 0,
            coins: 0,
            unlockedThemes: ["classic", "dota"],
            selectedTheme: "classic",
            ...p
        };
        currentTheme = profile.selectedTheme || "classic";
    } catch (e) {
        console.error("Ошибка загрузки профиля", e);
    }
}

function saveProfile() {
    try {
        localStorage.setItem("monopolyProfile", JSON.stringify(profile));
    } catch (e) {
        console.error("Ошибка сохранения профиля", e);
    }
}

function refreshProfileUI() {
    if (!profileNameEl) return;
    profileNameEl.textContent = "Ник: " + (profile.nickname || "Не задан");
    profileStatsEl.textContent =
        "Игр сыграно: " + profile.gamesPlayed + ", побед: " + profile.gamesWon;
    profileCoinsEl.textContent = "Монет: " + profile.coins;
}

function isThemeUnlocked(id) {
    return profile.unlockedThemes.includes(id);
}

function selectTheme(id) {
    if (!isThemeUnlocked(id)) {
        alert("Тема не разблокирована");
        return;
    }
    profile.selectedTheme = id;
    currentTheme = id;
    saveProfile();
    refreshProfileUI();
    applyTheme(id);
}

function openCase() {
    const cost = 150;
    if (profile.coins < cost) {
        alert("Недостаточно монет для открытия кейса (нужно " + cost + ")");
        return;
    }
    profile.coins -= cost;

    const r = Math.random();
    let msg = "";

    if (r < 0.2 && !isThemeUnlocked("neon")) {
        profile.unlockedThemes.push("neon");
        profile.selectedTheme = "neon";
        currentTheme = "neon";
        msg = "Вам выпала новая тема: Neon!";
        applyTheme("neon");
    } else if (r < 0.6) {
        const reward = 300;
        profile.coins += reward;
        msg = "Вы получили " + reward + " монет!";
    } else {
        const consolation = 50;
        profile.coins += consolation;
        msg = "Небольшой приз утешения: " + consolation + " монет.";
    }

    saveProfile();
    refreshProfileUI();
    if (shopResultEl) shopResultEl.textContent = msg;
}

/* ---------- Модалки ---------- */

function showBuyModal(text) {
    if (!buyModalOverlay) return;
    buyModalText.textContent = text;
    buyModalOverlay.style.display = "flex";
}

function hideBuyModal() {
    if (!buyModalOverlay) return;
    buyModalOverlay.style.display = "none";
    canBuyNow = false;
    buyCellIndex = null;
}

function showEventModal(text, deltaText) {
    if (!eventModalOverlay) return;
    eventModalText.textContent = text;
    eventModalDelta.textContent = deltaText;
    eventModalOverlay.style.display = "flex";
}

function closeEventModal() {
    if (!eventModalOverlay) return;
    eventModalOverlay.style.display = "none";
}

function showGameOverModal(text) {
    if (!gameOverOverlay) return;
    gameOverText.textContent = text;
    gameOverOverlay.style.display = "flex";
}

function closeGameOverModal() {
    if (!gameOverOverlay) return;
    gameOverOverlay.style.display = "none";
}

function showBankruptModal(text) {
    if (!bankruptOverlay) return;
    bankruptText.textContent = text;
    bankruptOverlay.style.display = "flex";
}

function closeBankruptModal() {
    if (!bankruptOverlay) return;
    bankruptOverlay.style.display = "none";
}

/* ---------- Доска и темы ---------- */

const boardCells = [];
const maxIndex = 10;

const cellTypes = [
    "start",
    "radiant","radiant","radiant","radiant","radiant","neutral","neutral","neutral","event",
    "corner",
    "dire","dire","dire","dire","dire","dire","neutral","neutral","prison",
    "neutral","neutral","neutral","neutral","neutral","neutral","neutral","neutral","neutral","event",
    "corner",
    "radiant","radiant","dire","dire","neutral","neutral","neutral","neutral","neutral"
];

const cellNamesClassic = [
    "СТАРТ",
    "Бурса-стрит","Коммунальная казна","Уайтчепел-роуд","Налог на доход","Кингс-Кросс ст.",
    "Театр-роуд","Шанс","Эйнджел-ислингтон","Юстон-роуд","Тюрьма / В гостях",
    "Пал-Мэлл","Электростанция","Уайтхолл","Нортумберленд-авеню","Мэрилебон ст.",
    "Боу-стрит","Коммунальная казна","Мальборо-стрит","Вайн-стрит","Бесплатная стоянка",
    "Стрэнд","Шанс","Флит-стрит","Трафальгар-сквер","Фэнчерч-ст.",
    "Лейстер-сквер","Ковентри-стрит","Водопровод","Пикадилли","Отправляйтесь в тюрьму",
    "Риджент-стрит","Оксфорд-стрит","Коммунальная казна","Бонд-стрит","Ливерпуль-ст.",
    "Шанс","Парк-лейн","Налог на роскошь","Мэйн-стрит"
];

const cellNamesDota = [
    "Фонтан (Старт)",
    "Radiant лес","Radiant линия","Radiant башня","Radiant лавка","Radiant лес 2","Neutral лес","Руна","Neutral лагерь","Событие",
    "Река (поворот)",
    "Dire лес","Dire линия","Dire башня","Dire лавка","Dire лес 2","Dire лес 3","Neutral лагерь","Neutral лагерь 2","Тюрьма",
    "Neutral лагерь 3","Neutral лагерь 4","Neutral лагерь 5","Neutral лагерь 6","Neutral лагерь 7","Руна","Neutral лагерь 8","Neutral лагерь 9","Neutral лагерь 10","Событие",
    "Лес (поворот)",
    "Лавка","Лавка 2","Лавка 3","Лавка 4","Лавка 5","Лавка 6","Лавка 7","Лавка 8","Лавка 9"
];

const themes = {
    classic: {
        id: "classic",
        displayName: "MONOPOLY",
        subtitle: "Классическая доска",
        colorsByType: {
            start: "#22c55e",
            radiant: "#f97316",
            dire: "#22c55e",
            neutral: "#fefce8",
            event: "#38bdf8",
            prison: "#ef4444",
            corner: "#111827"
        },
        cellNames: cellNamesClassic
    },
    dota: {
        id: "dota",
        displayName: "DOTA BOARD",
        subtitle: "Dota 2 стиль",
        colorsByType: {
            start: "#22c55e",
            radiant: "#4ade80",
            dire: "#f97316",
            neutral: "#020617",
            event: "#eab308",
            prison: "#ef4444",
            corner: "#1f2937"
        },
        cellNames: cellNamesDota
    },
    neon: {
        id: "neon",
        displayName: "NEON BOARD",
        subtitle: "Неоновая тема",
        colorsByType: {
            start: "#22c55e",
            radiant: "#22d3ee",
            dire: "#f97316",
            neutral: "#020617",
            event: "#a855f7",
            prison: "#f97316",
            corner: "#020617"
        },
        cellNames: cellNamesClassic
    }
};

function pricingForCell(index, type) {
    if (type === "radiant" || type === "dire" || type === "neutral") {
        return {
            price: 200,
            rent: 50,
            mortgage: 100,
            buyback: 120
        };
    }
    return null;
}

// координаты в 11x11 сетке
function getCellGridPos(i) {
    if (i >= 0 && i <= 10) return { x: maxIndex - i, y: maxIndex };           // низ
    if (i >= 11 && i <= 20) return { x: 0, y: maxIndex - (i - 10) };          // лево
    if (i >= 21 && i <= 30) return { x: i - 20, y: 0 };                       // верх
    return { x: maxIndex, y: i - 30 };                                        // право
}

function iconForType(type) {
    switch (type) {
        case "start": return "⭐";
        case "event": return "❓";
        case "prison": return "⛓️";
        case "radiant":
        case "dire": return "🏠";
        default: return "";
    }
}

// СТРОИМ ДОСКУ: клетки как элементы grid
function buildBoard() {
    if (!board) return;

    for (let i = 0; i < 40; i++) {
        const cell = document.createElement("div");
        const type = cellTypes[i] || "neutral";

        cell.classList.add("cell");
        cell.dataset.type = type;

        const { x, y } = getCellGridPos(i);
        // grid-координаты (1..11)
        cell.style.gridColumn = (x + 1);
        cell.style.gridRow = (y + 1);

        let side;
        if (i >= 0 && i <= 10) side = "bottom";
        else if (i >= 11 && i <= 20) side = "left";
        else if (i >= 21 && i <= 30) side = "top";
        else side = "right";
        cell.classList.add("side-" + side);

        const card = document.createElement("div");
        card.className = "cell-card";

        const inner = document.createElement("div");
        inner.className = "cell-card-inner";

        const front = document.createElement("div");
        front.className = "cell-face cell-front";

        const strip = document.createElement("div");
        strip.className = "cell-strip";

        const body = document.createElement("div");
        body.className = "cell-body";

        const iconEl = document.createElement("div");
        iconEl.className = "cell-icon";

        const nameEl = document.createElement("div");
        nameEl.className = "cell-name";

        body.appendChild(iconEl);
        body.appendChild(nameEl);
        front.appendChild(strip);
        front.appendChild(body);

        const back = document.createElement("div");
        back.className = "cell-face cell-back";

        const backBody = document.createElement("div");
        backBody.className = "cell-back-body";

        const backTitle = document.createElement("div");
        backTitle.className = "cell-back-title";

        const pricing = pricingForCell(i, type);
        if (pricing) {
            const priceLine = document.createElement("div");
            priceLine.className = "cell-back-line";
            priceLine.textContent = "Цена покупки: " + pricing.price;

            const rentLine = document.createElement("div");
            rentLine.className = "cell-back-line";
            rentLine.textContent = "Аренда: " + pricing.rent;

            const mortLine = document.createElement("div");
            mortLine.className = "cell-back-line";
            mortLine.textContent = "Залог: " + pricing.mortgage;

            const buybackLine = document.createElement("div");
            buybackLine.className = "cell-back-line";
            buybackLine.textContent = "Выкуп: " + pricing.buyback;

            backBody.appendChild(backTitle);
            backBody.appendChild(priceLine);
            backBody.appendChild(rentLine);
            backBody.appendChild(mortLine);
            backBody.appendChild(buybackLine);
        } else {
            const special = document.createElement("div");
            special.className = "cell-back-line";
            special.textContent = "Особая клетка. Покупка недоступна.";
            backBody.appendChild(backTitle);
            backBody.appendChild(special);
        }

        back.appendChild(backBody);
        inner.appendChild(front);
        inner.appendChild(back);
        card.appendChild(inner);
        cell.appendChild(card);

        board.appendChild(cell);
        boardCells.push(cell);
    }
}

function applyTheme(themeId) {
    const theme = themes[themeId] || themes.classic;
    currentTheme = themeId;

    if (boardCenterLabel) {
        if (themeId === "classic") {
            boardCenterLabel.innerHTML =
                `<div class="mono-logo">MONOPOLY</div><div class="mono-subtitle">Классическая доска</div>`;
        } else {
            boardCenterLabel.innerHTML =
                `<div class="mono-logo">${theme.displayName}</div><div class="mono-subtitle">${theme.subtitle}</div>`;
        }
    }

    for (let i = 0; i < boardCells.length; i++) {
        const cell = boardCells[i];
        const type = cell.dataset.type || "neutral";
        const name = theme.cellNames[i] || ("Клетка " + i);
        const icon = iconForType(type);

        const strip = cell.querySelector(".cell-strip");
        const iconEl = cell.querySelector(".cell-icon");
        const nameEl = cell.querySelector(".cell-name");
        const backTitleEl = cell.querySelector(".cell-back-title");

        if (iconEl) iconEl.textContent = icon;
        if (nameEl) nameEl.textContent = name;
        if (backTitleEl) backTitleEl.textContent = name;

        const colors = theme.colorsByType;
        const base = colors[type] || colors.neutral;
        if (strip && !cell.classList.contains("cell-owned")) {
            strip.style.backgroundColor = base;
        }
    }
}

function highlightCurrentCell() {
    boardCells.forEach(c => c.classList.remove("current-cell"));
    if (!currentTurnId) return;
    const pos = positions[currentTurnId];
    if (typeof pos !== "number") return;
    const cell = boardCells[pos];
    if (cell) cell.classList.add("current-cell");
}

/* ---------- Фишки ---------- */

function colorFromId(id) {
    let hash = 0;
    for (let i = 0; i < id.length; i++) {
        hash = id.charCodeAt(i) + ((hash << 5) - hash);
    }
    let color = "#";
    for (let i = 0; i < 3; i++) {
        const v = (hash >> (i * 8)) & 0xff;
        color += ("00" + v.toString(16)).slice(-2);
    }
    return color;
}

function createPlayerChip(id) {
    if (!board || players[id]) return;

    const chip = document.createElement("div");
    chip.className = "player";
    chip.style.backgroundColor = colorFromId(id);

    const label = document.createElement("div");
    label.style.position = "absolute";
    label.style.top = "-11px";
    label.style.left = "-2px";
    label.style.fontSize = "10px";
    label.textContent = shortName(id);
    chip.appendChild(label);

    board.appendChild(chip);
    players[id] = chip;
    if (positions[id] == null) positions[id] = 0;
    movePlayer(id, positions[id]);
    refreshCurrentPlayerChip();
    renderPlayersList();
}

function refreshChipLabel(id) {
    const chip = players[id];
    if (!chip) return;
    const label = chip.querySelector("div");
    if (!label) return;
    label.textContent = shortName(id);
}

function movePlayer(id, pos) {
    const cell = boardCells[pos];
    const chip = players[id];
    if (!cell || !chip || !board) return;

    const cellRect = cell.getBoundingClientRect();
    const boardRect = board.getBoundingClientRect();

    const centerX = cellRect.left - boardRect.left + cellRect.width / 2;
    const centerY = cellRect.top - boardRect.top + cellRect.height / 2;

    chip.style.left = (centerX - 10) + "px";
    chip.style.top = (centerY - 10) + "px";
}

function refreshCurrentPlayerChip() {
    Object.entries(players).forEach(([id, chip]) => {
        if (id === currentTurnId) chip.classList.add("current-turn");
        else chip.classList.remove("current-turn");
    });
}

/* ---------- Лист игроков ---------- */

function renderPlayersList() {
    if (!playersList) return;

    const ids = new Set([
        ...Object.keys(players),
        ...Object.keys(money),
        ...Object.keys(nicknames)
    ]);

    playersList.innerHTML = "";
    ids.forEach(id => {
        const row = document.createElement("div");
        row.className = "player-row";

        const dot = document.createElement("span");
        dot.className = "player-dot";
        dot.style.backgroundColor = colorFromId(id);

        const nameSpan = document.createElement("span");
        nameSpan.textContent = displayName(id);

        const moneySpan = document.createElement("span");
        const val = money[id];
        if (typeof val === "number") {
            moneySpan.textContent = " — " + val;
        }

        row.appendChild(dot);
        row.appendChild(nameSpan);
        row.appendChild(moneySpan);
        playersList.appendChild(row);
    });
}

/* ---------- Игровые действия ---------- */

function rollDice() {
    if (!roomId) {
        alert("Сначала войдите в комнату");
        return;
    }
    if (!myId || currentTurnId !== myId || iAmBankrupt) {
        alert("Сейчас не ваш ход");
        return;
    }

    const d1 = 1 + Math.floor(Math.random() * 6);
    const d2 = 1 + Math.floor(Math.random() * 6);
    const sum = d1 + d2;
    const oldPos = positions[myId] || 0;
    const newPos = (oldPos + sum) % 40;

    log("Вы бросили кубики: " + d1 + " и " + d2 + " (сумма " + sum + ")");
    socket.emit("move", {
        roomId,
        playerId: myId,
        position: newPos
    });
}

function confirmBuy() {
    if (!roomId || buyCellIndex === null) {
        hideBuyModal();
        return;
    }
    if (currentTurnId !== myId) {
        hideBuyModal();
        return;
    }
    socket.emit("buyCell", {
        roomId,
        playerId: myId,
        cellIndex: buyCellIndex
    });
    hideBuyModal();
}

function confirmSkip() {
    if (!roomId) {
        hideBuyModal();
        return;
    }
    if (currentTurnId !== myId) {
        hideBuyModal();
        return;
    }
    socket.emit("skipBuy", {
        roomId,
        playerId: myId
    });
    hideBuyModal();
}

/* ---------- Лобби ---------- */

function createRoom() {
    const nicknameInput = document.getElementById("nickname");
    const roomIdInput = document.getElementById("roomId");
    const nickname = nicknameInput.value.trim();
    const rid = roomIdInput.value.trim();

    if (!nickname) {
        alert("Введите ник");
        return;
    }
    if (!rid) {
        alert("Введите ID комнаты");
        return;
    }

    profile.nickname = nickname;
    saveProfile();
    refreshProfileUI();

    roomId = rid;
    iAmBankrupt = false;

    socket.emit("createRoom", { roomId: rid, nickname });
    log("Создание комнаты " + rid + "...");
    showScreen("game");
}

function joinRoom() {
    const nicknameInput = document.getElementById("nickname");
    const roomIdInput = document.getElementById("roomId");
    const nickname = nicknameInput.value.trim();
    const rid = roomIdInput.value.trim();

    if (!nickname) {
        alert("Введите ник");
        return;
    }
    if (!rid) {
        alert("Введите ID комнаты");
        return;
    }

    profile.nickname = nickname;
    saveProfile();
    refreshProfileUI();

    roomId = rid;
    iAmBankrupt = false;

    socket.emit("joinRoom", { roomId: rid, nickname });
    log("Вход в комнату " + rid + "...");
    showScreen("game");
}

function refreshRooms() {
    socket.emit("listRooms");
}

/* ---------- Сокеты ---------- */

socket.on("connect", () => {
    myId = socket.id;
    log("Ваш ID: " + myId);
});

socket.on("errorMessage", ({ message }) => {
    alert(message || "Ошибка");
});

socket.on("roomsList", (rooms) => {
    if (roomsList) {
        roomsList.innerHTML = "";
        rooms.forEach(r => {
            const div = document.createElement("div");
            div.className = "room-row";
            div.textContent = `${r.roomId} — игроков: ${r.players}`;
            roomsList.appendChild(div);
        });
    }
    if (roomsListSide) {
        roomsListSide.innerHTML = "";
        rooms.forEach(r => {
            const div = document.createElement("div");
            div.className = "room-row";
            div.textContent = `${r.roomId} — игроков: ${r.players}`;
            roomsListSide.appendChild(div);
        });
    }
});

socket.on("roomCreated", ({ roomId: rid }) => {
    log("Комната " + rid + " создана.");
});

socket.on("playerInfo", ({ playerId, nickname }) => {
    nicknames[playerId] = nickname || shortName(playerId);
    if (playerId === myId) {
        profile.nickname = nickname || profile.nickname || "";
        saveProfile();
        refreshProfileUI();
    }
    createPlayerChip(playerId);
    refreshChipLabel(playerId);
    renderPlayersList();
});

socket.on("moneyInit", ({ playerId, money: m }) => {
    money[playerId] = m;
    updateMoneyInfo();
    renderPlayersList();
});

socket.on("playerJoined", ({ playerId, nickname }) => {
    nicknames[playerId] = nickname || shortName(playerId);
    log("Игрок подключился: " + displayName(playerId));
    createPlayerChip(playerId);
});

socket.on("playerMove", ({ playerId, position }) => {
    positions[playerId] = position;
    if (!players[playerId]) createPlayerChip(playerId);
    movePlayer(playerId, position);
    highlightCurrentCell();
    refreshCurrentPlayerChip();
});

socket.on("moneyUpdated", ({ playerId, money: newMoney }) => {
    money[playerId] = newMoney;
    if (playerId === myId) updateMoneyInfo();
    renderPlayersList();
});

socket.on("turnChanged", ({ playerId }) => {
    currentTurnId = playerId;
    setTurnInfo();
    highlightCurrentCell();
    refreshCurrentPlayerChip();
});

socket.on("startPassed", ({ playerId, nickname, bonus, money: newMoney }) => {
    if (nickname) nicknames[playerId] = nickname;
    money[playerId] = newMoney;
    log("Игрок " + displayName(playerId) + " проходит старт и получает " + bonus);
    if (playerId === myId) updateMoneyInfo();
    renderPlayersList();
});

socket.on("eventCard", ({ playerId, cellIndex, cardId, description, delta, money: newMoney }) => {
    money[playerId] = newMoney;
    const sign = delta > 0 ? "+" : "";
    log("Событие для " + displayName(playerId) + ": " + description + " (" + sign + delta + ")");
    if (playerId === myId) {
        updateMoneyInfo();
        showEventModal(description, sign + delta);
    }
    renderPlayersList();
});

socket.on("canBuyHere", ({ playerId, cellIndex }) => {
    const theme = themes[currentTheme] || themes.classic;
    const name = theme.cellNames[cellIndex] || ("Клетка " + cellIndex);

    if (playerId === myId) {
        canBuyNow = true;
        buyCellIndex = cellIndex;
        showBuyModal("Вы попали на \"" + name + "\". Купить эту собственность?");
    } else {
        log("Игрок " + displayName(playerId) + " может купить \"" + name + "\".");
    }
});

socket.on("cellBought", ({ playerId, nickname, cellIndex, money: newMoney }) => {
    if (nickname) {
        nicknames[playerId] = nickname;
        refreshChipLabel(playerId);
    }
    money[playerId] = newMoney;
    if (playerId === myId) updateMoneyInfo();

    log("Игрок " + displayName(playerId) + " покупает клетку #" + cellIndex);

    const cell = boardCells[cellIndex];
    if (cell) {
        const color = colorFromId(playerId);
        cell.dataset.ownerId = playerId;
        cell.classList.add("cell-owned");
        cell.style.setProperty("--owner-color", color);

        let tag = cell.querySelector(".cell-owner-tag");
        if (!tag) {
            tag = document.createElement("div");
            tag.className = "cell-owner-tag";
            cell.appendChild(tag);
        }
        tag.textContent = shortName(playerId);
    }
    renderPlayersList();
});

socket.on("rentPaid", (data) => {
    const { from, to, amount, moneyFrom, moneyTo } = data;
    log("Игрок " + displayName(from) + " платит аренду " + amount + " игроку " + displayName(to));
    money[from] = moneyFrom;
    money[to] = moneyTo;
    updateMoneyInfo();
    renderPlayersList();
});

socket.on("purchaseFailed", ({ reason }) => {
    if (reason === "no_money") {
        log("Покупка не состоялась: недостаточно денег.");
        if (myId && currentTurnId === myId) {
            alert("Недостаточно денег для покупки этой клетки.");
        }
    } else if (reason === "not_buyable") {
        log("Покупка не состоялась: клетка не покупаемая.");
    } else {
        log("Покупка не состоялась.");
    }
});

socket.on("playerBankrupt", ({ playerId, nickname }) => {
    if (nickname) nicknames[playerId] = nickname;
    log("Игрок " + displayName(playerId) + " обанкротился!");
    if (playerId === myId) {
        iAmBankrupt = true;
        setTurnInfo();
        showBankruptModal("Ваш баланс ушёл в минус, вы выбываете из игры.");
    }
    renderPlayersList();
});

socket.on("cellReleased", ({ cellIndex }) => {
    const cell = boardCells[cellIndex];
    if (!cell) return;
    cell.classList.remove("cell-owned");
    cell.style.removeProperty("--owner-color");
    const tag = cell.querySelector(".cell-owner-tag");
    if (tag) tag.remove();

    const theme = themes[currentTheme] || themes.classic;
    const type = cell.dataset.type || "neutral";
    const colors = theme.colorsByType;
    const base = colors[type] || colors.neutral;
    const strip = cell.querySelector(".cell-strip");
    if (strip) strip.style.backgroundColor = base;
});

socket.on("gameOver", ({ winnerId, nickname }) => {
    const winnerName = nickname || displayName(winnerId);
    log("Игра окончена. Победил " + winnerName);
    showGameOverModal("Победил игрок " + winnerName);

    profile.gamesPlayed += 1;
    if (winnerId === myId) {
        profile.gamesWon += 1;
        profile.coins += 200;
    } else {
        profile.coins += 50;
    }
    saveProfile();
    refreshProfileUI();
    setTurnInfo();
});

/* ---------- Инициализация ---------- */

buildBoard();
loadProfile();
refreshProfileUI();
applyTheme(profile.selectedTheme || "classic");
showScreen("lobby");
setTurnInfo();
refreshRooms();