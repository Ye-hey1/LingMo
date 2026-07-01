import type { OutputTemplate, TemplatePreviewTheme } from "@/lib/output-workshop/templates"

function escapeSocialPreviewText(value: string): string {
  return (value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;")
}

function renderSocialMotifCss(theme: TemplatePreviewTheme): string {
  const baseFontBody = theme.fontBody
  const baseFontTitle = theme.fontTitle
  const baseFontMono = theme.fontMono || theme.fontBody

  const shell = `
    * { box-sizing: border-box; }
    html, body { margin: 0; padding: 0; }
    body {
      min-height: 100vh;
      background: radial-gradient(circle at 30% 20%, #efeae0 0%, #d8d4ca 100%);
      font-family: ${baseFontBody};
      display: grid;
      place-items: center;
      padding: 32px;
    }
    .xhs-card {
      width: 360px;
      height: 480px;
      background: ${theme.bg};
      color: ${theme.ink};
      position: relative;
      overflow: hidden;
      box-shadow: 0 24px 48px -16px rgba(20, 16, 12, 0.32), 0 4px 12px rgba(20, 16, 12, 0.08);
      font-family: ${baseFontBody};
    }
    .xhs-card .corner {
      position: absolute;
      top: 16px;
      right: 18px;
      font-family: ${baseFontMono};
      font-size: 10px;
      color: ${theme.muted};
      letter-spacing: 0.06em;
      z-index: 4;
    }
    .xhs-card .tagline {
      position: absolute;
      bottom: 16px;
      left: 18px;
      font-family: ${baseFontMono};
      font-size: 10px;
      color: ${theme.muted};
      letter-spacing: 0.04em;
      z-index: 4;
    }
    .xhs-card .name-en {
      position: absolute;
      bottom: 16px;
      right: 18px;
      font-family: ${baseFontMono};
      font-size: 9px;
      color: ${theme.muted};
      opacity: 0.7;
      letter-spacing: 0.12em;
      text-transform: uppercase;
      z-index: 4;
    }`

  const motifStage: Record<TemplatePreviewTheme['motif'], string> = {
    editorial: `
      .xhs-card { padding: 0; }
      .ed-head {
        position: absolute; top: 60px; left: 28px; right: 28px;
        border-top: 3px solid ${theme.ink};
        border-bottom: 1px solid ${theme.ink};
        padding: 8px 0 6px;
        font-family: ${baseFontMono};
        font-size: 9px;
        letter-spacing: 0.32em;
        color: ${theme.ink};
        text-align: center;
        text-transform: uppercase;
      }
      .ed-title {
        position: absolute; top: 110px; left: 28px; right: 28px;
        font-family: ${baseFontTitle};
        font-weight: 700;
        font-size: 44px;
        line-height: 1.02;
        letter-spacing: -0.02em;
        color: ${theme.ink};
        text-wrap: balance;
      }
      .ed-rule {
        position: absolute; top: 230px; left: 28px;
        width: 36px; height: 2px;
        background: ${theme.accent};
      }
      .ed-cols {
        position: absolute; top: 250px; left: 28px; right: 28px; bottom: 90px;
        display: grid;
        grid-template-columns: 1fr 1px 1fr;
        gap: 14px;
      }
      .ed-col {
        font-family: ${baseFontBody};
        font-size: 10.5px;
        line-height: 1.6;
        color: ${theme.ink};
      }
      .ed-col b {
        float: left;
        font-family: ${baseFontTitle};
        font-size: 38px;
        line-height: 0.85;
        margin: 4px 6px 0 0;
        color: ${theme.accent};
        font-weight: 700;
      }
      .ed-divider { background: #e4e0d7; }
      .ed-quote {
        position: absolute; bottom: 56px; left: 28px; right: 28px;
        border-top: 1px solid #e4e0d7;
        padding-top: 12px;
        font-family: ${baseFontTitle};
        font-style: italic;
        font-size: 13px;
        line-height: 1.4;
        color: ${theme.muted};
      }`,

    'terminal-dark': `
      .xhs-card { padding: 0; }
      .xhs-card::before {
        content: "";
        position: absolute; inset: 14px;
        border: 1px solid ${theme.accent};
        opacity: 0.4;
        pointer-events: none;
      }
      .tk-prompt {
        position: absolute; top: 50px; left: 24px;
        font-family: ${baseFontMono};
        font-size: 10px;
        color: ${theme.muted};
      }
      .tk-prompt .acc { color: ${theme.accent}; }
      .tk-title {
        position: absolute; top: 78px; left: 24px; right: 24px;
        font-family: ${baseFontMono};
        font-weight: 700;
        font-size: 24px;
        line-height: 1.1;
        color: ${theme.ink};
        letter-spacing: -0.01em;
      }
      .tk-bar {
        position: absolute; top: 162px; left: 24px;
        width: 60px; height: 2px;
        background: ${theme.accent};
      }
      .tk-output {
        position: absolute; top: 184px; left: 24px; right: 24px;
        font-family: ${baseFontMono};
        font-size: 10px;
        line-height: 1.7;
        color: ${theme.muted};
      }
      .tk-output .k { color: ${theme.ink}; }
      .tk-output .v { color: ${theme.accent}; }
      .tk-output .c { color: ${theme.altAccent || theme.accent}; }
      .tk-ascii {
        position: absolute; bottom: 56px; left: 24px; right: 24px;
        font-family: ${baseFontMono};
        font-size: 8.5px;
        line-height: 1.25;
        color: ${theme.accent};
        opacity: 0.75;
        white-space: pre;
      }
      .tk-cursor {
        display: inline-block;
        width: 6px; height: 11px;
        background: ${theme.accent};
        vertical-align: -1px;
      }`,

    consulting: `
      .xhs-card { padding: 0; background: ${theme.bg}; }
      .xhs-card::before {
        content: "";
        position: absolute; top: 0; left: 0;
        width: 100%; height: 6px;
        background: linear-gradient(90deg, ${theme.accent} 0%, ${theme.accent} 40%, ${theme.muted} 40%, ${theme.muted} 100%);
      }
      .cn-kicker {
        position: absolute; top: 26px; left: 28px;
        font-family: ${baseFontMono};
        font-size: 9px;
        letter-spacing: 0.32em;
        color: ${theme.accent};
        text-transform: uppercase;
      }
      .cn-title {
        position: absolute; top: 60px; left: 28px; right: 28px;
        font-family: ${baseFontTitle};
        font-weight: 700;
        font-size: 28px;
        line-height: 1.1;
        color: ${theme.ink};
        letter-spacing: -0.01em;
      }
      .cn-rule {
        position: absolute; top: 160px; left: 28px;
        width: 32px; height: 1px;
        background: ${theme.accent};
      }
      .cn-sub {
        position: absolute; top: 174px; left: 28px; right: 28px;
        font-family: ${baseFontBody};
        font-size: 10px;
        line-height: 1.55;
        color: ${theme.muted};
      }
      .cn-matrix {
        position: absolute; top: 220px; left: 28px; right: 28px;
        display: grid;
        grid-template-columns: 1fr 1fr;
        gap: 1px;
        background: ${theme.muted};
        border: 1px solid ${theme.muted};
      }
      .cn-cell {
        background: ${theme.bg};
        padding: 12px 10px;
        min-height: 70px;
        display: flex; flex-direction: column;
        justify-content: space-between;
      }
      .cn-cell .lab {
        font-family: ${baseFontMono};
        font-size: 8.5px;
        color: ${theme.muted};
        letter-spacing: 0.18em;
        text-transform: uppercase;
      }
      .cn-cell .num {
        font-family: ${baseFontMono};
        font-weight: 700;
        font-size: 22px;
        color: ${theme.accent};
        line-height: 1;
      }
      .cn-cell .delta {
        font-family: ${baseFontMono};
        font-size: 9px;
        color: ${theme.altAccent || theme.accent};
      }
      .cn-footer {
        position: absolute; bottom: 56px; left: 28px; right: 28px;
        font-family: ${baseFontMono};
        font-size: 9px;
        color: ${theme.muted};
        letter-spacing: 0.08em;
        text-transform: uppercase;
        display: flex; justify-content: space-between;
        border-top: 1px solid ${theme.muted};
        padding-top: 10px;
        opacity: 0.85;
      }`,

    'review-score': `
      .xhs-card { padding: 0; }
      .rv-kicker {
        position: absolute; top: 30px; left: 28px;
        font-family: ${baseFontMono};
        font-size: 9px;
        letter-spacing: 0.32em;
        color: ${theme.muted};
        text-transform: uppercase;
      }
      .rv-name {
        position: absolute; top: 50px; left: 28px; right: 28px;
        font-family: ${baseFontTitle};
        font-weight: 700;
        font-size: 22px;
        line-height: 1.1;
        color: ${theme.ink};
      }
      .rv-score-wrap {
        position: absolute; top: 110px; left: 28px;
        display: flex; align-items: flex-start; gap: 6px;
      }
      .rv-score {
        font-family: ${baseFontTitle};
        font-weight: 800;
        font-size: 132px;
        line-height: 0.85;
        letter-spacing: -0.05em;
        color: ${theme.ink};
      }
      .rv-unit {
        font-family: ${baseFontTitle};
        font-weight: 600;
        font-size: 28px;
        color: ${theme.muted};
        margin-top: 12px;
      }
      .rv-bar {
        position: absolute; top: 260px; left: 28px; right: 28px;
        height: 6px;
        background: ${theme.muted};
        opacity: 0.25;
      }
      .rv-bar i {
        display: block;
        height: 100%;
        width: 92%;
        background: ${theme.accent};
      }
      .rv-verdict {
        position: absolute; top: 282px; left: 28px;
        font-family: ${baseFontMono};
        font-size: 10px;
        letter-spacing: 0.16em;
        color: ${theme.altAccent || theme.accent};
        text-transform: uppercase;
      }
      .rv-pros {
        position: absolute; top: 318px; left: 28px; right: 28px;
        font-family: ${baseFontBody};
        font-size: 10.5px;
        line-height: 1.55;
        color: ${theme.ink};
      }
      .rv-pros .lab {
        font-family: ${baseFontMono};
        font-size: 9px;
        letter-spacing: 0.18em;
        color: ${theme.altAccent || theme.accent};
        margin-right: 6px;
      }
      .rv-cons {
        position: absolute; top: 372px; left: 28px; right: 28px;
        font-family: ${baseFontBody};
        font-size: 10.5px;
        line-height: 1.55;
        color: ${theme.muted};
      }
      .rv-cons .lab {
        font-family: ${baseFontMono};
        font-size: 9px;
        letter-spacing: 0.18em;
        color: ${theme.accent};
        margin-right: 6px;
      }`,

    'terminal-warm': `
      .xhs-card { padding: 0; }
      .xhs-card::before {
        content: "";
        position: absolute; top: 0; bottom: 0; left: 24px;
        width: 1px;
        background: ${theme.accent};
        opacity: 0.35;
      }
      .tw-meta {
        position: absolute; top: 22px; left: 36px;
        font-family: ${baseFontMono};
        font-size: 9px;
        color: ${theme.muted};
        letter-spacing: 0.06em;
      }
      .tw-meta .acc { color: ${theme.accent}; }
      .tw-rule {
        position: absolute; top: 50px; left: 36px; right: 24px;
        height: 1px;
        background: ${theme.ink};
        opacity: 0.4;
      }
      .tw-prompt {
        position: absolute; top: 70px; left: 36px;
        font-family: ${baseFontMono};
        font-size: 11px;
        color: ${theme.ink};
      }
      .tw-prompt .acc { color: ${theme.accent}; font-weight: 700; }
      .tw-title {
        position: absolute; top: 100px; left: 36px; right: 24px;
        font-family: ${baseFontTitle};
        font-weight: 700;
        font-size: 28px;
        line-height: 1.05;
        color: ${theme.ink};
        letter-spacing: -0.01em;
      }
      .tw-sep {
        position: absolute; top: 180px; left: 36px; right: 24px;
        font-family: ${baseFontMono};
        font-size: 9px;
        color: ${theme.muted};
        letter-spacing: 0.2em;
        border-top: 1px dashed ${theme.ink};
        padding-top: 8px;
        opacity: 0.55;
      }
      .tw-log {
        position: absolute; top: 210px; left: 36px; right: 24px;
        font-family: ${baseFontMono};
        font-size: 10.5px;
        line-height: 1.85;
        color: ${theme.ink};
      }
      .tw-log .ts { color: ${theme.muted}; }
      .tw-log .acc { color: ${theme.accent}; }
      .tw-cursor {
        display: inline-block; width: 7px; height: 12px;
        background: ${theme.accent}; vertical-align: -2px;
      }
      .tw-stamp {
        position: absolute; bottom: 56px; right: 24px;
        font-family: ${baseFontMono};
        font-size: 9px;
        color: ${theme.accent};
        border: 1px solid ${theme.accent};
        padding: 4px 8px;
        letter-spacing: 0.16em;
        text-transform: uppercase;
        transform: rotate(-2deg);
        opacity: 0.85;
      }`,

    storyboard: `
      .xhs-card { padding: 0; }
      .sb-num {
        position: absolute; top: 28px; left: 28px;
        font-family: ${baseFontTitle};
        font-style: italic;
        font-size: 28px;
        color: ${theme.accent};
        line-height: 1;
        letter-spacing: 0.04em;
      }
      .sb-kicker {
        position: absolute; top: 32px; right: 28px;
        font-family: ${baseFontMono};
        font-size: 9px;
        color: ${theme.muted};
        letter-spacing: 0.28em;
        text-transform: uppercase;
      }
      .sb-title {
        position: absolute; top: 80px; left: 28px; right: 28px;
        font-family: ${baseFontTitle};
        font-style: italic;
        font-weight: 500;
        font-size: 32px;
        line-height: 1.08;
        color: ${theme.ink};
        letter-spacing: -0.01em;
      }
      .sb-lead {
        position: absolute; top: 180px; left: 28px; right: 60px;
        font-family: ${baseFontBody};
        font-size: 11px;
        line-height: 1.65;
        color: ${theme.muted};
        font-style: italic;
      }
      .sb-grid {
        position: absolute; top: 250px; left: 28px; right: 28px;
        display: grid;
        grid-template-columns: 1fr 1fr 1fr;
        gap: 8px;
      }
      .sb-frame {
        aspect-ratio: 4 / 3;
        border: 1px solid ${theme.accent};
        background: ${theme.bg};
        position: relative;
        opacity: 0.85;
      }
      .sb-frame:nth-child(2) { opacity: 1; }
      .sb-frame::after {
        content: attr(data-num);
        position: absolute; bottom: 4px; left: 4px;
        font-family: ${baseFontMono};
        font-style: italic;
        font-size: 9px;
        color: ${theme.accent};
      }
      .sb-foot {
        position: absolute; bottom: 56px; left: 28px; right: 28px;
        border-top: 1px solid ${theme.accent};
        padding-top: 10px;
        font-family: ${baseFontTitle};
        font-style: italic;
        font-size: 12px;
        color: ${theme.ink};
        line-height: 1.3;
      }`,

    'dot-matrix': `
      .xhs-card {
        padding: 0;
        background-color: ${theme.bg};
        background-image: radial-gradient(${theme.ink} 0.5px, transparent 0.5px);
        background-size: 8px 8px;
        background-position: 0 0;
      }
      .xhs-card::before {
        content: "";
        position: absolute; top: 16px; left: 16px; right: 16px; bottom: 16px;
        border: 1px solid rgba(36,34,31,0.16);
        pointer-events: none;
      }
      .dm-ruler {
        position: absolute; top: 26px; left: 28px; right: 28px;
        height: 8px;
        background-image: linear-gradient(90deg, ${theme.accent} 1px, transparent 1px);
        background-size: 16px 100%;
        opacity: 0.6;
      }
      .dm-ruler-v {
        position: absolute; top: 26px; left: 28px; bottom: 60px;
        width: 8px;
        background-image: linear-gradient(180deg, ${theme.accent} 1px, transparent 1px);
        background-size: 100% 16px;
        opacity: 0.4;
      }
      .dm-meta {
        position: absolute; top: 44px; left: 44px;
        font-family: ${baseFontMono};
        font-size: 9px;
        color: ${theme.muted};
        letter-spacing: 0.18em;
      }
      .dm-meta .acc { color: ${theme.accent}; }
      .dm-title {
        position: absolute; top: 80px; left: 44px; right: 28px;
        font-family: ${baseFontTitle};
        font-weight: 700;
        font-size: 32px;
        line-height: 1.05;
        color: ${theme.ink};
        letter-spacing: -0.01em;
      }
      .dm-wave {
        position: absolute; top: 190px; left: 44px; right: 28px;
        height: 50px;
      }
      .dm-wave path { fill: none; stroke: ${theme.accent}; stroke-width: 1.4; opacity: 0.9; }
      .dm-wave path.alt { stroke: ${theme.altAccent || theme.accent}; stroke-dasharray: 2 3; opacity: 0.6; }
      .dm-axis {
        position: absolute; top: 248px; left: 44px; right: 28px;
        height: 1px;
        background: ${theme.ink};
        opacity: 0.3;
      }
      .dm-nodes {
        position: absolute; top: 262px; left: 44px; right: 28px;
        font-family: ${baseFontMono};
        font-size: 9px;
        color: ${theme.muted};
        display: flex; justify-content: space-between;
      }
      .dm-nodes .acc { color: ${theme.accent}; }
      .dm-legend {
        position: absolute; bottom: 76px; left: 44px; right: 28px;
        font-family: ${baseFontBody};
        font-size: 10.5px;
        line-height: 1.6;
        color: ${theme.ink};
      }
      .dm-legend .k {
        font-family: ${baseFontMono};
        font-size: 9px;
        letter-spacing: 0.16em;
        color: ${theme.muted};
        margin-right: 6px;
        text-transform: uppercase;
      }`,

    'sketch-note': `
      .xhs-card {
        padding: 0;
        background-color: ${theme.bg};
        background-image:
          linear-gradient(rgba(51,51,51,0.08) 1px, transparent 1px),
          linear-gradient(90deg, rgba(51,51,51,0.08) 1px, transparent 1px);
        background-size: 24px 24px;
      }
      .sk-pin {
        position: absolute; top: 26px; left: 28px;
        font-family: ${baseFontMono};
        font-size: 10px;
        color: ${theme.muted};
        border: 1px dashed ${theme.muted};
        padding: 4px 8px;
        transform: rotate(-2deg);
        background: rgba(255,255,255,0.72);
      }
      .sk-title {
        position: absolute; top: 74px; left: 28px; right: 28px;
        font-family: ${baseFontTitle};
        font-size: 34px;
        line-height: 1.1;
        color: ${theme.ink};
        text-decoration: underline;
        text-decoration-style: wavy;
        text-decoration-color: ${theme.accent};
        text-underline-offset: 7px;
      }
      .sk-note {
        position: absolute; top: 178px; left: 28px; right: 28px;
        background: #fff9c4;
        box-shadow: 4px 4px 0 rgba(51,51,51,0.16);
        padding: 16px;
        font-size: 11px;
        line-height: 1.65;
        color: ${theme.ink};
        transform: rotate(-0.6deg);
      }
      .sk-list {
        position: absolute; top: 300px; left: 36px; right: 28px;
        display: grid;
        gap: 10px;
        font-size: 11px;
        line-height: 1.45;
      }
      .sk-list span {
        display: grid;
        grid-template-columns: 18px 1fr;
        gap: 8px;
      }
      .sk-list i {
        width: 14px; height: 14px;
        border: 2px solid ${theme.accent};
        border-radius: 50%;
        margin-top: 1px;
      }
      .sk-scribble {
        position: absolute; bottom: 62px; left: 28px; right: 28px;
        height: 24px;
        border-bottom: 2px dashed ${theme.altAccent || theme.accent};
        transform: rotate(1deg);
        opacity: 0.75;
      }`,

    'playful-geometric': `
      .xhs-card {
        padding: 0;
        background-color: ${theme.bg};
        background-image: radial-gradient(circle, rgba(30,41,59,0.12) 1px, transparent 1px);
        background-size: 18px 18px;
      }
      .pg-shape {
        position: absolute;
        border: 3px solid ${theme.ink};
        box-shadow: 5px 5px 0 ${theme.ink};
      }
      .pg-a { top: 26px; right: 34px; width: 52px; height: 52px; background: ${theme.altAccent || theme.accent}; border-radius: 0 18px 0 18px; }
      .pg-b { bottom: 74px; left: 26px; width: 42px; height: 42px; background: #fbbf24; border-radius: 999px; }
      .pg-c { bottom: 120px; right: 30px; width: 58px; height: 28px; background: #34d399; transform: rotate(-8deg); }
      .pg-kicker {
        position: absolute; top: 40px; left: 28px;
        font-family: ${baseFontMono};
        font-size: 9px;
        color: ${theme.ink};
        background: #fbbf24;
        border: 2px solid ${theme.ink};
        padding: 5px 8px;
        box-shadow: 3px 3px 0 ${theme.ink};
      }
      .pg-title {
        position: absolute; top: 96px; left: 28px; right: 58px;
        font-family: ${baseFontTitle};
        font-size: 31px;
        line-height: 1.08;
        color: #fff;
        background: ${theme.accent};
        border: 3px solid ${theme.ink};
        box-shadow: 6px 6px 0 ${theme.ink};
        padding: 12px 14px;
        border-radius: 0 20px 0 20px;
      }
      .pg-points {
        position: absolute; top: 226px; left: 32px; right: 32px;
        display: grid;
        gap: 10px;
      }
      .pg-point {
        display: flex;
        align-items: center;
        gap: 10px;
        min-height: 44px;
        border: 2px solid ${theme.ink};
        background: rgba(255,255,255,0.78);
        box-shadow: 4px 4px 0 ${theme.altAccent || theme.accent};
        padding: 8px 10px;
        font-size: 10.5px;
        line-height: 1.35;
      }
      .pg-dot {
        width: 18px; height: 18px;
        background: #fbbf24;
        border: 2px solid ${theme.ink};
        border-radius: 999px;
        flex: none;
      }`,

    'neo-brutal': `
      .xhs-card {
        padding: 0;
        background: ${theme.bg};
        border: 4px solid ${theme.ink};
        box-shadow: 10px 10px 0 ${theme.ink};
      }
      .nb-kicker {
        position: absolute; top: 26px; left: 24px;
        font-family: ${baseFontMono};
        font-size: 10px;
        font-weight: 900;
        color: ${theme.ink};
        background: ${theme.altAccent || theme.accent};
        border: 3px solid ${theme.ink};
        padding: 6px 10px;
        text-transform: uppercase;
      }
      .nb-title {
        position: absolute; top: 74px; left: 24px; right: 24px;
        font-family: ${baseFontTitle};
        font-size: 35px;
        line-height: 1;
        font-weight: 900;
        color: ${theme.ink};
        background: ${theme.accent};
        border: 4px solid ${theme.ink};
        box-shadow: 8px 8px 0 ${theme.ink};
        padding: 14px;
        text-transform: uppercase;
      }
      .nb-grid {
        position: absolute; top: 206px; left: 24px; right: 24px;
        display: grid;
        grid-template-columns: 1fr 1fr;
        gap: 8px;
      }
      .nb-cell {
        min-height: 84px;
        border: 3px solid ${theme.ink};
        background: #fff;
        padding: 10px;
        box-shadow: 5px 5px 0 ${theme.ink};
      }
      .nb-cell strong {
        display: block;
        font-family: ${baseFontTitle};
        font-size: 22px;
        line-height: 1;
      }
      .nb-cell span {
        display: block;
        margin-top: 8px;
        font-size: 9.5px;
        line-height: 1.35;
      }
      .nb-banner {
        position: absolute; bottom: 64px; left: 24px; right: 24px;
        border: 4px solid ${theme.ink};
        background: #00d2d3;
        padding: 8px 12px;
        font-family: ${baseFontMono};
        font-size: 10px;
        font-weight: 900;
        box-shadow: 6px 6px 0 ${theme.ink};
      }`,

    botanical: `
      .xhs-card { padding: 0; background: ${theme.bg}; }
      .bt-line {
        position: absolute; top: 0; bottom: 0; left: 42px;
        width: 1px;
        background: ${theme.accent};
        opacity: 0.32;
      }
      .bt-leaf {
        position: absolute;
        width: 74px; height: 26px;
        border: 1px solid ${theme.accent};
        border-radius: 80% 0 80% 0;
        opacity: 0.5;
        transform: rotate(-18deg);
      }
      .bt-leaf.a { top: 38px; right: 28px; }
      .bt-leaf.b { bottom: 94px; left: 70px; transform: rotate(16deg); }
      .bt-kicker {
        position: absolute; top: 34px; left: 62px;
        font-family: ${baseFontMono};
        font-size: 9px;
        color: ${theme.accent};
        letter-spacing: 0.18em;
        text-transform: uppercase;
      }
      .bt-title {
        position: absolute; top: 76px; left: 62px; right: 34px;
        font-family: ${baseFontTitle};
        font-size: 32px;
        line-height: 1.14;
        color: ${theme.accent};
      }
      .bt-body {
        position: absolute; top: 184px; left: 62px; right: 34px;
        font-size: 11px;
        line-height: 1.8;
        color: ${theme.ink};
      }
      .bt-quote {
        position: absolute; bottom: 88px; left: 62px; right: 34px;
        background: #e8e4dc;
        border-left: 4px solid ${theme.accent};
        padding: 13px 16px;
        font-family: ${baseFontTitle};
        font-size: 14px;
        line-height: 1.45;
        color: ${theme.ink};
      }`,

    'retro-print': `
      .xhs-card { padding: 0; background: ${theme.bg}; }
      .rt-frame {
        position: absolute; inset: 22px;
        border-top: 4px double ${theme.accent};
        border-bottom: 4px double ${theme.accent};
        pointer-events: none;
      }
      .rt-kicker {
        position: absolute; top: 42px; left: 32px; right: 32px;
        font-family: ${baseFontMono};
        font-size: 9px;
        color: ${theme.accent};
        letter-spacing: 0.22em;
        text-align: center;
        text-transform: uppercase;
      }
      .rt-title {
        position: absolute; top: 86px; left: 30px; right: 30px;
        font-family: ${baseFontTitle};
        font-size: 34px;
        line-height: 1.08;
        color: ${theme.accent};
        text-align: center;
      }
      .rt-cols {
        position: absolute; top: 206px; left: 34px; right: 34px;
        display: grid;
        grid-template-columns: 1fr 1fr;
        gap: 16px;
      }
      .rt-col {
        font-size: 10.5px;
        line-height: 1.7;
        color: ${theme.ink};
      }
      .rt-stamp {
        position: absolute; bottom: 82px; right: 34px;
        border: 2px solid ${theme.accent};
        color: ${theme.accent};
        font-family: ${baseFontMono};
        font-size: 10px;
        padding: 7px 10px;
        transform: rotate(-7deg);
        text-transform: uppercase;
      }
      .rt-rule {
        position: absolute; bottom: 136px; left: 34px; right: 34px;
        height: 3px;
        background: repeating-linear-gradient(90deg, ${theme.accent}, ${theme.accent} 10px, transparent 10px, transparent 20px);
      }`,

    'clean-native': `
      .xhs-card { padding: 0; background: ${theme.bg}; }
      .cln-ring {
        position: absolute; top: -46px; right: -46px;
        width: 152px; height: 152px;
        border-radius: 999px;
        background: rgba(99,102,241,0.12);
      }
      .cln-kicker {
        position: absolute; top: 34px; left: 30px;
        font-family: ${baseFontMono};
        font-size: 9px;
        color: ${theme.accent};
        letter-spacing: 0.18em;
        text-transform: uppercase;
      }
      .cln-title {
        position: absolute; top: 74px; left: 30px; right: 30px;
        font-family: ${baseFontTitle};
        font-size: 34px;
        line-height: 1.12;
        color: ${theme.ink};
      }
      .cln-lead {
        position: absolute; top: 180px; left: 30px; right: 30px;
        font-size: 11px;
        line-height: 1.72;
        color: ${theme.muted};
      }
      .cln-stack {
        position: absolute; top: 266px; left: 30px; right: 30px;
        display: grid;
        gap: 9px;
      }
      .cln-row {
        display: flex;
        align-items: center;
        gap: 10px;
        border: 1px solid #e2e8f0;
        background: #f8fafc;
        border-radius: 10px;
        padding: 10px 12px;
        font-size: 10.5px;
        color: ${theme.ink};
      }
      .cln-row i {
        width: 8px; height: 8px;
        border-radius: 99px;
        background: ${theme.accent};
        flex: none;
      }
      .cln-chip {
        position: absolute; bottom: 74px; left: 30px;
        border-radius: 999px;
        background: rgba(99,102,241,0.1);
        color: ${theme.accent};
        padding: 7px 12px;
        font-family: ${baseFontMono};
        font-size: 9px;
      }`,
  }

  return shell + '\n' + (motifStage[theme.motif] || '')
}

function renderSocialMotifBody(theme: TemplatePreviewTheme, template: OutputTemplate): string {
  switch (theme.motif) {
    case 'editorial':
      return `
        <div class="ed-head">COLUMN · ${escapeSocialPreviewText(template.nameEn || '')}</div>
        <h2 class="ed-title">${escapeSocialPreviewText(template.name)}</h2>
        <div class="ed-rule"></div>
        <div class="ed-cols">
          <div class="ed-col"><b>这</b>不是一张普通的小红书卡片，而是一份从纸刊编辑台出发的视觉提案。它复刻《单读》《T Magazine》的版面节奏。</div>
          <div class="ed-divider"></div>
          <div class="ed-col">栏目标签、首字下沉、双栏正文与刊号编号共同构成杂志感。读者第一眼会觉得"这是可以翻的刊物"。</div>
        </div>
        <p class="ed-quote">"内容决定媒介，编辑决定气场。"</p>`
    case 'terminal-dark':
      return `
        <div class="tk-prompt"><span class="acc">$</span> ./xhs --build --style=geek</div>
        <h2 class="tk-title">${escapeSocialPreviewText(template.name)}</h2>
        <div class="tk-bar"></div>
        <div class="tk-output">
          <span class="k">[boot]</span> loading visual modules ......... <span class="v">OK</span><br>
          <span class="k">[net]</span>  handshake with model ............ <span class="v">OK</span><br>
          <span class="k">[gfx]</span>  ascii border ................. <span class="c">on</span><br>
          <span class="k">[ink]</span>  #00ff9c phosphor green ....... <span class="c">on</span><br>
          <span class="k">[cmd]</span>  awaiting input<span class="tk-cursor"></span>
        </div>
        <pre class="tk-ascii">+ - - - - - - - - - - - +
|  SIGNAL: STABLE      |
|  NOISE : 0.02        |
|  UPTIME: 04:18:22    |
+ - - - - - - - - - - - +</pre>`
    case 'consulting':
      return `
        <div class="cn-kicker">EXHIBIT · STRATEGY</div>
        <h2 class="cn-title">${escapeSocialPreviewText(template.name)}</h2>
        <div class="cn-rule"></div>
        <p class="cn-sub">${escapeSocialPreviewText(template.description)}</p>
        <div class="cn-matrix">
          <div class="cn-cell">
            <span class="lab">Market</span>
            <span class="num">68<span style="font-size:11px;">%</span></span>
            <span class="delta">▲ 4.2 YoY</span>
          </div>
          <div class="cn-cell">
            <span class="lab">Retention</span>
            <span class="num">42<span style="font-size:11px;">%</span></span>
            <span class="delta">▲ 1.8 pt</span>
          </div>
          <div class="cn-cell">
            <span class="lab">CAC</span>
            <span class="num">¥38</span>
            <span class="delta">▼ 12%</span>
          </div>
          <div class="cn-cell">
            <span class="lab">NPS</span>
            <span class="num">54</span>
            <span class="delta">▲ 6 pt</span>
          </div>
        </div>
        <div class="cn-footer">
          <span>SOURCE · INTERNAL</span>
          <span>FIG. 03</span>
        </div>`
    case 'review-score':
      return `
        <div class="rv-kicker">REVIEW · ${escapeSocialPreviewText(template.nameEn || '')}</div>
        <h2 class="rv-name">${escapeSocialPreviewText(template.name)}</h2>
        <div class="rv-score-wrap">
          <span class="rv-score">9.2</span>
          <span class="rv-unit">/10</span>
        </div>
        <div class="rv-bar"><i></i></div>
        <div class="rv-verdict">VERDICT · 强烈推荐</div>
        <p class="rv-pros"><span class="lab">PROS</span>视觉系统成熟，色彩克制，字体层级清晰，第一眼就有专业感。</p>
        <p class="rv-cons"><span class="lab">CONS</span>对小字号的移动端阅读还需要进一步优化。</p>`
    case 'terminal-warm':
      return `
        <div class="tw-meta">[ <span class="acc">${escapeSocialPreviewText(theme.cornerLabel || 'TTY 01')}</span> · thermal printer · online ]</div>
        <div class="tw-rule"></div>
        <div class="tw-prompt"><span class="acc">$</span> type xhs.story</div>
        <h2 class="tw-title">${escapeSocialPreviewText(template.name)}</h2>
        <div class="tw-sep">- - - - - - - - - - - - - - - -</div>
        <div class="tw-log">
          <span class="ts">[08:14]</span> start draft ............... <span class="acc">ok</span><br>
          <span class="ts">[08:15]</span> load paper texture ....... <span class="acc">ok</span><br>
          <span class="ts">[08:16]</span> set ink #2f2f2f .......... <span class="acc">ok</span><br>
          <span class="ts">[08:17]</span> render card[0] .......... <span class="acc">ok</span><br>
          <span class="ts">[08:18]</span> ready<span class="tw-cursor"></span>
        </div>
        <span class="tw-stamp">PRINTED</span>`
    case 'storyboard':
      return `
        <div class="sb-num">VOL.I</div>
        <div class="sb-kicker">FRAME · STORY</div>
        <h2 class="sb-title">${escapeSocialPreviewText(template.name)}</h2>
        <p class="sb-lead">${escapeSocialPreviewText(template.description)}</p>
        <div class="sb-grid">
          <div class="sb-frame" data-num="I"></div>
          <div class="sb-frame" data-num="II"></div>
          <div class="sb-frame" data-num="III"></div>
        </div>
        <p class="sb-foot">"Quiet luxury, told frame by frame."</p>`
    case 'dot-matrix':
      return `
        <div class="dm-ruler"></div>
        <div class="dm-ruler-v"></div>
        <div class="dm-meta">SIGNAL <span class="acc">·</span> ${escapeSocialPreviewText(theme.cornerLabel || 'SIG_01')}</div>
        <h2 class="dm-title">${escapeSocialPreviewText(template.name)}</h2>
        <svg class="dm-wave" viewBox="0 0 280 50" preserveAspectRatio="none">
          <path d="M0,30 Q20,10 40,28 T80,24 T120,32 T160,18 T200,28 T240,22 T280,30" />
          <path class="alt" d="M0,38 Q20,30 40,34 T80,36 T120,30 T160,34 T200,32 T240,30 T280,34" />
        </svg>
        <div class="dm-axis"></div>
        <div class="dm-nodes">
          <span>T0</span>
          <span class="acc">T1 · peak</span>
          <span>T2</span>
          <span>T3</span>
        </div>
        <p class="dm-legend"><span class="k">Read</span>编辑视角解读信号波形，节点对应内容关键事件。</p>`
    case 'sketch-note':
      return `
        <div class="sk-pin">${escapeSocialPreviewText(theme.cornerLabel || 'SKETCH')}</div>
        <h2 class="sk-title">${escapeSocialPreviewText(template.name)}</h2>
        <p class="sk-note">${escapeSocialPreviewText(template.description)}</p>
        <div class="sk-list">
          <span><i></i> 封面、正文卡、结尾卡都保持 3:4 纸张网格。</span>
          <span><i></i> 重点词用红蓝标记笔，正文保持清楚可读。</span>
          <span><i></i> 适合把长笔记拆成像手账一样的组图。</span>
        </div>
        <div class="sk-scribble"></div>`
    case 'playful-geometric':
      return `
        <i class="pg-shape pg-a"></i>
        <i class="pg-shape pg-b"></i>
        <i class="pg-shape pg-c"></i>
        <div class="pg-kicker">${escapeSocialPreviewText(theme.cornerLabel || 'PLAY')}</div>
        <h2 class="pg-title">${escapeSocialPreviewText(template.name)}</h2>
        <div class="pg-points">
          <div class="pg-point"><i class="pg-dot"></i><span>高饱和几何贴纸，第一眼抓住重点。</span></div>
          <div class="pg-point"><i class="pg-dot"></i><span>步骤、清单、趋势解读都能拆成轻快卡片。</span></div>
          <div class="pg-point"><i class="pg-dot"></i><span>Auto-fit 导出时自动收进固定画幅。</span></div>
        </div>`
    case 'neo-brutal':
      return `
        <div class="nb-kicker">${escapeSocialPreviewText(theme.cornerLabel || 'LOUD')}</div>
        <h2 class="nb-title">${escapeSocialPreviewText(template.name)}</h2>
        <div class="nb-grid">
          <div class="nb-cell"><strong>01</strong><span>厚黑边框与硬阴影建立强视觉锚点。</span></div>
          <div class="nb-cell"><strong>02</strong><span>结论先行，适合避坑、测评和观点传播。</span></div>
          <div class="nb-cell"><strong>03</strong><span>高饱和色块只服务重点信息。</span></div>
          <div class="nb-cell"><strong>04</strong><span>3:4 组图，逐张导出更稳定。</span></div>
        </div>
        <div class="nb-banner">NO SOFT EDGES · EXPORT READY</div>`
    case 'botanical':
      return `
        <i class="bt-line"></i>
        <i class="bt-leaf a"></i>
        <i class="bt-leaf b"></i>
        <div class="bt-kicker">${escapeSocialPreviewText(theme.cornerLabel || 'BOTANY')}</div>
        <h2 class="bt-title">${escapeSocialPreviewText(template.name)}</h2>
        <p class="bt-body">${escapeSocialPreviewText(template.description)} 适合用舒展行距、柔和分隔和自然色彩把信息慢慢铺开。</p>
        <p class="bt-quote">"让知识像植物标本一样清楚、安静、可收藏。"</p>`
    case 'retro-print':
      return `
        <i class="rt-frame"></i>
        <div class="rt-kicker">${escapeSocialPreviewText(theme.cornerLabel || 'RETRO')}</div>
        <h2 class="rt-title">${escapeSocialPreviewText(template.name)}</h2>
        <div class="rt-cols">
          <p class="rt-col">米黄旧纸、双线栏头、棕褐正文和复古橙标题共同形成旧报纸式社交组图。</p>
          <p class="rt-col">适合怀旧故事、读书札记和品牌旧事，保留温度，也保持清晰结构。</p>
        </div>
        <div class="rt-rule"></div>
        <div class="rt-stamp">PRINT</div>`
    case 'clean-native':
      return `
        <i class="cln-ring"></i>
        <div class="cln-kicker">${escapeSocialPreviewText(theme.cornerLabel || 'CARD')}</div>
        <h2 class="cln-title">${escapeSocialPreviewText(template.name)}</h2>
        <p class="cln-lead">${escapeSocialPreviewText(template.description)}</p>
        <div class="cln-stack">
          <div class="cln-row"><i></i><span>白底、靛蓝强调、现代清晰层级。</span></div>
          <div class="cln-row"><i></i><span>长文可自动拆分为多张卡片。</span></div>
          <div class="cln-row"><i></i><span>适合通用内容快速生成稳定组图。</span></div>
        </div>
        <span class="cln-chip">3:4 · auto-split</span>`
    default:
      return `<div style="padding:80px 24px;color:${theme.ink};font-family:${theme.fontTitle};font-size:24px;">${escapeSocialPreviewText(template.name)}</div>`
  }
}

export function buildSocialSeriesTemplatePreview(template: OutputTemplate): string {
  const theme = template.previewTheme
  if (!theme) {
    return `<!DOCTYPE html><html lang="zh-CN"><head><meta charset="UTF-8"><title>${escapeSocialPreviewText(template.name)}</title></head><body style="font-family:-apple-system,sans-serif;padding:40px;"><h1>${escapeSocialPreviewText(template.name)}</h1><p>${escapeSocialPreviewText(template.description)}</p></body></html>`
  }

  const css = renderSocialMotifCss(theme)
  const body = renderSocialMotifBody(theme, template)

  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${escapeSocialPreviewText(template.name)} · 预览</title>
  <style>${css}
    @media (prefers-reduced-motion: reduce) {
      *, *::before, *::after { animation: none !important; transition: none !important; }
    }
  </style>
</head>
<body>
  <article class="xhs-card" aria-label="${escapeSocialPreviewText(template.name)} 预览">
    <span class="corner">${escapeSocialPreviewText(theme.cornerLabel || '')}</span>
    ${body}
    <span class="tagline">${escapeSocialPreviewText(theme.tagline)}</span>
    <span class="name-en">${escapeSocialPreviewText(template.nameEn)}</span>
  </article>
</body>
</html>`
}
