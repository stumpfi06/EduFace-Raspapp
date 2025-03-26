import { io } from "socket.io-client";

// Establish WebSocket connection
const socket = io("http://172.20.10.5:4000", {
  transports: ["websocket"],
});

// Get the room id from the URL hash
const roomId = window.location.hash.substring(1); // removes the '#' from the hash (e.g., l01)

socket.on("connect", () => {
  // Send roomId to the backend for identification
  socket.emit("roomId", roomId);
  console.log(`Room ID ${roomId} sent to the backend`);
});

// Listen for messages from the backend
socket.on("message", (message) => {
  console.log("Message from backend:", message);
});
export default socket;