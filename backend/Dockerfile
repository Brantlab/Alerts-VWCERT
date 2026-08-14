FROM node:20-alpine

WORKDIR /app
ENV NODE_ENV=production

COPY backend/package.json ./
COPY backend/src ./src
COPY calendar ./calendar

ENV CALENDAR_DIR=/app/calendar

RUN addgroup -S app && adduser -S app -G app \
  && mkdir -p /data /cache \
  && chown -R app:app /app /data /cache

USER app
EXPOSE 8080

CMD ["node", "src/server.js"]
