const { Server } = require("socket.io");
const http = require("http");

// Firebase Admin SDK
const admin = require("firebase-admin");
const serviceAccount = require("./serviceAccountKey.json"); // Firebase servis hesabı dosyan

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
});

const db = admin.firestore();

async function getUserDataFromFirebase(userId) {
  try {
    const doc = await db.collection("players").doc(userId).get();
    if (!doc.exists) {
      console.log("User not found in Firestore:", userId);
      return null;
    }
    return doc.data();
  } catch (error) {
    console.error("Error fetching user data:", error);
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
      socket.emit("error", { message: "User not found" });
      return;
    }

    socket.data.userId = userId; // burada userId doğrudan parametre olarak alınıyor
    socket.data.username = userData.username;

    if (waitingPlayer) {
      const gameId = `${waitingPlayer.id}-${socket.id}`;
      const player1 = waitingPlayer;
      const player2 = socket;

      ongoingGames[gameId] = {
        players: [player1, player2],
        scores: {
          [player1.id]: 0,
          [player2.id]: 0,
        },
        startTime: Date.now(),
      };

      player1.join(gameId);
      player2.join(gameId);

      io.to(gameId).emit("game_start", {
        gameId,
        opponentInfo: {
          [player1.id]: {
            userId: player2.data.userId,
            username: player2.data.username,
          },
          [player2.id]: {
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

  // Rakip cihazlara ghost spawn bilgisini gönder
  socket.on("send_ghost", ({ gameId, ghostType, ghostId, position }) => {
    socket.to(gameId).emit("enemy_ghost", {
      ghostType,
      ghostId,
      position,
      from: socket.id,
    });
  });

  // Rakip cihazlara ghost pozisyon güncellemesini gönder
  socket.on("update_ghost_position", ({ gameId, ghostId, position }) => {
    socket.to(gameId).emit("enemy_ghost_position", {
      ghostId,
      position,
    });
  });

  // Ghost öldüğünde skor güncelle
  socket.on("ghost_killed", ({ gameId, by }) => {
    if (ongoingGames[gameId]) {
      ongoingGames[gameId].scores[by]++;
      io.to(gameId).emit("score_update", ongoingGames[gameId].scores);
    }
  });

  socket.on("disconnect", () => {
    console.log("Oyuncu ayrıldı:", socket.id);

    setTimeout(() => {
      if (waitingPlayer && waitingPlayer.id === socket.id) {
        waitingPlayer = null;
      }

      for (const gameId in ongoingGames) {
        const game = ongoingGames[gameId];
        if (game.players.find((p) => p.id === socket.id)) {
          io.to(gameId).emit("opponent_disconnected");
          delete ongoingGames[gameId];
          console.log(`Oyun ${gameId} oyuncu ayrıldığı için sonlandırıldı.`);
          break;
        }
      }
    }, 2000);
  });
});

server.listen(process.env.PORT || 3000, () => {
  console.log(`Sunucu ${process.env.PORT || 3000} portunda çalışıyor`);
});
