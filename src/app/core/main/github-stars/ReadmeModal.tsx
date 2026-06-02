'use client'

import NextImage from 'next/image';
import React, { useEffect, useState, useCallback, useRef } from 'react';
import { createPortal } from 'react-dom';
import { X, Loader2, AlertCircle, FileText, ExternalLink, List, Type, ArrowUp, Languages, Eye } from 'lucide-react';
import BilingualMarkdownRenderer, { DisplayMode, BilingualMarkdownRendererHandle, TranslationStatus } from './BilingualMarkdownRenderer';
import { stripMarkdownFormatting } from '@/lib/github-stars/markdownUtils';
import { fetchRepositoryReadme } from '@/lib/github-stars/api';

interface TocItem {
  id: string;
  text: string;
  level: number;
}

interface ReadmeModalProps {
  isOpen: boolean;
  onClose: () => void;
  repoName: string | null; // e.g. "facebook/react"
  ownerAvatarUrl?: string | null;
}

const FONT_SIZES = [
  { label: '小', labelEn: 'Small', value: 'text-sm' },
  { label: '中', labelEn: 'Medium', value: 'text-base' },
  { label: '大', labelEn: 'Large', value: 'text-lg' },
];

const TOC_MAX_LEVEL = 6;
const language = 'zh';

