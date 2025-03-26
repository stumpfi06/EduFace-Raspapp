import express from "express";
import type { Response } from "express";
import cors from "cors";
import { Server as SocketIo, Socket } from "socket.io";
import http from "http";
import { neuerAnwesenheitsEintrag, anwesenheitAustragen } from "./util/firebase.queries";
import { collection, getDocs, updateDoc } from "firebase/firestore";
import { db } from "./util/firebase.config"; // Add this line
import cron from "node-cron"; // Add this line
import * as dotenv from 'dotenv'; // Import dotenv to load environment variables

dotenv.config(); // Load environment variables from .env file

const app = express();

const server = http.createServer(app);
const io = new SocketIo(server, {
    cors: {
        origin: "http://localhost:5173",
        methods: ["GET", "POST"]
    }
});

app.use(express.json());
app.use(cors());

const PORT = 8000;
const FACE_PORT = 5000;

// Speichert die aktuelle Socket-Verbindung
let currentSocket: Socket | null = null;

// Store socket connections by room and their associated IPs
let roomSockets: { [key: string]: { sockets: Socket[], ip: string } } = {}; // Mapping rooms to sockets and IPs

io.on('connection', (socket) => {
    const clientIp = socket.handshake.address as string;
    console.log(`Client connected from IP: ${clientIp}`);
    
    socket.on('roomId', (roomId: string) => {
        // Extract the IPv4 address from the full address
        const match = clientIp.match(/(\d+\.\d+\.\d+\.\d+)/); // This regex matches the IPv4 format
        const cleanIp = match ? match[0] : clientIp; // If no match, fall back to the original IP
        
        if (!roomSockets[roomId]) {
            roomSockets[roomId] = { sockets: [], ip: cleanIp };
        }
        roomSockets[roomId].sockets.push(socket);
        roomSockets[roomId].ip = cleanIp; // Set the room IP when a client joins
        console.log(`Client connected to room: ${roomId} from IP: ${cleanIp}`);
    });

    currentSocket = socket;

    socket.on('message', async (message) => {
        await handleMessage(socket, message);
    });

    socket.on('disconnect', () => {
        handleDisconnect(socket);
    });
});

const handleMessage = async (socket: Socket, message: string) => {
    console.log('Received:', message);
    if (message === 'kommen' || message === 'gehen') {
        await handleKommenOrGehen(socket, message);
    }
};

const handleKommenOrGehen = async (socket: Socket, message: string) => {
    console.log(message);
    const cancelToken: { cancelled: boolean, timeout: NodeJS.Timeout | null } = { cancelled: false, timeout: null };
    let useNfc = false;

    socket.once('message', (cancelMessage) => {
        handleCancelMessage(socket, cancelMessage, cancelToken, () => {
            console.log('Process cancelled');
        }, (nfcStatus) => {
            useNfc = nfcStatus;
        });
    });

    try {
        let response;
        const roomId = Array.from(socket.rooms).find((id) => id !== socket.id); // Get the room ID by excluding socket's own ID
        console.log('Room ID:', roomId); // Added log to check roomId
        if (!roomId) {
            console.error('No room ID found for the socket'); // Added error handling
        }
        const roomIp = roomId ? roomSockets[roomId]?.ip : 'localhost'; // Get the room's associated IP
        console.log(`Room IP for room ${roomId}: ${roomIp}`); // Added log to check roomIp

        if (useNfc) {
            response = await getNfc(roomIp);
            console.log("Used NFC");
            console.log(response);
        } else {
            response = await getFace(roomIp);
            console.log("Used face");
            console.log(response);
        }

        if (response && !cancelToken.cancelled) {
            console.log(message);
            await handleAttendance(socket, message, response);
        }
    } catch (error) {
        if (error instanceof Error && error.message === 'Process cancelled') {
            console.log('Process was cancelled');
        } else {
            console.error('Error adding timestamp:', error);
        }
    }
};

const handleCancelMessage = (socket: Socket, cancelMessage: string, cancelToken: { cancelled: boolean, timeout: NodeJS.Timeout | null }, reject?: (reason?: any) => void, setNfcStatus?: (status: boolean) => void) => {
    if (cancelMessage === 'abbrechen') {
        if (cancelToken.timeout) {
            clearTimeout(cancelToken.timeout);
        }
        cancelToken.cancelled = true;
        
        if (reject) {
            reject(new Error('Process cancelled'));
        }
    } else if (cancelMessage === 'nfc') {
        if (setNfcStatus) {
            setNfcStatus(true);
        }
        cancelToken.cancelled = false;
    }
};

