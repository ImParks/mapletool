/**
 * 배열의 각 항목에 비동기 함수를 적용하되 동시 실행 수를 limit 으로 제한한다.
 * 결과 순서는 입력 순서와 동일하게 보존된다.
 *
 * 용도: 넥슨 OpenAPI 는 개발 단계 키 기준 초당 5건 제한(429/OPENAPI00007)이 있어,
 * 캐릭터 수만큼 무제한 Promise.all 로 쏘면 다계정(수십 캐릭터)에서 burst 초과가 난다.
 * 동시성 제한은 정확한 초당 속도 제어는 아니지만 burst 를 limit 수준으로 눌러주고,
 * 응답 캐시(revalidate)와 조합하면 반복 조회는 대부분 캐시로 흡수된다.
 *
 * 주의: fn 이 reject 하면 반환 Promise 는 첫 에러로 reject 되지만, 이미 돌고 있는/이후의
 * fn 호출은 취소되지 않고 끝까지 소비된다(결과는 버려짐). 개별 실패를 값으로 처리하려면
 * 호출부에서 fn 내부를 try/catch 로 감싸라(main/page.tsx 의 사용 방식).
 */
export async function mapWithConcurrency<T, R>(
  items: readonly T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>
): Promise<R[]> {
  const results: R[] = new Array<R>(items.length);
  let nextIndex = 0;

  async function worker(): Promise<void> {
    while (true) {
      const index = nextIndex;
      nextIndex += 1;
      if (index >= items.length) return;
      results[index] = await fn(items[index], index);
    }
  }

  const workerCount = Math.max(1, Math.min(limit, items.length));
  await Promise.all(Array.from({ length: workerCount }, () => worker()));
  return results;
}
