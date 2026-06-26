const LATIN_TOPIC_ALLOWLIST = new Set([
  'ai',
  'api',
  'agent',
  'bm25',
  'css',
  'db',
  'gpt',
  'html',
  'js',
  'llm',
  'mcp',
  'ml',
  'next',
  'nlp',
  'pm',
  'rag',
  'react',
  'sql',
  'tauri',
  'ts',
  'ui',
  'ux',
]);

const TOPIC_STOP_WORDS = new Set([
  'a',
  'an',
  'and',
  'are',
  'as',
  'at',
  'be',
  'been',
  'but',
  'by',
  'can',
  'do',
  'for',
  'from',
  'had',
  'has',
  'have',
  'in',
  'is',
  'it',
  'of',
  'on',
  'or',
  'that',
  'the',
  'this',
  'to',
  'was',
  'were',
  'with',
  'you',
  'your',
  '一个',
  '一种',
  '以及',
  '就是',
  '可以',
  '进行',
  '通过',
  '基于',
  '关于',
  '这个',
  '这些',
  '那些',
  '如果',
  '因为',
  '所以',
  '但是',
  '然后',
  '我们',
  '你们',
  '他们',
  '它们',
  '自己',
  '什么',
  '笔记',
  '内容',
  '文章',
  '文件',
  '项目',
  '功能',
  '页面',
  '模块',
  '部分',
  '方法',
  '问题',
  '场景',
  '模式',
  '流程',
  '策略',
]);

const STRUCTURAL_NOISE_WORDS = new Set([
  'app',
  'aria',
  'blog',
  'button',
  'chunk',
  'chunks',
  'class',
  'click',
  'com',
  'const',
  'csdn',
  'data',
  'demo',
  'div',
  'edge',
  'edges',
  'false',
  'file',
  'filename',
  'folder',
  'function',
  'get',
  'href',
  'http',
  'https',
  'img',
  'input',
  'interface',
  'item',
  'items',
  'jpeg',
  'jpg',
  'json',
  'jsx',
  'let',
  'lib',
  'link',
  'linked',
  'links',
  'md',
  'node',
  'nodes',
  'null',
  'output',
  'params',
  'path',
  'png',
  'post',
  'props',
  'query',
  'return',
  'result',
  'results',
  'set',
  'source',
  'sources',
  'src',
  'state',
  'status',
  'store',
  'target',
  'targets',
  'test',
  'todo',
  'true',
  'tsx',
  'type',
  'undefined',
  'uri',
  'url',
  'value',
  'values',
  'var',
  'wiki-link',
  'wikilink',
  'www',
]);

const URL_PATTERN = /https?:\/\/[^\s<>)\]]+|www\.[^\s<>)\]]+|[a-z0-9-]+(?:\.[a-z0-9-]+)+(?:\/[^\s<>)\]]*)?/gi;
const DOMAIN_FRAGMENT_PATTERN = /^(?:[a-z0-9-]+\.)+[a-z]{2,}(?:\/.*)?$|^[a-z]{2,10}\/.*$|.*\/[a-z0-9._-]+.*$/i;
const CODEISH_PATTERN = /^(?:data|aria|on|use)[-_a-z0-9]+$/i;

const UI_OBJECT_TOKENS = new Set([
  '按钮',
  '图标',
  '弹窗',
  '面板',
  '抽屉',
  '工具栏',
  '菜单',
  '选项',
  '输入框',
  '文本框',
  '卡片',
  '边框',
  '底纹',
  '阴影',
  '字号',
  '字体',
]);

const STATE_TOKENS = new Set([
  '状态',
  '模式',
  '颜色',
  '灰色',
  '蓝色',
  '红色',
  '绿色',
  '开启',
  '关闭',
  '打开',
  '隐藏',
  '显示',
  '选中',
  '禁用',
  '启用',
  '悬浮',
  '点击',
]);

const PREDICATE_TOKENS = new Set([
  '处于',
  '当前',
  '默认',
  '已经',
  '正在',
  '是否',
  '不能',
  '不要',
  '没有',
  '还是',
  '进入',
  '退出',
  '拖动',
  '滚动',
  '缩放',
]);

