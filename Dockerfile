FROM node:24.22.1-bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends ffmpeg ca-certificates \
  && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY . .
RUN npm ci
CMD ["npx", "tsx", "mcp/src/mcp-http.ts"]
