# mapletool 배포 가이드 (Vercel + Supabase)

Next.js 15 App Router 앱을 Vercel에, DB/인증은 Supabase 클라우드에 두는 구성.
`middleware.ts`(세션 갱신)와 server actions를 쓰므로 **정적 호스팅(GitHub Pages 등)은 불가**하다.

배포에 필요한 환경변수는 2개뿐이고 둘 다 공개용이다. 서버 전용 비밀키(`service_role`)는
이 프로젝트에서 사용하지 않는다 — 모든 접근은 anon 키 + RLS로 통제된다.

| 변수 | 값 | 성격 |
| --- | --- | --- |
| `NEXT_PUBLIC_SUPABASE_URL` | `https://<project>.supabase.co` | 공개 (브라우저 번들에 포함) |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | `sb_publishable_...` | 공개 (RLS가 방어선) |
| `NEXT_PUBLIC_SITE_URL` *(선택)* | `https://<배포도메인>` | 공개 · 메일 링크 주소 고정용 (2-2 참고) |

---

## 1. 원격 DB에 마이그레이션 적용

Vercel 배포보다 **먼저** 해야 한다. 안 하면 로그인부터 실패한다.

```bash
npx supabase login          # 브라우저 인증 (access token 발급)
npx supabase link --project-ref <project-ref>
npx supabase migration list --linked   # Local / Remote 열 비교
npx supabase db push                   # 미적용 마이그레이션 적용
```

`<project-ref>`는 Supabase 대시보드 URL의 `.../project/<여기>` 부분.
마이그레이션은 전부 멱등(`if not exists`, `or replace`, `on conflict do nothing`)이라
재적용해도 안전하다. 상세는 [`supabase/README.md`](supabase/README.md) 참고.

## 2. Supabase 대시보드 설정

### 2-1. 이메일 확인 끄기

**Authentication → Sign In / Providers → Email → "Confirm email" OFF**

켜져 있으면 `signUp()` 직후 세션이 없어서 `/main`으로 리다이렉트해도 middleware가
로그인 화면으로 되돌린다. 사용자 입장에선 아무 안내 없이 가입이 실패한 것처럼 보인다
(`src/app/(auth)/signup/actions.ts`의 주석 참고).

> 트레이드오프: 존재하지 않는 이메일로도 가입이 가능해진다. 그런 계정은 비밀번호
> 찾기를 쓸 수 없다. 추후 4번 항목 참고.

### 2-2. 리다이렉트 URL 등록

**Authentication → URL Configuration**

- **Site URL**: `https://<배포도메인>`
- **Redirect URLs**에 추가:
  - `https://<배포도메인>/**`
  - `https://*-<vercel-scope>.vercel.app/**` (프리뷰 배포에서도 테스트하려면)

비밀번호 재설정 메일의 링크가 이 허용목록을 거친다. 실제 링크가 향하는 곳은
**`<도메인>/auth/callback?next=/reset-password`** 이고, 위처럼 `/**` 와일드카드로 등록해
두면 이 경로도 함께 허용된다(개별 등록 불필요). 앱은 요청 `origin` 헤더로 URL을 만들므로
코드 수정은 필요 없다.

> **⚠️ 이 설정을 빠뜨리면 에러가 안 난다.** Supabase는 허용목록에 없는 `redirect_to`를
> 거부하면서 **조용히 Site URL로 폴백**한다. 그러면 메일 링크가 `<Site URL>/?code=...`로
> 떨어지고, 사용자 눈에는 "링크를 눌렀는데 재설정 화면이 아니라 그냥 첫 화면/로그인 화면이
> 뜬다"로 보인다. 로그에도 아무것도 안 남으니 원인 찾기가 어렵다.
>
> 그래서 앱 미들웨어에 안전망을 뒀다 — `/` 나 `/login`에 `code`/`token_hash`가 붙어 들어오면
> `/auth/callback`으로 돌려보낸다(`src/lib/supabase/middleware.ts`). 다만 이건 어디까지나
> 보험이고, **Site URL과 Redirect URLs는 반드시 제대로 등록해야 한다.**

Site URL을 실제 배포 도메인으로 바꾸는 것도 잊지 말 것. 기본값(`http://localhost:3000`)으로
두면 폴백이 일어날 때 사용자가 로컬 주소로 보내진다.

