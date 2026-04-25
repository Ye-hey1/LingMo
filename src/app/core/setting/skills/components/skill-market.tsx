'use client'

import { useState, useEffect, useCallback } from 'react'
import { useTranslations } from 'next-intl'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Loader2, Search, Download, CheckCircle, TrendingUp, Flame, Trophy, RefreshCw } from 'lucide-react'
import { useSkillsV2Store, type MarketSkill } from '@/stores/skills-v2'
import { useToast } from '@/hooks/use-toast'

const DEBOUNCE_MS = 450

function formatInstalls(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`
  return String(n)
}

export function SkillMarket() {
  const t = useTranslations('settings.skills')
  const { toast } = useToast()
  const {
    marketSkills,
    marketLoading,
    marketSearchLoading,
    skills,
    fetchLeaderboard,
    searchMarket,
    installFromMarket,
    installing,
  } = useSkillsV2Store()

  const [board, setBoard] = useState<string>('alltime')
  const [searchQuery, setSearchQuery] = useState('')
  const [debouncedQuery, setDebouncedQuery] = useState('')
  const [installedSet, setInstalledSet] = useState<Set<string>>(new Set())
  const [installingId, setInstallingId] = useState<string | null>(null)

  // Track installed skills from source_ref
  useEffect(() => {
    const refs = new Set<string>()
    skills.forEach(s => {
      if (s.source_ref) refs.add(s.source_ref)
    })
    setInstalledSet(refs)
  }, [skills])

  // Debounced search
  useEffect(() => {
    const timer = setTimeout(() => setDebouncedQuery(searchQuery), DEBOUNCE_MS)
    return () => clearTimeout(timer)
  }, [searchQuery])

  // Fetch leaderboard on mount or tab change
  const loadLeaderboard = useCallback(async (b: string) => {
    try {
      await fetchLeaderboard(b)
    } catch (e) {
      toast({ title: t('marketError'), description: String(e), variant: 'destructive' })
    }
  }, [fetchLeaderboard, toast, t])

  useEffect(() => {
    if (!debouncedQuery) {
      loadLeaderboard(board)
    }
  }, [board, debouncedQuery, loadLeaderboard])

  // Search when query changes
  useEffect(() => {
    if (!debouncedQuery) return
    searchMarket(debouncedQuery).catch((e) => {
      toast({ title: t('marketError'), description: String(e), variant: 'destructive' })
    })
  }, [debouncedQuery, searchMarket, toast, t])

  const handleInstall = async (skill: MarketSkill) => {
    const key = skill.id
    setInstallingId(key)
    try {
      await installFromMarket(skill.source, skill.skill_id)
      setInstalledSet(prev => new Set(prev).add(`https://github.com/${skill.source}.git`))
      toast({ title: t('installSuccess'), description: skill.name })
    } catch (e) {
      toast({ title: t('installError'), description: String(e), variant: 'destructive' })
    } finally {
      setInstallingId(null)
    }
  }

  const isInstalled = (skill: MarketSkill) => {
    return installedSet.has(`https://github.com/${skill.source}.git`) ||
      installedSet.has(skill.source)
  }

  const isLoading = marketLoading || marketSearchLoading
  const isSearching = !!debouncedQuery

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <div>
            <CardTitle className="text-lg flex items-center gap-2">
              <Trophy className="size-5" />
              {t('marketTitle')}
            </CardTitle>
            <p className="text-sm text-muted-foreground mt-1">{t('marketDesc')}</p>
          </div>
          {!isSearching && (
            <Button variant="ghost" size="sm" onClick={() => loadLeaderboard(board)} disabled={isLoading}>
              <RefreshCw className={`size-4 ${isLoading ? 'animate-spin' : ''}`} />
            </Button>
          )}
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Search */}
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
          <Input
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder={t('marketSearch')}
            className="pl-9"
          />
        </div>

        {/* Leaderboard Tabs */}
        {!isSearching && (
          <Tabs value={board} onValueChange={setBoard}>
            <TabsList className="h-8">
              <TabsTrigger value="alltime" className="text-xs gap-1 px-2">
                <Trophy className="size-3" /> {t('leaderboardAll')}
              </TabsTrigger>
              <TabsTrigger value="trending" className="text-xs gap-1 px-2">
                <TrendingUp className="size-3" /> {t('leaderboardTrending')}
              </TabsTrigger>
              <TabsTrigger value="hot" className="text-xs gap-1 px-2">
                <Flame className="size-3" /> {t('leaderboardHot')}
              </TabsTrigger>
            </TabsList>
          </Tabs>
        )}

        {isSearching && (
          <p className="text-sm text-muted-foreground">
            {t('marketSearchResults')} &quot;{debouncedQuery}&quot;
          </p>
        )}

        {/* Skills Grid */}
        {isLoading && marketSkills.length === 0 ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="size-6 animate-spin text-muted-foreground" />
          </div>
        ) : marketSkills.length === 0 ? (
          <div className="text-center py-8 text-muted-foreground">
            <Search className="mx-auto h-10 w-10 mb-3 opacity-50" />
            <p>{isSearching ? t('noSearchResults') : t('marketEmpty')}</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
            {marketSkills.map((skill) => {
              const installed = isInstalled(skill)
              const installingThis = installingId === skill.id

              return (
                <div
                  key={skill.id}
                  className="flex items-center gap-3 p-3 rounded-lg border hover:bg-accent/30 transition-colors"
                >
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="font-medium text-sm truncate">{skill.name}</span>
                      {installed && (
                        <Badge variant="secondary" className="text-[10px] px-1.5 py-0">
                          <CheckCircle className="size-3 mr-0.5" /> {t('installedBadge')}
                        </Badge>
                      )}
                    </div>
                    <div className="flex items-center gap-2 mt-0.5">
                      <span className="text-xs text-muted-foreground">
                        {t('byAuthor', { author: skill.source.split('/')[0] })}
                      </span>
                      <span className="text-xs text-muted-foreground">
                        {formatInstalls(skill.installs)} {t('leaderboardAll').toLowerCase()}
                      </span>
                    </div>
                  </div>

                  <div className="shrink-0">
                    {installed ? (
                      <Badge variant="outline" className="text-xs text-green-600">
                        <CheckCircle className="size-3 mr-1" />
                      </Badge>
                    ) : (
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-7"
                        disabled={installingThis || installing}
                        onClick={() => handleInstall(skill)}
                      >
                        {installingThis ? (
                          <Loader2 className="size-3.5 animate-spin" />
                        ) : (
                          <Download className="size-3.5" />
                        )}
                        <span className="ml-1 text-xs">
                          {installingThis ? t('installingFromMarket') : t('installFromMarket')}
                        </span>
                      </Button>
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </CardContent>
    </Card>
  )
}
