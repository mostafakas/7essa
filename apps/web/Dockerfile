# يُبنى من جذر المستودع: docker build -f apps/web/Dockerfile .
FROM node:22-alpine AS deps
WORKDIR /repo
COPY package.json package-lock.json* ./
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
RUN if [ -f package-lock.json ]; then npm ci --workspace apps/web; else npm install --workspace apps/web; fi

FROM deps AS build
ARG API_INTERNAL_URL=http://api:4000
ENV API_INTERNAL_URL=$API_INTERNAL_URL NEXT_TELEMETRY_DISABLED=1
COPY apps/web apps/web
WORKDIR /repo/apps/web
RUN npm run build

FROM node:22-alpine AS runtime
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 PORT=3000 HOSTNAME=0.0.0.0
WORKDIR /app
COPY --from=build /repo/apps/web/.next/standalone ./
COPY --from=build /repo/apps/web/.next/static ./apps/web/.next/static
COPY --from=build /repo/apps/web/public ./apps/web/public
USER node
EXPOSE 3000
CMD ["node", "apps/web/server.js"]
