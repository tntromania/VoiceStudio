# Folosim o versiune light de Node
FROM node:18-alpine

# Setăm folderul de lucru
WORKDIR /app

# Copiem definițiile și instalăm dependințele
COPY package*.json ./
RUN npm install --production

# Copiem tot codul aplicației
COPY . .

# Expunem portul
EXPOSE 3000

# Pornim serverul
CMD ["node", "server.js"]