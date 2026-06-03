export function SettingType(
  {id, title, icon, desc, children}:
  { id: string, title: string, icon?: React.ReactNode, desc?: string, children?: React.ReactNode}
) {
  return <div id={id} className="mx-auto flex w-full max-w-5xl flex-col space-y-5">
    <div className="border-b pb-4">
      <h2 className="flex w-full items-center gap-2 text-xl font-semibold tracking-tight">
        {icon && <span className="text-muted-foreground">{icon}</span>}
        {title}
      </h2>
      {desc && <p className="mt-2 max-w-3xl text-sm leading-6 text-muted-foreground">{desc}</p>}
    </div>
    {children}
  </div>
}

export function FormItem({title, desc, children}: { title: string, desc?: string, children: React.ReactNode}) {
  return <div className="flex w-full flex-col">
    <div className="mb-2 text-sm font-semibold">{title}</div>
    {children}
    {desc && <p className="mt-2 text-sm leading-6 text-muted-foreground">{desc}</p>}
  </div>
}
