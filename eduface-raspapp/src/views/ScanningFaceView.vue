<template>
  <div class="scanning-face-view">
    <div class="camera-section">
      <img ref="videoStream" alt="Webcam Stream" class="camera" />
    </div>
    <div class="info-section">

        <div class="info-button-wrapper">
        <button class="btn-primary btn-scanning" @click="handleNFC">NFC einlesen</button>
        <button class="btn-primary btn-scanning" @click="handleAbbrechen">Abbrechen</button>
        </div>
    </div>
  </div>
</template>
<script setup lang="ts">
import { onMounted, ref } from "vue";
import socket from "../util/socket";
import { useRouter } from "vue-router";



const videoStream = ref<HTMLImageElement | null>(null);

onMounted(() => {
  const ws = new WebSocket("ws://localhost:8765");

  ws.onmessage = (event) => {
    if (videoStream.value) {
      videoStream.value.src = `data:image/jpeg;base64,${event.data}`;
    }
  };
});

    


    const router = useRouter();

    socket.on("message", (data) => {
      if(data === "upload"){
        router.push('/upload');
      }
      else if(data === "finished-Scanning"){
        router.push('/');
      }
    });
    const handleAbbrechen = () => {
    socket.send("abbrechen");
      router.push('/');
    }
    const handleNFC = () => {
      socket.send("nfc");
      router.push('/nfc');
    }
</script>
<style scoped src="../style.css"></style>