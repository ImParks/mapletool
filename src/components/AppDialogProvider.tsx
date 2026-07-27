"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { AlertDialog, TONE_DEFAULT_TITLE, type AlertTone } from "@/components/ui/AlertDialog";

interface AppAlert {
  tone: AlertTone;
  title: string;
  message: string;
  /** 새로고침으로 복구되는 오류(배포 직후 청크 로드 실패 등)에서만 true. */
  offerReload?: boolean;
}

interface ShowOptions {
  title?: string;
}

interface AppDialogContextValue {
  /** 에러를 모달로 띄운다. 화면 레이아웃은 그대로 두고 다이얼로그만 얹는다. */
  showError: (message: string, options?: ShowOptions) => void;
  /** 성공/안내를 모달로 띄운다. */
  showNotice: (message: string, options?: ShowOptions & { tone?: Exclude<AlertTone, "error"> }) => void;
}

const AppDialogContext = createContext<AppDialogContextValue | null>(null);

export function useAppDialog(): AppDialogContextValue {
  const context = useContext(AppDialogContext);
  if (!context) {
    throw new Error("useAppDialog 는 AppDialogProvider 안에서만 사용할 수 있습니다.");
  }
  return context;
}

/** 브라우저/확장 프로그램이 흘리는 노이즈. 사용자에게 보여줄 가치가 없어 모달을 띄우지 않는다. */
const IGNORED_MESSAGE = /ResizeObserver loop|^Script error\.?$/i;
/** 배포로 청크 해시가 바뀌어 이전 번들을 들고 있던 탭이 실패하는 케이스 — 새로고침이 정답이다. */
const CHUNK_LOAD_MESSAGE = /chunk|dynamically imported module|importing a module script failed/i;

const GENERIC_ERROR_MESSAGE = "예상치 못한 오류가 발생했어요. 잠시 후 다시 시도해 주세요.";
const CHUNK_ERROR_MESSAGE = "앱이 새 버전으로 업데이트됐어요. 새로고침한 뒤 다시 시도해 주세요.";

function messageOf(reason: unknown): string {
  if (typeof reason === "string") return reason;
  if (reason instanceof Error) return reason.message;
  return "";
}

/**
 * 앱 전역 알림(에러/안내) 모달 제공자. 루트 레이아웃에 마운트되어 모든 페이지가 공유한다.
 *
 * 두 가지를 담당한다.
 *  1) useAppDialog() 로 클라이언트 컴포넌트가 서버 액션 실패 등을 모달로 띄운다.
 *  2) 어디서도 처리되지 않은 런타임 오류(window error / unhandledrejection)를 잡아
 *     "아무 안내 없이 화면만 이상해지는" 상황 대신 모달로 알려준다.
 */
export function AppDialogProvider({ children }: { children: ReactNode }) {
  // 큐로 관리해 알림이 겹쳐도 유실되지 않게 한다(같은 내용은 합친다 —
  // 예: 카테고리 일괄 완료에서 항목마다 같은 에러가 쏟아지는 경우).
  const [queue, setQueue] = useState<AppAlert[]>([]);

  const push = useCallback((alert: AppAlert) => {
    setQueue((current) =>
      current.some((a) => a.tone === alert.tone && a.message === alert.message) ? current : [...current, alert]
    );
  }, []);

  const showError = useCallback<AppDialogContextValue["showError"]>(
    (message, options) => {
      push({ tone: "error", title: options?.title ?? TONE_DEFAULT_TITLE.error, message });
    },
    [push]
  );

  const showNotice = useCallback<AppDialogContextValue["showNotice"]>(
    (message, options) => {
      const tone = options?.tone ?? "success";
      push({ tone, title: options?.title ?? TONE_DEFAULT_TITLE[tone], message });
    },
    [push]
  );

  useEffect(() => {
    function report(rawMessage: string) {
      if (IGNORED_MESSAGE.test(rawMessage)) return;
      const isChunkError = CHUNK_LOAD_MESSAGE.test(rawMessage);
      push({
        tone: "error",
        title: TONE_DEFAULT_TITLE.error,
        message: isChunkError ? CHUNK_ERROR_MESSAGE : GENERIC_ERROR_MESSAGE,
        offerReload: isChunkError,
      });
    }

    function handleError(event: ErrorEvent) {
      // 이미지 등 리소스 로드 실패(target !== window)는 화면 오류가 아니므로 무시한다.
      if (event.target && event.target !== window) return;
      const message = event.message || messageOf(event.error);
      if (!message) return;
      report(message);
    }

    function handleRejection(event: PromiseRejectionEvent) {
      const message = messageOf(event.reason);
      if (!message) return;
      report(message);
    }

    window.addEventListener("error", handleError);
    window.addEventListener("unhandledrejection", handleRejection);
    return () => {
      window.removeEventListener("error", handleError);
      window.removeEventListener("unhandledrejection", handleRejection);
    };
  }, [push]);

  const value = useMemo<AppDialogContextValue>(() => ({ showError, showNotice }), [showError, showNotice]);
  const current = queue[0] ?? null;

  function handleClose() {
    setQueue((q) => q.slice(1));
  }

  return (
    <AppDialogContext.Provider value={value}>
      {children}
      {current && (
        <AlertDialog
          open
          tone={current.tone}
          title={current.title}
          message={current.message}
          onClose={handleClose}
          secondaryAction={
            current.offerReload
              ? { label: "새로고침", onClick: () => window.location.reload() }
              : undefined
          }
        />
      )}
    </AppDialogContext.Provider>
  );
}
