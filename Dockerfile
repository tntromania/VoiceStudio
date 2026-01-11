FROM node:18-slim

# Setăm directorul de lucru în container
WORKDIR /app/SmartTools/Apps/VoiceStudio

# Copiem package.json + package-lock.json și instalăm dependințele
COPY SmartTools/Apps/VoiceStudio/package*.json ./
RUN npm install

# Copiem tot restul aplicației
COPY SmartTools/Apps/VoiceStudio ./

# Expunem portul Node.js
EXPOSE 3000

# Pornim server.js
CMD ["node", "server.js"]