const AFFECT_TOKENS = new Set([
  '惊讶',
  '开心',
  '难过',
  '愤怒',
  '恐惧',
  '表情',
]);

const CHINESE_CONCEPT_SUFFIX_PATTERN =
  /(?:模型|系统|架构|算法|策略|机制|原则|流程|知识|数据|向量|语义|检索|产品|用户|体验|设计|自动化|智能|代理|协作|管理|研究|技术|模式|方法|框架|网络|数据库|工具|平台|生态|理论|任务|问题|指标|能力|场景|趋势|记忆|图谱|应用|实践|范式|协议|标准|工程|组件|服务)$/;

const CHINESE_CONCEPT_TOKEN_PATTERN =
  /(?:模型|系统|架构|算法|策略|机制|原则|流程|知识|数据|向量|语义|检索|产品|用户|体验|设计|自动化|智能|代理|协作|管理|研究|技术|模式|方法|框架|网络|数据库|工具|平台|生态|理论|任务|问题|指标|能力|场景|趋势|记忆|图谱|应用|实践|范式|协议|标准|工程|组件|服务|学习)/g;

const CHINESE_TOPIC_BRIDGE_NOISE_PATTERN =
  /(?:路径|指南|教程|说明|概述|核心|优势|指标|能力|表现|质量|效率|基础|单元|章节|案例|分析|训练|泛化|并行化)/;

const VALID_DISCIPLINE_TOPIC_PATTERN =
  /(?:机器学习|深度学习|强化学习|迁移学习|监督学习|无监督学习|自监督学习|元学习|心理学|经济学|语言学|统计学|数学|哲学|社会学|传播学|管理学|教育学|认知科学|数据科学|计算机科学|信息科学)$/;

const ACCIDENTAL_DISCIPLINE_SUFFIXES = [
  '模型',
  '图谱',
  '架构',
  '系统',
  '数据',
  '技术',
  '网络',
  '平台',
  '工具',
  '组件',
  '服务',
  '流程',
  '策略',
  '向量',
  '语义',
  '检索',
  '代理',
  '智能',
  '算法',
  '框架',
  '数据库',
  '产品',
  '用户',
  '体验',
  '设计',
] as const;

const CHINESE_FRAGMENT_PATTERN =
  /^(?:的|式|性|型|类|种|个|项|些|年|月|日|在|于|从|由|被|将|对|把|让|使|为|以|其|这|那|该|本|处于|当前|默认|自动|手动)|(?:的|地|得|和|与|及|或|并|但)$/;

const CHINESE_PREDICATE_FRAGMENT_PATTERN =
  /(?:被(?:视为|认为|称为|用于|用于)|被|把|使|让|将|是|为|成为|作为|意味着|表现为|呈现|出现|导致|用于|来自|来源于|属于|不是|而是|就是|也是|则是|仍是|已是|具有|选择|采样|生成|发布|失效|支持|需要|可以|能够|应该|位于|处于)/;

const CHINESE_TEMPORAL_PREFIX_PATTERN =
  /^(?:\d{2,4}年|[一二三四五六七八九十]{1,4}年|年|月|日|今天|昨日|明天|当前|现在|过去|未来)/;

const CHINESE_LEADING_FUNCTION_PATTERN =
  /^(?:在|于|从|由|被|将|对|把|让|使|为|以|其|这|那|该|本|等|当|若|如果|因为|所以|通过|基于|关于|针对)/;

const CHINESE_BOUNDARY_NOISE_PATTERN =
  /(?:的|地|得|和|与|及|或|并|但|而|了|着)$/;

const CHINESE_GENERIC_MODIFIER_PATTERN =
  /^(?:等|各类|各种|多种|多个|若干|一些|一类|一种|其他|更多|全部|所有|主要|主流|常见|典型|具体|相关|有关|整体|通用|有效|当前|现有|上述|以下|这种|这些|那些)/;

const CHINESE_GENERIC_SHELL_PATTERN =
  /(?:方法|问题|场景|模式|流程|策略|内容|部分|方面|情况|东西|事项|类型|类别)$/;