커스텀 도메인을 쓰거나 프록시 뒤에 있어 요청 헤더의 호스트가 실제 공개 주소와 다르면,
Vercel 환경변수에 `NEXT_PUBLIC_SITE_URL=https://<도메인>`(끝 슬래시 없이)을 추가해 고정할 수
있다. 비워두면 요청 `origin`을 쓰므로 프로덕션·프리뷰 모두 자동으로 맞는다.

> 재설정 링크는 **메일을 요청한 것과 같은 브라우저**에서 열어야 한다. PKCE 흐름이라
> code verifier 쿠키가 그 브라우저에만 있기 때문. 다른 기기/브라우저에서 열면
> `/reset-password`가 "링크가 만료되었어요" 안내로 대체된다.

## 3. Vercel 배포

1. [vercel.com](https://vercel.com) → GitHub 계정으로 로그인
2. **Add New → Project** → `ImParks/mapletool` import
3. Framework Preset이 **Next.js**로 자동 인식되는지 확인 (빌드 명령 등은 건드릴 것 없음)
4. **Environment Variables**에 위 표의 2개를 추가 — Production / Preview / Development 전부 체크
5. **Production Branch**를 배포할 브랜치로 지정 (Settings → Git)
6. **Deploy**

`vercel.json`이 서버 함수 리전을 서울(`icn1`)로 고정한다. Supabase 프로젝트도 서울
리전이면 DB 왕복이 같은 지역 안에서 끝나 응답이 눈에 띄게 빠르다.

> `NEXT_PUBLIC_*` 값은 **빌드 시점에 클라이언트 번들로 구워진다.** 나중에 값을 바꾸면
> 환경변수만 수정하는 걸로는 반영되지 않고 **재배포(Redeploy)가 필요하다.**

## 4. 배포 후 검증

- [ ] `/signup` 회원가입 → `/main` 진입 (튕기지 않는지)
- [ ] 로그아웃 → `/login` 재로그인
- [ ] 새로고침 후에도 로그인 유지 (middleware의 세션 갱신이 Edge에서 도는지 확인)
- [ ] 설정에서 넥슨 API 키 등록 → 캐릭터 목록 조회
- [ ] 체크리스트 토글 → 새로고침 후 유지
- [ ] 모바일 화면
- [ ] 관리자 계정으로 `/admin` 접근, 일반 계정으로는 차단되는지
- [ ] `/find-password` → 메일 링크 클릭 → `/reset-password`에서 새 비밀번호 저장 → 새 비밀번호로 로그인

### 로그인이 새로고침마다 풀린다면

빌드 시 이런 경고가 나온다:

```
A Node.js API is used (process.version) which is not supported in the Edge Runtime.
Import trace: @supabase/ssr → src/lib/supabase/middleware.ts
```

보통은 무해하지만, Vercel에서 middleware는 기본적으로 Edge 런타임에서 돈다.
실제로 세션 갱신이 깨지면 `src/middleware.ts`에 아래를 추가해 Node 런타임으로 돌린다:

```ts
export const config = {
  runtime: "nodejs",
  matcher: [/* 기존 그대로 */],
};
```

## 5. 남은 과제

### 비밀번호 찾기 메일 — 커스텀 SMTP (실사용 전 필수)

재설정 흐름(`/find-password` → `/auth/callback` → `/reset-password`) 자체는 구현돼 있다.
남은 건 **메일이 실제로 나가느냐**다. Supabase 내장 SMTP는 **테스트 전용**으로, 시간당
발송량이 매우 낮게 제한된다. 그대로 두면 실사용자에게는 사실상 동작하지 않는다.
(한도를 넘기면 앱은 "메일 발송 한도를 초과했습니다" 안내를 보여준다.)

**Project Settings → Authentication → SMTP Settings**에서 커스텀 SMTP를 연결해야 한다.
[Resend](https://resend.com)가 무난하다 (도메인 인증 후 무료 3,000통/월).
연결 후 **Rate Limits**의 시간당 이메일 한도도 함께 올려야 한다.

### 이메일 인증 재도입

2-1에서 인증을 껐기 때문에 가짜 이메일 가입이 가능하다. 커스텀 SMTP를 붙인 뒤
"Confirm email"을 다시 켜려면, 가입 직후 세션이 없는 상태를 처리할
"메일 확인 대기" 화면과 콜백 라우트가 필요하다 (현재 미구현).
