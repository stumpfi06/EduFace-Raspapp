import express from "express";
import type { Response } from "express";
import cors from "cors";
import { Server as SocketIo, Socket } from "socket.io";
import https from "https";
import { neuerAnwesenheitsEintrag, anwesenheitAustragen } from "./util/firebase.queries";
import { collection, getDocs, updateDoc } from "firebase/firestore";
import { db } from "./util/firebase.config"; // Add this line
import cron from "node-cron"; // Add this line

const app = express();

const server = https.createServer(app);
const io = new SocketIo(server, {
    cors: {
        origin: "http://localhost:5174",
        methods: ["GET", "POST"]
    }
});

app.use(express.json());
app.use(cors());

const PORT = 8000;

// Speichert die aktuelle Socket-Verbindung
let currentSocket: Socket | null = null;

const FACE_API_IP = '172.20.10.2';
const FACE_API_PORT = 5000;

io.on('connection', (socket) => {
    console.log('New client connected');
    currentSocket = socket; 

    socket.on('message', async (message) => {
        console.log('Received:', message);
        if (message === 'kommen' || message === 'gehen') {
            console.log(message);
            const cancelToken = { cancelled: false };
            let useNfc = false;

            socket.once('message', (cancelMessage) => {
                if (cancelMessage === 'abbrechen') {
                    cancelToken.cancelled = true;
                    socket.emit('message', 'process-cancelled');
                } else if (cancelMessage === 'nfc') {
                    useNfc = true;
                    cancelToken.cancelled = false;
                    socket.emit('message', 'switching-to-nfc');
                }
            });

            try {
                let response;
                if (useNfc) {
                    response = await getNfc();
                    console.log("used nfc");
                    console.log(response);
                } else {
                    response = await getFace();
                    console.log("used face");
                    console.log(response);
                }

                if (response) {
                    console.log(message);
                    if (!cancelToken.cancelled) {
                        if (message === 'kommen') {
                            console.log(message);
                            await neuerAnwesenheitsEintrag(response);
                            socket.emit('message', 'finished-Scanning');
                        } else {
                            await anwesenheitAustragen(response);
                            socket.emit('message', 'finished-Scanning');
                        }
                    }
                }
            } catch (error) {
                if (error === 'Process cancelled') {
                    console.log('Process was cancelled');
                } else {
                    console.error('Error adding timestamp:', error);
                }
            }  
        }
    });

    socket.on('disconnect', () => {
        console.log('Client disconnected');
        if (currentSocket === socket) {
            currentSocket = null;
        }
    });
});

const waitForMessage = (expectedMessage: string): Promise<void> => {
    return new Promise((resolve, reject) => {
        if (!currentSocket) {
            console.error("No active WebSocket connection.");
            return reject(new Error("No active WebSocket connection"));
        }

        currentSocket.once('message', (message) => {
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
        await waitForMessage('upload');
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

server.listen(4000, "172.20.10.5", () => {
    console.log('WebSocket Server läuft auf Port 4000');
});

app.listen(PORT, () => {
    console.log(`🚀 Server läuft auf http://172.20.10.5:${PORT}`);
});

const addFace = async () => {
    try {
        const response = await fetch(`http://${FACE_API_IP}:${FACE_API_PORT}/face/upload`, {
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

const getFace = async () => {
    try {
        const response = await fetch(`http://${FACE_API_IP}:${FACE_API_PORT}/face/query`, {
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

const getNfc = async () => {
    try {
        const response = await fetch(`http://${FACE_API_IP}:${FACE_API_PORT}/nfc`, {
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