import { ContextMenuSub, ContextMenuSubContent, ContextMenuSubTrigger } from "@/components/ui/enhanced-context-menu";
import { DirTree } from "@/stores/article";
import { createDiagramFile } from "@/lib/create-diagram-file";
import { computedParentPath } from "@/lib/path";
import { DraftingCompass } from "lucide-react"
import type { DiagramKind } from "@/lib/diagram";
import { DiagramTypeContextContent } from "../diagram-type-menu";

interface NewDiagramProps {
  item: DirTree;
}

export function NewDiagram({ item }: NewDiagramProps) {
  const path = computedParentPath(item);

  async function newDiagramHandler(kind: DiagramKind) {
    await createDiagramFile(path, kind);
  }

  return (
    <ContextMenuSub>
      <ContextMenuSubTrigger
        inset
        disabled={!!item.sha && !item.isLocale}
        menuType="file"
      >
        <DraftingCompass className="mr-2 h-4 w-4" />
        新建图表
      </ContextMenuSubTrigger>
      <ContextMenuSubContent className="min-w-[208px] p-1.5">
        <DiagramTypeContextContent onSelect={newDiagramHandler} />
      </ContextMenuSubContent>
    </ContextMenuSub>
  );
}
