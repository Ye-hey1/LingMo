/**
 * 内置可配置源定义
 * 这些源在首次加载时会写入 user_feeds 表，用户可以增删改、开关
 */

export type BuiltinSourceType = 'rss' | 'wechat-rss' | 'newsnow' | 'buzzing' | 'zeli' | 'techurls'

export interface BuiltinSource {
  /** 唯一标识，用于数据库 key */
  id: string
  /** 显示名称 */
  title: string
  /** 源类型 */
  type: BuiltinSourceType
  /** RSS 地址或 API 地址 */
  url: string
  /** 分类 */
  category: string
  /** 是否默认启用 */
  defaultEnabled: boolean
  /** 是否为核心官方源 */
  core: boolean
}

/** 核心官方源 - 默认启用，也可在信源库中自由管理 */
export const CORE_SOURCES: BuiltinSource[] = [
  {
    id: 'ai-hot-rss-featured',
    title: 'AI HOT 精选',
    type: 'rss',
    url: 'https://aihot.virxact.com/feed.xml',
    category: '核心',
    defaultEnabled: true,
    core: true,
  },
  {
    id: 'ai-hot-rss-all',
    title: 'AI HOT 全部动态',
    type: 'rss',
    url: 'https://aihot.virxact.com/feed/all.xml',
    category: '核心',
    defaultEnabled: true,
    core: true,
  },
  {
    id: 'ai-hot-rss-daily',
    title: 'AI HOT 日报',
    type: 'rss',
    url: 'https://aihot.virxact.com/feed/daily.xml',
    category: '核心',
    defaultEnabled: true,
    core: true,
  },
]

