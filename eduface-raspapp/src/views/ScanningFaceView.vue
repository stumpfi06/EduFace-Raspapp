<template>
  <div class="scanning-face-view">
    <div class="camera-section">
      <img ref="videoStream" alt="Webcam Stream" class="border rounded-lg shadow-lg w-[640px] h-[480px]" />
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
import {  ref, onMounted } from "vue";
import socket from "../util/socket";
import { useRouter } from "vue-router";



const videoStream = ref<HTMLImageElement | null>(null);

onMounted(() => {
  const ws = new WebSocket("ws://localhost:8765"); // IP-Adresse ggf. anpassen
  ws.binaryType = "blob";

  ws.onmessage = (event) => {
    const blob = new Blob([event.data], { type: "image/jpeg" });
    const url = URL.createObjectURL(blob);
    if (videoStream.value) {
      videoStream.value.src = url;
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