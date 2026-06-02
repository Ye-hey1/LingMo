/**
 * Repository Merge — 仓库合并时保留本地元数据
 *
 * 移植自 GSM 的 repositoryMerge.ts，适配 LingMo 类型。
 * 核心原则：远程数据（stars、forks、描述等）用最新的，本地用户数据（AI 分析、自定义标签等）保留。
 */

import type { GithubStarRepository } from '@/types/github-stars'

/** 合并时应保留的本地用户数据字段 */
const LOCAL_METADATA_FIELDS: ReadonlyArray<keyof GithubStarRepository> = [
  'aiSummary',
  'aiTags',
  'aiPlatforms',
  'analyzedAt',
  'analysisFailed',
  'customDescription',
  'customTags',
  'customCategory',
  'categoryLocked',
  'lastEdited',
  'subscribedToReleases',
  'lastReleaseFetchTime',
  'hasFetchedReleases',
  'isStarred',
]

/**
 * 将远程仓库数据合并到本地数据上，保留所有本地元数据。
 *
 * @param incomingRepos - 来自 GitHub API / 远端同步的最新仓库数据
 * @param localRepos - 本地 IndexedDB 中的仓库数据（包含用户编辑、AI 分析等）
 * @returns 合并后的仓库列表
 */
export function mergeRepositoriesPreservingLocalMetadata(
  incomingRepos: GithubStarRepository[],
  localRepos: GithubStarRepository[],
): GithubStarRepository[] {
  const localMap = new Map(localRepos.map(repo => [repo.id, repo]))

  return incomingRepos.map(incoming => {
    const local = localMap.get(incoming.id)
    if (!local) return incoming

    const merged: GithubStarRepository = { ...incoming }

    for (const field of LOCAL_METADATA_FIELDS) {
      const localValue = local[field]
      // 保留有值的本地字段（null 以外的有意义的值）
      if (localValue !== undefined && localValue !== null && localValue !== false) {
        // 对于数组，空数组不覆盖；对于字符串，空字符串不覆盖
        if (Array.isArray(localValue) && localValue.length === 0) continue
        if (typeof localValue === 'string' && localValue === '') continue
        ;(merged as unknown as Record<string, unknown>)[field] = localValue
      } else if (field === 'isStarred') {
        // isStarred 特殊处理：本地标记为 true 时保持
        ;(merged as unknown as Record<string, unknown>)[field] = local.isStarred
      }
    }

    return merged
  })
}

/**
 * 智能合并策略：当本地字段比远程更新时保留本地版本。
 *
 * 比较 lastEdited 时间戳决定哪些自定义字段需要保留。
 */
export function smartMergeRepositories(
  incomingRepos: GithubStarRepository[],
  localRepos: GithubStarRepository[],
): GithubStarRepository[] {
  const localMap = new Map(localRepos.map(repo => [repo.id, repo]))

  return incomingRepos.map(incoming => {
    const local = localMap.get(incoming.id)
    if (!local) return incoming

    const merged: GithubStarRepository = { ...incoming }

    // 如果本地有用户编辑且比远程更新，保留本地自定义字段
    const localEditedAt = local.lastEdited ? new Date(local.lastEdited).getTime() : 0
    const incomingEditedAt = incoming.lastEdited ? new Date(incoming.lastEdited).getTime() : 0

    if (localEditedAt >= incomingEditedAt) {
      // 本地编辑更新 → 保留本地用户数据
      for (const field of LOCAL_METADATA_FIELDS) {
        ;(merged as unknown as Record<string, unknown>)[field] = local[field]
      }
    } else {
      // 远程更新 → 仍保留 AI 分析和订阅（这些不会通过同步推送）
      const preserveFields: ReadonlyArray<keyof GithubStarRepository> = [
        'aiSummary', 'aiTags', 'aiPlatforms', 'analyzedAt', 'analysisFailed',
        'subscribedToReleases', 'lastReleaseFetchTime', 'hasFetchedReleases',
      ]
      for (const field of preserveFields) {
        const localValue = local[field]
        if (localValue !== undefined && localValue !== null && localValue !== false) {
          ;(merged as unknown as Record<string, unknown>)[field] = localValue
        }
      }
    }

    return merged
  })
}