const CANONICAL_CHINESE_CONCEPT_PATTERN =
  /^(?:[A-Za-z0-9+#.-]{1,12})?[\u4e00-\u9fa5]{2,12}(?:模型|系统|架构|算法|策略|机制|原则|流程|知识|数据|向量|语义|检索|产品|用户|体验|设计|自动化|智能|代理|协作|管理|研究|技术|模式|方法|框架|网络|数据库|工具|平台|生态|理论|任务|问题|指标|能力|场景|趋势|记忆|图谱|心理|认知|价值|哲学|应用|实践|范式|协议|标准|工程|组件|服务)$/;

const CANONICAL_SHORT_CONCEPT_PATTERN =
  /^(?:[A-Za-z0-9+#.-]{1,12})?[\u4e00-\u9fa5]{2,6}(?:学|论|法|术|器|库|链|流|图|谱|栈|层|端|云|脑|网)$/;

const LATIN_PREFIX_COMPACT_CONCEPT_PATTERN =
  /^(?:[A-Za-z0-9+#.-]{1,12})(?:模型|系统|架构|算法|策略|流程|知识|数据|向量|语义|检索|产品|用户|体验|设计|智能|代理|技术|网络|工具|平台|图谱|应用|工程|组件|服务)$/;

export function stripKnowledgeNoise(content: string): string {
  if (!content) return '';

  return content
    .replace(/^---[\s\S]*?---\s*/m, ' ')
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/!\[([^\]]*)]\([^)]*\)/g, '$1 ')
    .replace(/\[([^\]]+)]\([^)]*\)/g, '$1 ')
    .replace(/\[\[([^\]|]+)\|([^\]]+)]]/g, '$2 ')
    .replace(/\[\[([^\]]+)]]/g, '$1 ')
    .replace(URL_PATTERN, ' ')
    .replace(/`[^`]*`/g, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&(?:nbsp|amp|lt|gt|quot);/gi, ' ')
    .replace(/[|*_~#>=[\]{}()<>]/g, ' ')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

export function prepareKnowledgeIndexText(content: string): string {
  return stripKnowledgeNoise(content)
    .replace(/[^\S\r\n]+/g, ' ')
    .replace(/\n[ \t]+/g, '\n')
    .trim();
}

export function normalizeKnowledgeTopic(keyword: string): string {
  let normalized = stripKnowledgeNoise(keyword)
    .replace(/^[\s#>*\-+.,，。:：;；'"“”‘’/\\]+/, '')
    .replace(/[\s#>*\-+.,，。:：;；'"“”‘’/\\]+$/, '')
    .replace(/[`"'“”‘’()[\]{}<>]/g, '')
    .replace(/\s+/g, ' ')
    .trim();

  if (!normalized) return '';
  normalized = normalizeAccidentalDisciplineSuffix(normalized);
  return /^[A-Z0-9+\-.#]+$/.test(normalized) ? normalized.toLowerCase() : normalized;
}

function findAccidentalDisciplineSuffix(keyword: string) {
  if (VALID_DISCIPLINE_TOPIC_PATTERN.test(keyword)) return null;

  if (keyword.endsWith('学习')) {
    const stem = keyword.slice(0, -2);
    const suffix = ACCIDENTAL_DISCIPLINE_SUFFIXES.find(item => stem.endsWith(item));
    if (!suffix) return null;

    const prefix = stem.slice(0, -suffix.length);
    return { stem, prefix, suffix };
  }

  if (!keyword.endsWith('学')) return null;

  const stem = keyword.slice(0, -1);
  const suffix = ACCIDENTAL_DISCIPLINE_SUFFIXES.find(item => stem.endsWith(item));
  if (!suffix) return null;

  const prefix = stem.slice(0, -suffix.length);
  return { stem, prefix, suffix };
}

function normalizeAccidentalDisciplineSuffix(keyword: string) {
  const match = findAccidentalDisciplineSuffix(keyword);
  if (!match?.prefix) return keyword;

  // TextRank can merge a topical noun with the trailing "学" from "学习/学科".
  // Keep the domain concept itself so stale DB rows such as "AI模型学" render as "AI模型".
  if (/[A-Za-z0-9]/.test(match.prefix) || /[\u4e00-\u9fa5]{2,}/.test(match.prefix)) {
    return match.stem;
  }

  return keyword;
}

