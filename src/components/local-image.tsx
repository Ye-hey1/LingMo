'use client'
import Image from "next/image"
import React, { useState } from "react";
import { convertImage } from '@/lib/utils'

export function LocalImage({ onLoad, src, ...props }: React.ComponentProps<typeof Image>) {
  const [localSrc, setLocalSrc] = useState<string>('')

  async function getAppDataDir() {
    if (src.toString().includes('http')) {
      setLocalSrc(src.toString())
    } else {
      const covertFileSrcPath = await convertImage(src as string)
      setLocalSrc(covertFileSrcPath)
    }
  }

  React.useEffect(() => {
    getAppDataDir()
  }, [src])

  // 如果 loaclSrc 存在
  return (
    localSrc ?
    <Image onLoad={onLoad} src={localSrc} alt="" width={0} height={0} className={props.className} style={props.style} /> :
    null
  )
}
