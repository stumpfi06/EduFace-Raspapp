import admin from 'firebase-admin';
import { config } from "dotenv";
config();

// Initialize Firebase Admin SDK with service account credentials
const serviceAccount = require('../eduface-cb182-firebase-adminsdk-zzez5-e6bb06ed6a.json'); // Replace with the actual path to your service account key file

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
});

const db = admin.firestore();

export { db, admin };