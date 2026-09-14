# SafeStreets Mumbai - Cloud Production Dockerfile
FROM node:24-alpine

WORKDIR /app

# Copy dependency manifests
COPY package*.json ./

# Install production dependencies
RUN npm install --omit=dev

# Copy application files
COPY . .

# Expose port (Cloud Run, Render, Railway assign PORT dynamically)
ENV PORT=8080
ENV HOST=0.0.0.0
EXPOSE 8080

# Start cloud server
CMD ["node", "server/server.js"]
