export const KNOWLEDGE_GRAPH_TAB_ID = 'workspace-knowledge-graph'
export const KNOWLEDGE_GRAPH_TAB_PATH = 'note-gen://knowledge-graph'
export const KNOWLEDGE_GRAPH_TAB_NAME = '知识图谱'

export function isKnowledgeGraphTabPath(path: string) {
  return path === KNOWLEDGE_GRAPH_TAB_PATH
}
