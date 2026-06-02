export function Callout({
  title,
  children,
  tone = 'note',
}: {
  title: React.ReactNode
  children: React.ReactNode
  tone?: 'note' | 'warning' | 'success'
}) {
  const toneClass = {
    note: 'border-[rgba(86,121,150,0.28)] bg-[rgba(86,121,150,0.08)]',
    warning: 'border-[rgba(245,166,35,0.34)] bg-[rgba(245,166,35,0.13)]',
    success: 'border-[rgba(75,143,122,0.28)] bg-[rgba(75,143,122,0.1)]',
  }[tone]

  return (
    <div className={`my-5 rounded-xl border p-4 ${toneClass}`}>
      <p className="mb-2 text-sm font-semibold text-[color:var(--brand)]">{title}</p>
      <div className="text-sm leading-7 text-[color:var(--muted)]">{children}</div>
    </div>
  )
}
