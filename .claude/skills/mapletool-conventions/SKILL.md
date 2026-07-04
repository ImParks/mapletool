---
name: mapletool-conventions
description: mapletool 프로젝트의 코드 컨벤션 스킬. 폴더 구조(src/app, src/lib), 서버/클라이언트 컴포넌트 분리 규칙, Supabase(@supabase/ssr) 클라이언트 사용 위치(client.ts/server.ts/middleware), 환경변수와 넥슨 키 저장 위치, 모바일 우선 Tailwind 반응형·커스텀 maple 컬러, next/image 호스트 설정, TypeScript strict, 경로 별칭 @/*, 한국어 UI, 빌드/린트 명령 등을 정리. 새 파일·페이지·컴포넌트·라우트를 추가하거나 프로젝트 구조/규칙을 따라야 할 때 사용한다.
---

# mapletool 프로젝트 컨벤션

mapletool은 넥슨 메이플스토리 OpenAPI로 캐릭터/스탯을 조회하고 일일/주간 퀘스트·주간 보스 완료 여부를 체크하는 보조 웹앱이다. **모바일·PC 모두 지원**. 새 코드를 추가할 때 아래 규칙을 따른다.

## 스택

- **Next.js 15.1.6 (App Router)** + **React 19** + **TypeScript strict**
- **Supabase** (`@supabase/ssr` ^0.5.2, `@supabase/supabase-js` ^2.45.4) — 인증 + DB
- **Tailwind CSS 3.4.17** (devDependency)
- 경로 별칭: **`@/*` → `./src/*`** (예: `import { getCharacterList } from "@/lib/maple"`)
- 명령: `npm run dev` / `npm run build`(타입체크 포함) / `npm run lint`(= `eslint .`, flat config `eslint.config.mjs` — next/core-web-vitals + next/typescript) / `npm run typecheck`(= `tsc --noEmit`). **테스트 프레임워크 미설정** — 없는 테스트를 실행하려 하지 말고, 검증은 lint/typecheck/build로 한다. 테스트가 필요하면 먼저 합의 후 추가.

## 폴더 구조

```
src/
  app/
    (auth)/            # 랜딩(/)·로그인·회원가입·비밀번호찾기 (라우트 그룹, 공통 중앙정렬 레이아웃)
    main/              # 메인 화면(월드/캐릭터/체크리스트) + 서버 액션들(actions.ts 등)
    admin/             # 관리자 페이지(role='admin' 게이트) + boss-preset-actions.ts
    api/characters/[ocid]/stats/route.ts  # 호버/보스편집용 스탯 지연 조회 Route Handler
    layout.tsx / globals.css / manifest.ts
  components/
    ui/                # Button·Input·Checkbox·Switch·Card·Badge·Dialog·IconButton·Logo
    checklist/         # ChecklistSection·ChecklistRow·DurationInput·BossEditDialog·category-styles
    settings/          # NexonKeyCard
    CenteredNotice.tsx # env미설정/키미등록 등 안내 화면 공용
  lib/
    maple.ts           # 넥슨 OpenAPI 클라이언트 — ⚠️ 서버 전용 (apiKey로 fetch)
    period.ts          # 초기화 주기 키 + KST 공용 헬퍼(kstParts/kstMidnight). 순수 모듈
    presets.ts         # daily/weekly 코드 프리셋(보스는 DB boss_presets). 순수 모듈
    checklist-data.ts  # 항목 병합/필터 순수 계산 (서버에서 사용)
    scheduler-state.ts # 넥슨 스케줄러 응답 정규화 (순수 모듈, 자동 동기화 기능용 토대)
    action-result.ts / async.ts / num.ts / cn.ts / stats-client.ts  # 공용 유틸
    supabase/
      client.ts        # 브라우저용 createClient ("use client")
      server.ts        # 서버용 createClient (async) + isSupabaseConfigured()
      middleware.ts    # updateSession (세션 쿠키 갱신 + /main·/admin 로그인 가드)
  middleware.ts        # updateSession 호출 + matcher
supabase/migrations/   # DB 스키마·RLS·RPC (supabase/README.md가 단일 진실)
```

도메인 로직(넥슨/주기/프리셋)은 `src/lib`에 둔다. 화면은 `src/app`(+`src/components`).

## 서버 / 클라이언트 컴포넌트 규칙

- **기본은 서버 컴포넌트.** 상호작용(클릭/입력/토글/상태)이 필요한 부분만 잘게 `"use client"`로 분리한다. 페이지 전체를 client로 만들지 않는다.
- **넥슨 API 호출과 사용자 API 키는 서버에서만.** `src/lib/maple.ts`는 서버 전용 모듈이다. 클라이언트 컴포넌트에서 **런타임 import 금지**(타입만 `import type` 허용). 데이터는 서버 컴포넌트/Route Handler/Server Action에서 패칭해 **직렬화 가능한 결과만** 클라이언트로 내려준다.
- `period.ts`·`presets.ts`는 순수 모듈이라 서버·클라이언트 양쪽에서 값까지 import 가능하다.
- `ocid`는 비밀이 아니다(목록/조회 응답에 그대로 포함). 클라이언트 전달·라우팅 key로 써도 된다. 노출 금지 대상은 **넥슨 API 키, Supabase service_role 키** 같은 비밀값이다.

## Supabase 사용 패턴 (이미 구축됨 — 새로 만들지 말고 재사용)

- **클라이언트 컴포넌트** → `import { createClient } from "@/lib/supabase/client"` (`createBrowserClient`, `"use client"`).
- **서버 컴포넌트 / Route Handler / Server Action** → `import { createClient } from "@/lib/supabase/server"`. **`createClient()`는 async이므로 반드시 `const supabase = await createClient();`** (await 누락 시 strict 에러).
- **세션 갱신**은 `src/middleware.ts` → `src/lib/supabase/middleware.ts`의 `updateSession`이 모든 요청에서 `auth.getUser()`로 처리. matcher는 `_next` 정적 파일·이미지를 제외. 인증 보호 라우트가 늘면 이 matcher/`updateSession`에서 리다이렉트를 추가한다.
- env 미설정 시 안내 화면 분기는 `server.ts`의 `isSupabaseConfigured()` 사용(`updateSession`도 env 없으면 그냥 통과).
- 현재는 **anon 키 + RLS**만 사용한다(`service_role` 미사용). 사용자별 데이터 격리는 RLS가 최종 방어선. 스키마/RLS 설계는 `supabase-architect` 에이전트 담당.

## 환경변수 / 비밀

- `.env`: `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY` (둘 다 클라이언트 노출 정상).
- **넥슨 API 키는 env가 아니다.** 각 사용자가 앱 설정에서 등록하며 **DB에 사용자별로 저장**하고 서버에서만 읽는다. `NEXT_PUBLIC_`으로 두거나 하드코딩 금지. 응답/로그/에러에 키 원문이 섞이지 않게 한다.

## 스타일 / 반응형 (Tailwind)

- **모바일 우선.** 기본(base) 스타일 = 모바일, `sm:`/`md:`/`lg:`로 넓은 화면 확장. 데스크톱부터 짜고 모바일을 깎지 않는다.
- 터치 타깃 최소 44px(`h-11 w-11` 등), 체크리스트는 한 손 조작 고려, 색만으로 상태 구분 금지(아이콘/텍스트 병행).
- **커스텀 컬러**(`tailwind.config.ts`): `maple.orange`(#f5851f), `maple.dark`(#1a1c2b), `maple.card`(#23263a), `maple.border`(#33374f). 새 색을 임의로 늘리기보다 이 팔레트를 우선 사용. Tailwind `content`는 `./src/**/*.{js,ts,jsx,tsx,mdx}`.
- 캐릭터 이미지(`character_image`)는 `next/image`로 표시 가능 — `next.config.mjs`에 `open.api.nexon.com`, `**.nexon.com` 호스트가 이미 허용돼 있다. `alt` 필수.

## TypeScript / 코드 스타일

- **strict 모드.** `any`·무분별한 `as`·non-null `!` 지양. 넥슨 응답의 nullable 필드(`date: string | null`, `character_guild_name: string | null` 등)는 널 가드. `StatEntry.stat_value`는 **string**이므로 숫자 연산 전 변환.
- 외부 응답은 `maple.ts`처럼 `interface`로 타입화. `tsconfig`는 `noEmit`(빌드는 next가 담당).
- **한국어 UI/주석 유지.** 모든 사용자 노출 문구(라벨/버튼/에러)는 한국어. 코드 식별자·파일명은 영문.
- 임의 라이브러리 추가는 먼저 제안 후. 현재 런타임 deps는 next/react/react-dom/@supabase뿐(아이콘 라이브러리 등 없음).

## 관련 스킬 / 에이전트

- 스킬: `nexon-maple-api`(넥슨 OpenAPI 레퍼런스), `maple-reset-cycles`(초기화 주기·완료 모델).
- 에이전트: `maple-api-integrator`(넥슨 연동), `ui-builder`(화면), `supabase-architect`(DB/RLS/인증), `code-reviewer`(읽기 전용 검수).
