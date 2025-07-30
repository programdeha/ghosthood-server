// multiplayer_game_server.js

const { Server } = require("socket.io");
const http = require("http");

const server = http.createServer((req, res) => {
  if (req.url === "/") {
    res.writeHead(200, {"Content-Type": "text/plain"});
    res.end("Server is running");
  } else {
    res.writeHead(404);
    res.end();
  }
});

const io = new Server(server, {
  cors: {
    origin: "*", // Flutter client için CORS açıyoruz
  },
});

let waitingPlayer = null;
let ongoingGames = {}; // gameId: { players, scores, startTime }

  
 io.on("connection", (socket) => {
  console.log("Yeni bağlantı:", socket.id);

  socket.on("join_game", ({ userId, username }) => {
    socket.data.userId = userId;
    socket.data.username = username;

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
          }
        },
        duration: 60,
      });

      setTimeout(() => {
        const scores = ongoingGames[gameId]?.scores || {};
        const result = determineWinner(scores);
        io.to(gameId).emit("game_over", result);
        delete ongoingGames[gameId];
      }, 60000);

      waitingPlayer = null;
    } else {
      waitingPlayer = socket;
      socket.emit("waiting_for_opponent");
    }
  });

  socket.on("send_ghost", ({ gameId, ghostType }) => {
    socket.to(gameId).emit("enemy_ghost", {
      ghostType,
      from: socket.id,
    });
  });

  socket.on("ghost_killed", ({ gameId, by }) => {
    if (ongoingGames[gameId]) {
      ongoingGames[gameId].scores[by]++;
      io.to(gameId).emit("score_update", ongoingGames[gameId].scores);
    }
  });

  socket.on("disconnect", () => {
    console.log("Oyuncu ayrıldı:", socket.id);
    if (waitingPlayer && waitingPlayer.id === socket.id) {
      waitingPlayer = null;
    }

    for (const gameId in ongoingGames) {
      const game = ongoingGames[gameId];
      if (game.players.find(p => p.id === socket.id)) {
        io.to(gameId).emit("opponent_disconnected");
        delete ongoingGames[gameId];
        console.log(`Oyun ${gameId} oyuncu ayrıldığı için sonlandırıldı.`);
        break;
      }
    }
  });
});

function determineWinner(scores) {
  const [p1, p2] = Object.keys(scores);
  const s1 = scores[p1];
  const s2 = scores[p2];
  if (s1 > s2) return { winner: p1, scores };
  if (s2 > s1) return { winner: p2, scores };
  return { winner: null, scores }; // Beraberlik
}

server.listen(process.env.PORT || 3000, () => {
  console.log(`Sunucu ${process.env.PORT || 3000} portunda çalışıyor`);
});
