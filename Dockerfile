STREAMING_CHUNK:Configuring the base container image

FROM node:20-alpine

STREAMING_CHUNK:Setting up application directory

WORKDIR /app

STREAMING_CHUNK:Installing production dependencies

COPY package*.json ./
RUN npm install --omit=dev

STREAMING_CHUNK:Copying project source assets

COPY . .

STREAMING_CHUNK:Configuring non-root security permissions

RUN chown -R 1000:1000 /app
USER 1000

STREAMING_CHUNK:Exposing the service port

ENV PORT=3000
ENV NODE_ENV=production
EXPOSE 3000

STREAMING_CHUNK:Defining container runtime entrypoint

CMD ["node", "server.js"]