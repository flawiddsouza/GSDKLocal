import { existsSync, mkdirSync } from 'node:fs'
import net from 'node:net'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import Database from 'better-sqlite3'
import { and, eq, not, sql } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import { migrate } from 'drizzle-orm/better-sqlite3/migrator'
import { Constants } from './constants'
import { logger } from './logger'
import { agents, builds, gameServerInstances } from './schema'
import type { Agent, AgentCreate, AgentUpdate, Build, BuildCreate, BuildUpdate, GameServerInstance, GameServerInstanceCreateOrUpdate } from './schema'
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
    agents,
    gameServerInstances,
  },
})

try {
  logger.info('Running migrations...')
  migrate(db, {
    migrationsFolder: './drizzle',
  })
  logger.info('Migrations complete!')
} catch (e) {
  logger.error('Error running migrations', e)
  process.exit(1)
}

export async function getBuild(buildId: string): Promise<Build | undefined> {
  return db.query.builds.findFirst({
    where: eq(builds.buildId, buildId),
  })
}

export async function getBuilds() {
  return db.select().from(builds)
}

export async function createBuild(build: BuildCreate) {
  await db.insert(builds).values(build)
}

export async function updateBuild(buildId: string, update: BuildUpdate) {
  return db.update(builds).set(update).where(eq(builds.buildId, buildId))
}

export async function deleteBuild(buildId: string) {
  return db.delete(builds).where(eq(builds.buildId, buildId))
}

export async function getAvailableAgent(): Promise<Agent | undefined> {
  const maxOpenablePorts = Constants.END_PORT - Constants.START_PORT + 1

  const allocatedGameServerInstancesCountByAgentId = await db
    .select({
      agentId: agents.id,
      count: sql`COUNT(gameServerInstances.id)`,
    })
    .from(agents)
    .leftJoin(gameServerInstances, and(eq(agents.id, gameServerInstances.agentId), not(eq(gameServerInstances.status, GameState.Terminated))))
    .groupBy(gameServerInstances.agentId)

  for (const allocatedCountByAgent of allocatedGameServerInstancesCountByAgentId) {
    if (Number(allocatedCountByAgent.count) < maxOpenablePorts) {
      return db.query.agents.findFirst({
        where: eq(agents.id, allocatedCountByAgent.agentId),
      })
    }
  }

  return undefined
}

export async function getAgent(id: number): Promise<Agent | undefined> {
  return db.query.agents.findFirst({
    where: eq(agents.id, id),
  })
}

export async function getAgents() {
  return db.select().from(agents)
}

export async function createAgent(agent: AgentCreate) {
  await db.insert(agents).values(agent)
}

export async function updateAgent(id: number, update: AgentUpdate) {
  return db.update(agents).set(update).where(eq(agents.id, id))
}

export async function deleteAgent(id: number) {
  return db.delete(agents).where(eq(agents.id, id))
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
  logger.info(gameServerInstance, 'Creating game server instance')
  await db.insert(gameServerInstances).values(gameServerInstance)
}

export async function updateGameServerInstance(serverId: string, update: Partial<GameServerInstanceCreateOrUpdate>) {
  return db
    .update(gameServerInstances)
    .set(update)
    .where(and(eq(gameServerInstances.serverId, serverId), not(eq(gameServerInstances.status, GameState.Terminated))))
}

export async function getUsedPorts(agentId: number) {
  const data = await db
    .select({
      port: gameServerInstances.port,
    })
    .from(gameServerInstances)
    .where(and(eq(gameServerInstances.agentId, agentId), not(eq(gameServerInstances.status, GameState.Terminated))))

  return data.map((row) => row.port)
}

function checkPortAvailable(port: number, host = 'localhost'): Promise<boolean> {
  return new Promise((resolve, reject) => {
    const server = net.createServer()

    server.once('error', (err: NodeJS.ErrnoException) => {
      if (err.code === 'EADDRINUSE') {
        // Port is currently in use
        resolve(false)
      } else {
        reject(err)
      }
    })

    server.once('listening', () => {
      // Port is available
      server.close()
      resolve(true)
    })

    server.listen(port, host)
  })
}

export async function getPort(agentId: number): Promise<string | false> {
  const usedPorts = await getUsedPorts(agentId)

  for (let port = Constants.START_PORT; port <= Constants.END_PORT; port++) {
    if (!usedPorts.includes(port.toString())) {
      if (await checkPortAvailable(port)) {
        return port.toString()
      }
    }
  }

  return false
}
