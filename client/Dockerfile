# ---- build stage ----
FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY tsconfig.json tsconfig.build.json ./
COPY src ./src
COPY client ./client
RUN npm run build

# ---- runtime stage ----
FROM node:22-alpine AS runtime
ENV NODE_ENV=production
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force
# The client only borrows two tiny helpers from src/shared (Result and assertNever).
COPY --from=build /app/dist/client ./dist/client
COPY --from=build /app/dist/src/shared ./dist/src/shared
USER node
EXPOSE 8080
CMD ["node", "dist/client/index.js"]