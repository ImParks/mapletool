# mapletool 프로덕션 이미지. next.config.mjs의 output:"standalone"을 이용해
# node_modules 전체를 담지 않는 최소 실행 이미지를 만든다.
#
# 빌드:
#   docker build \
#     --build-arg NEXT_PUBLIC_SUPABASE_URL=... \
#     --build-arg NEXT_PUBLIC_SUPABASE_ANON_KEY=... \
#     -t mapletool .
# 실행:
#   docker run -p 3000:3000 \
#     -e NEXT_PUBLIC_SUPABASE_URL=... \
#     -e NEXT_PUBLIC_SUPABASE_ANON_KEY=... \
#     mapletool
#
# NEXT_PUBLIC_* 값은 클라이언트 번들에 굽히므로 빌드 시점(build-arg)에도 필요하고,
# 런타임(-e)에도 동일 값을 넘겨 서버 코드가 참조할 수 있게 한다.

FROM node:20-alpine AS base

# ---- 의존성 설치 전용 스테이지 (레이어 캐시 극대화) ----
FROM base AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

# ---- 빌드 스테이지 ----
FROM base AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .

ARG NEXT_PUBLIC_SUPABASE_URL
ARG NEXT_PUBLIC_SUPABASE_ANON_KEY
ENV NEXT_PUBLIC_SUPABASE_URL=${NEXT_PUBLIC_SUPABASE_URL}
ENV NEXT_PUBLIC_SUPABASE_ANON_KEY=${NEXT_PUBLIC_SUPABASE_ANON_KEY}
ENV NEXT_TELEMETRY_DISABLED=1

RUN npm run build

# ---- 실행 스테이지 (최소 런타임만 포함) ----
FROM base AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1

RUN addgroup --system --gid 1001 nodejs \
  && adduser --system --uid 1001 nextjs

COPY --from=builder /app/public ./public
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static

USER nextjs

EXPOSE 3000
ENV PORT=3000
ENV HOSTNAME=0.0.0.0

CMD ["node", "server.js"]
