import { db } from "./firebase.config";
import { collection, addDoc, updateDoc, getDocs, query, where } from "firebase/firestore";

const timetable = {
1 : { start: '07:35', end: '08:15' },
2: { start: '08:15', end: '08:55' },
3: { start: '09:10', end: '09:50' },
4: { start: '09:50', end: '10:30' },
5: { start: '10:35', end: '11:15' },
6: { start: '11:15', end: '11:55' },
7: { start: '11:55', end: '12:45' },    
8: { start: '12:45', end: '13:35' },
9: { start: '13:35', end: '14:25' },
10: { start: '14:25', end: '15:15' },
11: { start: '15:15', end: '16:05' }
};

const neuerAnwesenheitsEintrag = async (sid: string) => {
    console.log("AnwesenheitsEintrag:", sid);

    if (!sid || typeof sid !== "string") {
        console.error("Invalid sid:", sid);
        return;
    }

    const data = {
        sid,
        arrivedAt: new Date(),  
    };

    console.log("Attempting to write:", JSON.stringify(data));

    try {
        const docRef = await addDoc(collection(db, 'EduFace', 'Schulzentrum-ybbs', 'Anwesenheiten'), data);
        console.log("Document written with ID:", docRef.id);   
    } catch (error) {
        console.error("Error writing document:", error);
    }
};

const anwesenheitAustragen = async (sid:string) => {
    console.log("Anwesenheit austragen:", sid);

    if (!sid || typeof sid !== "string") {
        console.error("Invalid sid:", sid);
        return;
    }

    const querySnapshot = await getDocs(collection(db, 'EduFace', 'Schulzentrum-ybbs', 'Anwesenheiten'));
    querySnapshot.forEach((doc) => {
        if (doc.data().sid === sid && !doc.data().leftAt) {
            console.log("Updating document:", doc.id);
            updateDoc(doc.ref, {
                leftAt: new Date(),  
            });
        }
    });
};

const AbwesenheitErstellen = async (sid:string) => {
    // Query Stundenplan for documents where kid equals sid
    const stundenplanQuery = query(
         collection(db, 'EduFace', 'Schulzentrum-ybbs', 'Stundenplan'),
         where('kid', '==', sid)
    );
    const snapshot = await getDocs(stundenplanQuery);
    if (snapshot.empty) {
        console.log("No Stundenplan found for kid:", sid);
        return;
    }
    snapshot.forEach(doc => {
         console.log("Stundenplan found:", doc.id, doc.data());
    });
    // ...further processing as needed...
};

export { neuerAnwesenheitsEintrag, anwesenheitAustragen };