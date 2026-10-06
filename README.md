# EduFace-Raspapp

The EduFace Raspberry Pi application is the **classroom-side component of EduFace**.

It provides the user interface running on a classroom Raspberry Pi and communicates with a local backend to process student attendance using **facial recognition or NFC**.

This repository also contains the TypeScript backend responsible for communication between the Raspberry Pi application, the local face/NFC service and Firebase.

---

## Overview

The Raspberry Pi installation is designed to be used as an attendance terminal in a classroom.

A student starts an attendance action by selecting:

* **Kommen** – register arrival
* **Gehen** – register departure

The student can then be identified using:

1. Facial recognition
2. NFC as an alternative

The backend receives the resulting student ID and writes the attendance information to Firebase.

```text
                    Classroom
                       │
                       ▼
             ┌───────────────────┐
             │   Raspberry Pi    │
             │                   │
             │   Vue UI          │
             └─────────┬─────────┘
                       │
                  Socket.IO
                       │
                       ▼
             ┌───────────────────┐
             │ TypeScript        │
             │ Backend           │
             │                   │
             │ Express           │
             │ Socket.IO         │
             │ Firebase Admin    │
             │ Cron Jobs         │
             └──────┬─────┬──────┘
                    │     │
          ┌─────────┘     └──────────┐
          ▼                          ▼
 ┌──────────────────┐       ┌──────────────────┐
 │ Face / NFC       │       │ Firebase         │
 │ Service          │       │ Firestore        │
 │                  │       │                  │
 │ Face recognition │       │ Attendance       │
 │ NFC reader       │       │ Absences         │
 └──────────────────┘       └──────────────────┘
```

---

# Repository Structure

The repository contains two applications.

```text
EduFace-Raspapp/
│
├── eduface-raspapp/
│   │
│   ├── public/
│   │
│   ├── src/
│   │   ├── router/
│   │   │   └── index.ts
│   │   │
│   │   ├── util/
│   │   │   └── socket.ts
│   │   │
│   │   ├── views/
│   │   │   ├── FaceRecognitionView.vue
│   │   │   ├── NFCView.vue
│   │   │   ├── NewFaceView.vue
│   │   │   └── ScanningFaceView.vue
│   │   │
│   │   ├── App.vue
│   │   ├── main.ts
│   │   └── style.css
│   │
│   ├── package.json
│   ├── vite.config.ts
│   └── tsconfig.json
│
├── eduface-raspapp-backend/
│   │
│   ├── util/
│   │   ├── firebase.abwesenheit.ts
│   │   ├── firebase.config.ts
│   │   └── firebase.queries.ts
│   │
│   ├── server.ts
│   ├── test-server.ts
│   ├── package.json
│   └── tsconfig.json
│
└── README.md
```

---

# Raspberry Pi Application

The frontend is built with:

* Vue 3
* TypeScript
* Vite
* Vue Router
* Socket.IO Client
* Axios
* `simple-vue-camera`

## Available Views

### Attendance

```text
/
```

The main screen provides the two attendance actions:

```text
Kommen
Gehen
```

Selecting one of these starts the identification process.

---

### Facial Recognition

```text
/scanning-face
```

The scanning screen displays the camera stream received through a WebSocket connection.

The user can:

* Wait for facial recognition
* Switch to NFC
* Cancel the process

---

### NFC

```text
/nfc
```

The NFC screen allows the user to use the NFC reader instead of facial recognition.

The user can:

* Scan their NFC card
* Switch back to facial recognition
* Cancel the process

---

### Add New Face

```text
/upload
```

This screen is used when a new face needs to be added to the recognition database.

The user is instructed to:

1. Position themselves in front of the camera
2. Hold their EduCard against the NFC reader
3. Start the registration process

The backend then communicates with the local face-recognition service to create the new face entry.

---

# Socket.IO Communication

The Raspberry Pi frontend communicates with the backend using Socket.IO.

The frontend connects to:

```text
127.0.0.1:4000
```

The Raspberry Pi sends its room ID to the backend when the Socket.IO connection is established.

The room ID is taken from the URL hash.

