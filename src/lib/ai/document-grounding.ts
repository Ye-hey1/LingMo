export interface DocumentGroundingOptions {
  userInput: string
  hasDocumentContext: boolean
}

export interface DocumentGroundingDecision {
  grounded: boolean
  workspaceAware: boolean
  suppressWebSearch: boolean
  explicitExternalLookup: boolean
  instruction: string
}

const DOCUMENT_REFERENCE_PATTERN =
  /这篇|这个文章|这篇文章|这些文章|这几篇|当前(文章|文档|笔记|文件)?|打开的(文章|文档|笔记|文件)?|本文|本篇|上面|上述|前面|所选|选中|附件|关联(文件|文档)|article|document|note|file|attachment/i

const DOCUMENT_TASK_PATTERN =
  /主要|讲什么|说什么|内容|主题|主旨|大意|摘要|总结|概括|归纳|梳理|提炼|要点|观点|结构|提纲|分析|解释|翻译|改写|润色|评价|对比|引用|来源|出处|summari[sz]e|summary|main\s+(idea|point|content)|about|source|citation/i

const EXPLICIT_EXTERNAL_LOOKUP_PATTERN =
  /联网|上网|网页|互联网|外部(资料|信息|来源)?|搜索|搜一下|查一下|官网|最新|今天|今日|新闻|资讯|动态|web|internet|online|search|browse|look\s+up|official\s+site|latest|news/i

const CASUAL_CHAT_PATTERN =
  /^(你好|您好|哈喽|hello|hi|hey|嗨|在吗|早上好|下午好|晚上好|hi there)[。！!,.，\s]*$/i

const LOCAL_WORKSPACE_PATTERN =
  /工作台|编辑器|当前|打开|这边|这里|笔记|文章|文档|文件|workspace|editor|current|opened|note|document|file/i

export function decideDocumentGrounding(options: DocumentGroundingOptions): DocumentGroundingDecision {
  const query = options.userInput.trim()
  const referencesDocument = DOCUMENT_REFERENCE_PATTERN.test(query)
  const asksDocumentTask = DOCUMENT_TASK_PATTERN.test(query)
  const explicitExternalLookup = EXPLICIT_EXTERNAL_LOOKUP_PATTERN.test(query)
  const grounded = options.hasDocumentContext && referencesDocument && asksDocumentTask
  const workspaceAware = options.hasDocumentContext && (
    grounded ||
    CASUAL_CHAT_PATTERN.test(query) ||
    (LOCAL_WORKSPACE_PATTERN.test(query) && !explicitExternalLookup)
  )
  const suppressWebSearch = workspaceAware && !explicitExternalLookup

  return {
    grounded,
    workspaceAware,
    suppressWebSearch,
    explicitExternalLookup,
    instruction: workspaceAware
      ? [
          '你是小墨，用户的工作伙伴。当前工作台已有打开或关联的文档上下文。',
          '如果用户只是寒暄，请自然回应，并可以轻量说明你看到了工作台中有文章/笔记，询问是否需要总结、梳理要点、改写或继续处理；不要编造文档内容。',
          '如果用户的问题指向当前或已关联文档，请优先且主要依据当前打开的文章、关联文件或选中文本回答；如果这些上下文没有提供足够信息，请明确说明“未读取到足够的当前文章内容”。',
          '除非用户明确要求联网、搜索、查看官网、最新消息或外部资料，不要把网页搜索结果或知识库中不相关的同名页面当作当前文章。',
        ].join('\n')
      : '',
  }
}
