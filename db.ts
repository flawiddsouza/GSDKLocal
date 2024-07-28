import { existsSync, mkdirSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import Database from 'better-sqlite3'
import { and, eq, inArray, not } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import { migrate } from 'drizzle-orm/better-sqlite3/migrator'
import { Constants } from './constants'
import { builds, gameServerInstances } from './schema'
import type { Build, BuildCreateOrUpdate, GameServerInstance, GameServerInstanceCreateOrUpdate } from './schema'
import { GameState } from './types'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const dataDirectory = path.join(__dirname, 'data')

if (!existsSync(dataDirectory)) {
  mkdirSync(dataDirectory)
}

const sqlite = new Database('./data/store.db')
sqlite.exec('PRAGMA journal_mode = WAL;')
sqlite.exec('PRAGMA foreign_keys = ON;')

const db = drizzle(sqlite, {
  schema: {
    builds,
    gameServerInstances,
  },
})

try {
  console.log('Running migrations...')
  migrate(db, {
    migrationsFolder: './drizzle',
  })
  console.log('Migrations complete!')
} catch (e) {
  console.error('Error running migrations', e)
  process.exit(1)
}

export async function getBuild(buildId: string): Promise<Build | undefined> {
  return db.query.builds.findFirst({
    where: eq(builds.buildId, buildId),
  }) as Promise<Build | undefined>
}

export async function getBuilds() {
  return db.select().from(builds)
}

export async function createBuild(build: BuildCreateOrUpdate) {
  await db.insert(builds).values(build)
}

export async function updateBuild(buildId: string, update: Partial<BuildCreateOrUpdate>) {
  return db.update(builds).set(update).where(eq(builds.buildId, buildId))
}

export async function deleteBuild(buildId: string) {
  return db.delete(builds).where(eq(builds.buildId, buildId))
}

export async function getGameServerInstance(serverId: string): Promise<GameServerInstance | undefined> {
  return db.query.gameServerInstances.findFirst({
    where: eq(gameServerInstances.serverId, serverId),
  }) as Promise<GameServerInstance | undefined>
}

export async function getUnterminatedGameServerInstances() {
  return db
    .select()
    .from(gameServerInstances)
    .where(not(eq(gameServerInstances.status, GameState.Terminated)))
}

export async function createGameServerInstance(gameServerInstance: GameServerInstanceCreateOrUpdate) {
  console.log('Creating game server instance', gameServerInstance)
  await db.insert(gameServerInstances).values(gameServerInstance)
}

export async function updateGameServerInstance(serverId: string, update: Partial<GameServerInstanceCreateOrUpdate>) {
  return db
    .update(gameServerInstances)
    .set(update)
    .where(and(eq(gameServerInstances.serverId, serverId), inArray(gameServerInstances.status, [GameState.StandingBy, GameState.Active])))
}

export async function getUsedPorts() {
  const data = await db
    .select({
      port: gameServerInstances.port,
    })
    .from(gameServerInstances)
    .where(inArray(gameServerInstances.status, [GameState.StandingBy, GameState.Active]))

  return data.map((row) => row.port)
}

export async function getPort(): Promise<string | false> {
  const usedPorts = await getUsedPorts()

  for (let port = Constants.START_PORT; port <= Constants.END_PORT; port++) {
    if (!usedPorts.includes(port.toString())) {
      return port.toString()
    }
  }

  return false
}
