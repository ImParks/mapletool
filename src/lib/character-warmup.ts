"use client";

// 캐릭터 스냅샷(이미지/전투력/포스) 워밍업을 **클라이언트에서 캐릭터 1건씩 순차로** 돌리는 훅.
//
// 왜 클라이언트인가: 예전에는 서버 액션 하나(saveNexonKey)가 계정 전체를 루프로 돌았는데,
// 캐릭터가 많으면 서버리스 함수 실행시간 제한에 그대로 걸렸다(그래서 page.tsx 에 maxDuration=60
// 을 걸고도 "캐릭터 수가 많으면 시간이 초과될 수 있어요" 안내를 달아야 했다). 캐릭터 1건 = 서버
// 액션 1회로 쪼개면 각 호출이 짧아 타임아웃 위험이 사라지고, 덤으로 진행률("12명 중 3명")을
// 보여줄 수 있다.
//
// 넥슨 호출은 여전히 서버에서만 일어난다 — 이 훅은 refreshCharacterSnapshot 서버 액션을 부를
// 뿐이고, API 키는 그 액션이 DB 에서 직접 읽으므로 클라이언트로 내려오지 않는다.

import { useCallback, useRef, useState } from "react";
import { refreshCharacterSnapshot } from "@/app/main/actions";
import { runAction } from "@/lib/safe-action";

/**
 * 캐릭터 사이 간격. 넥슨 개발단계 키는 초당 5건 제한인데 캐릭터 1건당 3회(basic/stat/symbol)를
 * 병렬로 쏘므로, 서버 액션 왕복 시간에 더해 이만큼 띄워 여유를 둔다.
 */
const WARMUP_DELAY_MS = 250;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export interface WarmupProgress {
  done: number;
  total: number;
}

export interface CharacterWarmup {
  /** 진행 중이면 진행률, 아니면 null. ProgressOverlay 의 open 조건으로 쓴다. */
  progress: WarmupProgress | null;
  /** ocid 목록을 순차 워밍업하고 **실패한 건수**를 돌려준다. 개별 실패는 루프를 멈추지 않는다. */
  warmUp: (ocids: string[]) => Promise<number>;
  /** 오버레이를 내린다. warmUp 이 끝나도 자동으로 내려가지 않으니 호출부가 반드시 부른다. */
  endWarmup: () => void;
}

/**
 * 순차 워밍업 + 진행률 상태.
 *
 * 주의: `warmUp` 이 끝나도 `progress` 를 비우지 않는다. 워밍업 직후 router.refresh() 로 화면을
 * 다시 그리는 동안에도 오버레이가 유지돼야 "캐릭터가 없는 빈 화면"이 잠깐 스치는 걸 막을 수
 * 있기 때문이다. 호출부가 refresh 를 시작한 뒤 `endWarmup()` 을 부른다.
 */
export function useCharacterWarmup(): CharacterWarmup {
  const [progress, setProgress] = useState<WarmupProgress | null>(null);
  // 연타/중복 호출 방지. state 가 아니라 ref 인 이유는 같은 tick 안에서 즉시 반영돼야 해서다.
  const runningRef = useRef(false);

  const warmUp = useCallback(async (ocids: string[]): Promise<number> => {
    if (runningRef.current || ocids.length === 0) return 0;
    runningRef.current = true;
    setProgress({ done: 0, total: ocids.length });

    let failed = 0;
    try {
      for (let i = 0; i < ocids.length; i += 1) {
        // 캐릭터 하나가 실패해도(넥슨 일시 오류/레이트리밋) 다음 캐릭터로 계속 간다 —
        // 실패한 캐릭터는 상세의 "동기화" 버튼으로 개별 재시도할 수 있다.
        const result = await runAction(
          () => refreshCharacterSnapshot(ocids[i]),
          "캐릭터 정보를 불러오지 못했습니다."
        );
        if ("error" in result) failed += 1;

        setProgress({ done: i + 1, total: ocids.length });
        if (i < ocids.length - 1) await sleep(WARMUP_DELAY_MS);
      }
    } finally {
      runningRef.current = false;
    }
    return failed;
  }, []);

  const endWarmup = useCallback(() => setProgress(null), []);

  return { progress, warmUp, endWarmup };
}
