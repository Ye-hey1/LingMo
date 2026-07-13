import type { CreativeCanvasAsset } from '@/types/creative-canvas'

type StoredCreativeCanvasFile = { path: string; bytes?: number }
type CreativeCanvasAssetPath = Pick<CreativeCanvasAsset, 'filePath' | 'thumbnailPath'>

export function getKnownCreativeCanvasPaths(assets: CreativeCanvasAssetPath[]) {
  const paths = new Set<string>()
  for (const asset of assets) {
    paths.add(asset.filePath)
    if (asset.thumbnailPath) paths.add(asset.thumbnailPath)
  }
  return paths
}

export function findOrphanCreativeCanvasFiles(
  files: StoredCreativeCanvasFile[],
  allProjectAssets: CreativeCanvasAssetPath[],
) {
  const knownPaths = getKnownCreativeCanvasPaths(allProjectAssets)
  return files.filter(file => !knownPaths.has(file.path))
}