function countTokenHits(keyword: string, tokens: Set<string>) {
  let count = 0;
  for (const token of tokens) {
    if (keyword.includes(token)) count++;
  }
  return count;
}

function looksLikeUiStateDescription(keyword: string) {
  const uiHits = countTokenHits(keyword, UI_OBJECT_TOKENS);
  const stateHits = countTokenHits(keyword, STATE_TOKENS);
  const predicateHits = countTokenHits(keyword, PREDICATE_TOKENS);

  if (uiHits > 0 && (stateHits > 0 || predicateHits > 0)) return true;
  if (stateHits >= 2 && keyword.length <= 8) return true;
  if (predicateHits > 0 && stateHits > 0 && keyword.length <= 10) return true;
  return false;
}

function looksLikeAccidentalPhraseMerge(keyword: string) {
  const stateHits = countTokenHits(keyword, STATE_TOKENS) + countTokenHits(keyword, PREDICATE_TOKENS);
  const affectHits = countTokenHits(keyword, AFFECT_TOKENS);
  const uiHits = countTokenHits(keyword, UI_OBJECT_TOKENS);

  if (affectHits > 0 && (stateHits > 0 || uiHits > 0)) return true;
  if (keyword.length >= 5 && /(?:自动|手动|默认|当前|处于|显示|隐藏|打开|关闭)/.test(keyword) && affectHits > 0) return true;
  return false;
}

function looksLikeSentenceFragment(keyword: string) {
  if (!/[\u4e00-\u9fa5]/.test(keyword)) return false;
  if (CHINESE_FRAGMENT_PATTERN.test(keyword)) return true;
  if (CHINESE_TEMPORAL_PREFIX_PATTERN.test(keyword)) return true;
  if (CHINESE_LEADING_FUNCTION_PATTERN.test(keyword)) return true;
  if (CHINESE_BOUNDARY_NOISE_PATTERN.test(keyword)) return true;
  if (CHINESE_PREDICATE_FRAGMENT_PATTERN.test(keyword)) return true;
  if (/^[\u4e00-\u9fa5]{1,3}(?:是|为|被|在|于|从|由)/.test(keyword)) return true;
  if (keyword.includes('的') && keyword.length <= 6) return true;
  return false;
}

function looksLikeGenericConceptShell(keyword: string) {
  if (!/[\u4e00-\u9fa5]/.test(keyword)) return false;
  if (CHINESE_GENERIC_MODIFIER_PATTERN.test(keyword)) return true;
  if (keyword.length <= 4 && CHINESE_GENERIC_SHELL_PATTERN.test(keyword)) return true;
  if (keyword.length <= 6 && /(?:主流|常见|相关|具体|有效|通用|主要)/.test(keyword) && CHINESE_GENERIC_SHELL_PATTERN.test(keyword)) {
    return true;
  }
  return false;
}

function looksLikeMalformedDisciplineConcept(keyword: string) {
  return Boolean(findAccidentalDisciplineSuffix(keyword));
}