export const ReadmeModal: React.FC<ReadmeModalProps> = ({
  isOpen,
  onClose,
  repoName,
  ownerAvatarUrl
}) => {
  const [readmeContent, setReadmeContent] = useState<string>('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showToc, setShowToc] = useState(true);
  const [fontSizeIndex, setFontSizeIndex] = useState(1);
  const [tocItems, setTocItems] = useState<TocItem[]>([]);
  const [headingIdMap, setHeadingIdMap] = useState<Map<string, string>>(new Map());
  const [scrollProgress, setScrollProgress] = useState(0);
  const [showBackToTop, setShowBackToTop] = useState(false);
  const [activeHeadingId, setActiveHeadingId] = useState<string | null>(null);
  const [displayMode, setDisplayMode] = useState<DisplayMode>('bilingual');
  const [errorExpanded, setErrorExpanded] = useState(false);
  const [tocWidth, setTocWidth] = useState(224);
  const [translatedHeadingMap, setTranslatedHeadingMap] = useState<Map<string, string>>(new Map());
  const [portalElement, setPortalElement] = useState<HTMLElement | null>(null);

  const modalRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);
  const abortControllerRef = useRef<AbortController | null>(null);
  const isResizingRef = useRef(false);
  const startXRef = useRef(0);
  const startWidthRef = useRef(0);

  const bilingualRef = useRef<BilingualMarkdownRendererHandle>(null);
  const [translateStatus, setTranslateStatus] = useState<TranslationStatus>('idle');
  const [translateProgress, setTranslateProgress] = useState({ current: 0, total: 0 });
  const [translateError, setTranslateError] = useState<string | null>(null);

  const displayContent = readmeContent;
  const currentFontSize = FONT_SIZES[fontSizeIndex].value;

  useEffect(() => {
    setPortalElement(document.body);
  }, []);

  const getFontSizeType = useCallback((): 'small' | 'medium' | 'large' => {
    switch (fontSizeIndex) {
      case 0:
        return 'small';
      case 2:
        return 'large';
      case 1:
      default:
        return 'medium';
    }
  }, [fontSizeIndex]);

  const extractToc = useCallback((content: string): { items: TocItem[], idMap: Map<string, string> } => {
    const items: TocItem[] = [];
    const idMap = new Map<string, string>();

    const codeBlockRegex = /```[\s\S]*?```|~~~[\s\S]*?~~~/g;
    const cleanedContent = content.replace(codeBlockRegex, '');
    const regex = new RegExp(`^(#{1,${TOC_MAX_LEVEL}})\\s+(.+)$`, 'gm');
    let match;
    let idCounter = 0;
    const textCountMap = new Map<string, number>();

    while ((match = regex.exec(cleanedContent)) !== null) {
      const level = match[1].length;
      const rawText = match[2].trim();
      const displayText = stripMarkdownFormatting(rawText);
      const id = `heading-${idCounter++}`;
      const count = textCountMap.get(displayText) || 0;
      const mapKey = count === 0 ? displayText : `${displayText}__${count}`;
      textCountMap.set(displayText, count + 1);
      items.push({ id, text: displayText, level });
      idMap.set(mapKey, id);
    }

    return { items, idMap };
  }, []);

  const scrollToHeading = useCallback((id: string, fallbackText?: string) => {
    if (!contentRef.current) return;
    const container = contentRef.current;

    const translationWrapper = container.querySelector(`[data-bi-heading-id="${CSS.escape(id)}"]`) as HTMLElement | null;
    if (translationWrapper && translationWrapper.offsetParent !== null) {
      const elementRect = translationWrapper.getBoundingClientRect();
      const containerRect = container.getBoundingClientRect();
      const scrollTop = container.scrollTop + elementRect.top - containerRect.top - 20;
      try {
        container.scrollTo({ top: scrollTop, behavior: 'smooth' });
      } catch {
        container.scrollTop = scrollTop;
      }
      return;
    }

    let element = container.querySelector(`#${CSS.escape(id)}`) as HTMLElement | null;

    if (!element && fallbackText) {
      const headings = container.querySelectorAll('h1, h2, h3, h4, h5, h6');
      for (let i = 0; i < headings.length; i++) {
        const heading = headings[i] as HTMLElement;
        if (heading.textContent?.trim() === fallbackText.trim()) {
          element = heading;
          break;
        }
      }
    }

    if (!element && fallbackText) {
      const headings = container.querySelectorAll('h1, h2, h3, h4, h5, h6');
      for (let i = 0; i < headings.length; i++) {
        const heading = headings[i] as HTMLElement;
        if (heading.textContent?.includes(fallbackText)) {
          element = heading;
          break;
        }
      }
    }

    if (element) {
      const elementRect = element.getBoundingClientRect();
      const containerRect = container.getBoundingClientRect();
      const scrollTop = container.scrollTop + elementRect.top - containerRect.top - 20;

      try {
        container.scrollTo({
          top: scrollTop,
          behavior: 'smooth'
        });
      } catch {
        container.scrollTop = scrollTop;
      }
    }
  }, []);

  const handleScroll = useCallback(() => {
    if (!contentRef.current) return;
    const container = contentRef.current;
    const { scrollTop, scrollHeight, clientHeight } = container;
    const progress = scrollHeight <= clientHeight ? 0 : (scrollTop / (scrollHeight - clientHeight)) * 100;
    setScrollProgress(Math.min(100, Math.max(0, progress)));
    setShowBackToTop(scrollTop > 300);
  }, []);

  useEffect(() => {
    if (!contentRef.current || !tocItems.length || !readmeContent) return;

    let observer: IntersectionObserver | null = null;

    const timer = setTimeout(() => {
      const container = contentRef.current;
      if (!container) return;

      if (observer) observer.disconnect();

      observer = new IntersectionObserver(
        (entries) => {
          const visibleEntries = entries.filter(e => e.isIntersecting);
          if (visibleEntries.length > 0) {
            const topEntry = visibleEntries.reduce((a, b) =>
              a.boundingClientRect.top < b.boundingClientRect.top ? a : b
            );
            const target = topEntry.target as HTMLElement;
            setActiveHeadingId(target.dataset.biHeadingId ?? target.id);
          }
        },
        {
          root: container,
          rootMargin: '-10% 0px -80% 0px',
          threshold: 0,
        }
      );

      tocItems.forEach((item) => {
        let el = container.querySelector(`[data-bi-heading-id="${CSS.escape(item.id)}"]`) as HTMLElement | null;
        if (!el) {
          el = container.querySelector(`#${CSS.escape(item.id)}`);
        }
        if (!el && item.text) {
          const headings = container.querySelectorAll('h1, h2, h3, h4, h5, h6');
          for (let i = 0; i < headings.length; i++) {
            const heading = headings[i] as HTMLElement;
            if (heading.textContent?.trim() === item.text.trim()) {
              el = heading;
              break;
            }
          }
        }
        if (el && observer) observer.observe(el);
      });
    }, 150);

    return () => {
      clearTimeout(timer);
      if (observer) observer.disconnect();
    };
  }, [tocItems, readmeContent, translateStatus, displayMode]);

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (!isResizingRef.current) return;
      const delta = e.clientX - startXRef.current;
      setTocWidth(Math.max(150, Math.min(500, startWidthRef.current + delta)));
    };
    const handleMouseUp = () => {
      if (!isResizingRef.current) return;
      isResizingRef.current = false;
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };
    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };
  }, [tocWidth]);

  const scrollToTop = useCallback(() => {
    if (contentRef.current) {
      try {
        contentRef.current.scrollTo({ top: 0, behavior: 'smooth' });
      } catch {
        contentRef.current.scrollTop = 0;
      }
    }
  }, []);

  const cycleFontSize = useCallback(() => {
    setFontSizeIndex((prev) => (prev + 1) % FONT_SIZES.length);
  }, []);

  const handleResizeMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    isResizingRef.current = true;
    startXRef.current = e.clientX;
    startWidthRef.current = tocWidth;
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
  }, [tocWidth]);

  const t = useCallback((zh: string, en: string) => language === 'zh' ? zh : en, []);

  const handleTranslate = useCallback(async () => {
    if (translateStatus === 'translating') return;
    await bilingualRef.current?.translate();
  }, [translateStatus]);

  const handleRevertTranslation = useCallback(() => {
    bilingualRef.current?.revert();
    setTranslatedHeadingMap(new Map());
  }, []);

  const handleHeadingsTranslated = useCallback((headings: { id: string; text: string }[]) => {
    const map = new Map<string, string>();
    headings.forEach(h => map.set(h.id, h.text));
    setTranslatedHeadingMap(map);
  }, []);

  const fetchReadme = useCallback(async () => {
    if (!repoName) return;

    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }
    const abortController = new AbortController();
    abortControllerRef.current = abortController;

    setLoading(true);
    setError(null);

    try {
      const content = await fetchRepositoryReadme(repoName);
      if (abortController.signal.aborted) return;

      if (content && content.trim()) {
        setReadmeContent(content);
      } else {
        setError('该仓库没有 README 文件');
      }
    } catch (err) {
      if (abortController.signal.aborted) return;
      console.error('Failed to fetch README:', err);
      setError('加载 README 失败，请检查网络连接或稍后重试');
    } finally {
      if (!abortController.signal.aborted) {
        setLoading(false);
      }
    }
  }, [repoName]);

  useEffect(() => {
    if (isOpen && repoName) {
      fetchReadme();
    }
  }, [isOpen, repoName, fetchReadme]);

  useEffect(() => {
    if (displayContent) {
      const { items, idMap } = extractToc(displayContent);
      setTocItems(items);
      setHeadingIdMap(idMap);
      setTranslatedHeadingMap(new Map());
    }
  }, [displayContent, extractToc]);

  useEffect(() => {
    if (!isOpen) {
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
        abortControllerRef.current = null;
      }
      setReadmeContent('');
      setError(null);
      setLoading(false);
      setTocItems([]);
      setHeadingIdMap(new Map());
      setScrollProgress(0);
      setShowBackToTop(false);
      setActiveHeadingId(null);
      setDisplayMode('bilingual');
      setErrorExpanded(false);
      bilingualRef.current?.revert();
      setTranslateStatus('idle');
      setTranslateProgress({ current: 0, total: 0 });
      setTranslateError(null);
      setTranslatedHeadingMap(new Map());
      isResizingRef.current = false;
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    } else {
      setShowToc(true);
    }
  }, [isOpen]);

  useEffect(() => {
    return () => {
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
        abortControllerRef.current = null;
      }
    };
  }, []);

  useEffect(() => {
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        onClose();
      }
    };

    if (isOpen) {
      previousFocusRef.current = document.activeElement as HTMLElement;
      document.addEventListener('keydown', handleEscape);
      document.body.style.overflow = 'hidden';
      setTimeout(() => {
        modalRef.current?.focus();
      }, 0);
    }

    return () => {
      document.removeEventListener('keydown', handleEscape);
      if (document.body.style.overflow === 'hidden') {
        document.body.style.overflow = 'unset';
      }
      previousFocusRef.current?.focus();
    };
  }, [isOpen, onClose]);

  if (!isOpen || !repoName || !portalElement) return null;

  const handleBackdropClick = (event: React.MouseEvent<HTMLDivElement>) => {
    if (event.target === event.currentTarget) {
      onClose();
    }
  };

  const tocIndentClass = (level: number): string => {
    switch (level) {
      case 1: return '';
      case 2: return 'pl-3';
      case 3: return 'pl-6';
      case 4: return 'pl-9';
      case 5: return 'pl-12';
      case 6: return 'pl-16';
      default: return '';
    }
  };

  const tocTextClass = (level: number): string => {
    if (level <= 2) return 'font-medium text-foreground';
    if (level <= 4) return 'text-muted-foreground';
    return 'text-muted-foreground/80 text-xs';
  };

  const isTranslating = translateStatus === 'translating';
  const isTranslated = translateStatus === 'translated';
  const isTranslateError = translateStatus === 'error';

  const modal = (
    <div className="fixed inset-0 z-[5000] overflow-y-auto">
      <div
        className="flex min-h-full items-center justify-center p-4 bg-black/60 transition-opacity"
        onClick={handleBackdropClick}
      >
        <div
          ref={modalRef}
          role="dialog"
          aria-modal="true"
          aria-labelledby="readme-modal-title"
          tabIndex={-1}
          className="relative w-full bg-background border border-border rounded-xl shadow-xl transform transition-all max-h-[90vh] flex flex-col overflow-hidden"
          style={{ maxWidth: '1130px' }}
          onClick={(e) => e.stopPropagation()}
        >
          {readmeContent && !loading && (
            <div className="absolute top-0 left-0 right-0 h-0.5 bg-muted z-20 rounded-t-xl overflow-hidden">
              <div
                className="h-full bg-primary transition-[width] duration-150 ease-out"
                style={{ width: `${scrollProgress}%` }}
              />
            </div>
          )}

          <div className="flex items-center justify-between p-4 border-b border-border flex-shrink-0">
            <div className="flex items-center space-x-3">
              {ownerAvatarUrl ? (
                <NextImage
                  src={ownerAvatarUrl}
                  alt=""
                  width={32}
                  height={32}
                  className="size-8 rounded-full border border-border"
                  unoptimized
                />
              ) : (
                <div className="w-8 h-8 rounded-full bg-muted flex items-center justify-center">
                  <FileText className="w-4 h-4 text-muted-foreground" />
                </div>
              )}
              <div>
                <h3 id="readme-modal-title" className="text-sm font-semibold text-foreground">
                  {repoName}
                </h3>
                <p className="text-xs text-muted-foreground">
                  README.md 预览
                </p>
              </div>
            </div>
            <div className="flex items-center space-x-1">
              {readmeContent && !loading && (
                isTranslated ? (
                  <>
                    <button
                      onClick={handleRevertTranslation}
                      className="flex items-center space-x-1 px-3 py-2 text-sm rounded-lg transition-colors bg-primary/10 text-primary font-medium"
                      title={t('关闭翻译', 'Close Translation')}
                    >
                      <Languages className="w-4 h-4" />
                      <span className="hidden sm:inline">{t('已翻译', 'Translated')}</span>
                    </button>
                    {([
                      { mode: 'original' as DisplayMode, icon: FileText, label: t('原文', 'Original') },
                      { mode: 'translated' as DisplayMode, icon: Languages, label: t('译文', 'Translated') },
                      { mode: 'bilingual' as DisplayMode, icon: Eye, label: t('双语', 'Bilingual') },
                    ]).map(({ mode, icon: Icon, label }) => (
                      <button
                        key={mode}
                        onClick={() => setDisplayMode(mode)}
                        className={`flex items-center space-x-1 px-2 py-2 text-sm rounded-lg transition-colors ${
                          displayMode === mode
                            ? 'bg-primary/20 text-primary font-medium'
                            : 'text-muted-foreground hover:text-foreground hover:bg-muted/50'
                        }`}
                        title={label}
                      >
                        <Icon className="w-4 h-4" />
                        <span className="hidden sm:inline">{label}</span>
                      </button>
                    ))}
                  </>
                ) : isTranslateError ? (
                  <>
                    <button
                      onClick={handleTranslate}
                      className="flex items-center space-x-1 px-3 py-2 text-sm rounded-lg transition-colors text-amber-600 dark:text-amber-400 hover:bg-amber-500/10 font-medium"
                      title={t('重试翻译', 'Retry Translation')}
                    >
                      <Languages className="w-4 h-4" />
                      <span className="hidden sm:inline">{t('重试', 'Retry')}</span>
                    </button>
                    <button
                      onClick={handleRevertTranslation}
                      className="flex items-center space-x-1 px-2 py-2 text-sm rounded-lg transition-colors text-muted-foreground hover:text-foreground hover:bg-muted/50"
                      title={t('关闭翻译', 'Close Translation')}
                    >
                      <X className="w-4 h-4" />
                    </button>
                  </>
                ) : (
                  <button
                    onClick={handleTranslate}
                    disabled={isTranslating}
                    className={`flex items-center space-x-1 px-3 py-2 text-sm rounded-lg transition-colors ${
                      isTranslating
                        ? 'text-muted-foreground/50 cursor-not-allowed'
                        : 'text-muted-foreground hover:text-foreground hover:bg-muted/50'
                    }`}
                    title={t('翻译文档', 'Translate Document')}
                  >
                    {isTranslating ? (
                      <>
                        <Loader2 className="w-4 h-4 animate-spin" />
                        <span className="hidden sm:inline">
                          {translateProgress.total > 0 
                            ? `${translateProgress.current}/${translateProgress.total}` 
                            : t('翻译中...', 'Translating...')}
                        </span>
                      </>
                    ) : (
                      <>
                        <Languages className="w-4 h-4" />
                        <span className="hidden sm:inline">{language === 'zh' ? t('翻译为中文', 'Translate to Chinese') : t('翻译为英文', 'Translate to English')}</span>
                      </>
                    )}
                  </button>
                )
              )}
              {translateError && (
                <div
                  className={`px-3 py-1 text-xs text-destructive bg-destructive/10 rounded-lg cursor-pointer ${errorExpanded ? 'max-w-[400px] whitespace-normal break-all' : 'max-w-[200px] truncate'}`}
                  onClick={() => setErrorExpanded(!errorExpanded)}
                  title={!errorExpanded ? translateError : undefined}
                >
                  {translateError}
                </div>
              )}
              {tocItems.length > 0 && (
                <button
                  onClick={() => setShowToc(!showToc)}
                  className={`p-2 rounded-lg transition-colors ${
                    showToc
                      ? 'bg-primary/20 text-primary'
                      : 'text-muted-foreground hover:text-foreground hover:bg-muted/50'
                  }`}
                  title={t('目录', 'Table of Contents')}
                >
                  <List className="w-4 h-4" />
                </button>
              )}
              <button
                onClick={cycleFontSize}
                className="p-2 rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-colors"
                title={t(`字体大小: ${FONT_SIZES[fontSizeIndex].label}`, `Font Size: ${FONT_SIZES[fontSizeIndex].labelEn}`)}
              >
                <Type className="w-4 h-4" />
              </button>
              <a
                href={`https://github.com/${repoName}`}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center space-x-1 px-3 py-2 text-sm text-muted-foreground hover:text-foreground hover:bg-muted/50 rounded-lg transition-colors"
                title={t('在 GitHub 上查看', 'View on GitHub')}
              >
                <ExternalLink className="w-4 h-4" />
                <span className="hidden sm:inline">{t('在 GitHub 上查看', 'View on GitHub')}</span>
              </a>
              <button
                onClick={onClose}
                className="p-2 rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-colors"
                aria-label="Close"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
          </div>

          <div className="flex-1 flex overflow-hidden">
            {showToc && tocItems.length > 0 && (
              <>
                <div
                  className="border-r border-border overflow-y-auto p-4 flex-shrink-0 readme-scrollbar"
                  style={{ width: tocWidth }}
                >
                  <h4 className="text-xs font-semibold text-foreground mb-3">
                    {t('目录', 'Contents')}
                  </h4>
                  <nav className="space-y-0.5">
                    {tocItems.map((item) => {
                      const displayText = translatedHeadingMap.get(item.id) || item.text;
                      return (
                        <button
                          key={item.id}
                          onClick={() => scrollToHeading(item.id, item.text)}
                          className={`block w-full text-left text-xs py-1 px-2 rounded transition-colors truncate ${tocIndentClass(item.level)} ${tocTextClass(item.level)} ${
                            activeHeadingId === item.id
                              ? 'bg-primary/10 text-primary font-medium'
                              : 'hover:bg-muted/50'
                          }`}
                          title={displayText}
                        >
                          {displayText}
                        </button>
                      );
                    })}
                  </nav>
                </div>
                <div
                  onMouseDown={handleResizeMouseDown}
                  className="w-1.5 cursor-col-resize bg-transparent hover:bg-primary transition-colors flex-shrink-0 relative group"
                >
                  <div className="absolute inset-y-0 -left-1 -right-1" />
                </div>
              </>
            )}

            <div
              ref={contentRef}
              className={`flex-1 overflow-y-auto p-6 ${currentFontSize} select-text readme-scrollbar relative`}
              onScroll={handleScroll}
            >
            {loading ? (
              <div className="flex flex-col items-center justify-center py-20">
                <Loader2 className="w-8 h-8 text-primary animate-spin mb-4" />
                <p className="text-sm text-muted-foreground">
                  正在加载 README...
                </p>
              </div>
            ) : error ? (
              <div className="flex flex-col items-center justify-center py-20">
                <AlertCircle className="w-12 h-12 text-muted-foreground mb-4" />
                <p className="text-sm text-foreground text-center mb-4">
                  {error}
                </p>
                <button
                  onClick={fetchReadme}
                  className="px-4 py-2 bg-primary text-primary-foreground rounded-lg hover:opacity-95 transition-colors text-sm"
                >
                  重试
                </button>
              </div>
            ) : readmeContent ? (
              <BilingualMarkdownRenderer
                ref={bilingualRef}
                markdown={readmeContent}
                baseUrl={`https://github.com/${repoName}`}
                headingIds={headingIdMap}
                fontSize={getFontSizeType()}
                language={language}
                displayMode={displayMode}
                onDisplayModeChange={setDisplayMode}
                onStatusChange={setTranslateStatus}
                onProgress={(current, total) => setTranslateProgress({ current, total })}
                onHeadingsTranslated={handleHeadingsTranslated}
              />
            ) : (
              <div className="flex flex-col items-center justify-center py-20">
                <FileText className="w-12 h-12 text-muted-foreground mb-4" />
                <p className="text-sm text-muted-foreground">
                  该仓库没有 README 文件
                </p>
              </div>
            )}
            </div>

            {showBackToTop && (
              <button
                onClick={scrollToTop}
                className="absolute bottom-4 right-4 p-2 bg-background rounded-full shadow-lg border border-border text-muted-foreground hover:text-foreground hover:bg-muted transition-all z-10"
                title="回到顶部"
              >
                <ArrowUp className="w-4 h-4" />
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );

  return createPortal(modal, portalElement);
};
