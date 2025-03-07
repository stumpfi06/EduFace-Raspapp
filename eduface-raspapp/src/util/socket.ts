import { io } from "socket.io-client";

const socket = io('http://172.20.10.5:4000', {
    transports: ['websocket']
});

export default socket;
