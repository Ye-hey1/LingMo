

export function getStatusText(status: string): string {
  switch (status) {
    case "generating":
      return "处理中"
    case "streaming":
      return "生成中"
    case "done":
      return "已完成"
    case "error":
      return "生成失败"
    default:
      return "空闲"
  }
}
