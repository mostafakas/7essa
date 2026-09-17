# يُبنى من جذر المستودع: docker build -f apps/api/Dockerfile .
FROM node:22-alpine AS deps
RUN apk add --no-cache openssl
WORKDIR /repo
COPY package.json package-lock.json* ./
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
RUN if [ -f package-lock.json ]; then npm ci --workspace apps/api; else npm install --workspace apps/api; fi

FROM deps AS build
COPY apps/api apps/api
WORKDIR /repo/apps/api
RUN DATABASE_URL=postgresql://x:x@localhost/x MIGRATION_DATABASE_URL=postgresql://x:x@localhost/x npx prisma generate \
 && npm run build

FROM node:22-alpine AS runtime
RUN apk add --no-cache openssl
ENV NODE_ENV=production
WORKDIR /repo
COPY --from=build /repo/node_modules ./node_modules
COPY --from=build /repo/apps/api/dist ./apps/api/dist
COPY --from=build /repo/apps/api/prisma ./apps/api/prisma
COPY --from=build /repo/apps/api/package.json ./apps/api/package.json
WORKDIR /repo/apps/api
USER node
EXPOSE 4000
CMD ["sh", "-c", "npx prisma migrate deploy && node dist/main.js"]
