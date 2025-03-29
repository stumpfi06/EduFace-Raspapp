import { db } from "./firebase.config";
import { firestore } from "firebase-admin";

const timestampToMinutes = (timestamp: firestore.Timestamp): number => {
    const date = timestamp.toDate();
    return date.getHours() * 60 + date.getMinutes();
};

const minutesToTimestamp = (minutes: number, date: Date = new Date()): firestore.Timestamp => {
    const newDate = new Date(date);
    newDate.setHours(Math.floor(minutes / 60));
    newDate.setMinutes(minutes % 60);
    newDate.setSeconds(0);
    newDate.setMilliseconds(0);
    return firestore.Timestamp.fromDate(newDate);
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
    const dayNames = ["Sonntag", "Montag", "Dienstag", "Mittwoch", "Donnerstag", "Freitag", "Samstag"];
    const currentDayName = dayNames[today];
    const lessonCount = (today >= 1 && today <= 5 && classTimetable && classTimetable[currentDayName]) ? Object.keys(classTimetable[currentDayName]).length : 0;

    if (!lessonCount) return -1;

    const schoolSnap = await db.collection("EduFace").doc(schoolId).get();
    const zeiten = schoolSnap.data()?.Zeiten || [];
    return zeiten[lessonCount - 1]?.Ende || -1;
}

async function getFirstLessonStartTime(schoolId: string): Promise<number> {
    const schoolSnap = await db.collection("EduFace").doc(schoolId).get();
    const zeiten = schoolSnap.data()?.Zeiten || [];
    return zeiten[0]?.Start || 455;
}

export async function handleAttendanceChange(
    schoolId: string,
    studentId: string,
    isExcused: boolean = false
) {
    const schoolRef = db.collection("EduFace").doc(schoolId);
    const absencesRef = schoolRef.collection("Abwesenheiten");
    const todayDate = new Date();
    const todayStartMidnight = new Date(todayDate.getFullYear(), todayDate.getMonth(), todayDate.getDate());

    // Schülerdaten abrufen
    const studentQuery = await schoolRef.collection("Schueler")
        .where("sid", "==", studentId)
        .limit(1)
        .get();

    if (studentQuery.empty) throw new Error("Student not found");
    const studentData = studentQuery.docs[0].data();
    const classId = studentData?.KID;
    if (!classId) throw new Error("Student has no assigned class");

    // Schulzeiten ermitteln
    const firstLessonStartMinutes = await getFirstLessonStartTime(schoolId);
    const lastLessonEndMinutes = await getLastLessonEndTime(schoolId, classId);
    if (lastLessonEndMinutes === -1) return;

    // Alle Anwesenheiten des Schülers heute abrufen
    const anwesenheitenSnapshot = await schoolRef.collection("Anwesenheiten")
        .where("sid", "==", studentId)
        .where("date", ">=", todayStartMidnight)
        .where("date", "<", new Date(todayStartMidnight.getTime() + 86400000))
        .get();

    // Anwesensheitsintervalle berechnen
    const presentIntervals = [];
    const nowMinutes = timestampToMinutes(firestore.Timestamp.fromDate(new Date()));

    for (const doc of anwesenheitenSnapshot.docs) {
        const data = doc.data();
        const arrivedAt = data.arrivedAt;
        const leftAt = data.leftAt;

        if (!arrivedAt) continue;

        const start = arrivedAt;
        let end = leftAt ? leftAt : lastLessonEndMinutes;
        end = Math.min(end, lastLessonEndMinutes);
        
        if (start < end) {
            presentIntervals.push({ start, end });
        }
    }

    // Intervalle sortieren und zusammenführen
    presentIntervals.sort((a, b) => a.start - b.start);
    const mergedIntervals = [];
    let current = presentIntervals[0];

    for (let i = 1; i < presentIntervals.length; i++) {
        const next = presentIntervals[i];
        if (next.start <= current.end) {
            current.end = Math.max(current.end, next.end);
        } else {
            mergedIntervals.push(current);
            current = next;
        }
    }
    if (current) mergedIntervals.push(current);

    // Abwesenheitslücken berechnen
    const absenceIntervals = [];
    let prevEnd = firstLessonStartMinutes;

    for (const interval of mergedIntervals) {
        if (interval.start > prevEnd) {
            absenceIntervals.push({
                start: prevEnd,
                end: interval.start
            });
        }
        prevEnd = Math.max(prevEnd, interval.end);
    }

    if (prevEnd < lastLessonEndMinutes) {
        absenceIntervals.push({
            start: prevEnd,
            end: lastLessonEndMinutes
        });
    }

    // Alte Abwesenheiten löschen
    const existingAbsences = await absencesRef
        .where("sid", "==", studentId)
        .where("date", ">=", todayStartMidnight)
        .where("date", "<", new Date(todayStartMidnight.getTime() + 86400000))
        .get();

    const batch = db.batch();
    existingAbsences.docs.forEach(doc => batch.delete(doc.ref));
    await batch.commit();

    // Neue Abwesenheiten erstellen
    for (const interval of absenceIntervals) {
        if (interval.start >= interval.end) continue;

        await absencesRef.add({
            sid: studentId,
            Start: interval.start,
            Ende: interval.end,
            date: todayDate,
            entschuldigt: isExcused,
            Grund: "",
            createdAt: firestore.FieldValue.serverTimestamp()
        });
    }
}
export async function checkDailyAbsences(schoolId: string) {
    const today = new Date();
    const dayOfWeek = today.getDay();

    if (dayOfWeek >= 1 && dayOfWeek <= 5) {
        const schoolRef = db.collection("EduFace").doc(schoolId);
        const studentsQuery = await schoolRef.collection("Schueler").get();
        const firstLessonStartMinutes = await getFirstLessonStartTime(schoolId);
        const todayStartMidnight = new Date(today.getFullYear(), today.getMonth(), today.getDate());
        const nowMinutes = today.getHours() * 60 + today.getMinutes();

       
        if (nowMinutes >= firstLessonStartMinutes && nowMinutes < firstLessonStartMinutes + 5) { 

            for (const studentDoc of studentsQuery.docs) {
                const studentId = studentDoc.data().sid;
                const classId = studentDoc.data().KID;

  
                const attendanceQuery = await schoolRef.collection("Abwesenheiten")
                    .where("sid", "==", studentId)
                    .where("date", ">=", todayStartMidnight)
                    .where("date", "<", new Date(todayStartMidnight.getTime() + 86400000))
                    .where("Start", "<", firstLessonStartMinutes + 1) 
                    .limit(1)
                    .get();

                if (attendanceQuery.empty) {

                    const lastLessonEndMinutes = await getLastLessonEndTime(schoolId, classId);
                    if (lastLessonEndMinutes !== -1) {
                        await handleAttendanceChange(
                            schoolId,
                            studentId,
                            false
                        );
                        console.log(`Ganztägige Abwesenheit für Schüler ${studentId} erstellt.`);
                    } else {
                        console.log(`Konnte Endzeit für Klasse ${classId} von Schüler ${studentId} nicht ermitteln.`);
                    }
                }
            }
        }
    }
}