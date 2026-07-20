import { WebSocketServer, WebSocket } from "ws";


const PORT = process.env.PORT ? parseInt(process.env.PORT, 10) : 8080;

const wss = new WebSocketServer({ port: PORT });

// --- Types ---
interface Player {
  ws: WebSocket;
  nickname: string;
  choice?: "rock" | "paper" | "scissors";
}

interface Room {
  players: Player[];
  scores: [number, number];
}

// --- State ---
const rooms = new Map<string, Room>();

// Heartbeat — keeps connections alive
const HEARTBEAT_INTERVAL = 7000; // 10 seconds without message disconnects if using Eduroam. Ping every 7 to be safe.

setInterval(() => {
    wss.clients.forEach((client) => {
        if (client.readyState === WebSocket.OPEN) {
          client.send(JSON.stringify({ type: "ping" }));
          console.log("Ping sent");
        }
    });
}, HEARTBEAT_INTERVAL);

function generateRoomCode(): string {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let code = "";
  for (let i = 0; i < 4; i++) {
    code += chars[Math.floor(Math.random() * chars.length)];
  }
  return rooms.has(code) ? generateRoomCode() : code;
}

function send(ws: WebSocket, msg: object) {
  ws.send(JSON.stringify(msg));
}

//  a = your choice. b = opponent choice
function getOutcome(a: string, b: string): "win" | "lose" | "draw" {
  if (a === b) return "draw";
  if (
    (a === "rock" && b === "scissors") ||
    (a === "scissors" && b === "paper") ||
    (a === "paper" && b === "rock")
  )
    return "win";
  return "lose";
}

// --- Connection handler ---
wss.on("connection", (ws) => {
  console.log("Client connected");

  ws.on("message", (raw) => {
    const msg = JSON.parse(raw.toString());
    console.log("Received:", msg);

    if (msg.type === "create") {
      const code = generateRoomCode();
      rooms.set(code, {
        players: [{ ws, nickname: msg.nickname }],
        scores: [0, 0],
      });
      send(ws, { type: "created", roomCode: code });
    }

    else if (msg.type === "join") {
      const room = rooms.get(msg.roomCode);
      if (!room) {
        send(ws, { type: "error", message: "Room not found" });
        return;
      }
      if (room.players.length >= 2) {
        send(ws, { type: "error", message: "Room is full" });
        return;
      }
      room.players.push({ ws, nickname: msg.nickname });
      // Notify both players
      const [p0, p1] = room.players;
      send(p0.ws, { type: "playerJoined", opponentNickname: p1.nickname });
      send(p1.ws, { type: "playerJoined", opponentNickname: p0.nickname });
    }

    else if (msg.type === "cancel") {
      for (const [code, room] of rooms.entries()) {
        const index = room.players.findIndex((p) => p.ws === ws);
        if (index === -1) continue;
        // Notify the other player if they exist
        const other = room.players[1 - index];
        if (other) {
          send(other.ws, { type: "cancelled" });
        }
        rooms.delete(code);
        break;
      }
    }
    else if (msg.type === "leave") {
      for (const [code, room] of rooms.entries()) {
        const index = room.players.findIndex((p) => p.ws === ws);
        if (index === -1) continue;
        // Notify the other player
        const other = room.players[1 - index];
        if (other) {
          send(other.ws, { type: "opponentLeft" });
        }
        rooms.delete(code);
        break;
      }
    }

    else if (msg.type === "choice") {
      // Find which room this player is in
      for (const [code, room] of rooms.entries()) {
        const playerIndex = room.players.findIndex((p) => p.ws === ws);
        if (playerIndex === -1) continue;

        room.players[playerIndex].choice = msg.value;

        // Check if both players have chosen
        const [p0, p1] = room.players;
        if (p0.choice && p1.choice) {
          const outcome0 = getOutcome(p0.choice, p1.choice);
          const outcome1 = getOutcome(p1.choice, p0.choice);
          if (outcome0 === "win") room.scores[0]++;
          if (outcome1 === "win") room.scores[1]++;

          send(p0.ws, {
            type: "result",
            yourChoice: p0.choice,
            theirChoice: p1.choice,
            outcome: outcome0,
            score: { you: room.scores[0], them: room.scores[1] },
          });
          send(p1.ws, {
            type: "result",
            yourChoice: p1.choice,
            theirChoice: p0.choice,
            outcome: outcome1,
            score: { you: room.scores[1], them: room.scores[0] },
          });

          // Reset choices for next round
          p0.choice = undefined;
          p1.choice = undefined;
        }
        break;
      }
    }
  });

  ws.on("close", () => {
    console.log("Client disconnected");
    // Clean up empty rooms
    for (const [code, room] of rooms.entries()) {
      room.players = room.players.filter((p) => p.ws !== ws);
      if (room.players.length === 0) rooms.delete(code);
    }
  });
});

console.log(`WebSocket server running on ws://localhost:${PORT}`);