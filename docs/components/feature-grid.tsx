export function FeatureGrid({
  items,
}: {
  items: Array<{
    title: string
    description: string
  }>
}) {
  return (
    <div className="my-6 grid gap-3 sm:grid-cols-2">
      {items.map((item) => (
        <div key={item.title} className="rounded-xl border border-[color:var(--line)] bg-[rgba(247,244,239,0.56)] p-4">
          <h3 className="!m-0 text-base">{item.title}</h3>
          <p className="!mb-0 !mt-2 text-sm leading-6 text-[color:var(--muted)]">{item.description}</p>
        </div>
      ))}
    </div>
  )
}
