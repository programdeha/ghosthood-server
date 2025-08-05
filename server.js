const { Server } = require("socket.io");
const http = require("http");
const admin = require("firebase-admin");

const serviceAccount = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT);

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
});

const db = admin.firestore();

async function getUserDataFromFirebase(userId) {
  try {
    const doc = await db.collection("players").doc(userId).get();
    if (!doc.exists) {
      console.log("Kullanıcı Firestore'da bulunamadı:", userId);
      return null;
    }
    return doc.data();
  } catch (error) {
    console.error("Firebase'den veri çekilirken hata:", error);
    return null;
  }
}

const server = http.createServer((req, res) => {
  if (req.url === "/") {
    const message = "Server is running";
    res.writeHead(200, {
      "Content-Type": "text/plain",
      "Content-Length": Buffer.byteLength(message),
    });
    res.end(message);
  } else {
    res.writeHead(404);
    res.end("Not Found");
  }
});

const io = new Server(server, {
  cors: { origin: "*" },
});

let waitingPlayer = null;
let ongoingGames = {};

io.on("connection", (socket) => {
  console.log("Yeni bağlantı:", socket.id);

socket.on("join_game", async ({ userId }) => {
  const userData = await getUserDataFromFirebase(userId);
  if (!userData) {
    socket.emit("error", { message: "Kullanıcı bulunamadı" });
    return;
  }

  socket.data.userId = userId;
  socket.data.username = userData.username;

  // 🧹 Daha önce bekleyen oyuncu bu kullanıcıysa, temizle
  if (waitingPlayer?.data?.userId === userId) {
    console.log(`♻️ ${userId} daha önce waitingPlayer'dı, sıfırlandı.`);
    waitingPlayer = null;
  }

  // 🧹 Bu kullanıcı daha önce bir oyundaysa, o oyunu sil
  for (const gameId in ongoingGames) {
    const game = ongoingGames[gameId];
    if (game.players.find((p) => p.data.userId === userId)) {
      console.log(`♻️ ${userId} daha önce ${gameId} oyunundaydı, oyun sonlandırıldı.`);
      const otherPlayer = game.players.find((p) => p.data.userId !== userId);
      if (otherPlayer) {
        otherPlayer.emit("opponent_disconnected");
      }
      delete ongoingGames[gameId];
      break;
    }
  }

  if (waitingPlayer) {
    const gameId = `${waitingPlayer.id}-${socket.id}`;
    const player1 = waitingPlayer;
    const player2 = socket;

    ongoingGames[gameId] = {
      players: [player1, player2],
      scores: {
        [player1.data.userId]: 0,
        [player2.data.userId]: 0,
      },
      startTime: Date.now(),
    };

    player1.join(gameId);
    player2.join(gameId);

    // player1'e rakip bilgisi gönder
    player1.emit("game_start", {
      gameId,
      mySocketId: player1.id,
      opponentInfo: {
        [player2.id]: {
          userId: player2.data.userId,
          username: player2.data.username,
        },
      },
      duration: 60,
    });

    // player2'ye rakip bilgisi gönder
    player2.emit("game_start", {
      gameId,
      mySocketId: player2.id,
      opponentInfo: {
        [player1.id]: {
          userId: player1.data.userId,
          username: player1.data.username,
        },
      },
      duration: 60,
    });

    waitingPlayer = null;
  } else {
    waitingPlayer = socket;
    socket.emit("waiting_for_opponent");
  }
});

  /// JOİN GAME END
  
  socket.on("send_ghost", ({ gameId, ghostType, ghostId, position, lane }) => {
  socket.to(gameId).emit("enemy_ghost", {
    ghostType,
    ghostId,
    position,
    lane,
    from: socket.id,
  });
});

  socket.on("update_ghost_position", ({ gameId, ghostId, position }) => {
    socket.to(gameId).emit("enemy_ghost_position", {
      ghostId,
      position,
    });
  });

    socket.on("ghost_killed", ({ gameId, by }) => {
    const game = ongoingGames[gameId];
    if (game && game.scores[by] != null) {
      game.scores[by]++;
      io.to(gameId).emit("score_update", game.scores);
      console.log(`✅ ${by} için skor güncellendi: ${game.scores[by]}`);
    } else {
      console.warn(`❌ Geçersiz kullanıcı veya skor: gameId=${gameId}, by=${by}`);
    }
  });

  socket.on("disconnect", () => {
  console.log("Oyuncu ayrıldı:", socket.id);

  setTimeout(() => {
    // 1. Bekleme sırasındaysa ve ayrılan oyuncu bekleyen ise, temizle
    if (waitingPlayer && waitingPlayer.id === socket.id) {
      console.log("🟡 Bekleyen oyuncu ayrıldı.");
      waitingPlayer = null;
      return;
    }

    // 2. Eğer bekleyen biri varsa ve bu kişi AYRILMAYAN kişi ise, ona opponent_disconnected gönder
    if (waitingPlayer) {
      console.log("🔴 Rakip bekleyen oyuncudan ayrıldı, opponent_disconnected gönderiliyor");
      waitingPlayer.emit("opponent_disconnected");
      waitingPlayer = null;
      return;
    }

    // 3. Oyun sırasında ayrıldıysa
    for (const gameId in ongoingGames) {
      const game = ongoingGames[gameId];
      if (game.players.find((p) => p.id === socket.id)) {
        io.to(gameId).emit("opponent_disconnected");
        delete ongoingGames[gameId];
        console.log(`🚨 Oyun ${gameId} rakip ayrıldığı için sonlandırıldı.`);
        break;
      }
    }
  }, 1000);
});
  
});
server.listen(process.env.PORT || 3000, () => {
  console.log(`Sunucu ${process.env.PORT || 3000} portunda çalışıyor`);
});
