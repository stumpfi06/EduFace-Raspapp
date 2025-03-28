import express, { Response } from "express";
import cors from "cors";
import { Server as SocketIo, Socket } from "socket.io";
import http from "http";
import { neuerAnwesenheitsEintragAdmin, anwesenheitAustragenAdmin } from "./util/firebase.queries";
import admin from "firebase-admin";
import { db } from "./util/firebase.config";
import cron from "node-cron";
import * as dotenv from 'dotenv';
import readline from 'readline/promises';

dotenv.config();

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

let PORT: number;
let FACE_PORT: number;
let WEBSOCKET_PORT: number;
let SERVER_IP: string;
let FACE_SERVER_IP: string;

// Speichert die aktuelle Socket-Verbindung
let currentSocket: Socket | null = null;

// Store socket connections by room and their associated IPs
let roomSockets: { [key: string]: { sockets: Socket[], ip: string } } = {};

io.on('connection', (socket) => {
    const clientIp = socket.handshake.address as string;
    console.log(`Client connected from IP: ${clientIp}`);

    socket.on('roomId', (roomId: string) => {
        const match = clientIp.match(/(\d+\.\d+\.\d+\.\d+)/);
        const cleanIp = match ? match[0] : clientIp;

        if (!roomSockets[roomId]) {
            roomSockets[roomId] = { sockets: [], ip: cleanIp };
        }
        roomSockets[roomId].sockets.push(socket);
        roomSockets[roomId].ip = cleanIp;
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
        // Verwende socket.id als Fallback, falls keine andere Raum-ID gefunden wird.
        const roomId = Array.from(socket.rooms).find((id) => id !== socket.id) || socket.id;
        console.log('Room ID:', roomId);
        const roomIp = roomSockets[roomId]?.ip || 'localhost'; // Provide a default
        console.log(`Room IP for room ${roomId}: ${roomIp}`);

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
        } else if (cancelToken.cancelled) {
            socket.emit('message', 'cancelled');
        }
    } catch (error: any) { // Explicitly type error as any
        if (error instanceof Error && error.message === 'Process cancelled') {
            console.log('Process was cancelled');
        } else {
            console.error('Error adding timestamp:', error);
            socket.emit('message', `error:${error.message}`); // Send error to client
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
    try {
        if (message === 'kommen') {
            console.log(message);
            await neuerAnwesenheitsEintragAdmin(response);
            socket.emit('message', 'finished-Scanning');
        } else {
            await anwesenheitAustragenAdmin(response);
            socket.emit('message', 'finished-Scanning');
        }
    } catch (error: any) {
        console.error("Error in handleAttendance:", error);
        socket.emit('message', `error:${error.message}`);
    }
};

const handleDisconnect = (socket: Socket) => {
    console.log('Client disconnected');
    if (currentSocket === socket) {
        currentSocket = null;
    }

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
                reject(new Error(`Unexpected message received: ${message}`));
            }
        });
    });
};

app.post("/upload", async (req, res: Response) => { // Added req
    console.log("Handling /upload request...");
    io.emit('message', 'upload');
    console.log("Emitted 'upload' message to client.");

    try {
        console.log("Waiting for 'upload' message from client...");
        await waitForMessage(currentSocket as Socket, 'upload');
        console.log("'upload' message received from client.");

        const sid = await addFace();
        console.log("addFace() returned:", sid);

        if (!sid) {
            console.error("Face not added, sending error response.");
            res.status(500).json({ status: "error", error: "Face not added" }); // Send 500 for server error
        } else {
            console.log("Face added successfully, sending success response.");
            res.json({ status: "success", sid });
            io.emit('message', 'finished-upload');
            console.log("Emitted 'finished-upload' message to client.");
        }
    } catch (error: any) {
        console.error('Error adding face:', error);
        res.status(500).json({ status: "error", error: error.message || "An error occurred" }); // Send 500
    }
});

