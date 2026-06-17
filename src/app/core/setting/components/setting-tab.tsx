"use client";

import { Fragment, useEffect, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { useTranslations } from "next-intl";

import baseConfig from "../config";
import useSettingStore from "@/stores/setting";
import { Separator } from "@/components/ui/separator";
import { cn } from "@/lib/utils";

interface SettingTabProps {
  currentPage?: string;
  onNavigate?: (anchor: string) => void;
  className?: string;
}

export function SettingTab({ currentPage: controlledPage, onNavigate, className }: SettingTabProps) {
  const [currentPage, setCurrentPage] = useState("about");
  const router = useRouter();
  const pathname = usePathname() || "";
  const t = useTranslations("settings");
  const { setLastSettingPage } = useSettingStore();

  const config = baseConfig.map((item) => ({
    ...item,
    title: t(`${item.anchor}.title`),
    groupTitle: t(`sections.${item.group}`),
  }));

  function handleNavigation(anchor: string) {
    setCurrentPage(anchor);
    void setLastSettingPage(anchor);

    if (onNavigate) {
      onNavigate(anchor);
      return;
    }

    router.push(`/core/setting/${anchor}`);
  }

  useEffect(() => {
    if (controlledPage) {
      setCurrentPage(controlledPage);
      return;
    }

    const pageName = pathname.split("/").pop();
    if (pageName && pageName !== "setting") {
      setCurrentPage(pageName);
      void setLastSettingPage(pageName);
    }
  }, [controlledPage, pathname, setLastSettingPage]);

  return (
    <div className={cn("flex h-full w-60 flex-col border-r bg-sidebar/80", className)}>
      <ul className="flex w-full flex-1 flex-col gap-1 overflow-y-auto p-3">
        {config.map((item, index) => {
          const previous = config[index - 1];
          const showGroupTitle = !previous || previous.group !== item.group;

          return (
            <Fragment key={item.anchor}>
              {showGroupTitle && index > 0 ? <Separator className="my-1" /> : null}
              {showGroupTitle && (
                <li className={cn("px-3 pb-1 pt-3 text-[11px] font-medium uppercase tracking-wide text-muted-foreground/80", index === 0 && "pt-1")}>
                  {item.groupTitle}
                </li>
              )}
              <li
                className={cn(
                  "flex w-full cursor-pointer items-center gap-3 rounded-md px-3 py-2.5 text-sm transition-colors",
                  currentPage === item.anchor
                    ? "bg-primary text-primary-foreground shadow-sm"
                    : "text-foreground/80 hover:bg-accent hover:text-accent-foreground",
                )}
                onClick={() => handleNavigation(item.anchor)}
              >
                <span className="flex size-5 shrink-0 items-center justify-center">{item.icon}</span>
                <span className="truncate">{item.title}</span>
              </li>
            </Fragment>
          );
        })}
      </ul>
    </div>
  );
}
