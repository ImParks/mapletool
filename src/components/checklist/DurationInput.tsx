"use client";

import { useEffect, useState } from "react";
import { Check } from "lucide-react";
import { clampInt } from "@/lib/num";

interface DurationInputProps {
  /** 서버에 커밋된(저장된) 값. 0/미설정이면 입력칸이 비어 있는 것으로 표시. */
  committedMinutes: number;
  onSave: (minutes: number) => void;
  itemName: string;
}

/**
 * 항목별 예상 소요시간(분) 입력. 입력은 로컬 draft로만 반영되고, 커밋된 값과 달라지면
 * 오른쪽에 저장(체크) 버튼이 나타난다 — 눌러야 실제로 저장(quest_durations upsert)된다.
 */
export function DurationInput({ committedMinutes, onSave, itemName }: DurationInputProps) {
  const baseline = committedMinutes > 0 ? String(committedMinutes) : "";
  const [draft, setDraft] = useState(baseline);

  // 서버에서 커밋된 값이 바뀌면(저장 성공/새로고침 등) draft 를 새 기준값으로 맞춘다.
  useEffect(() => {
    setDraft(baseline);
  }, [baseline]);

  const dirty = draft !== baseline;

  function commit() {
    onSave(clampInt(draft, 0, 999));
  }

  return (
    <div className="flex flex-none items-center gap-1">
      <label className="flex items-center gap-1 rounded-[9px] border border-maple-line bg-maple-surface-inset px-2.5 py-1.5">
        <span className="sr-only">{itemName} 예상 소요시간(분)</span>
        <input
          type="number"
          inputMode="numeric"
          min={0}
          max={999}
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          placeholder="—"
          className="w-10 border-none bg-transparent text-right text-sm font-bold text-maple-text-primary outline-none [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
        />
        <span className="text-[11px] font-bold text-maple-text-muted">분</span>
      </label>
      {dirty && (
        <button
          type="button"
          onClick={commit}
          aria-label={`${itemName} 예상 소요시간 저장`}
          className="flex h-[26px] w-[26px] flex-none items-center justify-center rounded-lg bg-maple-orange text-maple-text-onaccent shadow-glow-orange"
        >
          <Check className="h-3.5 w-3.5" strokeWidth={3} aria-hidden="true" />
        </button>
      )}
    </div>
  );
}