/** 可配置的内置源 - 用户可增删改、开关 */
export const CONFIGURABLE_SOURCES: BuiltinSource[] = [
  // ===== 聚合平台 =====
  {
    id: 'newsnow',
    title: 'NewsNow 聚合',
    type: 'newsnow',
    url: 'https://newsnow.busiyi.world/api/s/entire',
    category: '聚合平台',
    defaultEnabled: true,
    core: false,
  },
  {
    id: 'buzzing',
    title: 'Buzzing 热榜',
    type: 'buzzing',
    url: 'https://www.buzzing.cc/feed.json',
    category: '聚合平台',
    defaultEnabled: true,
    core: false,
  },
  {
    id: 'zeli-hn',
    title: 'Zeli HN 24h',
    type: 'zeli',
    url: 'https://zeli.app/api/hacker-news?type=hot24h',
    category: '聚合平台',
    defaultEnabled: true,
    core: false,
  },
  {
    id: 'techurls',
    title: 'TechURLs',
    type: 'techurls',
    url: 'https://techurls.com/',
    category: '聚合平台',
    defaultEnabled: true,
    core: false,
  },
  // ===== 中文科技 RSS =====
  {
    id: 'ithome-rss',
    title: 'IT之家',
    type: 'rss',
    url: 'https://www.ithome.com/rss/',
    category: '中文科技',
    defaultEnabled: true,
    core: false,
  },
  {
    id: 'huxiu-rss',
    title: '虎嗅',
    type: 'rss',
    url: 'https://rsshub.app/huxiu/article',
    category: '中文科技',
    defaultEnabled: true,
    core: false,
  },
  {
    id: '36kr-rss',
    title: '36氪快讯',
    type: 'rss',
    url: 'https://rsshub.app/36kr/newsflashes',
    category: '中文科技',
    defaultEnabled: true,
    core: false,
  },
  {
    id: 'sspai-rss',
    title: '少数派',
    type: 'rss',
    url: 'https://sspai.com/feed',
    category: '中文科技',
    defaultEnabled: true,
    core: false,
  },
  // ===== 微信公众号 - AI =====
  {
    id: 'wx-jiqizhixin',
    title: '机器之心',
    type: 'wechat-rss',
    url: 'https://decemberpei.cyou/rssbox/wechat-jiqizhixin.xml',
    category: '公众号·AI',
    defaultEnabled: true,
    core: false,
  },
  {
    id: 'wx-liangziwei',
    title: '量子位',
    type: 'wechat-rss',
    url: 'https://decemberpei.cyou/rssbox/wechat-liangziwei.xml',
    category: '公众号·AI',
    defaultEnabled: true,
    core: false,
  },
  {
    id: 'wx-xinzhiyuan',
    title: '新智元',
    type: 'wechat-rss',
    url: 'https://decemberpei.cyou/rssbox/wechat-xinzhiyuan.xml',
    category: '公众号·AI',
    defaultEnabled: true,
    core: false,
  },
  {
    id: 'wx-shenkeji',
    title: 'DeepTech深科技',
    type: 'wechat-rss',
    url: 'https://decemberpei.cyou/rssbox/wechat-shenkeji.xml',
    category: '公众号·AI',
    defaultEnabled: true,
    core: false,
  },
  {
    id: 'wx-aiqianxian',
    title: 'AI前线',
    type: 'wechat-rss',
    url: 'https://decemberpei.cyou/rssbox/wechat-aiqianxian.xml',
    category: '公众号·AI',
    defaultEnabled: true,
    core: false,
  },
  {
    id: 'wx-xixiaoyao',
    title: '夕小瑶科技说',
    type: 'wechat-rss',
    url: 'https://decemberpei.cyou/rssbox/wechat-xixiaoyaokejishuo.xml',
    category: '公众号·AI',
    defaultEnabled: true,
    core: false,
  },
  {
    id: 'wx-jiaziguangnian',
    title: '甲子光年',
    type: 'wechat-rss',
    url: 'https://decemberpei.cyou/rssbox/wechat-jiaziguangnian.xml',
    category: '公众号·AI',
    defaultEnabled: true,
    core: false,
  },
  // ===== 微信公众号 - 科技媒体 =====
  {
    id: 'wx-36ke',
    title: '36氪',
    type: 'wechat-rss',
    url: 'https://decemberpei.cyou/rssbox/wechat-36ke.xml',
    category: '公众号·科技',
    defaultEnabled: true,
    core: false,
  },
  {
    id: 'wx-36kepro',
    title: '36氪Pro',
    type: 'wechat-rss',
    url: 'https://decemberpei.cyou/rssbox/wechat-sanliukepro.xml',
    category: '公众号·科技',
    defaultEnabled: true,
    core: false,
  },
  {
    id: 'wx-huxiu',
    title: '虎嗅App',
    type: 'wechat-rss',
    url: 'https://decemberpei.cyou/rssbox/wechat-huxiuapp.xml',
    category: '公众号·科技',
    defaultEnabled: true,
    core: false,
  },
  {
    id: 'wx-jikegongyuan',
    title: '极客公园',
    type: 'wechat-rss',
    url: 'https://decemberpei.cyou/rssbox/wechat-jikegongyuan.xml',
    category: '公众号·科技',
    defaultEnabled: true,
    core: false,
  },
  {
    id: 'wx-shaoshupai',
    title: '少数派',
    type: 'wechat-rss',
    url: 'https://decemberpei.cyou/rssbox/wechat-shaoshupai.xml',
    category: '公众号·科技',
    defaultEnabled: true,
    core: false,
  },
  {
    id: 'wx-appso',
    title: 'APPSO',
    type: 'wechat-rss',
    url: 'https://decemberpei.cyou/rssbox/wechat-appso.xml',
    category: '公众号·科技',
    defaultEnabled: true,
    core: false,
  },
  {
    id: 'wx-anfaner',
    title: '爱范儿',
    type: 'wechat-rss',
    url: 'https://decemberpei.cyou/rssbox/wechat-anfaner.xml',
    category: '公众号·科技',
    defaultEnabled: true,
    core: false,
  },
  {
    id: 'wx-chaping',
    title: '差评',
    type: 'wechat-rss',
    url: 'https://decemberpei.cyou/rssbox/wechat-chaping.xml',
    category: '公众号·科技',
    defaultEnabled: true,
    core: false,
  },
  {
    id: 'wx-taimeiti',
    title: '钛媒体',
    type: 'wechat-rss',
    url: 'https://decemberpei.cyou/rssbox/wechat-taimeiti.xml',
    category: '公众号·科技',
    defaultEnabled: true,
    core: false,
  },
  {
    id: 'wx-wandian',
    title: '晚点LatePost',
    type: 'wechat-rss',
    url: 'https://decemberpei.cyou/rssbox/wechat-wandian.xml',
    category: '公众号·科技',
    defaultEnabled: true,
    core: false,
  },
  // ===== 微信公众号 - 技术 =====
  {
    id: 'wx-infoq',
    title: 'InfoQ',
    type: 'wechat-rss',
    url: 'https://decemberpei.cyou/rssbox/wechat-infoq.xml',
    category: '公众号·技术',
    defaultEnabled: true,
    core: false,
  },
  {
    id: 'wx-tengxun',
    title: '腾讯技术工程',
    type: 'wechat-rss',
    url: 'https://decemberpei.cyou/rssbox/wechat-tengxunjishugongcheng.xml',
    category: '公众号·技术',
    defaultEnabled: true,
    core: false,
  },
  {
    id: 'wx-githubdaily',
    title: 'GitHubDaily',
    type: 'wechat-rss',
    url: 'https://decemberpei.cyou/rssbox/wechat-githubdaily.xml',
    category: '公众号·技术',
    defaultEnabled: true,
    core: false,
  },
  // ===== 微信公众号 - 财经 =====
  {
    id: 'wx-huaerjie',
    title: '华尔街见闻',
    type: 'wechat-rss',
    url: 'https://decemberpei.cyou/rssbox/wechat-huaerjiejianwen.xml',
    category: '公众号·财经',
    defaultEnabled: true,
    core: false,
  },
  {
    id: 'wx-caijing',
    title: '财经杂志',
    type: 'wechat-rss',
    url: 'https://decemberpei.cyou/rssbox/wechat-caijingzazhi.xml',
    category: '公众号·财经',
    defaultEnabled: true,
    core: false,
  },
  {
    id: 'wx-diyicaijing',
    title: '第一财经YiMagazine',
    type: 'wechat-rss',
    url: 'https://decemberpei.cyou/rssbox/wechat-diyicaijing.xml',
    category: '公众号·财经',
    defaultEnabled: true,
    core: false,
  },
  // ===== 微信公众号 - 个人/产品 =====
  {
    id: 'wx-liurun',
    title: '刘润',
    type: 'wechat-rss',
    url: 'https://decemberpei.cyou/rssbox/wechat-liurun.xml',
    category: '公众号·其他',
    defaultEnabled: true,
    core: false,
  },
  {
    id: 'wx-lanxi',
    title: '阑夕',
    type: 'wechat-rss',
    url: 'https://decemberpei.cyou/rssbox/wechat-lanxi.xml',
    category: '公众号·其他',
    defaultEnabled: true,
    core: false,
  },
  {
    id: 'wx-woshipm',
    title: '人人都是产品经理',
    type: 'wechat-rss',
    url: 'https://decemberpei.cyou/rssbox/wechat-woshipm.xml',
    category: '公众号·其他',
    defaultEnabled: true,
    core: false,
  },
]

/** 所有内置源（核心 + 可配置） */
export const ALL_BUILTIN_SOURCES: BuiltinSource[] = [
  ...CORE_SOURCES,
  ...CONFIGURABLE_SOURCES,
]

/** 获取内置源的 user_feed group 名称 */
export function getBuiltinSourceGroupId(type: BuiltinSourceType): string {
  return `builtin:${type}`
}
