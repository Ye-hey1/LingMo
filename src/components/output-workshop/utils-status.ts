

export function getStatusText(status: string): string {
  switch (status) {
    case "generating":
      return "分析中"
    case "streaming":
      return "生成中"
    case "done":
      return "已就绪"
    case "error":
      return "有错误"
    default:
      return "待构建"
  }
}
