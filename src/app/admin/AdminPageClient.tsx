"use client";

import { useEffect, useState, useTransition } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { Dialog } from "@/components/ui/Dialog";
import { Input } from "@/components/ui/Input";
import { Logo } from "@/components/ui/Logo";
import { cn } from "@/lib/cn";
import { clampInt } from "@/lib/num";
import { NEXON_BOSS_DIFFICULTIES } from "@/lib/scheduler-state";
import { runAction } from "@/lib/safe-action";
import { addBossPreset, updateBossPreset, type BossPresetFields } from "./boss-preset-actions";

export interface AdminStatDTO {
  label: string;
  value: string;
}

export interface RecentAccessDTO {
  id: string;
  /** 이미 서버(RPC)에서 마스킹된 이메일. 클라이언트에서 추가로 손대지 않고 그대로 표시. */
  maskedEmail: string;
  lastAccessAt: string | null;
}

export interface AdminBossPresetDTO {
  id: string;
  name: string;
  reqLevel: number | null;
  symbolType: "arcane" | "authentic" | null;
  reqForce: number | null;
  recHexa: number | null;
  /** 넥슨 스케줄러 API 원문 콘텐츠명(예: "스우"). 자동 동기화 매칭 키 — 없으면 수동 체크만 가능. */
  nexonContentName: string | null;
  /** 넥슨 스케줄러 API 원문 난이도(영문 소문자 — "hard" 등). nexonContentName 과 둘 다 있어야 자동 매칭. */
  nexonDifficulty: string | null;
}

interface AdminPageClientProps {
  stats: AdminStatDTO[];
  recentAccess: RecentAccessDTO[];
  bossPresets: AdminBossPresetDTO[];
}

const SAVED_LABEL_DURATION_MS = 1600;
// "최근 5분 이내 접속 = 활동중" — 디자인 문서에 정확한 임계값이 없어 이 페이지에서 정한 기준.
const ACTIVE_THRESHOLD_MS = 5 * 60 * 1000;

/** "3분 전"/"1시간 전"/"어제"/"n일 전" 형태의 상대시간 문구. 새 라이브러리 없이 순수 함수로 구현. */
function formatRelativeTime(iso: string | null, nowMs: number): string {
  if (!iso) return "기록 없음";
  const diffMs = Math.max(0, nowMs - new Date(iso).getTime());
  const diffMin = Math.floor(diffMs / 60000);
  if (diffMin < 1) return "방금 전";
  if (diffMin < 60) return `${diffMin}분 전`;
  const diffHour = Math.floor(diffMin / 60);
  if (diffHour < 24) return `${diffHour}시간 전`;
  const diffDay = Math.floor(diffHour / 24);
  if (diffDay === 1) return "어제";
  return `${diffDay}일 전`;
}

function isRecentlyActive(iso: string | null, nowMs: number): boolean {
  if (!iso) return false;
  return nowMs - new Date(iso).getTime() <= ACTIVE_THRESHOLD_MS;
}

interface SymbolToggleProps {
  value: "arcane" | "authentic";
  onChange: (value: "arcane" | "authentic") => void;
  arcaneLabel?: string;
  authenticLabel?: string;
  dense?: boolean;
}

/** 아케인/어센틱 2단 토글. Checkbox/Switch로 표현하기 애매해 간단한 pill 버튼 그룹으로 구현. */
function SymbolToggle({ value, onChange, arcaneLabel = "아케인", authenticLabel = "어센틱", dense }: SymbolToggleProps) {
  return (
    <div
      role="radiogroup"
      aria-label="심볼 타입"
      className={cn(
        "flex flex-none rounded-lg border border-maple-line bg-maple-surface-inset p-0.5",
        !dense && "w-full"
      )}
    >
      {(
        [
          ["arcane", arcaneLabel],
          ["authentic", authenticLabel],
        ] as const
      ).map(([key, label]) => (
        <button
          key={key}
          type="button"
          role="radio"
          aria-checked={value === key}
          onClick={() => onChange(key)}
          className={cn(
            "rounded-[6px] font-extrabold transition-colors duration-180 ease-standard",
            dense ? "px-2.5 py-1 text-[11px]" : "flex-1 px-3 py-2 text-sm",
            value === key
              ? "bg-maple-orange text-maple-text-onaccent shadow-glow-orange"
              : "text-maple-text-secondary hover:bg-maple-surface-sunken"
          )}
        >
          {label}
        </button>
      ))}
    </div>
  );
}

