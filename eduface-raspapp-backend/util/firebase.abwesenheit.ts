import { db } from "./firebase.config";
import { firestore } from "firebase-admin";

const timestampToMinutes = (timestamp: firestore.Timestamp): number => {
    const date = timestamp.toDate();
    return date.getHours() * 60 + date.getMinutes();
};

async function getLastLessonEndTime(schoolId: string, classId: string): Promise<number> {
    if (!classId) return -1;

    const classTimetableQuery = await db.collection("EduFace")
        .doc(schoolId)
        .collection("Stundenplan")
        .where("KID", "==", classId)
        .limit(1)
        .get();

    if (classTimetableQuery.empty) return -1;

    const classTimetable = classTimetableQuery.docs[0].data();
    const today = new Date().getDay();
    const dayNames = ["Montag", "Dienstag", "Mittwoch", "Donnerstag", "Freitag"];
    const lessonCount = today >= 1 && today <= 5 ? classTimetable[dayNames[today - 1]] : 0;

    if (!lessonCount) return -1;

    const schoolSnap = await db.collection("EduFace").doc(schoolId).get();
    const zeiten = schoolSnap.data()?.Zeiten || [];
    return zeiten[lessonCount - 1]?.Ende || -1;
}

export async function handleAttendanceChange(
    schoolId: string,
    attendanceId: string,
    studentId: string,
    arrivedAt: firestore.Timestamp | null,
    leftAt: firestore.Timestamp | null,
    isExcused: boolean = false
) {
    const schoolRef = db.collection("EduFace").doc(schoolId);
    const absencesRef = schoolRef.collection("Abwesenheiten");
    const todayDate = arrivedAt?.toDate() || leftAt?.toDate() || new Date();
    const todayStartMidnight = new Date(todayDate.getFullYear(), todayDate.getMonth(), todayDate.getDate());

    // Get student details
    const studentQuery = await schoolRef.collection("Schueler")
        .where("sid", "==", studentId)
        .limit(1)
        .get();

    if (studentQuery.empty) throw new Error("Student not found");
    const classId = studentQuery.docs[0].data()?.KID;
    if (!classId) throw new Error("Student has no assigned class");

    // Fetch lesson times
    const schoolSnap = await schoolRef.get();
    const zeiten = schoolSnap.data()?.Zeiten || [];
    const firstLessonStart = zeiten[0]?.Start || 455; // 7:35
    const lastLessonEnd = await getLastLessonEndTime(schoolId, classId);

    if (lastLessonEnd === -1) return;

    // Handle arrival
    if (arrivedAt && !leftAt) {
        const arrivalTime = timestampToMinutes(arrivedAt);

        // Check for existing departure to shorten
        const openDepartureQuery = await absencesRef
            .where("sid", "==", studentId)
            .where("date", ">=", todayStartMidnight)
            .where("date", "<", new Date(todayStartMidnight.getTime() + 86400000))
            .where("Ende", ">", arrivalTime)
            .orderBy("Start", "desc")
            .limit(1)
            .get();

        if (!openDepartureQuery.empty) {
            const departureDoc = openDepartureQuery.docs[0];
            const departureData = departureDoc.data();
            if (arrivalTime > departureData.Start) {
                await departureDoc.ref.update({ Ende: arrivalTime });
                console.log(`Updated early departure end to ${arrivalTime}`);
                return;
            }
        }

        // Create late arrival entry only if before first lesson
        if (arrivalTime > firstLessonStart) {
            await absencesRef.add({
                sid: studentId,
                Start: firstLessonStart,
                Ende: arrivalTime,
                date: todayDate,
                entschuldigt: isExcused,
                Grund: "",
                createdAt: firestore.FieldValue.serverTimestamp()
            });
        }
    }

    // Handle departure
    if (leftAt && !arrivedAt) {
        const leaveTime = timestampToMinutes(leftAt);

        // Check for existing arrival to extend
        const openArrivalQuery = await absencesRef
            .where("sid", "==", studentId)
            .where("date", ">=", todayStartMidnight)
            .where("date", "<", new Date(todayStartMidnight.getTime() + 86400000))
            .where("Start", "<", leaveTime)
            .orderBy("Ende", "desc")
            .limit(1)
            .get();

        if (!openArrivalQuery.empty) {
            const arrivalDoc = openArrivalQuery.docs[0];
            const arrivalData = arrivalDoc.data();
            if (leaveTime > arrivalData.Ende) {
                await arrivalDoc.ref.update({ Ende: leaveTime });
                console.log(`Updated late arrival end to ${leaveTime}`);
                return;
            }
        }

        // Create early departure entry only if relevant
        if (leaveTime < lastLessonEnd) {
            await absencesRef.add({
                sid: studentId,
                Start: leaveTime,
                Ende: lastLessonEnd,
                date: todayDate,
                entschuldigt: isExcused,
                Grund: "",
                createdAt: firestore.FieldValue.serverTimestamp()
            });
        }
    }
}