function looksLikeOverMergedChineseTopic(keyword: string) {
  if (!/[\u4e00-\u9fa5]/.test(keyword)) return false;
  const compact = keyword.replace(/[A-Za-z0-9+#.-]/g, '');
  if (compact.length <= 8) return false;

  const conceptHits = compact.match(CHINESE_CONCEPT_TOKEN_PATTERN)?.length ?? 0;
  if (conceptHits >= 2 && CHINESE_TOPIC_BRIDGE_NOISE_PATTERN.test(compact)) return true;
  if (conceptHits >= 4 && compact.length >= 12) return true;
  return false;
}

function isCanonicalChineseConcept(keyword: string) {
  if (!/[\u4e00-\u9fa5]/.test(keyword)) return true;
  if (VALID_DISCIPLINE_TOPIC_PATTERN.test(keyword)) return true;
  if (LATIN_PREFIX_COMPACT_CONCEPT_PATTERN.test(keyword)) return true;
  if (looksLikeSentenceFragment(keyword)) return false;
  if (looksLikeGenericConceptShell(keyword)) return false;
  if (looksLikeMalformedDisciplineConcept(keyword)) return false;
  if (looksLikeOverMergedChineseTopic(keyword)) return false;
  if (keyword.length <= 4) return !/[的是在被为于从由把让使将]/.test(keyword);
  if (CANONICAL_SHORT_CONCEPT_PATTERN.test(keyword)) return true;
  return CANONICAL_CHINESE_CONCEPT_PATTERN.test(keyword);
}

export function isNoisyKnowledgeTopic(keyword: string): boolean {
  const normalized = normalizeKnowledgeTopic(keyword);
  if (!normalized) return true;

  const lower = normalized.toLowerCase();
  const hasChinese = /[\u4e00-\u9fa5]/.test(normalized);

  if (STRUCTURAL_NOISE_WORDS.has(lower)) return true;
  if (TOPIC_STOP_WORDS.has(lower) || TOPIC_STOP_WORDS.has(normalized)) return true;
  if (looksLikeUiStateDescription(normalized)) return true;
  if (looksLikeAccidentalPhraseMerge(normalized)) return true;
  if (hasChinese && looksLikeSentenceFragment(normalized)) return true;
  if (hasChinese && looksLikeGenericConceptShell(normalized)) return true;
  if (hasChinese && !isCanonicalChineseConcept(normalized)) return true;
  if (CODEISH_PATTERN.test(normalized)) return true;
  if (DOMAIN_FRAGMENT_PATTERN.test(normalized)) return true;
  if (/[\\/]/.test(normalized)) return true;
  if (/^(?:html?|s?html|php|aspx?|jpeg|jpg|png|gif|webp|svg|pdf|zip)$/i.test(normalized)) return true;
  if (/^\d+(?:[.,]\d+)*$/.test(normalized)) return true;
  if (/^[^\u4e00-\u9fa5a-z0-9]+$/i.test(normalized)) return true;
  if (/^[a-z]$/i.test(normalized)) return true;
  if (/^[a-z0-9_+\-.#]+$/i.test(normalized) && normalized.length <= 5 && !LATIN_TOPIC_ALLOWLIST.has(lower)) return true;
  if (!hasChinese && /^[a-z]{1,8}$/i.test(normalized) && !LATIN_TOPIC_ALLOWLIST.has(lower)) return true;
  if (hasChinese && normalized.length <= 1) return true;
  if (hasChinese && /^(?:的|了|是|在|有|和|与|或|等|及|对|把|被|让|给)$/.test(normalized)) return true;

  return false;
}

export function isUsefulKnowledgeTopic(keyword: string): boolean {
  const normalized = normalizeKnowledgeTopic(keyword);
  if (!normalized) return false;
  if (normalized.length < 2 || normalized.length > 28) return false;
  if (isNoisyKnowledgeTopic(normalized)) return false;
  if (!/[\u4e00-\u9fa5a-z0-9]/i.test(normalized)) return false;
  return true;
}

export function topicQualityScore(keyword: string): number {
  const normalized = normalizeKnowledgeTopic(keyword);
  if (!isUsefulKnowledgeTopic(normalized)) return 0;

  const chineseChars = (normalized.match(/[\u4e00-\u9fa5]/g) ?? []).length;
  const latinChars = (normalized.match(/[a-z0-9]/gi) ?? []).length;
  let score = 1;

  if (chineseChars >= 2) score += 0.45;
  if (chineseChars >= 4) score += 0.2;
  if (
    CANONICAL_CHINESE_CONCEPT_PATTERN.test(normalized) ||
    CANONICAL_SHORT_CONCEPT_PATTERN.test(normalized) ||
    LATIN_PREFIX_COMPACT_CONCEPT_PATTERN.test(normalized) ||
    VALID_DISCIPLINE_TOPIC_PATTERN.test(normalized)
  ) score += 0.45;
  if (latinChars > 0 && LATIN_TOPIC_ALLOWLIST.has(normalized.toLowerCase())) score += 0.55;
  if (/[-_.#]/.test(normalized)) score -= 0.25;
  if (/^(?:\w+\s+){2,}\w+$/i.test(normalized)) score -= 0.15;

  return Math.max(0.1, score);
}

export function extractKnowledgeTopicCandidates(
  content: string,
  title = '',
): Array<{ keyword: string; weight: number }> {
  const text = `${title}\n${stripKnowledgeNoise(content).slice(0, 8000)}`;
  const scores = new Map<string, number>();
  const addCandidate = (raw: string, weight: number) => {
    const keyword = normalizeKnowledgeTopic(raw);
    if (!isUsefulKnowledgeTopic(keyword)) return;
    const titleBonus = title && title.includes(keyword) ? 1.8 : 1;
    scores.set(keyword, (scores.get(keyword) ?? 0) + weight * titleBonus * topicQualityScore(keyword));
  };

  const addStructuredAnchor = (raw: string, weight: number) => {
    const cleaned = raw
      .replace(/^\d+(?:\.\d+)*\s*/, '')
      .replace(/^[#>\-*+\s]+/, '')
      .replace(/\s*[-:：|].*$/, '')
      .trim();
    addCandidate(cleaned, weight);
  };

  for (const match of content.matchAll(/^#{1,4}\s+(.+)$/gm)) {
    addStructuredAnchor(match[1], 2.8);
  }

  for (const match of content.matchAll(/\[\[([^\]|]+)(?:\|[^\]]+)?\]\]/g)) {
    addStructuredAnchor(match[1], 3.2);
  }

  for (const match of content.matchAll(/(?:^|\s)#([\u4e00-\u9fa5A-Za-z0-9_+#.-]{2,24})/g)) {
    addStructuredAnchor(match[1], 2.2);
  }

  for (const match of content.matchAll(/^\s*(?:title|主题|概念|关键词|tags?)\s*[:：]\s*(.+)$/gim)) {
    for (const part of match[1].split(/[,，、;；]/)) {
      addStructuredAnchor(part, 2.4);
    }
  }

  const chineseSegments = text
    .split(/[，。！？；：、\n\r()[\]{}<>《》"'“”‘’|/\\]+/)
    .map(segment => segment.trim())
    .filter(Boolean);

  for (const rawSegment of chineseSegments) {
    const segmentParts = rawSegment
      .split(/\s+/)
      .map(part => part.replace(/[^\u4e00-\u9fa5A-Za-z0-9+#.-]/g, ''))
      .filter(Boolean);

    for (const segment of segmentParts) {
      if (!/[\u4e00-\u9fa5]{2,}/.test(segment)) continue;

      const titleWeight = title.includes(segment) ? 1.35 : 1;
      if (segment.length >= 2 && segment.length <= 8 && CHINESE_CONCEPT_SUFFIX_PATTERN.test(segment)) {
        addCandidate(segment, 1.35 * titleWeight);
      }

      for (const match of segment.matchAll(/[\u4e00-\u9fa5]{2,12}?(?:模型|系统|架构|算法|策略|流程|知识|数据|向量|语义|检索|产品|用户|体验|设计|自动化|智能|代理|协作|管理|研究|技术|模式|方法|框架|网络|数据库|工具|平台|生态|理论|任务|问题|指标|能力|场景|趋势|记忆|图谱)/g)) {
        const phrase = match[0];
        addCandidate(phrase, 1.25 * titleWeight);
      }

      for (const match of segment.matchAll(/(?:AI|RAG|LLM|Agent)?[\u4e00-\u9fa5]{2,6}(?:学习|学|论|法|术|器|库|图|谱|链|流)/gi)) {
        addCandidate(match[0], 1.1 * titleWeight);
      }
    }
  }

  for (const match of text.matchAll(/\b[A-Za-z][A-Za-z0-9+#.-]{1,20}\b/g)) {
    addCandidate(match[0], 0.8);
  }

  return Array.from(scores.entries())
    .map(([keyword, weight]) => ({ keyword, weight }))
    .sort((left, right) => right.weight - left.weight)
    .slice(0, 16);
}

export function cleanKnowledgeSample(content: string, maxLength = 220): string {
  const cleaned = stripKnowledgeNoise(content)
    .split(/\s+/)
    .filter(token => !isNoisyKnowledgeTopic(token))
    .join(' ')
    .trim();
  return cleaned.length > maxLength ? `${cleaned.slice(0, maxLength - 1)}...` : cleaned;
}