For example:

```text
http://localhost:5173/#l01
```

results in:

```text
roomId = l01
```

The backend uses this information to associate the Raspberry Pi with a classroom.

---

## Main Socket Messages

The application currently uses messages such as:

| Message             | Purpose                                    |
| ------------------- | ------------------------------------------ |
| `kommen`            | Start arrival registration                 |
| `gehen`             | Start departure registration               |
| `nfc`               | Switch to NFC                              |
| `abbrechen`         | Cancel the current process                 |
| `upload`            | Start face registration                    |
| `scan-face`         | Start facial recognition                   |
| `finished-Scanning` | Identification/attendance process finished |
| `finished-upload`   | Face registration finished                 |

---

# Backend

The backend is a TypeScript application using:

* Node.js
* Express
* Socket.IO
* Firebase Admin SDK
* Firestore
* node-cron
* CORS
* dotenv

Its main responsibilities are:

* Managing Raspberry Pi Socket.IO connections
* Identifying classrooms by room ID
* Communicating with the local face/NFC service
* Processing attendance actions
* Writing attendance data to Firebase
* Calculating absences
* Running scheduled attendance tasks

---

# Backend Ports

The backend uses the following ports.

| Service                   |   Port |
| ------------------------- | -----: |
| Express API               | `8000` |
| Socket.IO                 | `4000` |
| Face/NFC service – test   | `8088` |
| Face/NFC service – normal | `5000` |
| Camera WebSocket          | `8765` |

The exact face-recognition and camera services are external to this repository.

---

# Backend API

## `POST /upload`

Starts the process of adding a new face.

The backend:

1. Tells the Raspberry Pi frontend to start the upload process.
2. Waits for the corresponding Socket.IO message.
3. Determines the Raspberry Pi's room/IP.
4. Calls the local face service.
5. Receives the generated student/face UID.
6. Returns the result to the caller.
7. Notifies the Raspberry Pi when the process has finished.

Example endpoint:

```text
POST http://localhost:8000/upload
```

---

# Face Recognition Service

The backend communicates with a local face-recognition service.

The service provides endpoints for:

```text
GET /face/query
GET /face/upload
GET /nfc
```

### `/face/query`

Used to identify a student using facial recognition.

The backend expects the response to contain a `uid`.

### `/face/upload`

Used when registering a new face.

The returned UID is used by EduFace to associate the face with a student.

### `/nfc`

Used to identify a student using an NFC card.

---

# Attendance Flow

The normal attendance process works approximately like this:

```text
Student
   │
   ▼
Press "Kommen" or "Gehen"
   │
   ▼
Raspberry Pi UI
   │
   │ Socket.IO
   ▼
Backend
   │
   ├───────────────┐
   │               │
   ▼               ▼
Face recognition  NFC
   │               │
   └───────┬───────┘
           ▼
       Student ID
           │
           ▼
        Firebase
           │
           ▼
   Attendance record
```

---

# Attendance Data

Attendance records are stored in:

```text
EduFace
└── Schulzentrum-ybbs
    └── Anwesenheiten
```

A typical attendance record contains:

```text
sid
arrivedAt
leftAt
```

When a student selects **Kommen**, a new attendance record is created.

When the student selects **Gehen**, the active attendance record for that student is updated with `leftAt`.

---

# Absence Calculation

The backend also contains logic for calculating absences.

The calculation uses:

* Student ID
* Student's class
* School timetable
* Arrival time
* Departure time
* First lesson start
* Last lesson end

The basic process is:

```text
School day
│
├── First lesson
│
├── Attendance intervals
│
├── Missing intervals
│
└── Last lesson
```

Attendance intervals are merged before calculating the gaps between them.

These gaps are then stored as absence records.

Absences are stored in:

```text
EduFace
└── Schulzentrum-ybbs
    └── Abwesenheiten
```

An absence contains information such as:

```text
sid
Start
Ende
date
entschuldigt
Grund
createdAt
```

---

# Scheduled Tasks

The backend uses `node-cron` for automated tasks.

### Daily absence check

A scheduled task runs on weekdays at:

