import { DocsShell } from '@/components/docs-shell'
import { Callout } from '@/components/callout'

export default function DeployPage() {
  return (
    <DocsShell currentPath="/deploy">
      <h1>通过 Vercel 部署文档站</h1>
      <p>这个文档站位于仓库的 <code>docs</code> 目录，是一个独立的静态 Next.js 项目。部署时建议只部署 <code>docs</code>，不要把桌面主程序直接作为线上网站发布。</p>

      <h2>本地验证</h2>
      <pre><code>{`pnpm install
pnpm --filter lingmo-docs build`}</code></pre>
      <p>根目录也提供了脚本：</p>
      <pre><code>{`pnpm docs:build`}</code></pre>

      <h2>在 Vercel 创建项目</h2>
      <ol>
        <li>打开 Vercel，选择 <strong>Add New → Project</strong>。</li>
        <li>导入 LingMo 的 GitHub 仓库。</li>
        <li>在项目设置中把 <strong>Root Directory</strong> 设置为 <code>docs</code>。</li>
        <li>Framework Preset 选择 <strong>Next.js</strong>。</li>
        <li>Build Command 使用 <code>pnpm build</code>。</li>
        <li>Output Directory 使用 <code>out</code>。</li>
      </ol>

      <h2>绑定 lingmonote.cc.cd</h2>
      <ol>
        <li>进入 Vercel 项目，打开 <strong>Settings → Domains</strong>。</li>
        <li>添加域名 <code>lingmonote.cc.cd</code>。</li>
        <li>根据 Vercel 给出的提示到域名 DNS 后台添加记录。</li>
        <li>如果绑定的是根域名，通常需要配置 A 记录；如果绑定的是子域名，通常配置 CNAME。</li>
        <li>等待 DNS 生效后，Vercel 会自动签发 HTTPS 证书。</li>
      </ol>

      <Callout title="DNS 记录以 Vercel 后台为准" tone="warning">
        <p>不同域名服务商和域名类型的 DNS 记录可能不同。请以 Vercel 添加域名后显示的记录为最终依据，不要凭固定模板硬填。</p>
      </Callout>

      <h2>建议的生产设置</h2>
      <table>
        <thead>
          <tr><th>项目</th><th>建议值</th></tr>
        </thead>
        <tbody>
          <tr><td>Root Directory</td><td><code>docs</code></td></tr>
          <tr><td>Install Command</td><td><code>pnpm install</code></td></tr>
          <tr><td>Build Command</td><td><code>pnpm build</code></td></tr>
          <tr><td>Output Directory</td><td><code>out</code></td></tr>
          <tr><td>Node.js Version</td><td>建议使用 Vercel 当前 LTS 默认版本。</td></tr>
        </tbody>
      </table>

      <h2>上线检查</h2>
      <ul>
        <li>首页能打开，左侧导航能跳转。</li>
        <li><code>/quick-start/</code>、<code>/capture/</code>、<code>/deploy/</code> 等页面返回 200。</li>
        <li>移动端布局可阅读，导航不遮挡正文。</li>
        <li>域名显示 HTTPS 证书正常。</li>
        <li>GitHub 链接、部署说明和下载入口指向正确。</li>
      </ul>
    </DocsShell>
  )
}
