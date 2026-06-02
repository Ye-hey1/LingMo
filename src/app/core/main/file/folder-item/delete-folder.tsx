import { ContextMenuItem, ContextMenuShortcut } from "@/components/ui/enhanced-context-menu";
import useArticleStore, { DirTree } from "@/stores/article";
import { useTranslations } from "next-intl";
import { computedParentPath, getCurrentFolder } from "@/lib/path";
import { toast } from "@/hooks/use-toast";
import { cloneDeep } from "lodash-es";
import { ask } from '@tauri-apps/plugin-dialog';
import { Trash2 } from "lucide-react"
import { Kbd } from "@/components/ui/kbd"
import { collectMarkdownFiles } from "@/lib/files";
import { clearFileKnowledgeIndexes, moveWorkspaceEntryToTrash } from "@/lib/file-trash";

interface DeleteFolderProps {
  item: DirTree;
  shortcut?: string;
}

export function DeleteFolder({ item, shortcut }: DeleteFolderProps) {
  const t = useTranslations('article.file');
  const {
    fileTree,
    setFileTree,
    cleanTabsByDeletedFolder,
    activeFilePath,
    flushPendingSaveForPath,
  } = useArticleStore();

  const path = computedParentPath(item);

  async function handleDeleteFolder(event: React.MouseEvent<HTMLDivElement, MouseEvent>) {
    event.stopPropagation();
    
    try {
      // 确认删除操作
      const confirmed = await ask(t('context.confirmDelete', { name: item.name }), {
        title: item.name,
        kind: 'warning',
      });
      
      if (!confirmed) return;

      const markdownFiles = await collectMarkdownFiles(path);

      if (activeFilePath && (activeFilePath === path || activeFilePath.startsWith(`${path}/`))) {
        await flushPendingSaveForPath(activeFilePath);
      }

      await moveWorkspaceEntryToTrash({ relativePath: path, kind: 'directory' });

      // 清理已被删除的文件夹对应的 tabs（包括自动选择其他 tab）
      await cleanTabsByDeletedFolder(path)

      // 从文件树中移除该文件夹
      const cacheTree = cloneDeep(fileTree);
      const currentFolder = getCurrentFolder(path, cacheTree);
      const parentFolder = currentFolder?.parent;

      if (parentFolder && parentFolder.children) {
        const index = parentFolder.children.findIndex(child => child.name === item.name);
        if (index !== -1) {
          parentFolder.children.splice(index, 1);
        }
      } else {
        const index = cacheTree.findIndex(child => child.name === item.name);
        if (index !== -1) {
          cacheTree.splice(index, 1);
        }
      }

      setFileTree(cacheTree);

      // 删除索引数据库中该文件夹下所有 Markdown 文件的记录
      try {
        await clearFileKnowledgeIndexes(markdownFiles.map(file => file.path))
      } catch (error) {
        console.error('删除文件夹索引数据失败:', error)
      }

      toast({ title: '已移入回收站' });
    } catch (error) {
      console.error('Delete folder failed:', error);
      toast({ 
        title: t('context.deleteFailed'), 
        variant: 'destructive' 
      });
    }
  }

  return (
    <ContextMenuItem
      inset
      className="text-red-900"
      onClick={handleDeleteFolder}
      menuType="file"
    >
      <Trash2 className="mr-2 h-4 w-4" />
      {t('context.delete')}
      {shortcut && (
        <ContextMenuShortcut menuType="file">
          <Kbd>{shortcut}</Kbd>
        </ContextMenuShortcut>
      )}
    </ContextMenuItem>
  );
}