function defaultDraft(preset: AdminBossPresetDTO): BossPresetFields {
  return {
    reqLevel: preset.reqLevel ?? 0,
    reqForce: preset.reqForce ?? 0,
    recHexa: preset.recHexa ?? 0,
    symbolType: preset.symbolType ?? "arcane",
    nexonContentName: preset.nexonContentName ?? "",
    nexonDifficulty: preset.nexonDifficulty ?? "",
  };
}

interface BossPresetRowProps {
  preset: AdminBossPresetDTO;
  onSaved: (id: string, fields: BossPresetFields) => void;
}

/**
 * 보스 관리 행. reqLevel/symbolType/reqForce/recHexa 를 이 행 로컬 draft로만 편집하다가
 * "저장"을 눌러야 서버 액션으로 한 번에 커밋된다(디자인 스펙 — 실수로 여러 필드를 고치다
 * 하나만 저장되는 일을 방지).
 */
function BossPresetRow({ preset, onSaved }: BossPresetRowProps) {
  const original = defaultDraft(preset);
  const [draft, setDraft] = useState<BossPresetFields>(original);
  const [isPending, startTransition] = useTransition();
  const [justSaved, setJustSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // 다른 경로로 preset 원본이 바뀌면(예: 서버 재검증) draft 도 새 기준값으로 맞춘다.
  useEffect(() => {
    setDraft(defaultDraft(preset));
    // eslint-disable-next-line react-hooks/exhaustive-deps -- preset 필드 각각을 의존성으로 사용
  }, [
    preset.reqLevel,
    preset.reqForce,
    preset.recHexa,
    preset.symbolType,
    preset.nexonContentName,
    preset.nexonDifficulty,
  ]);

  const dirty =
    draft.reqLevel !== original.reqLevel ||
    draft.reqForce !== original.reqForce ||
    draft.recHexa !== original.recHexa ||
    draft.symbolType !== original.symbolType ||
    draft.nexonContentName !== original.nexonContentName ||
    draft.nexonDifficulty !== original.nexonDifficulty;

  function handleSave() {
    setError(null);
    startTransition(async () => {
      // runAction 으로 감싸지 않으면 호출 자체가 실패했을 때(타임아웃/네트워크/재배포로 인한
      // Server Action ID 불일치) 예외가 error boundary 까지 올라가 화면 전체가 교체된다.
      const result = await runAction(() => updateBossPreset(preset.id, draft), "저장 중 오류가 발생했습니다.");
      if ("error" in result) {
        setError(result.error);
        return;
      }
      onSaved(preset.id, draft);
      setJustSaved(true);
      window.setTimeout(() => setJustSaved(false), SAVED_LABEL_DURATION_MS);
    });
  }

  function handleCancel() {
    setDraft(original);
    setError(null);
  }

  return (
    <div className="flex flex-col gap-2.5 border-b border-maple-line-subtle px-4 py-3.5 last:border-b-0">
      <div className="flex items-center justify-between gap-2.5">
        <div className="min-w-0 truncate text-sm font-bold text-maple-text-primary">{preset.name}</div>
        <div className="flex flex-none items-center gap-2">
          {dirty && (
            <button
              type="button"
              onClick={handleCancel}
              className="px-1 py-1 text-[11.5px] font-bold text-maple-text-muted hover:text-maple-text-secondary"
            >
              취소
            </button>
          )}
          <Button variant="primary" size="sm" disabled={!dirty} pending={isPending} onClick={handleSave}>
            {justSaved ? "저장됨" : "저장"}
          </Button>
        </div>
      </div>
      {error && (
        <p role="alert" className="text-xs font-semibold text-maple-danger">
          {error}
        </p>
      )}
      <div className="flex flex-wrap items-center gap-2">
        <label className="flex items-center gap-1.5 rounded-lg border border-maple-line bg-maple-surface-inset px-2.5 py-1.5">
          <span className="text-[10.5px] font-bold text-maple-text-muted">필요 Lv</span>
          <input
            type="number"
            min={0}
            max={300}
            value={draft.reqLevel}
            onChange={(event) => setDraft((d) => ({ ...d, reqLevel: clampInt(event.target.value, 0, 300) }))}
            aria-label={`${preset.name} 필요 레벨`}
            className="w-11 border-none bg-transparent text-right text-xs font-extrabold text-maple-text-primary outline-none tabular-nums [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
          />
        </label>
        <SymbolToggle
          dense
          value={draft.symbolType}
          onChange={(symbolType) => setDraft((d) => ({ ...d, symbolType }))}
        />
        <label className="flex items-center gap-1.5 rounded-lg border border-maple-line bg-maple-surface-inset px-2.5 py-1.5">
          <span className="text-[10.5px] font-bold text-maple-text-muted">필요 포스</span>
          <input
            type="number"
            min={0}
            max={99999}
            value={draft.reqForce}
            onChange={(event) => setDraft((d) => ({ ...d, reqForce: clampInt(event.target.value, 0, 99999) }))}
            aria-label={`${preset.name} 필요 포스`}
            className="w-14 border-none bg-transparent text-right text-xs font-extrabold text-maple-text-primary outline-none tabular-nums [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
          />
        </label>
        <label className="flex items-center gap-1.5 rounded-lg border border-maple-line bg-maple-surface-inset px-2.5 py-1.5">
          <span className="text-[10.5px] font-bold text-maple-text-muted">권장 헥사</span>
          <input
            type="number"
            min={0}
            max={30}
            value={draft.recHexa}
            onChange={(event) => setDraft((d) => ({ ...d, recHexa: clampInt(event.target.value, 0, 30) }))}
            aria-label={`${preset.name} 권장 헥사 스탯`}
            className="w-9 border-none bg-transparent text-right text-xs font-extrabold text-maple-text-primary outline-none tabular-nums [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
          />
        </label>
        <label className="flex items-center gap-1.5 rounded-lg border border-maple-line bg-maple-surface-inset px-2.5 py-1.5">
          <span className="text-[10.5px] font-bold text-maple-text-muted">넥슨 콘텐츠명</span>
          <input
            type="text"
            value={draft.nexonContentName ?? ""}
            onChange={(event) => setDraft((d) => ({ ...d, nexonContentName: event.target.value }))}
            placeholder="예: 스우"
            aria-label={`${preset.name} 넥슨 스케줄러 콘텐츠명`}
            className="w-20 border-none bg-transparent text-xs font-extrabold text-maple-text-primary outline-none"
          />
        </label>
        <label className="flex items-center gap-1.5 rounded-lg border border-maple-line bg-maple-surface-inset px-2.5 py-1.5">
          <span className="text-[10.5px] font-bold text-maple-text-muted">넥슨 난이도</span>
          {/* 자유 입력이 아니라 선택지로 제한한다 — 예전 자유 입력 + "예: 하드" 플레이스홀더
              때문에 DB 에 한글 난이도가 들어가 자동 매칭이 전부 실패했다. */}
          <select
            value={draft.nexonDifficulty ?? ""}
            onChange={(event) => setDraft((d) => ({ ...d, nexonDifficulty: event.target.value }))}
            aria-label={`${preset.name} 넥슨 스케줄러 난이도`}
            className="border-none bg-transparent text-xs font-extrabold text-maple-text-primary outline-none"
          >
            <option value="">(매칭 안 함)</option>
            {NEXON_BOSS_DIFFICULTIES.map((d) => (
              <option key={d} value={d}>
                {d}
              </option>
            ))}
          </select>
        </label>
      </div>
    </div>
  );
}

const EMPTY_FORM = {
  name: "",
  reqLevel: "",
  reqForce: "",
  recHexa: "",
  symbolType: "arcane" as const,
  nexonContentName: "",
  nexonDifficulty: "",
};

export function AdminPageClient({ stats, recentAccess, bossPresets: initialBossPresets }: AdminPageClientProps) {
  const [bossPresets, setBossPresets] = useState<AdminBossPresetDTO[]>(initialBossPresets);
  const [addOpen, setAddOpen] = useState(false);
  const [form, setForm] = useState<{
    name: string;
    reqLevel: string;
    reqForce: string;
    recHexa: string;
    symbolType: "arcane" | "authentic";
    nexonContentName: string;
    nexonDifficulty: string;
  }>(EMPTY_FORM);
  const [addError, setAddError] = useState<string | null>(null);
  const [isAdding, startAddTransition] = useTransition();

  function handleRowSaved(id: string, fields: BossPresetFields) {
    setBossPresets((prev) =>
      prev.map((b) =>
        b.id === id
          ? {
              ...b,
              reqLevel: fields.reqLevel,
              reqForce: fields.reqForce,
              recHexa: fields.recHexa,
              symbolType: fields.symbolType,
              nexonContentName: fields.nexonContentName,
              nexonDifficulty: fields.nexonDifficulty,
            }
          : b
      )
    );
  }

  function openAdd() {
    setForm(EMPTY_FORM);
    setAddError(null);
    setAddOpen(true);
  }

  function handleSubmitAdd() {
    const name = form.name.trim();
    if (!name) return;
    setAddError(null);
    startAddTransition(async () => {
      const fields: BossPresetFields = {
        reqLevel: clampInt(form.reqLevel, 0, 300),
        reqForce: clampInt(form.reqForce, 0, 99999),
        recHexa: clampInt(form.recHexa, 0, 30),
        symbolType: form.symbolType,
        nexonContentName: form.nexonContentName,
        nexonDifficulty: form.nexonDifficulty,
      };
      const result = await runAction(() => addBossPreset({ name, ...fields }), "보스 추가 중 오류가 발생했습니다.");
      if ("error" in result) {
        setAddError(result.error);
        return;
      }
      setBossPresets((prev) => [...prev, { id: result.id, name, ...fields }]);
      setAddOpen(false);
    });
  }

  // 상대시간/활동중 판정 기준 시각. 서버 렌더와 하이드레이션 사이 오차는 최대 수백ms 라
  // "n분 전" 표기가 실질적으로 흔들리지 않는다(관리자 전용 화면이라 실시간 갱신은 두지 않음).
  const nowMs = Date.now();

  return (
    <div className="relative z-10">
      <div className="sticky top-0 z-[100] border-b border-maple-line-subtle bg-white/[.86] backdrop-blur-[10px]">
        <div className="mx-auto flex max-w-[1080px] items-center gap-2.5 px-5 py-[11px]">
          <Link href="/main" className="flex items-center gap-2.5">
            <Logo size="sm" />
            <span className="rounded-full bg-maple-surface-inset px-2.5 py-1 text-[11px] font-extrabold text-maple-text-secondary">
              관리자
            </span>
          </Link>
        </div>
      </div>

      <div className="mx-auto max-w-[1080px] px-5 pb-16 pt-6">
        <div className="flex flex-col gap-7">
          <section>
            <h2 className="mb-2.5 text-xs font-extrabold tracking-[.04em] text-maple-text-muted">사용자 현황</h2>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              {stats.map((s) => (
                <div key={s.label} className="rounded-2xl border border-maple-line bg-maple-surface-card p-4 shadow-sm">
                  <div className="text-xs font-semibold text-maple-text-muted">{s.label}</div>
                  <div className="mt-1.5 text-[26px] font-extrabold tabular-nums text-maple-text-primary">{s.value}</div>
                </div>
              ))}
            </div>
          </section>

          <section>
            <h2 className="mb-2.5 text-xs font-extrabold tracking-[.04em] text-maple-text-muted">최근 접속</h2>
            <Card padded={false}>
              <div className="flex flex-col">
                {recentAccess.length === 0 ? (
                  <p className="px-4 py-6 text-center text-xs font-semibold text-maple-text-muted">
                    접속 기록이 없습니다.
                  </p>
                ) : (
                  recentAccess.map((r) => {
                    const active = isRecentlyActive(r.lastAccessAt, nowMs);
                    return (
                      <div
                        key={r.id}
                        className="flex items-center gap-3 border-b border-maple-line-subtle px-4 py-3 last:border-b-0"
                      >
                        <div className="min-w-0 flex-1 truncate text-[13.5px] font-bold text-maple-text-primary">
                          {r.maskedEmail}
                        </div>
                        <div className="flex-none text-xs tabular-nums text-maple-text-muted">
                          {formatRelativeTime(r.lastAccessAt, nowMs)}
                        </div>
                        <Badge tone={active ? "success" : "neutral"} dot>
                          {active ? "활동중" : "오프라인"}
                        </Badge>
                      </div>
                    );
                  })
                )}
              </div>
            </Card>
          </section>

          <section>
            <div className="mb-2.5 flex items-center justify-between gap-3">
              <h2 className="text-xs font-extrabold tracking-[.04em] text-maple-text-muted">보스 관리</h2>
              <Button variant="secondary" size="sm" onClick={openAdd}>
                + 보스 추가
              </Button>
            </div>
            <Card padded={false}>
              <div className="flex flex-col">
                {bossPresets.length === 0 ? (
                  <p className="px-4 py-6 text-center text-xs font-semibold text-maple-text-muted">
                    등록된 보스 프리셋이 없습니다.
                  </p>
                ) : (
                  bossPresets.map((b) => <BossPresetRow key={b.id} preset={b} onSaved={handleRowSaved} />)
                )}
              </div>
            </Card>
          </section>
        </div>
      </div>

      <Dialog
        open={addOpen}
        title="보스 추가"
        description="새 주간 보스 프리셋을 추가합니다. 추가된 보스는 캐릭터별 보스 선택 목록에 나타납니다."
        onClose={() => setAddOpen(false)}
        widthClassName="max-w-[400px]"
      >
        <div className="flex flex-col gap-3.5">
          <Input
            label="보스 이름"
            placeholder="예: 주간 세렌"
            value={form.name}
            onChange={(event) => setForm((f) => ({ ...f, name: event.target.value }))}
          />
          <div className="grid grid-cols-2 gap-3">
            <Input
              label="필요 레벨"
              type="number"
              min={0}
              max={300}
              value={form.reqLevel}
              onChange={(event) => setForm((f) => ({ ...f, reqLevel: event.target.value }))}
            />
            <Input
              label="필요 포스"
              type="number"
              min={0}
              max={99999}
              value={form.reqForce}
              onChange={(event) => setForm((f) => ({ ...f, reqForce: event.target.value }))}
            />
          </div>
          <div>
            <div className="mb-1.5 text-[13px] font-bold text-maple-text-secondary">심볼 타입</div>
            <SymbolToggle
              arcaneLabel="아케인 심볼"
              authenticLabel="어센틱 심볼"
              value={form.symbolType}
              onChange={(symbolType) => setForm((f) => ({ ...f, symbolType }))}
            />
          </div>
          <Input
            label="권장 헥사 스탯"
            type="number"
            min={0}
            max={30}
            value={form.recHexa}
            onChange={(event) => setForm((f) => ({ ...f, recHexa: event.target.value }))}
          />
          <div className="grid grid-cols-2 gap-3">
            <Input
              label="넥슨 콘텐츠명"
              placeholder="예: 스우 (비워두면 자동동기화 제외)"
              value={form.nexonContentName}
              onChange={(event) => setForm((f) => ({ ...f, nexonContentName: event.target.value }))}
            />
            {/* 위 행 편집과 동일하게 선택지로 제한한다(한글 난이도 유입 차단). */}
            <label className="flex flex-col gap-1.5">
              <span className="text-xs font-extrabold text-maple-text-secondary">넥슨 난이도</span>
              <select
                value={form.nexonDifficulty}
                onChange={(event) => setForm((f) => ({ ...f, nexonDifficulty: event.target.value }))}
                className="h-11 rounded-xl border border-maple-line bg-maple-surface-inset px-3 text-sm font-bold text-maple-text-primary outline-none focus:border-maple-orange"
              >
                <option value="">(매칭 안 함)</option>
                {NEXON_BOSS_DIFFICULTIES.map((d) => (
                  <option key={d} value={d}>
                    {d}
                  </option>
                ))}
              </select>
            </label>
          </div>
          {addError && (
            <p role="alert" className="text-xs font-semibold text-maple-danger">
              {addError}
            </p>
          )}
          <Button variant="primary" block disabled={form.name.trim().length === 0} pending={isAdding} onClick={handleSubmitAdd}>
            추가
          </Button>
        </div>
      </Dialog>
    </div>
  );
}
