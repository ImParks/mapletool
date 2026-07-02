export default function MainLoading() {
  return (
    <div className="mx-auto flex max-w-[1080px] flex-col gap-6 px-5 py-8">
      <div className="h-7 w-40 animate-pulse rounded-lg bg-maple-surface-inset" />
      <div className="flex gap-2">
        {Array.from({ length: 3 }).map((_, i) => (
          <div key={i} className="h-10 w-24 animate-pulse rounded-full bg-maple-surface-inset" />
        ))}
      </div>
      <div className="flex gap-3 overflow-hidden">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="h-[260px] w-[200px] flex-none animate-pulse rounded-2xl bg-maple-surface-inset" />
        ))}
      </div>
    </div>
  );
}