```text
07:35
```

It checks students who do not have an attendance record at the beginning of the school day and generates the corresponding absence information.

### Closing open attendance records

Another scheduled task runs on weekdays at:

```text
16:05
```

It finds attendance records without a `leftAt` value and closes them using the current timestamp.

---

# Firebase

The backend uses the Firebase Admin SDK to access Firestore.

The main database structure is:

```text
EduFace
└── Schulzentrum-ybbs
    ├── Schueler
    ├── Klassen
    ├── Lehrer
    ├── Stundenplan
    ├── Anwesenheiten
    └── Abwesenheiten
```

Unlike the frontend application, the backend uses the **Firebase Admin SDK**, allowing it to access Firestore server-side.

---

# Firebase Service Account

The backend expects a Firebase service-account JSON file.

The current implementation loads it from:

```text
eduface-raspapp-backend/
└── eduface-cb182-firebase-adminsdk-zzez5-e6bb06ed6a.json
```

This file is **private and must never be committed to Git**.

For a new installation, provide the appropriate Firebase Admin service-account credentials and adjust the configuration if necessary.

---

# Installation

## Raspberry Pi Frontend

Navigate into the frontend:

```bash
cd eduface-raspapp
```

Install dependencies:

```bash
npm install
```

Start the development server:

```bash
npm run dev
```

---

## Backend

Open another terminal and navigate to:

```bash
cd eduface-raspapp-backend
```

Install dependencies:

```bash
npm install
```

The backend is written in TypeScript.

---

# Running the Backend

The backend asks whether it should run in test mode:

```text
Run in test mode? (yes/no):
```

### Test mode

Enter:

```text
yes
```

The backend uses:

```text
Express:   8000
Socket.IO: 4000
Face API:  8088
```

The face service is expected to run locally.

### Normal mode

Enter:

```text
no
```

The backend uses:

```text
Express:   8000
Socket.IO: 4000
Face API:  5000
```

The production configuration also contains the configured Raspberry Pi/server network address.

---

# Development

## Frontend

Run the frontend:

```bash
npm run dev
```

Build:

```bash
npm run build
```

Type-check:

```bash
npm run type-check
```

Lint:

```bash
npm run lint
```

Format:

```bash
npm run format
```

## Backend

The backend uses TypeScript and can be run using a TypeScript runtime such as `ts-node`.

For development, make sure:

1. Firebase credentials are available
2. The backend is running
3. The face/NFC service is running
4. The Raspberry Pi frontend is connected
5. The correct room ID is being used

---

# Classroom Setup

A classroom installation requires:

* Raspberry Pi
* Display
* Camera
* NFC reader
* Network connection
* EduFace Raspberry Pi frontend
* EduFace backend
* Local face/NFC service

The Raspberry Pi frontend communicates with the backend through Socket.IO.

The face/NFC service is responsible for interacting with the hardware and providing the identified student's UID.

---

# Room Identification

Each Raspberry Pi identifies itself using a room ID.

Example:

```text
#l01
```

The backend associates the room ID with the IP address of the connected Raspberry Pi.

This allows the backend to send requests to the correct classroom's face/NFC service.

---

# Related Repository

The central EduFace homepage and administration interface are maintained in the separate:

**EduFace-main**

repository.

That repository is responsible for:

* Public website
* Login
* Registration
* User management
* Student management
* Teacher management
* Class management
* Attendance administration
* Absence administration
* Firebase client-side access

---

# Project Context

EduFace was developed as a diploma project for creating a digital attendance management system for schools.

The Raspberry Pi component was designed to provide a simple classroom-based attendance workflow while reducing the need for manual attendance recording.

Students can identify themselves using either:

* Facial recognition
* NFC

The resulting attendance information is stored centrally in Firebase and can be managed through the EduFace web interface.

---

# Status

This project is a diploma project and represents the implementation developed for the project.

Before using the system in a real school environment, additional work would be required in areas such as:

* Security hardening
* Error handling
* Authentication between services
* Production deployment
* Hardware reliability
* Privacy and data protection
* Monitoring and logging
* Configuration management
* Automated testing
