"use client";

import { useEffect, useState } from "react";
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
  const pathname = usePathname();
  const t = useTranslations("settings");
  const { setLastSettingPage } = useSettingStore();

  const config = baseConfig.map((item) => {
    if (typeof item === "string") return item;
    return {
      ...item,
      title: t(`${item.anchor}.title`),
    };
  });

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
    <div className={cn("flex h-full w-56 flex-col justify-between border-r bg-sidebar", className)}>
      <ul className="flex w-full flex-1 flex-col justify-between overflow-y-auto p-4">
        {config.map((item, index) => {
          if (typeof item === "string") {
            return <Separator key={index} className="my-2" />;
          }

          return (
            <li
              key={item.anchor}
              className={cn(
                "flex w-full cursor-pointer items-center gap-3 rounded-md px-4 py-2.5 text-sm transition-colors",
                currentPage === item.anchor
                  ? "bg-primary text-primary-foreground"
                  : "text-foreground/80 hover:bg-accent hover:text-accent-foreground",
              )}
              onClick={() => handleNavigation(item.anchor)}
            >
              <span className="flex size-4 shrink-0 items-center justify-center">{item.icon}</span>
              <span className="truncate">{item.title}</span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
