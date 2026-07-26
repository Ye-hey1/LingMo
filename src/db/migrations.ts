/**
 * 基于 SQLite `PRAGMA user_version` 的迁移框架。
 *
 * 现状与定位：22 个 init*Db() 各自跑 `CREATE TABLE IF NOT EXISTS` 建基线表，
 * 个别文件用 ensureColumn() 逐列探测补字段。那套机制能加列，但表达不了
 * 「有序的多步变更」和「数据迁移」，也没有版本概念——无法判断某台机器的库
 * 停在哪一步。
 *
 * 这里补上版本轴：init 继续负责基线建表，本模块负责基线之后的有序演进。
 * 两者并存，不改动既有 init 逻辑。
 */

/** 迁移执行所需的最小数据库接口，便于测试注入。 */
export interface MigrationDatabase {
  execute(query: string, bindValues?: unknown[]): Promise<unknown>
  select<T>(query: string, bindValues?: unknown[]): Promise<T>
}

export interface Migration {
  /** 目标版本号，从 1 开始连续递增。 */
  version: number
  /** 变更用途，出错时会带进异常信息。 */
  description: string
  /** 按顺序执行的 SQL 语句。 */
  statements: string[]
}

/**
 * 迁移清单。
 *
 * 约束：版本号从 1 起连续、只增不改。已发布的迁移不得修改内容——用户库里
 * 已经执行过的版本不会重跑，改动只会导致新旧机器 schema 分叉。要修正只能追加
 * 新版本。
 *
 * 当前为空：既有表结构全部由 init*Db() 建立，尚无需要版本化的增量变更。
 * 框架先行落地，后续 schema 演进往这里追加。
 */
export const MIGRATIONS: Migration[] = []

async function readUserVersion(db: MigrationDatabase): Promise<number> {
  const rows = await db.select<Array<Record<string, unknown>>>('PRAGMA user_version')
  const raw = rows?.[0] ? Object.values(rows[0])[0] : 0
  const parsed = Number(raw ?? 0)
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : 0
}

async function writeUserVersion(db: MigrationDatabase, version: number): Promise<void> {
  if (!Number.isInteger(version) || version < 0) {
    throw new Error(`非法的 user_version: ${version}`)
  }
  // user_version 不支持参数绑定，只能字面量拼接；上面已校验为非负整数。
  await db.execute(`PRAGMA user_version = ${version}`)
}

/** 校验清单本身合法：版本号从 1 起、连续、无重复。 */
export function validateMigrations(migrations: readonly Migration[]): void {
  migrations.forEach((migration, index) => {
    const expected = index + 1
    if (migration.version !== expected) {
      throw new Error(
        `migration version must start at 1 and increase by 1: index ${index} expected v${expected}, got v${migration.version}`,
      )
    }
    if (migration.statements.length === 0) {
      throw new Error(`migration v${migration.version} has no statements`)
    }
  })
}

export interface MigrationResult {
  fromVersion: number
  toVersion: number
  applied: number[]
}

/**
 * 执行所有未应用的迁移。
 *
 * 关于原子性——这里**不是**一个原子事务，和 runDbBatch 的取舍一致：
 * 连接池（serializedWrite + 繁忙重试）会对单条语句自动重试，裸 BEGIN/COMMIT
 * 穿过一个会重试的池并不可靠，重试的语句可能落在事务边界之外。所以逐条执行。
 *
 * 代价是某版中途失败会留下已执行的前几条语句。补偿手段是版本号只在整版成功后
 * 才推进：失败则停在上一版本，下次启动重跑该版本。因此迁移语句**必须幂等**
 * （CREATE TABLE IF NOT EXISTS / CREATE INDEX IF NOT EXISTS 等），否则重跑会
 * 在已执行的那几条上再次失败、永久卡住。这是写迁移时的硬性要求。
 */
export async function runMigrations(
  db: MigrationDatabase,
  migrations: readonly Migration[] = MIGRATIONS,
): Promise<MigrationResult> {
  validateMigrations(migrations)

  const currentVersion = await readUserVersion(db)
  const latestVersion = migrations.length

  if (currentVersion > latestVersion) {
    // 库比当前程序新，通常是降级安装。不猜测如何回退，交由基线 init 的
    // IF NOT EXISTS 兜住基本可用性。
    console.warn(
      `[DB] user_version=${currentVersion} 高于本程序支持的 v${latestVersion}，跳过迁移（疑似降级安装）`,
    )
    return { fromVersion: currentVersion, toVersion: currentVersion, applied: [] }
  }

  const pending = migrations.filter(migration => migration.version > currentVersion)
  const applied: number[] = []

  for (const migration of pending) {
    try {
      for (const statement of migration.statements) {
        await db.execute(statement)
      }
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error)
      throw new Error(
        `migration v${migration.version} failed: ${migration.description}: ${reason}`,
      )
    }
    // 只有整版语句都成功才推进版本号，失败时下次启动重跑本版本
    await writeUserVersion(db, migration.version)
    applied.push(migration.version)
  }

  return {
    fromVersion: currentVersion,
    toVersion: applied.length > 0 ? applied[applied.length - 1] : currentVersion,
    applied,
  }
}

/** 读取当前库的 schema 版本，用于诊断展示。 */
export async function getSchemaVersion(db: MigrationDatabase): Promise<number> {
  return await readUserVersion(db)
}
