"use client";

import { useActionState, useState, useTransition } from "react";
import { KeyRound } from "lucide-react";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { deleteNexonKey, saveNexonKey, type NexonKeyState } from "@/app/main/nexon-key-actions";

// "use server" 파일은 async 함수만 export 가능(Next.js 제약)이라, 초기 상태값은
// 이 클라이언트 컴포넌트에 둔다.
const initialNexonKeyState: NexonKeyState = { error: null, success: false };

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
 */
export function NexonKeyCard({ registered, maskedKey, className }: NexonKeyCardProps) {
  const [state, formAction, isSaving] = useActionState(saveNexonKey, initialNexonKeyState);
  const [isDeleting, startDeleteTransition] = useTransition();
  const [deleteError, setDeleteError] = useState<string | null>(null);

  function handleDelete() {
    setDeleteError(null);
    startDeleteTransition(async () => {
      const result = await deleteNexonKey();
      if (result.error) setDeleteError(result.error);
    });
  }

  return (
    <div className={className}>
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

        {(state.error || deleteError) && (
          <p role="alert" className="rounded-lg bg-maple-danger-soft px-3 py-2 text-xs font-semibold text-maple-danger">
            {state.error ?? deleteError}
          </p>
        )}
        {state.success && (
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
            helpText="키는 계정에 안전하게 저장되며 캐릭터 조회에만 사용됩니다."
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
