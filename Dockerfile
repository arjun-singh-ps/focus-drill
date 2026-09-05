# Same 3-stage pattern as pm-ai-toolkit's Cloud Run deploy: deps -> builder -> runner.
#
# Unlike pm-ai-toolkit, no env vars are baked in at build time here. Every value
# this app reads (Supabase URL, Anthropic key, service-role key, password,
# session secret) is read server-side at REQUEST time, never inlined into the
# client bundle — so all five can be supplied purely as Cloud Run runtime env
# vars / secrets, and none of them need to touch this image or the build logs.

FROM node:20-alpine AS base

FROM base AS deps
RUN apk add --no-cache libc6-compat
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

FROM base AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npm run build

FROM base AS runner
WORKDIR /app
ENV NODE_ENV=production
RUN addgroup --system --gid 1001 nodejs && adduser --system --uid 1001 nextjs
# No `public/` directory: this app has no static assets (no images, no
# robots.txt) — everything is server-rendered or served by the API routes.
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static
USER nextjs
EXPOSE 8080
ENV PORT=8080
ENV HOSTNAME="0.0.0.0"
CMD ["node", "server.js"]