const handleAttendance = async (socket: Socket, message: string, response: any) => {
    if (message === 'kommen') {
        console.log(message);
        await neuerAnwesenheitsEintrag(response);
        socket.emit('message', 'finished-Scanning');
    } else {
        await anwesenheitAustragen(response);
        socket.emit('message', 'finished-Scanning');
    }
};

const handleDisconnect = (socket: Socket) => {
    console.log('Client disconnected');
    if (currentSocket === socket) {
        currentSocket = null;
    }

    // Log which room this client was in when disconnected
    for (const roomId in roomSockets) {
        if (roomSockets[roomId].sockets.includes(socket)) {
            roomSockets[roomId].sockets = roomSockets[roomId].sockets.filter(s => s !== socket);
            console.log(`Client from IP: ${socket.handshake.address} disconnected from room: ${roomId}`);
        }
    }
};

const waitForMessage = (socket: Socket, expectedMessage: string): Promise<void> => {
    return new Promise((resolve, reject) => {
        if (!socket) {
            console.error("No active WebSocket connection.");
            return reject(new Error("No active WebSocket connection"));
        }

        socket.once('message', (message: string) => {
            console.log('Received:', message);
            if (message === expectedMessage) {
                resolve();
            } else {
                reject(new Error('Unexpected message received'));
            }
        });
    });
};

app.post("/upload", async (res: Response) => {
    io.emit('message', 'upload');

    try {
        await waitForMessage(currentSocket as Socket, 'upload');
        const sid = await addFace();
        if (!sid) {
            res.json({ status: "error", error: "Face not added" });
        } else {
            res.json({ status: "success", sid });
            io.emit('message', 'finished-upload');
        }
    } catch (error) {
        console.error('Error adding face:', error);
        res.json({ status: "error", error });
    }
});

server.listen(4000, () => {
    console.log('WebSocket Server läuft auf Port 4000');
});

app.listen(PORT, () => {
    console.log(`🚀 Server läuft auf http://172.20.10.5:${PORT}`);
});

const addFace = async () => {
    try {
        // Use the non-null assertion operator here
        const roomId = Array.from(currentSocket!.rooms).find((id) => id !== currentSocket!.id);
        const roomIp = roomId ? roomSockets[roomId]?.ip : 'localhost'; // Get the room's associated IP

        const response = await fetch(`http://${roomIp}:${FACE_PORT}/face/upload`, {
            method: 'GET',
            headers: {
                'Content-Type': 'application/json'
            },
        });

        if (!response.ok) {
            throw new Error('Network response was not ok');
        }
        const data = await response.json();

        return data.uid;
    } catch (error) {
        console.error('Error adding face:', error);
        return null;
    }
};

const getFace = async (roomIp: string) => {
    try {
        console.log("roomip", roomIp)
        const response = await fetch(`http://${roomIp}:${FACE_PORT}/face/query`, {
            method: 'GET',
            headers: {
                'Content-Type': 'application/json'
            },
        });

        if (!response.ok) {
            throw new Error('Network response was not ok');
        }
        const data = await response.json();

        return data.uid;
    } catch (error) {
        console.error('Error adding face:', error);
        return null;
    }
};

const getNfc = async (roomIp: string) => {
    try {
        const response = await fetch(`http://${roomIp}:${FACE_PORT}/nfc`, {
            method: 'GET',
            headers: {
                'Content-Type': 'application/json'
            },
        });

        if (!response.ok) {
            throw new Error('Network response was not ok');
        }
        const data = await response.json();

        return data.uid;
    } catch (error) {
        console.error('Error adding face:', error);
        return null;
    }
};

// Schedule a task to run at 16:05 every Monday to Friday
cron.schedule('5 16 * * 1-5', async () => {
    console.log('Running scheduled task at 16:05 Monday to Friday');
    const querySnapshot = await getDocs(collection(db, 'EduFace', 'Schulzentrum-ybbs', 'Anwesenheiten'));
    querySnapshot.forEach(async (doc) => {
        if (!doc.data().leftAt) {
            console.log("Updating document:", doc.id);
            await updateDoc(doc.ref, {
                leftAt: new Date(),
            });
        }
    });
});
