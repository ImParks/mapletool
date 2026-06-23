---
name: nexon-maple-api
description: 넥슨 메이플스토리 OpenAPI 레퍼런스. 인증 헤더(x-nxopen-api-key), 베이스 URL, 엔드포인트(캐릭터 리스트/식별자(ocid)/기본정보/스탯/유니온/장비 등), date 파라미터 규칙, 캐싱, 에러 코드/레이트리밋을 정리. 넥슨 API 연동 코드를 작성·확장·디버깅할 때 항상 먼저 참조한다.
---

# 넥슨 메이플스토리 OpenAPI 레퍼런스

> 이 프로젝트의 실제 클라이언트는 `src/lib/maple.ts`(서버 전용)에 있다. 새 엔드포인트를 추가할 땐 그 파일의 `request()` 헬퍼와 `MapleApiError` 패턴을 재사용한다.

## ⚠️ 보강 필요 (사용자 제공 문서 붙여넣기)
아래 "검증됨" 섹션은 현재 코드(`maple.ts`)에서 직접 확인한 사실이다.
그 외 엔드포인트·파라미터·레이트리밋·에러코드 상세는 **사용자가 붙여넣어 줄 넥슨 공식 문서**로 이 파일을 보강한다.
공식 문서: https://openapi.nexon.com/game/maplestory/

---

## 검증됨 (코드 기준)

### 베이스 URL
```
https://open.api.nexon.com
```

### 인증
- 모든 요청에 헤더 `x-nxopen-api-key: <API_KEY>` 필요.
- API 키는 https://openapi.nexon.com 에서 발급.
- **이 앱은 키를 환경변수가 아니라 사용자별 앱 설정에 저장**한다. → 호출은 반드시 서버(서버 컴포넌트/route handler/server action)에서만 수행하고, **키를 클라이언트로 절대 노출하지 않는다.**
- 401/403 → 키가 유효하지 않거나 권한 없음. 사용자에게 "설정에서 키 확인" 안내.

### 캐싱
- `fetch(..., { next: { revalidate: 60 } })` — 넥슨 데이터는 자주 바뀌지 않으므로 60초 캐싱. 엔드포인트 특성에 맞게 조정.

### 에러 응답 형태
- 비정상 응답 본문: `{ "error": { "name": "<코드>", "message": "<메시지>" } }`
- `MapleApiError(message, status, code)` 로 일관 처리.

### 구현된 엔드포인트

| 메서드/경로 | 파라미터 | 반환(요약) |
|---|---|---|
| `GET /maplestory/v1/character/list` | (없음) | `account_list[].character_list[]` → `{ ocid, character_name, world_name, character_class, character_level }` |
| `GET /maplestory/v1/id` | `character_name` | `{ ocid }` |
| `GET /maplestory/v1/character/basic` | `ocid`, `date?` | `CharacterBasic` (레벨/경험치/직업/길드/이미지 등) |
| `GET /maplestory/v1/character/stat` | `ocid`, `date?` | `CharacterStat` → `final_stat: [{ stat_name, stat_value }]`, `remain_ap` |

**조회 흐름:** 캐릭터명 → `getOcid` 로 `ocid` 획득 → `ocid` 로 basic/stat 등 상세 조회.
계정 전체 캐릭터는 `character/list` 한 번으로 가져온다.

### date 파라미터 (주의 — 사용자 문서로 확정 필요)
- 형식은 KST 기준 `YYYY-MM-DD` 로 추정. 넥슨 데이터는 보통 **전일 자정 기준 스냅샷**으로 갱신되어, 당일 데이터는 일정 시각 이후에 조회 가능한 경우가 많다.
- 미지정 시 최신 가용 데이터.
- ⚠️ 정확한 갱신 시각·조회 가능 범위·과거 데이터 보존 기간은 **공식 문서 붙여넣기로 확정**한다.

---

## 보강 예정 섹션 (사용자 문서 붙여넣은 뒤 채움)

### 추가 엔드포인트
<!-- 예: 유니온(union/raider), 장비(item-equipment), 심볼(symbol-equipment),
     캐시장비, 어빌리티, 무릉도장(dojang), 캐릭터 인기도(popularity) 등 -->
- [ ] (붙여넣기)

### 레이트리밋 / 호출 제한
- [ ] 초/일 호출 한도, 429 처리 정책 (붙여넣기)

### 전체 에러 코드 표
- [ ] OPENAPI00001 등 코드별 의미 (붙여넣기)

### 월드/직업/스탯 enum 값
- [ ] 코드값 매핑 (붙여넣기)