const addFace = async () => {
    if (!currentSocket) {
        throw new Error("No active socket connection");
    }
    try {
        const roomId = Array.from(currentSocket.rooms).find((id) => id !== currentSocket!.id);
        const roomIp = roomId ? roomSockets[roomId]?.ip : 'localhost';
        console.log(`Room IP for room ${roomId}: ${roomIp}`);
        console.log("Face PORT", FACE_PORT);
        const response = await fetch(`http://${roomIp}:${FACE_PORT}/face/upload`, {
            method: 'GET',
            headers: {
                'Content-Type': 'application/json'
            },
        });

        if (!response.ok) {
            const errorText = await response.text(); // Get the error message
            console.error(`Error from face server: ${response.status} - ${errorText}`);
            throw new Error(`Face server error: ${response.status} - ${errorText}`);
        }
        const data = await response.json();
        if (!data.uid)
            throw new Error(`Face server returned no uid: ${JSON.stringify(data)}`);
        return data.uid;
    } catch (error: any) {
        console.error('Error adding face:', error);
        throw error; // Re-throw the error to be caught in the /upload endpoint
    }
};

const getFace = async (roomIp: string) => {
    try {
        console.log("roomip", roomIp);
        const response = await fetch(`http://${roomIp}:${FACE_PORT}/face/query`, {
            method: 'GET',
            headers: {
                'Content-Type': 'application/json'
            },
        });

        if (!response.ok) {
            const errorText = await response.text();
            console.error(`Error from face server: ${response.status} - ${errorText}`);
            throw new Error(`Face server error: ${response.status} - ${errorText}`);
        }
        const data = await response.json();
        if (!data.uid)
            throw new Error(`Face server returned no uid: ${JSON.stringify(data)}`);
        return data.uid;
    } catch (error: any) {
        console.error('Error getting face:', error);
        throw error;
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
            const errorText = await response.text();
            console.error(`Error from NFC server: ${response.status} - ${errorText}`);
            throw new Error(`NFC server error: ${response.status} - ${errorText}`);
        }
        const data = await response.json();
        if (!data.uid)
            throw new Error(`NFC server returned no uid: ${JSON.stringify(data)}`);
        return data.uid;
    } catch (error: any) {
        console.error('Error getting NFC:', error);
        throw error;
    }
};

cron.schedule('5 16 * * 1-5', async () => {
    console.log('Running scheduled task at 16:05 Monday to Friday');
    try {
        const querySnapshot = await db
            .collection("EduFace")
            .doc("Schulzentrum-ybbs")
            .collection("Anwesenheiten")
            .get();

        querySnapshot.forEach(async (doc) => {
            if (!doc.data().leftAt) {
                console.log("Updating document:", doc.id);
                try {
                    await doc.ref.update({
                        leftAt: admin.firestore.Timestamp.fromDate(new Date()),
                    });
                } catch (updateError) {
                    console.error("Error updating document:", doc.id, updateError);
                    // Consider whether to continue processing other documents
                }
            }
        });
    } catch (error) {
        console.error("Error in cron job:", error);
    }
});

async function main() {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    const answer = await rl.question('Run in test mode? (yes/no): ');
    rl.close();

    if (answer.toLowerCase() === 'yes') {
        PORT = 8000;
        FACE_PORT = 8088;
        WEBSOCKET_PORT = 4000;
        SERVER_IP = 'localhost';
        FACE_SERVER_IP = 'localhost';

        server.listen(WEBSOCKET_PORT, () => {
            console.log(`WebSocket Server läuft im Testmodus auf Port ${WEBSOCKET_PORT}`);
        });

        app.listen(PORT, () => {
            console.log(`🚀 Test Server läuft auf http://${SERVER_IP}:${PORT}`);
        });
    } else {
        PORT = 8000;
        FACE_PORT = 5000;
        WEBSOCKET_PORT = 4000;
        SERVER_IP = '172.20.10.5'; // Your original IP
        FACE_SERVER_IP = 'localhost'; // Assuming your face server runs locally

        server.listen(WEBSOCKET_PORT, () => {
            console.log(`WebSocket Server läuft auf Port ${WEBSOCKET_PORT}`);
        });

        app.listen(PORT, () => {
            console.log(`🚀 Server läuft auf http://${SERVER_IP}:${PORT}`);
        });
    }
}

main();

