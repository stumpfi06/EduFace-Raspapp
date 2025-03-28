import admin from "firebase-admin";
import { db } from "./firebase.config"; // Ensure Firebase Admin SDK is initialized
import { handleAttendanceChange } from "./firebase.abwesenheit"; // Import the function

const neuerAnwesenheitsEintragAdmin = async (sid: string) => {
    console.log("Admin - AnwesenheitsEintrag:", sid);

    if (!sid || typeof sid !== "string") {
        console.error("Admin - Invalid sid:", sid);
        console.log(typeof sid);
        return;
    }

    const data = {
        sid,
        arrivedAt: admin.firestore.Timestamp.fromDate(new Date()),
        leftAt: null,
    };

    console.log("Admin - Attempting to write:", JSON.stringify(data));

    try {
        const docRef = await db
            .collection("EduFace")
            .doc("Schulzentrum-ybbs")
            .collection("Anwesenheiten")
            .add(data);

        console.log("Admin - Document written with ID:", docRef.id);

        // 🟢 Call absence handling function after attendance entry
        await handleAttendanceChange("Schulzentrum-ybbs", docRef.id, sid, data.arrivedAt, null);
    } catch (error) {
        console.error("Admin - Error writing document:", error);
    }
};

const anwesenheitAustragenAdmin = async (sid: string) => {
    console.log("Admin - Anwesenheit austragen:", sid);

    if (!sid || typeof sid !== "string") {
        console.error("Admin - Invalid sid:", sid);
        return;
    }

    const anwesenheitenRef = db
        .collection("EduFace")
        .doc("Schulzentrum-ybbs")
        .collection("Anwesenheiten");

    const querySnapshot = await anwesenheitenRef
        .where("sid", "==", sid)
        .where("leftAt", "==", null)
        .get();
    
    if (!querySnapshot.empty) {
        querySnapshot.forEach(async (doc) => {
            console.log("Admin - Updating document:", doc.id);

            const leftAt = admin.firestore.Timestamp.fromDate(new Date());

            await doc.ref.update({ leftAt });

            // 🟢 Call absence handling function after updating leftAt
            await handleAttendanceChange("Schulzentrum-ybbs", doc.id, sid, null, leftAt);
        });
    } else {
        console.log(`Admin - No active attendance record found for sid: ${sid}`);
    }
};

export { neuerAnwesenheitsEintragAdmin, anwesenheitAustragenAdmin };
