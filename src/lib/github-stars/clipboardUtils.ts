export interface ClipboardSupport {
  writeText: boolean;
  readText: boolean;
  isSecureContext: boolean;
}

export const checkClipboardSupport = (): ClipboardSupport => {
  const isSecureContext = typeof window !== 'undefined' && window.isSecureContext;
  const clipboard = typeof navigator !== 'undefined' ? navigator.clipboard : undefined;

  return {
    writeText: isSecureContext && !!clipboard && typeof clipboard.writeText === 'function',
    readText: isSecureContext && !!clipboard && typeof clipboard.readText === 'function',
    isSecureContext,
  };
};

export const getClipboardErrorMessage = (
  operation: 'read' | 'write',
  language: 'zh' | 'en' = 'zh'
): string => {
  const support = checkClipboardSupport();

  if (!support.isSecureContext) {
    return language === 'zh'
      ? '剪贴板功能需要使用 HTTPS 协议访问'
      : 'Clipboard requires HTTPS protocol';
  }

  if (operation === 'write' && !support.writeText) {
    return language === 'zh'
      ? '您的浏览器不支持剪贴板写入功能，请升级浏览器'
      : 'Your browser does not support clipboard write. Please upgrade your browser';
  }

  return language === 'zh'
    ? '剪贴板操作失败，请检查浏览器权限设置'
    : 'Clipboard operation failed. Please check browser permissions';
};

export const safeWriteText = async (text: string): Promise<{ success: boolean; error?: string }> => {
  const support = checkClipboardSupport();

  if (!support.writeText) {
    try {
      const textarea = document.createElement('textarea');
      textarea.value = text;
      textarea.style.position = 'fixed';
      textarea.style.left = '-999999px';
      textarea.style.top = '-999999px';
      document.body.appendChild(textarea);
      textarea.focus();
      textarea.select();

      const success = document.execCommand('copy');
      document.body.removeChild(textarea);

      if (success) {
        return { success: true };
      }
    } catch {
      // 忽略降级执行失败
    }

    return {
      success: false,
      error: getClipboardErrorMessage('write'),
    };
  }

  try {
    await navigator.clipboard.writeText(text);
    return { success: true };
  } catch {
    return {
      success: false,
      error: getClipboardErrorMessage('write'),
    };
  }
};
