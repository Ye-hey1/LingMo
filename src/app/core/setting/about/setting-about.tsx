'use client';
import { SettingType } from "../components/setting-base";
import { Item, ItemGroup, ItemMedia, ItemContent, ItemTitle, ItemDescription, ItemActions } from "@/components/ui/item";
import { useTranslations } from 'next-intl';
import Updater from "./updater";
import { Bug, DownloadIcon, Github, HomeIcon, MessageSquare, SettingsIcon } from "lucide-react";
import { open } from "@tauri-apps/plugin-shell";
import { Button } from "@/components/ui/button";

export function SettingAbout({id, icon}: {id: string, icon?: React.ReactNode}) {
  const t = useTranslations('settings.about');

  const items = [
    {
      id: "home",
      url: "https://github.com/Ye-hey1/note-gen#readme",
      title: t('items.home.title'),
      desc: t('items.home.desc'),
      icon: <HomeIcon className="size-4" />,
      buttonName: t('items.home.buttonName')
    },
    {
      id: "guide",
      url: "https://github.com/Ye-hey1/note-gen#readme",
      title: t('items.guide.title'),
      desc: t('items.guide.desc'),
      icon: <SettingsIcon className="size-4" />,
      buttonName: t('items.guide.buttonName')
    },
    {
      id: "github",
      url: "https://github.com/Ye-hey1/note-gen",
      title: t('items.github.title'),
      desc: t('items.github.desc'),
      icon: <Github className="size-4" />,
      buttonName: t('items.github.buttonName')
    },
    {
      id: "releases",
      url: "https://github.com/Ye-hey1/note-gen/releases",
      title: t('items.releases.title'),
      desc: t('items.releases.desc'),
      icon: <DownloadIcon className="size-4" />,
      buttonName: t('items.releases.buttonName')
    },
    {
      id: "issues",
      url: "https://github.com/Ye-hey1/note-gen/issues",
      title: t('items.issues.title'),
      desc: t('items.issues.desc'),
      icon: <Bug className="size-4" />,
      buttonName: t('items.issues.buttonName')
    },
    {
      id: "discussions",
      url: "https://github.com/Ye-hey1/note-gen/discussions",
      title: t('items.discussions.title'),
      desc: t('items.discussions.desc'),
      icon: <MessageSquare className="size-4" />,
      buttonName: t('items.discussions.buttonName')
    }
  ]

  return (
    <SettingType id={id} icon={icon} title={t('title')} desc={t('desc')}>
      <Updater />
      <ItemGroup className="gap-4 pt-8">
        {
          items.map(item => <AboutItem key={item.id} {...item} />)
        }
      </ItemGroup>
    </SettingType>
  )
}

function AboutItem({url, title, desc, icon, buttonName}: {url: string, title: string, desc?: string, icon?: React.ReactNode, buttonName?: string}) {
  const openInBrowser = () => {
    open(url);
  }
  return <Item variant="outline">
    <ItemMedia variant="icon">{icon}</ItemMedia>
    <ItemContent>
      <ItemTitle>{title}</ItemTitle>
      {desc && <ItemDescription>{desc}</ItemDescription>}
    </ItemContent>
    <ItemActions>
      <Button variant="outline" onClick={openInBrowser}>{buttonName}</Button>
    </ItemActions>
  </Item>
}
