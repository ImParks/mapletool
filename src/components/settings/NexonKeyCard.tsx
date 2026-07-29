"use client";

import { useActionState, useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { KeyRound } from "lucide-react";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { ProgressOverlay } from "@/components/ui/ProgressOverlay";
import { deleteNexonKey, saveNexonKey, type NexonKeyState } from "@/app/main/nexon-key-actions";
import { useCharacterWarmup } from "@/lib/character-warmup";
import { runVoidAction, safeFormAction } from "@/lib/safe-action";

// "use server" 파일은 async 함수만 export 가능(Next.js 제약)이라, 초기 상태값은
// 이 클라이언트 컴포넌트에 둔다.
const initialNexonKeyState: NexonKeyState = { error: null, success: false, ocids: [] };

/**
 * useActionState 에 넘긴 액션이 **예외를 던지면 React 가 그걸 렌더 중에 다시 던져
 * error boundary(=main/error.tsx)로 올려버리기 때문에**, 설정 모달 안에서 키 등록에 실패했을
 * 뿐인데 화면 전체가 에러 페이지로 바뀌었다. 여기서 흡수해 폼 안의 에러 문구로만 보여준다.
 *
 * (액션 자체는 이제 캐릭터 목록 조회 1회로 끝나 짧다 — 캐릭터별 상세 조회는 아래 순차 워밍업이
 * 맡으므로, 예전처럼 캐릭터가 많다고 이 액션이 타임아웃되지는 않는다.)
 */
const saveNexonKeySafe = safeFormAction<NexonKeyState>(
  saveNexonKey,
  (message) => ({ error: message, success: false, ocids: [] }),
  "키 등록 처리가 완료되지 못했습니다. 잠시 후 다시 시도하거나, 화면을 새로고침해 등록 여부를 확인해 주세요."
);

interface NexonKeyCardProps {
  /** 등록된 키가 있는지(서버에서 이미 조회한 값). 원문은 절대 이 컴포넌트에 넘기지 않는다. */
  registered: boolean;
  /** 서버에서 마스킹해서 내려준 표시용 문자열(예: "••••••••••••3F1A"). */
  maskedKey: string | null;
  className?: string;
}

/**
 * 넥슨 API 키 등록/교체/삭제 카드. 값은 항상 Server Action(saveNexonKey/deleteNexonKey)
 * 으로만 전송하고, 화면에는 등록 여부 Badge 와 서버가 만들어준 마스킹 문자열만 노출한다.
 *
 * 키 등록이 성공하면 이어서 계정 캐릭터를 1건씩 순차로 워밍업하며 전체 화면 진행률 오버레이를
 * 띄운다. 다 불러온 뒤에야 router.refresh() 로 화면을 연결한다 — 캐릭터가 하나씩 튀어나오거나
 * 빈 화면이 잠깐 보이는 일이 없도록.
 */
export function NexonKeyCard({ registered, maskedKey, className }: NexonKeyCardProps) {
  const [state, formAction, isSaving] = useActionState(saveNexonKeySafe, initialNexonKeyState);
  const [isDeleting, startDeleteTransition] = useTransition();
  const [isRefreshing, startRefresh] = useTransition();
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [warmupError, setWarmupError] = useState<string | null>(null);
  const router = useRouter();
  const { progress, warmUp, endWarmup } = useCharacterWarmup();

  // 처리한 액션 결과를 기억해 같은 결과로 워밍업이 두 번 도는 것을 막는다(개발 모드의
  // StrictMode 이중 실행 포함). useActionState 는 실행마다 새 객체를 돌려주므로 객체 아이덴티티
  // 비교로 충분하다.
  const handledStateRef = useRef<NexonKeyState | null>(null);

  useEffect(() => {
    if (!state.success) return;
    if (handledStateRef.current === state) return;
    handledStateRef.current = state;

    void (async () => {
      setWarmupError(null);
      const failed = await warmUp(state.ocids);
      if (failed > 0) {
        setWarmupError(
          `${failed}명의 캐릭터 정보를 불러오지 못했어요. 캐릭터를 선택한 뒤 "동기화" 버튼으로 다시 시도할 수 있어요.`
        );
      }
      // 워밍업이 끝난 뒤에야 화면을 다시 그린다. refresh 가 끝날 때까지 오버레이를 유지하려고
      // endWarmup() 을 refresh 시작 뒤에 부른다(오버레이 open 조건에 isRefreshing 이 포함됨).
      startRefresh(() => router.refresh());
      endWarmup();
    })();
  }, [state, warmUp, endWarmup, router]);

  function handleDelete() {
    setDeleteError(null);
    startDeleteTransition(async () => {
      // 호출 자체가 실패해도(타임아웃/네트워크) 예외가 error boundary 로 새어나가지 않게 한다.
      const thrown = await runVoidAction(async () => {
        const result = await deleteNexonKey();
        if (result.error) setDeleteError(result.error);
      }, "키 삭제 중 오류가 발생했습니다.");
      if (thrown) setDeleteError(thrown);
    });
  }

  return (
    <div className={className}>
      <ProgressOverlay
        open={progress !== null || isRefreshing}
        title="API 호출중입니다"
        description="계정의 캐릭터 정보를 불러오고 있어요. 완료되면 화면이 자동으로 열려요."
        done={progress?.done ?? 0}
        total={progress?.total ?? 0}
      />

      <div className="flex flex-col gap-4">
        <h3 className="text-sm font-extrabold text-maple-text-primary">넥슨 API 키</h3>

        {registered && maskedKey && (
          <div className="flex flex-wrap items-center gap-2.5">
            <Badge tone="success" dot>
              등록됨
            </Badge>
            <span className="font-mono text-[13px] text-maple-text-secondary">{maskedKey}</span>
          </div>
        )}

        {(state.error || deleteError || warmupError) && (
          <p role="alert" className="rounded-lg bg-maple-danger-soft px-3 py-2 text-xs font-semibold text-maple-danger">
            {state.error ?? deleteError ?? warmupError}
          </p>
        )}
        {state.success && !warmupError && (
          <p role="status" className="rounded-lg bg-maple-success-soft px-3 py-2 text-xs font-semibold text-maple-success-text">
            API 키가 저장되었습니다.
          </p>
        )}

        <form action={formAction} className="flex flex-col gap-3">
          <Input
            label={registered ? "새 키로 교체" : "넥슨 API 키"}
            name="apiKey"
            type="password"
            autoComplete="off"
            placeholder="새 API 키 붙여넣기"
            leadingIcon={<KeyRound className="h-4 w-4" aria-hidden="true" />}
            helpText="키는 계정에 안전하게 저장되며 캐릭터 조회에만 사용됩니다. 최초 연결 시 계정의 모든 캐릭터 정보를 불러와요 — 캐릭터 수에 따라 다소 시간이 걸릴 수 있어요."
            required
          />
          <div className="flex gap-2.5">
            <Button type="submit" variant="secondary" size="sm" pending={isSaving}>
              {registered ? "키 업데이트" : "키 등록"}
            </Button>
            {registered && (
              <Button type="button" variant="ghost" size="sm" pending={isDeleting} onClick={handleDelete}>
                키 삭제
              </Button>
            )}
          </div>
        </form>
      </div>
    </div>
  );
}
